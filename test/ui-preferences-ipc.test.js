'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getDefaultUiPreferences } = require('../electron/ui-preferences');
const {
  registerUiPreferencesIpc,
  loadUiPreferencesStore
} = require('../electron/ui-preferences-ipc');

function captureIpcCallbacks() {
  const listeners = new Map();
  const handlers = new Map();
  return {
    ipcMain: {
      on(channel, callback) {
        assert.equal(listeners.has(channel), false);
        listeners.set(channel, callback);
      },
      handle(channel, callback) {
        assert.equal(handlers.has(channel), false);
        handlers.set(channel, callback);
      }
    },
    listeners,
    handlers
  };
}

test('preferences:get returns exact defaults and false before the store is initialized', () => {
  const fake = captureIpcCallbacks();
  registerUiPreferencesIpc({ ipcMain: fake.ipcMain, getStore: () => null });

  assert.deepEqual([...fake.listeners.keys()], ['preferences:get']);
  assert.deepEqual([...fake.handlers.keys()], ['preferences:update']);

  const event = {};
  fake.listeners.get('preferences:get')(event);
  assert.deepEqual(event.returnValue, {
    preferences: getDefaultUiPreferences(),
    hasStoredPreferences: false
  });
});

test('preferences:get returns only the initialized store snapshot and storage flag', () => {
  const fake = captureIpcCallbacks();
  const snapshot = getDefaultUiPreferences();
  snapshot.theme = 'light';
  const store = {
    getSnapshot: () => snapshot,
    hasStoredPreferences: () => true
  };
  registerUiPreferencesIpc({ ipcMain: fake.ipcMain, getStore: () => store });

  const event = {};
  fake.listeners.get('preferences:get')(event);
  assert.deepEqual(event.returnValue, {
    preferences: snapshot,
    hasStoredPreferences: true
  });
  assert.deepEqual(Object.keys(event.returnValue), ['preferences', 'hasStoredPreferences']);
});

test('preferences:update forwards the exact patch and returns the store result', async () => {
  const fake = captureIpcCallbacks();
  const patch = { theme: 'light' };
  const updated = { ...getDefaultUiPreferences(), ...patch };
  let receivedPatch;
  const store = {
    update(value) {
      receivedPatch = value;
      return Promise.resolve(updated);
    }
  };
  registerUiPreferencesIpc({ ipcMain: fake.ipcMain, getStore: () => store });

  const result = await fake.handlers.get('preferences:update')({}, patch);
  assert.equal(receivedPatch, patch);
  assert.equal(result, updated);
});

test('preferences:update rejects safely before the store is initialized', async () => {
  const fake = captureIpcCallbacks();
  registerUiPreferencesIpc({ ipcMain: fake.ipcMain, getStore: () => undefined });

  await assert.rejects(
    fake.handlers.get('preferences:update')({}, { theme: 'light' }),
    error => {
      assert.equal(error.message, 'UI preferences are not ready');
      assert.doesNotMatch(error.message, /path|directory|file|api.?key/i);
      return true;
    }
  );
});

test('loadUiPreferencesStore resolves only after loading the exact directory store', async () => {
  const directory = 'C:\\Users\\example\\preferences';
  let createOptions;
  let releaseLoad;
  let resolved = false;
  const store = {
    load() {
      return new Promise(resolve => { releaseLoad = resolve; });
    }
  };
  const loading = loadUiPreferencesStore({
    directory,
    createStore(options) {
      createOptions = options;
      return store;
    }
  });
  loading.then(() => { resolved = true; });

  assert.deepEqual(createOptions, { directory });
  await Promise.resolve();
  assert.equal(resolved, false);

  releaseLoad();
  assert.equal(await loading, store);
  assert.equal(resolved, true);
});
