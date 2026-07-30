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

test('启动失败路径不会挂住进程：兜底页走 file://、异常不外溢、无人值守不弹模态框', () => {
  // 这三条守的是 2026-07-25 让 CI 连挂三次的那条链：
  //   loadURL(origin) 被 abort → 兜底 data: URL 必然 ERR_FAILED（Chromium 禁止顶层
  //   导航到 data:）→ 异常逃出 createWindow → 外层当成「数据迁移失败」→ 调用模态的
  //   showErrorBox → 无交互桌面会话时永远阻塞 → 进程不退出 → 整个 job 预算烧光。
  assert.doesNotMatch(source, /loadURL\(\s*'data:text\/html/);
  assert.match(source, /loadFile\(path\.join\(__dirname, '\.\.', 'renderer', 'startup-failure\.html'\)\)/);
  assert.equal(
    fs.existsSync(path.join(__dirname, '..', 'renderer', 'startup-failure.html')),
    true,
    '兜底页必须随包存在，否则 file:// 也加载不出来'
  );

  // 兜底失败必须就地吞掉，不能抛回启动链路
  assert.match(source, /catch \(fallbackError\) \{[\s\S]{0,200}?console\.error\('\[窗口\] 兜底页加载失败:'/);

  // 模态错误框只在装机版弹；开发与 CI 留日志
  assert.match(source, /if \(app\.isPackaged\) \{[\s\S]{0,200}?dialog\.showErrorBox\(/);
  assert.doesNotMatch(source, /await dialog\.showErrorBox\(/);
});

test('Electron injects authentication only into the exact loopback API origin', () => {
  assert.match(source, /onBeforeSendHeaders/);
  assert.match(source, /x-star-picking-pavilion-token/);
  assert.match(source, /http:\/\/127\.0\.0\.1:\$\{serverPort\}\/api\/\*/);
  assert.match(source, /new URL\(url\)\.origin/);
});

test('daily archive integration keeps folder selection and authenticated export in the main process', () => {
  assert.match(source, /registerDailyArchiveIpc/);
  assert.match(source, /createDailyArchiveService/);
  assert.match(
    source,
    /registerDailyArchiveIpc\(\{\s*ipcMain,\s*dialog,\s*getService:\s*\(\)\s*=>\s*dailyArchive,\s*getWindow:\s*\(\)\s*=>\s*win\s*\}\)/
  );
  assert.match(source, /\/api\/daily\/archive\?date=\$\{encodeURIComponent\(date\)\}/);
  assert.match(source, /'x-star-picking-pavilion-token':\s*apiToken/);
  assert.doesNotMatch(source, /webContents\.send\([^\n]*(?:apiToken|rootDirectory)/);

  const readyIndex = source.indexOf('await startServer(');
  const archiveIndex = source.indexOf('createDailyArchiveService(', readyIndex);
  const startIndex = source.indexOf('await dailyArchive.start()', archiveIndex);
  const windowIndex = source.indexOf('await createWindow(serverPort)', startIndex);
  assert.ok(readyIndex >= 0);
  assert.ok(archiveIndex > readyIndex);
  assert.ok(startIndex > archiveIndex);
  assert.ok(windowIndex > startIndex);
});

test('daily archive timers recover after sleep and stop before desktop shutdown', () => {
  assert.match(source, /\bpowerMonitor\b/);
  assert.match(source, /powerMonitor\.on\('resume', handleDailyArchiveResume\)/);
  assert.match(source, /powerMonitor\.on\('unlock-screen', handleDailyArchiveResume\)/);
  assert.match(source, /dailyArchive\?\.stop\(\)/);
  assert.match(source, /powerMonitor\.removeListener\('resume', handleDailyArchiveResume\)/);
  assert.match(source, /powerMonitor\.removeListener\('unlock-screen', handleDailyArchiveResume\)/);
});

test('Electron brokers encrypted credentials without exposing them to the renderer', () => {
  assert.match(source, /safeStorage/);
  assert.match(source, /createCredentialStore/);
  assert.match(source, /STAR_PICKING_PAVILION_AI_API_KEY:\s*initialApiKey/);
  assert.match(source, /message\?\.type === 'credential:set'/);
  assert.match(source, /type: 'credential:result'/);
  assert.doesNotMatch(source, /webContents\.send\([^\n]*apiKey/);
});

test('Electron registers preference IPC and loads migrated preferences before creating the window', () => {
  assert.match(source, /registerUiPreferencesIpc\(\{\s*ipcMain,\s*getStore:\s*\(\)\s*=>\s*uiPreferencesStore\s*\}\)/);
  const readyIndex = source.indexOf('app.whenReady().then');
  const migrationIndex = source.indexOf('await migrateUserData(', readyIndex);
  const dataDirIndex = source.indexOf('const dataDir = getDataDir();', migrationIndex);
  const loadPreferencesIndex = source.indexOf(
    'uiPreferencesStore = await loadUiPreferencesStore({ directory: dataDir });',
    dataDirIndex
  );
  const createWindowIndex = source.indexOf('await createWindow(serverPort);', loadPreferencesIndex);

  assert.ok(readyIndex >= 0);
  assert.ok(migrationIndex > readyIndex);
  assert.ok(dataDirIndex > migrationIndex);
  assert.ok(loadPreferencesIndex > dataDirIndex);
  assert.ok(createWindowIndex > loadPreferencesIndex);
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
  assert.match(source, /app\.on\('second-instance'/);
  assert.match(source, /createServerProcessController\(serverProc/);
  assert.match(source, /shutdownTimeoutMs:\s*5_000/);
  assert.match(source, /if \(serverController\) await serverController\.shutdown\(\)/);
  assert.match(source, /app\.on\('before-quit', event => \{[\s\S]*event\.preventDefault\(\)/);
  assert.doesNotMatch(source, /window-all-closed[\s\S]{0,120}serverProc\.kill/);
});

test('main process assembles background mode after preferences and before the window', () => {
  assert.match(source, /\bTray\b/);
  assert.match(source, /\bMenu\b/);
  assert.match(source, /\bNotification\b/);
  assert.match(source, /registerDesktopSettingsIpc/);
  assert.match(source, /createBackgroundModeController/);
  assert.match(source, /backgroundMode\.initialize\(\)/);
  assert.match(source, /backgroundMode\?\.handleWindowClose\(event\)/);
  assert.match(source, /backgroundMode\?\.shouldStartHidden\(process\.argv\)/);
  assert.match(source, /backgroundMode\?\.dispose\(\)/);
  assert.match(
    source,
    /backgroundMode\?\.showMainWindow\(\)\s*\|\|\s*focusExistingWindow\(win\)/
  );

  const loadPreferences = source.indexOf('uiPreferencesStore = await loadUiPreferencesStore');
  const initializeBackground = source.indexOf('await backgroundMode.initialize()', loadPreferences);
  const createWindow = source.indexOf('await createWindow(serverPort)', initializeBackground);
  assert.ok(loadPreferences >= 0);
  assert.ok(initializeBackground > loadPreferences);
  assert.ok(createWindow > initializeBackground);
});

test('main process caps cache and initializes storage governance before the window', () => {
  assert.match(source, /registerStorageMaintenanceIpc/);
  assert.match(source, /createStorageMaintenanceController/);
  assert.match(source, /CACHE_SOFT_LIMIT_BYTES/);
  assert.match(
    source,
    /app\.commandLine\.appendSwitch\('disk-cache-size', String\(CACHE_SOFT_LIMIT_BYTES\)\)/
  );
  assert.match(source, /runBestEffortMaintenance\([\s\S]{0,160}?storageMaintenance\.prepareBeforeReady\(\)/);
  assert.match(source, /storageMaintenance\.initializeAfterMigration\(\)/);
  assert.match(source, /candidate\.files\.join\('\\n'\)/);

  const readyIndex = source.indexOf('app.whenReady().then');
  const prepareIndex = source.indexOf("await runBestEffortMaintenance(", readyIndex);
  const migrationIndex = source.indexOf('await migrateUserData(', prepareIndex);
  const residueIndex = source.indexOf('await storageMaintenance.initializeAfterMigration()', migrationIndex);
  const windowIndex = source.indexOf('await createWindow(serverPort)', residueIndex);
  assert.ok(prepareIndex > readyIndex);
  assert.ok(migrationIndex > prepareIndex);
  assert.ok(residueIndex > migrationIndex);
  assert.ok(windowIndex > residueIndex);
});

test('optional startup cache maintenance cannot prevent the application from launching', () => {
  assert.match(source, /async function runBestEffortMaintenance/);
  assert.match(source, /catch \(error\) \{[\s\S]{0,220}?return \{ skipped: true, failures:/);
});

test('HTTP request-target parsing is covered by the server error boundary', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const handler = serverSource.indexOf('http.createServer');
  const errorBoundary = serverSource.indexOf('try {', handler);
  const requestTargetParsing = serverSource.indexOf('new URL(req.url', handler);
  assert.ok(handler >= 0 && errorBoundary >= 0 && requestTargetParsing >= 0);
  assert.ok(errorBoundary < requestTargetParsing);
});
