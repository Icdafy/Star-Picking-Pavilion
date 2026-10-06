'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.join(__dirname, '../..');
const evidence = path.join(root, 'work/v0211/e2e');

async function open(t) {
  fs.mkdirSync(evidence, { recursive: true });
  const profile = fs.mkdtempSync(path.join(evidence, 'profile-'));
  fs.writeFileSync(path.join(profile, 'settings.json'), '{}');
  fs.writeFileSync(path.join(profile, 'ui-preferences.json'), JSON.stringify({ version: 2,
    ...require('../../renderer/ui-preference-schema').getLegacyUiPreferences(require('../../renderer/common-links')), realtime: false }));
  const seed = spawnSync(process.execPath, ['-e', `
    const {db,closeDatabase}=require('./server/db');
    const source=Number(db.prepare("INSERT INTO sources(name,type,url,tier,domain) VALUES('v0210 隔离样本','rss','https://motion-fixture.example/feed','T2','aerospace')").run().lastInsertRowid);
    const insert=db.prepare('INSERT INTO articles(source_id,title,url,fetched_at,published_at,relevant,featured,analyzed,domain,quality_score,ai_summary) VALUES(?,?,?,?,?,1,1,1,?,88,?)');
    db.exec('BEGIN');for(let i=0;i<12;i++){const date=new Date(Date.now()-i*60000).toISOString();const title='动效隔离样本 '+i+'：航天产业技术进展';
      const id=Number(insert.run(source,title,'https://motion-fixture.example/v0210/'+i,date,date,i%2?'lowaltitude':'aerospace','虚构样本，仅用于交互验证。').lastInsertRowid);
      db.prepare('INSERT INTO articles_fts(rowid,title,summary) VALUES(?,?,?)').run(id,title,'交互验证');}db.exec('COMMIT');closeDatabase();
  `], { cwd: root, env: { ...process.env, STAR_PICKING_PAVILION_DATA_DIR: profile }, encoding: 'utf8' });
  assert.equal(seed.status, 0, seed.stderr);
  const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => {
    const port = server.address().port; server.close(() => resolve(port));
  }); });
  const wrapper = path.join(profile, 'native.cjs');
  fs.writeFileSync(wrapper, `const electron=require('electron');
    process.on('uncaughtException',e=>{console.error(e);electron.app.exit(1)});
    process.on('message',async m=>{try{process.send({id:m.id,result:await eval('('+m.expression+')')(electron,m.arg)});}catch(e){process.send({id:m.id,error:e.stack});}});
    require(${JSON.stringify(path.join(root, 'electron/main.js'))});`);
  const child = spawn(require('electron'), [wrapper, '--hidden', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
    cwd: root, env: { ...process.env, STAR_PICKING_PAVILION_TEST_DATA_DIR: profile,
      STAR_PICKING_PAVILION_NO_SCHEDULER: '1', STAR_PICKING_PAVILION_DISABLE_AUTO_UPDATE: '1' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let output = '', sequence = 0, browser, currentPage;
  const pending = new Map();
  child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
  child.on('message', message => { const call = pending.get(message.id); if (!call) return;
    pending.delete(message.id); clearTimeout(call.timer); message.error ? call.reject(new Error(message.error)) : call.resolve(message.result);
  });
  const native = (fn, arg) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Native IPC timeout: ' + output)); }, 15000);
    pending.set(id, { resolve, reject, timer }); child.send({ id, expression: fn.toString(), arg });
  });
  t.after(async () => {
    if (currentPage && !currentPage.isClosed()) {
      const snapshot = await currentPage.evaluate(() => ({ focus: document.hasFocus(), hidden: document.hidden,
        tier: document.documentElement.dataset.fxTier, fonts: document.fonts.status, loading: state.loading,
        banner: document.getElementById('feedBanner').hidden, scroll: document.getElementById('appViewport').scrollTop,
        pointer: window.motionPointerProbe, card: document.querySelector('#feedList .card')?.getBoundingClientRect().toJSON(),
        lights: [...document.querySelectorAll('.surface-light, .control-aura')].map(el => ({
          type: el.className, alpha: el.style.opacity, parent: el.parentElement.className }))
      })).catch(error => ({ diagnosticError: error.message }));
      fs.writeFileSync(path.join(profile, 'motion-state.json'), JSON.stringify(snapshot, null, 2));
      console.log('Motion state:', JSON.stringify({ ...snapshot, pointer: snapshot.pointer?.slice(-6) }));
    }
    if (browser) await browser.close().catch(() => {});
    if (child.exitCode === null && child.connected) await native(({ app }) => { setTimeout(() => app.quit(), 30); return true; }).catch(() => {});
    if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); setTimeout(() => { if (child.exitCode === null) child.kill(); resolve(); }, 5000).unref(); });
    fs.writeFileSync(path.join(profile, 'native.log'), output);
  });
  const started = Date.now();
  while (true) {
    if (child.exitCode !== null || Date.now() - started > 20000) throw new Error('Native launch failed: ' + output);
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
  const context = browser.contexts()[0], page = context.pages()[0] || await context.waitForEvent('page');
  currentPage = page;
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('#feedList .card[data-id]');
  await native(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0];
    win.setContentSize(1440, 920); win.setAlwaysOnTop(true); win.show(); win.focus(); win.webContents.focus();
    // Keep OS cursor movement from racing the CDP pointer on the foreground
    // window. CDP still drives the real renderer and native window lifecycle.
    win.setIgnoreMouseEvents(true);
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => document.hasFocus() && !document.hidden);
  await page.waitForTimeout(500);
  await page.waitForFunction(() => !state.loading);
  // Await the actual initial font and stats/banner hydration before measuring
  // local coordinates. Both can finish after the first cards on slower hosts.
  await page.evaluate(async () => { await Promise.all([document.fonts.ready, refreshStats()]); });
  await page.evaluate(() => {
    // This functional fixture exercises full enhancements on low-core hosts.
    // Register after the application's listener on the same MediaQueryList:
    // a delayed native preference notification must not reset it to lite.
    // Reduced motion still uses the application's static tier, and the tests
    // below continue to exercise explicit lite and disposal without overrides.
    const exerciseFullTier = () => {
      if (!reducedMotionQuery.matches) document.documentElement.dataset.fxTier = 'full';
    };
    reducedMotionQuery.addEventListener('change', exerciseFullTier);
    exerciseFullTier();
    window.motionPointerProbe = [];
    for (const type of ['pointerover', 'pointerout', 'pointermove']) document.addEventListener(type, event => {
      motionPointerProbe.push({ type, x: event.clientX, y: event.clientY, target: event.target.className,
        focus: document.hasFocus(), tier: document.documentElement.dataset.fxTier,
        scroll: document.getElementById('appViewport').scrollTop });
      if (motionPointerProbe.length > 24) motionPointerProbe.shift();
    }, { passive: true });
  });
  return { page, native, profile, errors };
}

