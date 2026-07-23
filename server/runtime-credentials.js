'use strict';

const crypto = require('node:crypto');

function createRuntimeCredentials({
  initialApiKey = '',
  parentPort = null,
  randomUUID = crypto.randomUUID,
  confirmationTimeoutMs = 10_000
} = {}) {
  let apiKey = String(initialApiKey || '');
  const pending = new Map();

  parentPort?.on('message', messageEvent => {
    const message = messageEvent?.data ?? messageEvent;
    if (message?.type !== 'credential:result') return;
    const request = pending.get(message.requestId);
    if (!request) return;
    pending.delete(message.requestId);
    clearTimeout(request.timeout);
    if (message.ok === true) request.resolve();
    else request.reject(new Error('凭据保存失败'));
  });

  function getApiKey() {
    return apiKey;
  }

  function setApiKey(value) {
    apiKey = String(value || '').trim();
  }

  async function persistApiKey(value) {
    const next = String(value || '').trim();
    if (!parentPort) {
      setApiKey(next);
      return;
    }

    const requestId = randomUUID();
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        clearTimeout(timeout);
        reject(new Error('凭据保存确认超时'));
      }, confirmationTimeoutMs);
      pending.set(requestId, { resolve, reject, timeout });

      try {
        parentPort.postMessage({ type: 'credential:set', requestId, apiKey: next });
      } catch {
        pending.delete(requestId);
        clearTimeout(timeout);
        reject(new Error('凭据保存失败'));
      }
    });
    setApiKey(next);
  }

  return Object.freeze({ getApiKey, setApiKey, persistApiKey });
}

const initialApiKey = String(process.env.STAR_PICKING_PAVILION_AI_API_KEY || '');
delete process.env.STAR_PICKING_PAVILION_AI_API_KEY;

const runtimeCredentials = createRuntimeCredentials({
  initialApiKey,
  parentPort: process.parentPort
});

module.exports = { ...runtimeCredentials, createRuntimeCredentials };
