'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-backend-integrity-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = dataDir;
const { db, closeDatabase } = require('../server/db');
const { collectAll, seedSources } = require('../server/collectors');
const { withReceipt, reserveCall, buckets } = require('../server/ai/receipts');

test.after(async () => { closeDatabase(); await fs.promises.rm(dataDir, { recursive: true, force: true }); });

async function localFeed(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  seedSources();
  db.exec('UPDATE sources SET enabled=0');
  const id = db.prepare("INSERT INTO sources (name,type,url,tier,domain) VALUES ('原子信源','rss',?,'T2','aerospace')")
    .run(`http://127.0.0.1:${server.address().port}/feed`).lastInsertRowid;
  return id;
}

const rss = '<rss version="2.0"><channel><title>本地测试</title><item><title>火箭首飞一</title><link>https://example.com/atomic-one</link></item><item><title>火箭首飞二</title><link>https://example.com/atomic-two</link></item></channel></rss>';

test('a feed batch and its FTS rows roll back together when a later item fails', async t => {
  const sourceId = await localFeed(t, (_req, res) => res.end(rss));
  db.exec("CREATE TRIGGER fail_second_item BEFORE INSERT ON articles WHEN NEW.url='https://example.com/atomic-two' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
  try {
    const result = await collectAll();
    assert.match(result.results[0].error, /fixture failure/);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM articles WHERE source_id=?').get(sourceId).c, 0);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM articles_fts WHERE title LIKE '%火箭首飞%' ").get().c, 0);
    assert.equal(db.prepare('SELECT item_count FROM sources WHERE id=?').get(sourceId).item_count, 0);
  } finally { db.exec('DROP TRIGGER fail_second_item'); }
  const retry = await collectAll(null, { force: true });
  assert.equal(retry.results[0].added, 2);
  assert.equal(db.prepare('SELECT item_count FROM sources WHERE id=?').get(sourceId).item_count, 2);
});

for (const mutation of ['disable', 'remove', 'change-url', 'change-selector']) {
  test(`an in-flight response is discarded after the source is ${mutation}`, async t => {
    let finish, received;
    const waiting = new Promise(resolve => { received = resolve; });
    const sourceId = await localFeed(t, (_req, res) => { finish = () => res.end(rss.replace(/atomic-/g, `${mutation}-`)); received(); });
    const operation = collectAll();
    await waiting;
    if (mutation === 'disable') db.prepare('UPDATE sources SET enabled=0 WHERE id=?').run(sourceId);
    if (mutation === 'remove') require('../server/source-lifecycle').removeSource(sourceId);
    if (mutation === 'change-url') db.prepare('UPDATE sources SET url=? WHERE id=?').run('https://example.com/changed', sourceId);
    if (mutation === 'change-selector') db.prepare('UPDATE sources SET selector_json=? WHERE id=?').run('{}', sourceId);
    finish();
    const result = await operation;
    assert.equal(result.results[0].skipped, true);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM articles WHERE source_id=?').get(sourceId).c, 0);
    assert.equal(db.prepare('SELECT fetch_count FROM sources WHERE id=?').get(sourceId).fetch_count, 0);
  });
}

test('concurrent identical model work reserves and pays for one call, then reuses its receipt', async () => {
  let finish, calls = 0;
  const gate = new Promise(resolve => { finish = resolve; });
  const run = () => withReceipt({ task: 'shared-fixture', keyParts: ['same-input'], call: async () => { calls++; await gate; return { ok: true }; } });
  const first = run(), second = run();
  const callsBeforeCompletion = calls;
  finish();
  const results = await Promise.all([first, second]);
  assert.equal(callsBeforeCompletion, 1);
  assert.deepEqual(results.map(result => result.value), [{ ok: true }, { ok: true }]);
  assert.equal(results[1].shared, true);
  assert.equal((await run()).cached, true);
  assert.equal(calls, 1);
});

test('shared failures clear the pending receipt so a later attempt can succeed', async () => {
  let finish, calls = 0;
  const gate = new Promise(resolve => { finish = resolve; });
  const run = () => withReceipt({ task: 'failed-shared-fixture', keyParts: ['input'], call: async () => { calls++; await gate; throw new Error('offline'); } });
  const first = run(), second = run();
  const failures = Promise.allSettled([first, second]);
  finish();
  assert.ok((await failures).every(result => result.status === 'rejected'));
  assert.equal(calls, 1);
  const retried = await withReceipt({ task: 'failed-shared-fixture', keyParts: ['input'], call: async () => ({ ok: true }) });
  assert.equal(retried.value.ok, true);
});

test('hourly and daily budget reservations commit atomically', () => {
  const stamp = Date.parse('2030-01-02T03:00:00Z');
  const { hour, day } = buckets(stamp);
  db.exec("CREATE TRIGGER fail_daily_usage BEFORE INSERT ON model_usage WHEN NEW.bucket LIKE 'd:2030%' BEGIN SELECT RAISE(ABORT, 'usage failure'); END");
  try {
    assert.throws(() => reserveCall(stamp, { maxCallsPerHour: 10, maxCallsPerDay: 10 }), /usage failure/);
    assert.equal(db.prepare('SELECT calls FROM model_usage WHERE bucket=?').get(hour), undefined);
    assert.equal(db.prepare('SELECT calls FROM model_usage WHERE bucket=?').get(day), undefined);
  } finally { db.exec('DROP TRIGGER fail_daily_usage'); }
  reserveCall(stamp, { maxCallsPerHour: 10, maxCallsPerDay: 10 });
  assert.equal(db.prepare('SELECT calls FROM model_usage WHERE bucket=?').get(hour).calls, 1);
  assert.equal(db.prepare('SELECT calls FROM model_usage WHERE bucket=?').get(day).calls, 1);
});

test('timing repair pauses on budget exhaustion without consuming a repair attempt', async () => {
  const sourceId = db.prepare("INSERT INTO sources(name,type,url) VALUES ('日期补提取','rss','https://example.com/timing-budget')").run().lastInsertRowid;
  const stamp = new Date().toISOString();
  const id = db.prepare(`INSERT INTO articles(source_id,title,url,fetched_at,published_at,analyzed,relevant,featured,content_text)
    VALUES (?,'火箭首飞','https://example.com/timing-repair',?,?,1,1,1,'火箭完成首飞。')`).run(sourceId, stamp, stamp).lastInsertRowid;
  const { BudgetExceededError } = require('../server/ai/receipts');
  const { repairTiming } = require('../server/ai/timing-repair');
  const result = await repairTiming(db, { hasKey: true, enrich: async () => { throw new Error('not needed'); },
    extract: async () => { throw new BudgetExceededError('hour', 1); } });
  assert.equal(result.budgetPaused, true);
  assert.equal(result.attempted, 0);
  const row = db.prepare('SELECT timing_repair_attempts,timing_repair_at,timing_repair_error FROM articles WHERE id=?').get(id);
  assert.equal(row.timing_repair_attempts, 0);
  assert.equal(row.timing_repair_at, null);
  assert.equal(row.timing_repair_error, null);
});
