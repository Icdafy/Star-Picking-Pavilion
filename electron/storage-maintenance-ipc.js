'use strict';

const LEGACY_ID_PATTERN = /^legacy-[0-9a-f]{12}$/;

function registerStorageMaintenanceIpc({ ipcMain, getController } = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new TypeError('ipcMain.handle 不可用');
  }
  if (typeof getController !== 'function') {
    throw new TypeError('getController 必须是函数');
  }

  function requireController() {
    const controller = getController();
    if (!controller) throw new Error('存储维护尚未就绪。');
    return controller;
  }

  ipcMain.handle('storage:get', async () => requireController().getSnapshot());
  ipcMain.handle('storage:clear-cache', async () => requireController().clearCache());
  ipcMain.handle('storage:delete-legacy', async (_event, request) => {
    const id = typeof request?.id === 'string' ? request.id : '';
    if (!LEGACY_ID_PATTERN.test(id)) throw new Error('旧版数据候选标识无效。');
    return requireController().deleteLegacy(id);
  });
}

module.exports = {
  LEGACY_ID_PATTERN,
  registerStorageMaintenanceIpc
};
