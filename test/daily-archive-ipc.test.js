'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { registerDailyArchiveIpc } = require('../electron/daily-archive-ipc');

function captureIpcCallbacks() {
  const handlers = new Map();
  return {
    ipcMain: {
      handle(channel, callback) {
        assert.equal(handlers.has(channel), false);
        handlers.set(channel, callback);
      }
    },
    handlers
  };
}

function createSnapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    enabled: false,
    rootDirectory: '',
    enabledAt: null,
    lastSuccessfulDate: null,
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorAt: null,
    runningDate: null,
    nextRunAt: null,
    pendingDates: [],
    lastResult: null,
    ...overrides
  };
}

test('daily archive IPC registers only the five fixed operations', () => {
  const fake = captureIpcCallbacks();
  registerDailyArchiveIpc({
    ipcMain: fake.ipcMain,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    getService: () => null,
    getWindow: () => null
  });

  assert.deepEqual([...fake.handlers.keys()], [
    'daily-archive:get',
    'daily-archive:choose-directory',
    'daily-archive:set-enabled',
    'daily-archive:save-current',
    'daily-archive:retry'
  ]);
});

test('directory selection stays in the main process and enables only the native selected path', async () => {
  const fake = captureIpcCallbacks();
  const owner = { id: 'main-window' };
  const calls = [];
  const enabledSnapshot = createSnapshot({
    enabled: true,
    rootDirectory: 'D:\\Research'
  });
  const service = {
    getSnapshot() {
      calls.push(['getSnapshot']);
      return enabledSnapshot;
    },
    async enable(directory) {
      calls.push(['enable', directory]);
      return enabledSnapshot;
    }
  };
  const dialog = {
    async showOpenDialog(receivedOwner, options) {
      calls.push(['showOpenDialog', receivedOwner, options]);
      return { canceled: false, filePaths: ['D:\\Research'] };
    }
  };
  registerDailyArchiveIpc({
    ipcMain: fake.ipcMain,
    dialog,
    getService: () => service,
    getWindow: () => owner
  });

  const response = await fake.handlers.get('daily-archive:choose-directory')({}, {
    path: 'C:\\renderer-controlled',
    rootDirectory: 'C:\\also-rejected'
  });

  assert.deepEqual(calls, [
    [
      'showOpenDialog',
      owner,
      {
        title: '选择每日新闻简报保存位置',
        properties: ['openDirectory', 'createDirectory', 'promptToCreate']
      }
    ],
    ['enable', 'D:\\Research']
  ]);
  assert.deepEqual(response, {
    canceled: false,
    settings: enabledSnapshot
  });
  assert.notStrictEqual(response.settings, enabledSnapshot);
});

test('canceling the native directory dialog never enables archiving', async () => {
  const fake = captureIpcCallbacks();
  let enableCalls = 0;
  const snapshot = createSnapshot();
  const service = {
    getSnapshot: () => snapshot,
    enable: async () => {
      enableCalls += 1;
    }
  };
  registerDailyArchiveIpc({
    ipcMain: fake.ipcMain,
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: ['D:\\must-ignore'] })
    },
    getService: () => service,
    getWindow: () => null
  });

  assert.deepEqual(
    await fake.handlers.get('daily-archive:choose-directory')(),
    { canceled: true, settings: snapshot }
  );
  assert.equal(enableCalls, 0);
});

test('set-enabled accepts exactly one boolean and reuses only the trusted stored root', async () => {
  const fake = captureIpcCallbacks();
  const calls = [];
  const disabled = createSnapshot({ rootDirectory: 'D:\\Trusted' });
  const enabled = createSnapshot({ enabled: true, rootDirectory: 'D:\\Trusted' });
  let snapshot = disabled;
  const service = {
    getSnapshot() {
      return snapshot;
    },
    async enable(directory) {
      calls.push(['enable', directory]);
      snapshot = enabled;
      return snapshot;
    },
    async disable() {
      calls.push(['disable']);
      snapshot = disabled;
      return snapshot;
    }
  };
  registerDailyArchiveIpc({
    ipcMain: fake.ipcMain,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    getService: () => service,
    getWindow: () => null
  });
  const handler = fake.handlers.get('daily-archive:set-enabled');

  assert.deepEqual(await handler({}, { enabled: true }), enabled);
  assert.deepEqual(await handler({}, { enabled: false }), disabled);
  assert.deepEqual(calls, [['enable', 'D:\\Trusted'], ['disable']]);

  for (const invalid of [
    undefined,
    true,
    { enabled: 'true' },
    { enabled: true, path: 'C:\\renderer-controlled' },
    { rootDirectory: 'C:\\renderer-controlled' }
  ]) {
    await assert.rejects(handler({}, invalid), /enabled/);
  }
});

