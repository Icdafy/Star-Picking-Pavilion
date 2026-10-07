'use strict';
// 信源采集层 —— 可插拔适配器：rss | bing(必应资讯RSS) | html(网页爬虫)
// 后续扩展：RSSHub、公开API、三方数据平台，只需新增一个适配器文件
const fs = require('node:fs');
const path = require('node:path');
const { db, now, insertArticle, withTransaction } = require('../db');
const { loadSettings } = require('../config');
const { collectionIntervalMs } = require('../schedule-policy');
const { isDue, nextFetchAtIso } = require('../source-health');
const { removeDisabledSources } = require('../source-lifecycle');
const { structureItem } = require('../ai/normalize');
const { settleAll } = require('../async-work');
const { networkAccess } = require('../network-access');
const { needsChinese } = require('../ai/translation');
const { dateFromUrl } = require('./loose-date');
const { enrichArticle } = require('./article-content');
const { publicationUpperBound } = require('./publication-date');
const { needsPublicationCheck, savePublicationTime, repairPublicationTimes } = require('../publication-time');
const rssAdapter = require('./rss');
const htmlAdapter = require('./html');
const apiAdapter = require('./api');

const ADAPTERS = {
  wechat: require('./wechat'),
  rss: rssAdapter,
  bing: rssAdapter, // 必应资讯本质也是 RSS，复用解析器（注：大陆网络环境下必应常返回空结果）
  html: htmlAdapter,
  api: apiAdapter   // 公开 JSON API（东方财富关键词搜索等）
};

// 信源迁移 —— 改地址、修选择器、清退死源。
// 必须在 INSERT OR IGNORE 补新源之前跑：种子库里写的已经是新地址，
// 先补源的话新地址会被插成第二条，老的那条继续每轮空转，用户看到的是一堆重复与红叉。
// 每一步都幂等，可以反复执行。
function applySourceMigrations(migrations) {
  if (!Array.isArray(migrations) || !migrations.length) return 0;
  const findByUrl = db.prepare('SELECT * FROM sources WHERE url = ?');
  let applied = 0;

  for (const step of migrations) {
    const current = findByUrl.get(step.from);
    if (!current || current.removed_at) continue;   // 用户已删或本来就没有，不复活

    if (step.retire) {
      if (!current.enabled && !step.remove) continue;
      db.prepare(`UPDATE sources SET enabled=0, note=?, consecutive_errors=0, next_fetch_at=NULL,
        removed_at=CASE WHEN ? THEN ? ELSE removed_at END WHERE id=?`)
        .run(step.note || current.note, step.remove ? 1 : 0, now(), current.id);
      applied++;
      continue;
    }

    if (step.repairUrlDates) {
      const updateDate = db.prepare('UPDATE articles SET published_at=? WHERE id=? AND published_at IS NULL');
      for (const article of db.prepare('SELECT id,url FROM articles WHERE source_id=? AND published_at IS NULL').all(current.id)) {
        const date = dateFromUrl(article.url);
        if (date) updateDate.run(date, article.id);
      }
    }

    // 目标地址已经有独立的一行了（用户手工加过，或上一次迁移只跑了一半）：
    // 不能撞 url 唯一约束，把老的那条停掉即可。
    if (step.to && step.to !== step.from && findByUrl.get(step.to)) {
      if (current.enabled) {
        db.prepare('UPDATE sources SET enabled=0 WHERE id=?').run(current.id);
        applied++;
      }
      continue;
    }

    db.prepare(`UPDATE sources SET url=?, name=?, tier=?, selector_json=?, note=?, type=?, intl=?,
        consecutive_errors=0, next_fetch_at=NULL, last_status=NULL WHERE id=?`)
      .run(
        step.to || current.url,
        step.name || current.name,
        step.tier || current.tier,
        step.selector ? JSON.stringify(step.selector) : current.selector_json,
        step.note || current.note,
        step.type || current.type,
        typeof step.intl === 'boolean' ? (step.intl ? 1 : 0) : current.intl,
        current.id
      );
    applied++;
  }
  return applied;
}

