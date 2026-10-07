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

test('v0223 原生新闻流按报道时间排序、保留年月精度，设置保存准确的整数分钟', { timeout: 120_000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0223-'));
  fs.writeFileSync(path.join(directory, 'settings.json'), '{}');
  fs.writeFileSync(path.join(directory, 'ui-preferences.json'), JSON.stringify({ version: 2,
    ...Schema.getLegacyUiPreferences(CommonLinks), view: 'all', realtime: false, aquaEnabled: false }));
  const app = await launchNativeElectron(root, directory);
  t.after(async () => { await app.close(); await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const page = await app.firstWindow(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.nav');
  const cdp = await page.context().newCDPSession(page);
  const recent = new Date(Date.now() - 3600e3).toISOString();
  const database = new DatabaseSync(path.join(directory, 'star-picking-pavilion.db'));
  const ids = [];
  try {
    const source = database.prepare("INSERT INTO sources(name,type,url,tier,domain) VALUES('时间核验','rss','https://example.invalid/timing.xml','T1','aerospace')").run().lastInsertRowid;
    const insert = database.prepare(`INSERT INTO articles(source_id,title,url,published_at,fetched_at,event_date,publication_precision,publication_date_text,domain,relevant,analyzed,quality_score)
      VALUES(?,?,?,?,?,?,?,?,'aerospace',1,1,88)`);
    const fetched = new Date().toISOString();
    for (const [key, title, published, event, precision, label] of [
      ['unknown', '商业航天发动机进展：没有发布时间', null, '2020-01-01', null, null],
      ['recent', '商业航天最新报道：发生时间不替代发布时间', recent, '2020-01-01', 'time', null],
      ['old', '星河动力航天完成24亿元D轮融资', '2025-09-29T16:00:00Z', '2026-10-07', 'day', '2025年9月30日'],
      ['month', '商业航天融资月份级报道', '2025-08-31T16:00:00Z', null, 'month', '2025年9月']
    ]) ids.push(Number(insert.run(source, title, `https://example.invalid/${key}`, published, fetched, event, precision, label).lastInsertRowid));
  } finally { database.close(); }
  for (const timezoneId of ['UTC', 'America/Los_Angeles', 'Asia/Shanghai']) {
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId });
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#feedList .card[data-id]').length === 4);
    assert.deepEqual(await page.locator('#feedList .card[data-id]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.id))), ids);
    assert.match(await page.locator(`#feedList .card[data-id="${ids[0]}"] .meta-time`).textContent(), /发布时间未确认/);
    assert.equal(await page.locator(`#feedList .card[data-id="${ids[2]}"] .meta-time`).textContent(), '2025年9月30日发布');
    assert.match(await page.locator('#feedList .dh-label').allTextContents().then(labels => labels.join('|')), /2025年9月30日/, timezoneId);
    assert.match(await page.locator(`#feedList .card[data-id="${ids[3]}"] .meta-time`).textContent(), /2025年9月发布（仅确认月份）/);
    assert.equal(await page.locator(`#feedList .card[data-id="${ids[3]}"]`).locator('..').locator('.tl-time').textContent(), '—');
    const clock = new Date(Date.parse(recent) + 8 * 3600e3).toISOString().slice(11, 16);
    assert.equal(await page.locator(`#feedList .card[data-id="${ids[1]}"]`).locator('..').locator('.tl-time').textContent(), clock, timezoneId);
  }
  await page.locator('[data-view="settings"]').click();
  await page.waitForFunction(() => document.querySelector('#setInterval').value !== '');
  assert.equal(await page.locator('#setInterval').getAttribute('step'), '1');
  for (const minutes of [1, 37, 720]) {
    await page.locator('#setInterval').fill(String(minutes));
    const response = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().method() === 'POST');
    await page.locator('#btnSaveCollect').click();
    assert.equal((await response).status(), 200);
    const saved = JSON.parse(fs.readFileSync(path.join(directory, 'settings.json'), 'utf8'));
    assert.equal(saved.collect.intervalMinutes, minutes);
  }
  const shots = path.join(root, 'work/v0223/screenshots'); fs.mkdirSync(shots, { recursive: true });
  await page.locator('#settingsCollect').evaluate(node => node.scrollIntoView({ block: 'start' }));
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  await page.screenshot({ path: path.join(shots, 'collection-settings.png') });
  await page.locator('[data-view="all"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#feedList .card[data-id]').length === 4 && !document.querySelector('#feedList .skeleton'));
  await page.locator(`#feedList .card[data-id="${ids[3]}"]`).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(shots, 'publication-timeline.png') });
  assert.deepEqual(errors, []);
});
