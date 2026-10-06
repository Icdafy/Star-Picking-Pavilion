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

test('v0222 native pagination survives offline failure and retries every unread page', { timeout: 120_000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0222-pages-'));
  fs.writeFileSync(path.join(directory, 'settings.json'), '{}');
  fs.writeFileSync(path.join(directory, 'ui-preferences.json'), JSON.stringify({ version: 2,
    ...Schema.getLegacyUiPreferences(CommonLinks), view: 'all', realtime: false, aquaEnabled: false }));
  const app = await launchNativeElectron(root, directory);
  t.after(async () => { await app.close(); await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.nav');
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1440, 920); win.showInactive();
  });
  const database = new DatabaseSync(path.join(directory, 'star-picking-pavilion.db'));
  try {
    const source = database.prepare("INSERT INTO sources(name,type,url,tier,domain) VALUES('分页核验','rss','https://example.invalid/pages.xml','T2','aerospace')").run().lastInsertRowid;
    const insert = database.prepare(`INSERT INTO articles(source_id,title,url,published_at,fetched_at,domain,relevant,analyzed,quality_score)
      VALUES(?,?,?,?,?,'aerospace',1,1,80)`);
    const now = Date.now();
    database.exec('BEGIN');
    for (let i = 0; i < 65; i++) {
      const stamp = new Date(now - i * 60000).toISOString();
      insert.run(source, `商业航天分页核验：第${i + 1}条火箭试验进展`, `https://example.invalid/page-item/${i}`, stamp, stamp);
    }
    database.exec('COMMIT');
  } finally { database.close(); }
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#feedList .card[data-id]').length === 30);
  const first = await page.locator('#feedList .card[data-id]').evaluateAll(nodes => nodes.map(n => n.dataset.id));
  await page.context().setOffline(true);
  await page.locator('#btnMore').click();
  await page.waitForFunction(() => document.querySelector('#btnMore').textContent.includes('重试') && !document.querySelector('#btnMore').disabled);
  assert.equal(await page.locator('#feedList .card[data-id]').count(), 30);
  assert.deepEqual(await page.locator('#feedList .card[data-id]').evaluateAll(nodes => nodes.map(n => n.dataset.id)), first);
  assert.match(await page.locator('#feedToolbarNote').textContent(), /已有内容保留/);
  assert.ok(await page.locator('#btnCopyFeed').isEnabled());
  await page.context().setOffline(false);
  await page.locator('#btnMore').click();
  await page.waitForFunction(() => document.querySelectorAll('#feedList .card[data-id]').length >= 60);
  // 成功后自动预取可能先读完最后一页并隐藏按钮；滚到末尾验证真实预取，
  // 不把“先检查数量，再点击已消失按钮”的测试竞态当作产品故障。
  await page.locator('#feedSentinel').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelectorAll('#feedList .card[data-id]').length === 65);
  const all = await page.locator('#feedList .card[data-id]').evaluateAll(nodes => nodes.map(n => n.dataset.id));
  assert.equal(new Set(all).size, 65, '全部未读页面只能各出现一次');
  assert.deepEqual(all.slice(0, 30), first);
  assert.ok(await page.locator('#btnMore').isHidden());
  assert.deepEqual(errors, []);
  const screenshots = process.env.SPP_LAYOUT_SCREENSHOT_DIR || path.join(root, 'work/v0222/screenshots');
  fs.mkdirSync(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, 'pagination-recovered.png') });
});
