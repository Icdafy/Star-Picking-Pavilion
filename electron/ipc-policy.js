'use strict';

// Every desktop channel shares the same window, frame and document boundary.
function isTrustedDesktopSender(event, { window, origin, recoveryUrl } = {}) {
  try {
    const contents = window?.webContents;
    if (!contents || window.isDestroyed() || contents.isDestroyed()
      || event?.sender !== contents || !event.senderFrame || event.senderFrame !== contents.mainFrame) return false;
    const url = new URL(event.senderFrame.url);
    if (url.username || url.password) return false;
    if (origin && url.origin === origin && ['/', '/index.html', '/failure.html'].includes(url.pathname)) return true;
    url.hash = '';
    return Boolean(recoveryUrl && url.href === recoveryUrl);
  } catch { return false; }
}

function createTrustedIpcMain({ ipcMain, isTrusted } = {}) {
  if (typeof ipcMain?.handle !== 'function' || typeof ipcMain?.on !== 'function'
    || typeof isTrusted !== 'function') throw new TypeError('IPC policy dependencies are required');
  return Object.freeze({
    handle(channel, handler) {
      ipcMain.handle(channel, (event, ...args) => {
        if (!isTrusted(event)) throw new Error('不允许该窗口或框架访问桌面功能');
        return handler(event, ...args);
      });
    },
    on(channel, handler) {
      ipcMain.on(channel, (event, ...args) => {
        if (!isTrusted(event)) { event.returnValue = null; return; }
        return handler(event, ...args);
      });
    }
  });
}

module.exports = { isTrustedDesktopSender, createTrustedIpcMain };