const selectedGeometry = selector => {
  const group = document.querySelector(selector);
  const selected = group.querySelector('button.active').getBoundingClientRect();
  const indicator = group.querySelector('.selection-indicator, .tab-indicator').getBoundingClientRect();
  return ['left', 'top', 'width', 'height'].map(key => Math.abs(selected[key] - indicator[key]));
};

test('v0210 Electron: current version, continuous navigation redirection, filters and resize', { timeout: 90000 }, async t => {
  const { page, native, errors } = await open(t);
  const version = require('../../package.json').version;
  assert.equal(await page.locator('#appVersion').textContent(), 'v' + version);
  assert.equal(await page.evaluate(async () => (await (await fetch('/api/version')).json()).version), version);
  assert.equal(await page.locator('#appVersion').isVisible(), true);
  await page.evaluate(() => document.querySelector('.tab[data-view="links"]').click());
  await page.waitForTimeout(70);
  const continuity = await page.evaluate(() => {
    const indicator = document.querySelector('.tab-indicator');
    const before = indicator.getBoundingClientRect();
    document.querySelector('.tab[data-view="all"]').click();
    const after = indicator.getBoundingClientRect();
    return { delta: Math.abs(before.top - after.top) + Math.abs(before.left - after.left),
      running: indicator.getAnimations().filter(a => a.playState === 'running').length };
  });
  assert.ok(continuity.delta < 2, JSON.stringify(continuity)); assert.equal(continuity.running, 1);
  await page.evaluate(() => { for (let i = 0; i < 30; i++) document.querySelector(`.tab[data-view="${i % 2 ? 'featured' : 'links'}"]`).click(); });
  await page.waitForTimeout(450);
  assert.equal(await page.locator('.tab.active').getAttribute('data-view'), 'featured');
  assert.ok((await page.evaluate(selectedGeometry, '.nav-tabs')).every(delta => delta < 1));
  const domain = page.locator('.domain-pills button[data-domain="aerospace"]');
  await domain.click();
  // Pausing the visual clock must not extend the lifetime or hide the selected state.
  await page.evaluate(() => document.querySelector('.domain-pills .selection-indicator').getAnimations().forEach(animation => animation.pause()));
  await page.waitForTimeout(450);
  const geometry = await page.evaluate(selectedGeometry, '.domain-pills');
  assert.ok(geometry.every(delta => delta < 1), `domain geometry mismatch: ${JSON.stringify(geometry)}`);
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('.selection-indicator')].every(el =>
    el.getAnimations().every(animation => animation.effect.getKeyframes().every(frame => !('width' in frame) && !('height' in frame))))));
  await native(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(900, 680));
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#appVersion').isVisible(), true);
  assert.ok((await page.evaluate(selectedGeometry, '.domain-pills')).every(delta => delta < 1));
  const tab = page.locator('.tab[data-view="featured"]'); await tab.focus();
  await page.keyboard.press('ArrowRight'); assert.equal(await page.locator('.tab.active').getAttribute('data-view'), 'hot');
  await page.waitForTimeout(450);
  assert.ok((await page.evaluate(selectedGeometry, '.nav-tabs')).every(delta => delta < 1));
  assert.deepEqual(errors, []);
});

