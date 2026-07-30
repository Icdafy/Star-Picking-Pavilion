'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { registerStorageMaintenanceIpc } = require('../electron/storage-maintenance-ipc');

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

test('storage maintenance IPC rejects every action before the controller is ready', async () => {
  const fake = captureIpcCallbacks();
  registerStorageMaintenanceIpc({
    ipcMain: fake.ipcMain,
    getController: () => null
  });

  assert.deepEqual([...fake.handlers.keys()], [
    'storage:get',
    'storage:clear-cache',
    'storage:delete-legacy'
  ]);
  for (const channel of fake.handlers.keys()) {
    await assert.rejects(
      fake.handlers.get(channel)({}, { id: 'legacy-123456789abc' }),
      error => {
        assert.match(error.message, /存储维护尚未就绪/);
        assert.doesNotMatch(error.message, /path|directory|file|api.?key/i);
        return true;
      }
    );
  }
});

test('storage maintenance IPC exposes fixed actions and never forwards renderer paths', async () => {
  const fake = captureIpcCallbacks();
  const calls = [];
  const snapshot = { cache: { bytes: 12 }, migrationResidue: { bytes: 0 }, legacy: { candidates: [] } };
  const controller = {
    getSnapshot() {
      calls.push(['get']);
      return Promise.resolve(snapshot);
    },
    clearCache() {
      calls.push(['clear']);
      return Promise.resolve({ pendingRestart: true });
    },
    deleteLegacy(id) {
      calls.push(['deleteLegacy', id]);
      return Promise.resolve({ deleted: true });
    }
  };
  registerStorageMaintenanceIpc({
    ipcMain: fake.ipcMain,
    getController: () => controller
  });

  assert.equal(await fake.handlers.get('storage:get')(), snapshot);
  assert.deepEqual(await fake.handlers.get('storage:clear-cache')(), { pendingRestart: true });
  assert.deepEqual(
    await fake.handlers.get('storage:delete-legacy')({}, {
      id: 'legacy-123456789abc',
      path: 'C:\\arbitrary\\must-not-be-forwarded.db'
    }),
    { deleted: true }
  );
  assert.deepEqual(calls, [
    ['get'],
    ['clear'],
    ['deleteLegacy', 'legacy-123456789abc']
  ]);
});

test('storage maintenance IPC validates registration dependencies and candidate ids', async () => {
  assert.throws(() => registerStorageMaintenanceIpc(), /ipcMain/);
  assert.throws(
    () => registerStorageMaintenanceIpc({ ipcMain: { handle() {} } }),
    /getController/
  );
  const fake = captureIpcCallbacks();
  registerStorageMaintenanceIpc({
    ipcMain: fake.ipcMain,
    getController: () => ({ deleteLegacy: async () => ({}) })
  });
  await assert.rejects(
    fake.handlers.get('storage:delete-legacy')({}, { id: '../legacy.db' }),
    /候选标识/
  );
});
