'use strict';

const ERROR_MESSAGES = Object.freeze({
  'directory-invalid': '所选位置不是可用的普通文件夹，请重新选择。',
  'directory-unavailable': '所选位置当前不可用或不可写，请检查磁盘后重试。',
  'directory-unconfigured': '请先选择每日新闻简报的保存位置。',
  'bundle-unavailable': '新闻简报暂时无法生成，请稍后重试。',
  'bundle-invalid': '新闻简报数据校验失败，请稍后重试。',
  'archive-write-failed': '新闻简报保存失败，请检查磁盘空间和目录权限。',
  'archive-conflict': '补存目录创建失败，请稍后重试。'
});

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneForIpc(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function publicError(error) {
  const message = ERROR_MESSAGES[error?.code]
    || '新闻简报归档操作失败，请稍后重试。';
  const translated = new Error(message);
  if (typeof error?.code === 'string' && Object.hasOwn(ERROR_MESSAGES, error.code)) {
    translated.code = error.code;
  }
  return translated;
}

function registerDailyArchiveIpc({
  ipcMain,
  dialog,
  getService,
  getWindow
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new TypeError('ipcMain.handle 不可用');
  }
  if (!dialog || typeof dialog.showOpenDialog !== 'function') {
    throw new TypeError('dialog.showOpenDialog 不可用');
  }
  if (typeof getService !== 'function') throw new TypeError('getService 必须是函数');
  if (typeof getWindow !== 'function') throw new TypeError('getWindow 必须是函数');

  function requireService() {
    const service = getService();
    if (!service) throw new Error('新闻简报归档服务尚未就绪，请稍后重试。');
    return service;
  }

  async function safely(operation) {
    try {
      return cloneForIpc(await operation());
    } catch (error) {
      if (error?.message === '新闻简报归档服务尚未就绪，请稍后重试。') throw error;
      throw publicError(error);
    }
  }

  ipcMain.handle('daily-archive:get', async () => {
    const service = requireService();
    return cloneForIpc(service.getSnapshot());
  });

  ipcMain.handle('daily-archive:choose-directory', async () => safely(async () => {
    const service = requireService();
    const options = {
      title: '选择每日新闻简报保存位置',
      properties: ['openDirectory', 'createDirectory', 'promptToCreate']
    };
    const owner = getWindow();
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (result?.canceled || !Array.isArray(result?.filePaths) || !result.filePaths[0]) {
      return {
        canceled: true,
        settings: service.getSnapshot()
      };
    }
    return {
      canceled: false,
      settings: await service.enable(result.filePaths[0])
    };
  }));

  ipcMain.handle('daily-archive:set-enabled', async (_event, request) => {
    if (
      !isPlainObject(request)
      || Reflect.ownKeys(request).length !== 1
      || typeof request.enabled !== 'boolean'
    ) {
      throw new TypeError('enabled 必须是唯一的布尔参数');
    }
    return safely(async () => {
      const service = requireService();
      if (!request.enabled) return service.disable();
      const rootDirectory = service.getSnapshot()?.rootDirectory;
      if (!rootDirectory) {
        const error = new Error('archive directory is not configured');
        error.code = 'directory-unconfigured';
        throw error;
      }
      return service.enable(rootDirectory);
    });
  });

  ipcMain.handle('daily-archive:save-current', async () => safely(async () => {
    const service = requireService();
    const result = await service.saveCurrent();
    return {
      result,
      settings: service.getSnapshot()
    };
  }));

  ipcMain.handle('daily-archive:retry', async () => safely(async () => {
    const service = requireService();
    const results = await service.retry();
    return {
      results,
      settings: service.getSnapshot()
    };
  }));
}

module.exports = {
  ERROR_MESSAGES,
  cloneForIpc,
  registerDailyArchiveIpc
};