test('v0210 Electron: pointer spotlight, bounded press waves and keyboard actions', { timeout: 90000 }, async t => {
  const { page, errors } = await open(t);
  const card = page.locator('#feedList .card').first();
  // Use the locator's stable hit target: asynchronous stats/banner layout can move a card.
  await card.hover();
  const bounds = await card.boundingBox();
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await page.mouse.move(center.x, center.y);
  try { await page.waitForSelector('.surface-glow'); }
  catch (error) {
    const snapshot = await page.evaluate(point => ({
      tier: document.documentElement.dataset.fxTier,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      focused: document.hasFocus(), hidden: document.hidden,
      idle: document.body.classList.contains('is-idle'),
      hit: document.elementFromPoint(point.x, point.y)?.className,
      card: document.querySelector('#feedList .card')?.getBoundingClientRect().toJSON()
    }), center);
    error.message += `\nPointer state: ${JSON.stringify(snapshot)}`;
    throw error;
  }
  const before = await page.locator('.surface-glow').evaluate(el => getComputedStyle(el).transform);
  await page.mouse.move(center.x + 90, center.y + 15); await page.waitForTimeout(250);
  assert.notEqual(await page.locator('.surface-glow').evaluate(el => getComputedStyle(el).transform), before);
  assert.equal(await page.locator('.surface-glow').count(), 1);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => applyTheme(theme, { persist: false }), theme);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(evidence, `v0210-${theme}.png`) });
  }
  await page.mouse.move(4, 80);
  await page.waitForTimeout(300); assert.equal(await page.locator('.surface-glow').count(), 0);
  await page.evaluate(() => {
    const buttons = ['btnTheme', 'btnRealtime', 'btnPalette', 'btnLexicon', 'btnRefresh'];
    for (let i = 0; i < 40; i++) document.getElementById(buttons[i % buttons.length]).dispatchEvent(new PointerEvent('pointerdown',
      { bubbles: true, button: 0, pointerType: 'mouse', clientX: 600, clientY: 100 }));
  });
  assert.ok(await page.locator('.press-wave').count() <= 4);
  await page.waitForTimeout(600); assert.equal(await page.locator('.press-wave').count(), 0);
  const button = page.locator('#btnRealtime'); await button.focus();
  const active = await button.getAttribute('aria-pressed'); await page.keyboard.press('Enter');
  assert.notEqual(await button.getAttribute('aria-pressed'), active);
  assert.equal(await page.locator('#btnRealtime .press-wave').count(), 1);
  await page.waitForTimeout(600);
  assert.equal(await page.locator('.press-wave, .motion-wave-host').count(), 0);
  // Fault injection: the browser renders the native animation, but its completion
  // promise remains pending. Cleanup must remain bounded without that callback.
  await page.evaluate(() => {
    const original = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = original.apply(this, args);
      if (this.classList.contains('press-wave')) {
        animation.finished.catch(() => {});
        Object.defineProperty(animation, 'finished', { value: new Promise(() => {}) });
      }
      return animation;
    };
    try { document.getElementById('btnRealtime').dispatchEvent(new PointerEvent('pointerdown',
      { bubbles: true, button: 0, pointerType: 'mouse', clientX: 850, clientY: 90 })); }
    finally { Element.prototype.animate = original; }
  });
  assert.equal(await page.locator('#btnRealtime .press-wave').count(), 1);
  await page.waitForTimeout(600);
  assert.equal(await page.locator('.press-wave, .motion-wave-host').count(), 0);
  assert.deepEqual(errors, []);
});

