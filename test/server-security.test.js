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
