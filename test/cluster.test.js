'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-cluster-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = dataDir;

const { closeDatabase } = require('../server/db');
const { bigrams, overlap, findSimilarPairs } = require('../server/ai/cluster');

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
