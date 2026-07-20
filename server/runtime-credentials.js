'use strict';

const crypto = require('node:crypto');

let apiKey = String(process.env.STAR_PICKING_PAVILION_AI_API_KEY || '');
delete process.env.STAR_PICKING_PAVILION_AI_API_KEY;

const pending = new Map();
const parentPort = process.parentPort;

parentPort?.on('message', message => {
  if (message?.type !== 'credential:result') return;
  const request = pending.get(message.requestId);
  if (!request) return;
  pending.delete(message.requestId);
  clearTimeout(request.timeout);
  if (message.ok) request.resolve();
  else request.reject(new Error(message.error || '凭据保存失败'));
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

  const requestId = crypto.randomUUID();
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('凭据保存确认超时'));
    }, 10_000);
    pending.set(requestId, { resolve, reject, timeout });
    parentPort.postMessage({ type: 'credential:set', requestId, apiKey: next });
  });
  setApiKey(next);
}

module.exports = { getApiKey, setApiKey, persistApiKey };
