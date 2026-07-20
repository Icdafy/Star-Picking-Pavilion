'use strict';
// Electron 主进程 —— 用内置 Node（utilityProcess）跑后端子进程，无需用户另装 Node；加载本地页面
const { app, BrowserWindow, shell, utilityProcess, ipcMain, dialog, session, safeStorage } = require('electron');
const crypto = require('node:crypto');
const path = require('node:path');
const { migrateUserData, MigrationCancelledError } = require('./user-data-migration');
const { createCredentialStore } = require('./credential-store');
let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* 开发期未装也不影响 */ }

let serverProc = null;
let win = null;

if (app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), '摘星阁'));
}

function startServer({ initialApiKey, credentialStore }) {
  const serverEntry = path.join(__dirname, '..', 'server', 'index.js');
  // 打包后数据写入 userData（可写、可保留）；开发期沿用项目内 ./data
  const dataDir = app.isPackaged ? app.getPath('userData') : path.join(__dirname, '..', 'data');
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

function isAllowedExternalUrl(value) {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
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

  try {
    await win.loadURL(`${expectedOrigin}/`);
    setupAutoUpdate();
  } catch (error) {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      `<body style="background:#04060e;color:#dfe7ff;font-family:sans-serif;display:grid;place-items:center;height:100vh">
        <div style="text-align:center"><h2>后端启动失败</h2><p>情报服务未能启动，请重启应用重试。</p>
        <p style="opacity:.6">${error.message}</p></div></body>`));
  }
}

// ---------- 自动更新（electron-updater + GitHub Releases）----------
function setupAutoUpdate() {
  if (!autoUpdater || !app.isPackaged) return;   // 仅打包后生效
  const send = (status, data) => { try { win && win.webContents.send('update:status', { status, ...data }); } catch {} };
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-available', i => send('available', { version: i.version }));
  autoUpdater.on('download-progress', p => send('downloading', { percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', i => send('downloaded', { version: i.version }));
  autoUpdater.on('error', err => send('error', { message: String(err && err.message || err) }));
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  // 之后每 6 小时再查一次
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 3600 * 1000);
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

app.whenReady().then(async () => {
  await migrateUserData({
    isPackaged: app.isPackaged,
    appDataDir: app.getPath('appData'),
    repoDataDir: path.join(__dirname, '..', 'data'),
    chooseSource: chooseLegacyDatabase
  });
  const dataDir = app.isPackaged ? app.getPath('userData') : path.join(__dirname, '..', 'data');
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
  if (serverProc) serverProc.kill();
  app.quit();
});
app.on('before-quit', () => { if (serverProc) serverProc.kill(); });
