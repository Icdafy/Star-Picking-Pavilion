'use strict';
// 后端服务 —— 轻量 HTTP API + 静态文件，零框架依赖
// 以独立 Node 进程运行（Electron 主进程拉起，或 `npm run server` 后用浏览器打开）
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createCredentialIpcTracer } = require('../electron/credential-ipc-trace');
const { createServerShutdownLifecycle } = require('./shutdown-lifecycle');
const { db, now, closeDatabase, DATABASE_PATH, DATA_DIR } = require('./db');
const { applySettingsPatch, loadSettings, saveSettings, loadScoring } = require('./config');
const runtimeCredentials = require('./runtime-credentials');
const { seedSources } = require('./collectors');
const { describeHealth } = require('./source-health');
const { networkAccess } = require('./network-access');
const { validateChineseText } = require('./ai/translation');
const { countExpiring, getMaintenanceSnapshot, resolveRetentionPlan } = require('./retention');
const exportMarkdown = require('./export/markdown');
const { encodeWordDocument } = require('./export/word');
const reports = require('./ai/reports');
const { buildDailyBundle, serializeJsonl } = require('./archive/daily-bundle');
const {
  runPipeline, pruneOnce, compactOnce, startScheduler, stopScheduler, waitForSchedulerIdle, getStatus,
  refreshSchedulerSettings, subscribeStatus
} = require('./scheduler');
const {
  databaseStorageSnapshot,
  describeDatabaseMaintenanceError
} = require('./database-maintenance');
const { getDaily, generateDaily, listDailyDates } = require('./ai/daily');
const lexicon = require('./ai/lexicon');
const { VISIBLE_INDUSTRY_SQL } = require('./ai/relevance');
const { heatScore } = require('./ai/scoring');
const { discoverModels, testConnection } = require('./ai/deepseek');
const { createModelRoutes } = require('./model-routes');
const { CATEGORIES } = require('./ai/pipeline');
const { handleIntelRoute } = require('./intel-routes');
const { ingestItems } = require('./ingest');
const industry = require('./industry');
const {
  parseFeedQuery, parseExportQuery, sanitizeDate, sanitizeFeedback,
  sanitizeSourceInput, sanitizeStarInput
} = require('./input-validation');
const packageJson = require('../package.json');
const { createReleaseHistoryService } = require('./release-history');
const releaseHistory = createReleaseHistoryService({
  bundled: require('../config/release-history.json').items,
  version: packageJson.version,
  dataDir: DATA_DIR
});
const { resolveStaticFile } = require('./static-files');
const { articleSearch } = require('./article-search');
const { closeHttpServerGracefully } = require('./http-close');
const { localDateString, startOfLocalDayIso, clampPublishedAt } = require('./date-time');
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
  persistCredential: (value, provider = 'deepseek') => runtimeCredentials.persistProviderKey(provider, value),
  persistProviderCredential: (provider, value) => runtimeCredentials.persistProviderKey(provider, value),
  readProviderCredential: provider => runtimeCredentials.getProviderKey(provider),
  saveSettings,
  trace: traceCredentialIpc
});

const modelRoutes = createModelRoutes({
  loadSettings,
  coordinator: settingsUpdateCoordinator,
  credentials: runtimeCredentials,
  discoverModels,
  testConnection
});

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon'
};

function json(res, code, data) {
  res.writeHead(code, {
    ...RESPONSE_SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    // API 载荷含本地情报与配置快照，不应留在任何磁盘缓存里
    'Cache-Control': 'no-store'
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

// JSON 列的服务端钳制：渲染层的 esc()/数值收敛是第一道防线，这里是第二道。
// 老版本遗留数据或管线中途写入都可能让这些列出现脏值；出 API 前统一收口，
// 前端即使将来漏掉转义，拿到的也已经是形状与长度受控的数据。
function isJsonObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// v0.1.x 的五维（importance…timeliness）与 v0.2.0 的 AIHOT 五轴（significance…actionability）并存：
// 老资料保留当时的研判，新资料用新口径，出口按实际存在的键收口
const SCORE_KEYS = Object.freeze([
  'importance', 'novelty', 'credibility', 'impact', 'timeliness',
  'significance', 'resonance', 'actionability'
]);

function clampScores(value) {
  if (!isJsonObject(value)) return null;
  const clamped = {};
  for (const key of SCORE_KEYS) {
    const number = Number(value[key]);
    if (!Number.isFinite(number)) continue;
    clamped[key] = Math.round(Math.max(0, Math.min(100, number)) * 10) / 10;
  }
  return Object.keys(clamped).length ? clamped : null;
}

function boundedTextArray(value, maxLength, maxItems) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => typeof item === 'string' && item.trim())
    .map(item => item.trim().slice(0, maxLength))
    .slice(0, maxItems);
}

function clampEntities(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => isJsonObject(item) && typeof item.name === 'string' && item.name.trim())
    .map(item => ({
      name: item.name.trim().slice(0, 80),
      type: typeof item.type === 'string' ? item.type.trim().slice(0, 32) : ''
    }))
    .slice(0, 12);
}

