'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { EnvHttpProxyAgent } = require('undici');
const run = promisify(execFile);
const REGISTRY_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
let systemCache = null;
let systemPending = null;
let agent = null;
let agentKey = '';

function proxyUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `http://${value}`);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function parseSystemProxy(server, bypass = '') {
  const values = {};
  for (const part of String(server || '').split(';')) {
    const entry = part.trim();
    const pair = /^(http|https)=(.+)$/i.exec(entry);
    if (pair) values[pair[1].toLowerCase()] = proxyUrl(pair[2].trim());
    else if (!entry.includes('=')) values.http ||= proxyUrl(entry);
  }
  const noProxy = String(bypass).split(';').map(s => s.trim()).filter(s => s && s !== '<local>').join(',');
  return { httpProxy: values.http || '', httpsProxy: values.https || values.http || '', noProxy };
}

async function readSystemProxy({ platform = process.platform, execute = run } = {}) {
  if (platform !== 'win32') return {};
  try {
    const { stdout } = await execute('reg.exe', ['query', REGISTRY_KEY], { windowsHide: true, timeout: 1500, maxBuffer: 32768 });
    const enabled = /\bProxyEnable\s+REG_DWORD\s+0x1\b/i.test(stdout);
    if (!enabled) return {};
    const server = /\bProxyServer\s+REG_SZ\s+([^\r\n]+)/i.exec(stdout)?.[1];
    const bypass = /\bProxyOverride\s+REG_SZ\s+([^\r\n]+)/i.exec(stdout)?.[1];
    return parseSystemProxy(server, bypass);
  } catch { return {}; }
}

async function resolveProxyConfig({ env = process.env, systemProxy } = {}) {
  const httpProxy = proxyUrl(env.http_proxy || env.HTTP_PROXY);
  const httpsProxy = proxyUrl(env.https_proxy || env.HTTPS_PROXY);
  if (httpProxy || httpsProxy) return { httpProxy, httpsProxy: httpsProxy || httpProxy,
    noProxy: env.no_proxy || env.NO_PROXY || '', route: 'environment-proxy' };
  let system = systemProxy;
  if (!system) {
    if (!systemCache || Date.now() - systemCache.at >= 30000) {
      if (!systemPending) systemPending = readSystemProxy().then(value => {
        systemCache = { at: Date.now(), value }; return value;
      }).finally(() => { systemPending = null; });
      system = await systemPending;
    } else system = systemCache.value;
  }
  return { ...system, route: system.httpsProxy || system.httpProxy ? 'system-proxy' : 'direct' };
}

async function internationalTransport() {
  const config = await resolveProxyConfig();
  if (config.route === 'direct') {
    const previous = agent;
    agent = null; agentKey = '';
    if (previous) void previous.close().catch(() => {});
    return { route: 'direct' };
  }
  const options = { httpProxy: config.httpProxy, httpsProxy: config.httpsProxy,
    noProxy: [config.noProxy, 'localhost,127.0.0.1,::1'].filter(Boolean).join(',') };
  const key = JSON.stringify(options);
  if (key !== agentKey) {
    const previous = agent;
    agent = new EnvHttpProxyAgent(options);
    agentKey = key;
    if (previous) void previous.close().catch(() => {});
  }
  return { route: config.route, dispatcher: agent };
}

module.exports = { proxyUrl, parseSystemProxy, readSystemProxy, resolveProxyConfig, internationalTransport };
