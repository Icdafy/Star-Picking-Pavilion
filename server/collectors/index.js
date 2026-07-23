'use strict';
// 信源采集层 —— 可插拔适配器：rss | bing(必应资讯RSS) | html(网页爬虫)
// 后续扩展：RSSHub、公开API、三方数据平台，只需新增一个适配器文件
const fs = require('node:fs');
const path = require('node:path');
const { db, now, insertArticle } = require('../db');
const { loadSettings } = require('../config');
const { collectionIntervalMs } = require('../schedule-policy');
const { isDue, nextFetchAtIso } = require('../source-health');
const rssAdapter = require('./rss');
const htmlAdapter = require('./html');
const apiAdapter = require('./api');

const ADAPTERS = {
  rss: rssAdapter,
  bing: rssAdapter, // 必应资讯本质也是 RSS，复用解析器（注：大陆网络环境下必应常返回空结果）
  html: htmlAdapter,
  api: apiAdapter   // 公开 JSON API（东方财富关键词搜索等）
};

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

  const stmt = db.prepare(`INSERT OR IGNORE INTO sources
    (name, type, url, tier, domain, enabled, selector_json, note, intl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let added = 0;
  for (const s of seed.sources) {
    const r = stmt.run(s.name, s.type, s.url, s.tier, s.domain,
      s.enabled === false ? 0 : 1,
      s.selector ? JSON.stringify(s.selector) : null, s.note || null,
      s.intl ? 1 : 0);
    if (r.changes > 0) added++;
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('seedVersion', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(String(seedVersion));
  console.log(`[collect] 种子信源同步（v${seedVersion}）：新增 ${added} 个`);
}

async function collectSource(source, settings) {
  const adapter = ADAPTERS[source.type];
  if (!adapter) throw new Error(`未知信源类型: ${source.type}`);
  const items = await adapter.fetch(source, settings);
  const cutoff = Date.now() - settings.collect.keepDays * 86400e3;
  let added = 0;
  for (const it of items) {
    if (!it.title || !it.url) continue;
    if (it.publishedAt && new Date(it.publishedAt).getTime() < cutoff) continue;
    const ok = insertArticle({
      sourceId: source.id,
      title: it.title.trim().slice(0, 300),
      url: it.url,
      summaryRaw: (it.summary || '').trim().slice(0, 2000),
      publishedAt: it.publishedAt || null,
      image: it.image || null,
      domain: source.domain === 'both' ? null : source.domain
    });
    if (ok) added++;
  }
  return { fetched: items.length, added };
}

// 采集全部启用信源（带并发限制）
// force=true 时忽略失败退避 —— 用户点「立即采集分析」意味着他要的就是现在全量重试一次
async function collectAll(onProgress, { force = false } = {}) {
  seedSources();
  const settings = loadSettings();
  const intervalMs = collectionIntervalMs(settings.collect.intervalMinutes);
  const enabled = db.prepare('SELECT * FROM sources WHERE enabled = 1').all();
  const startedAt = Date.now();
  const sources = force ? enabled : enabled.filter(source => isDue(source, startedAt));
  const skipped = enabled.length - sources.length;
  const results = [];
  const CONCURRENCY = 4;
  let idx = 0;
  async function worker() {
    while (idx < sources.length) {
      const source = sources[idx++];
      const started = Date.now();
      try {
        const r = await collectSource(source, settings);
        db.prepare(`UPDATE sources SET last_fetch_at=?, last_status='ok',
          fetch_count=fetch_count+1, item_count=item_count+?,
          consecutive_errors=0, next_fetch_at=NULL WHERE id=?`)
          .run(now(), r.added, source.id);
        results.push({ source: source.name, ...r, ms: Date.now() - started });
        onProgress && onProgress({ source: source.name, ...r });
      } catch (e) {
        const msg = String(e.message || e).slice(0, 200);
        const consecutive = (Number(source.consecutive_errors) || 0) + 1;
        db.prepare(`UPDATE sources SET last_fetch_at=?, last_status=?,
          fetch_count=fetch_count+1, error_count=error_count+1,
          consecutive_errors=?, next_fetch_at=? WHERE id=?`)
          .run(now(), 'error: ' + msg, consecutive,
            nextFetchAtIso(consecutive, intervalMs, Date.now()), source.id);
        results.push({ source: source.name, error: msg, consecutiveErrors: consecutive });
        onProgress && onProgress({ source: source.name, error: msg, consecutiveErrors: consecutive });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { results, skipped };
}

module.exports = { collectAll, seedSources };