function clampEvents(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => isJsonObject(item) && typeof item.actor === 'string' && item.actor.trim())
    .map(item => ({
      actor: item.actor.trim().slice(0, 80),
      action: typeof item.action === 'string' ? item.action.trim().slice(0, 80) : '',
      actionClass: typeof item.actionClass === 'string' ? item.actionClass.trim().slice(0, 40) : '',
      object: typeof item.object === 'string' ? item.object.trim().slice(0, 80) : '',
      date: typeof item.date === 'string' ? item.date.slice(0, 10) : null,
      status: typeof item.status === 'string' ? item.status.slice(0, 20) : 'unknown',
      evidence: typeof item.evidence === 'string' ? item.evidence.slice(0, 300) : ''
    }))
    .slice(0, 12);
}

function clampBreakthroughSignals(value) {
  if (!isJsonObject(value)) return null;
  const clamped = {};
  const objects = boundedTextArray(value.objects, 60, 8);
  const actions = boundedTextArray(value.actions, 60, 8);
  if (objects.length) clamped.objects = objects;
  if (actions.length) clamped.actions = actions;
  if (typeof value.credibilityEvidence === 'string' && value.credibilityEvidence.trim()) {
    clamped.credibilityEvidence = value.credibilityEvidence.trim().slice(0, 60);
  }
  return Object.keys(clamped).length ? clamped : null;
}

function clampSubjects(value) {
  return value
    .filter(item => isJsonObject(item) && typeof item.name === 'string' && item.name.trim())
    .map(item => ({
      id: typeof item.id === 'string' && /^[a-z0-9-]{2,48}$/.test(item.id) ? item.id : null,
      name: item.name.trim().slice(0, 40),
      role: item.role === 'primary' ? 'primary' : 'mention'
    }))
    .slice(0, 8);
}

function clampDeal(value) {
  if (!value || typeof value.company !== 'string' || !value.company.trim()) return null;
  return {
    company: value.company.trim().slice(0, 40),
    round: typeof value.round === 'string' ? value.round.slice(0, 20) : '未披露',
    amountText: typeof value.amountText === 'string' ? value.amountText.slice(0, 30) : '',
    investors: boundedTextArray(value.investors, 40, 10),
    leadInvestors: boundedTextArray(value.leadInvestors, 40, 5),
    status: ['completed', 'announced', 'rumored'].includes(value.status) ? value.status : 'announced'
  };
}

