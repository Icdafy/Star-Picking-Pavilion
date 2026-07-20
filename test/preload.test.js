'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('preload exposes one frozen dynamic-version API under new and compatibility aliases', async () => {
  const exposed = new Map();
  const ipcCalls = [];
  let updateListener;
  const electron = {
    contextBridge: {
      exposeInMainWorld(name, value) { exposed.set(name, value); }
    },
    ipcRenderer: {
      sendSync(channel) { ipcCalls.push(['sendSync', channel]); return '9.8.7'; },
      on(channel, listener) { ipcCalls.push(['on', channel]); updateListener = listener; },
      invoke(channel) { ipcCalls.push(['invoke', channel]); return Promise.resolve('invoked'); }
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
