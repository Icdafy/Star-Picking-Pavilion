'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { launchNativeElectron } = require('./native-electron.cjs');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'work/v0228/screenshots');

async function waitForStableGeometry(locator) {
  await locator.evaluate(async node => {
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    let previous = null;
    for (;;) {
      await frame();
      // A finished spring restores inline styles on another frame, which can
      // expose a CSS transition. Re-read animations after each completion.
      const animations = node.getAnimations({ subtree: true }).filter(animation =>
        Number.isFinite(animation.effect?.getComputedTiming().endTime)
        && animation.playState !== 'finished' && animation.playState !== 'idle');
      if (animations.length) {
        await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
        previous = null;
        continue;
      }
      const bounds = JSON.stringify(node.getBoundingClientRect().toJSON());
      if (bounds === previous) return;
      previous = bounds;
    }
  });
}

test('v0.2.28 real desktop: idle backend, synchronized work, supplied update art and global configurable tracking', { timeout: 150000 }, async t => {
  fs.mkdirSync(output, { recursive: true });
  let releaseFeed, enteredFeed, feedRequests = 0;
  const feedGate = new Promise(resolve => { releaseFeed = resolve; });
  const feedEntered = new Promise(resolve => { enteredFeed = resolve; });
  const fixtureServer = http.createServer(async (req, res) => {
    if (req.url === '/feed') {
      feedRequests += 1; enteredFeed(); await feedGate;
      res.setHeader('Content-Type', 'application/rss+xml');
      res.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>低空经济测试信源</title><link>${fixtureOrigin}</link><description>本机测试</description><item><title>低空经济载人飞行汽车完成首飞验证</title><link>${fixtureOrigin}/article/new</link><guid>${fixtureOrigin}/article/new</guid><pubDate>${new Date().toUTCString()}</pubDate><description>低空经济领域，载人飞行汽车完成首飞验证，eVTOL 电动垂直起降航空器完成试验。</description></item></channel></rss>`);
    } else {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<html lang="zh-CN"><head><title>低空经济载人飞行汽车首飞</title></head><body><article>低空经济载人飞行汽车完成首飞验证，电动垂直起降航空器 eVTOL 完成飞行试验，验证动力系统与适航技术。</article></body></html>');
    }
  });
  await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
  const fixtureOrigin = `http://127.0.0.1:${fixtureServer.address().port}`;
  t.after(async () => { releaseFeed(); fixtureServer.closeAllConnections(); await new Promise(resolve => fixtureServer.close(resolve)); });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0228-'));
  fs.writeFileSync(path.join(profile, 'settings.json'), '{}');
  fs.writeFileSync(path.join(profile, 'ui-preferences.json'), JSON.stringify({ version: 2, theme: 'light', realtime: false, aquaEnabled: false }));
  const seed = spawnSync(process.execPath, ['-e', `
    const {db}=require('./server/db'); require('./server/collectors').seedSources();
    db.prepare('UPDATE sources SET enabled=0').run();
    const source=db.prepare("INSERT INTO sources(name,type,url,tier,domain,enabled,intl) VALUES (?,'rss',?,'T1','lowaltitude',1,0)").run('本机验证信源',${JSON.stringify(fixtureOrigin + '/feed')});
    db.prepare('INSERT INTO articles(source_id,url,title,summary_raw,published_at,fetched_at) VALUES (?,?,?,?,?,?)')
      .run(source.lastInsertRowid,${JSON.stringify(fixtureOrigin + '/article/seed')},'低空经济飞行汽车首飞验证','低空经济载人飞行汽车完成首飞与适航验证',new Date().toISOString(),new Date().toISOString());
    db.close();`], { cwd: root, env: { ...process.env, STAR_PICKING_PAVILION_DATA_DIR: profile }, encoding: 'utf8' });
  assert.equal(seed.status, 0, seed.stderr);
  const app = await launchNativeElectron(root, profile, { startScheduler: true });
  let page, passed = false;
  t.after(async () => {
    if (!passed && page) fs.writeFileSync(path.join(output, 'failure-state.json'), JSON.stringify(await page.evaluate(() => ({
      focus: document.hasFocus(), hidden: document.hidden, tier: document.documentElement.dataset.fxTier,
      pointer: document.documentElement.dataset.pointerEnabled, size: document.documentElement.dataset.pointerSize,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      activeView: document.querySelector('.view:not([hidden])')?.id,
      scroll: document.getElementById('appViewport').scrollTop,
      lights: [...document.querySelectorAll('.surface-light, .control-aura')].map(node => node.parentElement.id || node.parentElement.className)
    })).catch(error => ({ error: error.message })), null, 2));
    await app.close(); await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1440, 920); win.focus(); win.webContents.focus();
  });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof syncFxTier === 'function' && document.getElementById('updatePill')?.dataset.state === 'idle');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 8 });
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 8 });
    syncFxTier();
    globalThis.activityTrace = [];
    globalThis.activityProbe = new EventSource('/api/activity');
    activityProbe.onmessage = event => activityTrace.push(JSON.parse(event.data));
  });
  await page.waitForFunction(() => document.hasFocus() && document.documentElement.dataset.fxTier === 'full' && activityTrace.length > 0);
  await page.waitForTimeout(3500);
  const idle = await page.evaluate(async () => ({
    stats: await fetch('/api/stats').then(response => response.json()),
    label: document.getElementById('statStatusLabel').textContent,
    animation: getComputedStyle(document.querySelector('#statStatus .pulse-dot')).animationName
  }));
  assert.equal(feedRequests, 0, 'launch must not collect');
  assert.equal(idle.stats.pending, 1, 'pending history must remain untouched while idle');
  assert.equal(idle.stats.pipeline.schedulerStarted, true, 'test exercises the actual scheduler');
  assert.equal(idle.stats.pipeline.activity, 'online');
  assert.equal(idle.stats.pipeline.lastAnalyzeAt, null);
  assert.equal(idle.label, '在线'); assert.equal(idle.animation, 'none');
  await page.screenshot({ path: path.join(output, 'idle-light.png') });
  await page.locator('#btnRefresh').click();
  await feedEntered;
  await page.waitForFunction(() => document.getElementById('statStatusLabel').textContent === '信源采集' && document.getElementById('btnRefresh').classList.contains('spinning'));
  assert.equal(await page.locator('#btnRefresh').isDisabled(), true);
  const active = await page.evaluate(() => fetch('/api/stats').then(response => response.json()));
  assert.equal(active.pipeline.activity, 'collecting'); assert.equal(active.pipeline.collectRunning, true);
  await page.screenshot({ path: path.join(output, 'collecting-light.png') });
  releaseFeed();
  await page.waitForFunction(() => activityTrace.some(status => status.collectRunning) && activityTrace.at(-1).activity === 'online'
    && document.getElementById('statStatusLabel').textContent === '在线' && !document.getElementById('btnRefresh').classList.contains('spinning'));
  const trace = await page.evaluate(() => activityTrace);
  const workStart = trace.findIndex(status => status.activity === 'collecting');
  assert.ok(trace.slice(workStart, -1).every(status => status.activity === 'collecting'), 'analysis and tail must not flash online');
  assert.ok(trace.some(status => status.analyzeRunning), 'real analysis phase emitted');
  assert.equal(feedRequests, 1);
  const completed = await page.evaluate(() => fetch('/api/stats').then(response => response.json()));
  assert.equal(completed.pipeline.nextCollectAt, null);
  assert.equal(completed.pipeline.lastPipeline.ok, true);

  await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('update:status', value), { status: 'downloading', version: '0.2.29', percent: 37 });
  await page.waitForFunction(() => document.getElementById('updatePill').dataset.state === 'downloading');
  await page.mouse.move(900, 400);
  assert.equal(await page.locator('.update-details').evaluate(node => getComputedStyle(node).opacity), '0');
  assert.equal(await page.locator('[data-update-icon]').evaluate(node => getComputedStyle(node).opacity), '1');
  assert.equal(await page.locator('.update-art animate, .update-art animateTransform').count(), 0);
  await page.locator('#updatePill').hover();
  assert.equal(await page.locator('.update-details').evaluate(node => getComputedStyle(node).opacity), '1');
  assert.equal(await page.locator('[data-update-value]').textContent(), '37%');
  assert.equal(await page.locator('[data-update-arc]').getAttribute('stroke-dashoffset'), '63');
  const centering = await page.locator('#updatePill').evaluate(node => {
    const button = node.getBoundingClientRect(), slot = node.parentElement.getBoundingClientRect();
    return [Math.abs((button.left + button.right - slot.left - slot.right) / 2), Math.abs((button.top + button.bottom - slot.top - slot.bottom) / 2)];
  });
  assert.ok(centering.every(offset => offset < 1), `update art centered in remaining space: ${centering}`);
  await page.screenshot({ path: path.join(output, 'update-hover-light.png') });
  await page.mouse.move(900, 400);
  assert.equal(await page.locator('.update-details').evaluate(node => getComputedStyle(node).opacity), '0');
  await page.keyboard.press('Tab');
  await page.locator('#updatePill').focus();
  assert.equal(await page.locator('.update-details').evaluate(node => getComputedStyle(node).opacity), '1', 'keyboard access reveals progress');

  for (const width of [1024, 1440]) {
    await app.evaluate(({ BrowserWindow }, width) => {
      const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(width, 920); win.focus(); win.webContents.focus();
    }, width);
    await page.waitForFunction(width => innerWidth === width, width);
    await page.waitForTimeout(300); await page.mouse.move(4, 10);
    const expectedPosition = width === 1440 ? 'sticky' : 'relative';
    const towerBefore = await page.locator('.tower').evaluate(node => ({ position: getComputedStyle(node).position, bounds: node.getBoundingClientRect().toJSON() }));
    assert.equal(towerBefore.position, expectedPosition, `native ${width}px responsive layout`);
    await page.locator('.tower').hover({ position: { x: 10, y: 10 } });
    const towerAfter = await page.locator('.tower').evaluate(node => ({ position: getComputedStyle(node).position, bounds: node.getBoundingClientRect().toJSON() }));
    assert.deepEqual(towerAfter, towerBefore, `tracking preserves ${width}px toolbar positioning and geometry`);
  }
  // A test-owned finite animation holds the compositor near its final frame.
  // This models a delayed visual clock without changing any production timing.
  // The former 300ms wait measures the intermediate rectangle; the new guard
  // must remain pending even though that paused rectangle spans stable frames.
  await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.id = 'modalGeometryScheduleProbe';
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:682.5px;height:585px;opacity:0;pointer-events:none';
    document.body.append(probe);
    probe.__geometryAnimation = probe.animate([{ transform: 'scale(.97)' }, { transform: 'none' }], { duration: 400 });
    probe.__geometryAnimation.pause();
    probe.__geometryAnimation.currentTime = 399.95;
  });
  const probe = page.locator('#modalGeometryScheduleProbe');
  await page.waitForTimeout(300);
  const prematureBounds = await probe.evaluate(node => node.getBoundingClientRect().toJSON());
  let geometrySettled = false;
  const stableGeometry = waitForStableGeometry(probe).then(() => { geometrySettled = true; });
  await probe.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  assert.equal(geometrySettled, false, 'stable frames alone cannot finish while the native animation clock is paused');
  await probe.evaluate(node => node.__geometryAnimation.finish());
  await stableGeometry;
  const settledBounds = await probe.evaluate(node => node.getBoundingClientRect().toJSON());
  assert.notDeepEqual(prematureBounds, settledBounds, 'the former fixed 300ms precondition can observe an unfinished animation');
  await probe.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await probe.evaluate(node => node.getBoundingClientRect().toJSON()), settledBounds,
    'the animation-aware precondition preserves exact geometry under a delayed visual clock');
  console.log('modal geometry clock regression:', JSON.stringify({ premature: prematureBounds, settled: settledBounds }));
  await probe.evaluate(node => { node.__geometryAnimation.cancel(); node.remove(); });
  const dialog = page.locator('#commandPalette');
  await dialog.evaluate(node => {
    node.__geometryOpen = new Promise(resolve => node.addEventListener('toggle', event => {
      if (event.newState === 'open') resolve();
    }, { once: true }));
  });
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#commandPalette[open]');
  await dialog.evaluate(node => node.__geometryOpen);
  await waitForStableGeometry(dialog);
  const dialogBefore = await dialog.evaluate(node => ({ position: getComputedStyle(node).position, bounds: node.getBoundingClientRect().toJSON() }));
  await dialog.locator('.palette-foot').hover();
  await page.waitForFunction(() => document.querySelector('#commandPalette .surface-light'));
  assert.equal(await dialog.evaluate(node => getComputedStyle(node).position), 'fixed');
  assert.deepEqual(await dialog.evaluate(node => node.getBoundingClientRect().toJSON()), dialogBefore.bounds, 'tracking preserves native modal geometry');
  await page.keyboard.press('Escape');

  for (const [index, view] of ['hot', 'featured', 'all', 'starred', 'daily', 'capital', 'releases', 'links', 'sources', 'settings'].entries()) {
    await page.locator(`.tab[data-view="${view}"]`).click();
    const panel = page.locator('.view:not([hidden])').first();
    const banner = panel.locator('.page-banner').first();
    // 切换视图和 locator.hover 的自动滚动都会触发 clearPointer。先完成滚动及整个面板
    // 的有限入场动画，再发真实鼠标移动；不依赖静止指针上的浏览器补发悬停事件。
    await banner.scrollIntoViewIfNeeded();
    await waitForStableGeometry(panel);
    const bannerBounds = await banner.boundingBox();
    const trackingPoint = { x: bannerBounds.x + 75 + (index % 2) * 12, y: bannerBounds.y + 55 };
    await page.mouse.move(4, 10);
    await page.mouse.move(trackingPoint.x, trackingPoint.y);
    try {
      await page.waitForFunction(() => document.querySelector('.view:not([hidden]) .surface-glow'));
    } catch (error) {
      console.error('view tracking failure:', JSON.stringify(await page.evaluate(({ view, point }) => ({
        view, point, focus: document.hasFocus(), hidden: document.hidden,
        tier: document.documentElement.dataset.fxTier, pointer: document.documentElement.dataset.pointerEnabled,
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        activeView: document.querySelector('.view:not([hidden])')?.id,
        hit: document.elementFromPoint(point.x, point.y)?.outerHTML.slice(0, 600),
        scroll: document.getElementById('appViewport').scrollTop,
        lights: [...document.querySelectorAll('.surface-light')].map(node => node.parentElement.id || node.parentElement.className)
      }), { view, point: trackingPoint })));
      throw error;
    }
    assert.ok(await panel.locator('.surface-glow').count() > 0, `${view} tracking surface`);
    if (view === 'daily') {
      await page.waitForFunction(() => !state.loading);
      await panel.evaluate(async node => {
        await Promise.all(node.getAnimations({ subtree: true })
          .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
          .map(animation => animation.finished.catch(() => {})));
      });
      const popover = page.locator('#dailyExportMenu');
      // Reach the menu the way a user does: over its anchor button. The menu is
      // a DOM child of the glass toolbar, whose 2px hover lift is design, not
      // tracking; settle that lift before measuring so only tracking is tested.
      await page.locator('#btnExportDaily').hover();
      await page.locator('.daily-toolbar').evaluate(async node => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {})));
      });
      // The entrance spring starts from the asynchronous toggle event, so wait
      // for that event and the next frame before collecting animations.
      await popover.evaluate(node => new Promise(resolve => {
        node.addEventListener('toggle', () => requestAnimationFrame(() => requestAnimationFrame(resolve)), { once: true });
        node.showPopover();
      }));
      await popover.evaluate(async node => {
        await Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
      });
      const before = await popover.evaluate(node => ({ position: getComputedStyle(node).position, bounds: node.getBoundingClientRect().toJSON() }));
      await popover.hover({ position: { x: 5, y: 5 } });
      await page.waitForFunction(() => document.querySelector('#dailyExportMenu .surface-light'));
      assert.equal(await popover.evaluate(node => getComputedStyle(node).position), 'fixed');
      const after = await popover.evaluate(node => node.getBoundingClientRect().toJSON());
      assert.equal(after.width, before.bounds.width); assert.equal(after.height, before.bounds.height);
      assert.ok(Math.abs(after.x - before.bounds.x) < 1 && Math.abs(after.y - before.bounds.y) < 1,
        'tracking preserves anchored popover geometry within native subpixel rounding: ' + JSON.stringify({ before: before.bounds, after }));
      await page.keyboard.press('Escape');
    }
  }
  await page.locator('[data-settings-target="settingsAppearance"]').click();
  await page.locator('#setPointerSizeNumber').scrollIntoViewIfNeeded();
  // v0.2.39 节奏 × 1.382：章节跳转的滚动与入场更慢，等滚动落定后再悬停。
  await page.waitForTimeout(700);
  await page.locator('#setPointerSizeNumber').hover();
  // 再移动 2px，确保滚动落定后的悬停是一次真实的指针移动。
  const sizeBox = await page.locator('#setPointerSizeNumber').boundingBox();
  await page.mouse.move(sizeBox.x + sizeBox.width / 2 + 2, sizeBox.y + sizeBox.height / 2);
  await page.waitForFunction(() => document.querySelector('#settingsAppearance .surface-glow'));
  await page.waitForTimeout(500);
  const restingCenter = await page.locator('#settingsAppearance .surface-glow').evaluate(node => {
    const style = getComputedStyle(node), matrix = new DOMMatrixReadOnly(style.transform);
    return { x: matrix.m41 + parseFloat(style.width) / 2, y: matrix.m42 + parseFloat(style.height) / 2 };
  });
  await page.locator('#setPointerSizeNumber').fill('520');
  await page.waitForFunction(center => {
    const node = document.querySelector('#settingsAppearance .surface-glow'); if (!node) return false;
    const style = getComputedStyle(node), matrix = new DOMMatrixReadOnly(style.transform);
    return style.width === '520px' && Math.abs(matrix.m41 + 260 - center.x) < .05 && Math.abs(matrix.m42 + 260 - center.y) < .05;
  }, restingCenter);
  await page.locator('#setPointerSizeNumber').press('Tab');
  await page.locator('#setPointerColorHex').fill('#19c7a8');
  await page.locator('#setPointerColorHex').press('Tab');
  await page.waitForFunction(() => document.documentElement.dataset.pointerSize === '520'
    && document.documentElement.style.getPropertyValue('--pointer-color') === '#19c7a8');
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.focus(); win.webContents.focus(); });
  await page.locator('#pointerPalette').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const paletteBounds = await page.locator('#pointerPalette').boundingBox();
  await page.mouse.move(paletteBounds.x + paletteBounds.width / 2, paletteBounds.y - 15);
  await page.waitForFunction(() => document.querySelector('#settingsAppearance .surface-glow'));
  assert.equal(await page.locator('#settingsAppearance .surface-glow').evaluate(node => getComputedStyle(node).width), '520px');
  await page.locator('#pointerPalette').scrollIntoViewIfNeeded();
  await page.mouse.move(900, 620);
  await page.screenshot({ path: path.join(output, 'pointer-settings-light.png') });
  await page.locator('label:has(#setPointerEnabled)').click();
  assert.equal(await page.locator('#setPointerEnabled').isChecked(), false);
  await page.waitForFunction(() => document.querySelectorAll('.surface-light, .control-aura').length === 0);
  await page.locator('#pointerHeading').hover();
  assert.equal(await page.locator('.surface-light, .control-aura').count(), 0);
  await page.locator('label:has(#setPointerEnabled)').click();
  assert.equal(await page.locator('#setPointerEnabled').isChecked(), true);
  await page.waitForFunction(() => document.documentElement.dataset.pointerEnabled === 'on');
  await page.waitForTimeout(350);
  const saved = await app.evaluate(({ app }) => JSON.parse(require('node:fs').readFileSync(require('node:path').join(app.getPath('userData'), 'ui-preferences.json'), 'utf8')));
  assert.equal(saved.pointerSize, 520); assert.equal(saved.pointerColor, '#19c7a8'); assert.equal(saved.pointerEnabled, true);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.pointerSize === '520');
  assert.equal(await page.locator('#setPointerColorHex').inputValue(), '#19c7a8');
  await page.locator('#btnTheme').click();
  await page.locator('#pointerHeading').hover();
  await page.screenshot({ path: path.join(output, 'pointer-settings-dark.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelectorAll('.surface-light, .control-aura').length === 0);
  assert.equal(await page.locator('#statStatusLabel').textContent(), '在线');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'activity-trace.json'), JSON.stringify({ idle, active, completed, trace, centering }, null, 2));
  passed = true;
});