test('v0210 Electron: runtime reduce, hidden cleanup, lite tier and disposal', { timeout: 90000 }, async t => {
  const { page, native, errors } = await open(t);
  await page.locator('#feedList .card').first().hover();
  await page.locator('#btnRealtime').focus(); await page.keyboard.press('Enter');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.documentElement.dataset.fxTier === 'static');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.press-wave, .surface-glow').count(), 0);
  await page.evaluate(() => document.querySelector('.domain-pills button[data-domain="aerospace"]').click());
  await page.waitForTimeout(50);
  assert.ok((await page.evaluate(selectedGeometry, '.domain-pills')).every(delta => delta < 1));
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.selection-indicator, .tab-indicator')].reduce((n, el) => n + el.getAnimations().length, 0)), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => { document.documentElement.dataset.fxTier = 'full'; });
  await page.waitForTimeout(100);
  await page.locator('#feedList .card').first().hover();
  await native(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  await page.waitForFunction(() => document.hidden && !document.hasFocus());
  assert.equal(await page.locator('.press-wave, .surface-glow').count(), 0);
  await native(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus(); win.webContents.focus(); });
  await page.waitForFunction(() => document.hasFocus() && !document.hidden);
  await page.evaluate(() => { document.documentElement.dataset.fxTier = 'lite'; });
  await page.locator('#feedList .card').first().hover(); assert.equal(await page.locator('.surface-glow').count(), 0);
  await page.evaluate(() => interactionMotion.dispose());
  assert.equal(await page.locator('.selection-indicator, .motion-segmented, .press-wave, .surface-glow').count(), 0);
  assert.deepEqual(errors, []);
});

