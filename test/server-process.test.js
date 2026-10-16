'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  focusExistingWindow,
  showExistingWindow,
  createServerProcessController
} = require('../electron/server-process');
const { startServer } = require('./helpers/server-child');
const { createUpdateInstallCoordinator } = require('../electron/update-coordinator');

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.messages = [];
    this.killCount = 0;
  }

  postMessage(message) { this.messages.push(message); }
  kill() { this.killCount++; this.emit('exit', null); }
}

test('second instance restores, shows and focuses the existing window', () => {
  const calls = [];
  const window = {
    isDestroyed: () => false,
    isMinimized: () => true,
    isVisible: () => false,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus')
  };

  assert.equal(focusExistingWindow(window), true);
  assert.deepEqual(calls, ['restore', 'show', 'focus']);
  assert.equal(focusExistingWindow(null), false);
  assert.equal(showExistingWindow, focusExistingWindow);
});

test('unexpected child exit is reported exactly once', () => {
  const child = new FakeChild();
  const exits = [];
  createServerProcessController(child, { onUnexpectedExit: detail => exits.push(detail) });

  child.emit('exit', 9);
  child.emit('exit', 9);
  assert.equal(exits.length, 1);
  assert.equal(exits[0].code, 9);
});

test('graceful shutdown is idempotent and does not kill after server acknowledgement', async () => {
  const child = new FakeChild();
  const controller = createServerProcessController(child, { shutdownTimeoutMs: 50 });

  const first = controller.shutdown();
  const second = controller.shutdown();
  assert.equal(first, second);
  assert.deepEqual(child.messages, [{ type: 'server:shutdown' }]);

  child.emit('message', { type: 'server:stopped' });
  const result = await first;
  assert.equal(result.forced, false);
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.equal(child.killCount, 0);
});

test('shutdown force-kills only after the bounded timeout', async () => {
  const child = new FakeChild();
  const controller = createServerProcessController(child, { shutdownTimeoutMs: 15 });

  const result = await controller.shutdown();
  assert.equal(result.forced, true);
  assert.equal(child.killCount, 1);
});

test('a failed shutdown message falls back to termination and waits for actual exit', async () => {
  const child = new FakeChild();
  child.postMessage = () => { throw new Error('channel closed'); };
  const controller = createServerProcessController(child, { shutdownTimeoutMs: 20, exitTimeoutMs: 20 });
  const result = await controller.shutdown();
  assert.equal(result.forced, true);
  assert.equal(child.killCount, 1);
  assert.equal(controller.getPhase(), 'stopped');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(child.killCount, 1, 'successful termination must clear both timers');
});

test('a rejected kill reports a failure and a later shutdown can retry without stale timers', async () => {
  const child = new FakeChild();
  const cause = new Error('channel closed');
  child.postMessage = () => { throw cause; };
  child.kill = () => { child.killCount++; return false; };
  const controller = createServerProcessController(child, { shutdownTimeoutMs: 10, exitTimeoutMs: 10 });
  await assert.rejects(controller.shutdown(), error => error.code === 'server-shutdown-failed' && error.cause === cause);
  assert.equal(controller.getPhase(), 'failed');
  child.postMessage = () => child.emit('message', { type: 'server:stopped' });
  assert.deepEqual(await controller.shutdown(), { forced: false });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(child.killCount, 1);
});

test('a thrown kill rejects its pending shutdown instead of escaping the timer callback', async () => {
  const child = new FakeChild();
  const cause = new Error('termination unavailable');
  child.kill = () => { child.killCount++; throw cause; };
  const controller = createServerProcessController(child, { shutdownTimeoutMs: 5, exitTimeoutMs: 5 });
  await assert.rejects(controller.shutdown(), error => error.code === 'server-shutdown-failed' && error.cause === cause);
  assert.equal(controller.getPhase(), 'failed');
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(child.killCount, 1);
});

test('accepting termination without an exit event is bounded and never reports safe shutdown', async () => {
  const child = new FakeChild();
  child.kill = () => { child.killCount++; return true; };
  const controller = createServerProcessController(child, { shutdownTimeoutMs: 5, exitTimeoutMs: 5 });
  await assert.rejects(controller.shutdown(), { code: 'server-shutdown-failed' });
  assert.equal(child.killCount, 1);
  assert.equal(controller.getPhase(), 'failed');
  child.emit('exit', 0);
  assert.deepEqual(await controller.shutdown(), { forced: false, alreadyStopped: true });
});

test('the update installer cannot launch after unconfirmed shutdown and can retry after recovery', async () => {
  const child = new FakeChild();
  child.kill = () => false;
  const controller = createServerProcessController(child, { shutdownTimeoutMs: 5, exitTimeoutMs: 5 });
  let installs = 0;
  const coordinator = createUpdateInstallCoordinator({
    autoUpdater: { quitAndInstall: () => { installs++; } },
    shutdown: () => controller.shutdown()
  });
  assert.equal((await coordinator.install('0.2.34')).reason, 'install-failed');
  assert.equal(installs, 0);
  child.postMessage = () => child.emit('message', { type: 'server:stopped' });
  assert.deepEqual(await coordinator.install('0.2.34'), { started: true });
  assert.equal(installs, 1);
});

test('desktop shutdown releases its failed promise so the complete desktop flow can retry', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
  const start = source.indexOf('function shutdownDesktop()');
  const end = source.indexOf("app.on('before-quit'", start);
  assert.ok(start >= 0 && end > start);
  let attempts = 0, archiveStops = 0;
  const context = {
    desktopShutdownPromise: null, backendReady: true,
    dailyArchive: { stop: () => { archiveStops++; } },
    unregisterDailyArchivePowerEvents() {}, stopDailyArchiveClockWatchdog() {},
    autoUpdateTimer: null, clearInterval,
    serverController: { shutdown: async () => { if (++attempts === 1) throw new Error('cannot stop'); } }
  };
  const shutdownDesktop = vm.runInNewContext(`${source.slice(start, end)}\nshutdownDesktop`, context);
  const first = shutdownDesktop();
  assert.equal(shutdownDesktop(), first);
  await assert.rejects(first, /cannot stop/);
  assert.equal(context.desktopShutdownPromise, null);
  await shutdownDesktop();
  assert.equal(attempts, 2);
  assert.equal(archiveStops, 2);
  assert.equal(context.backendReady, false);
});

test('real server closes HTTP and SQLite before acknowledging shutdown', async t => {
  const server = await startServer(t);
  const stopped = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server shutdown timeout')), 5_000);
    server.child.on('message', message => {
      if (message?.type !== 'server:stopped') return;
      clearTimeout(timeout);
      resolve(message);
    });
  });

  server.child.send({ type: 'server:shutdown' });
  assert.deepEqual(await stopped, { type: 'server:stopped' });
  await new Promise(resolve => server.child.once('exit', resolve));
  assert.equal(server.child.exitCode, 0);
});
