'use strict';
// Electron 主进程 —— 用内置 Node（utilityProcess）跑后端子进程，无需用户另装 Node；加载本地页面
const { app, BrowserWindow, shell, utilityProcess, ipcMain, dialog, session, safeStorage } = require('electron');
const crypto = require('node:crypto');
const path = require('node:path');
const { migrateUserData, MigrationCancelledError } = require('./user-data-migration');
const { createCredentialStore } = require('./credential-store');
const { focusExistingWindow, createServerProcessController } = require('./server-process');
let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* 开发期未装也不影响 */ }

let serverProc = null;
let serverController = null;
let win = null;
let latestUpdateStatus = null;
let autoUpdateInitialized = false;
let autoUpdateTimer = null;
let backendReady = false;
let quitAfterShutdown = false;
let desktopShutdownPromise = null;
const testDataDir = process.env.STAR_PICKING_PAVILION_TEST_DATA_DIR
  ? path.resolve(process.env.STAR_PICKING_PAVILION_TEST_DATA_DIR)
  : null;

if (testDataDir) {
  app.setPath('userData', testDataDir);
} else if (app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), '摘星阁'));
}

function getDataDir() {
  if (testDataDir) return testDataDir;
  return app.isPackaged ? app.getPath('userData') : path.join(__dirname, '..', 'data');
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else app.on('second-instance', () => focusExistingWindow(win));

function reportUnexpectedServerExit({ code, signal }) {
  if (!backendReady || quitAfterShutdown) return;
  const detail = code != null ? `退出代码 ${code}` : `信号 ${signal || '未知'}`;
  console.error(`[后端] 意外退出（${detail}）`);
  dialog.showErrorBox('摘星阁服务已停止', `本地情报服务意外停止（${detail}）。请重启摘星阁。`);
}

function startServer({ initialApiKey, credentialStore }) {
  const serverEntry = path.join(__dirname, '..', 'server', 'index.js');
  // 打包后数据写入 userData（可写、可保留）；开发期沿用项目内 ./data
  const dataDir = getDataDir();
  const apiToken = crypto.randomBytes(32).toString('base64url');
  const serverNonce = crypto.randomBytes(32).toString('base64url');
  serverProc = utilityProcess.fork(serverEntry, [], {
    env: {
      ...process.env,
      STAR_PICKING_PAVILION_PORT: '0',
      STAR_PICKING_PAVILION_API_TOKEN: apiToken,
      STAR_PICKING_PAVILION_SERVER_NONCE: serverNonce,
      STAR_PICKING_PAVILION_AI_API_KEY: initialApiKey,
      STAR_PICKING_PAVILION_DATA_DIR: dataDir,
      WINDCATCHER_PORT: '0',
      WINDCATCHER_DATA_DIR: dataDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverController = createServerProcessController(serverProc, {
    shutdownTimeoutMs: 5_000,
    onUnexpectedExit: reportUnexpectedServerExit
  });
  serverProc.stdout?.on('data', d => process.stdout.write('[后端] ' + d));
  serverProc.stderr?.on('data', d => process.stderr.write('[后端!] ' + d));
  return new Promise((resolve, reject) => {
    let ready = false;
    const timeout = setTimeout(() => {
      if (!ready) reject(new Error('后端启动握手超时'));
    }, 15_000);
    serverProc.on('message', message => {
      if (message?.type === 'credential:set') {
        credentialStore.set(message.apiKey).then(
          () => serverProc.postMessage({ type: 'credential:result', requestId: message.requestId, ok: true }),
          error => serverProc.postMessage({
            type: 'credential:result',
            requestId: message.requestId,
            ok: false,
            error: String(error.message || error)
          })
        );
        return;
      }
      if (message?.type !== 'server:ready') return;
      if (message.nonce !== serverNonce || !Number.isInteger(message.port) || message.port <= 0) {
        clearTimeout(timeout);
        reject(new Error('后端启动握手校验失败'));
        return;
      }
      ready = true;
      backendReady = true;
      clearTimeout(timeout);
      resolve({ port: message.port, apiToken });
    });
    serverProc.on('exit', code => {
      console.log('[后端] 退出', code);
      if (!ready) {
        clearTimeout(timeout);
        reject(new Error(`后端在启动完成前退出（代码 ${code}）`));
      }
    });
  });
}

function installApiAuthentication(serverPort, apiToken) {
  const filter = { urls: [`http://127.0.0.1:${serverPort}/api/*`] };
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    callback({
      requestHeaders: {
        ...details.requestHeaders,
        'x-star-picking-pavilion-token': apiToken
      }
    });
  });
}

function installPermissionPolicy() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setDevicePermissionHandler?.(() => false);
}

function isAllowedExternalUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return false;
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function createWindow(serverPort) {
  const expectedOrigin = `http://127.0.0.1:${serverPort}`;
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#04060e',
    title: '摘星阁 · 低空经济与商业航天情报站',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // 外链一律用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    let origin = '';
    try { origin = new URL(url).origin; } catch {}
    if (origin !== expectedOrigin) {
      event.preventDefault();
      if (isAllowedExternalUrl(url)) shell.openExternal(url);
    }
  });
  let recoveringRenderer = false;
  win.webContents.on('render-process-gone', async (_event, details) => {
    if (recoveringRenderer || win.isDestroyed() || details.reason === 'clean-exit') return;
    recoveringRenderer = true;
    try {
      await win.loadURL(`${expectedOrigin}/failure.html`);
    } catch (error) {
      console.error('[渲染器] 恢复页面加载失败:', error.message);
    } finally {
      recoveringRenderer = false;
    }
  });

  try {
    await win.loadURL(`${expectedOrigin}/`);
    if (latestUpdateStatus) win.webContents.send('update:status', latestUpdateStatus);
  } catch (error) {
    console.error('[窗口] 页面加载失败:', error.message);
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      `<body style="background:#04060e;color:#dfe7ff;font-family:sans-serif;display:grid;place-items:center;height:100vh">
        <div style="text-align:center"><h2>后端启动失败</h2><p>情报服务未能启动，请重启应用重试。</p>
        <p style="opacity:.6">如果问题持续存在，请查看应用日志。</p></div></body>`));
  }
}

