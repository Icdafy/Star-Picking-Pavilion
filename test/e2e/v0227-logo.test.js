'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchNativeElectron } = require('./native-electron.cjs');

const root = path.join(__dirname, '../..');
const screenshots = path.join(root, 'work/v0227/screenshots');

function pose() {
  const svg = document.querySelector('[data-brand-logo] > svg');
  return [...svg.querySelectorAll('animateTransform')].map(animation => {
    const transforms = animation.parentNode.transform.animVal;
    const matrix = transforms.numberOfItems ? transforms.getItem(0).matrix : null;
    return matrix && ['a', 'b', 'c', 'd', 'e', 'f'].map(key => Number(matrix[key].toFixed(5)));
  });
}
function clock() {
  const svg = document.querySelector('[data-brand-logo] > svg');
  return { time: svg.getCurrentTime(), paused: svg.animationsPaused() };
}

test('v0.2.27 logo stays still, loops only on hover and resets on exit', { timeout: 90000 }, async t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0227-logo-'));
  fs.writeFileSync(path.join(profile, 'ui-preferences.json'), JSON.stringify({ version: 2, realtime: false }));
  const app = await launchNativeElectron(root, profile);
  t.after(async () => {
    await app.close();
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('[data-brand-logo] > svg');
  console.log('Logo startup environment:', JSON.stringify(await page.evaluate(() => ({
    focus: document.hasFocus(), hidden: document.hidden,
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    tier: document.documentElement.dataset.fxTier
  }))));
  // Playback assertions require normal motion. Runner OS preferences may be
  // reduced; that separate policy is verified explicitly later in this test.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.focus(); win.webContents.focus();
  });
  await page.waitForFunction(() => document.hasFocus() && !document.hidden
    && !matchMedia('(prefers-reduced-motion: reduce)').matches
    && document.documentElement.dataset.fxTier !== 'static');
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  await page.mouse.move(700, 400);
  const initial = await page.evaluate(pose);
  assert.equal(initial.length, 6, 'All six uploaded animation tracks must be preserved');
  assert.deepEqual(await page.evaluate(clock), { time: 0, paused: true });
  await page.waitForTimeout(1100);
  assert.deepEqual(await page.evaluate(pose), initial, 'Idle geometry must not change');
  assert.deepEqual(await page.evaluate(clock), { time: 0, paused: true });
  await page.locator('.brand-text h1').hover();
  assert.deepEqual(await page.evaluate(clock), { time: 0, paused: true }, 'Adjacent text must not start the logo');

  const mark = page.locator('[data-brand-logo]');
  await mark.hover();
  try {
    await page.waitForFunction(() => document.querySelector('[data-brand-logo] > svg').getCurrentTime() > 0.8);
  } catch (error) {
    console.log('Logo hover environment:', JSON.stringify(await page.evaluate(() => {
      const mark = document.querySelector('[data-brand-logo]'), svg = mark.querySelector('svg');
      return { focus: document.hasFocus(), hidden: document.hidden, hover: mark.matches(':hover'),
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        tier: document.documentElement.dataset.fxTier, paused: svg.animationsPaused(), time: svg.getCurrentTime() };
    })));
    throw error;
  }
  assert.equal((await page.evaluate(clock)).paused, false);
  assert.notDeepEqual(await page.evaluate(pose), initial, 'The actual SVG shapes must move');
  fs.mkdirSync(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, 'hover-light.png') });
  await page.waitForFunction(() => document.querySelector('[data-brand-logo] > svg').getCurrentTime() > 6.1);
  assert.notDeepEqual(await page.evaluate(pose), initial, 'Animation must continue into a second 5.2 s loop');
  await page.mouse.move(700, 400);
  assert.deepEqual(await page.evaluate(clock), { time: 0, paused: true });
  assert.deepEqual(await page.evaluate(pose), initial, 'Pointer exit must restore the first pose');
  await mark.hover();
  assert.ok((await page.evaluate(clock)).time < 0.4, 'Re-entry must start a fresh loop');
  await page.waitForFunction(() => document.querySelector('[data-brand-logo] > svg').getCurrentTime() > 0.5);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('[data-brand-logo] > svg').animationsPaused());
  assert.deepEqual(await page.evaluate(pose), initial, 'Reduced motion must restore the static pose');
  await page.mouse.move(700, 400);
  await mark.hover();
  await page.waitForTimeout(350);
  assert.deepEqual(await page.evaluate(clock), { time: 0, paused: true });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => !document.querySelector('[data-brand-logo] > svg').animationsPaused());

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  await page.waitForFunction(() => document.hidden);
  assert.deepEqual(await page.evaluate(clock), { time: 0, paused: true }, 'Background window must stop the clock');
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.show(); win.focus(); win.webContents.focus();
  });
  await page.mouse.move(700, 400);
  for (const width of [1440, 800]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 960), width);
    for (const theme of ['light', 'dark']) {
      if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.locator('#btnTheme').click();
      await page.mouse.move(700, 400);
      const box = await mark.boundingBox();
      assert.ok(box && Math.abs(box.width - box.height) < 1, 'Logo must remain square at each layout');
      assert.deepEqual(await page.evaluate(pose), initial);
      await page.screenshot({ path: path.join(screenshots, `idle-${width}-${theme}.png`) });
      await mark.hover();
      await page.waitForFunction(() => document.querySelector('[data-brand-logo] > svg').getCurrentTime() > 0.8);
      assert.notDeepEqual(await page.evaluate(pose), initial);
      await page.screenshot({ path: path.join(screenshots, `hover-${width}-${theme}.png`) });
    }
  }
  await page.mouse.move(700, 400);
  // A failed asset request must preserve the same static first pose.
  await page.route('**/logo.svg', route => route.abort());
  await page.reload();
  await page.waitForSelector('[data-brand-logo] > img');
  await page.waitForFunction(() => document.querySelector('[data-brand-logo] > img').naturalWidth > 0);
  await page.waitForTimeout(400);
  assert.equal(await page.locator('[data-brand-logo] > svg').count(), 0);
  assert.deepEqual(errors, []);
});
