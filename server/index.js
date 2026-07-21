'use strict';
// 后端服务 —— 轻量 HTTP API + 静态文件，零框架依赖
// 以独立 Node 进程运行（Electron 主进程拉起，或 `npm run server` 后用浏览器打开）
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { db, now, closeDatabase } = require('./db');
const { applySettingsPatch, loadSettings, saveSettings, loadScoring } = require('./config');
const { persistApiKey } = require('./runtime-credentials');
const { seedSources } = require('./collectors');
const { runPipeline, startScheduler, stopScheduler, waitForSchedulerIdle, getStatus } = require('./scheduler');
const { getDaily, generateDaily, listDailyDates } = require('./ai/daily');
const { heatScore } = require('./ai/scoring');
const { testConnection } = require('./ai/deepseek');
const { CATEGORIES } = require('./ai/pipeline');
const { parseFeedQuery, sanitizeDate, sanitizeFeedback, sanitizeSourceInput } = require('./input-validation');
const { resolveStaticFile } = require('./static-files');
const { startOfLocalDayIso } = require('./date-time');
const { persistSettingsUpdate } = require('./settings-persistence');
const {
  API_TOKEN_HEADER,
  HttpError,
  authorize,
  readJsonBody,
  RESPONSE_SECURITY_HEADERS
} = require('./http-security');

const REQUESTED_PORT = Number(process.env.STAR_PICKING_PAVILION_PORT || process.env.WINDCATCHER_PORT || 7644);
const API_TOKEN = process.env.STAR_PICKING_PAVILION_API_TOKEN || '';
const SERVER_NONCE = process.env.STAR_PICKING_PAVILION_SERVER_NONCE || '';
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon'
};