function articleRow(r, scoring, nowMs) {
  const translated = parseOptionalJson(r.translation_json, {}, isJsonObject);
  const waitingTranslation = r.translation_status === 'pending';
  const translatedTitle = translated.titleZh && !validateChineseText(r.title_zh, translated.names || [])
    ? translated.titleZh : r.title_zh;
  const translatedSummary = translated.summaryZh && !validateChineseText(r.ai_summary, translated.names || [])
    ? translated.summaryZh : r.ai_summary;
  const timing = require('./ai/event-time').timingFields(r);
  const vision = parseOptionalJson(r.vision_json, {}, isJsonObject);
  const rawQuality = Number(r.quality_score);
  const quality = Number.isFinite(rawQuality) ? Math.max(0, Math.min(100, rawQuality)) : null;
  const safeDate = value => value && Number.isFinite(new Date(value).getTime()) ? value : null;
  const fetchedAt = safeDate(r.fetched_at);
  const publishedAt = clampPublishedAt(safeDate(r.published_at), fetchedAt);
  const breakthroughScore = Math.max(0, Math.min(1,
    Number(r.breakthrough_score) || 0));
  const breakthroughBonus = Math.max(0, Number(r.breakthrough_bonus) || 0);
  return {
    id: r.id, title: r.title, url: r.url,
    summary: waitingTranslation ? '原文已保存，配置分析模型后自动翻译。' : translatedSummary || (r.summary_raw || '').slice(0, 120),
    reason: r.ai_reason || null,
    image: r.image_url || null,
    publishedAt, fetchedAt, ...timing,
    publicationPrecision: r.publication_precision || null,
    publicationDateText: r.publication_date_text || null,
    images: Array.isArray(vision.images) ? vision.images.filter(i => i && typeof i.url === 'string' && typeof i.caption === 'string').slice(0, 4).map(i => ({url: i.url.slice(0,8192), caption:i.caption.slice(0,150), kind:String(i.kind || '').slice(0,20), sourceUrl:String(i.sourceUrl || r.url).slice(0,8192)})) : [],
    visionStatus: vision.status || null,
    domain: r.domain, category: r.category,
    quality,
    heat: quality != null ? Math.round(heatScore(
      quality,
      timing.eventDate ? timing.eventDate + 'T00:00:00+08:00' : publishedAt,
      scoring,
      nowMs,
      { score: breakthroughScore, bonus: breakthroughBonus },
      fetchedAt
    ) * 10) / 10 : null,
    featured: !!r.featured,
    scores: clampScores(parseOptionalJson(r.scores_json, null, isJsonObject)),
    tags: boundedTextArray(parseOptionalJson(r.tags_json, [], Array.isArray), 100, 30),
    source: r.source_name, tier: r.tier,
    clusterId: r.cluster_id, clusterSize: r.cluster_size || null,
    breakthroughScore,
    breakthroughBonus,
    breakthroughSignals: clampBreakthroughSignals(parseOptionalJson(
      r.breakthrough_signals_json,
      null,
      isJsonObject
    )),
    scoringVersion: Number(r.scoring_version) || 1,
    // 结构化管线的产物：实体（标注/实体提取）与原子事件（事件分离）。
    // 老数据这几列是 NULL，解析后是空数组，前端按「没有就不渲染」处理。
    entities: clampEntities(parseOptionalJson(r.entities_json, [], Array.isArray)),
    topics: boundedTextArray(parseOptionalJson(r.topics_json, [], Array.isArray), 100, 30),
    events: clampEvents(parseOptionalJson(r.events_json, [], Array.isArray)),
    eventKey: r.event_key || null,
    // v0.2.0 AIHOT 内核的产物；老资料这些字段为 null / 空数组
    titleZh: waitingTranslation ? '海外新闻待翻译' : typeof translatedTitle === 'string' && translatedTitle.trim() ? translatedTitle.trim().slice(0, 200) : null,
    translationStatus: r.translation_status || null,
    itemType: r.item_type || null,
    itemTypeLabel: r.item_type ? industry.itemTypeById(r.item_type)?.label || null : null,
    authorRole: ['principal', 'observer', 'relayer'].includes(r.author_role) ? r.author_role : null,
    scorePasses: Number.isFinite(Number(r.score_a)) && Number.isFinite(Number(r.score_b)) && r.score_a != null && r.score_b != null
      ? [Math.round(Number(r.score_a)), Math.round(Number(r.score_b))] : null,
    threshold: Number.isFinite(Number(r.selection_threshold)) && r.selection_threshold != null ? Number(r.selection_threshold) : null,
    subjects: clampSubjects(parseOptionalJson(r.subjects_json, [], Array.isArray)),
    deal: clampDeal(parseOptionalJson(r.deal_json, null, isJsonObject)),
    historical: !!r.historical,
    storyRelation: r.story_relation || null,
    starred: !!r.starred,
    starredAt: safeDate(r.starred_at),
    analyzed: r.analyzed
  };
}

// 导出一次要覆盖整份收藏夹或整屏筛选结果，不能只给界面翻页用的 30 条
const FEED_PAGE_SIZE = 30;
const EXPORT_MAX_ITEMS = 200;

