'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchNativeElectron } = require('./native-electron.cjs');
const root = path.resolve(__dirname, '../..');

test('desktop IPC rejects another native window before it reads or changes application state', { timeout: 60000 }, async t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0232-ipc-'));
  fs.writeFileSync(path.join(profile, 'ui-preferences.json'), JSON.stringify({ version: 2, theme: 'dark', aquaEnabled: false, pointerEnabled: false }));
  let app;
  t.after(async () => {
    await app?.close();
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  app = await launchNativeElectron(root, profile);
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  assert.equal(await page.evaluate(() => window.starPickingPavilion.preferences.theme), 'dark');
  const results = await app.evaluate(async ({ BrowserWindow }) => {
    const foreign = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } });
    try {
      await foreign.loadURL('about:blank');
      return await foreign.webContents.executeJavaScript(`(async () => {
        const ipc = require('electron').ipcRenderer;
        const results = [];
        for (const [channel, payload] of [
          ['preferences:update', { theme: 'light' }], ['storage:get'],
          ['desktop-settings:get'], ['daily-archive:get'], ['appearance-wallpaper:get'], ['update:check']
        ]) {
          try { await ipc.invoke(channel, payload); results.push({ channel, denied: false }); }
          catch { results.push({ channel, denied: true }); }
        }
        results.push({ channel: 'preferences:get', denied: ipc.sendSync('preferences:get') === null });
        results.push({ channel: 'app:get-version', denied: ipc.sendSync('app:get-version') === null });
        return results;
      })()`);
    } finally { foreign.destroy(); }
  });
  assert.ok(results.every(result => result.denied), JSON.stringify(results));
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'ui-preferences.json'), 'utf8')).theme, 'dark');
  const settings = await page.evaluate(() => window.starPickingPavilion.getDesktopSettings());
  assert.equal(typeof settings.closeToTray, 'boolean');
});
