'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchNativeElectron } = require('./native-electron.cjs');
const root = path.resolve(__dirname, '../..');

test('v0241 static logo serves the original PNG in both themes while the header keeps its SVG', { timeout: 60000 }, async t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0241-logo-'));
  fs.writeFileSync(path.join(profile, 'ui-preferences.json'), JSON.stringify({
    version: 2, view: 'settings', theme: 'light', aquaEnabled: false, pointerEnabled: false
  }));
  const app = await launchNativeElectron(root, profile);
  t.after(async () => {
    await app.close();
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('[data-brand-logo] > svg');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('[data-view="settings"]').click();
  await page.locator('#settingsNav [data-settings-target="settingsUpdate"]').click();
  await page.waitForFunction(() => document.querySelector('#updateCenterCore img').complete
    && document.querySelector('#updateCenterCore img').naturalWidth > 0);
  const original = fs.readFileSync(path.join(root, 'renderer/logo.png'));
  const servedHash = await page.evaluate(async () => {
    const data = await (await fetch('/logo.png')).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)),
      value => value.toString(16).padStart(2, '0')).join('');
  });
  assert.equal(servedHash, crypto.createHash('sha256').update(original).digest('hex'));
  assert.equal(await page.locator('link[rel="icon"]').getAttribute('href'), '/logo.png');
  const screenshots = path.join(root, 'work/v0241/screenshots');
  fs.mkdirSync(screenshots, { recursive: true });
  for (const theme of ['light', 'dark']) {
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.locator('#btnTheme').click();
    const state = await page.locator('#updateCenterCore img').evaluate(img => ({
      src: img.getAttribute('src'), width: img.naturalWidth, height: img.naturalHeight,
      filter: getComputedStyle(img).filter, overflow: getComputedStyle(img.parentElement).overflow,
      tracks: document.querySelectorAll('[data-brand-logo] > svg animateTransform').length
    }));
    assert.equal(state.src, '/logo.png');
    assert.equal(state.width, original.readUInt32BE(16));
    assert.equal(state.height, original.readUInt32BE(20));
    assert.equal(state.filter, 'none', 'static artwork keeps the uploaded colors in both themes');
    assert.equal(state.overflow, 'visible', 'the rounded square artwork must not be clipped into a circle');
    assert.equal(state.tracks, 6, 'the header retains all six original animation tracks');
    await page.screenshot({ path: path.join(screenshots, `update-${theme}.png`) });
  }
  assert.deepEqual(errors, []);
});
