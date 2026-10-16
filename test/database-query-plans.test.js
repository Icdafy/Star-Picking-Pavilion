'use strict';

// 用真实 SQLite 执行计划守住查询复杂度，不依赖 CI 机器的耗时阈值。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-query-plans-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = dataDir;
const { db, closeDatabase, withTransaction } = require('../server/db');
const { VISIBLE_INDUSTRY_SQL } = require('../server/ai/relevance');

test.after(() => { closeDatabase(); fs.rmSync(dataDir, { recursive: true, force: true }); });

withTransaction(() => {
  const source = db.prepare('INSERT INTO sources(id,name,url) VALUES (?,?,?)');
  for (let id = 1; id <= 24; id++) source.run(id, `来源 ${id}`, `https://source${id}.example/feed`);
  const article = db.prepare(`INSERT INTO articles(source_id,title,url,fetched_at,published_at,
    relevant,analyzed,featured,domain,translation_status) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  for (let index = 0; index < 1200; index++) {
    const stamp = new Date(Date.UTC(2026, 9, 1) + index * 60000).toISOString();
    // 混合 UTC 与 +08:00 表示，防止优化把真实时间排序退化为字符串排序。
    const publication = index % 3 === 0 ? null : index % 3 === 1
      ? stamp : new Date(Date.parse(stamp) + 8 * 3600000).toISOString().replace('Z', '+08:00');
    article.run(index % 24 + 1, `火箭记录 ${index}`, `https://example.com/${index}`, stamp,
      publication, index % 7 === 0 ? 0 : 1, index % 5 === 0 ? 0 : index % 3 === 0 ? 3 : 1,
      index % 4 === 0 ? 1 : 0, index % 9 === 0 ? 'other' : 'aerospace',
      index % 20 === 0 ? 'pending' : null);
  }
});

function plan(sql) { return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map(row => row.detail).join('\n'); }

test('per-source translation counts use one covering lookup and retain exact counts', () => {
  const sql = `SELECT s.id, (SELECT COUNT(*) FROM articles a WHERE a.source_id=s.id
    AND a.translation_status='pending') AS pending_translations FROM sources s`;
  assert.match(plan(sql), /COVERING INDEX idx_articles_source_translation/);
  const result = db.prepare(sql).all();
  const expected = db.prepare("SELECT source_id, COUNT(*) AS count FROM articles WHERE translation_status='pending' GROUP BY source_id").all();
  const counts = new Map(expected.map(row => [row.source_id, row.count]));
  for (const row of result) assert.equal(row.pending_translations, counts.get(row.id) || 0);
});

test('latest pending analysis batches avoid sorting the entire queue', () => {
  const sql = `SELECT a.id, a.source_id, a.title, a.summary_raw FROM articles a
    JOIN sources s ON s.id=a.source_id
    WHERE a.analyzed=0 AND COALESCE(a.translation_status,'') <> 'pending'
    ORDER BY a.id DESC LIMIT 300`;
  assert.match(plan(sql), /idx_articles_pending_order/);
  assert.doesNotMatch(plan(sql), /TEMP B-TREE FOR ORDER BY/);
  assert.deepEqual(db.prepare(sql).all(), db.prepare(sql.replace('articles a', 'articles a NOT INDEXED')).all());
});

for (const featured of [false, true]) {
  test(`${featured ? 'featured' : 'all'} timeline pages preserve chronological order without a history-wide sort`, () => {
    const sql = `SELECT a.*, s.name AS source_name, s.tier, c.size AS cluster_size FROM articles a
      JOIN sources s ON s.id=a.source_id LEFT JOIN clusters c ON c.id=a.cluster_id
      WHERE ${featured ? 'a.featured=1 AND' : ''} (${VISIBLE_INDUSTRY_SQL})
        AND COALESCE(a.translation_status,'') <> 'pending'
        AND (a.cluster_id IS NULL OR a.id=c.main_article_id)
      ORDER BY julianday(COALESCE(a.published_at,a.fetched_at)) DESC, a.id DESC LIMIT 31 OFFSET 30`;
    assert.match(plan(sql), featured ? /idx_articles_featured_time/ : /idx_articles_relevant_time/);
    assert.doesNotMatch(plan(sql), /TEMP B-TREE FOR ORDER BY/);
    const rows = db.prepare(sql).all();
    assert.deepEqual(rows, db.prepare(sql.replace('articles a', 'articles a NOT INDEXED')).all());
    assert.equal(rows.length, 31);
    assert.ok(rows.every(row => row.relevant === 1 && [1, 3].includes(row.analyzed)
      && row.domain === 'aerospace' && row.translation_status !== 'pending'));
  });
}
