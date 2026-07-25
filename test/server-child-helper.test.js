'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startServer } = require('./helpers/server-child');

// 这条守的是 2026-07-25 让 CI 连挂两次的那个坑：
// 清理钩子原本注册在「等待后端就绪」之后，于是就绪超时这条失败路径上根本
// 不会注册清理。后端子进程成为孤儿，它握着 IPC 通道与 stdio 管道，测试运行器
// 因此永远等不到自己退出——一条用例的超时失败被放大成整轮静默挂死，
// 直到 GitHub 把 job 按 timeout-minutes 砍掉（两次都白烧了 30 分钟）。
test('后端就绪超时时仍然注册清理，不会把子进程留成孤儿', async () => {
  const cleanups = [];
  const fakeContext = { after: hook => cleanups.push(hook) };

  await assert.rejects(
    // 真实后端要开库、跑迁移、同步种子信源，150ms 必然超时
    startServer(fakeContext, { readyTimeoutMs: 150 }),
    /server ready timeout/
  );

  assert.equal(cleanups.length, 1, '失败路径上也必须注册清理钩子');
  await cleanups[0]();          // 清理本身必须可独立执行且不抛
  await cleanups[0]();          // 重复执行也要安全（子进程已退出）
});

test('正常启动的后端可用，并在用例结束后被收回', async t => {
  const server = await startServer(t);
  assert.ok(Number.isInteger(server.port) && server.port > 0);
  assert.equal(server.child.exitCode, null, '就绪后子进程应当还活着');

  const res = await server.request({ pathname: '/index.html' });
  assert.equal(res.status, 200);
});
