'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const {
  buildDailyBundle,
  resolveDailyWindow,
  serializeJsonl
} = require('../server/archive/daily-bundle');
const { renderDailyArchive } = require('../server/export/markdown');
const { API_TOKEN_HEADER } = require('../server/http-security');
const { localDateString } = require('../server/date-time');
const { startServer } = require('./helpers/server-child');

const scoring = {
  ...JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'scoring.json'), 'utf8')),
  breakthroughBoost: {
    maxHalfLifeExtensionHours: 18
  }
};

function createFixture() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE sources (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      tier TEXT NOT NULL
    );
    CREATE TABLE clusters (
      id INTEGER PRIMARY KEY,
      size INTEGER NOT NULL
    );
    CREATE TABLE articles (
      id INTEGER PRIMARY KEY,
      source_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      summary_raw TEXT,
      ai_summary TEXT,
      ai_reason TEXT,
      published_at TEXT,
      fetched_at TEXT NOT NULL,
      domain TEXT,
      category TEXT,
      relevant INTEGER,
      analyzed INTEGER NOT NULL,
      scores_json TEXT,
      quality_score REAL,
      featured INTEGER NOT NULL,
      tags_json TEXT,
      cluster_id INTEGER,
      starred INTEGER NOT NULL DEFAULT 0,
      breakthrough_score REAL NOT NULL DEFAULT 0,
      breakthrough_bonus REAL NOT NULL DEFAULT 0,
      breakthrough_signals_json TEXT,
      scoring_version INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO sources (id, name, tier) VALUES
      (1, '权威源', 'T1'),
      (2, '行业媒体', 'T2');
    INSERT INTO clusters (id, size) VALUES (7, 2);
  `);
  return database;
}

function insert(database, values) {
  database.prepare(`
    INSERT INTO articles (
      id, source_id, title, url, summary_raw, ai_summary, ai_reason,
      published_at, fetched_at, domain, category, relevant, analyzed,
      scores_json, quality_score, featured, tags_json, cluster_id, starred,
      breakthrough_score, breakthrough_bonus, breakthrough_signals_json,
      scoring_version
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `).run(
    values.id,
    values.sourceId || 1,
    values.title,
    values.url || `https://example.com/${values.id}`,
    values.rawSummary || null,
    values.aiSummary || null,
    values.aiReason || null,
    values.publishedAt || null,
    values.fetchedAt,
    values.domain ?? 'aerospace',
    values.category ?? '技术研发',
    values.relevant === null ? null : (values.relevant === false ? 0 : 1),
    values.analyzed ?? 1,
    values.scores ? JSON.stringify(values.scores) : null,
    values.quality ?? null,
    values.featured ? 1 : 0,
    JSON.stringify(values.tags || []),
    values.clusterId || null,
    values.starred ? 1 : 0,
    values.breakthroughScore || 0,
    values.breakthroughBonus || 0,
    values.breakthroughSignals ? JSON.stringify(values.breakthroughSignals) : null,
    values.scoringVersion || 1
  );
}

test('08:00 window uses an open start, closed end and fetched time so late news is never lost', () => {
  const database = createFixture();
  const window = resolveDailyWindow('2026-07-31');
  const startMs = Date.parse(window.start);
  const endMs = Date.parse(window.end);

  insert(database, {
    id: 1,
    title: '起点恰好八点',
    fetchedAt: new Date(startMs).toISOString(),
    quality: 90
  });
  insert(database, {
    id: 2,
    title: '起点后一毫秒',
    fetchedAt: new Date(startMs + 1).toISOString(),
    quality: 80
  });
  insert(database, {
    id: 3,
    title: '迟到但被本窗口采集',
    fetchedAt: new Date(startMs + 60_000).toISOString(),
    publishedAt: new Date(startMs - 7 * 86_400_000).toISOString(),
    quality: 70
  });
  insert(database, {
    id: 4,
    title: '终点恰好八点',
    fetchedAt: new Date(endMs).toISOString(),
    quality: 60
  });
  insert(database, {
    id: 5,
    title: '终点后一毫秒',
    fetchedAt: new Date(endMs + 1).toISOString(),
    quality: 100
  });

  const bundle = buildDailyBundle({
    database,
    date: '2026-07-31',
    scoring,
    generatedAt: new Date(endMs + 5_000)
  });

  assert.deepEqual(bundle.records.map(row => row.articleId), [2, 3, 4]);
  assert.equal(bundle.records[1].publishedAt, new Date(startMs - 7 * 86_400_000).toISOString());
  assert.equal(bundle.window.start, new Date(startMs).toISOString());
  assert.equal(bundle.window.end, new Date(endMs).toISOString());
});

