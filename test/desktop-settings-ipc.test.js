'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getDefaultDesktopSettings,
  registerDesktopSettingsIpc
} = require('../electron/desktop-settings-ipc');

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

test('desktop settings IPC returns safe defaults before initialization', async () => {
  const fake = captureIpcCallbacks();
  registerDesktopSettingsIpc({
    ipcMain: fake.ipcMain,
    getController: () => null
  });

  assert.deepEqual([...fake.handlers.keys()], [
    'desktop-settings:get',
    'desktop-settings:update'
  ]);
  assert.deepEqual(
    await fake.handlers.get('desktop-settings:get')(),
    {
      closeToTray: false,
      launchAtLogin: false,
      launchAtLoginSupported: false,
      warnings: []
    }
  );
  assert.deepEqual(getDefaultDesktopSettings(), {
    closeToTray: false,
    launchAtLogin: false,
    launchAtLoginSupported: false,
    warnings: []
  });
  await assert.rejects(
    fake.handlers.get('desktop-settings:update')({}, { closeToTray: true }),
    /桌面设置尚未就绪/
  );
});

test('desktop settings IPC forwards the exact patch and confirmed snapshot', async () => {
  const fake = captureIpcCallbacks();
  const patch = { closeToTray: true };
  const confirmed = {
    closeToTray: true,
    launchAtLogin: false,
    launchAtLoginSupported: true,
    warnings: []
  };
  let receivedPatch;
  const controller = {
    getSettings() { return confirmed; },
    updateSettings(value) {
      receivedPatch = value;
      return Promise.resolve(confirmed);
    }
  };
  registerDesktopSettingsIpc({
    ipcMain: fake.ipcMain,
    getController: () => controller
  });

  assert.equal(await fake.handlers.get('desktop-settings:get')(), confirmed);
  assert.equal(
    await fake.handlers.get('desktop-settings:update')({}, patch),
    confirmed
  );
  assert.equal(receivedPatch, patch);
});
