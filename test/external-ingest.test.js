'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-ingest-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = dir;
const { db, closeDatabase } = require('../server/db');
const { ingestItems } = require('../server/ingest');
const { isHistorical, analyzePending } = require('../server/ai/pipeline');
const { docOf, groupPending } = require('../server/ai/stories');
const { sanitizeSourceInput } = require('../server/input-validation');
const { seedSources, collectAll } = require('../server/collectors');
const { startServer } = require('./helpers/server-child');
const { API_TOKEN_HEADER } = require('../server/http-security');
test.after(() => { closeDatabase(); fs.rmSync(dir, { recursive: true, force: true }); });

test('external imports deduplicate, preserve backfill through analysis, and never poll external sources', async () => {
  seedSources();
  db.prepare('UPDATE sources SET enabled=0').run();
  const sourceId = Number(db.prepare("INSERT INTO sources(name,type,url,domain) VALUES('测试导入','external','external://test','aerospace')").run().lastInsertRowid);
  assert.equal(sanitizeSourceInput({ name: '导入', type: 'external', url: 'external://news-feed' }).type, 'external');
  assert.throws(() => sanitizeSourceInput({ name: '导入', type: 'external', url: 'https://example.org' }), /external/);
  const at = Date.now();
  const article = { title: '新型运载火箭完成测试', url: 'https://example.org/news?utm_source=one', publishedAt: new Date(at).toISOString(),
    contentText: '<p>真实正文</p><script>不应留下</script>', raw: { _aihot: { backfill: true } }, featured: 1, relevant: 1 };
  assert.deepEqual(ingestItems({ sourceId, items: [article, { ...article, url: 'https://example.org/news?utm_source=two' }] }, at),
    { ok: true, received: 2, created: 1, duplicates: 1 });
  const row = db.prepare('SELECT * FROM articles WHERE source_id=?').get(sourceId);
  assert.equal(row.content_text, '真实正文');
  assert.equal(row.historical, 1);
  assert.equal(row.imported_backfill, 1);
  assert.equal(row.analyzed, 0);
  assert.equal(row.featured, 0);
  assert.equal(row.relevant, null);
  assert.equal(isHistorical(row, { historicalHours: 48 }), true);
  assert.equal(docOf({ ...row, historical: 0 }).historical, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM articles_fts').get().n, 1);
  assert.equal(ingestItems({ sourceId, items: [article] }, at).duplicates, 1);
  assert.throws(() => ingestItems({ sourceId, items: [{ ...article, url: 'https://example.org/valid' }, { ...article, publishedAt: '2026-02-30T08:00:00Z' }] }, at), /发布时间/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM articles').get().n, 1, 'batch validation happens before any insert');
  for (const item of [{ ...article, url: 'javascript:alert(1)' }, { ...article, url: 'https://user:secret@example.org/' },
    { ...article, backfill: 'yes' }, { ...article, publishedAt: new Date(at + 86400000).toISOString() }]) {
    assert.throws(() => ingestItems({ sourceId, items: [item] }, at), error => error.statusCode === 400);
  }
  const old = { ...article, raw: undefined, url: 'https://example.org/old', publishedAt: new Date(at - 5 * 86400000).toISOString() };
  ingestItems({ sourceId, items: [old] }, at);
  assert.equal(db.prepare('SELECT historical FROM articles WHERE url=?').get(old.url).historical, 1);
  require('../server/runtime-credentials').setApiKey('');
  assert.equal((await analyzePending()).mode, 'heuristic');
  const analyzed = db.prepare('SELECT * FROM articles WHERE id=?').get(row.id);
  assert.equal(analyzed.relevant, 1);
  assert.equal(analyzed.analyzed, 3);
  assert.equal(analyzed.historical, 1, 'real pending query must carry the backfill flag into persistence');
  await groupPending();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM story_signals').get().n, 0, 'backfilled articles never create fresh heat signals');
  const before = db.prepare('SELECT fetch_count FROM sources WHERE id=?').get(sourceId).fetch_count;
  assert.equal((await collectAll(undefined, { force: true })).results.length, 0);
  assert.equal(db.prepare('SELECT fetch_count FROM sources WHERE id=?').get(sourceId).fetch_count, before);
  for (let i = 0; i < 7; i++) ingestItems({ sourceId, items: [article] }, at);
  assert.throws(() => ingestItems({ sourceId, items: [article] }, at), error => error.statusCode === 429);
  assert.equal(ingestItems({ sourceId, items: [article] }, at + 60001).duplicates, 1);
  db.prepare('UPDATE sources SET enabled=0 WHERE id=?').run(sourceId);
  assert.throws(() => ingestItems({ sourceId, items: [article] }, at + 60001), error => error.statusCode === 409);
});

test('ingest HTTP boundary enforces token, source ownership/type, payload bounds and idempotence', async t => {
  const server = await startServer(t);
  const headers = { [API_TOKEN_HEADER]: server.token, 'content-type': 'application/json' };
  const post = (pathname, body, h = headers) => server.request({ method: 'POST', pathname, headers: h, body: JSON.stringify(body) });
  const made = await post('/api/sources', { name: '外部测试', type: 'external', url: 'external://http-test', domain: 'aerospace' });
  assert.equal(made.status, 200);
  const sourceId = JSON.parse(made.body).id;
  const body = { sourceId, items: [{ title: '火箭测试原文', url: 'https://example.org/launch', backfill: true }] };
  assert.equal((await post('/api/ingest/items', body, { 'content-type': 'application/json' })).status, 403);
  assert.equal((await post('/api/ingest/items', { ...body, sourceId: 1 })).status, 409);
  assert.equal((await post('/api/ingest/items', { ...body, sourceId: 999999 })).status, 404);
  assert.equal((await post('/api/ingest/items', { ...body, items: Array(51).fill(body.items[0]) })).status, 400);
  assert.equal((await post('/api/ingest/items', { ...body, items: [{ ...body.items[0], summary: 'x'.repeat(70000) }] })).status, 413);
  assert.equal((await post('/api/ingest/items', body, { ...headers, 'content-type': 'text/plain' })).status, 415);
  assert.equal(JSON.parse((await post('/api/ingest/items', body)).body).created, 1);
  assert.equal(JSON.parse((await post('/api/ingest/items', body)).body).duplicates, 1);
  assert.equal((await server.request({ pathname: '/api/ingest/items', headers })).status, 404);
  const info = JSON.parse((await server.request({ pathname: '/api/industry', headers })).body);
  assert.equal(info.budget.dayCalls, 0, 'import queues raw content without calling a model');
});