test('v0211 Electron: layered light and magnetic feedback follow input with bounded fading and stable content', { timeout: 90000 }, async t => {
  const { page, errors } = await open(t);
  const card = page.locator('#feedList .card').first();
  await card.hover(); await page.waitForTimeout(350);
  const bounds = await card.boundingBox();
  await page.mouse.move(bounds.x + 60, bounds.y + 18); await page.waitForTimeout(450);
  const initialLightState = await page.evaluate(point => ({ tier: document.documentElement.dataset.fxTier,
    focus: document.hasFocus(), hidden: document.hidden, hit: document.elementFromPoint(point.x, point.y)?.className,
    pointer: motionPointerProbe, card: document.querySelector('#feedList .card').getBoundingClientRect().toJSON()
  }), { x: bounds.x + 60, y: bounds.y + 18 });
  assert.equal(await card.locator('.surface-glow').count(), 1, JSON.stringify(initialLightState));
  const before = await card.evaluate(el => ({
    bounds: el.getBoundingClientRect().toJSON(),
    title: el.querySelector('.card-title')?.getBoundingClientRect().toJSON(),
    transform: el.style.transform,
    glow: getComputedStyle(el.querySelector('.surface-glow')).transform
  }));
  await page.mouse.move(bounds.x + 210, bounds.y + 40);
  await page.waitForTimeout(120);
  const moving = await card.evaluate(el => {
    const core = new DOMMatrixReadOnly(getComputedStyle(el.querySelector('.surface-glow')).transform);
    const halo = new DOMMatrixReadOnly(getComputedStyle(el.querySelector('.surface-halo')).transform);
    const rim = new DOMMatrixReadOnly(getComputedStyle(el.querySelector('.surface-rim-light')).transform);
    return { core: core.m41 + 160, halo: halo.m41 + 220, rim: rim.m41 + 190 };
  });
  assert.ok(moving.core > moving.halo + 5, JSON.stringify(moving));
  assert.ok(Math.abs(moving.core - moving.rim) < .1, JSON.stringify(moving));
  await page.waitForTimeout(500);
  const lightState = await page.evaluate(point => ({ tier: document.documentElement.dataset.fxTier,
    focus: document.hasFocus(), hidden: document.hidden, hit: document.elementFromPoint(point.x, point.y)?.className,
    lights: document.querySelectorAll('.surface-light').length, card: document.querySelector('#feedList .card').getBoundingClientRect().toJSON()
  }), { x: bounds.x + 210, y: bounds.y + 40 });
  assert.equal(await card.locator('.surface-glow').count(), 1, JSON.stringify(lightState));
  const after = await card.evaluate(el => ({
    bounds: el.getBoundingClientRect().toJSON(),
    title: el.querySelector('.card-title')?.getBoundingClientRect().toJSON(),
    transform: el.style.transform,
    glow: getComputedStyle(el.querySelector('.surface-glow')).transform,
    layers: el.querySelectorAll('.surface-glow, .surface-halo, .surface-rim-light').length,
    ignored: el.querySelector('.surface-light').getAttribute('aria-hidden'),
    hit: getComputedStyle(el.querySelector('.surface-light')).pointerEvents
  }));
  assert.deepEqual(after.bounds, before.bounds); assert.deepEqual(after.title, before.title);
  assert.equal(after.transform, before.transform); assert.notEqual(after.glow, before.glow);
  assert.equal(after.layers, 3); assert.equal(after.ignored, 'true'); assert.equal(after.hit, 'none');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => applyTheme(theme, { persist: false }), theme);
    await page.mouse.move(bounds.x + 60, bounds.y + 8); await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(evidence, `v0211-${theme}-light.png`) });
  }
  const button = page.locator('.tab[data-view="hot"]'); await button.hover();
  const buttonBounds = await button.boundingBox();
  const buttonBefore = await button.evaluate(el => el.getBoundingClientRect().toJSON());
  await page.mouse.move(buttonBounds.x + buttonBounds.width - 8, buttonBounds.y + 10);
  await page.waitForTimeout(450);
  const magnet = await button.evaluate(el => {
    const aura = el.querySelector('.control-aura'); const matrix = new DOMMatrixReadOnly(getComputedStyle(aura).transform);
    return { x: matrix.m41, y: matrix.m42, bounds: el.getBoundingClientRect().toJSON(),
      text: el.textContent, ignored: aura.getAttribute('aria-hidden') };
  });
  assert.ok(magnet.x > .5 && magnet.x <= 3.1, JSON.stringify(magnet));
  assert.ok(Math.abs(magnet.y) <= 2.1); assert.deepEqual(magnet.bounds, buttonBefore);
  assert.equal(magnet.ignored, 'true'); assert.equal(magnet.text.trim(), '热点');
  await page.screenshot({ path: path.join(evidence, 'v0211-magnetic.png') });
  // Rapid native pointer movement, including reversal and re-entry into a fading
  // surface, must retain at most two decorations of each kind.
  const tabs = await page.locator('.nav-tabs .tab').evaluateAll(nodes => nodes.map(el => {
    const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }));
  for (let i = 0; i < 24; i++) {
    const point = tabs[i % tabs.length]; await page.mouse.move(point.x, point.y);
    assert.ok(await page.locator('.control-aura').count() <= 2);
    assert.ok(await page.locator('.surface-light').count() <= 2);
  }
  await page.mouse.move(4, 80); await page.waitForTimeout(300);
  assert.equal(await page.locator('.surface-light, .control-aura, .motion-hover-host, .motion-surface').count(), 0);
  assert.deepEqual(errors, []);
});

