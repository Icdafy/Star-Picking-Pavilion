'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { launchNativeElectron } = require('./native-electron.cjs');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'work/v0217/motion');

test('v0217 native desktop: theme contrast, spring tracking, semantic reveals, disclosures and lifecycle', { timeout: 120_000 }, async t => {
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0217-motion-'));
  fs.writeFileSync(path.join(profile, 'settings.json'), '{}');
  fs.writeFileSync(path.join(profile, 'ui-preferences.json'), JSON.stringify({ version: 2, view: 'featured', realtime: false, aquaEnabled: false }));
  const seed = spawnSync(process.execPath, ['-e', `
    const {db,closeDatabase}=require('./server/db');
    const source=Number(db.prepare("INSERT INTO sources(name,type,url,tier,domain) VALUES('v0217 隔离样本','rss','https://v0217.example/feed','T1','aerospace')").run().lastInsertRowid);
    const insert=db.prepare('INSERT INTO articles(source_id,title,url,fetched_at,published_at,relevant,featured,analyzed,domain,category,quality_score,ai_summary,scores_json) VALUES(?,?,?,?,?,1,1,1,?,?,88,?,?)');
    for(let i=0;i<16;i++) { const date=new Date(Date.now()-i*60000).toISOString();
      const id=Number(insert.run(source,'航天动效隔离样本 '+i,'https://v0217.example/'+i,date,date,'aerospace','技术研发','虚构样本，仅用于前端动效验证。',JSON.stringify({importance:90,novelty:85,credibility:96,impact:88,timeliness:92})).lastInsertRowid);
      db.prepare('INSERT INTO articles_fts(rowid,title,summary) VALUES(?,?,?)').run(id,'航天动效隔离样本 '+i,'前端动效验证'); }
    closeDatabase();
  `], { cwd: root, env: { ...process.env, STAR_PICKING_PAVILION_DATA_DIR: profile }, encoding: 'utf8' });
  assert.equal(seed.status, 0, seed.stderr);
  const app = await launchNativeElectron(root, profile);
  t.after(async () => { await app.close(); await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const page = await app.firstWindow(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('#feedList .card[data-id]');
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1440, 920); win.setAlwaysOnTop(true);
    win.show(); win.focus(); win.webContents.focus(); win.setIgnoreMouseEvents(true);
  });
  await page.evaluate(async () => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 8 });
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 8 });
    syncFxTier(); await document.fonts.ready; await refreshStats();
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => { document.documentElement.getBoundingClientRect(); return !reducedMotionQuery.matches && document.hasFocus() && document.documentElement.dataset.fxTier === 'full'; });
  await page.waitForFunction(() => !state.loading);
  await page.evaluate(() => {
    window.v0217Pointer = [];
    document.addEventListener('pointermove', event => v0217Pointer.push({ x: event.clientX, y: event.clientY, target: event.target.tagName + '.' + event.target.getAttribute('class') }), { passive: true });
  });
  t.after(async () => {
    if (!page.isClosed()) fs.writeFileSync(path.join(output, 'last-state.json'), JSON.stringify(await page.evaluate(() => ({
      focus: document.hasFocus(), hidden: document.hidden, tier: document.documentElement.dataset.fxTier,
      pointer: window.v0217Pointer, button: document.getElementById('updatePill').outerHTML,
      rect: document.getElementById('updatePill').getBoundingClientRect().toJSON(),
      scroll: document.getElementById('appViewport').scrollTop,
      lights: [...document.querySelectorAll('.surface-light, .control-aura')].map(node => node.outerHTML)
    })).catch(error => ({ error: error.message })), null, 2));
  });

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('update:status', { status: 'available', version: '0.2.19' }));
  await page.waitForSelector('#updatePill:not([hidden])');
  const colors = [];
  for (const theme of ['light', 'dark']) for (const palette of require('../../renderer/aqua-shell').FLUID_PALETTES[theme]) {
    for (const mode of ['mica', 'compat']) for (const scale of ['sm', 'md', 'lg', 'xl']) {
      const measured = await page.evaluate(({ theme, hue, mode, scale }) => {
        applyTheme(theme, { persist: false }); applyTextScale(scale, { persist: false });
        document.documentElement.dataset.aquaMode = mode;
        document.documentElement.style.setProperty('--aqua-user-hue', hue + 'deg');
        const button = document.getElementById('updatePill'), arc = button.querySelector('.update-arc');
        const ctx = document.createElement('canvas').getContext('2d');
        const rgb = value => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3); };
        const luminance = color => rgb(color).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
        const contrast = (a, b) => { const l = [luminance(a), luminance(b)].sort((a, b) => b - a); return (l[0] + .05) / (l[1] + .05); };
        const style = getComputedStyle(button), background = getComputedStyle(document.documentElement).getPropertyValue('--c-bg');
        const stops = [...button.querySelectorAll('#update-blue stop')].map(stop => getComputedStyle(stop).stopColor);
        const disc = button.querySelector('#update-disc');
        const b = button.getBoundingClientRect(), footer = button.closest('.rail-footer').getBoundingClientRect();
        return { color: style.color, stroke: stops.at(-1), size: b.width,
          strokeWidth: parseFloat(getComputedStyle(arc).strokeWidth), labelContrast: contrast(style.color, getComputedStyle(document.documentElement).getPropertyValue('--c-bg')),
          ringContrast: Math.min(...stops.map(stop => contrast(stop, background))), fits: b.left >= footer.left && b.right <= footer.right + 1,
          background, coreBackground: disc.localName + '(' + [...disc.children].map(stop => getComputedStyle(stop).stopColor).join(',') + ')' };
      }, { theme, hue: palette.hue, mode, scale });
      assert.ok(measured.fits && measured.size >= 46 && measured.strokeWidth === 76, JSON.stringify(measured));
      assert.ok(measured.labelContrast >= 4.5 && measured.ringContrast >= 3, `${theme}/${palette.id}/${mode}/${scale}: ${JSON.stringify(measured)}`);
      assert.notEqual(measured.coreBackground, 'none');
      colors.push({ theme, palette: palette.id, mode, scale, ...measured });
    }
    await page.evaluate(() => applyTextScale('md', { persist: false }));
    await page.screenshot({ path: path.join(output, `${theme}-${palette.id}.png`) });
  }
  fs.writeFileSync(path.join(output, 'theme-contrast.json'), JSON.stringify(colors, null, 2));
  await page.evaluate(() => { applyTheme('dark', { persist: false }); applyTextScale('md', { persist: false }); document.getElementById('appViewport').scrollTop = 0; });
  await page.waitForTimeout(300); // 等待缩放矩阵产生的滚动事件完成，随后才采样跟手。
  await page.mouse.move(4, 10);
  const update = page.locator('#updatePill'), bounds = await update.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .8, bounds.y + bounds.height * .3);
  await page.waitForTimeout(130);
  const tracking = await update.locator('.update-art').evaluate(node => ({ translate: node.style.translate, focus: document.hasFocus(), tier: document.documentElement.dataset.fxTier,
    light: node.parentElement.querySelector('.control-aura')?.outerHTML, pointer: window.v0217Pointer.slice(-4) }));
  assert.ok(parseFloat(tracking.translate) > 0, 'supplied update art follows the pointer: ' + JSON.stringify(tracking));
  const fixed = await update.boundingBox();
  assert.ok(Math.abs(bounds.x - fixed.x) + Math.abs(bounds.y - fixed.y) < .5, 'hit region stays stationary');
  await page.mouse.move(4, 10);
  await page.waitForTimeout(700);
  assert.equal(await update.locator('.update-art').evaluate(node => node.style.translate), '');
  assert.equal(await page.locator('.surface-light, .control-aura').count(), 0);

  await page.evaluate(() => document.querySelector('.tab[data-view="all"]').click());
  const textMotion = await page.locator('#feedHeroTitle').evaluate(node => ({ text: node.textContent, children: node.childElementCount,
    running: node.getAnimations().some(animation => animation.effect.getKeyframes().some(frame => frame.transform?.includes('translateY'))) }));
  assert.ok(textMotion.running); assert.equal(textMotion.children, 0, 'Chinese copy is not split into letters');
  await page.waitForFunction(() => !state.loading);
  await page.waitForTimeout(600);
  const header = page.locator('#feedHero'), hb = await header.boundingBox();
  await page.mouse.move(hb.x + hb.width * .85, hb.y + hb.height * .6);
  await page.waitForTimeout(180);
  assert.ok(await header.locator('.banner-art').evaluate(node => parseFloat(node.style.translate) > 0), 'orbit art has spring parallax');
  await page.mouse.move(4, 10); await page.waitForTimeout(500);

  const card = page.locator('#feedList .card').first();
  await card.locator('.dims-toggle').click();
  assert.equal(await card.locator('.dims-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(await card.locator('.dims').isVisible(), true);
  assert.ok(await card.locator('.dim-bar i').first().evaluate(node => node.getAnimations().some(animation => animation.effect.getKeyframes()[0].transform === 'scaleX(0)')));
  await card.locator('.dims-toggle').click(); await card.locator('.dims-toggle').click();
  await page.waitForTimeout(700);
  assert.equal(await card.locator('.dims-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(await card.locator('.dims').evaluate(node => node.style.clipPath), '');
  await page.evaluate(() => document.querySelector('.tab[data-view="releases"]').click());
  await page.waitForSelector('.release-entry');
  const entry = page.locator('.release-entry').first();
  const summary = entry.locator('summary');
  await summary.focus(); await page.keyboard.press('Enter');
  assert.equal(await entry.evaluate(node => node.open), false);
  await page.keyboard.press('Enter'); assert.equal(await entry.evaluate(node => node.open), true);
  await page.waitForTimeout(600);
  assert.equal(await entry.locator('.release-body').evaluate(node => node.style.clipPath), '');

  await page.keyboard.press('Control+k'); await page.waitForSelector('#commandPalette[open]');
  assert.equal(await page.locator('#paletteInput').evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('commandPalette').open);
  await page.evaluate(() => document.querySelector('.tab[data-view="daily"]').click());
  await page.waitForFunction(() => !state.loading);
  // Native popover behavior is exercised directly; export availability is unrelated to motion.
  await page.locator('#dailyExportMenu').evaluate(node => node.showPopover());
  assert.equal(await page.locator('#dailyExportMenu').isVisible(), true);
  await page.keyboard.press('Escape'); await page.waitForTimeout(350);
  assert.equal(await page.locator('#dailyExportMenu').isVisible(), false);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => { document.documentElement.getBoundingClientRect(); return reducedMotionQuery.matches && document.documentElement.dataset.fxTier === 'static'; });
  await page.evaluate(() => document.querySelector('.tab[data-view="settings"]').click());
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#viewSettings [data-banner-reveal]').first().evaluate(node => node.getAnimations().length), 0);
  assert.equal(await page.locator('.surface-light, .control-aura, .press-wave').count(), 0);
  assert.equal(await page.locator('#updatePill .update-art').evaluate(node => node.style.translate), '');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => { document.documentElement.getBoundingClientRect(); return !reducedMotionQuery.matches && document.documentElement.dataset.fxTier === 'full'; });
  await page.evaluate(() => document.getElementById('appViewport').scrollTo({ top: 1600, behavior: 'instant' }));
  await page.waitForTimeout(700);
  assert.ok(await page.locator('[data-settings-section]').evaluateAll(nodes => nodes.every(node => !node.style.opacity && !node.style.transform)), 'chapter reveals leave no inline layer locks');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.surface-light, .control-aura, .press-wave').count(), 0);
  assert.deepEqual(errors, []);
  console.log(`v0217: ${colors.length} palette/material/scale contrast checks; native pointer, text, graph, disclosure, popover, keyboard and lifecycle passed`);
});
