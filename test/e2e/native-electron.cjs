'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

// Use the real Electron entry point, backend, preload and renderer. Main-process
// IPC provides the same native evaluate interface as the other desktop tests.
// No startup retry or application/API interception hides a failed launch.
async function launchNativeElectron(root, profile) {
  const port = await new Promise(resolve => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const value = server.address().port;
      server.close(() => resolve(value));
    });
  });
  const wrapper = path.join(profile, 'native-launch.cjs');
  fs.writeFileSync(wrapper, `const electron=require('electron');
    process.on('uncaughtException',error=>{console.error(error);electron.app.exit(1)});
    process.on('message',async message=>{
      try { process.send({id:message.id,result:await eval('('+message.expression+')')(electron,message.arg)}); }
      catch(error) { process.send({id:message.id,error:error.stack||String(error)}); }
    });
    require(${JSON.stringify(path.join(root, 'electron/main.js'))});`);
  const child = spawn(require('electron'), [wrapper, '--hidden',
    `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
    cwd: root,
    env: { ...process.env, STAR_PICKING_PAVILION_TEST_DATA_DIR: profile,
      STAR_PICKING_PAVILION_NO_SCHEDULER: '1', STAR_PICKING_PAVILION_DISABLE_AUTO_UPDATE: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let output = '', sequence = 0, browser, spawnError;
  const pending = new Map();
  child.stdout.on('data', data => output += data);
  child.stderr.on('data', data => output += data);
  child.on('error', error => { spawnError = error; });
  child.on('message', message => {
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id); clearTimeout(call.timer);
    message.error ? call.reject(new Error(message.error)) : call.resolve(message.result);
  });
  const evaluate = (fn, arg) => new Promise((resolve, reject) => {
    if (!child.connected) return reject(new Error('Native process disconnected: ' + output));
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id); reject(new Error('Native IPC timeout: ' + output));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    child.send({ id, expression: fn.toString(), arg });
  });
  async function close() {
    if (browser) await browser.close().catch(() => {});
    if (child.exitCode === null && child.connected) {
      await evaluate(({ app }) => { setTimeout(() => app.quit(), 30); return true; }).catch(() => {});
    }
    if (child.exitCode === null) await new Promise(resolve => {
      const timer = setTimeout(() => { if (child.exitCode === null) child.kill(); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    fs.writeFileSync(path.join(profile, 'native-launch.log'), output);
  }
  try {
    const started = Date.now();
    while (true) {
      if (spawnError || child.exitCode !== null || Date.now() - started > 20000) {
        throw new Error(`Native launch failed (${spawnError?.message || child.exitCode}): ${output}`);
      }
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.waitForEvent('page', { timeout: 20000 });
    return { evaluate, firstWindow: async () => page, close, process: () => child };
  } catch (error) {
    await close();
    error.message += '\nNative output: ' + output;
    throw error;
  }
}

module.exports = { launchNativeElectron };
