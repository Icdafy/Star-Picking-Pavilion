'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { launchNativeElectron } = require('./native-electron.cjs');
const { readWord } = require('../helpers/read-word.cjs');
const { localDateString } = require('../../renderer/format-utils');
const root = path.join(__dirname, '../..');
const output = path.join(root, 'work/v0215/native-exports');

test('journal preserves its banner and supports native copy, file menus, downloads and regeneration for every period', { timeout: 100_000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0215-journal-'));
  fs.writeFileSync(path.join(directory, 'settings.json'), '{}');
  fs.writeFileSync(path.join(directory, 'ui-preferences.json'), JSON.stringify({ version: 2, view: 'featured', realtime: false, aquaEnabled: false }));
  const app = await launchNativeElectron(root, directory);
  t.after(async () => {
    await app.close();
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  await page.waitForSelector('#catChips .chip');
  const now = new Date(), date = localDateString(now);
  const thursday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  thursday.setDate(thursday.getDate() + 4 - (thursday.getDay() || 7));
  const week = Math.ceil((((thursday - new Date(thursday.getFullYear(), 0, 1)) / 86400000) + 1) / 7);
  const keys = { daily: date, weekly: `${thursday.getFullYear()}-W${String(week).padStart(2, '0')}`, monthly: date.slice(0, 7) };
  const names = { daily: '日报', weekly: '周报', monthly: '月报' };
  const db = new DatabaseSync(path.join(directory, 'star-picking-pavilion.db'));
  try {
    for (const kind of ['daily', 'weekly', 'monthly']) {
      const report = { kind, key: keys[kind], date: kind === 'daily' ? date : undefined,
        label: kind === 'weekly' ? `${thursday.getFullYear()} 年第 ${week} 周（10-05 至 10-11）` : `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`,
        finished: false, windowVersion: 3, edition: 2, generatedAt: now.toISOString(), total: 1, totals: { featured: 1, stories: 0, deals: 0 },
        byDomain: { lowaltitude: 1, aerospace: 0 }, lead: `${names[kind]}本期完整导语`,
        sections: [{ category: '技术研发', items: [{ title: `${names[kind]}样本标题 🚀`, summary: '验收样本摘要', source: '官方样本信源', url: 'https://example.com/report', domain: 'lowaltitude', score: 92 }] }] };
      if (kind === 'daily') db.prepare('INSERT OR REPLACE INTO daily_reports (date, content_json, created_at) VALUES (?, ?, ?)').run(date, JSON.stringify(report), now.toISOString());
      else db.prepare('INSERT OR REPLACE INTO period_reports (kind, period_key, content_json, created_at) VALUES (?, ?, ?, ?)').run(kind, keys[kind], JSON.stringify(report), now.toISOString());
    }
  } finally { db.close(); }
  fs.mkdirSync(output, { recursive: true });
  await app.evaluate(({ BrowserWindow, session }, folder) => {
    const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1440, 920); win.show(); win.focus(); win.webContents.focus();
    globalThis.__journalDownloads = [];
    session.defaultSession.on('will-download', (_event, item) => {
      const filename = item.getFilename(); item.setSavePath(require('node:path').join(folder, filename));
      item.once('done', (_event, state) => globalThis.__journalDownloads.push({ filename, state }));
    });
  }, output);
  await page.locator('.tab[data-view="daily"]').click();
  const ready = () => page.waitForFunction(() => document.querySelector('.daily-head').getAttribute('aria-busy') === 'false');
  const baseline = { 1440: [102.5, 111.125, 123.9375, 137.921875], 800: [96.4375, 174.09375, 194.34375, 216.375] };
  const geometry = [];
  for (const width of [1440, 800]) for (const theme of ['light', 'dark']) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size, 920), width);
    await page.waitForFunction(value => innerWidth === value, width);
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#btnTheme').click();
    for (const [index, scale] of ['sm', 'md', 'lg', 'xl'].entries()) {
      await page.evaluate(value => { document.documentElement.dataset.uiScale = value; window.dispatchEvent(new Event('resize')); }, scale);
      for (const kind of ['daily', 'weekly', 'monthly']) {
        await page.locator(`#periodSwitch [data-period="${kind}"]`).click(); await ready();
        const result = await page.evaluate(() => {
          const head = document.querySelector('.daily-head').getBoundingClientRect(), date = document.getElementById('dailyDate').getBoundingClientRect();
          return { height: head.height, centerX: Math.abs(date.x + date.width / 2 - head.x - head.width / 2),
            centerY: Math.abs(date.y + date.height / 2 - head.y - head.height / 2),
            font: parseFloat(getComputedStyle(document.getElementById('dailyDate')).fontSize), root: parseFloat(getComputedStyle(document.documentElement).fontSize),
            overflow: document.getElementById('appViewport').scrollWidth > document.getElementById('appViewport').clientWidth + 1,
            hasTimestamp: document.querySelector('.daily-head').textContent.includes('生成于') };
        });
        assert.ok(Math.abs(result.height - baseline[width][index]) <= 1, `${width}/${theme}/${scale}/${kind}: banner changed height ${result.height}`);
        assert.ok(result.centerX < 1 && result.centerY < 1, `${kind} date must be at the center`);
        assert.ok(result.font >= result.root * 1.87, 'date is 50% larger than the old 1.25rem size');
        assert.equal(result.overflow, false); assert.equal(result.hasTimestamp, false);
        assert.equal(await page.locator('#btnCopyDaily').textContent(), `复制${names[kind]}`);
        for (const id of ['btnCopyDaily', 'btnExportDaily', 'dailyRegen']) assert.equal(await page.locator(`#${id}`).isEnabled(), true);
        geometry.push({ width, theme, scale, kind, ...result });
        if (scale === 'md') await page.screenshot({ path: path.join(output, `${kind}-${width}-${theme}.png`) });
      }
    }
  }
  await page.evaluate(() => { document.documentElement.dataset.uiScale = 'md'; });
  for (const kind of ['daily', 'weekly', 'monthly']) {
    await page.locator(`#periodSwitch [data-period="${kind}"]`).click(); await ready();
    const responseFor = format => page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/export' && url.searchParams.get('kind') === kind && url.searchParams.get('format') === format; });
    const copyResponse = responseFor('text');
    await page.locator('#btnCopyDaily').click();
    const copied = await (await copyResponse).json();
    await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('已复制'));
    assert.equal((await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n'), copied.content);
    await page.locator('#btnExportDaily').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#dailyExportMenu').isVisible(), true);
    assert.deepEqual(await page.locator('#dailyExportMenu button').allTextContents(), ['.md', '.doc']);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('[data-report-format="markdown"]').evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('[data-report-format="doc"]').evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#dailyExportMenu').isVisible(), false);
    await page.locator('#btnExportDaily').click();
    await page.locator('#dailyDate').click();
    assert.equal(await page.locator('#dailyExportMenu').isVisible(), false, 'outside click dismisses the menu');
    await page.locator('#btnExportDaily').click();
    const other = kind === 'daily' ? 'weekly' : 'daily';
    await page.locator(`#periodSwitch [data-period="${other}"]`).click(); await ready();
    assert.equal(await page.locator('#dailyExportMenu').isVisible(), false, 'changing periods dismisses the menu');
    await page.locator(`#periodSwitch [data-period="${kind}"]`).click(); await ready();
    for (const format of ['markdown', 'doc']) {
      const exported = responseFor(format);
      await page.locator('#btnExportDaily').click();
      await page.screenshot({ path: path.join(output, `${kind}-export-menu.png`) });
      const menuBox = await page.locator('#dailyExportMenu').boundingBox();
      const triggerBox = await page.locator('#btnExportDaily').boundingBox();
      assert.ok(menuBox.y >= triggerBox.y + triggerBox.height - 1 && menuBox.x >= 0 && menuBox.x + menuBox.width <= 801, 'dropdown opens below the trigger within the viewport');
      await page.locator(`#dailyExportMenu [data-report-format="${format}"]`).click();
      const response = await exported; assert.equal(response.status(), 200);
      const result = await response.json();
      assert.equal(result.filename, `摘星阁-情报${names[kind]}-${keys[kind]}.${format === 'markdown' ? 'md' : 'doc'}`);
      assert.equal(await page.locator('#dailyExportMenu').isVisible(), false);
      const deadline = Date.now() + 10000;
      while (!(await app.evaluate((_electron, name) => globalThis.__journalDownloads.find(item => item.filename === name), result.filename))) {
        assert.ok(Date.now() < deadline, `download did not complete: ${result.filename}`); await page.waitForTimeout(100);
      }
      assert.equal((await app.evaluate((_electron, name) => globalThis.__journalDownloads.find(item => item.filename === name), result.filename)).state, 'completed');
      const file = fs.readFileSync(path.join(output, result.filename));
      if (format === 'doc') {
        assert.deepEqual(file, Buffer.from(result.content, 'base64'));
        assert.ok(readWord(file).content.includes(`${names[kind]}样本标题 🚀`));
      } else assert.equal(file.toString('utf8').replace(/^\ufeff/, ''), result.content);
    }
    const regenerated = page.waitForResponse(response => new URL(response.url()).pathname === (kind === 'daily' ? '/api/daily/regenerate' : '/api/reports/regenerate'));
    await page.locator('#dailyRegen').click();
    const response = await regenerated; assert.equal(response.status(), 200);
    const body = response.request().postDataJSON();
    assert.deepEqual(body, kind === 'daily' ? { date: keys.daily } : { kind, key: keys[kind] });
    await ready();
    await page.waitForFunction(() => !document.getElementById('dailyRegen').disabled);
  }
  fs.writeFileSync(path.join(output, 'geometry.json'), JSON.stringify(geometry, null, 2));
});
