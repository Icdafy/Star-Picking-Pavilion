'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isTrustedDesktopSender, createTrustedIpcMain } = require('../electron/ipc-policy');

function fixture() {
  const frame = { url: 'http://127.0.0.1:7654/' };
  const contents = { mainFrame: frame, isDestroyed: () => false };
  return {
    event: { sender: contents, senderFrame: frame },
    policy: { window: { webContents: contents, isDestroyed: () => false }, origin: 'http://127.0.0.1:7654', recoveryUrl: 'file:///C:/app/renderer/startup-failure.html' }
  };
}

test('only the live application main frame can reach desktop operations', () => {
  const { event, policy } = fixture();
  assert.equal(isTrustedDesktopSender(event, policy), true);
  for (const rejected of [null, {}, { ...event, sender: {} }, { ...event, senderFrame: { url: event.senderFrame.url } }, { ...event, senderFrame: null }]) {
    assert.equal(isTrustedDesktopSender(rejected, policy), false);
  }
  assert.equal(isTrustedDesktopSender(event, { ...policy, window: { ...policy.window, isDestroyed: () => true } }), false);
  assert.equal(isTrustedDesktopSender(event, { ...policy, window: null }), false);
});

test('document checks reject external, arbitrary local and credential-bearing URLs', () => {
  const { event, policy } = fixture();
  for (const url of ['https://example.com/', 'http://127.0.0.1:7655/', 'http://user:password@127.0.0.1:7654/', 'http://127.0.0.1:7654/api/settings', 'file:///C:/other.html', 'about:blank']) {
    event.senderFrame.url = url;
    assert.equal(isTrustedDesktopSender(event, policy), false, url);
  }
  for (const url of ['http://127.0.0.1:7654/failure.html', 'file:///C:/app/renderer/startup-failure.html']) {
    event.senderFrame.url = url;
    assert.equal(isTrustedDesktopSender(event, policy), true, url);
  }
});

test('rejected invoke, sync and send requests never execute their registered operation', async () => {
  const handlers = new Map(), listeners = new Map();
  let trusted = false, calls = 0;
  const ipc = createTrustedIpcMain({
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), on: (channel, fn) => listeners.set(channel, fn) },
    isTrusted: () => trusted
  });
  ipc.handle('write', async (_event, patch) => { calls++; return patch; });
  ipc.on('read', event => { calls++; event.returnValue = 'private'; });
  assert.throws(() => handlers.get('write')({}, 'patch'), /不允许/);
  const event = {};
  listeners.get('read')(event);
  assert.equal(event.returnValue, null);
  assert.equal(calls, 0);
  trusted = true;
  assert.equal(await handlers.get('write')({}, 'patch'), 'patch');
  listeners.get('read')(event);
  assert.equal(event.returnValue, 'private');
  assert.equal(calls, 2);
});
