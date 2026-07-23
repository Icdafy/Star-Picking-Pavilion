'use strict';

const crypto = require('node:crypto');
const { createCredentialIpcTracer } = require('../electron/credential-ipc-trace');

function createRuntimeCredentials({
  initialApiKey = '',
  parentPort = null,
  randomUUID = crypto.randomUUID,
  confirmationTimeoutMs = 10_000,
  trace = () => {}
} = {}) {
  if (typeof trace !== 'function') throw new TypeError('trace must be a function');
  let apiKey = String(initialApiKey || '');
  const pending = new Map();
  let disposed = false;

  function handleMessage(messageEvent) {
    const message = messageEvent?.data ?? messageEvent;
    if (message?.type !== 'credential:result') return;
    trace('credential-ack-received');
    const request = pending.get(message.requestId);
    if (!request) return;
    pending.delete(message.requestId);
    clearTimeout(request.timeout);
    if (message.ok === true) request.resolve();
    else request.reject(new Error('凭据保存失败'));
  }

  parentPort?.on('message', handleMessage);

  function getApiKey() {
    return apiKey;
  }

  function setApiKey(value) {
    apiKey = String(value || '').trim();
  }

  async function persistApiKey(value) {
    const next = String(value || '').trim();
    trace('credential-persist-start');
    if (disposed) throw new Error('凭据保存失败');
    if (!parentPort) {
      setApiKey(next);
      return;
    }

    const requestId = randomUUID();
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        clearTimeout(timeout);
        trace('credential-timeout');
        reject(new Error('凭据保存确认超时'));
      }, confirmationTimeoutMs);
      pending.set(requestId, { resolve, reject, timeout });

      try {
        parentPort.postMessage({ type: 'credential:set', requestId, apiKey: next });
        trace('credential-posted');
      } catch {
        pending.delete(requestId);
        clearTimeout(timeout);
        reject(new Error('凭据保存失败'));
      }
    });
    setApiKey(next);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (typeof parentPort?.off === 'function') {
      parentPort.off('message', handleMessage);
    } else {
      parentPort?.removeListener?.('message', handleMessage);
    }
    for (const [requestId, request] of pending) {
      pending.delete(requestId);
      clearTimeout(request.timeout);
      request.reject(new Error('凭据保存失败'));
    }
  }

  return Object.freeze({ getApiKey, setApiKey, persistApiKey, dispose });
}

const initialApiKey = String(process.env.STAR_PICKING_PAVILION_AI_API_KEY || '');
delete process.env.STAR_PICKING_PAVILION_AI_API_KEY;
const traceCredentialIpc = createCredentialIpcTracer({
  enabled: Boolean(process.env.STAR_PICKING_PAVILION_TEST_DATA_DIR)
});

const runtimeCredentials = createRuntimeCredentials({
  initialApiKey,
  parentPort: process.parentPort,
  trace: traceCredentialIpc
});

module.exports = {
  getApiKey: runtimeCredentials.getApiKey,
  setApiKey: runtimeCredentials.setApiKey,
  persistApiKey: runtimeCredentials.persistApiKey,
  createRuntimeCredentials
};
