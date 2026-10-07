'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchNativeElectron } = require('./native-electron.cjs');
const Schema = require('../../renderer/ui-preference-schema');
const CommonLinks = require('../../renderer/common-links');
const root = path.join(__dirname, '../..');
const screenshots = path.join(root, 'work/v029/screenshots');
const processes = new Map();

async function profile(t) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-v028-ui-'));
  processes.set(directory, []);
  t.after(async () => {
    for (const { app, child } of processes.get(directory)) {
      if (child.exitCode === null) await app.close().catch(() => {});
    }
    processes.delete(directory);
    // Chromium's DIPS database handles can outlive the process exit notification
    // briefly on Windows; retain failure after a bounded cleanup retry.
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return directory;
}

async function launch(t, directory) {
  const app = await launchNativeElectron(root, directory);
  processes.get(directory).push({ app, child: app.process() });
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  await page.waitForFunction(() => document.documentElement.dataset.aquaEnabled != null);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setContentSize(1440, 920); win.showInactive();
  });
  return { app, page };
}

test('v028 fresh installation uses the captured baseline and reopening retains saved settings', { timeout: 120_000 }, async t => {
  const directory = await profile(t);
  const { app, page } = await launch(t, directory);
  const initial = await page.evaluate(() => ({
    preferences: starPickingPavilion.preferences,
    theme: document.documentElement.dataset.theme,
    effects: document.documentElement.dataset.aquaEnabled,
    whale: document.documentElement.dataset.aquaWhale,
    stars: document.documentElement.dataset.aquaCritters
  }));
  assert.equal(initial.theme, 'light');
  assert.equal(initial.effects, 'off');
  assert.equal(initial.whale, 'off');
  assert.equal(initial.stars, 'off');
  assert.deepEqual(initial.preferences, { version: 2, ...Schema.INITIAL_UI_PREFERENCES });
  assert.equal((await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor())).toLowerCase(), '#ffffff');
  const interval = await page.evaluate(() => fetch('/api/settings').then(r => r.json()).then(s => s.collect.intervalMinutes));
  assert.equal(interval, 60);
  const choices = { version: 2, ...Schema.getLegacyUiPreferences(CommonLinks),
    theme: 'dark', textScale: 'xl', aquaMode: 'compat', aquaHue: 260, aquaBrightness: 38,
    aquaBlur: 12, aquaFrost: 55, aquaWhale: false, aquaCritters: true,
    view: 'settings', linksCategory: 'AI', commonLinksFavorites: [], realtime: false };
  await page.evaluate(values => starPickingPavilion.updatePreferences(values), choices);
  const file = path.join(directory, 'ui-preferences.json');
  const before = await fs.promises.readFile(file, 'utf8');
  await app.close();
  const reopened = await launch(t, directory);
  assert.deepEqual(await reopened.page.evaluate(() => starPickingPavilion.preferences), choices);
  assert.equal(await reopened.page.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await reopened.page.locator('html').getAttribute('data-ui-scale'), 'xl');
  assert.equal(await reopened.page.locator('html').getAttribute('data-aqua-enabled'), 'on');
  assert.equal(await fs.promises.readFile(file, 'utf8'), before);
});

