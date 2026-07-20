'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  API_TOKEN_HEADER,
  MAX_JSON_BYTES,
  authorize,
  validateAiBaseUrl
} = require('../server/http-security');

const SECRET = 'a'.repeat(43);
const PORT = 43210;

test('request authorization requires the exact loopback host and launch token', () => {
  assert.equal(authorize({ host: 'evil.test', token: SECRET }, { port: PORT, expectedToken: SECRET }), false);
  assert.equal(authorize({ host: `127.0.0.1:${PORT}`, token: 'wrong' }, { port: PORT, expectedToken: SECRET }), false);
  assert.equal(authorize({ host: `127.0.0.1:${PORT}`, token: SECRET }, { port: PORT, expectedToken: SECRET }), true);
  assert.equal(API_TOKEN_HEADER, 'x-star-picking-pavilion-token');
  assert.equal(MAX_JSON_BYTES, 64 * 1024);
});

test('tokenless development accepts only absent or exact same-origin requests', () => {
  const host = `127.0.0.1:${PORT}`;
  assert.equal(authorize({ host }, { port: PORT, expectedToken: '' }), true);
  assert.equal(authorize({ host, origin: `http://${host}` }, { port: PORT, expectedToken: '' }), true);
  assert.equal(authorize({ host, origin: 'https://attacker.example' }, { port: PORT, expectedToken: '' }), false);
});

test('AI base URL is HTTPS except for loopback development services', () => {
  assert.equal(validateAiBaseUrl('http://attacker.example'), false);
  assert.equal(validateAiBaseUrl('https://api.deepseek.com'), true);
  assert.equal(validateAiBaseUrl('http://127.0.0.1:11434'), true);
  assert.equal(validateAiBaseUrl('http://localhost:11434/v1'), true);
  assert.equal(validateAiBaseUrl('javascript:alert(1)'), false);
});