test('get, save and retry return detached data and never forward renderer arguments', async () => {
  const fake = captureIpcCallbacks();
  const calls = [];
  const snapshot = createSnapshot({ rootDirectory: 'D:\\Trusted' });
  const saved = { status: 'saved', date: '2026-07-31', directory: 'D:\\Trusted\\archive' };
  const retried = [{ status: 'existing', date: '2026-07-30', directory: 'D:\\Trusted\\old' }];
  const service = {
    getSnapshot() {
      calls.push(['getSnapshot']);
      return snapshot;
    },
    async saveCurrent() {
      calls.push(['saveCurrent', arguments.length]);
      return saved;
    },
    async retry() {
      calls.push(['retry', arguments.length]);
      return retried;
    }
  };
  registerDailyArchiveIpc({
    ipcMain: fake.ipcMain,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    getService: () => service,
    getWindow: () => null
  });

  const getResult = await fake.handlers.get('daily-archive:get')({}, {
    path: 'C:\\must-not-forward'
  });
  const saveResult = await fake.handlers.get('daily-archive:save-current')({}, {
    date: '1999-01-01',
    path: 'C:\\must-not-forward'
  });
  const retryResult = await fake.handlers.get('daily-archive:retry')({}, {
    path: 'C:\\must-not-forward'
  });

  assert.deepEqual(getResult, snapshot);
  assert.notStrictEqual(getResult, snapshot);
  assert.deepEqual(saveResult, { result: saved, settings: snapshot });
  assert.deepEqual(retryResult, { results: retried, settings: snapshot });
  assert.deepEqual(calls, [
    ['getSnapshot'],
    ['saveCurrent', 0],
    ['getSnapshot'],
    ['retry', 0],
    ['getSnapshot']
  ]);
});

test('unready services and filesystem validation errors become stable user-safe messages', async () => {
  const fake = captureIpcCallbacks();
  registerDailyArchiveIpc({
    ipcMain: fake.ipcMain,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    getService: () => null,
    getWindow: () => null
  });
  await assert.rejects(
    fake.handlers.get('daily-archive:get')(),
    error => {
      assert.match(error.message, /新闻简报归档服务尚未就绪/);
      assert.doesNotMatch(error.message, /path|directory|token|api.?key/i);
      return true;
    }
  );

  const validation = captureIpcCallbacks();
  registerDailyArchiveIpc({
    ipcMain: validation.ipcMain,
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: ['Z:\\Offline'] })
    },
    getService: () => ({
      enable: async () => {
        const error = new Error('EACCES at Z:\\Offline\\secret');
        error.code = 'directory-unavailable';
        throw error;
      }
    }),
    getWindow: () => null
  });
  await assert.rejects(
    validation.handlers.get('daily-archive:choose-directory')(),
    error => {
      assert.equal(error.message, '所选位置当前不可用或不可写，请检查磁盘后重试。');
      assert.doesNotMatch(error.message, /Z:|EACCES|secret/);
      return true;
    }
  );
});

test('daily archive IPC validates registration dependencies', () => {
  assert.throws(() => registerDailyArchiveIpc(), /ipcMain/);
  assert.throws(
    () => registerDailyArchiveIpc({ ipcMain: { handle() {} } }),
    /dialog/
  );
  assert.throws(
    () => registerDailyArchiveIpc({
      ipcMain: { handle() {} },
      dialog: { showOpenDialog() {} }
    }),
    /getService/
  );
  assert.throws(
    () => registerDailyArchiveIpc({
      ipcMain: { handle() {} },
      dialog: { showOpenDialog() {} },
      getService: () => null
    }),
    /getWindow/
  );
});
