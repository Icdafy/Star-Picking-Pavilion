'use strict';

const crypto = require('node:crypto');
const { createCredentialIpcTracer } = require('../electron/credential-ipc-trace');

const DEFAULT_PROVIDER = 'deepseek';
const BUNDLE_MARKER = 'spp-credentials';

// 凭据文件仍是 Electron safeStorage 加密的单个字符串。只有 DeepSeek 一把密钥时
// 保持旧格式（明文密钥本身，旧版本与回滚安装包都读得懂）；多提供商时序列化为
// {"spp-credentials":2,"keys":{...}}。API Key 不会以 { 开头，两种格式不会混淆。
function parseCredentialBundle(raw) {
  const text = String(raw || '').trim();
  if (!text) return {};
  if (text.startsWith(`{"${BUNDLE_MARKER}"`)) {
    try {
      const parsed = JSON.parse(text);
      const keys = {};
      for (const [provider, value] of Object.entries(parsed?.keys || {})) {
        const key = typeof value === 'string' ? value.trim() : '';
        if (key && /^[a-z][a-z0-9-]{0,39}$/.test(provider)) keys[provider] = key;
      }
      return keys;
    } catch {
      return {};
    }
  }
  return { [DEFAULT_PROVIDER]: text };
}

function serializeCredentialBundle(keys) {
  const entries = Object.entries(keys || {}).filter(([, value]) => typeof value === 'string' && value.trim());
  if (!entries.length) return '';
  if (entries.length === 1 && entries[0][0] === DEFAULT_PROVIDER) return entries[0][1].trim();
  entries.sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify({ [BUNDLE_MARKER]: 2, keys: Object.fromEntries(entries.map(([k, v]) => [k, v.trim()])) });
}

function createRuntimeCredentials({
  initialApiKey = '',
  parentPort = null,
  randomUUID = crypto.randomUUID,
  confirmationTimeoutMs = 10_000,
  trace = () => {}
} = {}) {
  if (typeof trace !== 'function') throw new TypeError('trace must be a function');
  let keys = parseCredentialBundle(initialApiKey);
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

  function getProviderKey(provider) {
    return keys[provider] || '';
  }

  function setProviderKey(provider, value) {
    const next = String(value || '').trim();
    keys = { ...keys };
    if (next) keys[provider] = next;
    else delete keys[provider];
  }

  function configuredProviders() {
    return Object.keys(keys);
  }

  function getApiKey() {
    return getProviderKey(DEFAULT_PROVIDER);
  }

  function setApiKey(value) {
    setProviderKey(DEFAULT_PROVIDER, value);
  }

  async function persistApiKey(value) {
    return persistProviderKey(DEFAULT_PROVIDER, value);
  }

  async function persistProviderKey(provider, value) {
    const next = String(value || '').trim();
    trace('credential-persist-start');
    if (disposed) throw new Error('凭据保存失败');
    if (!parentPort) {
      setProviderKey(provider, next);
      return;
    }
    const nextKeys = { ...keys };
    if (next) nextKeys[provider] = next;
    else delete nextKeys[provider];

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
        parentPort.postMessage({ type: 'credential:set', requestId, apiKey: serializeCredentialBundle(nextKeys) });
        trace('credential-posted');
      } catch {
        pending.delete(requestId);
        clearTimeout(timeout);
        reject(new Error('凭据保存失败'));
      }
    });
    setProviderKey(provider, next);
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

  return Object.freeze({
    getApiKey, setApiKey, persistApiKey,
    getProviderKey, setProviderKey, persistProviderKey, configuredProviders,
    dispose
  });
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
  getProviderKey: runtimeCredentials.getProviderKey,
  setProviderKey: runtimeCredentials.setProviderKey,
  persistProviderKey: runtimeCredentials.persistProviderKey,
  configuredProviders: runtimeCredentials.configuredProviders,
  createRuntimeCredentials,
  parseCredentialBundle,
  serializeCredentialBundle
};
