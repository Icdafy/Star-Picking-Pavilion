'use strict';

const lexicon = require('../ai/lexicon');
const keywords = require('../ai/keywords');
const { heatScore } = require('../ai/scoring');

const SCHEMA_VERSION = 1;
const SECTION_ORDER = [
  '政策法规',
  '发射与任务',
  '技术研发',
  '企业动态',
  '资本市场',
  '应用场景',
  '观点报告'
];

function resolveDailyWindow(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new TypeError('每日简报日期必须使用 YYYY-MM-DD');
  }
  const [year, month, day] = date.split('-').map(Number);
  const end = new Date(year, month - 1, day, 8, 0, 0, 0);
  if (end.getFullYear() !== year || end.getMonth() !== month - 1 || end.getDate() !== day) {
    throw new TypeError('每日简报日期不是有效日历日期');
  }
  const start = new Date(year, month - 1, day - 1, 8, 0, 0, 0);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    basis: 'fetched_at',
    startInclusive: false,
    endInclusive: true
  };
}

function parseJson(value, fallback, predicate) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return predicate(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function safeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function finiteOrNull(value, minimum = -Infinity, maximum = Infinity) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : null;
}

function mapRecord(row, { date, window, scoring }) {
  const scores = parseJson(
    row.scores_json,
    null,
    value => value && typeof value === 'object' && !Array.isArray(value)
  );
  const tags = parseJson(row.tags_json, [], Array.isArray);
  const breakthroughSignals = parseJson(
    row.breakthrough_signals_json,
    null,
    value => value && typeof value === 'object' && !Array.isArray(value)
  );
  const relevant = row.relevant == null ? null : Boolean(row.relevant);
  const quality = finiteOrNull(row.quality_score, 0, 100);
  const breakthroughScore = finiteOrNull(row.breakthrough_score, 0, 1) || 0;
  const breakthroughBonus = finiteOrNull(row.breakthrough_bonus, 0, 100) || 0;
  const publishedAt = safeDate(row.published_at);
  const fetchedAt = safeDate(row.fetched_at);
  const text = [
    row.title,
    row.summary_raw,
    row.ai_summary,
    tags.join(' ')
  ].filter(Boolean).join(' ');
  const lexiconSummary = lexicon.analyze(text);
  const heatAtCutoff = quality == null ? null : Math.round(heatScore(
    quality,
    publishedAt || fetchedAt,
    scoring,
    Date.parse(window.end),
    { score: breakthroughScore, bonus: breakthroughBonus }
  ) * 10) / 10;

  return {
    schemaVersion: SCHEMA_VERSION,
    archiveDate: date,
    windowStart: window.start,
    windowEnd: window.end,
    articleId: Number(row.id),
    sourceId: Number(row.source_id),
    sourceName: String(row.source_name || ''),
    sourceTier: String(row.tier || ''),
    title: String(row.title || ''),
    url: safeUrl(row.url),
    rawSummary: row.summary_raw == null ? null : String(row.summary_raw),
    aiSummary: row.ai_summary == null ? null : String(row.ai_summary),
    aiReason: row.ai_reason == null ? null : String(row.ai_reason),
    publishedAt,
    fetchedAt,
    domain: row.domain || null,
    category: row.category || null,
    relevant,
    analyzed: Number(row.analyzed) || 0,
    scores,
    quality,
    heatAtCutoff,
    featured: Boolean(row.featured),
    tags,
    clusterId: row.cluster_id == null ? null : Number(row.cluster_id),
    clusterSize: row.cluster_size == null ? null : Number(row.cluster_size),
    starred: Boolean(row.starred),
    lexiconTerms: lexiconSummary.terms,
    lexiconWeight: lexiconSummary.weightSum,
    noiseHits: keywords.noiseHits(text),
    breakthroughScore,
    breakthroughBonus,
    breakthroughSignals,
    scoringVersion: Number(row.scoring_version) || 1
  };
}

function queryDailyRecords(database, date, window, scoring) {
  const rows = database.prepare(`
    SELECT a.*, s.name AS source_name, s.tier, c.size AS cluster_size
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    LEFT JOIN clusters c ON c.id = a.cluster_id
    WHERE julianday(a.fetched_at) > julianday(?)
      AND julianday(a.fetched_at) <= julianday(?)
    ORDER BY a.fetched_at ASC, a.id ASC
  `).all(window.start, window.end);
  return rows.map(row => mapRecord(row, { date, window, scoring }));
}

function compareImportance(left, right) {
  return (Number(right.heatAtCutoff) || 0) - (Number(left.heatAtCutoff) || 0)
    || (Number(right.quality) || 0) - (Number(left.quality) || 0)
    || right.articleId - left.articleId;
}

function foldClusters(records) {
  const folded = new Map();
  for (const record of records) {
    const key = record.clusterId == null
      ? `article:${record.articleId}`
      : `cluster:${record.clusterId}`;
    const current = folded.get(key);
    if (!current || compareImportance(record, current) < 0) folded.set(key, record);
  }
  return [...folded.values()].sort(compareImportance);
}

function buildSections(records) {
  return SECTION_ORDER.map(category => ({
    category,
    items: foldClusters(records.filter(record => record.category === category))
  })).filter(section => section.items.length);
}

function summarize(records) {
  const relevant = records.filter(record => record.relevant === true);
  const byDomain = {
    lowaltitude: relevant.filter(record =>
      record.domain === 'lowaltitude' || record.domain === 'both').length,
    aerospace: relevant.filter(record =>
      record.domain === 'aerospace' || record.domain === 'both').length
  };
  return {
    total: records.length,
    relevant: relevant.length,
    featured: relevant.filter(record => record.featured).length,
    pending: records.filter(record => record.relevant == null || record.analyzed === 0).length,
    irrelevant: records.filter(record => record.relevant === false).length,
    breakthroughs: relevant.filter(record => record.breakthroughScore > 0).length,
    byDomain
  };
}

function buildDailyBundle({
  database,
  date,
  scoring,
  generatedAt = new Date()
}) {
  if (!database || typeof database.prepare !== 'function') {
    throw new TypeError('每日简报需要可查询的数据库');
  }
  if (!scoring || typeof scoring !== 'object') {
    throw new TypeError('每日简报需要计分配置');
  }
  const window = resolveDailyWindow(date);
  const records = queryDailyRecords(database, date, window, scoring);
  const relevant = records.filter(record => record.relevant === true);
  const folded = foldClusters(relevant);
  const featured = relevant.filter(record => record.featured);
  return {
    schemaVersion: SCHEMA_VERSION,
    date,
    window,
    generatedAt: new Date(generatedAt).toISOString(),
    summary: summarize(records),
    records,
    readable: {
      hot: folded.slice(0, 12),
      breakthroughs: foldClusters(
        relevant.filter(record => record.breakthroughScore > 0)
      ).sort((left, right) =>
        right.breakthroughScore - left.breakthroughScore
        || compareImportance(left, right)).slice(0, 12),
      sections: buildSections(relevant),
      featuredSections: buildSections(featured),
      relevantIndex: [...relevant].sort((left, right) =>
        String(right.fetchedAt || '').localeCompare(String(left.fetchedAt || ''))
        || right.articleId - left.articleId)
    }
  };
}

function serializeJsonl(records) {
  if (!Array.isArray(records) || !records.length) return '';
  return `${records.map(record => JSON.stringify(record)).join('\n')}\n`;
}

module.exports = {
  SCHEMA_VERSION,
  SECTION_ORDER,
  resolveDailyWindow,
  queryDailyRecords,
  foldClusters,
  buildDailyBundle,
  serializeJsonl
};
