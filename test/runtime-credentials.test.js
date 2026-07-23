'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createRuntimeCredentials } = require('../server/runtime-credentials');

class FakeParentPort extends EventEmitter {
  constructor({ postMessage } = {}) {
    super();
    this.sent = [];
    this.postMessageImplementation = postMessage;
  }

  postMessage(message) {
    this.sent.push(message);
    if (this.postMessageImplementation) this.postMessageImplementation(message);
  }
}

function createIds(...ids) {
  let index = 0;
  return () => ids[index++];
}

function emitResult(parentPort, requestId, options = {}) {
  const message = { type: 'credential:result', requestId, ok: true, ...options };
  parentPort.emit('message', message);
}

test('accepts an Electron MessageEvent credential acknowledgement', async () => {
  const parentPort = new FakeParentPort();
  const credentials = createRuntimeCredentials({
    initialApiKey: 'dummy-old-electron',
    parentPort,
    randomUUID: createIds('request-electron'),
    confirmationTimeoutMs: 5_000
  });

  const persisted = credentials.persistApiKey('dummy-new-electron');
  assert.deepEqual(parentPort.sent, [{
    type: 'credential:set',
    requestId: 'request-electron',
    apiKey: 'dummy-new-electron'
  }]);

  parentPort.emit('message', {
    data: { type: 'credential:result', requestId: 'request-electron', ok: true }
  });

  await persisted;
  assert.equal(credentials.getApiKey(), 'dummy-new-electron');
});

test('accepts a direct Node credential acknowledgement', async () => {
  const parentPort = new FakeParentPort();
  const credentials = createRuntimeCredentials({
    initialApiKey: 'dummy-old-direct',
    parentPort,
    randomUUID: createIds('request-direct'),
    confirmationTimeoutMs: 5_000
  });

  const persisted = credentials.persistApiKey('dummy-new-direct');
  emitResult(parentPort, 'request-direct');

  await persisted;
  assert.equal(credentials.getApiKey(), 'dummy-new-direct');
});

test('rejects a failed acknowledgement without changing the current key', async () => {
  const parentPort = new FakeParentPort();
  const credentials = createRuntimeCredentials({
    initialApiKey: 'dummy-old-rejected',
    parentPort,
    randomUUID: createIds('request-rejected'),
    confirmationTimeoutMs: 5_000
  });

  const persisted = credentials.persistApiKey('dummy-new-rejected');
  emitResult(parentPort, 'request-rejected', {
    ok: false,
    error: 'dummy unsafe upstream detail'
  });

  await assert.rejects(persisted, /凭据保存失败/);
  assert.equal(credentials.getApiKey(), 'dummy-old-rejected');
});

test('ignores mismatched and duplicate acknowledgements', async () => {
  const parentPort = new FakeParentPort();
  const credentials = createRuntimeCredentials({
    initialApiKey: 'dummy-old-routing',
    parentPort,
    randomUUID: createIds('request-routing'),
    confirmationTimeoutMs: 5_000
  });

  let settled = false;
  const persisted = credentials.persistApiKey('dummy-new-routing')
    .finally(() => { settled = true; });

  emitResult(parentPort, 'request-unknown');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(credentials.getApiKey(), 'dummy-old-routing');

  emitResult(parentPort, 'request-routing');
  await persisted;
  emitResult(parentPort, 'request-routing', { ok: false });
  assert.equal(credentials.getApiKey(), 'dummy-new-routing');
});

test('times out and ignores a late acknowledgement', async () => {
  const parentPort = new FakeParentPort();
  const credentials = createRuntimeCredentials({
    initialApiKey: 'dummy-old-timeout',
    parentPort,
    randomUUID: createIds('request-timeout'),
    confirmationTimeoutMs: 5
  });

  await assert.rejects(
    credentials.persistApiKey('dummy-new-timeout'),
    /凭据保存确认超时/
  );
  emitResult(parentPort, 'request-timeout');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(credentials.getApiKey(), 'dummy-old-timeout');
});

test('updates the in-memory key immediately without a parent port', async () => {
  const credentials = createRuntimeCredentials({
    initialApiKey: 'dummy-old-memory',
    parentPort: null
  });

  await credentials.persistApiKey('  dummy-new-memory  ');
  assert.equal(credentials.getApiKey(), 'dummy-new-memory');
});

test('rejects promptly when postMessage throws and keeps the current key', async () => {
  const parentPort = new FakeParentPort({
    postMessage: () => { throw new Error('dummy transport failure'); }
  });
  const credentials = createRuntimeCredentials({
    initialApiKey: 'dummy-old-transport',
    parentPort,
    randomUUID: createIds('request-transport'),
    confirmationTimeoutMs: 5_000
  });

  await assert.rejects(
    credentials.persistApiKey('dummy-new-transport'),
    /凭据保存失败/
  );
  assert.equal(credentials.getApiKey(), 'dummy-old-transport');
});

test('routes concurrent credential acknowledgements by request ID', async () => {
  const parentPort = new FakeParentPort();
  const credentials = createRuntimeCredentials({
    initialApiKey: 'dummy-old-concurrent',
    parentPort,
    randomUUID: createIds('request-first', 'request-second'),
    confirmationTimeoutMs: 5_000
  });

  const first = credentials.persistApiKey('dummy-key-first');
  const second = credentials.persistApiKey('dummy-key-second');

  emitResult(parentPort, 'request-second');
  await second;
  assert.equal(credentials.getApiKey(), 'dummy-key-second');

  emitResult(parentPort, 'request-first');
  await first;
  // This layer applies acknowledgements in completion order. The settings
  // coordinator prevents production settings transactions from calling it concurrently.
  assert.equal(credentials.getApiKey(), 'dummy-key-first');
});

test('dispose removes its listener and safely rejects pending requests', async () => {
  const parentPort = new FakeParentPort();
  const first = createRuntimeCredentials({
    initialApiKey: 'dummy-old-dispose',
    parentPort,
    randomUUID: createIds('request-dispose'),
    confirmationTimeoutMs: 5_000
  });
  assert.equal(typeof first.dispose, 'function');
  assert.equal(parentPort.listenerCount('message'), 1);

  const rejected = assert.rejects(
    first.persistApiKey('dummy-new-dispose'),
    /凭据保存失败/
  );
  first.dispose();
  first.dispose();
  await rejected;
  assert.equal(first.getApiKey(), 'dummy-old-dispose');
  assert.equal(parentPort.listenerCount('message'), 0);

  const second = createRuntimeCredentials({ parentPort });
  assert.equal(parentPort.listenerCount('message'), 1);
  second.dispose();
  assert.equal(parentPort.listenerCount('message'), 0);
});