test('JSONL retains every report while readable sections fold event clusters', () => {
  const database = createFixture();
  const window = resolveDailyWindow('2026-07-31');
  const stamp = new Date(Date.parse(window.end) - 3_600_000).toISOString();
  const scores = {
    importance: 86,
    novelty: 90,
    credibility: 92,
    impact: 84,
    timeliness: 88
  };
  const signals = {
    objects: ['可重复使用火箭'],
    actions: ['回收'],
    credibilityEvidence: 'tier-t1',
    uncertainty: [],
    rejectedReason: null
  };
  insert(database, {
    id: 10,
    title: '火箭完成回收试验（官方）',
    fetchedAt: stamp,
    publishedAt: stamp,
    rawSummary: '原始摘要',
    aiSummary: '完成垂直起降与回收。',
    aiReason: '路线进入工程验证。',
    scores,
    quality: 88,
    featured: true,
    tags: ['可重复使用火箭'],
    clusterId: 7,
    breakthroughScore: 0.82,
    breakthroughBonus: 8.2,
    breakthroughSignals: signals
  });
  insert(database, {
    id: 11,
    sourceId: 2,
    title: '火箭完成回收试验（行业媒体）',
    fetchedAt: stamp,
    publishedAt: stamp,
    rawSummary: '第二家信源的独立报道',
    scores,
    quality: 79,
    featured: true,
    tags: ['可重复使用火箭'],
    clusterId: 7,
    breakthroughScore: 0.7,
    breakthroughBonus: 7,
    breakthroughSignals: signals
  });
  insert(database, {
    id: 12,
    title: '待分析记录',
    fetchedAt: stamp,
    relevant: null,
    analyzed: 0
  });
  insert(database, {
    id: 13,
    title: '判为无关的噪声记录',
    fetchedAt: stamp,
    relevant: false,
    analyzed: 1
  });

  const bundle = buildDailyBundle({
    database,
    date: '2026-07-31',
    scoring
  });
  const jsonl = serializeJsonl(bundle.records);
  const lines = jsonl.trim().split('\n').map(line => JSON.parse(line));

  assert.equal(bundle.records.length, 4);
  assert.equal(lines.length, 4);
  assert.equal(lines.filter(row => row.clusterId === 7).length, 2);
  assert.equal(bundle.readable.hot.length, 1);
  assert.equal(bundle.readable.breakthroughs.length, 1);
  assert.equal(bundle.summary.total, 4);
  assert.equal(bundle.summary.relevant, 2);
  assert.equal(bundle.summary.featured, 2);
  assert.equal(bundle.summary.pending, 1);
  assert.equal(bundle.summary.irrelevant, 1);
  assert.equal(bundle.summary.breakthroughs, 2);
  assert.equal(lines[0].rawSummary, '原始摘要');
  assert.equal(lines[0].heatAtCutoff > 0, true);
  assert.deepEqual(lines[0].breakthroughSignals, signals);
});

test('research rows have a stable complete schema and sanitize unsafe URLs', () => {
  const database = createFixture();
  const window = resolveDailyWindow('2026-07-31');
  insert(database, {
    id: 20,
    title: '无摘要也必须归档',
    url: 'https://user:secret@example.com/private',
    fetchedAt: new Date(Date.parse(window.end) - 1_000).toISOString(),
    relevant: null,
    analyzed: 0
  });

  const [record] = buildDailyBundle({
    database,
    date: '2026-07-31',
    scoring
  }).records;
  const fields = [
    'schemaVersion', 'archiveDate', 'windowStart', 'windowEnd', 'articleId',
    'sourceId', 'sourceName', 'sourceTier', 'title', 'url', 'rawSummary',
    'aiSummary', 'aiReason', 'publishedAt', 'fetchedAt', 'domain', 'category',
    'relevant', 'analyzed', 'scores', 'quality', 'heatAtCutoff', 'featured',
    'tags', 'clusterId', 'clusterSize', 'starred', 'lexiconTerms',
    'lexiconWeight', 'noiseHits', 'breakthroughScore', 'breakthroughBonus',
    'breakthroughSignals', 'scoringVersion'
  ];

  assert.deepEqual(Object.keys(record), fields);
  assert.equal(record.url, null);
  assert.equal(record.rawSummary, null);
  assert.equal(record.relevant, null);
  assert.deepEqual(record.tags, []);
});

test('empty windows still produce valid Markdown and an empty JSONL file', () => {
  const database = createFixture();
  const bundle = buildDailyBundle({
    database,
    date: '2026-07-31',
    scoring,
    branding: { productName: '摘星阁', homepage: 'https://example.com' }
  });
  const markdown = renderDailyArchive(bundle, {
    productName: '摘星阁',
    homepage: 'https://example.com'
  });

  assert.equal(bundle.records.length, 0);
  assert.equal(serializeJsonl(bundle.records), '');
  assert.match(markdown, /过去 24 小时未采集到新闻记录/);
  assert.match(markdown, /2026-07-30 08:00/);
  assert.match(markdown, /2026-07-31 08:00/);
});

test('authenticated daily archive endpoint returns Markdown, JSONL and manifest metadata', async t => {
  const server = await startServer(t);
  const database = new DatabaseSync(path.join(server.dataDir, 'star-picking-pavilion.db'));
  const date = localDateString();
  const window = resolveDailyWindow(date);
  try {
    const sourceId = database.prepare(`
      INSERT INTO sources (name, type, url, tier, domain)
      VALUES ('归档测试源', 'rss', ?, 'T1', 'aerospace')
    `).run(`https://example.com/archive-${Math.random()}`).lastInsertRowid;
    database.prepare(`
      INSERT INTO articles (
        source_id, title, url, summary_raw, fetched_at, published_at,
        relevant, analyzed, quality_score, featured, domain, category
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 80, 1, 'aerospace', '技术研发')
    `).run(
      sourceId,
      '归档接口测试新闻',
      `https://example.com/article-${Math.random()}`,
      '完整采集摘要',
      new Date(Date.parse(window.end) - 60_000).toISOString(),
      new Date(Date.parse(window.end) - 120_000).toISOString()
    );
  } finally {
    database.close();
  }

  const response = await server.request({
    pathname: `/api/daily/archive?date=${date}`,
    headers: { [API_TOKEN_HEADER]: server.token }
  });
  assert.equal(response.status, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.date, date);
  assert.match(payload.markdown, /归档接口测试新闻/);
  assert.equal(JSON.parse(payload.jsonl.trim()).title, '归档接口测试新闻');
  assert.equal(payload.manifest.schemaVersion, 1);
  assert.equal(payload.manifest.summary.total, 1);
});
