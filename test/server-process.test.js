'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  focusExistingWindow,
  createServerProcessController
} = require('../electron/server-process');
const { startServer } = require('./helpers/server-child');

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
