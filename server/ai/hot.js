'use strict';
// 热点 —— AIHOT events/hot.ts 的桌面版。热度按事件算，不按文章算：
//   · 48 小时窗口内，每个独立参与者（出版方优先，其次信源）只算一次，取它最近一次报道的时间
//   · 每个参与者的贡献按 24 小时半衰期衰减：heat = Σ 0.5^(距今小时 / 24)
//   · 重复抓取不会多算，一家媒体发十篇也只算一次——排在前面的，是真正有很多人在说的事
//   · 少于 minParticipants 个独立参与者的事件不上榜
//   · 与 6 小时前同一口径的热度比较：涨得快的标“升”，6 小时内首报的标“新”，
//     近 6 小时新增参与者占多数且 ≥ surgeMinRecent 的标“爆”
//   · 技术突破给一个温和的乘数（breakthroughWeight × 突破强度），不改变“有多少人在说”的本质
// 时间一律取信源时间（发布时间），不取采集时间：迟到的抓取不会把旧事件顶回榜首。
const { db, now } = require('../db');
const industry = require('../industry');

const HOT_RULE_VERSION = 'heat-v1-48h-halflife24h';
const HOUR = 3600e3;

function decay(ageMs, halfLifeHours) {
  return Math.pow(0.5, Math.max(0, ageMs) / HOUR / halfLifeHours);
}

function heatIndex(heat) {
  return Math.round(heat * 100) / 10; // 10 倍刻度，保留一位小数
}

// 纯函数：signals → 每个事件的热度统计。便于单测，也便于小时快照复用同一口径。
function aggregateHeat(signals, atMs, config) {
  const windowMs = config.windowHours * HOUR;
  const prevMs = atMs - 6 * HOUR;
  const stories = new Map();
  for (const s of signals) {
    const t = Date.parse(s.observed_at);
    if (!Number.isFinite(t) || t > atMs || t <= atMs - windowMs) continue;
    const story = stories.get(s.story_id) || { storyId: s.story_id, participants: new Map() };
    const p = story.participants.get(s.participant_key) || { key: s.participant_key, name: s.participant_name, tier: s.tier, last: -Infinity, first: Infinity, lastPrev: -Infinity };
    p.last = Math.max(p.last, t);
    p.first = Math.min(p.first, t);
    if (t <= prevMs) p.lastPrev = Math.max(p.lastPrev, t);
    story.participants.set(s.participant_key, p);
    stories.set(s.story_id, story);
  }
  const out = [];
  for (const story of stories.values()) {
    let heat = 0;
    let heatPrev = 0;
    let recent6h = 0;
    for (const p of story.participants.values()) {
      heat += decay(atMs - p.last, config.halfLifeHours);
      if (p.lastPrev > prevMs - windowMs) heatPrev += decay(prevMs - p.lastPrev, config.halfLifeHours);
      if (p.first > prevMs) recent6h++;
    }
    out.push({ storyId: story.storyId, participants: story.participants.size, heat, heatPrev, recent6h, members: [...story.participants.values()] });
  }
  return out;
}

function loadSignals(atMs, windowHours) {
  const since = new Date(atMs - windowHours * HOUR).toISOString();
  return db.prepare(`SELECT ss.story_id, ss.participant_key, ss.participant_name, ss.tier, ss.observed_at
    FROM story_signals ss JOIN clusters c ON c.id = ss.story_id AND c.merged_into IS NULL
    WHERE ss.observed_at > ? AND ss.observed_at <= ?`).all(since, new Date(atMs).toISOString());
}

