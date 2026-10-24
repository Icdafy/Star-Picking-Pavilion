'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { repairPublicationTimes } = require('../server/publication-time');

function fixture(count = 4) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sources(id INTEGER PRIMARY KEY,intl INTEGER,enabled INTEGER,removed_at TEXT,type TEXT,tier TEXT);
    INSERT INTO sources VALUES(1,0,1,NULL,'rss','T1');
    CREATE TABLE articles(id INTEGER PRIMARY KEY,source_id INTEGER,url TEXT,published_at TEXT,
      relevant INTEGER DEFAULT 1,starred INTEGER DEFAULT 0,featured INTEGER DEFAULT 0,publication_checked_at TEXT,
      fetched_at TEXT,imported_backfill INTEGER DEFAULT 0,historical INTEGER DEFAULT 0,publication_precision TEXT,publication_date_text TEXT);
    CREATE TABLE story_signals(article_id INTEGER,observed_at TEXT);`);
  for (let id = 1; id <= count; id++) db.prepare('INSERT INTO articles(id,source_id,url,fetched_at) VALUES(?,1,?,?)').run(id, `https://news.example/repair-${id}`, new Date().toISOString());
  return db;
}

test('历史日期修复最多两个请求并行，处理全部记录并保留网络等待重试资格', async () => {
  const db = fixture();
  let active = 0, maxActive = 0;
  const seen = [];
  try {
    const result = await repairPublicationTimes(db, { enrich: async row => {
      seen.push(row.id);
      active++; maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setImmediate(resolve));
      active--;
      return row.id === 3 ? { status: 'network-wait' } : { status: 'ok', publishedAt: row.fetched_at, publicationPrecision: 'day' };
    } });
    assert.deepEqual(result, { attempted: 3, repaired: 3 });
    assert.equal(maxActive, 2);
    assert.deepEqual(seen, [4, 3, 2, 1]);
    assert.equal(db.prepare('SELECT publication_checked_at FROM articles WHERE id=3').get().publication_checked_at, null);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM articles WHERE published_at IS NOT NULL').get().n, 3);
  } finally { db.close(); }
});

test('一个日期修复请求抛错后等待其他工作全部退出，返回后没有后台落库', async () => {
  const db = fixture(2);
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let settled = false, active = 0;
  const updates = [];
  const operation = repairPublicationTimes(db, { onProgress: p => updates.push(p), enrich: async row => {
    active++;
    try {
      if (row.id === 2) throw new Error('repair fixture failure');
      await blocked;
      return { status: 'ok', publishedAt: row.fetched_at };
    } finally { active--; }
  } });
  operation.then(() => { settled = true; }, () => { settled = true; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(active, 1);
    assert.ok(updates.some(p => p.taskId === 'publication:2' && p.status === 'failed'));
    assert.ok(updates.some(p => p.taskId === 'publication:1' && p.status === 'running'));
    assert.equal(updates.some(p => p.taskId === 'publication:1' && p.status !== 'running'), false, '另一条日期核验仍在进行');
    assert.equal(updates.some(p => !p.taskId && p.status === 'failed'), false, '全部在途请求结束后才报告整阶段失败');
    release();
    await assert.rejects(operation, /fixture failure/);
    assert.equal(active, 0);
    assert.equal(updates.at(-1).status, 'failed');
    assert.equal(updates.at(-1).done, 2);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM articles WHERE published_at IS NOT NULL').get().n, 1);
  } finally { release(); await operation.catch(() => {}); db.close(); }
});

test('日期修补空队列报告0/0完成，进度订阅失败不改变修补结果', async () => {
  const empty = fixture(0), db = fixture(2);
  const emptyUpdates = [];
  try {
    assert.deepEqual(await repairPublicationTimes(empty, { onProgress: p => emptyUpdates.push(p) }), { attempted: 0, repaired: 0 });
    assert.deepEqual(emptyUpdates.map(p => [p.status, p.done, p.total]), [['running', 0, 0], ['completed', 0, 0]]);
    const warn = console.warn;
    console.warn = () => {};
    try {
      assert.deepEqual(await repairPublicationTimes(db, {
        onProgress() { throw new Error('observer failure'); },
        enrich: async row => ({ status: 'ok', publishedAt: row.fetched_at })
      }), { attempted: 2, repaired: 2 });
    } finally { console.warn = warn; }
    assert.equal(db.prepare('SELECT COUNT(*) n FROM articles WHERE published_at IS NOT NULL').get().n, 2);
  } finally { empty.close(); db.close(); }
});
