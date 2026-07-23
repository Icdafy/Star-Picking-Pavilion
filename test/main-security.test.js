'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

function extractIpcHandler(channel, method) {
  const start = source.indexOf(`ipcMain.${method}('${channel}'`);
  assert.ok(start >= 0, `missing ${method} handler for ${channel}`);
  const end = source.indexOf('\n});', start);
  assert.ok(end > start, `unterminated ${method} handler for ${channel}`);
  return source.slice(start, end + 4);
}

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

test('Electron exposes only snapshot and storage state through preferences IPC', () => {
  const getHandler = extractIpcHandler('preferences:get', 'on');

  assert.match(getHandler, /event\.returnValue\s*=\s*\{/);
  assert.match(getHandler, /preferences:\s*uiPreferencesStore\s*\?\s*uiPreferencesStore\.getSnapshot\(\)\s*:\s*getDefaultUiPreferences\(\)/);
  assert.match(getHandler, /hasStoredPreferences:\s*uiPreferencesStore\s*\?\s*uiPreferencesStore\.hasStoredPreferences\(\)\s*:\s*false/);
  assert.doesNotMatch(getHandler, /\b(path|directory|apiKey|readFile|writeFile)\b/);
});

test('Electron forwards only the preferences patch to the initialized store', () => {
  const updateHandler = extractIpcHandler('preferences:update', 'handle');

  assert.match(updateHandler, /\(_event,\s*patch\)\s*=>/);
  assert.match(updateHandler, /if\s*\(!uiPreferencesStore\)\s*throw new Error\(/);
  assert.match(updateHandler, /return uiPreferencesStore\.update\(patch\)/);
  assert.doesNotMatch(updateHandler, /\b(path|directory|apiKey|readFile|writeFile)\b/);
  assert.doesNotMatch(source, /ipcMain\.(?:on|handle)\(['"][^'"]*(?:file|path|directory)[^'"]*['"]/i);
});

test('Electron loads preferences from the migrated data directory before creating the window', () => {
  assert.match(source, /createUiPreferencesStore/);
  assert.match(source, /getDefaultUiPreferences/);

  const readyIndex = source.indexOf('app.whenReady().then');
  const migrationIndex = source.indexOf('await migrateUserData(', readyIndex);
  const dataDirIndex = source.indexOf('const dataDir = getDataDir();', migrationIndex);
  const createStoreIndex = source.indexOf(
    'uiPreferencesStore = createUiPreferencesStore({ directory: dataDir });',
    dataDirIndex
  );
  const loadIndex = source.indexOf('await uiPreferencesStore.load();', createStoreIndex);
  const createWindowIndex = source.indexOf('await createWindow(serverPort);', loadIndex);

  assert.ok(readyIndex >= 0);
  assert.ok(migrationIndex > readyIndex);
  assert.ok(dataDirIndex > migrationIndex);
  assert.ok(createStoreIndex > dataDirIndex);
  assert.ok(loadIndex > createStoreIndex);
  assert.ok(createWindowIndex > loadIndex);
});

test('startup failure page never interpolates exception text into HTML', () => {
  assert.doesNotMatch(source, /<p[^>]*>\$\{error\.message\}<\/p>/);
  assert.match(source, /console\.error\('\[窗口\] 页面加载失败:'/);
});

test('Electron sandboxes renderers and denies every permission by default', () => {
  assert.match(source, /sandbox:\s*true/);
  assert.match(source, /setPermissionRequestHandler\([^\n]+callback\(false\)/);
  assert.match(source, /setPermissionCheckHandler\(\(\) => false\)/);
  assert.match(source, /render-process-gone/);
  assert.match(source, /failure\.html/);
  assert.match(source, /if \(parsed\.username \|\| parsed\.password\) return false/);
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

test('HTTP request-target parsing is covered by the server error boundary', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const handler = serverSource.indexOf('http.createServer');
  const errorBoundary = serverSource.indexOf('try {', handler);
  const requestTargetParsing = serverSource.indexOf('new URL(req.url', handler);
  assert.ok(handler >= 0 && errorBoundary >= 0 && requestTargetParsing >= 0);
  assert.ok(errorBoundary < requestTargetParsing);
});