test('v0211 Electron: decoration scheduling sleeps at rest and clears on scroll, forced colors, reduce and removal', { timeout: 90000 }, async t => {
  const { page, errors } = await open(t);
  const card = page.locator('#feedList .card').first();
  await card.hover();
  await page.waitForFunction(() => document.querySelector('#feedList .card .surface-light')?.style.opacity === '1');
  await page.evaluate(() => {
    window.motionWrites = 0;
    window.motionWriteObserver = new MutationObserver(mutations => { window.motionWrites += mutations.length; });
    document.querySelectorAll('.surface-light, .surface-light span').forEach(el =>
      window.motionWriteObserver.observe(el, { attributes: true, attributeFilter: ['style'] }));
  });
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => motionWrites), 0, 'settled light still writes styles');
  await page.evaluate(() => motionWriteObserver.disconnect());
  // A real delayed RAF callback must use elapsed wall time, without requiring
  // many short virtual steps after the browser resumes rendering.
  await page.evaluate(() => {
    window.originalMotionRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = callback => originalMotionRaf(timestamp => setTimeout(() => callback(performance.now()), 280));
  });
  const bounds = await card.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2 + 130, bounds.y + bounds.height / 2);
  await page.waitForTimeout(500);
  const delayed = await card.evaluate(el => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(el.querySelector('.surface-glow')).transform);
    return { actual: matrix.m41 + 160, target: el.getBoundingClientRect().width / 2 + 130 };
  });
  assert.ok(Math.abs(delayed.actual - delayed.target) < 3, JSON.stringify(delayed));
  await page.evaluate(() => { window.requestAnimationFrame = originalMotionRaf; });
  await card.hover();
  const scrollBefore = await page.locator('#appViewport').evaluate(el => el.scrollTop);
  await page.mouse.wheel(0, 100);
  // Wheel dispatch is asynchronous: observe the real native scroll before
  // checking that its capture listener has cleared the decoration.
  await page.waitForFunction(before => document.getElementById('appViewport').scrollTop > before, scrollBefore);
  assert.equal(await page.locator('.surface-light, .control-aura').count(), 0);
  await card.hover(); await page.emulateMedia({ forcedColors: 'active' });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.surface-light, .control-aura').count(), 0);
  await page.locator('#btnRealtime').hover(); assert.equal(await page.locator('.control-aura').count(), 0);
  await page.emulateMedia({ forcedColors: 'none' });
  await card.hover(); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.surface-light, .control-aura').count(), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => document.documentElement.dataset.fxTier = 'full');
  await page.locator('.tab[data-view="all"]').hover();
  await page.evaluate(() => document.documentElement.dataset.fxTier = 'lite');
  await page.waitForTimeout(100); assert.equal(await page.locator('.surface-light, .control-aura').count(), 0);
  await page.evaluate(() => document.documentElement.dataset.fxTier = 'full');
  await card.hover(); await page.waitForTimeout(600);
  await page.evaluate(() => { window.removedSurface = document.querySelector('#feedList .card'); removedSurface.remove(); });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => removedSurface.querySelector('.surface-light')), null);
  assert.equal(await page.evaluate(() => removedSurface.classList.contains('motion-surface')), false);
  assert.ok(await page.locator('.surface-light').count() <= 1);
  await page.locator('#btnRealtime').hover(); await page.evaluate(() => interactionMotion.dispose());
  assert.equal(await page.locator('.surface-light, .control-aura, .motion-hover-host, .motion-surface').count(), 0);
  assert.deepEqual(errors, []);
});
