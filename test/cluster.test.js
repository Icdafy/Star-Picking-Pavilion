'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-cluster-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = dataDir;

const { db, closeDatabase, now } = require('../server/db');
const { clusterRecent } = require('../server/ai/cluster');

test.after(async () => {
  closeDatabase();
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

test('reclustering removes orphan cluster rows after an event splits apart', () => {
  const sourceId = db.prepare(`INSERT INTO sources (name, type, url, tier, domain)
    VALUES ('聚类测试', 'rss', 'https://example.com/feed', 'T2', 'aerospace')`).run().lastInsertRowid;
  const insert = db.prepare(`INSERT INTO articles
    (source_id, title, url, fetched_at, relevant, analyzed, quality_score, domain)
    VALUES (?, ?, ?, ?, 1, 1, 80, 'aerospace')`);
  const first = insert.run(sourceId, '星河动力完成新一代火箭发射任务', 'https://example.com/a', now()).lastInsertRowid;
  const second = insert.run(sourceId, '星河动力完成新一代火箭发射任务成功', 'https://example.com/b', now()).lastInsertRowid;

  assert.equal(clusterRecent().clusters, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM clusters').get().c, 1);

  db.prepare('UPDATE articles SET title=? WHERE id=?').run('完全无关的独立卫星制造进展', second);
  assert.equal(clusterRecent().clusters, 0);
  assert.equal(db.prepare('SELECT cluster_id FROM articles WHERE id=?').get(first).cluster_id, null);
  assert.equal(db.prepare('SELECT cluster_id FROM articles WHERE id=?').get(second).cluster_id, null);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM clusters').get().c, 0);
});

test('reclustering clears a stale cluster when only one recent article remains', () => {
  const sourceId = db.prepare('SELECT id FROM sources LIMIT 1').get().id;
  const articleId = db.prepare(`INSERT INTO articles
    (source_id, title, url, fetched_at, relevant, analyzed, quality_score, domain)
    VALUES (?, ?, ?, ?, 1, 1, 70, 'aerospace')`).run(
    sourceId, '唯一近期文章', `https://example.com/single-${Date.now()}`, now()
  ).lastInsertRowid;
  const clusterId = db.prepare('INSERT INTO clusters (main_article_id, size, updated_at) VALUES (?, 2, ?)')
    .run(articleId, now()).lastInsertRowid;
  db.prepare('UPDATE articles SET cluster_id=? WHERE id=?').run(clusterId, articleId);
  db.prepare('UPDATE articles SET relevant=0 WHERE id<>?').run(articleId);

  assert.equal(clusterRecent().clusters, 0);
  assert.equal(db.prepare('SELECT cluster_id FROM articles WHERE id=?').get(articleId).cluster_id, null);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM clusters WHERE id=?').get(clusterId).c, 0);
});
