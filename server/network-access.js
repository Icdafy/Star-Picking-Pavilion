'use strict';

const { isIP } = require('node:net');
const { fetch: undiciFetch } = require('undici');
const { cancelBody, readBoundedBody } = require('./collectors/fetch-util');
const { internationalTransport } = require('./collectors/transport');

const IP_ENDPOINT = 'https://www.cloudflare.com/cdn-cgi/trace';
const PROBES = ['https://www.google.com/generate_204', 'https://cp.cloudflare.com/generate_204'];
const TIMEOUT_MS = 3500;

function parseEgress(text) {
  const values = Object.fromEntries(String(text).split(/\r?\n/).map(line => {
    const i = line.indexOf('='); return i > 0 ? [line.slice(0, i), line.slice(i + 1)] : ['', ''];
  }));
  const family = isIP(values.ip || '');
  if (!family || !/^[A-Z]{2}$/.test(values.loc || '')) return { country: null, ip: null };
  // 只向界面提供脱敏出口地址，原始 IP 不写入数据库或日志。
  return { country: values.loc, ip: family === 4
    ? values.ip.split('.').slice(0, 2).join('.') + '.*.*'
    : values.ip.split(':').slice(0, 2).join(':') + ':…' };
}

function createNetworkAccess({ fetchImpl = undiciFetch, transport = internationalTransport,
  clock = Date.now, timeoutMs = TIMEOUT_MS } = {}) {
  let status = { state: 'unknown', available: false, checkedAt: null, nextCheckAt: null,
    country: null, ip: null, route: 'direct' };
  let pending = null;
  let expiresAt = 0;
  const snapshot = () => ({ ...status });

  async function inspect() {
    const connection = await transport();
    // 同一路径、短超时、禁止跳转；登录页、拦截页的 HTTP 200 不能假装联网成功。
    async function request(url, trace = false) {
      let response;
      try {
        response = await fetchImpl(url, { ...(connection.dispatcher ? { dispatcher: connection.dispatcher } : {}),
          signal: AbortSignal.timeout(timeoutMs), redirect: 'manual',
          headers: { 'User-Agent': 'StarPickingPavilion/network-check', Accept: 'text/plain' } });
        if (trace && response.status === 200) {
          return parseEgress((await readBoundedBody(response, 8192)).toString('utf8'));
        }
        return response.status === 204;
      } catch { return trace ? { country: null, ip: null } : false; }
      finally { await cancelBody(response); }
    }
    const [egress, google, cloudflare] = await Promise.all([
      request(IP_ENDPOINT, true), request(PROBES[0]), request(PROBES[1])
    ]);
    // 属地用于辅助判断；大陆出口只要实际访问成功仍可启用。IP 查询失败不会中断采集。
    const available = google || (Boolean(egress.country) && egress.country !== 'CN' && cloudflare);
    const at = clock();
    expiresAt = at + (available ? 5 * 60000 : 2 * 60000);
    status = { state: available ? 'available' : 'unavailable', available,
      checkedAt: new Date(at).toISOString(), nextCheckAt: new Date(expiresAt).toISOString(),
      ...egress, route: connection.route || 'direct' };
    return snapshot();
  }

  function detect({ force = false } = {}) {
    if (pending) return pending;
    if (!force && clock() < expiresAt) return Promise.resolve(snapshot());
    pending = inspect().catch(() => {
      const at = clock(); expiresAt = at + 2 * 60000;
      status = { state: 'unavailable', available: false, country: null, ip: null, route: 'direct',
        checkedAt: new Date(at).toISOString(), nextCheckAt: new Date(expiresAt).toISOString() };
      return snapshot();
    }).finally(() => { pending = null; });
    return pending;
  }
  return { detect, snapshot };
}

const networkAccess = createNetworkAccess();
module.exports = { IP_ENDPOINT, PROBES, TIMEOUT_MS, parseEgress, createNetworkAccess, networkAccess };