function parseList(raw) {
  try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

function storyContext(storyId) {
  const story = db.prepare('SELECT * FROM clusters WHERE id = ?').get(storyId);
  if (!story) return null;
  const members = db.prepare(`SELECT a.id, a.title, a.title_zh, a.url, a.domain, a.category, a.featured, a.attention_score,
      a.quality_score, a.breakthrough_score, a.ai_summary, a.ai_reason, s.name AS source_name, s.tier
    FROM articles a JOIN sources s ON s.id = a.source_id WHERE a.cluster_id = ?`).all(storyId);
  const main = members.find(m => m.id === story.main_article_id) || members[0];
  const companies = db.prepare(`SELECT c.id, c.name, c.watch, COUNT(*) n FROM article_companies ac
    JOIN articles a ON a.id = ac.article_id JOIN companies c ON c.id = ac.company_id
    WHERE a.cluster_id = ? AND ac.role = 'primary' GROUP BY c.id ORDER BY n DESC, c.watch DESC LIMIT 4`).all(storyId);
  return { story, members, main, companies };
}

function sparkline(storyId, atMs, hours = 24) {
  const since = new Date(atMs - hours * HOUR).toISOString();
  return db.prepare('SELECT hour, heat FROM story_heat_hourly WHERE story_id = ? AND hour >= ? ORDER BY hour')
    .all(storyId, since).map(r => ({ hour: r.hour, heat: r.heat }));
}

// 计算热点榜。domain 为空时是全站榜（会被存档），否则是领域内的榜（即时计算，不存档）。
function computeHotEntries({ atMs = Date.now(), domain = null, limit = null } = {}) {
  const config = industry.loadSelection().hot;
  const rows = aggregateHeat(loadSignals(atMs, config.windowHours), atMs, config)
    .filter(r => r.participants >= config.minParticipants);
  const enriched = [];
  for (const r of rows) {
    const context = storyContext(r.storyId);
    if (!context?.main) continue;
    const storyDomain = context.story.domain || context.main.domain;
    if (domain && storyDomain !== domain) continue;
    const breakthrough = Math.max(0, ...context.members.map(m => Number(m.breakthrough_score) || 0));
    const weight = 1 + config.breakthroughWeight * breakthrough;
    enriched.push({ ...r, context, breakthrough, weightedHeat: r.heat * weight, weightedPrev: r.heatPrev * weight, storyDomain });
  }
  enriched.sort((a, b) => b.weightedHeat - a.weightedHeat
    || Date.parse(b.context.story.latest_at || 0) - Date.parse(a.context.story.latest_at || 0));
  const max = limit || config.maxEntries;
  return enriched.slice(0, max).map((r, index) => {
    const { story, main, members, companies } = r.context;
    const heat = heatIndex(r.weightedHeat);
    const prev = heatIndex(r.weightedPrev);
    const pct = prev > 0 ? (heat - prev) / prev : null;
    const firstAt = Date.parse(story.first_report_at || '') || Math.min(...r.members.map(m => m.first));
    const isNew = atMs - firstAt < config.newHours * HOUR;
    const surge = r.recent6h >= config.surgeMinRecent && r.recent6h / r.participants >= 0.5;
    const badges = [];
    if (surge) badges.push('surge');
    if (isNew) badges.push('new');
    if (!surge && pct !== null && pct > config.risingPct) badges.push('rising');
    if (r.breakthrough >= 0.5) badges.push('breakthrough');
    const tierOrder = { T1: 0, 'T1.5': 1, T2: 2 };
    return {
      rank: index + 1,
      storyId: story.id,
      title: story.title || main.title_zh || main.title,
      digest: story.digest || null,
      domain: r.storyDomain,
      category: story.category || main.category,
      heat,
      trend: prev <= 0 ? 'new' : pct === null ? 'unknown' : pct > 0.1 ? 'up' : pct < -0.1 ? 'down' : 'flat',
      trendPct: pct === null ? null : Math.round(pct * 1000) / 10,
      badges,
      participantCount: r.participants,
      reportCount: members.length,
      featuredCount: members.filter(m => m.featured).length,
      sourceNames: [...new Set([...r.members].sort((x, y) => (tierOrder[x.tier] ?? 3) - (tierOrder[y.tier] ?? 3) || y.last - x.last).map(m => m.name).filter(Boolean))].slice(0, 8),
      firstReportAt: Number.isFinite(firstAt) ? new Date(firstAt).toISOString() : null,
      latestAt: story.latest_at,
      breakthrough: Math.round(r.breakthrough * 100) / 100,
      companies: companies.map(c => ({ id: c.id, name: c.name, watch: c.watch })),
      representative: {
        id: main.id,
        title: main.title_zh || main.title,
        url: main.url,
        source: main.source_name,
        tier: main.tier,
        summary: main.ai_summary || null,
        reason: main.ai_reason || null,
        score: Number(main.attention_score ?? main.quality_score) || null
      },
      sparkline: sparkline(story.id, atMs)
    };
  });
}

function computeHotRanking(atMs = Date.now()) {
  const config = industry.loadSelection().hot;
  const entries = computeHotEntries({ atMs });
  const id = db.prepare(`INSERT INTO hot_rankings (computed_at, rule_version, entries_json, evidence_json) VALUES (?, ?, ?, ?)`)
    .run(new Date(atMs).toISOString(), HOT_RULE_VERSION, JSON.stringify(entries),
      JSON.stringify({ windowHours: config.windowHours, halfLifeHours: config.halfLifeHours, minParticipants: config.minParticipants })).lastInsertRowid;
  db.prepare('DELETE FROM hot_rankings WHERE computed_at < ?').run(new Date(atMs - 30 * 86400e3).toISOString());
  return { id: Number(id), entries: entries.length };
}

// 最新一份全站榜；超过 maxAgeMs 就当场重算（读者打开页面不调模型，这里只是读库与算术）
function latestHot({ domain = null, maxAgeMs = 10 * 60e3, atMs = Date.now() } = {}) {
  const config = industry.loadSelection().hot;
  const meta = { windowHours: config.windowHours, halfLifeHours: config.halfLifeHours, minParticipants: config.minParticipants, ruleVersion: HOT_RULE_VERSION };
  if (domain) return { computedAt: new Date(atMs).toISOString(), ...meta, entries: computeHotEntries({ atMs, domain }) };
  let row = db.prepare('SELECT * FROM hot_rankings ORDER BY computed_at DESC LIMIT 1').get();
  if (!row || atMs - Date.parse(row.computed_at) > maxAgeMs) {
    computeHotRanking(atMs);
    row = db.prepare('SELECT * FROM hot_rankings ORDER BY computed_at DESC LIMIT 1').get();
  }
  return { computedAt: row.computed_at, ...meta, entries: parseList(row.entries_json) };
}

// 小时快照：事件页的热度曲线与热点榜的迷你走势图
function snapshotHeat(atMs = Date.now()) {
  const config = industry.loadSelection().hot;
  const hour = Math.floor(atMs / HOUR) * HOUR;
  const rows = aggregateHeat(loadSignals(hour, config.windowHours), hour, config);
  const upsert = db.prepare(`INSERT INTO story_heat_hourly (story_id, hour, heat, participants) VALUES (?, ?, ?, ?)
    ON CONFLICT(story_id, hour) DO UPDATE SET heat = excluded.heat, participants = excluded.participants`);
  const stamp = new Date(hour).toISOString();
  for (const r of rows) upsert.run(r.storyId, stamp, heatIndex(r.heat), r.participants);
  db.prepare('DELETE FROM story_heat_hourly WHERE hour < ?').run(new Date(hour - 14 * 86400e3).toISOString());
  return { stories: rows.length, hour: stamp };
}

function storyDetail(storyId) {
  let id = Number(storyId);
  // 被合并的事件：旧地址指向合并后的新事件
  for (let hop = 0; hop < 5; hop++) {
    const row = db.prepare('SELECT merged_into FROM clusters WHERE id = ?').get(id);
    if (!row?.merged_into) break;
    id = row.merged_into;
  }
  const context = storyContext(id);
  if (!context) return null;
  const { story, companies } = context;
  const series = db.prepare('SELECT hour, heat, participants FROM story_heat_hourly WHERE story_id = ? ORDER BY hour DESC LIMIT 168').all(id).reverse();
  const signals = db.prepare('SELECT participant_name, tier, observed_at FROM story_signals WHERE story_id = ? ORDER BY observed_at').all(id);
  return {
    id: story.id,
    title: story.title,
    digest: story.digest,
    domain: story.domain,
    category: story.category,
    size: story.size,
    firstReportAt: story.first_report_at,
    latestAt: story.latest_at,
    companies,
    series,
    participants: [...new Map(signals.map(s => [s.participant_name, s])).values()].map(s => ({ name: s.participant_name, tier: s.tier, at: s.observed_at }))
  };
}

module.exports = {
  HOT_RULE_VERSION,
  aggregateHeat,
  heatIndex,
  computeHotEntries,
  computeHotRanking,
  latestHot,
  snapshotHeat,
  storyDetail
};
