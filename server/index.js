'use strict';
// 后端服务 —— 轻量 HTTP API + 静态文件，零框架依赖
// 以独立 Node 进程运行（Electron 主进程拉起，或 `npm run server` 后用浏览器打开）
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { db, now } = require('./db');
const { applySettingsPatch, loadSettings, saveSettings, loadScoring } = require('./config');
const { persistApiKey } = require('./runtime-credentials');
const { seedSources } = require('./collectors');
const { runPipeline, startScheduler, getStatus } = require('./scheduler');
const { getDaily, generateDaily, listDailyDates } = require('./ai/daily');
const { heatScore } = require('./ai/scoring');
const { testConnection } = require('./ai/deepseek');
const { CATEGORIES } = require('./ai/pipeline');
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
function articleRow(r, scoring, nowMs) {
  return {
    id: r.id, title: r.title, url: r.url,
    summary: r.ai_summary || (r.summary_raw || '').slice(0, 120),
    reason: r.ai_reason || null,
    image: r.image_url || null,
    publishedAt: r.published_at, fetchedAt: r.fetched_at,
    domain: r.domain, category: r.category,
    quality: r.quality_score,
    heat: r.quality_score != null ? Math.round(heatScore(r.quality_score, r.published_at || r.fetched_at, scoring, nowMs) * 10) / 10 : null,
    featured: !!r.featured,
    scores: r.scores_json ? JSON.parse(r.scores_json) : null,
    tags: r.tags_json ? JSON.parse(r.tags_json) : [],
    source: r.source_name, tier: r.tier,
    clusterId: r.cluster_id, clusterSize: r.cluster_size || null,
    analyzed: r.analyzed
  };
}

function queryFeed(q) {
  const scoring = loadScoring();
  const nowMs = Date.now();
  const view = q.get('view') || 'featured';      // featured | hot | all
  const domain = q.get('domain');                 // lowaltitude | aerospace
  const category = q.get('category');
  const search = (q.get('q') || '').trim();
  const page = Math.max(0, Number(q.get('page') || 0));
  const SIZE = 30;

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
    LIMIT ${SIZE * 3 + 1} OFFSET ${page * SIZE}`;
  let rows = db.prepare(sql).all(...params);

  let items = rows.map(r => articleRow(r, scoring, nowMs));
  // 精选/全部 = 时间线（按时间倒序）；热点 = 热度榜（质量分×时间衰减）
  if (view === 'hot') {
    items.sort((a, b) => (b.heat || 0) - (a.heat || 0));
  }
  const hasMore = items.length > SIZE;
  return { items: items.slice(0, SIZE), page, hasMore };
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
  const g = sql => db.prepare(sql).get();
  return {
    sources: g('SELECT COUNT(*) c FROM sources WHERE enabled=1').c,
    sourcesTotal: g('SELECT COUNT(*) c FROM sources').c,
    articles: g('SELECT COUNT(*) c FROM articles').c,
    today: g("SELECT COUNT(*) c FROM articles WHERE fetched_at > datetime('now','start of day')").c,
    relevantToday: g("SELECT COUNT(*) c FROM articles WHERE relevant=1 AND fetched_at > datetime('now','start of day')").c,
    featuredToday: g("SELECT COUNT(*) c FROM articles WHERE featured=1 AND fetched_at > datetime('now','start of day')").c,
    pending: g('SELECT COUNT(*) c FROM articles WHERE analyzed=0').c,
    pipeline: getStatus(),
    aiConfigured: !!loadSettings().ai.apiKey
  };
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const activePort = server.address()?.port || REQUESTED_PORT;
  const u = new URL(req.url, `http://127.0.0.1:${activePort}`);
  const p = u.pathname;
  try {
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
        const date = u.searchParams.get('date');
        return json(res, 200, { report: getDaily(date), dates: listDailyDates() });
      }
      if (p === '/api/daily/regenerate' && req.method === 'POST') {
        const body = await readJsonBody(req);
        return json(res, 200, generateDaily(body.date));
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
        if (!b.name || !b.url) return json(res, 400, { error: '需要 name 和 url' });
        const r = db.prepare(`INSERT INTO sources (name, type, url, tier, domain, enabled, selector_json, note)
          VALUES (?, ?, ?, ?, ?, 1, ?, ?)`).run(
          b.name, b.type || 'rss', b.url, b.tier || 'T2', b.domain || 'both',
          b.selector ? JSON.stringify(b.selector) : null, b.note || null);
        return json(res, 200, { id: r.lastInsertRowid });
      }
      const mSrc = p.match(/^\/api\/sources\/(\d+)$/);
      if (mSrc && req.method === 'PATCH') {
        const b = await readJsonBody(req);
        const cur = db.prepare('SELECT * FROM sources WHERE id=?').get(Number(mSrc[1]));
        if (!cur) return json(res, 404, { error: '不存在' });
        db.prepare(`UPDATE sources SET name=?, url=?, tier=?, domain=?, enabled=?, note=? WHERE id=?`)
          .run(b.name ?? cur.name, b.url ?? cur.url, b.tier ?? cur.tier, b.domain ?? cur.domain,
            b.enabled !== undefined ? (b.enabled ? 1 : 0) : cur.enabled, b.note ?? cur.note, cur.id);
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
        if (masked.ai.apiKey) masked.ai.apiKey = masked.ai.apiKey.slice(0, 6) + '****' + masked.ai.apiKey.slice(-4);
        masked.ai._hasKey = !!s.ai.apiKey;
        return json(res, 200, masked);
      }
      if (p === '/api/settings' && req.method === 'POST') {
        const b = await readJsonBody(req);
        const update = applySettingsPatch(loadSettings(), b);
        if (update.credentialChanged) await persistApiKey(update.apiKey);
        await saveSettings(update.settings);
        return json(res, 200, { ok: true });
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
        const b = await readJsonBody(req);
        db.prepare('INSERT INTO feedback (kind, content, created_at) VALUES (?, ?, ?)')
          .run(b.kind || 'feedback', String(b.content || '').slice(0, 2000), now());
        return json(res, 200, { ok: true });
      }

      return json(res, 404, { error: 'not found' });
    }

    // 静态文件
    let file = p === '/' ? '/index.html' : p;
    file = path.normalize(file).replace(/^([.][.][\\/])+/, '');
    const full = path.join(RENDERER_DIR, file);
    if (!full.startsWith(RENDERER_DIR) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.writeHead(404, RESPONSE_SECURITY_HEADERS); return res.end('not found');
    }
    res.writeHead(200, {
      ...RESPONSE_SECURITY_HEADERS,
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream'
    });
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    console.error('[http]', e);
    json(res, e instanceof HttpError ? e.statusCode : 500, { error: String(e.message || e) });
  }
});

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
