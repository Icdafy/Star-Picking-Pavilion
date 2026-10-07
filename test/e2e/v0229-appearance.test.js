'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launchNativeElectron } = require('./native-electron.cjs');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'work/v0229');

async function launch(t) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0229-'));
  fs.writeFileSync(path.join(profile, 'ui-preferences.json'), JSON.stringify({
    version: 2, view: 'settings', theme: 'light', realtime: false,
    aquaEnabled: false, pointerEnabled: false
  }));
  const app = await launchNativeElectron(root, profile);
  t.after(async () => {
    await app.close();
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  await page.waitForFunction(() => document.documentElement.dataset.aquaEnabled != null);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000));
  fs.mkdirSync(output, { recursive: true });
  return { app, page };
}

test('v0.2.29 settings cards share the ordinary glass surface without a corner halo', { timeout: 60000 }, async t => {
  const { page } = await launch(t);
  const results = [];
  const setEffects = async enabled => {
    const button = page.locator('#setAquaEnabled');
    if (await button.getAttribute('aria-pressed') !== String(enabled)) await button.click();
  };
  for (const theme of ['light', 'dark']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#btnTheme').click();
    for (const effects of [false, true]) {
      await setEffects(effects);
      for (const scale of ['sm', 'md', 'lg', 'xl']) {
        await page.locator(`[data-text-scale="${scale}"]`).click();
        await page.mouse.move(1, 1);
        const surfaces = await page.evaluate(() => {
          const style = id => {
            const node = document.getElementById(id), css = getComputedStyle(node), before = getComputedStyle(node, '::before');
            return { background: css.background, border: css.borderColor, backdrop: css.backdropFilter,
              before: { background: before.background, height: before.height, top: before.top,
                shadow: before.boxShadow, border: before.borderWidth, opacity: before.opacity } };
          };
          return Object.fromEntries(['settingsCollect', 'settingsArchive', 'settingsStorage'].map(id => [id, style(id)]));
        });
        for (const id of ['settingsArchive', 'settingsStorage']) {
          assert.deepEqual(surfaces[id], surfaces.settingsCollect, `${theme}/${effects}/${scale}/${id}: different glass surface`);
          assert.equal(surfaces[id].before.shadow, 'none', `${id}: decorative rings remain`);
          assert.ok(parseFloat(surfaces[id].before.height) <= 2, `${id}: large corner highlight remains`);
        }
        results.push({ theme, effects, scale, surfaces });
      }
    }
    await setEffects(false);
    await page.locator('[data-text-scale="md"]').click();
    for (const id of ['settingsStorage', 'settingsArchive']) {
      await page.locator(`[data-settings-target="${id}"]`).click();
      await page.locator('#' + id).scrollIntoViewIfNeeded();
      await page.mouse.move(1, 1);
      await page.locator('#' + id).screenshot({ path: path.join(output, `${theme}-${id}.png`) });
    }
  }
  fs.writeFileSync(path.join(output, 'card-surfaces.json'), JSON.stringify(results, null, 2));
});

