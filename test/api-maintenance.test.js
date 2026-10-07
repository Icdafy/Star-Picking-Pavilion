'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { API_TOKEN_HEADER } = require('../server/http-security');
const { startServer } = require('./helpers/server-child');

test('source URL conflicts return actionable 409 responses without changing either source', async t => {
  const server = await startServer(t);
  const headers = { [API_TOKEN_HEADER]: server.token, 'content-type': 'application/json' };
  const create = async (name, url) => server.request({ method: 'POST', pathname: '/api/sources', headers,
    body: JSON.stringify({ name, type: 'rss', url }) });
  const first = await create('冲突前信源', 'https://example.com/api-conflict-one');
  assert.equal(first.status, 200);
  const id = JSON.parse(first.body).id;
  const duplicate = await create('重复信源', 'https://example.com/api-conflict-one');
  assert.equal(duplicate.status, 409);
  assert.match(JSON.parse(duplicate.body).error, /信源地址已存在/);
  const second = await create('第二信源', 'https://example.com/api-conflict-two');
  const secondId = JSON.parse(second.body).id;
  const update = await server.request({ method: 'PATCH', pathname: `/api/sources/${secondId}`, headers,
    body: JSON.stringify({ name: '不应写入', url: 'https://example.com/api-conflict-one' }) });
  assert.equal(update.status, 409);
  const list = JSON.parse((await server.request({ pathname: '/api/sources', headers })).body);
  assert.equal(list.find(source => source.id === secondId).name, '第二信源');
  assert.equal(list.find(source => source.id === secondId).url, 'https://example.com/api-conflict-two');
  await server.request({ method: 'DELETE', pathname: `/api/sources/${id}`, headers });
  const restored = await create('恢复信源', 'https://example.com/api-conflict-one');
  assert.equal(restored.status, 200);
  assert.equal(JSON.parse(restored.body).id, id);
});

test('accepted HTTP cleanup exposes its own failure, releases the lock and retries without corrupting articles or FTS', async t => {
  const server = await startServer(t);
  const headers = { [API_TOKEN_HEADER]: server.token };
  const database = new DatabaseSync(path.join(server.dataDir, 'star-picking-pavilion.db'));
  try {
    database.exec('PRAGMA foreign_keys=ON');
    const sourceId = database.prepare('SELECT id FROM sources LIMIT 1').get().id;
    const id = database.prepare(`INSERT INTO articles(source_id,title,url,fetched_at,relevant)
      VALUES (?,'过期测试资料','https://example.com/expired-api-fixture','2020-01-01T00:00:00Z',0)`)
      .run(sourceId).lastInsertRowid;
    database.prepare('INSERT INTO articles_fts(rowid,title,summary) VALUES (?,?,?)').run(id, '过期测试资料', '回滚证据');
    database.exec(`CREATE TRIGGER fail_api_prune BEFORE DELETE ON articles WHEN OLD.id=${Number(id)}
      BEGIN SELECT RAISE(ABORT,'private fixture failure'); END`);
    const trigger = () => server.request({ method: 'POST', pathname: '/api/maintenance/prune', headers });
    async function completed(pruneId) {
      for (let attempt = 0; attempt < 200; attempt++) {
        const response = await server.request({ pathname: '/api/maintenance', headers });
        assert.equal(response.status, 200);
        const snapshot = JSON.parse(response.body);
        if (!snapshot.pruneRunning && snapshot.scheduler.lastPrune?.id === pruneId) return snapshot.scheduler.lastPrune;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error('cleanup did not report completion');
    }
    const accepted = await trigger();
    assert.equal(accepted.status, 202);
    const firstId = JSON.parse(accepted.body).pruneId;
    assert.ok(Number.isInteger(firstId));
    const failed = await completed(firstId);
    assert.equal(failed.ok, false);
    assert.match(failed.error, /清理未完成/);
    assert.doesNotMatch(failed.error, /private fixture/);
    assert.ok(database.prepare('SELECT id FROM articles WHERE id=?').get(id));
    assert.ok(database.prepare('SELECT rowid FROM articles_fts WHERE rowid=?').get(id));
    database.exec('DROP TRIGGER fail_api_prune');
    const retry = await trigger();
    assert.equal(retry.status, 202);
    const secondId = JSON.parse(retry.body).pruneId;
    assert.notEqual(secondId, firstId);
    assert.equal((await completed(secondId)).ok, true);
    assert.equal(database.prepare('SELECT id FROM articles WHERE id=?').get(id), undefined);
    assert.equal(database.prepare('SELECT rowid FROM articles_fts WHERE rowid=?').get(id), undefined);
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(database.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  } finally { database.close(); }
});
