'use strict';

// 可重跑的数据库查询对照：只创建 os.tmpdir() 下的合成库，覆盖环境中的真实数据路径。
// node scripts/benchmark-database.js [--rows 100000] [--samples 5]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

function options(argv) {
  const result = { rows: 100000, samples: 5 };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '');
    if (!['rows', 'samples'].includes(key) || !/^\d+$/.test(argv[index + 1] || '')) {
      throw new Error('用法：node scripts/benchmark-database.js [--rows 100000] [--samples 5]');
    }
    result[key] = Number(argv[index + 1]);
  }
  if (result.rows < 1000 || result.rows > 1000000 || result.samples < 1 || result.samples > 20) {
    throw new Error('rows 必须在 1000–1000000 之间，samples 必须在 1–20 之间');
  }
  return result;
}

const settings = options(process.argv.slice(2));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-database-benchmark-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = directory;
const { db, closeDatabase, withTransaction } = require('../server/db');
const { VISIBLE_INDUSTRY_SQL } = require('../server/ai/relevance');
const INDEX_NAMES = [
  'idx_articles_source_translation', 'idx_articles_pending_order',
  'idx_articles_relevant_time', 'idx_articles_featured_time'
];
const SOURCE_COUNT = 150;

try {
  const definitions = INDEX_NAMES.map(name => {
    const row = db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(name);
    assert.ok(row?.sql, `missing production index: ${name}`);
    return row.sql;
  });
  for (const name of INDEX_NAMES) db.exec(`DROP INDEX ${name}`);
  withTransaction(() => {
    const source = db.prepare('INSERT INTO sources(id,name,url) VALUES(?,?,?)');
    for (let id = 1; id <= SOURCE_COUNT; id++) source.run(id, `Source ${id}`, `https://s${id}.example/feed`);
    const article = db.prepare(`INSERT INTO articles(source_id,title,url,fetched_at,published_at,domain,
      analyzed,relevant,featured,translation_status,summary_raw) VALUES(?,?,?,?,?,'aerospace',?,?,?,?,?)`);
    for (let index = 0; index < settings.rows; index++) {
      const stamp = new Date(Date.UTC(2026, 9, 1) + index * 1000).toISOString();
      article.run(index % SOURCE_COUNT + 1, `火箭发射 ${index}`, `https://example.com/${index}`, stamp, stamp,
        index % 5 === 0 ? 0 : index % 3 === 0 ? 3 : 1, index % 7 === 0 ? 0 : 1,
        index % 4 === 0 ? 1 : 0, index % 20 === 0 ? 'pending' : null, 'x'.repeat(400));
    }
  });

  const queries = {
    sources: `SELECT s.*, (SELECT COUNT(*) FROM articles a WHERE a.source_id=s.id
      AND a.translation_status='pending') AS pending_translations FROM sources s
      WHERE s.removed_at IS NULL ORDER BY s.tier,s.id`,
    pending: `SELECT a.id,a.source_id,a.title,a.url,a.summary_raw FROM articles a
      JOIN sources s ON s.id=a.source_id WHERE a.analyzed=0
      AND COALESCE(a.translation_status,'') <> 'pending' ORDER BY a.id DESC LIMIT 300`
  };
  for (const featured of [false, true]) {
    queries[featured ? 'featured' : 'feed'] = `SELECT a.*,s.name AS source_name,s.tier,c.size AS cluster_size
      FROM articles a JOIN sources s ON s.id=a.source_id LEFT JOIN clusters c ON c.id=a.cluster_id
      WHERE ${featured ? 'a.featured=1 AND' : ''} (${VISIBLE_INDUSTRY_SQL})
        AND COALESCE(a.translation_status,'') <> 'pending' AND (a.cluster_id IS NULL OR a.id=c.main_article_id)
      ORDER BY julianday(COALESCE(a.published_at,a.fetched_at)) DESC,a.id DESC LIMIT 31 OFFSET 0`;
  }
  const baseline = {};
  function measure(label) {
    const results = {};
    for (const [name, sql] of Object.entries(queries)) {
      const query = db.prepare(sql);
      const serialized = JSON.stringify(query.all());
      if (label === 'before') baseline[name] = serialized;
      else assert.equal(serialized, baseline[name], `${name}: optimized results changed`);
      const samples = [];
      for (let index = 0; index < settings.samples; index++) {
        const start = performance.now();
        query.all();
        samples.push(performance.now() - start);
      }
      samples.sort((left, right) => left - right);
      const middle = Math.floor(samples.length / 2);
      const median = samples.length % 2 ? samples[middle] : (samples[middle - 1] + samples[middle]) / 2;
      results[name] = {
        medianMs: Number(median.toFixed(3)),
        plan: db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map(row => row.detail)
      };
    }
    return results;
  }
  function storage() {
    const pageCount = db.prepare('PRAGMA page_count').get().page_count;
    const freePages = db.prepare('PRAGMA freelist_count').get().freelist_count;
    const pageSize = db.prepare('PRAGMA page_size').get().page_size;
    return { pageCount, freePages, pageSize, liveBytes: (pageCount - freePages) * pageSize };
  }

  const before = measure('before');
  const storageBefore = storage();
  const started = performance.now();
  withTransaction(() => { for (const sql of definitions) db.exec(sql); });
  const indexCreationMs = Number((performance.now() - started).toFixed(3));
  const storageAfter = storage();
  const after = measure('after');
  const quickCheck = db.prepare('PRAGMA quick_check').get().quick_check;
  assert.equal(quickCheck, 'ok');
  console.log(JSON.stringify({
    rows: settings.rows, sources: SOURCE_COUNT, samples: settings.samples,
    before, after, indexCreationMs, storageBefore, storageAfter,
    liveIndexBytes: storageAfter.liveBytes - storageBefore.liveBytes,
    resultEquality: true, quickCheck,
    note: '合成查询基准；绝对耗时受磁盘、缓存和并行负载影响，不代表网络采集或模型端到端提速。'
  }, null, 2));
} finally {
  closeDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
}