// ---------- 自动更新（electron-updater + GitHub Releases）----------
function sendUpdateStatus(status, data = {}) {
  latestUpdateStatus = { status, ...data };
  try { win?.webContents.send('update:status', latestUpdateStatus); } catch {}
}

function setupAutoUpdate() {
  if (autoUpdateInitialized || !autoUpdater || !app.isPackaged
    || process.env.STAR_PICKING_PAVILION_DISABLE_AUTO_UPDATE === '1') return;
  autoUpdateInitialized = true;
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-available', i => sendUpdateStatus('available', { version: i.version }));
  autoUpdater.on('download-progress', p => sendUpdateStatus('downloading', { percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', i => sendUpdateStatus('downloaded', { version: i.version }));
  autoUpdater.on('error', error => sendUpdateStatus('error', { message: String(error?.message || error) }));
  autoUpdater.checkForUpdatesAndNotify().catch(error => sendUpdateStatus('error', {
    message: String(error?.message || error)
  }));
  // 之后每 6 小时再查一次
  autoUpdateTimer = setInterval(() => {
    autoUpdater.checkForUpdates().catch(error => sendUpdateStatus('error', {
      message: String(error?.message || error)
    }));
  }, 6 * 3600 * 1000);
}

// 渲染层点击「重启更新」
ipcMain.handle('update:install', () => { try { autoUpdater && autoUpdater.quitAndInstall(); } catch {} });
ipcMain.on('app:get-version', event => { event.returnValue = app.getVersion(); });

async function chooseLegacyDatabase() {
  const result = await dialog.showMessageBox({
    type: 'question',
    title: '摘星阁数据迁移',
    message: '检测到“摘星阁”和“捕风司”各有一份旧数据库，请选择要迁移的数据。',
    detail: '迁移只会创建一致性备份，不会修改或删除任一旧数据库。',
    buttons: ['使用当前“摘星阁”（推荐）', '使用旧“捕风司”', '取消启动'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  });
  return ['current', 'legacy', 'cancel'][result.response] || 'cancel';
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  installPermissionPolicy();
  setupAutoUpdate();
  await migrateUserData({
    isPackaged: testDataDir ? false : app.isPackaged,
    appDataDir: app.getPath('appData'),
    repoDataDir: getDataDir(),
    chooseSource: chooseLegacyDatabase
  });
  const dataDir = getDataDir();
  const credentialStore = createCredentialStore({ safeStorage, directory: dataDir });
  await credentialStore.migratePlaintextSettings(path.join(dataDir, 'settings.json'));
  const initialApiKey = await credentialStore.get();
  const { port: serverPort, apiToken } = await startServer({ initialApiKey, credentialStore });
  installApiAuthentication(serverPort, apiToken);
  await createWindow(serverPort);
}).catch(async error => {
  if (!(error instanceof MigrationCancelledError)) {
    console.error('[数据迁移] 启动失败:', error.message);
    await dialog.showErrorBox('摘星阁启动失败', `无法安全准备本地数据：${error.message}`);
  }
  app.quit();
});

app.on('window-all-closed', () => {
  app.quit();
});

function shutdownDesktop() {
  if (desktopShutdownPromise) return desktopShutdownPromise;
  desktopShutdownPromise = (async () => {
    backendReady = false;
    if (autoUpdateTimer) clearInterval(autoUpdateTimer);
    autoUpdateTimer = null;
    if (serverController) await serverController.shutdown();
  })();
  return desktopShutdownPromise;
}

app.on('before-quit', event => {
  if (quitAfterShutdown) return;
  event.preventDefault();
  shutdownDesktop().catch(error => {
    console.error('[退出] 后端关闭失败:', error.message);
  }).finally(() => {
    quitAfterShutdown = true;
    app.quit();
  });
});
app.on('will-quit', () => {
  if (autoUpdateTimer) clearInterval(autoUpdateTimer);
});
