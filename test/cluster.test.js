'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-cluster-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = dataDir;

const { db, closeDatabase, now } = require('../server/db');
const { clusterRecent, bigrams, overlap, findSimilarPairs } = require('../server/ai/cluster');

test.after(async () => {
  closeDatabase();
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

// 倒排索引只是省掉了「必然无交集」的比较，结果必须与逐对比较逐个相同。
// 用确定性伪随机语料覆盖：长短悬殊、跨领域、完全重复、完全不相干等各种组合。
test('the inverted index finds exactly the pairs a brute-force scan would find', () => {
  let seed = 20260724;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const vocabulary = '航天卫星火箭低空无人机适航融资政策发射回收星座通航空域取证试飞'.split('');
  const domains = ['aerospace', 'lowaltitude', null];

  const docs = [];
  for (let index = 0; index < 220; index++) {
    const length = 4 + Math.floor(random() * 30);
    let text = '';
    for (let position = 0; position < length; position++) {
      text += vocabulary[Math.floor(random() * vocabulary.length)];
    }
    // 每隔几条复制上一条并轻微改写，制造真正的近重复对
    if (index > 0 && index % 7 === 0) text = docs[index - 1].text + (random() < 0.5 ? '' : vocabulary[0]);
    docs.push({ id: index + 1, text, domain: domains[Math.floor(random() * domains.length)] });
  }
  for (const doc of docs) doc.grams = bigrams(doc.text);

  for (const threshold of [0.3, 0.42, 0.6, 0.85]) {
    const expected = new Set();
    for (let i = 0; i < docs.length; i++) {
      for (let j = i + 1; j < docs.length; j++) {
        if (docs[i].domain && docs[j].domain && docs[i].domain !== docs[j].domain) continue;
        if (overlap(docs[i].grams, docs[j].grams) >= threshold) expected.add(`${docs[i].id}:${docs[j].id}`);
      }
    }
    const actual = new Set();
    findSimilarPairs(docs, threshold, (a, b) =>
      actual.add(`${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`));

    assert.deepEqual([...actual].sort(), [...expected].sort(), `threshold ${threshold} 的结果不一致`);
  }
});

// v0.0.7：overlap 系数的分母是较短者，短标题因此极易越过阈值——
// 14 字的标题只有 13 个 bigram，撞上 6 个就是 0.46。并查集又是单链接聚类，
// A~B、B~C、C~D 会把整条链并成一簇；实测 2000 条规模下出现过 149 条的巨簇。
test('绝对交集下限切断短标题的串链，只保留真正共享足够多字的相似对', () => {
  const docs = [
    { id: 1, text: '我国成功发射千帆极轨卫星', domain: 'aerospace' },
    { id: 2, text: '我国成功发射天链卫星', domain: 'aerospace' }
  ].map(doc => ({ ...doc, grams: bigrams(doc.text) }));

  const withoutFloor = new Set();
  findSimilarPairs(docs, 0.42, (a, b) => withoutFloor.add(`${a.id}:${b.id}`), 0);
  const withFloor = new Set();
  findSimilarPairs(docs, 0.42, (a, b) => withFloor.add(`${a.id}:${b.id}`), 8);

  // 「我国成功发射」+「卫星」共 7 个 bigram，比例够但绝对量不够：正是要挡的那种
  assert.equal(withoutFloor.size, 1, '不设下限时这两条会被判为同一事件');
  assert.equal(withFloor.size, 0, '设下限后不再合并');
});

test('簇容量上限阻止相似度误判吞掉半个库', () => {
  const sourceId = db.prepare(`INSERT INTO sources (name, type, url, tier, domain)
    VALUES ('容量测试', 'rss', ?, 'T2', 'aerospace')`)
    .run(`https://example.com/cap-${Date.now()}`).lastInsertRowid;
  const insert = db.prepare(`INSERT INTO articles
    (source_id, title, url, fetched_at, relevant, analyzed, quality_score, domain)
    VALUES (?, ?, ?, ?, 1, 1, 70, 'aerospace')`);
  const stamp = Date.now();
  // 40 条近乎一致的标题：不设上限会并成一个 40 条的巨簇
  for (let i = 0; i < 40; i++) {
    insert.run(sourceId,
      `蓝箭航天朱雀三号运载火箭首次入轨发射任务取得圆满成功第${i}报`,
      `https://example.com/cap-${stamp}-${i}`, now());
  }

  clusterRecent();
  const maxSize = db.prepare('SELECT MAX(size) m FROM clusters').get().m;
  const configured = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'config', 'scoring.json'), 'utf8')).clusterMaxSize;
  assert.ok(maxSize <= configured, `最大簇 ${maxSize} 超过上限 ${configured}`);
  // 上限不是「丢掉多余的」：剩下的条目应当另起新簇，而不是被扔在簇外
  assert.ok(db.prepare('SELECT COUNT(*) c FROM clusters').get().c >= 2, '越界的成员应当另成簇');

  db.prepare('DELETE FROM articles WHERE source_id = ?').run(sourceId);
  db.prepare('DELETE FROM sources WHERE id = ?').run(sourceId);
  clusterRecent();
});

test('an unchanged corpus is detected and reclustering performs no writes', () => {
  const sourceId = db.prepare(`INSERT INTO sources (name, type, url, tier, domain)
    VALUES ('幂等测试', 'rss', ?, 'T2', 'aerospace')`).run(`https://example.com/idempotent-${Date.now()}`).lastInsertRowid;
  const insert = db.prepare(`INSERT INTO articles
    (source_id, title, url, fetched_at, relevant, analyzed, quality_score, domain)
    VALUES (?, ?, ?, ?, 1, 1, ?, 'aerospace')`);
  const stamp = Date.now();
  insert.run(sourceId, '蓝箭航天朱雀三号首次入轨发射成功', `https://example.com/i1-${stamp}`, now(), 70);
  insert.run(sourceId, '蓝箭航天朱雀三号首次入轨发射任务成功', `https://example.com/i2-${stamp}`, now(), 80);

  const first = clusterRecent();
  assert.equal(first.clusters, 1);
  assert.notEqual(first.unchanged, true);

  const clusterIdAfterFirst = db.prepare('SELECT id FROM clusters ORDER BY id DESC LIMIT 1').get().id;
  const second = clusterRecent();
  assert.equal(second.unchanged, true);
  assert.equal(second.clusters, 1);
  // 跳过写入的关键证据：簇的主键没有被重建
  assert.equal(db.prepare('SELECT id FROM clusters ORDER BY id DESC LIMIT 1').get().id, clusterIdAfterFirst);

  // 主条应随质量分变化被重新推举，此时必须回到写入路径
  db.prepare('UPDATE articles SET quality_score = 99 WHERE url = ?').run(`https://example.com/i1-${stamp}`);
  const third = clusterRecent();
  assert.notEqual(third.unchanged, true);
  assert.equal(third.clusters, 1);

  db.prepare('DELETE FROM articles WHERE source_id = ?').run(sourceId);
  db.prepare('DELETE FROM sources WHERE id = ?').run(sourceId);
  clusterRecent();
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
