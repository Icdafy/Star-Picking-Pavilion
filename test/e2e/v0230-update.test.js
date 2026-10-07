'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchNativeElectron } = require('./native-electron.cjs');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'work/v0230/update-button');

test('v0.2.30 update motion persists outside hover and its ring always matches live progress', { timeout: 120000 }, async t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0230-update-'));
  fs.writeFileSync(path.join(profile, 'settings.json'), '{}');
  fs.writeFileSync(path.join(profile, 'ui-preferences.json'), JSON.stringify({
    version: 2, view: 'featured', theme: 'light', realtime: false, aquaEnabled: false, pointerEnabled: false
  }));
  fs.mkdirSync(output, { recursive: true });
  const app = await launchNativeElectron(root, profile);
  t.after(async () => {
    await app.close();
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => document.getElementById('updatePill')?.dataset.state === 'idle');
  const button = page.locator('#updatePill');
  assert.equal(await button.isVisible(), false);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 8 });
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 8 });
    syncFxTier();
  });
  await page.waitForFunction(() => document.documentElement.dataset.fxTier === 'full' && !document.body.classList.contains('is-idle'));
  const status = async payload => {
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('update:status', value), payload);
    await page.waitForFunction(value => {
      const pill = document.getElementById('updatePill');
      return pill.dataset.state === value.status && (value.percent == null
        || pill.querySelector('[data-update-value]').textContent === `${Math.round(Math.max(0, Math.min(100, value.percent)))}%`);
    }, payload);
  };
  const settled = async amount => page.waitForFunction(value => {
    const arc = document.querySelector('[data-update-arc]');
    return Math.abs(parseFloat(getComputedStyle(arc).strokeDashoffset) - (100 - value)) < .01;
  }, amount);
  const pose = () => {
    const pill = document.getElementById('updatePill'), arc = pill.querySelector('[data-update-arc]');
    const arrows = pill.querySelector('[data-update-icon]');
    const ring = getComputedStyle(arc), icon = getComputedStyle(arrows);
    return { ring: { offset: parseFloat(ring.strokeDashoffset), opacity: ring.opacity, transform: ring.transform, animation: ring.animationName },
      arrows: { opacity: icon.opacity, transform: icon.transform, animation: icon.animationName },
      details: getComputedStyle(pill.querySelector('.update-details')).opacity,
      text: pill.querySelector('[data-update-value]').textContent,
      progress: document.getElementById('updateProgress').getAttribute('aria-valuenow'), bounds: pill.getBoundingClientRect().toJSON() };
  };
  const outside = async () => {
    await button.evaluate(node => node.blur());
    await page.mouse.move(1, 1);
  };
  const capture = async (name, details) => {
    // CDP screenshots can change viewport metrics and lose native hover. Capture
    // the existing Electron surface without scrolling or emulating a viewport.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const clip = await button.boundingBox();
    assert.equal((await page.evaluate(pose)).details, details);
    const png = await app.evaluate(async ({ BrowserWindow }, bounds) => {
      const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage({
        x: Math.floor(bounds.x), y: Math.floor(bounds.y),
        width: Math.ceil(bounds.width + bounds.x % 1), height: Math.ceil(bounds.height + bounds.y % 1)
      });
      return image.toPNG().toString('base64');
    }, clip);
    fs.writeFileSync(path.join(output, name), Buffer.from(png, 'base64'));
    assert.equal((await page.evaluate(pose)).details, details, 'capturing evidence must retain hover state');
  };
  await status({ status: 'available', version: '0.2.31' });
  await outside();
  assert.equal(await button.isVisible(), true);
  assert.equal((await page.evaluate(pose)).ring.animation, 'update-ring-spin');
  assert.equal((await page.evaluate(pose)).arrows.animation, 'update-arrows-spin');
  const results = [];
  for (const width of [800, 1440]) {
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].setContentSize(value, 920), width);
    await page.waitForFunction(value => innerWidth === value, width);
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#btnTheme').click();
      for (const scale of ['sm', 'md', 'lg', 'xl']) {
        await page.evaluate(value => {
          document.documentElement.dataset.uiScale = value;
          window.dispatchEvent(new Event('resize'));
          document.getElementById('appViewport').scrollTop = 0;
        }, scale);
        await outside();
        await status({ status: 'downloading', version: '0.2.31', percent: 37 });
        await settled(37);
        const normal = await page.evaluate(pose);
        assert.equal(normal.ring.opacity, '1');
        assert.equal(normal.ring.offset, 63);
        assert.equal(normal.ring.animation, 'none', 'known progress must never simulate a rotating download');
        assert.equal(normal.arrows.opacity, '1');
        assert.equal(normal.arrows.animation, 'update-arrows-spin');
        assert.equal(normal.details, '0');
        assert.equal(normal.progress, '37');
        assert.ok(normal.bounds.left >= 0 && normal.bounds.right <= width + 1);
        await page.waitForFunction(previous => getComputedStyle(document.querySelector('[data-update-icon]')).transform !== previous, normal.arrows.transform);
        await button.evaluate(node => {
          globalThis.__updateMotion = node.querySelector('[data-update-icon]').getAnimations()[0];
          globalThis.__updateMotionTime = globalThis.__updateMotion.currentTime;
        });
        if (scale === 'md') await capture(`${width}-${theme}-moving.png`, '0');
        await button.hover();
        const hovered = await page.evaluate(pose);
        assert.equal(hovered.details, '1');
        assert.equal(hovered.text, '37%');
        assert.equal(hovered.arrows.opacity, '0');
        assert.deepEqual(hovered.ring, normal.ring, 'hover only replaces the center, not the progress ring');
        assert.deepEqual(hovered.bounds, normal.bounds, 'hit target stays fixed');
        assert.equal(await button.evaluate(node => node.querySelector('[data-update-icon]').getAnimations()[0] === globalThis.__updateMotion), true);
        await status({ status: 'downloading', percent: 68.8 });
        await settled(69);
        const updated = await page.evaluate(pose);
        assert.equal(updated.text, '69%');
        assert.equal(updated.progress, '69');
        assert.equal(updated.ring.offset, 31);
        assert.equal(updated.ring.opacity, '1');
        assert.equal(updated.details, '1');
        if (scale === 'md') await capture(`${width}-${theme}-percent.png`, '1');
        await outside();
        const returned = await page.evaluate(pose);
        assert.equal(returned.details, '0');
        assert.equal(returned.arrows.opacity, '1');
        assert.deepEqual(returned.ring, updated.ring, 'leaving hover keeps the current ring');
        assert.equal(await button.evaluate(node => {
          const animation = node.querySelector('[data-update-icon]').getAnimations()[0];
          return animation === globalThis.__updateMotion && animation.currentTime > globalThis.__updateMotionTime;
        }), true, 'the same inner animation continues across hover and progress IPC');
        results.push({ width, theme, scale, normal, hovered, updated, returned });
      }
    }
  }
  for (const [percent, expected] of [[-8, 0], [0, 0], [45.8, 46], [100, 100], [120, 100]]) {
    await status({ status: 'downloading', percent });
    await settled(expected);
    await button.hover();
    const measured = await page.evaluate(pose);
    assert.equal(measured.ring.offset, 100 - expected);
    assert.equal(measured.text, `${expected}%`);
    assert.equal(measured.progress, String(expected));
  }
  await status({ status: 'downloading' });
  const unknown = await page.evaluate(pose);
  assert.equal(unknown.ring.opacity, '1');
  assert.equal(unknown.ring.animation, 'update-ring-spin');
  assert.equal(unknown.details, '0', 'unknown progress must not present a percentage');
  assert.equal(unknown.progress, null);
  assert.equal(unknown.arrows.opacity, '1');
  await button.evaluate(node => { globalThis.__updateRingMotion = node.querySelector('[data-update-arc]').getAnimations().find(a => a.animationName === 'update-ring-spin'); });
  await outside();
  await page.waitForFunction(previous => getComputedStyle(document.querySelector('[data-update-arc]')).transform !== previous, unknown.ring.transform);
  await button.hover();
  assert.equal(await button.evaluate(node => node.querySelector('[data-update-arc]').getAnimations().includes(globalThis.__updateRingMotion)), true);
  await status({ status: 'downloading', percent: 42 });
  await settled(42);
  await outside();
  await page.keyboard.press('Tab');
  await button.focus();
  assert.equal(await button.evaluate(node => node.matches(':focus-visible')), true);
  assert.equal((await page.evaluate(pose)).details, '1');
  assert.equal((await page.evaluate(pose)).ring.offset, 58);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.documentElement.dataset.fxTier === 'static');
  assert.equal((await page.evaluate(pose)).arrows.animation, 'none');
  await status({ status: 'downloading', percent: 73 });
  assert.equal((await page.evaluate(pose)).ring.offset, 27, 'reduced motion still renders live progress');
  assert.equal(await page.locator('[data-update-arc]').evaluate(node => getComputedStyle(node).transitionDuration), '0s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => document.documentElement.dataset.fxTier === 'full');
  await page.evaluate(() => document.body.classList.add('is-idle'));
  assert.equal(await page.locator('.update-art').evaluate(node => node.getAnimations({ subtree: true }).length), 0);
  await page.evaluate(() => document.body.classList.remove('is-idle'));
  await status({ status: 'downloaded', version: '0.2.31' });
  await settled(100);
  await outside();
  assert.equal((await page.evaluate(pose)).ring.offset, 0);
  assert.equal((await page.evaluate(pose)).ring.opacity, '1');
  await button.hover();
  assert.equal((await page.evaluate(pose)).text, '100%');
  assert.equal(await page.locator('[data-update-caption]').textContent(), '重启');
  await status({ status: 'error', message: '测试失败重试' });
  assert.equal(await button.isVisible(), true);
  assert.equal((await page.evaluate(pose)).text, '!');
  await status({ status: 'current', version: '0.2.31' });
  assert.equal(await button.isVisible(), false);
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'progress-motion.json'), JSON.stringify(results, null, 2));
});
