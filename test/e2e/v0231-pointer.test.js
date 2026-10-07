'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchNativeElectron } = require('./native-electron.cjs');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'work/v0231/pointer');

async function fixture(t) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0231-pointer-'));
  fs.writeFileSync(path.join(profile, 'settings.json'), '{}');
  fs.writeFileSync(path.join(profile, 'ui-preferences.json'), JSON.stringify({
    version: 2, view: 'settings', theme: 'light', realtime: false, aquaEnabled: false,
    aquaWhale: false, aquaCritters: false, pointerEnabled: true
  }));
  fs.mkdirSync(output, { recursive: true });
  const apps = [];
  t.after(async () => {
    for (const app of apps) if (app.process().exitCode === null) await app.close();
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  async function launch() {
    const app = await launchNativeElectron(root, profile); apps.push(app);
    const page = await app.firstWindow();
    await page.waitForFunction(() => document.documentElement.dataset.pointerStyle != null);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1440, 920); win.show(); win.focus(); win.webContents.focus();
    });
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 8 });
      Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 8 });
      syncFxTier();
    });
    await page.waitForFunction(() => document.hasFocus() && document.documentElement.dataset.fxTier === 'full');
    return { app, page };
  }
  return { profile, launch };
}
async function capture(app, filename) {
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(path.join(output, filename), Buffer.from(png, 'base64'));
}
async function sweep(page) {
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  for (let i = 0; i < 18; i++) {
    await page.mouse.move(size.width * (.46 + i * .012), size.height * (.57 + .06 * Math.sin(i / 3)));
    await page.waitForTimeout(10);
  }
}
async function measureInput(page) {
  return page.evaluate(() => new Promise(resolve => {
    const deltas = []; let previous = 0, count = 0;
    function advance(now) {
      if (previous && count > 20) deltas.push(now - previous);
      previous = now;
      const px = innerWidth * (.55 + .22 * Math.sin(count / 9)), py = innerHeight * (.58 + .09 * Math.sin(count / 4.5));
      const target = document.elementFromPoint(px, py) || document.body;
      target.dispatchEvent(new PointerEvent('pointermove', { clientX: px, clientY: py, pointerType: 'mouse', bubbles: true }));
      if (++count < 100) requestAnimationFrame(advance);
      else { deltas.sort((a,b) => a-b); resolve({ p95: deltas[Math.floor(deltas.length * .95)], mean: deltas.reduce((a,b) => a+b, 0) / deltas.length, frames: deltas.length, x: px, y: py }); }
    }
    requestAnimationFrame(advance);
  }));
}

