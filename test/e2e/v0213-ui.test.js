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

test('v0213 native page banners, journal toolbar, report overview and motion preferences', { timeout: 150_000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0213-ui-'));
  fs.writeFileSync(path.join(directory, 'settings.json'), '{}');
  fs.writeFileSync(path.join(directory, 'ui-preferences.json'), JSON.stringify({ version: 2,
    ...Schema.getLegacyUiPreferences(CommonLinks), view: 'featured', realtime: false, aquaEnabled: false }));
  const app = await launchNativeElectron(root, directory);
  t.after(async () => { await app.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  await page.waitForSelector('#catChips .chip');
  const database = new DatabaseSync(path.join(directory, 'star-picking-pavilion.db'));
  try {
    const source = database.prepare('SELECT id FROM sources ORDER BY id LIMIT 1').get();
    const insert = database.prepare(`INSERT INTO articles (source_id, title, url, summary_raw, ai_summary, published_at, fetched_at, domain, category, relevant, analyzed, quality_score, featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '技术研发', 1, 1, 92, 1)`);
    // 日报按当天 08:00 之前 24 小时的入库窗口生成。
    const cutoff = new Date(); cutoff.setHours(7, 30, 0, 0);
    for (let i = 0; i < 6; i++) {
      const stamp = new Date(cutoff.getTime() - i * 60000).toISOString();
      const title = i % 2 ? '低空经济样本：飞行器完成关键技术验证' : '商业航天样本：新一代推进系统进入试验阶段';
      insert.run(source.id, title, `https://example.invalid/banner-${i}`, '虚构样本，仅用于界面验收。', '虚构样本，仅用于界面验收。', stamp, stamp, i % 2 ? 'lowaltitude' : 'aerospace');
    }
  } finally { database.close(); }
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1440, 920); win.show(); win.focus(); win.webContents.focus();
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => document.documentElement.dataset.fxTier !== 'static');
  await page.waitForFunction(() => document.hasFocus());
  const shots = path.join(root, 'work/v0213/screenshots');
  fs.mkdirSync(shots, { recursive: true });
  const titles = { featured: '精选情报', all: '让每一条信号，都进入视野', starred: '摘下的星，留给下一次判断',
    capital: '一级市场雷达', releases: '每一次进步，都有迹可循', links: '常用网址，即刻可达',
    sources: '信源监控台', settings: '让摘星阁，更合你的习惯' };
  for (const width of [1440, 800]) for (const theme of ['light', 'dark']) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size, 920), width);
    await page.waitForFunction(value => innerWidth === value, width);
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#btnTheme').click();
    for (const [view, title] of Object.entries(titles)) {
      await page.locator(`.tab[data-view="${view}"]`).click();
      const banner = page.locator('.view:not([hidden]) .page-banner');
      assert.equal(await banner.locator('.view-title').textContent(), title);
      assert.equal(await banner.locator('.banner-art[aria-hidden="true"]').count(), 1);
      await page.waitForTimeout(650);
      const geometry = await banner.evaluate(node => {
        const r = node.getBoundingClientRect();
        return { width: r.width, left: r.left, right: r.right, height: r.height, overflow: document.getElementById('appViewport').scrollWidth > document.getElementById('appViewport').clientWidth + 1 };
      });
      assert.ok(geometry.width > 0 && geometry.height > 0 && geometry.left >= 0 && geometry.right <= width + 1, `${view}: banner must stay visible within the window`);
      assert.equal(geometry.overflow, false, `${view}: no horizontal overflow`);
      await page.screenshot({ path: path.join(shots, `${view}-${width}-${theme}.png`) });
    }
    await page.locator('.tab[data-view="daily"]').click();
    await page.waitForFunction(() => document.querySelector('.daily-head').getAttribute('aria-busy') === 'false');
    assert.deepEqual(await page.locator('#dailyMetrics dd').allTextContents(), ['6', '3', '3']);
    const layout = await page.evaluate(() => {
      const toolbar = document.querySelector('.daily-toolbar'), overview = document.querySelector('.daily-head');
      return { periods: toolbar.contains(document.getElementById('periodSwitch')),
        actions: ['btnCopyDaily', 'btnExportDaily', 'dailyRegen'].every(id => toolbar.contains(document.getElementById(id))),
        below: overview.getBoundingClientRect().top > toolbar.getBoundingClientRect().bottom,
        separate: !overview.contains(document.getElementById('btnCopyDaily')) };
    });
    assert.deepEqual(layout, { periods: true, actions: true, below: true, separate: true });
    await page.screenshot({ path: path.join(shots, `daily-${width}-${theme}.png`) });
  }
  for (const kind of ['weekly', 'monthly', 'daily']) {
    await page.locator(`#periodSwitch [data-period="${kind}"]`).click();
    await page.waitForFunction(() => document.querySelector('.daily-head').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator(`#periodSwitch [data-period="${kind}"]`).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.locator('#dailyMetrics dt').allTextContents(), kind === 'daily' ? ['精选情报', '低空经济', '商业航天'] : ['精选情报', '热点事件', '资本事件']);
    assert.equal(await page.locator('#btnCopyDaily').isVisible(), kind === 'daily');
    assert.equal(await page.locator('#btnExportDaily').isVisible(), kind === 'daily');
    assert.equal(await page.locator('#dailyRegen').isVisible(), kind === 'daily');
    assert.equal(await page.locator('#dailyPrev').getAttribute('aria-label'), kind === 'daily' ? '前一天' : '前一期');
    assert.match(await page.locator('#dailySchedule').textContent(), kind === 'daily' ? /08:00/ : kind === 'weekly' ? /每周一/ : /每月 1 日/);
  }
  await page.locator('#dailyRegen').click();
  await page.waitForFunction(() => !document.getElementById('dailyRegen').disabled && document.querySelector('.daily-head').getAttribute('aria-busy') === 'false');
  assert.deepEqual(await page.locator('#dailyMetrics dd').allTextContents(), ['6', '3', '3']);
  await page.locator('#dailyPrev').click();
  await page.waitForFunction(() => document.querySelector('.daily-head').getAttribute('aria-busy') === 'false');
  assert.deepEqual(await page.locator('#dailyMetrics dd').allTextContents(), ['0', '0', '0']);
  await page.locator('#dailyNext').click();
  await page.waitForFunction(() => document.querySelector('.daily-head').getAttribute('aria-busy') === 'false');
  assert.equal(await page.locator('#dailyNext').isDisabled(), true);
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.focus(); win.webContents.focus(); });
  await page.waitForFunction(() => document.hasFocus() && !document.hidden);
  // 从真实 click 边界采样，避免 CDP 往返耗时漏掉整个 440ms 入场。
  await page.evaluate(() => {
    window.bannerFrames = []; window.bannerCaptureDone = false;
    document.querySelector('.tab[data-view="featured"]').addEventListener('click', () => {
      const start = performance.now(), title = document.getElementById('feedHeroTitle');
      function sample(now) {
        window.bannerFrames.push({ transform: getComputedStyle(title).transform, opacity: getComputedStyle(title).opacity,
          focus: document.hasFocus(), tier: document.documentElement.dataset.fxTier });
        if (now - start < 500) requestAnimationFrame(sample); else window.bannerCaptureDone = true;
      }
      requestAnimationFrame(sample);
    }, { once: true });
  });
  await page.locator('.tab[data-view="featured"]').click();
  await page.waitForFunction(() => window.bannerCaptureDone);
  const frames = await page.evaluate(() => window.bannerFrames);
  console.log('Banner motion sample:', JSON.stringify({ count: frames.length, distinct: new Set(frames.map(frame => frame.transform)).size, first: frames[0], last: frames.at(-1) }));
  assert.ok(new Set(frames.map(frame => frame.transform)).size > 2, 'title reveal must visibly move across real frames');
  const tier = await page.locator('html').getAttribute('data-fx-tier');
  assert.equal(await page.locator('#feedHero .banner-art span').evaluate(node => getComputedStyle(node).animationName), tier === 'full' ? 'sweep' : 'none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.documentElement.dataset.fxTier === 'static');
  await page.locator('.tab[data-view="all"]').click();
  assert.equal(await page.locator('#feedHero .banner-art span').evaluate(node => getComputedStyle(node).animationName), 'none');
  assert.equal(await page.locator('#feedHeroTitle').evaluate(node => node.getAnimations().length), 0);
  assert.equal(await page.locator('#feedHeroTitle').evaluate(node => getComputedStyle(node).opacity), '1');
  await page.emulateMedia({ forcedColors: 'active' });
  assert.equal(await page.locator('#feedHero .banner-art').isVisible(), false);
  fs.writeFileSync(path.join(root, 'work/v0213/banner-motion.json'), JSON.stringify({ tier, frames }, null, 2));
});
