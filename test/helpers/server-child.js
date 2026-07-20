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

async function startServer(t, { token = 'test-launch-token', nonce = 'test-ready-nonce' } = {}) {
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
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });

  const ready = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`server ready timeout\n${stderr}`)), 10_000);
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

  t.after(async () => {
    if (child.exitCode == null) child.kill();
    if (child.exitCode == null) await new Promise(resolve => child.once('exit', resolve));
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  });

  assertReadyMessage(ready, nonce);
  return { ...ready, token, request: options => request({ port: ready.port, ...options }) };
}

function assertReadyMessage(message, nonce) {
  if (message?.type !== 'server:ready' || message.nonce !== nonce || !Number.isInteger(message.port) || message.port <= 0) {
    throw new Error(`invalid server ready message: ${JSON.stringify(message)}`);
  }
}

module.exports = { request, startServer };
