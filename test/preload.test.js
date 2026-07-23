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
    realtime: true
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
