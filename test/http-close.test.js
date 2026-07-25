'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');

const { closeHttpServerGracefully, DEFAULT_GRACE_MS } = require('../server/http-close');

function listen(handler = (req, res) => res.end('ok')) {
  const server = http.createServer(handler);
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function request(port, path = '/') {
  return new Promise((resolve, reject) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 4 });
    const req = http.request({ host: '127.0.0.1', port, path, agent }, res => {
      res.resume();
      res.on('end', () => resolve(agent));
    });
    req.on('error', reject);
    req.end();
  });
}

test('尚未监听的服务直接返回，不会挂在 close 回调上', async () => {
  const { server } = await listen();
  await new Promise(resolve => server.close(resolve));
  assert.deepEqual(await closeHttpServerGracefully(server), { forced: false });
});

test('空闲的 keep-alive 连接被立刻收掉，关闭无需等到宽限期', async () => {
  const { server, port } = await listen();
  const agents = await Promise.all([request(port), request(port), request(port)]);

  const startedAt = Date.now();
  const result = await closeHttpServerGracefully(server, { graceMs: 2_000 });
  const elapsedMs = Date.now() - startedAt;

  agents.forEach(agent => agent.destroy());
  assert.equal(result.forced, false);
  assert.ok(elapsedMs < 500, `空闲连接应立即关闭，实测 ${elapsedMs} ms`);
});

test('赖着不走的连接会在宽限期到点后被断开，关闭不再无限期悬着', async () => {
  // 这就是 v0.0.8 在 CI 上撞到的场景：渲染层的一条连接卡在请求里，
  // closeIdleConnections() 收不掉它，server.close() 于是一直不回调，
  // 最后被 Electron 那侧 5 秒的强杀兜底收场——关窗后进程赖着不走。
  let hangingResponse = null;
  const { server, port } = await listen((req, res) => {
    if (req.url === '/hang') { hangingResponse = res; return; }   // 永不响应
    res.end('ok');
  });

  const socket = net.connect(port, '127.0.0.1');
  await new Promise(resolve => socket.once('connect', resolve));
  socket.write('GET /hang HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n');
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.ok(hangingResponse, '请求应已到达服务端并处于在途状态');

  const startedAt = Date.now();
  const result = await closeHttpServerGracefully(server, { graceMs: 150 });
  const elapsedMs = Date.now() - startedAt;

  socket.destroy();
  assert.equal(result.forced, true);
  assert.ok(elapsedMs < 2_000, `宽限期到点必须强制断开，实测 ${elapsedMs} ms`);
});

test('默认宽限期远小于 Electron 那侧 5 秒的强杀兜底', () => {
  // 两个数必须留出量级差：宽限期一旦逼近 5 秒，兜底就成了常态路径。
  assert.ok(DEFAULT_GRACE_MS > 0);
  assert.ok(DEFAULT_GRACE_MS <= 1_000, `默认宽限期 ${DEFAULT_GRACE_MS} ms 过长`);
});

test('服务进程用的就是这套关闭逻辑，而不是自己再写一遍', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  assert.match(source, /require\('\.\/http-close'\)/);
  assert.match(source, /function closeHttpServer\(\) \{\s*\n\s*return closeHttpServerGracefully\(server\);/);
});
