'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron: electron } = require('playwright');

test('external source creation and import are usable in the real Electron UI', { timeout: 90000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-ingest-ui-'));
  fs.copyFileSync(path.join(__dirname, 'fixtures/empty-settings.json'), path.join(dir, 'settings.json'));
  const app = await electron.launch({ args: ['.', '--hidden'], cwd: path.join(__dirname, '../..'), env: { ...process.env,
    STAR_PICKING_PAVILION_TEST_DATA_DIR: dir, STAR_PICKING_PAVILION_NO_SCHEDULER: '1', STAR_PICKING_PAVILION_DISABLE_AUTO_UPDATE: '1' } });
  t.after(async () => { await app.close().catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }); });
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  await page.locator('[data-view="sources"]').click();
  await page.locator('#btnAddSource').click();
  await page.locator('#srcForm [name="name"]').fill('试验外部源');
  await page.locator('#srcForm [name="type"]').selectOption('external');
  await page.locator('#srcForm [name="url"]').fill('external://browser-test');
  await page.locator('#srcForm button[value="ok"]').click();
  const card = page.locator('.src-card').filter({ hasText: '试验外部源' });
  await card.locator('[data-act="import"]').click();
  await page.locator('#ingestForm textarea').fill('invalid JSON');
  await page.locator('#ingestForm button[value="ok"]').click();
  await page.waitForFunction(() => document.querySelector('#ingestResult').textContent.includes('有效的 JSON'));
  assert.equal(await page.locator('#ingestDialog').isVisible(), true);
  await page.locator('#ingestForm textarea').fill(JSON.stringify([{ title: '试验航天企业融资', url: 'https://example.org/ui-import' }]));
  await page.locator('#ingestForm [name="backfill"]').check();
  await page.locator('#ingestForm button[value="ok"]').click();
  await page.waitForFunction(() => document.querySelector('#ingestResult').textContent.includes('新增 1 条'));
  await page.locator('#ingestForm button[value="ok"]').click();
  await page.waitForFunction(() => document.querySelector('#ingestResult').textContent.includes('重复 1 条'));
  await page.locator('#ingestForm button[value="ok"]').waitFor({ state: 'visible' });
  for (const width of [800, 1440]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 920), width);
    // Electron 的窗口 IPC 返回时，渲染进程的 resize 事件可能尚未生效。
    await page.waitForFunction(width => innerWidth === width && innerHeight === 920, width);
    // 模态框相对可视区居中；信源列表较长时页面有纵向滚动条，可视宽度 = clientWidth（不含滚动条）。
    // 滚动条可能在信源列表异步渲染完之后才出现，所以对话框位置与可视宽度必须在同一帧里量，
    // 并等到两者一致（慢速运行器上分两次量会差出半个滚动条宽）。
    await page.waitForFunction(() => {
      const rect = document.querySelector('#ingestDialog').getBoundingClientRect();
      return Math.abs(rect.left + rect.width / 2 - document.documentElement.clientWidth / 2) < 2;
    }).catch(() => {});
    const { bounds, visible } = await page.evaluate(() => {
      const rect = document.querySelector('#ingestDialog').getBoundingClientRect();
      return { bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, visible: document.documentElement.clientWidth };
    });
    assert.ok(visible <= width && visible >= width - 24, `visible width ${visible} within ${width}`);
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - visible / 2) < 2, `dialog stays centered in ${width}px: ${JSON.stringify(bounds)}`);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 920, 'dialog stays in viewport');
  }
  if (process.env.SPP_LAYOUT_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SPP_LAYOUT_SCREENSHOT_DIR, 'external-ingest.png') });
  await page.locator('#ingestForm button[value="cancel"]').click();
  await card.locator('[data-act="toggle"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.src-card')].find(e => e.textContent.includes('试验外部源'))?.querySelector('[data-act="import"]')?.disabled);
});