// 首次启动导入种子信源；之后按 seed 文件 _version 幂等增量补充新源
// （url 唯一，INSERT OR IGNORE 不覆盖用户改动；同一版本只补一次，不复活用户已删项）
function seedSources() {
  const seedPath = path.join(__dirname, '..', '..', 'config', 'sources.default.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const seedVersion = Number(seed._version || 1);
  const appliedRow = db.prepare("SELECT value FROM meta WHERE key='seedVersion'").get();
  const applied = Number(appliedRow?.value || 0);
  const count = db.prepare('SELECT COUNT(*) AS c FROM sources').get().c;

  // 全新库：全量导入；已有库：仅当 seed 版本更高时增量补新源
  if (count > 0 && applied >= seedVersion) return;

  const { migrated, removed, added } = withTransaction(() => {
    const suppressed = new Set((seed._migrations || []).filter(step => step.to
      && db.prepare('SELECT removed_at FROM sources WHERE url=?').get(step.from)?.removed_at).map(step => step.to));
    const migrated = count > 0 ? applySourceMigrations(seed._migrations) : 0;
    const removed = applied < Number(seed._pruneDisabledBeforeVersion || 0) ? removeDisabledSources() : 0;
    const stmt = db.prepare(`INSERT OR IGNORE INTO sources
      (name, type, url, tier, domain, enabled, selector_json, note, intl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let added = 0;
    for (const s of seed.sources) {
      if (suppressed.has(s.url)) continue;
      const r = stmt.run(s.name, s.type, s.url, s.tier, s.domain,
        s.enabled === false ? 0 : 1,
        s.selector ? JSON.stringify(s.selector) : null, s.note || null,
        s.intl ? 1 : 0);
      if (r.changes > 0) added++;
    }
    // 老库中尚无中文译文的海外文章进入待译队列；星标、原文和统计保持原样。
    const untranslated = db.prepare(`SELECT a.id,a.title,a.title_zh,a.summary_raw,a.ai_summary FROM articles a
      JOIN sources s ON s.id=a.source_id WHERE s.intl=1 AND a.translation_status IS NULL`).all();
    for (const a of untranslated) {
      if (needsChinese(a.title_zh || a.title, a.ai_summary || a.summary_raw)) {
        db.prepare("UPDATE articles SET translation_status='pending' WHERE id=?").run(a.id);
      }
    }
    db.prepare("INSERT INTO meta (key, value) VALUES ('seedVersion', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(String(seedVersion));
    return { migrated, removed, added };
  });
  if (migrated) console.log(`[collect] 信源迁移（v${seedVersion}）：修正 ${migrated} 个`);
  if (removed) console.log(`[collect] 信源清理（v${seedVersion}）：移除 ${removed} 个停用入口，保留历史来源`);
  console.log(`[collect] 种子信源同步（v${seedVersion}）：新增 ${added} 个`);
}

async function collectSource(source, settings, { enrich = enrichArticle, network = networkAccess } = {}) {
  const adapter = ADAPTERS[source.type];
  if (!adapter) throw new Error(`未知信源类型: ${source.type}`);
  const items = await adapter.fetch(source, settings);
  const cutoff = Date.now() - settings.collect.keepDays * 86400e3;
  const prepared = items.map(item => ({ item, structured: structureItem(item, {
    sourceName: source.name, domain: source.domain === 'both' ? null : source.domain
  }) })).filter(entry => entry.structured);
  // 在入库前补查缺失发布时间；不依赖 API Key，网络等待与没有日期仍可收录。
  // HTTP 请求在事务外完成，避免长时间锁住 SQLite。
  let position = 0;
  await settleAll(Array.from({ length: 2 }, async () => {
    while (position < prepared.length) {
      const entry = prepared[position++];
      entry.existing = db.prepare('SELECT * FROM articles WHERE url=? OR canonical_url=? LIMIT 1')
        .get(entry.structured.url, entry.structured.canonicalUrl);
      if (entry.structured.publishedAt || entry.existing?.published_at
        || (entry.existing && !needsPublicationCheck(entry.existing))) continue;
      const content = await enrich({ ...entry.existing, url: entry.structured.url, intl: source.intl }, { network });
      if (content.status === 'network-wait') continue;
      entry.structured.publicationCheckedAt = now();
      entry.structured.publishedAt = content.publishedAt || null;
      entry.structured.publicationPrecision = content.publicationPrecision || null;
      entry.structured.publicationDateText = content.publicationDateText || null;
      entry.structured.contentText ||= content.text || null;
      entry.structured.contentStatus = content.status === 'ok' ? 'ok' : null;
      entry.structured.publisherId ||= content.publisherId || null;
      if (content.images?.length) entry.structured.images = content.images;
    }
  }));
  return withTransaction(() => {
    // 请求期间用户可能停用、移除或改写信源；旧响应不能继续进入新配置。
    const current = db.prepare('SELECT enabled, removed_at, url, type, selector_json, intl FROM sources WHERE id=?').get(source.id);
    if (!current?.enabled || current.removed_at || current.url !== source.url
      || current.type !== source.type || current.selector_json !== source.selector_json || current.intl !== source.intl) {
      return { fetched: items.length, added: 0, skipped: true };
    }
    let added = 0, publicationRepaired = 0;
    for (const { structured, existing } of prepared) {
      if (existing) {
        if (!existing.published_at && (structured.publishedAt || structured.publicationCheckedAt)) {
          publicationRepaired += savePublicationTime(db, existing, structured, structured.publicationCheckedAt || now()) ? 1 : 0;
        }
        continue;
      }
      if (structured.publishedAt && publicationUpperBound(structured.publishedAt, structured.publicationPrecision) < cutoff) continue;
      const translationStatus = source.intl && needsChinese(structured.title, structured.summaryRaw) ? 'pending' : null;
      if (insertArticle({ sourceId: source.id, ...structured, translationStatus })) added++;
    }
    db.prepare(`UPDATE sources SET last_fetch_at=?, last_status='ok',
      fetch_count=fetch_count+1, item_count=item_count+?,
      consecutive_errors=0, next_fetch_at=NULL WHERE id=?`)
      .run(now(), added, source.id);
    return { fetched: items.length, added, publicationRepaired };
  });
}

// 采集全部启用信源（带并发限制）
// force=true 时忽略失败退避 —— 用户点「立即采集分析」意味着他要的就是现在全量重试一次
async function collectAll(onProgress, { force = false, network = networkAccess, enrich = enrichArticle } = {}) {
  seedSources();
  const settings = loadSettings();
  const intervalMs = collectionIntervalMs(settings.collect.intervalMinutes);
  // 外部源由导入接口接收；不能把每轮的“未请求”伪记为采集成功。
  const enabled = db.prepare("SELECT * FROM sources WHERE enabled = 1 AND removed_at IS NULL AND type <> 'external'").all();
  const startedAt = Date.now();
  const networkStatus = enabled.some(source => source.intl) ? await network.detect({ force }) : network.snapshot();
  const waiting = enabled.filter(source => source.intl && !networkStatus.available);
  const reachable = enabled.filter(source => !source.intl || networkStatus.available);
  const sources = force ? reachable : reachable.filter(source => isDue(source, startedAt));
  const skippedBackoff = reachable.length - sources.length;
  const skippedNetwork = waiting.length;
  const skipped = skippedBackoff + skippedNetwork;
  const results = waiting.map(source => ({ source: source.name, url: source.url, type: source.type,
    intl: true, skipped: true, reason: 'network-unavailable' }));
  const CONCURRENCY = 4;
  let idx = 0;
  async function worker() {
    while (idx < sources.length) {
      const source = sources[idx++];
      const started = Date.now();
      try {
        const r = await collectSource(source, settings, { enrich, network });
        results.push({ source: source.name, url: source.url, type: source.type, intl: Boolean(source.intl), ...r, ms: Date.now() - started });
        onProgress && onProgress({ source: source.name, ...r });
      } catch (e) {
        const msg = String(e.message || e).slice(0, 200);
        const consecutive = (Number(source.consecutive_errors) || 0) + 1;
        const recorded = db.prepare(`UPDATE sources SET last_fetch_at=?, last_status=?,
          fetch_count=fetch_count+1, error_count=error_count+1,
          consecutive_errors=?, next_fetch_at=? WHERE id=? AND enabled=1 AND removed_at IS NULL
            AND url=? AND type=? AND selector_json IS ? AND intl=?`)
          .run(now(), 'error: ' + msg, consecutive,
            nextFetchAtIso(consecutive, intervalMs, Date.now()), source.id, source.url, source.type, source.selector_json, source.intl);
        if (!recorded.changes) {
          results.push({ source: source.name, url: source.url, added: 0, skipped: true, reason: 'source-changed' });
          continue;
        }
        results.push({ source: source.name, url: source.url, type: source.type, intl: Boolean(source.intl), error: msg, consecutiveErrors: consecutive });
        onProgress && onProgress({ source: source.name, error: msg, consecutiveErrors: consecutive });
      }
    }
  }
  await settleAll(Array.from({ length: CONCURRENCY }, worker));
  const publicationRepair = await repairPublicationTimes(db, { enrich, network });
  publicationRepair.repaired += results.reduce((sum, row) => sum + (row.publicationRepaired || 0), 0);
  return { results, skipped, skippedBackoff, skippedNetwork, network: networkStatus, publicationRepair };
}

module.exports = { collectAll, collectSource, seedSources, applySourceMigrations };
