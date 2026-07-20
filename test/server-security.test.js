'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

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
  assert.match(settings.ai.apiKey, /\*\*\*\*/);
  assert.doesNotMatch(settings.ai.apiKey, /sk-server-runtime-only/);
});
