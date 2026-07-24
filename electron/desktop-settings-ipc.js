'use strict';

const DEFAULT_SNAPSHOT = Object.freeze({
  closeToTray: false,
  launchAtLogin: false,
  launchAtLoginSupported: false,
  warnings: Object.freeze([])
});

function getDefaultDesktopSettings() {
  return { ...DEFAULT_SNAPSHOT, warnings: [] };
}

function registerDesktopSettingsIpc({ ipcMain, getController } = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new TypeError('ipcMain.handle 不可用');
  }
  if (typeof getController !== 'function') {
    throw new TypeError('getController 必须是函数');
  }

  ipcMain.handle('desktop-settings:get', async () => {
    const controller = getController();
    return controller ? controller.getSettings() : getDefaultDesktopSettings();
  });

  ipcMain.handle('desktop-settings:update', async (_event, patch) => {
    const controller = getController();
    if (!controller) throw new Error('桌面设置尚未就绪。');
    return controller.updateSettings(patch);
  });
}

module.exports = {
  DEFAULT_SNAPSHOT,
  getDefaultDesktopSettings,
  registerDesktopSettingsIpc
};