function queryFeed(q, { size = FEED_PAGE_SIZE, likeSearch = false } = {}) {
  const scoring = loadScoring();
  const nowMs = Date.now();
  const { view, domain, category, search, page, company } = parseFeedQuery(q, CATEGORIES);
  const SIZE = size;

  const where = [];
  const params = [];
  // 公司视角：以该公司为主体的资料（标题命中或模型认定的主体）；正文顺带提及的不算，
  // 否则一篇行业综述会出现在十几家公司的档案里
  if (company) {
    where.push("a.id IN (SELECT article_id FROM article_companies WHERE company_id = ? AND role = 'primary')");
    params.push(company);
  }
  if (view === 'featured') where.push('a.featured = 1');
  if (view === 'featured' || view === 'all') where.push(`(${VISIBLE_INDUSTRY_SQL})`);
  // 星标是用户的显式收藏，不受相关性判定影响：被 AI 判为无关但用户仍想留着的条目必须能看到
  if (view === 'starred') where.push('a.starred = 1');
  if (view !== 'starred') where.push("COALESCE(a.translation_status, '') <> 'pending'");
  if (domain) { where.push('(a.domain = ? OR a.domain = \'both\')'); params.push(domain); }
  if (category) { where.push('a.category = ?'); params.push(category); }

  const filter = articleSearch(search, { like: likeSearch });
  where.push(`(${filter.sql})`);
  params.push(...filter.params);

  // 事件簇折叠：簇内只返回主条。星标视图例外——用户收藏的是某一条具体报道，
  // 若它恰好不是簇主条，折叠会让它从自己的收藏夹里消失。
  const collapseClusters = view !== 'starred';
  const buildSql = (order, extraWhere) => `
    SELECT a.*, s.name AS source_name, s.tier, c.size AS cluster_size
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    LEFT JOIN clusters c ON c.id = a.cluster_id
    WHERE ${where.join(' AND ') || '1=1'} ${extraWhere}
      ${collapseClusters ? 'AND (a.cluster_id IS NULL OR a.id = c.main_article_id)' : ''}
    ORDER BY ${order}
    LIMIT ${SIZE + 1} OFFSET ${page * SIZE}`;

  let rows;
  try {
    if (view === 'starred') {
      // 按收藏时间倒序：用户的心智是「我最近收了什么」，不是「它什么时候发表」
      rows = db.prepare(buildSql('COALESCE(a.starred_at, a.fetched_at) DESC, a.id DESC', '')).all(...params);
    } else {
      rows = db.prepare(buildSql('julianday(COALESCE(a.published_at, a.fetched_at)) DESC, a.id DESC', '')).all(...params);
    }
  } catch (error) {
    if (search && !likeSearch && [...search].length >= 3 && /fts5|MATCH|syntax error/i.test(error.message)) {
      return queryFeed(q, { size, likeSearch: true });
    }
    throw error;
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
    sources: g('SELECT COUNT(*) c FROM sources WHERE enabled=1 AND removed_at IS NULL').c,
    sourcesTotal: g('SELECT COUNT(*) c FROM sources WHERE removed_at IS NULL').c,
    articles: g('SELECT COUNT(*) c FROM articles').c,
    today: g('SELECT COUNT(*) c FROM articles WHERE fetched_at >= ?', todayStart).c,
    relevantToday: g(`SELECT COUNT(*) c FROM articles a WHERE (${VISIBLE_INDUSTRY_SQL}) AND a.fetched_at >= ?`, todayStart).c,
    featuredToday: g(`SELECT COUNT(*) c FROM articles a WHERE (${VISIBLE_INDUSTRY_SQL}) AND a.featured=1 AND a.fetched_at >= ?`, todayStart).c,
    starred: g('SELECT COUNT(*) c FROM articles WHERE starred=1').c,
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

// ---------- 词库检索面板 ----------
// 光有一份词表没用——用户要的是「这个词在我已经捕到的情报里有多少条」，
// 0 条的词不值得点，40 条的词值得先看。所以这里把词库和本地库的命中数一起返回。
//
// 这个数字必须等于点下去真的能看到的卡片数，否则它就是在骗人：
// 面板写 45、点进去只有 1 条，用户下一次就不会再信这个数了。
// 因此计数完整复刻「全部动态」视图的口径——同一套检索路径（FTS5 trigram，
// 短词降级 LIKE）、同一条相关性过滤、同一次事件簇折叠，只是不分页。
// 前端选词后也固定切到「全部动态」，两边对齐。
const LEXICON_COUNT_TTL_MS = 60_000;
let lexiconCache = null;

function countVisible(surface, like = false) {
  const filter = articleSearch(surface, { like });
  // 与「全部动态」同口径：只统计行业判断完成的资料，事件簇只算主条
  try { return db.prepare(`
    SELECT COUNT(*) c FROM articles a
    LEFT JOIN clusters c ON c.id = a.cluster_id
    WHERE (${filter.sql})
      AND (${VISIBLE_INDUSTRY_SQL})
      AND COALESCE(a.translation_status, '') <> 'pending'
      AND (a.cluster_id IS NULL OR a.id = c.main_article_id)`).get(...filter.params).c;
  } catch (error) {
    if (!like && [...surface].length >= 3 && /fts5|MATCH|syntax error/i.test(error.message)) return countVisible(surface, true);
    throw error;
  }
}

// 逐个匹配面单独计数，挑出结果最多的那一个作为这个词的检索式。
//
// 不能把各匹配面的命中并起来报数：检索接口一次只吃一个字符串，
// 「亿航智能」并上别名「亿航」是 13 条，可点下去只搜规范词就只剩 9 条。
// 反过来只数规范词又会漏掉那些通篇写「亿航」的报道。
// 取命中最多的那个面，数字与点击结果就永远是同一个东西，而且是能拿到的最大召回。
function resolveTermQuery(surfaces) {
  let best = { query: surfaces[0], count: -1 };
  for (const surface of surfaces) {
    const count = countVisible(surface);
    if (count > best.count) best = { query: surface, count };
  }
  return { query: best.query, count: Math.max(0, best.count) };
}

function buildLexiconPanel() {
  const { groups, version } = lexicon.loadLexicon();
  let total = 0;
  const payload = groups.map(group => ({
    id: group.id,
    label: group.label,
    domain: group.domain,
    terms: group.terms.map(term => {
      const { query, count } = resolveTermQuery(term.surfaces);
      total += count ? 1 : 0;
      return { term: term.term, aliases: term.aliases, weight: term.weight, count, query };
    })
  }));
  return {
    version,
    groups: payload,
    termCount: payload.reduce((sum, group) => sum + group.terms.length, 0),
    matchedTermCount: total
  };
}

function getLexiconPanel(nowMs = Date.now()) {
  if (!lexiconCache || nowMs - lexiconCache.at >= LEXICON_COUNT_TTL_MS) {
    lexiconCache = { at: nowMs, value: buildLexiconPanel() };
  }
  return lexiconCache.value;
}

// ---------- 路由 ----------
const activityStreams = new Set();
const server = http.createServer(async (req, res) => {
  try {
    const activePort = server.address()?.port || REQUESTED_PORT;
    const u = new URL(req.url, `http://127.0.0.1:${activePort}`);
    const p = u.pathname;
    if (p.startsWith('/api/')) {
      const permitted = authorize({
        host: req.headers.host,
        origin: req.headers.origin,
        token: req.headers[API_TOKEN_HEADER],
        method: req.method
      }, { port: activePort, expectedToken: API_TOKEN });
      if (!permitted) return json(res, 403, { error: 'forbidden' });

      if (p === '/api/ingest/items' && req.method === 'POST') {
        const result = ingestItems(await readJsonBody(req));
        invalidateStatsCache();
        return json(res, 200, result);
      }

      if (p === '/api/version' && req.method === 'GET') return json(res, 200, { version: packageJson.version });
      if (p === '/api/releases' && req.method === 'GET') {
        const history = u.searchParams.get('sync') === '1'
          ? await releaseHistory.sync() : releaseHistory.snapshot();
        return json(res, 200, history);
      }
      if (p === '/api/feed' && req.method === 'GET') return json(res, 200, queryFeed(u.searchParams));
      if (p === '/api/stats' && req.method === 'GET') return json(res, 200, getStats());
      if (p === '/api/activity' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        activityStreams.add(res);
        const unsubscribe = subscribeStatus(status => {
          if (!res.destroyed) res.write(`data: ${JSON.stringify(status)}\n\n`);
        });
        res.once('close', () => { unsubscribe(); activityStreams.delete(res); });
        return;
      }
      if (p === '/api/categories') return json(res, 200, CATEGORIES);
      // 核心词库 + 每个词在本地情报库中的命中条数（检索面板用）
      if (p === '/api/lexicon' && req.method === 'GET') return json(res, 200, getLexiconPanel());

      const mCluster = p.match(/^\/api\/cluster\/(\d+)$/);
      if (mCluster) return json(res, 200, getCluster(Number(mCluster[1])));

      // 星标：用户显式留存。starred_at 同时是收藏夹的排序键与保留清理的豁免标记
      const mStar = p.match(/^\/api\/articles\/(\d+)\/star$/);
      if (mStar && req.method === 'POST') {
        const articleId = Number(mStar[1]);
        const { starred } = sanitizeStarInput(await readJsonBody(req));
        const changed = db.prepare('UPDATE articles SET starred=?, starred_at=? WHERE id=?')
          .run(starred ? 1 : 0, starred ? now() : null, articleId).changes;
        if (!changed) return json(res, 404, { error: '情报不存在' });
        invalidateStatsCache();
        const row = db.prepare('SELECT starred, starred_at FROM articles WHERE id=?').get(articleId);
        return json(res, 200, { ok: true, starred: !!row.starred, starredAt: row.starred_at });
      }

      if (p === '/api/daily' && req.method === 'GET') {
        const date = sanitizeDate(u.searchParams.get('date'));
        return json(res, 200, { report: getDaily(date), dates: listDailyDates() });
      }
      if (p === '/api/daily/archive' && req.method === 'GET') {
        const date = sanitizeDate(u.searchParams.get('date')) || localDateString();
        const bundle = buildDailyBundle({
          database: db,
          date,
          scoring: loadScoring()
        });
        const branding = {
          productName: packageJson.productName,
          version: packageJson.version,
          homepage: packageJson.homepage
        };
        return json(res, 200, {
          date,
          markdown: exportMarkdown.renderDailyArchive(bundle, branding),
          jsonl: serializeJsonl(bundle.records),
          manifest: {
            schemaVersion: bundle.schemaVersion,
            productVersion: packageJson.version,
            generatedAt: bundle.generatedAt,
            window: bundle.window,
            // 窗口内记录触顶 20000 条硬上限时为 true，消费方据此判断归档不完整
            truncated: bundle.truncated,
            summary: bundle.summary
          }
        });
      }
      if (p === '/api/daily/regenerate' && req.method === 'POST') {
        const body = await readJsonBody(req);
        // regenerate 是用户的显式覆写意思表示；默认路径（overwrite=false）不会碰已有有效/损坏行
        return json(res, 200, generateDaily(sanitizeDate(body.date), { overwrite: true }));
      }

      // 导出：情报的最后一公里。渲染在服务端完成，界面只负责复制到剪贴板或存成文件，
      // 这样两种格式的排版逻辑只有一份，且可以在 Node 里逐字符断言。
      if (p === '/api/export' && req.method === 'GET') {
        const request = parseExportQuery(u.searchParams, CATEGORIES);
        const branding = {
          format: request.format,
          productName: packageJson.productName,
          version: packageJson.version,
          homepage: packageJson.homepage
        };
        if (request.kind !== 'feed') {
          let report;
          try {
            report = request.kind === 'daily' ? getDaily(request.date) : reports.generatePeriod(request.kind, request.key);
          } catch (error) {
            if (error?.status === 400) throw new HttpError(400, error.message);
            throw error;
          }
          const label = { daily: '日报', weekly: '周报', monthly: '月报' }[request.kind];
          const content = exportMarkdown.renderDaily(report, branding);
          return json(res, 200, {
            filename: exportMarkdown.exportFilename(
              `${packageJson.productName}-情报${label}`, report.date || report.key, request.format),
            count: report.total ?? report.totals.featured,
            format: request.format,
            ...(request.format === 'doc' ? { encoding: 'base64', mimeType: 'application/msword' } : {}),
            content: request.format === 'doc' ? encodeWordDocument(content).toString('base64') : content
          });
        }
        const { view, search } = request.feed;
        const titles = { featured: '精选情报', all: '全部动态', starred: '星标情报' };
        // 导出始终从第一条开始，与用户当前翻到第几页无关
        const exportQuery = new URLSearchParams(u.searchParams);
        exportQuery.set('page', '0');
        const items = queryFeed(exportQuery, { size: EXPORT_MAX_ITEMS }).items;
        return json(res, 200, {
          filename: exportMarkdown.exportFilename(
            `${packageJson.productName}-${titles[view]}`, localDateString(), request.format),
          count: items.length,
          format: request.format,
          content: exportMarkdown.renderArticles(items, {
            ...branding,
            title: titles[view],
            subtitle: search ? `检索「${search}」` : ''
          })
        });
      }

      if (p === '/api/collect' && req.method === 'POST') {
        if (getStatus().schedulerStopping) return json(res, 503, { error: '服务正在退出' });
        if (getStatus().compactRunning) return json(res, 409, { error: '数据库正在压缩，请稍后采集' });
        if (getStatus().pipelineRunning) return json(res, 202, { started: false, running: true });
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
        const database = databaseStorageSnapshot({ database: db, databasePath: DATABASE_PATH });
        const schedulerStatus = getStatus();
        return json(res, 200, {
          databaseBytes: database.fileBytes,
          database,
          articles: db.prepare('SELECT COUNT(*) c FROM articles').get().c,
          irrelevant: db.prepare('SELECT COUNT(*) c FROM articles WHERE relevant=0').get().c,
          starred: db.prepare('SELECT COUNT(*) c FROM articles WHERE starred=1').get().c,
          // 与 pruneDatabase 共用同一条 WHERE，「待清理」永远不会把星标算进去
          expiring: countExpiring(plan),
          retentionDays: plan.retentionDays,
          irrelevantRetentionDays: plan.irrelevantRetentionDays,
          // prune 已改为 202 异步契约：前端靠这个布尔判断后台清理是否结束，
          // 结束前轮询到的数字都是清理前旧值，不得拿去刷新界面
          pruneRunning: schedulerStatus.pruneRunning,
          ...getMaintenanceSnapshot(),
          scheduler: schedulerStatus
        });
      }
      if (p === '/api/maintenance/prune' && req.method === 'POST') {
        // 大清理可能持续很久：触发后立即 202 返回，后台异步执行，
        // HTTP 请求不再同步阻塞在删除循环上
        setImmediate(() => {
          try {
            const result = pruneOnce('manual');
            if (result && !result.skipped) invalidateStatsCache();
          } catch (error) {
            console.error('[maintenance:prune]', error);
          }
        });
        return json(res, 202, { ok: true, started: true });
      }
      if (p === '/api/maintenance/compact' && req.method === 'POST') {
        try {
          const result = compactOnce('manual', { mode: 'manual' });
          return json(res, 200, { ok: !result.skipped, ...result });
        } catch (error) {
          console.error('[maintenance:compact]', error);
          const failure = describeDatabaseMaintenanceError(error);
          return json(res, failure.statusCode, failure.body);
        }
      }

      if (p === '/api/sources/network' && req.method === 'GET') {
        return json(res, 200, { ...networkAccess.snapshot(), translationReady: Boolean(loadSettings().ai.apiKey) });
      }
      if (p === '/api/sources/network' && req.method === 'POST') {
        return json(res, 200, { ...await networkAccess.detect({ force: true }), translationReady: Boolean(loadSettings().ai.apiKey) });
      }
      if (p === '/api/sources' && req.method === 'GET') {
        const nowMs = Date.now();
        return json(res, 200, db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM articles a WHERE a.source_id=s.id
          AND a.translation_status='pending') AS pending_translations FROM sources s WHERE s.removed_at IS NULL ORDER BY s.tier, s.id`).all()
          .map(source => ({ ...source, health: describeHealth(source, nowMs, networkAccess.snapshot()) })));
      }
      if (p === '/api/sources' && req.method === 'POST') {
        const b = await readJsonBody(req);
        const source = sanitizeSourceInput(b);
        const removed = db.prepare('SELECT id FROM sources WHERE url=? AND removed_at IS NOT NULL').get(source.url);
        if (removed) {
          db.prepare(`UPDATE sources SET name=?, type=?, tier=?, domain=?, enabled=?, selector_json=?, note=?, intl=?,
            removed_at=NULL, consecutive_errors=0, next_fetch_at=NULL, last_status=NULL WHERE id=?`)
            .run(source.name, source.type, source.tier, source.domain, source.enabled ? 1 : 0,
              source.selector ? JSON.stringify(source.selector) : null, source.note, source.intl ? 1 : 0, removed.id);
          invalidateStatsCache();
          return json(res, 200, { id: removed.id });
        }
        const r = db.prepare(`INSERT INTO sources (name, type, url, tier, domain, enabled, selector_json, note, intl)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          source.name, source.type, source.url, source.tier, source.domain,
          source.enabled ? 1 : 0, source.selector ? JSON.stringify(source.selector) : null, source.note, source.intl ? 1 : 0);
        invalidateStatsCache();
        return json(res, 200, { id: r.lastInsertRowid });
      }
      const mSrc = p.match(/^\/api\/sources\/(\d+)$/);
      if (mSrc && req.method === 'PATCH') {
        const b = await readJsonBody(req);
        const cur = db.prepare('SELECT * FROM sources WHERE id=? AND removed_at IS NULL').get(Number(mSrc[1]));
        if (!cur) return json(res, 404, { error: '不存在' });
        const source = sanitizeSourceInput(b, cur);
        db.prepare(`UPDATE sources SET name=?, type=?, url=?, tier=?, domain=?, enabled=?, selector_json=?, note=?, intl=? WHERE id=?`)
          .run(source.name, source.type, source.url, source.tier, source.domain,
            source.enabled ? 1 : 0, source.selector ? JSON.stringify(source.selector) : null, source.note, source.intl ? 1 : 0, cur.id);
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
          'UPDATE sources SET consecutive_errors=0, next_fetch_at=NULL WHERE id=? AND removed_at IS NULL').run(sourceId).changes;
        if (!changed) return json(res, 404, { error: '信源不存在' });
        return json(res, 200, { ok: true });
      }
      if (mSrc && req.method === 'DELETE') {
        const sourceId = Number(mSrc[1]);
        const { removeSource } = require('./source-lifecycle');
        if (!removeSource(sourceId)) return json(res, 404, { error: '信源不存在' });
        invalidateStatsCache();
        return json(res, 200, { ok: true, removed: true });
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
        refreshSchedulerSettings();
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

      // 反馈此前只写不读：提交完连自己都看不到，等于写进黑洞。
      // 数据本来就在本机库里，列出来它才是一本可用的情报备忘。
      if (p === '/api/feedback' && req.method === 'GET') {
        return json(res, 200, db.prepare(
          'SELECT id, kind, content, created_at FROM feedback ORDER BY id DESC LIMIT 50').all()
          .map(row => ({ id: row.id, kind: row.kind, content: row.content, createdAt: row.created_at })));
      }
      if (p === '/api/feedback' && req.method === 'POST') {
        const b = sanitizeFeedback(await readJsonBody(req));
        const r = db.prepare('INSERT INTO feedback (kind, content, created_at) VALUES (?, ?, ?)')
          .run(b.kind, b.content, now());
        return json(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
      }
      const mFeedback = p.match(/^\/api\/feedback\/(\d+)$/);
      if (mFeedback && req.method === 'DELETE') {
        const changed = db.prepare('DELETE FROM feedback WHERE id=?').run(Number(mFeedback[1])).changes;
        if (!changed) return json(res, 404, { error: '反馈不存在' });
        return json(res, 200, { ok: true });
      }

      if (await modelRoutes.handle({ req, res, pathname: p, json, readJsonBody })) return;

      if (await handleIntelRoute({ req, res, url: u, json, readJsonBody, queryFeed })) {
        if (req.method !== 'GET') invalidateStatsCache();
        return;
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
  for (const response of activityStreams) response.end();
  activityStreams.clear();
  releaseHistory.dispose();
  return closeHttpServerGracefully(server);
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
require('./ai/relevance-migration').repairIndustryScope();
require('./ai/capital-migration').migrateCapital();
// 启动时：补转载文章的真实出版方（一次性），再按纯规则合并同一事件的重复条目（不调模型），有变化则重算热榜
setImmediate(() => {
  let publishers = { skipped: true };
  try { publishers = require('./ai/publisher-backfill').backfillPublishers(); }
  catch (error) { console.warn('[hot] 出版方回填失败:', error.message); }
  require('./ai/stories').consolidateStories({})
    .then(result => { if (result.merged || (!publishers.skipped && !publishers.unchanged)) require('./ai/hot').computeHotRanking(); })
    .catch(error => console.warn('[stories] 启动合并失败:', error.message));
});
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
