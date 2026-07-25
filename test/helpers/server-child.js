'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.join(__dirname, '..', '..');

function request({ port, method = 'GET', pathname = '/', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

async function startServer(t, {
  token = 'test-launch-token',
  nonce = 'test-ready-nonce',
  readyTimeoutMs = 30_000
} = {}) {
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-server-'));
  const child = spawn(process.execPath, [path.join(projectRoot, 'server', 'index.js')], {
    cwd: projectRoot,
    env: {
      ...process.env,
      STAR_PICKING_PAVILION_DATA_DIR: dataDir,
      STAR_PICKING_PAVILION_PORT: '0',
      STAR_PICKING_PAVILION_API_TOKEN: token,
      STAR_PICKING_PAVILION_SERVER_NONCE: nonce,
      STAR_PICKING_PAVILION_NO_SCHEDULER: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });

  // 清理必须在「等待就绪」之前注册。就绪超时会让 startServer 直接抛出，
  // 若把 t.after 放在 await 之后，那条失败路径上根本不会注册清理：后端子进程
  // 成为孤儿，而它握着 IPC 通道与 stdio 管道，测试运行器永远等不到自己退出。
  // 结果就是「一条用例超时失败」被放大成「整轮静默挂死」——CI 上表现为跑到一半
  // 再无输出，直到 job 撞上 timeout-minutes 被砍。
  // 用一个标志位记录退出，而不是查 child.exitCode：被信号杀掉的进程 exitCode 恒为
  // null（信号记在 signalCode 上），照着 exitCode 判断会去 await 一个已经发生过的
  // 'exit' 事件，然后永远等下去。
  let exited = child.exitCode !== null || child.signalCode !== null;
  child.once('exit', () => { exited = true; });

  t.after(async () => {
    if (!exited) {
      child.kill();
      await new Promise(resolve => {
        if (exited) return resolve();
        child.once('exit', resolve);
      });
    }
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  });

  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });

  const ready = await new Promise((resolve, reject) => {
    // 后端启动要开库、跑迁移、同步一百多个种子信源；CI 上还叠着 4 路测试并发，
    // 10 秒在双核 runner 上会被正常启动摸到。放宽到 30 秒，只用于兜住真正的卡死。
    const timeout = setTimeout(() => reject(new Error(`server ready timeout\n${stderr}`)), readyTimeoutMs);
    let stdout = '';
    child.stdout.on('data', chunk => {
      stdout += chunk;
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.startsWith('[server:ready]')) continue;
        clearTimeout(timeout);
        resolve(JSON.parse(line.slice('[server:ready]'.length)));
        return;
      }
    });
    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`server exited before ready (${code})\n${stderr}`));
    });
  });

  assertReadyMessage(ready, nonce);
  return { ...ready, token, dataDir, child, request: options => request({ port: ready.port, ...options }) };
}

function assertReadyMessage(message, nonce) {
  if (message?.type !== 'server:ready' || message.nonce !== nonce || !Number.isInteger(message.port) || message.port <= 0) {
    throw new Error(`invalid server ready message: ${JSON.stringify(message)}`);
  }
}

module.exports = { request, startServer };
