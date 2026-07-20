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
});

test('DELETE /api/sources/:id disables a source and preserves its articles', async t => {
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

  const removed = await server.request({
    method: 'DELETE',
    pathname: `/api/sources/${sourceId}`,
    headers: { [API_TOKEN_HEADER]: server.token }
  });
  assert.equal(removed.status, 200);

  const reader = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(reader.prepare('SELECT enabled FROM sources WHERE id=?').get(sourceId).enabled, 0);
  assert.equal(
    reader.prepare('SELECT source_id FROM articles WHERE id=?').get(article.lastInsertRowid).source_id,
    sourceId
  );
  reader.close();
});
