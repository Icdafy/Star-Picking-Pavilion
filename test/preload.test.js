'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('preload exposes one deeply frozen preferences API under new and compatibility aliases', async () => {
  const exposed = new Map();
  const ipcCalls = [];
  let updateListener;
  const initialPreferences = {
    version: 1,
    theme: 'dark',
    view: 'featured',
    domain: '',
    category: '',
    dailyDate: null,
    linksCategory: '全部',
    commonLinksFavorites: ['caac', 'miit'],
    realtime: true,
    closeToTray: false
  };
  const desktopSnapshot = {
    closeToTray: false,
    launchAtLogin: false,
    launchAtLoginSupported: true,
    warnings: []
  };
  const dailyArchiveSnapshot = {
    schemaVersion: 1,
    enabled: true,
    rootDirectory: 'D:\\Research',
    pendingDates: [],
    lastResult: null
  };
  const electron = {
    contextBridge: {
      exposeInMainWorld(name, value) { exposed.set(name, value); }
    },
    ipcRenderer: {
      sendSync(channel) {
        ipcCalls.push(['sendSync', channel]);
        if (channel === 'app:get-version') return '9.8.7';
        if (channel === 'preferences:get') {
          return {
            preferences: initialPreferences,
            hasStoredPreferences: true
          };
        }
        throw new Error(`Unexpected sendSync channel: ${channel}`);
      },
      on(channel, listener) { ipcCalls.push(['on', channel]); updateListener = listener; },
      invoke(channel, ...args) {
        ipcCalls.push(['invoke', channel, ...args]);
        if (channel === 'desktop-settings:get') return Promise.resolve(desktopSnapshot);
        if (channel === 'desktop-settings:update') {
          return Promise.resolve({
            ...desktopSnapshot,
            closeToTray: args[0]?.closeToTray === true
          });
        }
        if (channel === 'daily-archive:get') return Promise.resolve(dailyArchiveSnapshot);
        if (channel === 'daily-archive:choose-directory') {
          return Promise.resolve({ canceled: false, settings: dailyArchiveSnapshot });
        }
        if (channel === 'daily-archive:set-enabled') {
          return Promise.resolve({
            ...dailyArchiveSnapshot,
            enabled: args[0]?.enabled === true
          });
        }
        if (channel === 'daily-archive:save-current') {
          return Promise.resolve({
            result: { status: 'saved', date: '2026-07-31' },
            settings: dailyArchiveSnapshot
          });
        }
        if (channel === 'daily-archive:retry') {
          return Promise.resolve({ results: [], settings: dailyArchiveSnapshot });
        }
        return Promise.resolve('invoked');
      }
    }
  };
  const context = vm.createContext({
    require(id) {
      assert.equal(id, 'electron');
      return electron;
    }
  });

  vm.runInContext(read('electron/preload.js'), context, { filename: 'electron/preload.js' });

  const api = exposed.get('starPickingPavilion');
  assert.equal(api, exposed.get('windcatcher'));
  assert.equal(Object.isFrozen(api), true);
  assert.equal(api.version, '9.8.7');
  assert.deepEqual(ipcCalls[0], ['sendSync', 'app:get-version']);
  assert.deepEqual(ipcCalls[1], ['sendSync', 'preferences:get']);
  assert.deepEqual(JSON.parse(JSON.stringify(api.preferences)), initialPreferences);
  assert.notEqual(api.preferences, initialPreferences);
  assert.notEqual(api.preferences.commonLinksFavorites, initialPreferences.commonLinksFavorites);
  assert.equal(Object.isFrozen(api.preferences), true);
  assert.equal(Object.isFrozen(api.preferences.commonLinksFavorites), true);
  assert.equal(api.hasStoredPreferences, true);
  assert.throws(() => { api.preferences.theme = 'light'; }, TypeError);
  assert.throws(() => { api.preferences.commonLinksFavorites.push('new'); }, TypeError);

  const patch = { theme: 'light', commonLinksFavorites: ['caac'] };
  await api.updatePreferences(patch);
  assert.deepEqual(ipcCalls.at(-1), ['invoke', 'preferences:update', patch]);

  const desktopSettings = await api.getDesktopSettings();
  assert.equal(Object.isFrozen(desktopSettings), true);
  assert.equal(Object.isFrozen(desktopSettings.warnings), true);
  assert.deepEqual(JSON.parse(JSON.stringify(desktopSettings)), desktopSnapshot);

  const updated = await api.updateDesktopSettings({ closeToTray: true });
  assert.equal(Object.isFrozen(updated), true);
  assert.equal(updated.closeToTray, true);
  assert.deepEqual(ipcCalls.at(-1), [
    'invoke',
    'desktop-settings:update',
    { closeToTray: true }
  ]);

  const storageSnapshot = await api.getStorageSnapshot();
  assert.equal(storageSnapshot, 'invoked');
  assert.deepEqual(ipcCalls.at(-1), ['invoke', 'storage:get']);
  await api.clearManagedCache();
  assert.deepEqual(ipcCalls.at(-1), ['invoke', 'storage:clear-cache']);
  await api.deleteLegacyData('legacy-123456789abc');
  assert.deepEqual(
    JSON.parse(JSON.stringify(ipcCalls.at(-1))),
    ['invoke', 'storage:delete-legacy', { id: 'legacy-123456789abc' }]
  );

  const archiveSettings = await api.getDailyArchiveSettings();
  assert.deepEqual(JSON.parse(JSON.stringify(archiveSettings)), dailyArchiveSnapshot);
  assert.equal(Object.isFrozen(archiveSettings), true);
  assert.equal(Object.isFrozen(archiveSettings.pendingDates), true);
  assert.deepEqual(ipcCalls.at(-1), ['invoke', 'daily-archive:get']);

  const chosen = await api.chooseDailyArchiveDirectory();
  assert.equal(chosen.canceled, false);
  assert.equal(Object.isFrozen(chosen), true);
  assert.equal(Object.isFrozen(chosen.settings), true);
  assert.deepEqual(ipcCalls.at(-1), ['invoke', 'daily-archive:choose-directory']);

  const disabledArchive = await api.setDailyArchiveEnabled(false);
  assert.equal(disabledArchive.enabled, false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(ipcCalls.at(-1))),
    ['invoke', 'daily-archive:set-enabled', { enabled: false }]
  );

  const manualSave = await api.saveCurrentDailyArchive();
  assert.equal(manualSave.result.status, 'saved');
  assert.equal(Object.isFrozen(manualSave.result), true);
  assert.deepEqual(ipcCalls.at(-1), ['invoke', 'daily-archive:save-current']);

  const retriedArchives = await api.retryDailyArchives();
  assert.equal(Object.isFrozen(retriedArchives.results), true);
  assert.deepEqual(ipcCalls.at(-1), ['invoke', 'daily-archive:retry']);

  let payload;
  api.onUpdateStatus(value => { payload = value; });
  updateListener({}, { status: 'downloaded' });
  assert.deepEqual(payload, { status: 'downloaded' });
  await api.installUpdate();
  assert.deepEqual(ipcCalls.at(-1), ['invoke', 'update:install']);
});

test('main process answers synchronous app version IPC from app metadata', () => {
  const main = read('electron/main.js');

  assert.match(main, /ipcMain\.on\(['"]app:get-version['"]/);
  assert.match(main, /returnValue\s*=\s*app\.getVersion\(\)/);
});
