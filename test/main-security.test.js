'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

test('Electron launches the service on a random port with secret token and nonce', () => {
  assert.match(source, /crypto\.randomBytes\(/);
  assert.match(source, /STAR_PICKING_PAVILION_PORT:\s*'0'/);
  assert.match(source, /STAR_PICKING_PAVILION_API_TOKEN:\s*apiToken/);
  assert.match(source, /STAR_PICKING_PAVILION_SERVER_NONCE:\s*serverNonce/);
  assert.match(source, /message\?\.type\s*!==\s*'server:ready'/);
  assert.match(source, /message\.nonce\s*!==\s*serverNonce/);
  assert.doesNotMatch(source, /waitForServer|WINDCATCHER_PORT\s*\|\|\s*7644/);
});

test('Electron injects authentication only into the exact loopback API origin', () => {
  assert.match(source, /onBeforeSendHeaders/);
  assert.match(source, /x-star-picking-pavilion-token/);
  assert.match(source, /http:\/\/127\.0\.0\.1:\$\{serverPort\}\/api\/\*/);
  assert.match(source, /new URL\(url\)\.origin/);
});

test('Electron brokers encrypted credentials without exposing them to the renderer', () => {
  assert.match(source, /safeStorage/);
  assert.match(source, /createCredentialStore/);
  assert.match(source, /STAR_PICKING_PAVILION_AI_API_KEY:\s*initialApiKey/);
  assert.match(source, /message\?\.type === 'credential:set'/);
  assert.match(source, /type: 'credential:result'/);
  assert.doesNotMatch(source, /webContents\.send\([^\n]*apiKey/);
});
