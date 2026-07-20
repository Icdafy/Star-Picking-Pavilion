'use strict';
// Electron 主进程 —— 用内置 Node（utilityProcess）跑后端子进程，无需用户另装 Node；加载本地页面
const { app, BrowserWindow, shell, utilityProcess, ipcMain } = require('electron');
const path = require('node:path');
const http = require('node:http');
let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* 开发期未装也不影响 */ }

const PORT = Number(process.env.WINDCATCHER_PORT || 7644);
let serverProc = null;
let win = null;

function startServer() {
  const serverEntry = path.join(__dirname, '..', 'server', 'index.js');
  // 打包后数据写入 userData（可写、可保留）；开发期沿用项目内 ./data
  const dataDir = app.isPackaged ? app.getPath('userData') : path.join(__dirname, '..', 'data');
  serverProc = utilityProcess.fork(serverEntry, [], {
    env: { ...process.env, WINDCATCHER_PORT: String(PORT), WINDCATCHER_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProc.stdout?.on('data', d => process.stdout.write('[后端] ' + d));
  serverProc.stderr?.on('data', d => process.stderr.write('[后端!] ' + d));
  serverProc.on('exit', code => console.log('[后端] 退出', code));
}

function waitForServer(retries = 60) {
  return new Promise((resolve, reject) => {
    const ping = n => {
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/stats', timeout: 1000 }, res => {
        res.resume();
        res.statusCode === 200 ? resolve() : retry(n);
      });
      req.on('error', () => retry(n));
      req.on('timeout', () => { req.destroy(); retry(n); });
    };
    const retry = n => n <= 0 ? reject(new Error('后端启动超时')) : setTimeout(() => ping(n - 1), 500);
    ping(retries);
  });
}

async function createWindow() {
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
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${PORT}`)) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });

  try {
    await waitForServer();
    await win.loadURL(`http://127.0.0.1:${PORT}/`);
    setupAutoUpdate();
  } catch (e) {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      `<body style="background:#04060e;color:#dfe7ff;font-family:sans-serif;display:grid;place-items:center;height:100vh">
        <div style="text-align:center"><h2>后端启动失败</h2><p>情报服务未能启动，请重启应用重试。</p>
        <p style="opacity:.6">${e.message}</p></div></body>`));
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

app.whenReady().then(() => {
  startServer();
  createWindow();
});

app.on('window-all-closed', () => {
  if (serverProc) serverProc.kill();
  app.quit();
});
app.on('before-quit', () => { if (serverProc) serverProc.kill(); });
