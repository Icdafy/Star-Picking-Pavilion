'use strict';
// 后端服务 —— 轻量 HTTP API + 静态文件，零框架依赖
// 以独立 Node 进程运行（Electron 主进程拉起，或 `npm run server` 后用浏览器打开）
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createCredentialIpcTracer } = require('../electron/credential-ipc-trace');
const { createServerShutdownLifecycle } = require('./shutdown-lifecycle');
const { db, now, closeDatabase, databaseFileBytes } = require('./db');
const { applySettingsPatch, loadSettings, saveSettings, loadScoring } = require('./config');
const { persistApiKey } = require('./runtime-credentials');
const { seedSources } = require('./collectors');
const { describeHealth } = require('./source-health');
const { getMaintenanceSnapshot, resolveRetentionPlan } = require('./retention');
const {
  runPipeline, pruneOnce, startScheduler, stopScheduler, waitForSchedulerIdle, getStatus
} = require('./scheduler');
const { getDaily, generateDaily, listDailyDates } = require('./ai/daily');
const { heatScore } = require('./ai/scoring');
const { testConnection } = require('./ai/deepseek');
const { CATEGORIES } = require('./ai/pipeline');
const { parseFeedQuery, sanitizeDate, sanitizeFeedback, sanitizeSourceInput } = require('./input-validation');
const { resolveStaticFile } = require('./static-files');
const { startOfLocalDayIso } = require('./date-time');
const { createSettingsUpdateCoordinator } = require('./settings-persistence');
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
const traceCredentialIpc = createCredentialIpcTracer({
  enabled: Boolean(process.env.STAR_PICKING_PAVILION_TEST_DATA_DIR)
});
const settingsUpdateCoordinator = createSettingsUpdateCoordinator({
  loadSettings,
  applySettingsPatch,
  persistCredential: persistApiKey,
  saveSettings,
  trace: traceCredentialIpc
});

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

// LIKE 里的通配符必须转义，否则用户检索 "100%" 之类会被当成模式匹配
function escapeLikePattern(value) {
  return value.replace(/[\\%_]/g, character => `\\${character}`);
}

// 热度 = 质量分 × 指数时间衰减。与 scoring.heatScore 同式，放进 SQL 才能只取需要的一页，
// 否则每次请求都要把上千行读进内存再在 JS 里排序（实时轮询每 18 秒会请求两次）。
const HEAT_EXPRESSION = `COALESCE(a.quality_score, 0) * pow(
  0.5,
  max(0.0, (julianday('now') - julianday(COALESCE(a.published_at, a.fetched_at))) * 24.0) / ?
)`;
// 半衰期 36 小时下，超出此窗口的条目热度已衰减到千分之一以下，排进热榜没有意义
const HOT_WINDOW_DAYS = 45;

function queryFeed(q) {
  const scoring = loadScoring();
  const nowMs = Date.now();
  const { view, domain, category, search, page } = parseFeedQuery(q, CATEGORIES);
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
      const pattern = `%${escapeLikePattern(search)}%`;
      ids = db.prepare(`SELECT id FROM articles
        WHERE title LIKE ? ESCAPE '\\' OR ai_summary LIKE ? ESCAPE '\\' LIMIT 500`)
        .all(pattern, pattern).map(r => r.id);
    }
    if (!ids.length) return { items: [], page, hasMore: false };
    idFilter = `AND a.id IN (${ids.join(',')})`;
  }

  // 事件簇折叠：簇内只返回主条
  const buildSql = (order, extraWhere) => `
    SELECT a.*, s.name AS source_name, s.tier, c.size AS cluster_size
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    LEFT JOIN clusters c ON c.id = a.cluster_id
    WHERE ${where.join(' AND ') || '1=1'} ${idFilter} ${extraWhere}
      AND (a.cluster_id IS NULL OR a.id = c.main_article_id)
    ORDER BY ${order}
    LIMIT ${SIZE + 1} OFFSET ${page * SIZE}`;

  let rows;
  if (view === 'hot') {
    const halfLife = Number(scoring.heatDecayHalfLifeHours) || 36;
    const windowStart = new Date(nowMs - HOT_WINDOW_DAYS * 86_400_000).toISOString();
    // 占位符按 SQL 文本位置绑定：先 WHERE 的过滤条件，再时间窗，最后 ORDER BY 里的半衰期
    rows = db.prepare(buildSql(`${HEAT_EXPRESSION} DESC`,
      'AND COALESCE(a.published_at, a.fetched_at) >= ?'))
      .all(...params, windowStart, halfLife);
    // 窗口内已经取空时退回不限时间的热度榜：既覆盖长期未采集的库，也让「加载更多」能翻到更早的内容。
    // 热度排序是全局的，因此续翻的偏移量与窗口版一致，不会重复或跳条。
    if (!rows.length) {
      rows = db.prepare(buildSql(`${HEAT_EXPRESSION} DESC`, '')).all(...params, halfLife);
    }
  } else {
    rows = db.prepare(buildSql('COALESCE(a.published_at, a.fetched_at) DESC', '')).all(...params);
  }

  const items = rows.map(r => articleRow(r, scoring, nowMs));
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