test('v028 scrollbar stays below the title bar, responds to all palettes and preserves native input', { timeout: 120_000 }, async t => {
  const directory = await profile(t);
  await fs.promises.writeFile(path.join(directory, 'ui-preferences.json'), JSON.stringify({
    version: 2, ...Schema.getLegacyUiPreferences(CommonLinks), view: 'settings'
  }));
  const { app, page } = await launch(t, directory);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('#aquaPalettePresets button');
  await fs.promises.mkdir(screenshots, { recursive: true });
  const metrics = () => page.evaluate(() => {
    const viewport = document.getElementById('appViewport');
    const thumb = getComputedStyle(viewport, '::-webkit-scrollbar-thumb');
    const track = getComputedStyle(viewport, '::-webkit-scrollbar-track');
    const title = viewport.getBoundingClientRect().top;
    return {
      color: thumb.backgroundColor, top: title + parseFloat(track.marginTop), bottom: parseFloat(track.marginBottom),
      title, viewportHeight: viewport.clientHeight,
      width: innerWidth, height: innerHeight, contentHeight: viewport.scrollHeight,
      minThumb: parseFloat(thumb.minHeight), scroll: viewport.scrollTop, clientWidth: viewport.clientWidth,
      titlebarRight: document.querySelector('.desktop-titlebar-liquid-glass').getBoundingClientRect().right,
      rootWidth: document.documentElement.clientWidth, rootScroll: window.scrollY
    };
  });
  for (const theme of ['light', 'dark']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#btnTheme').click();
    const palettes = await page.locator('#aquaPalettePresets button').evaluateAll(buttons => buttons.map(b => b.dataset.aquaPalette));
    const colors = new Set();
    for (const palette of palettes) {
      await page.locator(`[data-aqua-palette="${palette}"]`).click();
      const value = await metrics();
      assert.ok(value.top >= value.title + 4, `${theme}/${palette}: track intrudes into the title bar`);
      assert.equal(value.width - value.clientWidth, 14);
      assert.equal(value.titlebarRight, value.width, 'title bar must cover the right scrollbar gutter');
      assert.equal(value.rootWidth, value.width, 'root scrollbar must not occupy the title bar');
      assert.equal(value.rootScroll, 0);
      assert.notEqual(value.color, 'rgba(0, 0, 0, 0)');
      colors.add(value.color);
    }
    assert.equal(colors.size, 6, `${theme}: every background palette must change the scrollbar color`);
    await page.evaluate(() => document.getElementById('appViewport').scrollTo({ top: 0, behavior: 'instant' }));
    const screenshot = await page.screenshot({ path: path.join(screenshots, `scrollbar-${theme}-top.png`) });
    const dimensions = await metrics();
    // Chromium 的窗口滚动条样式来自 body；仅检查 html 的伪元素会漏掉视觉越界。
    const firstThumbPixel = await app.evaluate(({ nativeImage }, { png, viewportWidth }) => {
      const image = nativeImage.createFromBuffer(Buffer.from(png, 'base64'));
      const { width, height } = image.getSize();
      const bitmap = image.getBitmap();
      const scale = width / viewportWidth;
      const center = Math.round(width - 7 * scale), edge = width - 1;
      for (let y = 0; y < height; y++) {
        const a = (y * width + center) * 4, b = (y * width + edge) * 4;
        if ([0, 1, 2].some(channel => Math.abs(bitmap[a + channel] - bitmap[b + channel]) > 30)) return y / scale;
      }
      return -1;
    }, { png: screenshot.toString('base64'), viewportWidth: dimensions.width });
    assert.ok(firstThumbPixel >= dimensions.title, `${theme}: rendered thumb begins at ${firstThumbPixel}, title bar ends at ${dimensions.title}`);
    assert.ok(firstThumbPixel < dimensions.title + 16, `${theme}: rendered thumb must remain close to the title bar`);
  }
  // 内部列表不继承主窗口的标题栏空白。
  await page.locator('#btnPalette').click();
  const nestedTop = await page.locator('#paletteList').evaluate(node => getComputedStyle(node, '::-webkit-scrollbar-track').marginTop);
  assert.equal(nestedTop, '0px');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { document.activeElement?.blur(); document.getElementById('appViewport').scrollTo({ top: 0, behavior: 'instant' }); });
  const drag = await metrics();
  const trackHeight = drag.height - drag.top - drag.bottom;
  const thumbHeight = Math.max(drag.minThumb, trackHeight * drag.viewportHeight / drag.contentHeight);
  await page.mouse.move(drag.width - 7, drag.top + thumbHeight / 2);
  await page.mouse.down();
  await page.mouse.move(drag.width - 7, drag.top + thumbHeight / 2 + 120, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(() => document.getElementById('appViewport').scrollTop > 100);
  await page.evaluate(() => document.getElementById('appViewport').scrollTo({ top: 0, behavior: 'instant' }));
  await page.mouse.move(1000, 500);
  await page.mouse.wheel(0, 700);
  await page.waitForFunction(() => document.getElementById('appViewport').scrollTop > 100);
  await page.keyboard.press('Control+End');
  await page.waitForFunction(() => document.getElementById('appViewport').scrollTop + document.getElementById('appViewport').clientHeight >= document.getElementById('appViewport').scrollHeight - 2);
  await page.screenshot({ path: path.join(screenshots, 'scrollbar-dark-bottom.png') });
  await page.keyboard.press('Control+Home');
  await page.waitForFunction(() => document.getElementById('appViewport').scrollTop === 0);
  await page.locator('#setAquaEnabled').click();
  const neutralDark = (await metrics()).color;
  await page.locator('#btnTheme').click();
  const neutralLight = (await metrics()).color;
  assert.notEqual(neutralDark, neutralLight);
  await page.emulateMedia({ forcedColors: 'active' });
  await page.waitForFunction(() => matchMedia('(forced-colors: active)').matches);
  const system = await metrics();
  const systemColors = await page.evaluate(() => {
    const probe = document.createElement('span');
    document.body.append(probe);
    const colors = ['CanvasText', 'Highlight'].map(value => {
      probe.style.color = value; return getComputedStyle(probe).color;
    });
    probe.remove(); return colors;
  });
  assert.ok(systemColors.includes(system.color), `scrollbar must use an active system color: ${system.color}`);
  assert.deepEqual(errors, []);
});