test('v0231 pointer settings switch styles live, preserve independent sizes and colors across restart and keep dialogs usable', { timeout: 150000 }, async t => {
  const env = await fixture(t);
  const { app, page } = await env.launch();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const style = page.locator('#setPointerStyle'), number = page.locator('#setPointerSizeNumber');
  await style.scrollIntoViewIfNeeded();
  assert.equal(await style.inputValue(), 'glow');
  assert.equal(await number.inputValue(), '320');
  const sizes = { glow: 587, comet: 420, stars: 11, ring: 64 };
  for (const [mode, value] of Object.entries(sizes)) {
    await style.selectOption(mode);
    await number.fill(String(value)); await number.press('Tab');
    await page.waitForFunction(({ mode, value }) => document.documentElement.dataset.pointerStyle === mode
      && document.documentElement.dataset.pointerEffectSize === String(value), { mode, value });
    assert.equal(await page.locator('#setPointerSize').inputValue(), String(value));
    await page.locator('#setPointerColorHex').fill('#06b6d4'); await page.locator('#setPointerColorHex').press('Tab');
    assert.equal(await page.locator('html').getAttribute('data-pointer-color'), '#06b6d4');
    await sweep(page);
    if (mode !== 'glow') {
      assert.equal(await page.locator('.pointer-effects').count(), 1);
      assert.equal(await page.locator('.surface-glow').count(), 0);
      const actual = await page.evaluate(() => interactionMotion.getPointerSnapshot());
      assert.equal(actual.style, mode); assert.ok(actual.frames > 0);
      assert.ok(actual.particles <= 96 && actual.points <= 96);
    }
    await capture(app, `${mode}-light.png`);
  }
  for (const mode of Object.keys(sizes)) { await style.selectOption(mode); assert.equal(await number.inputValue(), String(sizes[mode])); }
  await page.locator('#setPointerOpacity').evaluate(node => { node.value = '55'; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('#btnTheme').click();
  await style.scrollIntoViewIfNeeded();
  for (const mode of ['comet', 'stars', 'ring']) {
    await style.selectOption(mode); await sweep(page); await capture(app, `${mode}-dark.png`);
  }
  await page.locator('#btnPalette').click();
  const input = page.locator('#paletteInput');
  await input.fill('设置'); await input.hover();
  assert.equal(await input.evaluate(node => document.activeElement === node), true, 'decorative popover must retain dialog focus');
  assert.equal(await page.locator('.pointer-effects').evaluate(node => node.matches(':popover-open')), true);
  assert.equal(await input.evaluate(node => {
    const rect = node.getBoundingClientRect(); return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === node;
  }), true, 'effect must not intercept native input');
  await page.keyboard.press('Escape');
  await input.waitFor({ state: 'hidden', timeout: 2500 });
  assert.equal(await page.locator('#paletteInput').isVisible(), false);
  await style.scrollIntoViewIfNeeded();
  for (const scale of ['sm', 'md', 'lg', 'xl']) {
    await page.locator(`#settingsDisplay [data-text-scale="${scale}"]`).click();
    await style.scrollIntoViewIfNeeded();
    const fit = await page.locator('.pointer-lab').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
    assert.ok(fit.scroll <= fit.width + 1, `${scale}: settings overflow`);
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(800, 720));
  await style.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await capture(app, 'settings-narrow.png');
  await page.waitForTimeout(300);
  const saved = JSON.parse(fs.readFileSync(path.join(env.profile, 'ui-preferences.json')));
  assert.equal(saved.pointerStyle, 'ring'); assert.equal(saved.pointerSize, 587); assert.equal(saved.pointerCometSize, 420);
  assert.equal(saved.pointerStarsSize, 11); assert.equal(saved.pointerRingSize, 64);
  assert.equal(saved.pointerColor, '#06b6d4'); assert.equal(saved.pointerOpacity, 55);
  await app.close();
  const reopened = await env.launch();
  assert.equal(await reopened.page.locator('#setPointerStyle').inputValue(), 'ring');
  assert.equal(await reopened.page.locator('#setPointerSizeNumber').inputValue(), '64');
  assert.equal(await reopened.page.locator('#setPointerColorHex').inputValue(), '#06b6d4');
  assert.equal(await reopened.page.locator('#setPointerOpacity').inputValue(), '55');
  assert.deepEqual(errors, []);
});

test('v0231 real pointer animation remains bounded, settles when idle and stops on reduction, blur and hidden windows', { timeout: 150000 }, async t => {
  const env = await fixture(t); const { app, page } = await env.launch();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const style = page.locator('#setPointerStyle'); await style.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    window.__pointerTrace = [];
    for (const type of ['pointerover', 'pointermove', 'pointerout']) document.addEventListener(type, event => {
      window.__pointerTrace.push({ type, trusted: event.isTrusted, x: event.clientX, y: event.clientY,
        time: performance.now(), target: event.target.id || event.target.className });
      if (window.__pointerTrace.length > 24) window.__pointerTrace.shift();
    }, { passive: true });
  });
  const records = [];
  const toggle = page.locator('label.desktop-switch').filter({ has: page.locator('#setPointerEnabled') });
  for (const tier of ['full', 'lite']) for (const mode of ['comet', 'stars', 'ring']) {
    await style.selectOption(mode);
    await toggle.click();
    assert.equal(await page.locator('#setPointerEnabled').isChecked(), false);
    await style.scrollIntoViewIfNeeded();
    await page.evaluate(value => { document.documentElement.dataset.fxTier = value; }, tier);
    await sweep(page);
    const baseline = await measureInput(page);
    assert.equal((await page.evaluate(() => interactionMotion.getPointerSnapshot())).framePending, false);
    await toggle.click();
    assert.equal(await page.locator('#setPointerEnabled').isChecked(), true);
    await style.scrollIntoViewIfNeeded();
    await page.evaluate(value => { document.documentElement.dataset.fxTier = value; }, tier);
    await sweep(page);
    const before = await page.evaluate(() => interactionMotion.getPointerSnapshot());
    const timing = await measureInput(page);
    const after = await page.evaluate(() => interactionMotion.getPointerSnapshot());
    const cost = (after.totalMs - before.totalMs) / Math.max(1, after.frames - before.frames);
    const record = { tier, mode, baseline, ...timing, drawMeanMs: cost, maxDrawMs: after.maxMs };
    records.push(record);
    fs.writeFileSync(path.join(output, 'frame-measurements.json'), JSON.stringify(records, null, 2));
    console.log('v0231 pointer timing: ' + JSON.stringify(record));
    assert.ok(after.points <= 96 && after.particles <= (tier === 'lite' ? 36 : 96));
    assert.ok(cost < 2, `${tier}/${mode}: drawing consumed ${cost.toFixed(3)}ms per frame`);
    // Compare identical input with effects off/on. A slow native display clock
    // cannot promise 40+ Hz even with no effects; it must still show bounded
    // incremental frame cost. Keep the absolute limits on normal display clocks.
    assert.ok(timing.mean <= baseline.mean + Math.max(2, baseline.mean * .1), `${tier}/${mode}: mean regression ${JSON.stringify(record)}`);
    assert.ok(timing.p95 <= baseline.p95 + Math.max(4, baseline.mean * .25), `${tier}/${mode}: p95 regression ${JSON.stringify(record)}`);
    if (baseline.mean <= 20) assert.ok(timing.p95 < 35 && timing.mean < 25, `${tier}/${mode}: ${JSON.stringify(record)}`);
    // The timed input is synthetic; reconcile the native cursor before testing
    // actual idle behavior so a later native hover cannot supply stale coordinates.
    await page.mouse.move(timing.x, timing.y);
    await page.waitForTimeout(1100);
    const idle = await page.evaluate(() => interactionMotion.getPointerSnapshot());
    const idleTrace = await page.evaluate(() => ({ now: performance.now(), events: window.__pointerTrace }));
    fs.writeFileSync(path.join(output, `idle-${tier}-${mode}.json`), JSON.stringify({ idle, ...idleTrace }, null, 2));
    assert.equal(idle.framePending, false, `${tier}/${mode}: idle RAF must stop ${idle.framePending ? JSON.stringify({ idle, ...idleTrace }) : ''}`);
    if (mode !== 'ring') assert.equal(idle.points + idle.particles, 0);
    await page.evaluate(() => {
      // A target can change under a stationary cursor (dialog or DOM changes).
      // Pointer-over alone must not be treated as new movement or wake drawing.
      document.body.dispatchEvent(new PointerEvent('pointerover', { clientX: innerWidth / 2,
        clientY: innerHeight / 2, pointerType: 'mouse', bubbles: true }));
    });
    assert.equal((await page.evaluate(() => interactionMotion.getPointerSnapshot())).framePending, false,
      `${tier}/${mode}: target changes without pointer movement must not wake drawing`);
  }
  await page.evaluate(() => { document.documentElement.dataset.fxTier = 'full'; });
  await style.selectOption('ring');
  await page.mouse.move(820, 450); await page.waitForTimeout(700);
  const stationary = await page.evaluate(() => interactionMotion.getPointerSnapshot());
  assert.ok(Math.abs(stationary.x - 820) < .1 && Math.abs(stationary.y - 450) < .1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.documentElement.dataset.fxTier === 'static');
  assert.equal((await page.evaluate(() => interactionMotion.getPointerSnapshot())).framePending, false);
  assert.equal(await page.locator('.pointer-effects').evaluate(node => node.hidden), true);
  await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'active' });
  await sweep(page);
  assert.equal((await page.evaluate(() => interactionMotion.getPointerSnapshot())).framePending, false);
  await page.emulateMedia({ forcedColors: 'none' });
  await sweep(page);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setAlwaysOnTop(false);
    const focusTarget = new BrowserWindow({ width: 180, height: 120, show: true, skipTaskbar: true });
    focusTarget.setAlwaysOnTop(true); focusTarget.focus();
  });
  await page.waitForFunction(() => !document.hasFocus());
  assert.equal((await page.evaluate(() => interactionMotion.getPointerSnapshot())).framePending, false);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('http://127.0.0.1'));
    for (const other of BrowserWindow.getAllWindows()) if (other !== win) other.destroy();
    win.setAlwaysOnTop(true); win.focus(); win.webContents.focus();
  });
  await page.waitForFunction(() => document.hasFocus()); await sweep(page);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  await page.waitForFunction(() => document.hidden);
  assert.equal((await page.evaluate(() => interactionMotion.getPointerSnapshot())).framePending, false);
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus(); win.webContents.focus(); });
  await page.waitForFunction(() => document.hasFocus());
  await style.scrollIntoViewIfNeeded();
  await page.locator('label.desktop-switch').filter({ has: page.locator('#setPointerEnabled') }).click();
  assert.equal(await page.locator('#setPointerEnabled').isChecked(), false);
  await sweep(page);
  assert.equal((await page.evaluate(() => interactionMotion.getPointerSnapshot())).framePending, false);
  await page.locator('#btnPointerReset').click();
  assert.equal(await style.inputValue(), 'glow');
  assert.equal(await page.locator('#setPointerSizeNumber').inputValue(), '320');
  assert.equal(await page.locator('#setPointerColorHex').inputValue(), '#8b5cf6');
  fs.writeFileSync(path.join(output, 'frame-measurements.json'), JSON.stringify(records, null, 2));
  assert.deepEqual(errors, []);
});