function countStats() {
  const g = (sql, ...params) => db.prepare(sql).get(...params);
  const todayStart = startOfLocalDayIso();
  return {
    sources: g('SELECT COUNT(*) c FROM sources WHERE enabled=1').c,
    sourcesTotal: g('SELECT COUNT(*) c FROM sources').c,
    articles: g('SELECT COUNT(*) c FROM articles').c,
    today: g('SELECT COUNT(*) c FROM articles WHERE fetched_at >= ?', todayStart).c,
    relevantToday: g('SELECT COUNT(*) c FROM articles WHERE relevant=1 AND fetched_at >= ?', todayStart).c,
    featuredToday: g('SELECT COUNT(*) c FROM articles WHERE featured=1 AND fetched_at >= ?', todayStart).c,
    pending: g('SELECT COUNT(*) c FROM articles WHERE analyzed=0').c
  };
}

// 界面每 18 秒轮询一次 /api/stats，这些计数都是全表聚合；短 TTL 缓存足以让面板保持“实时”，
// 又不至于在库变大后每轮都重扫。管线状态与 AI 配置本身很便宜，始终取最新值。
const STATS_CACHE_TTL_MS = 5_000;
let statsCache = null;

function getStats(nowMs = Date.now()) {
  if (!statsCache || nowMs - statsCache.at >= STATS_CACHE_TTL_MS) {
    statsCache = { at: nowMs, counts: countStats() };
  }
  return {
    ...statsCache.counts,
    pipeline: getStatus(),
    aiConfigured: !!loadSettings().ai.apiKey
  };
}

function invalidateStatsCache() {
  statsCache = null;
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
        invalidateStatsCache();
        runPipeline('manual').catch(e => console.error(e));
        return json(res, 202, { started: true });
      }

      // 数据维护：让用户看得到本地库的真实体积，并能手动触发一次保留清理
      if (p === '/api/maintenance' && req.method === 'GET') {
        const settings = loadSettings();
        const plan = resolveRetentionPlan({
          retentionDays: settings.collect.retentionDays,
          irrelevantRetentionDays: settings.collect.irrelevantRetentionDays
        });
        return json(res, 200, {
          databaseBytes: databaseFileBytes(),
          articles: db.prepare('SELECT COUNT(*) c FROM articles').get().c,
          irrelevant: db.prepare('SELECT COUNT(*) c FROM articles WHERE relevant=0').get().c,
          expiring: db.prepare(`SELECT COUNT(*) c FROM articles
            WHERE fetched_at < ? OR (relevant = 0 AND fetched_at < ?)`)
            .get(plan.articleCutoff, plan.irrelevantCutoff).c,
          retentionDays: plan.retentionDays,
          irrelevantRetentionDays: plan.irrelevantRetentionDays,
          ...getMaintenanceSnapshot()
        });
      }
      if (p === '/api/maintenance/prune' && req.method === 'POST') {
        const result = pruneOnce('manual');
        invalidateStatsCache();
        return json(res, 200, { ok: true, ...result, databaseBytes: databaseFileBytes() });
      }

      if (p === '/api/sources' && req.method === 'GET') {
        const nowMs = Date.now();
        return json(res, 200, db.prepare('SELECT * FROM sources ORDER BY tier, id').all()
          .map(source => ({ ...source, health: describeHealth(source, nowMs) })));
      }
      if (p === '/api/sources' && req.method === 'POST') {
        const b = await readJsonBody(req);
        const source = sanitizeSourceInput(b);
        const r = db.prepare(`INSERT INTO sources (name, type, url, tier, domain, enabled, selector_json, note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          source.name, source.type, source.url, source.tier, source.domain,
          source.enabled ? 1 : 0, source.selector ? JSON.stringify(source.selector) : null, source.note);
        invalidateStatsCache();
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
        // 用户重新启用或改了地址，视为「我已处理」，清掉退避让它下一轮立刻重试
        if (source.enabled !== Boolean(cur.enabled) || source.url !== cur.url) {
          db.prepare('UPDATE sources SET consecutive_errors=0, next_fetch_at=NULL WHERE id=?').run(cur.id);
        }
        invalidateStatsCache();
        return json(res, 200, { ok: true });
      }
      const mSrcRetry = p.match(/^\/api\/sources\/(\d+)\/retry$/);
      if (mSrcRetry && req.method === 'POST') {
        const sourceId = Number(mSrcRetry[1]);
        const changed = db.prepare(
          'UPDATE sources SET consecutive_errors=0, next_fetch_at=NULL WHERE id=?').run(sourceId).changes;
        if (!changed) return json(res, 404, { error: '信源不存在' });
        return json(res, 200, { ok: true });
      }
      if (mSrc && req.method === 'DELETE') {
        const sourceId = Number(mSrc[1]);
        const existing = db.prepare('SELECT id FROM sources WHERE id=?').get(sourceId);
        if (!existing) return json(res, 404, { error: '信源不存在' });
        db.prepare('UPDATE sources SET enabled=0 WHERE id=?').run(sourceId);
        invalidateStatsCache();
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
        traceCredentialIpc('settings-request-received');
        const b = await readJsonBody(req);
        traceCredentialIpc('settings-body-read');
        const update = await settingsUpdateCoordinator.submit(b);
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

function closeHttpServer() {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeIdleConnections?.();
  });
}

function notifyStoppedAndExit(stopped) {
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

const shutdownLifecycle = createServerShutdownLifecycle({
  stopScheduler,
  closeHttpServer,
  waitForSchedulerIdle,
  closeDatabase,
  notifyStoppedAndExit,
  onError: error => {
    console.error('[server] 关闭失败:', error);
    process.exit(1);
  }
});

const shutdownServer = shutdownLifecycle.shutdown;
const handleControlMessage = shutdownLifecycle.handleControlMessage;

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
