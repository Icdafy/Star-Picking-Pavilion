'use strict';
// 预加载脚本 —— 渲染层经 HTTP API 通信；这里暴露桌面壳能力：版本号 + 自动更新桥
const { contextBridge, ipcRenderer } = require('electron');

function cloneAndFreeze(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(cloneAndFreeze));
  }
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneAndFreeze(child)])
    ));
  }
  return value;
}

const version = ipcRenderer.sendSync('app:get-version');
const initialPreferencesState = ipcRenderer.sendSync('preferences:get');
const desktopApi = Object.freeze({
  isElectron: true,
  version,
  preferences: cloneAndFreeze(initialPreferencesState.preferences),
  hasStoredPreferences: initialPreferencesState.hasStoredPreferences === true,
  updatePreferences: patch => ipcRenderer.invoke('preferences:update', patch),
  getDesktopSettings: () => ipcRenderer
    .invoke('desktop-settings:get')
    .then(cloneAndFreeze),
  updateDesktopSettings: patch => ipcRenderer
    .invoke('desktop-settings:update', patch)
    .then(cloneAndFreeze),
  // 主进程推送更新状态：available / downloading / downloaded / error
  onUpdateStatus: cb => ipcRenderer.on('update:status', (_e, payload) => cb(payload)),
  // 渲染层请求「重启并安装更新」
  installUpdate: () => ipcRenderer.invoke('update:install')
});
contextBridge.exposeInMainWorld('starPickingPavilion', desktopApi);
contextBridge.exposeInMainWorld('windcatcher', desktopApi);
