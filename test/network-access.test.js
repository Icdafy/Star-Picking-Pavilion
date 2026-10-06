'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createNetworkAccess, parseEgress, IP_ENDPOINT, PROBES } = require('../server/network-access');
const { parseSystemProxy, resolveProxyConfig, readSystemProxy } = require('../server/collectors/transport');

function detector({ country = 'CN', google = 403, cloudflare = 204, traceFail = false, clock = Date.now } = {}) {
  const calls = [];
  const network = createNetworkAccess({ clock, transport: async () => ({ route: 'direct' }),
    fetchImpl: async (url, options) => {
      calls.push([url, options]);
      if (url === IP_ENDPOINT) {
        if (traceFail) throw new Error('IP query offline');
        return new Response(`ip=203.0.113.42\nloc=${country}\n`, { status: 200 });
      }
      const status = url === PROBES[0] ? google : cloudflare;
      return new Response(status === 204 ? null : '<html>登录页</html>', { status });
    } });
  return { network, calls };
}

test('大陆出口加无法访问外网，正常返回不可用；拦截页 200 或跳转不算联网', async () => {
  for (const google of [200, 302, 403]) {
    const { network, calls } = detector({ google });
    assert.equal((await network.detect()).available, false);
    assert.equal(network.snapshot().state, 'unavailable');
    assert.ok(calls.every(([, options]) => options.redirect === 'manual'));
  }
});

test('大陆 IP 可通过代理实际访问；境外属地本身不能保证网络可用', async () => {
  assert.equal((await detector({ google: 204 }).network.detect()).available, true);
  assert.equal((await detector({ country: 'US', google: 403, cloudflare: 403 }).network.detect()).available, false);
  assert.equal((await detector({ country: 'US' }).network.detect()).available, true);
});

test('IP 服务失败仍以实际连通性判断；只返回脱敏 IP', async () => {
  assert.equal((await detector({ google: 204, traceFail: true }).network.detect()).available, true);
  assert.deepEqual(parseEgress('ip=1.2.3.4\nloc=CN'), { country: 'CN', ip: '1.2.*.*' });
  assert.deepEqual(parseEgress('ip=2001:4860::8888\nloc=US'), { country: 'US', ip: '2001:4860:…' });
  assert.deepEqual(parseEgress('<html>login</html>'), { country: null, ip: null });
  const status = await detector().network.detect();
  assert.doesNotMatch(JSON.stringify(status), /203\.0\.113\.42/);
});

test('并发检测共用请求，缓存到期自动重新检测，强制检测可恢复', async () => {
  let at = Date.parse('2026-10-07T00:00:00Z');
  const { network, calls } = detector({ clock: () => at });
  await Promise.all([network.detect(), network.detect({ force: true })]);
  assert.equal(calls.length, 3);
  await network.detect();
  assert.equal(calls.length, 3);
  at += 120001;
  await network.detect();
  assert.equal(calls.length, 6);
  await network.detect({ force: true });
  assert.equal(calls.length, 9);
});

test('检测超时正常返回，无抛错或未处理的拒绝', async () => {
  const network = createNetworkAccess({ timeoutMs: 15, transport: async () => ({ route: 'direct' }),
    fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
      const keeper = setTimeout(() => resolve(new Response(null, { status: 204 })), 1000);
      signal.addEventListener('abort', () => { clearTimeout(keeper); reject(signal.reason); }, { once: true });
    }) });
  const at = Date.now();
  assert.equal((await network.detect()).state, 'unavailable');
  assert.ok(Date.now() - at < 500);
});

test('Windows 单地址及分协议系统代理和环境代理优先级', async () => {
  assert.deepEqual(parseSystemProxy('127.0.0.1:7890', '<local>;*.example.test'),
    { httpProxy: 'http://127.0.0.1:7890/', httpsProxy: 'http://127.0.0.1:7890/', noProxy: '*.example.test' });
  assert.equal(parseSystemProxy('http=127.0.0.1:7890;https=127.0.0.1:7891').httpsProxy, 'http://127.0.0.1:7891/');
  const systemProxy = parseSystemProxy('127.0.0.1:7890');
  assert.equal((await resolveProxyConfig({ env: {}, systemProxy })).route, 'system-proxy');
  const resolved = await resolveProxyConfig({ env: { HTTPS_PROXY: 'http://proxy.test:8080' }, systemProxy });
  assert.equal(resolved.httpsProxy, 'http://proxy.test:8080/');
  assert.equal(resolved.route, 'environment-proxy');
  assert.equal((await resolveProxyConfig({ env: {}, systemProxy: {} })).route, 'direct');
});

test('系统代理读取使用隐藏原生命令，查询失败或未启用直接降级', async () => {
  let invocation;
  const system = await readSystemProxy({ platform: 'win32', execute: async (...args) => {
    invocation = args;
    return { stdout: 'ProxyEnable    REG_DWORD    0x1\r\nProxyServer    REG_SZ    http=127.0.0.1:8888;https=127.0.0.1:8889\r\n' };
  } });
  assert.equal(invocation[0], 'reg.exe');
  assert.equal(invocation[2].windowsHide, true);
  assert.equal(system.httpsProxy, 'http://127.0.0.1:8889/');
  assert.deepEqual(await readSystemProxy({ platform: 'win32', execute: async () => { throw new Error('no registry'); } }), {});
  assert.deepEqual(await readSystemProxy({ platform: 'win32', execute: async () => ({ stdout: 'ProxyEnable REG_DWORD 0x0' }) }), {});
});
