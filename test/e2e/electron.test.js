'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { _electron: electron } = require('playwright');

const projectRoot = path.join(__dirname, '..', '..');
const mainSource = fs.readFileSync(path.join(projectRoot, 'electron', 'main.js'), 'utf8');

async function waitForExit(child, timeoutMs = 10_000) {
  let timer;
  try {
    return await Promise.race([
      once(child, 'exit'),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('second Electron instance did not exit')), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test('real Electron desktop flow is secure, persistent and single-instance', { timeout: 60_000 }, async t => {
  assert.match(mainSource, /STAR_PICKING_PAVILION_TEST_DATA_DIR/);

  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-electron-e2e-'));
  await fs.promises.copyFile(
    path.join(__dirname, 'fixtures', 'empty-settings.json'),
    path.join(dataDir, 'settings.json')
  );
  const env = {
    ...process.env,
    STAR_PICKING_PAVILION_TEST_DATA_DIR: dataDir,
    STAR_PICKING_PAVILION_NO_SCHEDULER: '1',
    STAR_PICKING_PAVILION_DISABLE_AUTO_UPDATE: '1'
  };

  let electronApp;
  t.after(async () => {
    if (electronApp) await electronApp.close().catch(() => {});
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  });

  electronApp = await electron.launch({ args: ['.'], cwd: projectRoot, env });
  const page = await electronApp.firstWindow();
  await page.waitForSelector('#feedList');

  assert.equal(await page.title(), '摘星阁 · 低空经济与商业航天情报站');
  const origin = await page.evaluate(() => location.origin);
  const localUrl = new URL(origin);
  assert.equal(localUrl.hostname, '127.0.0.1');
  assert.notEqual(Number(localUrl.port), 7644);
  assert.ok(Number(localUrl.port) > 0);
  assert.equal(await electronApp.evaluate(({ app }) => app.getPath('userData')), dataDir);

  const unauthenticated = await fetch(`${origin}/api/stats`);
  assert.equal(unauthenticated.status, 403);

  await page.locator('.tab[data-view="links"]').click();
  assert.equal(await page.locator('.common-links-card').count(), 14);

  const category = page.locator('.common-links-category').nth(1);
  const expectedKey = await category.getAttribute('data-focus-key');
  await category.focus();
  await category.click();
  assert.equal(
    await page.evaluate(() => document.activeElement?.dataset.focusKey),
    expectedKey
  );

  const favorite = page.locator('button[data-link-favorite]').first();
  const favoriteId = await favorite.getAttribute('data-link-favorite');
  const priorFavoriteState = await favorite.getAttribute('aria-pressed');
  await favorite.click();
  const expectedFavoriteState = priorFavoriteState === 'true' ? 'false' : 'true';
  assert.equal(await page.locator(`button[data-link-favorite="${favoriteId}"]`).getAttribute('aria-pressed'), expectedFavoriteState);

  await page.reload();
  await page.locator('.tab[data-view="links"]').click();
  assert.equal(
    await page.locator(`button[data-link-favorite="${favoriteId}"]`).getAttribute('aria-pressed'),
    expectedFavoriteState
  );

  await page.evaluate(() => {
    window.__sppJavascriptExecuted = false;
    const link = document.createElement('a');
    link.id = 'unsafe-e2e-link';
    link.href = 'javascript:window.__sppJavascriptExecuted=true';
    link.target = '_blank';
    link.textContent = 'unsafe';
    document.body.append(link);
  });
  await page.locator('#unsafe-e2e-link').click();
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__sppJavascriptExecuted), false);
  assert.equal(electronApp.windows().length, 1);

  const second = spawn(require('electron'), ['.'], {
    cwd: projectRoot,
    env,
    stdio: 'ignore',
    windowsHide: true
  });
  const [exitCode] = await waitForExit(second);
  assert.equal(exitCode, 0);
  assert.equal(electronApp.windows().length, 1);
});