function json(res, code, data) {
  res.writeHead(code, {
    ...RESPONSE_SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(data));
}

// ---------- 文章查询 ----------
function parseOptionalJson(value, fallback, predicate) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return predicate(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function articleRow(r, scoring, nowMs) {
  const rawQuality = Number(r.quality_score);
  const quality = Number.isFinite(rawQuality) ? Math.max(0, Math.min(100, rawQuality)) : null;
  const safeDate = value => value && Number.isFinite(new Date(value).getTime()) ? value : null;
  const publishedAt = safeDate(r.published_at);
  const fetchedAt = safeDate(r.fetched_at);
  return {
    id: r.id, title: r.title, url: r.url,
    summary: r.ai_summary || (r.summary_raw || '').slice(0, 120),
    reason: r.ai_reason || null,
    image: r.image_url || null,
    publishedAt, fetchedAt,
    domain: r.domain, category: r.category,
    quality,
    heat: quality != null ? Math.round(heatScore(quality, publishedAt || fetchedAt, scoring, nowMs) * 10) / 10 : null,
    featured: !!r.featured,
    scores: parseOptionalJson(r.scores_json, null, value => value && typeof value === 'object' && !Array.isArray(value)),
    tags: parseOptionalJson(r.tags_json, [], Array.isArray),
    source: r.source_name, tier: r.tier,
    clusterId: r.cluster_id, clusterSize: r.cluster_size || null,
    analyzed: r.analyzed
  };
}

function queryFeed(q) {
  const scoring = loadScoring();
  const nowMs = Date.now();
  const { view, domain, category, search, page } = parseFeedQuery(q, CATEGORIES);
  const SIZE = 30;
  const HOT_CANDIDATES = 1000;

  const where = [];
  const params = [];
  if (view === 'featured') where.push('a.featured = 1');
  if (view === 'featured' || view === 'hot') where.push('a.relevant = 1');
  if (view === 'all') where.push("(a.relevant IS NULL OR a.relevant = 1)");
  if (domain) { where.push('a.domain = ?'); params.push(domain); }
  if (category) { where.push('a.category = ?'); params.push(category); }

  let idFilter = '';
  if (search) {
    // ≥3 字用 FTS5 trigram，短词降级 LIKE
    let ids;
    if ([...search].length >= 3) {
      try {
        ids = db.prepare('SELECT rowid FROM articles_fts WHERE articles_fts MATCH ? LIMIT 500')
          .all(`"${search.replace(/"/g, '""')}"`).map(r => r.rowid);
      } catch { ids = null; }
    }
    if (!ids) {
      ids = db.prepare('SELECT id FROM articles WHERE title LIKE ? OR ai_summary LIKE ? LIMIT 500')
        .all(`%${search}%`, `%${search}%`).map(r => r.id);
    }
    if (!ids.length) return { items: [], page, hasMore: false };
    idFilter = `AND a.id IN (${ids.join(',')})`;
  }

  // 事件簇折叠：簇内只返回主条
  const sql = `
    SELECT a.*, s.name AS source_name, s.tier, c.size AS cluster_size
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    LEFT JOIN clusters c ON c.id = a.cluster_id
    WHERE ${where.join(' AND ') || '1=1'} ${idFilter}
      AND (a.cluster_id IS NULL OR a.id = c.main_article_id)
    ORDER BY ${view === 'hot' ? 'a.quality_score DESC' : 'COALESCE(a.published_at, a.fetched_at) DESC'}
    LIMIT ${view === 'hot' ? HOT_CANDIDATES + 1 : SIZE + 1}
    OFFSET ${view === 'hot' ? 0 : page * SIZE}`;
  let rows = db.prepare(sql).all(...params);

  let items = rows.map(r => articleRow(r, scoring, nowMs));
  // 精选/全部 = 时间线（按时间倒序）；热点 = 热度榜（质量分×时间衰减）
  if (view === 'hot') {
    items.sort((a, b) => (b.heat || 0) - (a.heat || 0));
  }
  const start = view === 'hot' ? page * SIZE : 0;
  const hasMore = items.length > start + SIZE;
  return { items: items.slice(start, start + SIZE), page, hasMore };
}

function getCluster(id) {
  const scoring = loadScoring();
  const rows = db.prepare(`
    SELECT a.*, s.name AS source_name, s.tier FROM articles a
    JOIN sources s ON s.id = a.source_id
    WHERE a.cluster_id = ? ORDER BY a.quality_score DESC`).all(id);
  return rows.map(r => articleRow(r, scoring, Date.now()));
}

function getStats() {
  const g = (sql, ...params) => db.prepare(sql).get(...params);
  const todayStart = startOfLocalDayIso();
  return {
    sources: g('SELECT COUNT(*) c FROM sources WHERE enabled=1').c,
    sourcesTotal: g('SELECT COUNT(*) c FROM sources').c,
    articles: g('SELECT COUNT(*) c FROM articles').c,
    today: g('SELECT COUNT(*) c FROM articles WHERE fetched_at >= ?', todayStart).c,
    relevantToday: g('SELECT COUNT(*) c FROM articles WHERE relevant=1 AND fetched_at >= ?', todayStart).c,
    featuredToday: g('SELECT COUNT(*) c FROM articles WHERE featured=1 AND fetched_at >= ?', todayStart).c,
    pending: g('SELECT COUNT(*) c FROM articles WHERE analyzed=0').c,
    pipeline: getStatus(),
    aiConfigured: !!loadSettings().ai.apiKey
  };
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  try {
    const activePort = server.address()?.port || REQUESTED_PORT;
    const u = new URL(req.url, `http://127.0.0.1:${activePort}`);
    const p = u.pathname;
    if (p.startsWith('/api/')) {
      const permitted = authorize({
        host: req.headers.host,
        origin: req.headers.origin,
        token: req.headers[API_TOKEN_HEADER]
      }, { port: activePort, expectedToken: API_TOKEN });
      if (!permitted) return json(res, 403, { error: 'forbidden' });

      if (p === '/api/feed' && req.method === 'GET') return json(res, 200, queryFeed(u.searchParams));
      if (p === '/api/stats' && req.method === 'GET') return json(res, 200, getStats());
      if (p === '/api/categories') return json(res, 200, CATEGORIES);

      const mCluster = p.match(/^\/api\/cluster\/(\d+)$/);
      if (mCluster) return json(res, 200, getCluster(Number(mCluster[1])));

      if (p === '/api/daily' && req.method === 'GET') {
        const date = sanitizeDate(u.searchParams.get('date'));
        return json(res, 200, { report: getDaily(date), dates: listDailyDates() });
      }
      if (p === '/api/daily/regenerate' && req.method === 'POST') {
        const body = await readJsonBody(req);
        return json(res, 200, generateDaily(sanitizeDate(body.date)));
      }

      if (p === '/api/collect' && req.method === 'POST') {
        runPipeline('manual').catch(e => console.error(e));
        return json(res, 202, { started: true });
      }

      if (p === '/api/sources' && req.method === 'GET') {
        return json(res, 200, db.prepare('SELECT * FROM sources ORDER BY tier, id').all());
      }
      if (p === '/api/sources' && req.method === 'POST') {
        const b = await readJsonBody(req);
        const source = sanitizeSourceInput(b);
        const r = db.prepare(`INSERT INTO sources (name, type, url, tier, domain, enabled, selector_json, note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          source.name, source.type, source.url, source.tier, source.domain,
          source.enabled ? 1 : 0, source.selector ? JSON.stringify(source.selector) : null, source.note);
        return json(res, 200, { id: r.lastInsertRowid });
      }
      const mSrc = p.match(/^\/api\/sources\/(\d+)$/);
      if (mSrc && req.method === 'PATCH') {
        const b = await readJsonBody(req);
        const cur = db.prepare('SELECT * FROM sources WHERE id=?').get(Number(mSrc[1]));
        if (!cur) return json(res, 404, { error: '不存在' });
        const source = sanitizeSourceInput(b, cur);
        db.prepare(`UPDATE sources SET name=?, type=?, url=?, tier=?, domain=?, enabled=?, selector_json=?, note=? WHERE id=?`)
          .run(source.name, source.type, source.url, source.tier, source.domain,
            source.enabled ? 1 : 0, source.selector ? JSON.stringify(source.selector) : null, source.note, cur.id);
        return json(res, 200, { ok: true });
      }
      if (mSrc && req.method === 'DELETE') {
        const sourceId = Number(mSrc[1]);
        const existing = db.prepare('SELECT id FROM sources WHERE id=?').get(sourceId);
        if (!existing) return json(res, 404, { error: '信源不存在' });
        db.prepare('UPDATE sources SET enabled=0 WHERE id=?').run(sourceId);
        return json(res, 200, { ok: true, disabled: true });
      }

      if (p === '/api/settings' && req.method === 'GET') {
        const s = loadSettings();
        const masked = structuredClone(s);
        delete masked.ai.apiKey;
        masked.ai._hasKey = !!s.ai.apiKey;
        return json(res, 200, masked);
      }
      if (p === '/api/settings' && req.method === 'POST') {
        const b = await readJsonBody(req);
        const currentSettings = loadSettings();
        const update = applySettingsPatch(currentSettings, b);
        await persistSettingsUpdate({
          currentSettings,
          update,
          persistCredential: persistApiKey,
          saveSettings
        });
        return json(res, 200, { ok: true, credentialConfigured: !!update.apiKey });
      }
      if (p === '/api/settings/test' && req.method === 'POST') {
        try {
          await testConnection(loadSettings());
          return json(res, 200, { ok: true });
        } catch (e) {
          return json(res, 200, { ok: false, error: String(e.message || e) });
        }
      }

      if (p === '/api/feedback' && req.method === 'POST') {
        const b = sanitizeFeedback(await readJsonBody(req));
        db.prepare('INSERT INTO feedback (kind, content, created_at) VALUES (?, ?, ?)')
          .run(b.kind, b.content, now());
        return json(res, 200, { ok: true });
      }

      return json(res, 404, { error: 'not found' });
    }

    // 静态文件
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...RESPONSE_SECURITY_HEADERS, Allow: 'GET, HEAD' });
      return res.end('method not allowed');
    }
    const full = resolveStaticFile(RENDERER_DIR, p);
    if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.writeHead(404, RESPONSE_SECURITY_HEADERS); return res.end('not found');
    }
    res.writeHead(200, {
      ...RESPONSE_SECURITY_HEADERS,
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    console.error('[http]', e);
    json(res, e instanceof HttpError ? e.statusCode : 500, {
      error: e instanceof HttpError ? e.message : 'internal server error'
    });
  }
});

let shutdownPromise = null;

function closeHttpServer() {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeIdleConnections?.();
  });
}

function notifyStoppedAndExit() {
  const stopped = { type: 'server:stopped' };
  if (process.parentPort) {
    process.parentPort.postMessage(stopped);
    setImmediate(() => process.exit(0));
    return;
  }
  if (typeof process.send === 'function') {
    process.send(stopped, () => process.exit(0));
    return;
  }
  process.exit(0);
}

function shutdownServer() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    stopScheduler();
    await Promise.all([closeHttpServer(), waitForSchedulerIdle()]);
    closeDatabase();
    notifyStoppedAndExit();
  })().catch(error => {
    console.error('[server] 关闭失败:', error);
    process.exit(1);
  });
  return shutdownPromise;
}

function handleControlMessage(message) {
  if (message?.type === 'server:shutdown') shutdownServer();
}

process.parentPort?.on('message', handleControlMessage);
process.on('message', handleControlMessage);
process.once('SIGTERM', shutdownServer);

seedSources();
server.listen(REQUESTED_PORT, '127.0.0.1', () => {
  const port = server.address().port;
  const ready = { type: 'server:ready', port, nonce: SERVER_NONCE };
  process.parentPort?.postMessage(ready);
  if (typeof process.send === 'function') process.send(ready);
  console.log(`[server:ready]${JSON.stringify(ready)}`);
  console.log(`[server] 摘星阁后端已启动: http://127.0.0.1:${port}`);
  if (process.env.STAR_PICKING_PAVILION_NO_SCHEDULER !== '1'
    && process.env.WINDCATCHER_NO_SCHEDULER !== '1') startScheduler();
});