test('v0.2.29 actual Windows fonts cover every view, native controls, code and both recovery pages', { timeout: 90000 }, async t => {
  const { page } = await launch(t);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const platformFonts = async selector => {
    const { root: document } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: document.nodeId, selector });
    assert.ok(nodeId, `missing font sample ${selector}`);
    const all = new Map();
    const visit = async node => {
      if (node.nodeType === 1 && node.nodeId) {
        const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId });
        for (const font of fonts) all.set(font.postScriptName, font);
      }
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) await visit(child);
    };
    const find = node => {
      if (node.nodeId === nodeId) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
        const result = find(child); if (result) return result;
      }
    };
    await visit(find(document));
    return [...all.values()].filter(font => font.glyphCount > 0);
  };
  const assertRoman = (fonts, label) => {
    assert.ok(fonts.length, `${label}: no rendered glyphs`);
    assert.ok(fonts.every(font => font.familyName === 'Times New Roman'), `${label}: ${JSON.stringify(fonts)}`);
  };
  const evidence = { views: [], glyphs: {}, recovery: {} };
  const views = await page.locator('.tab[data-view]').evaluateAll(tabs => tabs.map(tab => tab.dataset.view));
  assert.equal(views.length, 10);
  for (const view of views) {
    await page.locator(`.tab[data-view="${view}"]`).click();
    await page.evaluate(() => document.fonts.ready);
    const mismatches = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(node => {
      if (!node.getClientRects().length || /^(SCRIPT|STYLE)$/.test(node.tagName)) return false;
      return [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && /[A-Za-z0-9+%()[\]/:;=]/.test(child.textContent))
        || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(node.tagName);
    }).filter(node => !getComputedStyle(node).fontFamily.startsWith('"Times New Roman"')).map(node => ({
      tag: node.tagName, id: node.id, family: getComputedStyle(node).fontFamily, text: node.textContent.slice(0, 60)
    })));
    assert.deepEqual(mismatches, [], `${view}: some displayed text uses another font`);
    evidence.views.push(view);
  }
  await page.locator('.tab[data-view="settings"]').click();
  await page.evaluate(() => {
    const box = document.createElement('div'); box.id = 'font-regression';
    const cases = {
      western: 'ABC abc eVTOL JSONL', digits: '0123456789 08:00 300.0 MB 1%',
      symbols: '+ - / . : ; ( ) [ ] { } % & @ # ! ? = < > ± × ÷ ≤ ≥ √ ∞ ← → ↑ ↓ · … — – − •',
      bold: 'ABC 180 MB ± →', italic: 'ABC 180 MB ± →', chinese: '中文汉字',
      code: 'JSONL 180 + 1%', pre: 'version: 0.2.29', kbd: 'Ctrl + 0', samp: '300.0 MB',
      button: 'ABC 180 + 1%', select: 'ABC 180 + 1%', textarea: 'ABC 180 + 1%',
      text: 'ABC 180 + 1%', number: '180', date: '2026-10-07'
    };
    for (const [id, value] of Object.entries(cases)) {
      const tag = ['code', 'pre', 'kbd', 'samp', 'button', 'select', 'textarea'].includes(id) ? id
        : ['text', 'number', 'date'].includes(id) ? 'input' : 'span';
      const node = document.createElement(tag); node.id = 'font-' + id;
      if (tag === 'input') { node.type = id; node.value = value; }
      else if (tag === 'select') { const option = document.createElement('option'); option.textContent = value; node.append(option); }
      else node.textContent = value;
      if (id === 'bold') node.style.fontWeight = '700';
      if (id === 'italic') node.style.fontStyle = 'italic';
      box.append(node, document.createElement('br'));
    }
    document.getElementById('settingsDisplay').append(box);
  });
  await page.locator('#font-regression').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  for (const id of ['western', 'digits', 'symbols', 'bold', 'italic', 'code', 'pre', 'kbd', 'samp', 'button', 'select', 'textarea', 'text', 'number', 'date']) {
    const fonts = await platformFonts('#font-' + id);
    assertRoman(fonts, id); evidence.glyphs[id] = fonts;
  }
  const chinese = await platformFonts('#font-chinese');
  assert.ok(chinese.length && chinese.every(font => font.isCustomFont && /Noto|Source Han/.test(font.familyName)), 'Chinese must retain bundled Source Han Sans');
  evidence.glyphs.chinese = chinese;
  const origin = page.url();
  for (const file of ['failure.html', 'startup-failure.html']) {
    // Startup failure must also load without the HTTP backend.
    await page.goto(file === 'startup-failure.html' ? pathToFileURL(path.join(root, 'renderer', file)).href : new URL(file, origin).href);
    await page.evaluate(() => document.fonts.ready);
    const fonts = await platformFonts('.eyebrow'); assertRoman(fonts, file);
    evidence.recovery[file] = fonts;
    const failures = await page.locator('link[rel="stylesheet"]').evaluateAll(links => links.filter(link => !link.sheet).map(link => link.href));
    assert.deepEqual(failures, [], `${file}: local stylesheet failed to load`);
  }
  fs.writeFileSync(path.join(output, 'rendered-fonts.json'), JSON.stringify(evidence, null, 2));
});
