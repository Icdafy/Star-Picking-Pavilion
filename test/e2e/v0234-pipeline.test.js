'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const { launchNativeElectron } = require('./native-electron.cjs');
const root = path.resolve(__dirname, '../..');

test('v0234 native collection progress exposes real stages and counts and returns to an enabled action', { timeout: 60000 }, async t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0234-progress-'));
  fs.writeFileSync(path.join(profile, 'ui-preferences.json'), JSON.stringify({ version: 2,
    theme: 'dark', aquaEnabled: false, pointerEnabled: false }));
  let app;
  t.after(async () => {
    await app?.close();
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  app = await launchNativeElectron(root, profile);
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForLoadState('load');
  await page.waitForFunction(() => Boolean(window.StatsController));
  await page.waitForSelector('.nav');
  await page.evaluate(() => {
    globalThis.pipelineTestController = StatsController.createStatsController({
      api: async () => ({}), state: { view: 'all' }, prefersReducedMotion: () => true,
      now: () => performance.now(), frame: callback => requestAnimationFrame(callback),
      elements: Object.fromEntries(['statSources', 'statToday', 'statFeatured', 'tabStarredCount',
        'statStatus', 'statStatusLabel', 'btnRefresh', 'feedBanner', 'collectScheduleStatus']
        .map(id => [id, document.getElementById(id)]))
    });
    pipelineTestController.renderActivity({ revision: 10000, activity: 'collecting',
    pipelineProgress: { phase: 'collecting-analyzing', sourcesCompleted: 39, sourcesTotal: 201,
      collected: 64, analyzed: 40, featured: 9, message: '新结果正在陆续显示' } });
  });
  assert.equal(await page.locator('#statStatusLabel').textContent(), '采集分析中');
  assert.equal(await page.locator('#btnRefresh').isDisabled(), true);
  assert.match(await page.locator('#btnRefresh').getAttribute('aria-label'), /信源 39\/201；新增 64 条；已分析 40 条；精选 9 条/);
  const shots = path.join(root, 'work/v0234/screenshots');
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, 'pipeline-progress.png') });
  await page.evaluate(() => pipelineTestController.renderActivity({ revision: 10001, activity: 'collecting',
    pipelineProgress: { phase: 'grouping', sourcesCompleted: 201, sourcesTotal: 201, analyzed: 64 } }));
  assert.equal(await page.locator('#statStatusLabel').textContent(), '归组中');
  await page.evaluate(() => pipelineTestController.renderActivity({ revision: 10002, activity: 'online' }));
  assert.equal(await page.locator('#btnRefresh').isDisabled(), false);
  assert.equal(await page.locator('#btnRefresh').getAttribute('aria-busy'), 'false');
  assert.equal(await page.locator('#statStatusLabel').textContent(), '在线');
  await page.route('**/api/collect', route => route.abort());
  await page.route('**/api/stats', route => route.abort());
  await page.locator('#btnRefresh').click();
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('启动失败'));
  assert.equal(await page.locator('#btnRefresh').isDisabled(), false, 'POST和统计失败后仍可再次启动');
  assert.deepEqual(errors, []);
});

test('native manual collection displays analyzed news while a slower feed is still in flight', { timeout: 60000 }, async t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0234-stream-'));
  fs.writeFileSync(path.join(profile, 'ui-preferences.json'), JSON.stringify({ version: 2,
    view: 'all', theme: 'dark', aquaEnabled: false, pointerEnabled: false }));
  let app, finishSlow;
  const rss = (title, url, text) => `<rss version="2.0"><channel><title>本地验证信源</title><item><title>${title}</title><link>${url}</link><description>${text}</description><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
  const fixture = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    const base = `http://127.0.0.1:${fixture.address().port}`;
    if (req.url === '/fast.xml') res.end(rss('蓝箭航天朱雀三号液氧甲烷运载火箭完成首飞', `${base}/rocket-fast`,
      '商业航天运载火箭完成首飞试验，蓝箭航天发布验证结果，液氧甲烷发动机和火箭回收系统完成验证。'));
    else finishSlow = () => res.end(rss('沃兰特VE25电动垂直起降载人航空器获得适航型号合格证', `${base}/evtol-slow`,
      '低空经济电动垂直起降航空器完成适航审定，沃兰特取得民航局型号合格证，载人飞行器进入交付阶段。'));
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    finishSlow?.();
    await app?.close();
    await new Promise(resolve => { fixture.close(resolve); fixture.closeAllConnections(); });
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  app = await launchNativeElectron(root, profile);
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  await page.waitForSelector('#btnRefresh:not([disabled])');
  const database = new DatabaseSync(path.join(profile, 'star-picking-pavilion.db'));
  try {
    database.exec('UPDATE sources SET enabled=0');
    const insert = database.prepare('INSERT INTO sources(name,type,url,tier,domain) VALUES (?,\'rss\',?,\'T1\',?)');
    const base = `http://127.0.0.1:${fixture.address().port}`;
    insert.run('本地快速信源', `${base}/fast.xml`, 'aerospace');
    insert.run('本地慢速信源', `${base}/slow.xml`, 'low_altitude');
  } finally { database.close(); }
  await page.locator('[data-view="all"]').click();
  await page.locator('#btnRefresh').click();
  await page.waitForFunction(() => document.querySelector('#feedList .card[data-id]')?.textContent.includes('朱雀三号'), null, { timeout: 30000 });
  assert.equal(typeof finishSlow, 'function');
  assert.equal(await page.locator('#btnRefresh').isDisabled(), true);
  assert.match(await page.locator('#feedList').textContent(), /朱雀三号/);
  assert.doesNotMatch(await page.locator('#feedList').textContent(), /VE25/);
  const shots = path.join(root, 'work/v0234/screenshots');
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, 'native-first-result.png') });
  finishSlow();
  await page.waitForSelector('#btnRefresh:not([disabled])', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#feedList').textContent.includes('VE25'));
  assert.match(await page.locator('#feedList').textContent(), /朱雀三号/);
  assert.equal(await page.locator('#statStatusLabel').textContent(), '在线');
});
