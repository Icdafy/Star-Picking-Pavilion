'use strict';
// 预加载脚本 —— 渲染层经 HTTP API 通信；这里暴露桌面壳能力：版本号 + 自动更新桥
const { contextBridge, ipcRenderer } = require('electron');
const desktopApi = Object.freeze({
  isElectron: true,
  version: ipcRenderer.sendSync('app:get-version'),
  // 主进程推送更新状态：available / downloading / downloaded / error
  onUpdateStatus: cb => ipcRenderer.on('update:status', (_e, payload) => cb(payload)),
  // 渲染层请求「重启并安装更新」
  installUpdate: () => ipcRenderer.invoke('update:install')
});
contextBridge.exposeInMainWorld('starPickingPavilion', desktopApi);
contextBridge.exposeInMainWorld('windcatcher', desktopApi);
