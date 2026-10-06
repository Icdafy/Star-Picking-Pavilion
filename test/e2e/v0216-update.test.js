'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchNativeElectron } = require('./native-electron.cjs');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'work/v0216/update-button');

test('workspace update button retains its position, real IPC, progress and motion policies', { timeout: 100_000 }, async t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0216-update-'));
  fs.writeFileSync(path.join(profile, 'settings.json'), '{}');
  fs.writeFileSync(path.join(profile, 'ui-preferences.json'), JSON.stringify({ version: 2, view: 'featured', realtime: false, aquaEnabled: false }));
  fs.mkdirSync(output, { recursive: true });
  const app = await launchNativeElectron(root, profile);
  t.after(async () => { await app.close(); await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const page = await app.firstWindow();
  await page.waitForSelector('#updatePill:not([hidden])');
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, ipcMain }) => {
    const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus(); win.webContents.focus();
    globalThis.__updateInstalls = 0;
    ipcMain.on('update:install', () => { globalThis.__updateInstalls++; });
  });
  const status = async payload => {
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('update:status', value), payload);
    await page.waitForFunction(value => document.getElementById('updatePill').dataset.state === value, payload.status);
  };
  const geometry = [];
  for (const [width, height] of [[800, 600], [1080, 680], [1440, 920], [1920, 1080]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
    await page.waitForFunction(size => innerWidth === size[0] && innerHeight === size[1], [width, height]);
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#btnTheme').click();
      for (const scale of ['sm', 'md', 'lg', 'xl']) {
        await page.evaluate(value => { document.documentElement.dataset.uiScale = value; window.dispatchEvent(new Event('resize')); document.getElementById('appViewport').scrollTop = 0; }, scale);
        await status({ status: 'downloading', version: '0.2.17', percent: 42 });
        const layout = await page.evaluate(() => {
          const button = document.getElementById('updatePill'), footer = button.closest('.rail-footer');
          const b = button.getBoundingClientRect(), f = footer.getBoundingClientRect(), c = footer.querySelector('.rail-footer-copy').getBoundingClientRect();
          return { width: b.width, height: b.height, left: b.left, right: b.right, top: b.top, bottom: b.bottom,
            inFooter: b.left >= f.left - 1 && b.right <= f.right + 1, afterLabel: b.left >= c.right,
            labelOneLine: footer.querySelector('strong').getBoundingClientRect().height < parseFloat(getComputedStyle(footer.querySelector('strong')).fontSize) * 2,
            headerContainsButton: document.querySelector('.tower').contains(button),
            overflow: document.getElementById('appViewport').scrollWidth > document.getElementById('appViewport').clientWidth + 1 };
        });
        assert.ok(layout.inFooter && layout.afterLabel && layout.labelOneLine, `${width}/${theme}/${scale}: footer layout ${JSON.stringify(layout)}`);
        assert.equal(layout.headerContainsButton, false); assert.equal(layout.overflow, false);
        assert.ok(layout.left >= 0 && layout.right <= width + 1 && layout.top >= 0 && layout.bottom <= height + 1, `${width}/${height}/${theme}/${scale}: visible button ${JSON.stringify(layout)}`);
        assert.ok(Math.abs(layout.width - layout.height) < 1, 'circular button');
        assert.equal(await page.locator('#updateProgress').getAttribute('aria-valuenow'), '42');
        assert.equal(await page.locator('[data-update-arc]').getAttribute('stroke-dashoffset'), '58');
        assert.equal(await page.locator('[data-update-value]').textContent(), '42%');
        if (scale === 'md') await page.screenshot({ path: path.join(output, `progress-${width}-${theme}.png`) });
        geometry.push({ width, height, theme, scale, ...layout });
      }
    }
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 920));
  await page.evaluate(() => { document.documentElement.dataset.uiScale = 'md'; });
  await status({ status: 'idle' });
  await page.locator('#updatePill').focus(); await page.keyboard.press('Enter');
  // Real development IPC rejects unavailable updates without making a network call.
  await page.waitForFunction(() => document.getElementById('updatePill').dataset.state === 'error');
  assert.match(await page.locator('#updatePill').getAttribute('title'), /重试/);
  const retained = await page.locator('#updatePill').evaluate(node => { globalThis.__updateButtonNode = node; globalThis.__updateArcNode = node.querySelector('.update-arc'); return true; });
  assert.equal(retained, true);
  for (const payload of [{ status: 'checking' }, { status: 'current', version: '0.2.16' }, { status: 'available', version: '0.2.17' },
    { status: 'downloading', percent: 0 }, { status: 'downloading', percent: 55 }, { status: 'downloading', percent: 100 },
    { status: 'downloaded', version: '0.2.17' }, { status: 'error', message: '网络测试错误' }]) {
    await status(payload);
    await page.screenshot({ path: path.join(output, `${payload.status}-${payload.percent ?? ''}.png`) });
    assert.equal(await page.locator('#updatePill').evaluate(node => node === globalThis.__updateButtonNode && node.querySelector('.update-arc') === globalThis.__updateArcNode), true);
  }
  // Exercise motion policies with deterministic device capabilities. The app's
  // own MediaQueryList may recalculate the tier after emulateMedia returns.
  // Changing capabilities and calling its policy keeps late notifications valid.
  const capabilities = async (cores, memory) => page.evaluate(values => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: values[0] });
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: values[1] });
    syncFxTier();
  }, [cores, memory]);
  await capabilities(8, 8);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => {
    document.documentElement.getBoundingClientRect();
    return !reducedMotionQuery.matches && document.documentElement.dataset.fxTier === 'full';
  });
  await page.evaluate(() => document.body.classList.remove('is-idle'));
  await status({ status: 'checking' });
  assert.equal(await page.locator('.update-ring').evaluate(node => getComputedStyle(node).animationName), 'spin');
  await page.evaluate(() => document.body.classList.add('is-idle'));
  assert.equal(await page.locator('.update-ring').evaluate(node => getComputedStyle(node).animationPlayState), 'paused');
  await page.evaluate(() => document.body.classList.remove('is-idle'));
  for (const device of [[4, 8], [8, 4]]) {
    await capabilities(...device);
    assert.equal(await page.locator('html').getAttribute('data-fx-tier'), 'lite');
    assert.equal(await page.locator('.update-ring').evaluate(node => getComputedStyle(node).animationName), 'none');
  }
  await capabilities(8, 8);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => {
    document.documentElement.getBoundingClientRect();
    return reducedMotionQuery.matches && document.documentElement.dataset.fxTier === 'static';
  });
  assert.equal(await page.locator('.update-ring').evaluate(node => getComputedStyle(node).animationName), 'none');
  assert.equal(await page.locator('.update-arc').evaluate(node => getComputedStyle(node).transitionDuration), '0s');
  await page.emulateMedia({ forcedColors: 'active' });
  const forced = await page.locator('.update-arc').evaluate(node => getComputedStyle(node).stroke);
  assert.notEqual(forced, 'none'); assert.notEqual(forced, 'rgba(0, 0, 0, 0)');
  await page.emulateMedia({ forcedColors: 'none' });
  await status({ status: 'downloaded', version: '0.2.17' });
  await page.locator('#updatePill').focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('updatePill').dataset.state === 'installing');
  await page.keyboard.press('Enter');
  assert.equal(await app.evaluate(() => globalThis.__updateInstalls), 1);
  assert.equal(await page.locator('#updatePill').isDisabled(), true);
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'geometry.json'), JSON.stringify(geometry, null, 2));
});
