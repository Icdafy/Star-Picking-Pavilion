'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-translation-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = dataDir;
const { db, closeDatabase, insertArticle } = require('../server/db');
const { needsChinese, normalizeTranslations, translatePending, translateBatch } = require('../server/ai/translation');
const { usageSnapshot } = require('../server/ai/receipts');
test.after(() => { closeDatabase(); fs.rmSync(dataDir, { recursive: true, force: true }); });
const originals = [{ id: 7, title: 'SpaceX completes rocket flight test', summary_raw: 'SpaceX completed a rocket flight test.' }];
const translated = { id: 7, titleZh: 'SpaceX完成火箭飞行试验', summaryZh: 'SpaceX完成了一次火箭飞行试验。', names: [] };

test('翻译判断保留中文中的英文专名，英文和其他外文材料进入翻译', () => {
  assert.equal(needsChinese('SpaceX完成火箭发射', 'Joby启动试飞'), false);
  assert.equal(needsChinese('SpaceX'), false);
  assert.equal(needsChinese(originals[0].title, originals[0].summary_raw), true);
  assert.equal(needsChinese('Rocket Lab完成发射', 'Rocket Lab has launched a satellite.'), true);
  assert.equal(needsChinese('SpaceX completes rocket flight test（任务更新）'), true);
  assert.equal(needsChinese('UAV完成测试', '试飞高度100 km，型号A320'), false);
});

test('拒绝未译正文、丢失专名、缺项、重复或串号的译文', () => {
  assert.deepEqual(normalizeTranslations({ items: [translated] }, originals), [translated]);
  assert.throws(() => normalizeTranslations({ items: [] }, originals), /条目数/);
  assert.throws(() => normalizeTranslations({ items: [{ ...translated, id: 8 }] }, originals), /序号/);
  assert.throws(() => normalizeTranslations({ items: [{ ...translated, summaryZh: 'SpaceX completed a rocket flight test.' }] }, originals), /中文/);
  assert.throws(() => normalizeTranslations({ items: [{ ...translated, titleZh: '火箭公司完成了飞行试验' }] }, originals), /专有名称/);
});

function addOriginal(n) {
  const source = Number(db.prepare(`INSERT INTO sources(name,type,url,tier,domain,intl) VALUES('海外','rss',?,'T2','aerospace',1)`)
    .run(`https://example.test/translation-${n}.xml`).lastInsertRowid);
  insertArticle({ sourceId: source, title: originals[0].title, summaryRaw: originals[0].summary_raw,
    url: `https://example.test/translation-${n}`, translationStatus: 'pending' });
  return db.prepare('SELECT * FROM articles WHERE source_id=?').get(source);
}

test('无模型与预算熔断保留待译数据；成功译文原子入库、可检索，星标和原文保持', async () => {
  const row = addOriginal(1);
  db.prepare('UPDATE articles SET starred=1,title_zh=?,ai_summary=? WHERE id=?').run(row.title, row.summary_raw, row.id);
  const cluster = db.prepare('INSERT INTO clusters(main_article_id,size,title,digest) VALUES(?,1,?,?)').run(row.id, row.title, row.summary_raw);
  const noKey = await translatePending({ ai: { apiKey: '' } }, { translate: () => { throw new Error('must not call'); } });
  assert.equal(noKey.waitingForModel, true);
  assert.equal(db.prepare('SELECT translation_status FROM articles WHERE id=?').get(row.id).translation_status, 'pending');
  const budget = await translatePending({ ai: { apiKey: 'test' } }, { translate: () => { const error = new Error('budget'); error.budgetExceeded = true; throw error; } });
  assert.equal(budget.budgetPaused, true);
  assert.equal(db.prepare('SELECT translation_retry_at FROM articles WHERE id=?').get(row.id).translation_retry_at, null);
  const result = await translatePending({ ai: { apiKey: 'test' } }, { translate: async articles => articles.map(a => ({ ...translated, id: a.id })) });
  assert.equal(result.translated, 1);
  const actual = db.prepare('SELECT * FROM articles WHERE id=?').get(row.id);
  assert.equal(actual.title, row.title);
  assert.equal(actual.summary_raw, row.summary_raw);
  assert.equal(actual.starred, 1);
  assert.equal(actual.title_zh, translated.titleZh);
  assert.equal(actual.ai_summary, translated.summaryZh);
  assert.equal(actual.translation_status, 'translated');
  const story = db.prepare('SELECT title,digest FROM clusters WHERE id=?').get(cluster.lastInsertRowid);
  assert.equal(story.title, translated.titleZh);
  assert.equal(story.digest, translated.summaryZh);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM articles_fts WHERE articles_fts MATCH '火箭飞行'").get().c, 1);
});

test('翻译失败等待下轮，坏译文不会写入回执或覆盖原文', async () => {
  const row = addOriginal(2);
  const nowMs = Date.now();
  const result = await translatePending({ ai: { apiKey: 'test' } }, { nowMs, translate: async articles => articles.map(a => ({ ...translated, id: a.id, titleZh: a.title })) });
  assert.equal(result.deferred, 1);
  const actual = db.prepare('SELECT * FROM articles WHERE id=?').get(row.id);
  assert.equal(actual.translation_status, 'pending');
  assert.equal(actual.translation_json, null);
  assert.equal(actual.title, row.title);
  assert.ok(Date.parse(actual.translation_retry_at) > nowMs);
});

test('真实兼容模型 HTTP 调用保留名称并复用回执，不重复花费额度', async () => {
  let requests = 0;
  const server = http.createServer((req, res) => {
    let text = '';
    req.on('data', x => { text += x; });
    req.on('end', () => {
      requests++;
      const body = JSON.parse(text);
      assert.match(body.messages[0].content, /专有名词保留原文英文拼写/);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [translated] }) } }] }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const settings = { ai: { apiKey: 'test-only', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai', model: 'translation-test', requestTimeoutMs: 1000 } };
    const before = usageSnapshot().hourCalls;
    assert.deepEqual(await translateBatch(originals, settings), [translated]);
    assert.deepEqual(await translateBatch(originals, settings), [translated]);
    assert.equal(requests, 1);
    assert.equal(usageSnapshot().hourCalls, before + 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
