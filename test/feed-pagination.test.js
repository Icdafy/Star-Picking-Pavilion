'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { API_TOKEN_HEADER } = require('../server/http-security');
const { startServer } = require('./helpers/server-child');

test('hot feed pages use one stable heat-ranked candidate set without duplicate articles', async t => {
  const server = await startServer(t);
  const database = new DatabaseSync(path.join(server.dataDir, 'star-picking-pavilion.db'));
  const sourceId = database.prepare(`INSERT INTO sources (name, type, url, tier, domain)
    VALUES ('分页测试', 'rss', ?, 'T2', 'aerospace')`).run(`https://example.com/${Date.now()}`).lastInsertRowid;
  const insert = database.prepare(`INSERT INTO articles
    (source_id, title, url, fetched_at, published_at, relevant, analyzed, quality_score, domain)
    VALUES (?, ?, ?, ?, ?, 1, 1, ?, 'aerospace')`);
  const now = new Date();
  const old = new Date(Date.now() - 30 * 86400e3);
  database.exec('BEGIN');
  try {
    for (let rank = 0; rank < 70; rank++) {
      const date = rank < 30 ? old : now;
      insert.run(
        sourceId,
        `热点分页文章 ${rank}`,
        `https://example.com/article-${Date.now()}-${rank}`,
        date.toISOString(),
        date.toISOString(),
        100 - rank * 0.4
      );
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }

  const headers = { [API_TOKEN_HEADER]: server.token };
  const first = JSON.parse((await server.request({ pathname: '/api/feed?view=hot&page=0', headers })).body);
  const second = JSON.parse((await server.request({ pathname: '/api/feed?view=hot&page=1', headers })).body);
  assert.equal(first.items.length, 30);
  assert.equal(second.items.length, 30);
  const firstIds = new Set(first.items.map(item => item.id));
  assert.equal(second.items.some(item => firstIds.has(item.id)), false);
});
