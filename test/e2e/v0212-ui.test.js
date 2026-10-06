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
const order = ['hot', 'featured', 'all', 'starred', 'daily', 'capital', 'releases', 'links', 'sources', 'settings'];

test('v0212 native navigation, category cancellation, release history and settings chapter index', { timeout: 150_000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0212-ui-'));
  fs.writeFileSync(path.join(directory, 'ui-preferences.json'), JSON.stringify({ version: 2,
    ...Schema.getLegacyUiPreferences(CommonLinks), view: 'all', realtime: false, aquaEnabled: false }));
  const app = await launchNativeElectron(root, directory);
  t.after(async () => { await app.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  await page.waitForSelector('#catChips .chip');
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1440, 920); win.showInactive(); });
  assert.deepEqual(await page.locator('.nav-tabs .tab').evaluateAll(tabs => tabs.map(tab => tab.dataset.view)), order);
  assert.match(await page.locator('[data-view="daily"]').textContent(), /情报日志/);
  const categories = await page.locator('#catChips .chip').evaluateAll(chips => chips.map(chip => chip.dataset.cat));
  assert.equal(categories.length, 7);
  const database = new DatabaseSync(path.join(directory, 'star-picking-pavilion.db'));
  try {
    const source = database.prepare('SELECT id FROM sources ORDER BY id LIMIT 1').get();
    const statement = database.prepare(`INSERT INTO articles (source_id, title, url, summary_raw, published_at, fetched_at, domain, category, relevant, analyzed, quality_score, featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 92, 1)`);
    for (const [i, category] of categories.entries()) for (const domain of ['lowaltitude', 'aerospace']) {
      const title = `导航核验 ${category} ${domain}`, stamp = new Date().toISOString();
      const row = statement.run(source.id, title, `https://example.invalid/nav-${domain}-${i}`, '导航交互验证资料', stamp, stamp, domain, category);
      database.prepare('INSERT INTO articles_fts(rowid, title, summary) VALUES (?, ?, ?)').run(row.lastInsertRowid, title, '导航交互验证资料');
    }
  } finally { database.close(); }
  await page.locator('[data-view="all"]').click();
  await page.locator('.domain-pills [data-domain="lowaltitude"]').click();
  await page.locator('#searchInput').fill('导航核验');
  await page.waitForFunction(() => document.querySelectorAll('#feedList .card').length === 7 && document.getElementById('feedList').getAttribute('aria-busy') === 'false');
  for (const category of categories) {
    const chip = page.locator(`#catChips [data-cat="${category}"]`);
    await chip.click();
    await page.waitForFunction(() => document.querySelectorAll('#feedList .card').length === 1 && document.getElementById('feedList').getAttribute('aria-busy') === 'false');
    assert.equal(await chip.getAttribute('aria-pressed'), 'true');
    await chip.click();
    await page.waitForFunction(() => document.querySelectorAll('#feedList .card').length === 7 && document.getElementById('feedList').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('#catChips [aria-pressed="true"]').count(), 0);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#catChips .selection-indicator')).opacity === '0');
    assert.equal(await page.locator('.domain-pills [data-domain="lowaltitude"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#searchInput').inputValue(), '导航核验');
  }
  const first = page.locator('#catChips .chip').first();
  await first.focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#feedList .card').length === 1);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelectorAll('#feedList .card').length === 7);
  await first.dblclick();
  await page.waitForFunction(() => document.querySelectorAll('#feedList .card').length === 7 && document.querySelectorAll('#catChips .active').length === 0);
  await page.locator('#searchClear').click();

  await page.locator('[data-view="releases"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#releaseList details').length >= 40);
  assert.equal(await page.locator(`[data-release-tag="v${require('../../package.json').version}"]`).getAttribute('open'), '');
  assert.match(await page.locator('[data-release-tag="v0.2.12"]').textContent(), /设置快捷导航/);
  assert.match(await page.locator('[data-release-tag="v0.0.2"]').textContent(), /摘星阁|版本/);
  await page.locator('#releaseSearch').fill('v0.1.0.2');
  assert.equal(await page.locator('#releaseList details').count(), 1);
  await page.locator('#releaseSearch').fill('不存在的版本检索词');
  assert.match(await page.locator('#releaseList').textContent(), /没有找到/);
  await page.locator('#releaseSearch').fill('');
  await page.locator('[data-view="settings"]').click();
  await page.waitForSelector('#modelsSection .models-active');
  const chapters = await page.locator('#settingsNav [data-settings-target]').evaluateAll(links => links.map(link => link.dataset.settingsTarget));
  assert.equal(chapters.length, 9);
  assert.deepEqual(await page.locator('[data-settings-section]').evaluateAll(sections => sections.map(section => section.id)), chapters);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const id of chapters) {
    await page.locator(`#settingsNav [data-settings-target="${id}"]`).click();
    await page.waitForFunction(target => document.querySelector('#settingsNav [aria-current]')?.dataset.settingsTarget === target, id);
    const geometry = await page.evaluate(target => {
      const section = document.getElementById(target).getBoundingClientRect(), nav = document.getElementById('settingsNav').getBoundingClientRect(), viewport = document.getElementById('appViewport').getBoundingClientRect();
      return { top: section.top, bottom: section.bottom, navTop: nav.top, viewportTop: viewport.top, viewportBottom: viewport.bottom };
    }, id);
    assert.ok(geometry.top >= geometry.viewportTop && geometry.top < geometry.viewportBottom, `${id}: heading must be in the reading viewport`);
    assert.ok(geometry.navTop >= geometry.viewportTop, `${id}: shortcut index must stay visible`);
  }
  await page.evaluate(() => document.getElementById('appViewport').scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForFunction(() => document.querySelector('#settingsNav [aria-current]')?.dataset.settingsTarget === 'modelsCard');
  const appearance = page.locator('[data-settings-target="settingsAppearance"]');
  await appearance.focus(); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'heading-settingsAppearance');

  const screenshots = path.join(root, 'work/v0212/screenshots');
  fs.mkdirSync(screenshots, { recursive: true });
  for (const width of [1440, 800]) for (const theme of ['light', 'dark']) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size, 920), width);
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#btnTheme').click();
    await page.locator('[data-settings-target="modelsCard"]').click();
    await page.screenshot({ path: path.join(screenshots, `settings-${width}-${theme}.png`) });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('[data-settings-target="settingsStorage"]').click();
    await page.waitForFunction(() => document.querySelector('#settingsNav [aria-current]')?.dataset.settingsTarget === 'settingsStorage');
    if (width === 800) {
      for (const target of chapters.slice(1)) {
        await page.locator(`[data-settings-target="${target}"]`).click();
        await page.waitForFunction(id => document.querySelector('#settingsNav [aria-current]')?.dataset.settingsTarget === id, target);
        const result = await page.evaluate(id => ({ nav: document.getElementById('settingsNav').getBoundingClientRect().bottom, section: document.getElementById(id).getBoundingClientRect().top }), target);
        assert.ok(result.section >= result.nav - 1, `${target}: horizontal index must not cover the target heading`);
      }
    }
    await page.locator('[data-view="releases"]').click();
    await page.screenshot({ path: path.join(screenshots, `releases-${width}-${theme}.png`) });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('[data-view="settings"]').click();
  }
  await page.locator('[data-view="all"]').click(); await page.locator('#feedList').focus();
  await page.keyboard.press('Alt+7'); await page.waitForSelector('#viewReleases:not([hidden])');
  await page.locator('#releaseList summary').first().focus(); await page.keyboard.press('Alt+0');
  await page.waitForSelector('#viewSettings:not([hidden])');
});
