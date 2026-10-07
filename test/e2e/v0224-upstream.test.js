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

test('v0224 原生界面保留纯文本型号，未知模型显示文本模式且图片未勾选', { timeout: 120_000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0224-ui-'));
  fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ ai: {
    activeProvider: 'local-check', model: 'unknown-input', providers: {
      'local-check': { declared: true, baseUrl: 'http://127.0.0.1:19999/v1', models: [{ id: 'unknown-input', name: '未声明图片模型' }] }
    }
  } }));
  fs.writeFileSync(path.join(directory, 'ui-preferences.json'), JSON.stringify({ version: 2,
    ...Schema.getLegacyUiPreferences(CommonLinks), view: 'all', realtime: false, aquaEnabled: false }));
  const app = await launchNativeElectron(root, directory);
  t.after(async () => { await app.close(); await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.nav');
  const database = new DatabaseSync(path.join(directory, 'star-picking-pavilion.db'));
  let articleId;
  try {
    const sourceId = database.prepare("INSERT INTO sources(name,type,url,tier,domain) VALUES('Atom 原文','rss','https://example.invalid/atom.xml','T1','aerospace')").run().lastInsertRowid;
    articleId = Number(database.prepare(`INSERT INTO articles(source_id,title,url,summary_raw,ai_summary,published_at,fetched_at,domain,relevant,analyzed,clean_version,quality_score)
      VALUES(?,?,?,?,?,?,?,'aerospace',1,3,2,88)`).run(sourceId, '商业航天 <型号> 完成首飞', 'https://example.invalid/plain',
      '原文保留 <model> 与 &amp; 字面值', '原文保留 <model> 与 &amp; 字面值', new Date().toISOString(), new Date().toISOString()).lastInsertRowid);
  } finally { database.close(); }
  await page.reload();
  await page.waitForSelector(`#feedList .card[data-id="${articleId}"]`);
  const card = page.locator(`#feedList .card[data-id="${articleId}"]`);
  assert.match(await card.textContent(), /商业航天 <型号> 完成首飞/);
  assert.match(await card.textContent(), /<model> 与 &amp; 字面值/);
  assert.equal(await card.locator('型号,model').count(), 0);
  const shots = path.join(root, 'work/v0224/screenshots');
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, 'plain-news.png') });
  await page.locator('[data-view="settings"]').click();
  await page.waitForSelector('#modelsActiveSelect');
  assert.match(await page.locator('.models-active-copy small').textContent(), /仅文本（跳过图片理解）/);
  const provider = page.locator('[data-models-act="edit"][data-provider="local-check"]');
  await provider.click();
  const editor = page.locator('.model-row[data-provider="local-check"] .model-editor');
  await editor.waitFor({ state: 'visible' });
  await editor.scrollIntoViewIfNeeded();
  await editor.locator('details.models-customized > summary').click();
  const rowToggle = editor.locator('[data-models-act="toggle-row"]').first();
  await rowToggle.click();
  const checkbox = editor.locator('input[data-models-field="image"]').first();
  assert.equal(await checkbox.isChecked(), false);
  assert.match(await checkbox.locator('..').locator('..').textContent(), /未声明：仅发送文本/);
  await checkbox.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(shots, 'model-input.png') });
  assert.deepEqual(errors, []);
});
