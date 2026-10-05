'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { API_TOKEN_HEADER } = require('../server/http-security');
const { startServer } = require('./helpers/server-child');

test('static responses send a restrictive browser security policy', async t => {
  const server = await startServer(t);
  const response = await server.request({ pathname: '/' });

  assert.equal(response.status, 200);
  assert.match(response.headers['content-security-policy'], /script-src 'self'/);
  assert.match(response.headers['content-security-policy'], /object-src 'none'/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.equal(response.headers['x-frame-options'], 'DENY');

  const traversal = await server.request({ pathname: '/..%2fpackage.json' });
  assert.equal(traversal.status, 404);
  assert.doesNotMatch(traversal.body, /"name"\s*:\s*"star-picking-pavilion"/);

  const post = await server.request({ method: 'POST', pathname: '/' });
  assert.equal(post.status, 405);
});

test('DELETE removes active or paused sources from the list while preserving article attribution, and explicit re-add restores the row', async t => {
  const server = await startServer(t);
  const headers = {
    [API_TOKEN_HEADER]: server.token,
    'content-type': 'application/json'
  };
  const created = await server.request({
    method: 'POST',
    pathname: '/api/sources',
    headers,
    body: JSON.stringify({
      name: '生命周期测试信源',
      type: 'rss',
      url: `https://example.com/source-${Date.now()}.xml`
    })
  });
  assert.equal(created.status, 200);
  const sourceId = Number(JSON.parse(created.body).id);

  const databasePath = path.join(server.dataDir, 'star-picking-pavilion.db');
  assert.equal(fs.existsSync(databasePath), true);
  const writer = new DatabaseSync(databasePath);
  const article = writer.prepare(`INSERT INTO articles
    (source_id, title, url, fetched_at) VALUES (?, ?, ?, ?)`)
    .run(sourceId, '保留文章', `https://example.com/article-${Date.now()}`, new Date().toISOString());
  writer.close();
  const statsBefore = JSON.parse((await server.request({ pathname: '/api/stats', headers })).body);

  const removed = await server.request({
    method: 'DELETE',
    pathname: `/api/sources/${sourceId}`,
    headers: { [API_TOKEN_HEADER]: server.token }
  });
  assert.equal(removed.status, 200);
  assert.equal(JSON.parse(removed.body).removed, true);
  const listed = await server.request({ pathname: '/api/sources', headers });
  assert.equal(JSON.parse(listed.body).some(source => source.id === sourceId), false);
  const statsAfter = JSON.parse((await server.request({ pathname: '/api/stats', headers })).body);
  assert.equal(statsAfter.sourcesTotal, statsBefore.sourcesTotal - 1);
  assert.equal(statsAfter.articles, statsBefore.articles, '移出入口不能降低历史文章数');
  for (const [method, pathname, body] of [
    ['PATCH', `/api/sources/${sourceId}`, JSON.stringify({ enabled: true })],
    ['POST', `/api/sources/${sourceId}/retry`, undefined],
    ['DELETE', `/api/sources/${sourceId}`, undefined]
  ]) {
    assert.equal((await server.request({ method, pathname, headers, body })).status, 404);
  }

  const reader = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(reader.prepare('SELECT enabled FROM sources WHERE id=?').get(sourceId).enabled, 0);
  assert.equal(
    reader.prepare('SELECT source_id FROM articles WHERE id=?').get(article.lastInsertRowid).source_id,
    sourceId
  );
  const originalUrl = reader.prepare('SELECT url FROM sources WHERE id=?').get(sourceId).url;
  reader.close();
  const restored = await server.request({ method: 'POST', pathname: '/api/sources', headers, body: JSON.stringify({
    name: '恢复来源', type: 'rss', url: originalUrl
  }) });
  assert.equal(restored.status, 200);
  assert.equal(Number(JSON.parse(restored.body).id), sourceId);
  const paused = await server.request({ method: 'PATCH', pathname: `/api/sources/${sourceId}`, headers, body: JSON.stringify({ enabled: false }) });
  assert.equal(paused.status, 200);
  assert.equal((await server.request({ method: 'DELETE', pathname: `/api/sources/${sourceId}`, headers })).status, 200);
});
