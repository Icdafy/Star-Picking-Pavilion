'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CREDENTIAL_IPC_STAGES,
  createCredentialIpcTracer
} = require('../electron/credential-ipc-trace');

test('credential IPC tracing is silent outside the desktop E2E data directory', () => {
  const messages = [];
  const trace = createCredentialIpcTracer({
    enabled: false,
    log: message => messages.push(message)
  });

  for (const stage of CREDENTIAL_IPC_STAGES) trace(stage);

  assert.deepEqual(messages, []);
});

test('credential IPC tracing emits only fixed stages and never uncontrolled text', () => {
  const messages = [];
  const trace = createCredentialIpcTracer({
    enabled: true,
    log: message => messages.push(message)
  });
  const secret = 'sk-trace-test-secret';

  for (const stage of CREDENTIAL_IPC_STAGES) trace(stage);
  trace(secret);
  trace('dummy unsafe error detail');

  assert.deepEqual(messages, [
    '[credential-ipc] received',
    '[credential-ipc] stored',
    '[credential-ipc] failed',
    '[credential-ipc] ack-posted'
  ]);
  assert.equal(messages.join('\n').includes(secret), false);
  assert.equal(messages.join('\n').includes('unsafe error detail'), false);
});
