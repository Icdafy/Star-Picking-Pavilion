'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { launchNativeElectron } = require('./native-electron.cjs');
const Schema = require('../../renderer/ui-preference-schema');
const CommonLinks = require('../../renderer/common-links');
const root = path.join(__dirname, '../..');

test('v0221 native source controls, network waiting and Chinese overseas news', { timeout: 120_000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0221-sources-'));
  fs.writeFileSync(path.join(directory, 'settings.json'), '{}');
  fs.writeFileSync(path.join(directory, 'ui-preferences.json'), JSON.stringify({ version: 2,
    ...Schema.getLegacyUiPreferences(CommonLinks), view: 'all', realtime: false, aquaEnabled: false }));
  const app = await launchNativeElectron(root, directory);
  t.after(async () => { await app.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1440, 920); win.showInactive(); });
  await page.locator('[data-view="sources"]').click();
  await page.waitForSelector('.src-card');
  assert.match(await page.locator('#sourceNetworkStatus').textContent(), /外网尚未检测.*配置分析模型/);
  assert.match(await page.locator('#sourcesSummary').textContent(), /201.*个信源/);
  await page.locator('#btnAddSource').click();
  await page.locator('#srcForm [name="name"]').fill('海外桌面核验');
  await page.locator('#srcForm [name="url"]').fill('https://example.invalid/overseas.xml');
  await page.locator('#srcForm [name="domain"]').selectOption('aerospace');
  await page.locator('#srcForm [name="intl"]').check();
  await page.locator('#srcForm [value="ok"]').click();
  await page.waitForSelector('#srcDialog:not([open])', { state: 'attached' });
  await page.locator('#sourcesSearch').fill('海外桌面核验');
  const card = page.locator('.src-card').filter({ hasText: '海外桌面核验' });
  await card.waitFor();
  assert.match(await card.textContent(), /等待外网/);
  assert.equal(await card.locator('.src-status.err').count(), 0);
  await card.locator('[data-act="toggle"]').click();
  await card.locator('[data-act="toggle"]').filter({ hasText: '启用' }).waitFor();
  await card.locator('[data-act="toggle"]').click();
  await card.locator('[data-act="toggle"]').filter({ hasText: '停用' }).waitFor();

  const database = new DatabaseSync(path.join(directory, 'star-picking-pavilion.db'));
  try {
    const source = database.prepare('SELECT id,intl FROM sources WHERE name=?').get('海外桌面核验');
    assert.equal(source.intl, 1, 'toggle must retain the international flag');
    const stamp = new Date().toISOString();
    const insert = database.prepare(`INSERT INTO articles(source_id,title,url,summary_raw,published_at,fetched_at,
      domain,category,relevant,analyzed,quality_score,translation_status,translation_json,starred,starred_at)
      VALUES(?,?,?,?,?,?,'aerospace','发射与任务',1,1,85,?,?,?,?)`);
    insert.run(source.id, 'SpaceX completes rocket flight test', 'https://example.invalid/translated',
      'SpaceX completed a rocket flight test.', stamp, stamp, 'translated',
      JSON.stringify({ titleZh: 'SpaceX完成火箭飞行试验', summaryZh: 'SpaceX完成了一次火箭飞行试验。', names: [] }), 0, null);
    insert.run(source.id, 'Rocket Lab prepares new launch mission', 'https://example.invalid/pending',
      'Rocket Lab prepares a new launch mission.', stamp, stamp, 'pending', null, 1, stamp);
  } finally { database.close(); }
  await page.locator('[data-view="all"]').click();
  await page.waitForSelector('#feedList .card-title');
  assert.equal(await page.locator('#feedList .card-title').count(), 1);
  assert.equal(await page.locator('#feedList .card-title').textContent(), 'SpaceX完成火箭飞行试验');
  assert.match(await page.locator('#feedList .card-summary').textContent(), /SpaceX完成了一次火箭飞行试验/);
  await page.locator('[data-view="starred"]').click();
  await page.waitForFunction(() => document.querySelector('#feedList .card-title')?.textContent === '海外新闻待翻译');
  assert.match(await page.locator('#feedList .card-summary').textContent(), /原文已保存/);
  assert.doesNotMatch(await page.locator('#feedList').textContent(), /prepares new launch/);
  await page.locator('[data-view="sources"]').click();
  await card.waitFor();
  assert.match(await card.textContent(), /待翻译 1 条/);
  await page.locator('#sourcesStatus [data-source-status="wait"]').click();
  assert.equal(await card.count(), 1);
  const screenshots = process.env.SPP_LAYOUT_SCREENSHOT_DIR || path.join(root, 'work/v0221/screenshots');
  fs.mkdirSync(screenshots, { recursive: true });
  for (const width of [1440, 800]) for (const theme of ['light', 'dark']) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size, 920), width);
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#btnTheme').click();
    await page.screenshot({ path: path.join(screenshots, `sources-${width}-${theme}.png`) });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.locator('#btnDetectNetwork').isVisible());
  }
});
