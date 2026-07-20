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

test('Electron sandboxes renderers and denies every permission by default', () => {
  assert.match(source, /sandbox:\s*true/);
  assert.match(source, /setPermissionRequestHandler\([^\n]+callback\(false\)/);
  assert.match(source, /setPermissionCheckHandler\(\(\) => false\)/);
  assert.match(source, /render-process-gone/);
  assert.match(source, /failure\.html/);
});

test('auto update starts independently and reports failures to the renderer', () => {
  const readyIndex = source.indexOf('app.whenReady().then');
  const updaterIndex = source.indexOf('setupAutoUpdate();', readyIndex);
  const serverIndex = source.indexOf('await startServer(', readyIndex);
  assert.ok(updaterIndex > readyIndex && updaterIndex < serverIndex);
  assert.match(source, /checkForUpdatesAndNotify\(\)\.catch\([^)]*sendUpdateStatus\('error'/s);
});

test('desktop lifecycle is single-instance and shuts the utility process down cooperatively', () => {
  const lockIndex = source.indexOf('requestSingleInstanceLock()');
  const readyIndex = source.indexOf('app.whenReady()');
  assert.ok(lockIndex >= 0 && lockIndex < readyIndex);
  assert.match(source, /app\.on\('second-instance', \(\) => focusExistingWindow\(win\)\)/);
  assert.match(source, /createServerProcessController\(serverProc/);
  assert.match(source, /shutdownTimeoutMs:\s*5_000/);
  assert.match(source, /if \(serverController\) await serverController\.shutdown\(\)/);
  assert.match(source, /app\.on\('before-quit', event => \{[\s\S]*event\.preventDefault\(\)/);
  assert.doesNotMatch(source, /window-all-closed[\s\S]{0,120}serverProc\.kill/);
});
