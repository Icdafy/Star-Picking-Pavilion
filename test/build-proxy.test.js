'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

test('Electron build downloader keeps its HTTP proxy bootstrap after the security override', { timeout: 15000 }, async t => {
  const requests = [];
  const proxy = http.createServer((req, res) => {
    requests.push(req.url);
    res.end('proxy fixture');
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { proxy.close(resolve); proxy.closeAllConnections(); }));
  const downloader = require.resolve('@electron/get', { paths: [path.dirname(require.resolve('app-builder-lib'))] });
  const script = `require(${JSON.stringify(downloader)}).initializeProxy();
    require('node:http').get('http://electron-download.fixture.invalid/ping', res => {
      let body=''; res.on('data', chunk => body+=chunk);
      res.on('end', () => { if (body!=='proxy fixture') process.exitCode=1; else process.stdout.write('proxy-ok'); });
    }).on('error', error => { console.error(error.message); process.exitCode=1; });`;
  const result = await promisify(execFile)(process.execPath, ['-e', script], {
    timeout: 10000,
    env: { ...process.env, GLOBAL_AGENT_HTTP_PROXY: `http://127.0.0.1:${proxy.address().port}`,
      GLOBAL_AGENT_HTTPS_PROXY: '', GLOBAL_AGENT_NO_PROXY: '', GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE: 'GLOBAL_AGENT_',
      GLOBAL_AGENT_FORCE_GLOBAL_AGENT: 'true' }
  });
  assert.equal(result.stdout, 'proxy-ok');
  assert.deepEqual(requests, ['http://electron-download.fixture.invalid/ping']);
});
