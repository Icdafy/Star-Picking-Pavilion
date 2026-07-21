'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { API_TOKEN_HEADER, MAX_JSON_BYTES } = require('../server/http-security');
const { startServer } = require('./helpers/server-child');

test('real server rejects unauthenticated and cross-origin API access', async t => {
  const server = await startServer(t);

  const unauthorized = await server.request({
    method: 'POST',
    pathname: '/api/settings',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  });
  assert.equal(unauthorized.status, 403);

  const crossOrigin = await server.request({
    pathname: '/api/stats',
    headers: {
      [API_TOKEN_HEADER]: server.token,
      origin: 'https://attacker.example'
    }
  });
  assert.equal(crossOrigin.status, 200);
  assert.notEqual(crossOrigin.headers['access-control-allow-origin'], '*');
});

test('real server enforces JSON media type and 64 KiB request limit', async t => {
  const server = await startServer(t);
  const auth = { [API_TOKEN_HEADER]: server.token };

  const wrongType = await server.request({
    method: 'POST',
    pathname: '/api/settings',
    headers: { ...auth, 'content-type': 'text/plain' },
    body: '{}'
  });
  assert.equal(wrongType.status, 415);

  const misleadingType = await server.request({
    method: 'POST',
    pathname: '/api/settings',
    headers: { ...auth, 'content-type': 'application/jsonp' },
    body: '{}'
  });
  assert.equal(misleadingType.status, 415);

  const tooLarge = await server.request({
    method: 'POST',
    pathname: '/api/settings',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ value: 'x'.repeat(MAX_JSON_BYTES) })
  });
  assert.equal(tooLarge.status, 413);

  const malformed = await server.request({
    method: 'POST',
    pathname: '/api/settings',
    headers: { ...auth, 'content-type': 'application/json' },
    body: '{bad json'
  });
  assert.equal(malformed.status, 400);
});

test('settings API keeps an accepted key only in runtime memory', async t => {
  const server = await startServer(t);
  const auth = { [API_TOKEN_HEADER]: server.token, 'content-type': 'application/json' };

  const saved = await server.request({
    method: 'POST',
    pathname: '/api/settings',
    headers: auth,
    body: JSON.stringify({ ai: { apiKey: 'sk-server-runtime-only' } })
  });
  assert.equal(saved.status, 200);
  assert.doesNotMatch(saved.body, /sk-server-runtime-only/);

  const loaded = await server.request({
    pathname: '/api/settings',
    headers: { [API_TOKEN_HEADER]: server.token }
  });
  assert.equal(loaded.status, 200);
  const settings = JSON.parse(loaded.body);
  assert.equal(settings.ai._hasKey, true);
  assert.equal(Object.hasOwn(settings.ai, 'apiKey'), false);
  assert.doesNotMatch(loaded.body, /sk-server-runtime-only|\*\*\*\*/);
});

test('real server returns 400 for invalid feed, date, source, and settings input', async t => {
  const server = await startServer(t);
  const token = { [API_TOKEN_HEADER]: server.token };
  const jsonHeaders = { ...token, 'content-type': 'application/json' };

  assert.equal((await server.request({ pathname: '/api/feed?view=unknown', headers: token })).status, 400);
  assert.equal((await server.request({ pathname: '/api/daily?date=2026-02-30', headers: token })).status, 400);
  assert.equal((await server.request({
    method: 'POST', pathname: '/api/sources', headers: jsonHeaders,
    body: JSON.stringify({ name: '危险信源', type: 'rss', url: 'file:///secret' })
  })).status, 400);
  assert.equal((await server.request({
    method: 'POST', pathname: '/api/settings', headers: jsonHeaders,
    body: JSON.stringify({ collect: { intervalMinutes: 'never' } })
  })).status, 400);
  assert.equal((await server.request({
    method: 'POST', pathname: '/api/feedback', headers: jsonHeaders,
    body: JSON.stringify({ kind: 'admin', content: '' })
  })).status, 400);
});

test('corrupt optional JSON fields degrade safely instead of breaking the feed or daily report', async t => {
  const server = await startServer(t);
  const token = { [API_TOKEN_HEADER]: server.token };
  const database = new DatabaseSync(path.join(server.dataDir, 'star-picking-pavilion.db'));
  const sourceId = database.prepare(`INSERT INTO sources (name, type, url, tier, domain)
    VALUES (?, 'rss', ?, 'T2', 'both')`).run('损坏字段测试', `https://example.com/${Date.now()}`).lastInsertRowid;
  database.prepare(`INSERT INTO articles
    (source_id, title, url, fetched_at, relevant, featured, quality_score, scores_json, tags_json)
    VALUES (?, ?, ?, ?, 1, 1, '\"><img src=x onerror=alert(1)>', '{bad', '{bad')`).run(
    sourceId, '损坏可选字段不应破坏信息流', `https://example.com/article-${Date.now()}`, new Date().toISOString()
  );
  database.prepare(`INSERT INTO daily_reports (date, content_json, created_at)
    VALUES ('2026-07-20', '{bad', ?)`).run(new Date().toISOString());
  database.close();

  const feed = await server.request({ pathname: '/api/feed?view=featured', headers: token });
  assert.equal(feed.status, 200);
  const item = JSON.parse(feed.body).items.find(entry => entry.title === '损坏可选字段不应破坏信息流');
  assert.equal(item.scores, null);
  assert.deepEqual(item.tags, []);
  assert.equal(item.quality, null);
  assert.equal(item.heat, null);

  const daily = await server.request({ pathname: '/api/daily?date=2026-07-20', headers: token });
  assert.equal(daily.status, 200);
  assert.equal(JSON.parse(daily.body).report.date, '2026-07-20');
  assert.equal(JSON.parse(daily.body).report.windowVersion, 2);
});
