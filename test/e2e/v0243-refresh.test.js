'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchNativeElectron } = require('./native-electron.cjs');
const root = path.resolve(__dirname, '../..');

test('v0243 real desktop: native refresh, four sampling profiles, live display changes and persisted choice', { timeout: 120000 }, async t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0243-refresh-'));
  fs.writeFileSync(path.join(profile, 'settings.json'), '{}');
  fs.writeFileSync(path.join(profile, 'ui-preferences.json'), JSON.stringify({ version: 2,
    view: 'settings', theme: 'light', aquaEnabled: false, pointerEnabled: false, fluidMode: 'full' }));
  let app;
  t.after(async () => {
    await app?.close();
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const errors = [];
  async function launch() {
    app = await launchNativeElectron(root, profile);
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForLoadState('load');
    // Animation assertions require the real foreground, non-reduced environment.
    // Keep the application's hardware-derived full/lite policy intact.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => document.documentElement.dataset.fxTier !== 'static');
    await page.locator('[data-view="settings"]').click();
    await page.locator('#settingsNav [data-settings-target="settingsAppearance"]').click();
    await page.locator('#setRefreshRate').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.documentElement.dataset.refreshRateSource !== 'default');
    return page;
  }
  let page = await launch();
  const physical = await app.evaluate(({ screen, BrowserWindow }) => {
    const display = screen.getDisplayMatching(BrowserWindow.getAllWindows()[0].getBounds());
    return { id: String(display.id), rate: display.displayFrequency };
  });
  const exposed = await page.evaluate(() => starPickingPavilion.getDisplayRefreshRate());
  const nativeAvailable = Number.isFinite(physical.rate) && physical.rate >= 24 && physical.rate <= 1000;
  assert.deepEqual(exposed, { displayId: physical.id, refreshRate: nativeAvailable ? physical.rate : null });
  assert.equal(await page.locator('#setRefreshRate').inputValue(), 'auto');
  assert.match(await page.locator('#refreshRateStatus').textContent(), nativeAvailable ? /系统显示器信息/ : /本机动效实测/);
  const evidence = path.join(root, 'work', 'v0243');
  fs.mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, 'refresh-settings-native.png') });
  fs.writeFileSync(path.join(evidence, 'native-display.json'), JSON.stringify({ physical, exposed }, null, 2));

  // A native display fixture exercises real main→preload→renderer IPC without
  // changing the workstation's actual display settings.
  await app.evaluate(({ screen }) => {
    const original = screen.getDisplayMatching.bind(screen);
    screen.getDisplayMatching = rect => ({ ...original(rect), id: 4243, displayFrequency: 144 });
    screen.emit('display-metrics-changed', {}, {}, ['bounds']);
  });
  await page.waitForFunction(() => document.documentElement.dataset.refreshRateDetected === '144');
  const durations = [];
  for (const hz of [60, 70, 120, 144]) {
    await page.locator('#setRefreshRate').selectOption(String(hz));
    await page.waitForFunction(rate => document.documentElement.dataset.refreshRate === String(rate), hz);
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.focus(); win.webContents.focus();
    });
    await page.waitForFunction(() => document.hasFocus() && !document.hidden);
    const sample = await page.evaluate(() => {
      const node = document.createElement('div');
      node.style.cssText = 'position:fixed;left:0;top:0;width:100px;height:40px';
      document.body.append(node);
      let result;
      const animate = node.animate.bind(node);
      node.animate = (frames, options) => { result = { samples: frames.length, duration: options.duration }; return animate(frames, options); };
      motion.retargetIndicator(node, { x: 50, y: 100, width: 100, height: 40 });
      motion.cancel(node); node.remove();
      return { ...result, tier: document.documentElement.dataset.fxTier,
        focused: document.hasFocus(), hidden: document.hidden,
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches };
    });
    const expectedDuration = (sample.tier === 'lite' ? 180 : 300) * 1.382;
    assert.equal(sample.focused, true, JSON.stringify(sample));
    assert.equal(sample.reduced, false, JSON.stringify(sample));
    assert.equal(sample.samples, Math.max(10, Math.min(48, Math.round(expectedDuration * hz / 1000))) + 1, JSON.stringify(sample));
    assert.ok(Math.abs(sample.duration - expectedDuration) < .01, JSON.stringify(sample));
    durations.push({ tier: sample.tier, duration: sample.duration });
    assert.match(await page.locator('#refreshRateStatus').textContent(), new RegExp(`手动 ${hz} Hz`));
  }
  for (const tier of ['full', 'lite']) {
    const values = durations.filter(value => value.tier === tier).map(value => value.duration);
    assert.ok(values.every(duration => duration === values[0]), `${tier} duration stays independent of refresh rate`);
  }
  await page.waitForFunction(async () => (await starPickingPavilion.updatePreferences({})).refreshRate === '144');
  const saved = JSON.parse(fs.readFileSync(path.join(profile, 'ui-preferences.json'), 'utf8'));
  assert.equal(saved.refreshRate, '144');
  assert.equal(Object.hasOwn(saved, 'refreshRateDetected'), false);

  await page.locator('#setRefreshRate').selectOption('auto');
  for (const rate of [70, 60, 120, 144]) {
    await app.evaluate(({ screen }, rate) => {
      const previous = screen.getDisplayMatching.bind(screen);
      screen.getDisplayMatching = rect => ({ ...previous(rect), displayFrequency: rate });
      screen.emit('display-metrics-changed', {}, {}, ['bounds']);
    }, rate);
    await page.waitForFunction(rate => document.documentElement.dataset.refreshRate === String(rate), rate);
    assert.match(await page.locator('#refreshRateStatus').textContent(), new RegExp(`检测到 ${rate} Hz`));
  }
  await page.locator('#btnRefreshRateDetect').click();
  await page.waitForFunction(() => !document.getElementById('btnRefreshRateDetect').disabled);
  await page.locator('#setRefreshRate').selectOption('70');
  await page.waitForFunction(async () => (await starPickingPavilion.updatePreferences({})).refreshRate === '70');
  await app.close(); app = null;
  page = await launch();
  assert.equal(await page.locator('#setRefreshRate').inputValue(), '70');
  await page.waitForFunction(() => document.documentElement.dataset.refreshRateMode === '70');
  assert.equal(await page.evaluate(() => Number(document.documentElement.dataset.refreshRate) <= Number(document.documentElement.dataset.refreshRateDetected)), true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.documentElement.dataset.fxTier === 'static');
  assert.deepEqual(errors, []);
});
