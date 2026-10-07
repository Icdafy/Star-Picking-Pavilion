'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { launchNativeElectron } = require('./native-electron.cjs');
const root = path.join(__dirname, '../..');

test('v0225 升级后全部动态只显示两行业已判资料，撤回财经合集且保留原星标', { timeout: 120_000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0225-ui-'));
  const bootstrap = spawnSync(process.execPath, ['-e', "require('./server/db').closeDatabase()"], {
    cwd: root, env: { ...process.env, STAR_PICKING_PAVILION_DATA_DIR: directory }, encoding: 'utf8'
  });
  assert.equal(bootstrap.status, 0, bootstrap.stderr);
  const database = new DatabaseSync(path.join(directory, 'star-picking-pavilion.db'));
  const stamp = new Date().toISOString();
  const source = database.prepare("INSERT INTO sources(name,type,url,tier,domain) VALUES('行业边界验证','rss','https://example.invalid/scope','T2','both')").run().lastInsertRowid;
  const insert = database.prepare(`INSERT INTO articles(source_id,title,url,summary_raw,ai_summary,published_at,fetched_at,relevant,analyzed,domain,featured,starred,starred_at,clean_version)
    VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,2)`);
  let blocked;
  try {
    for (const [index, article] of [
      ['商业航天运载火箭完成试车', 'aerospace', 1, 1, 0],
      ['低空经济新增无人机物流航线', 'lowaltitude', 1, 3, 0],
      ['全国铁路预计发送旅客2415万人次', 'lowaltitude', null, 0, 0],
      ['假期重点速递 | A股回落；券商热议固态电池', 'aerospace', 1, 1, 1]
    ].entries()) {
      const [title, domain, relevant, analyzed, starred] = article;
      const id = Number(insert.run(source, title, `https://example.invalid/scope-${index}`, '商业航天可回收火箭的新进展',
        '保留原来的分析摘要', stamp, stamp, relevant, analyzed, domain, starred, starred ? stamp : null).lastInsertRowid);
      if (starred) blocked = id;
    }
  } finally { database.close(); }
  fs.writeFileSync(path.join(directory, 'ui-preferences.json'), JSON.stringify({ version: 2, view: 'all', realtime: false }));
  const app = await launchNativeElectron(root, directory);
  t.after(async () => { await app.close(); await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.nav');
  await page.locator('[data-view="all"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#feedList .card-title').length === 2);
  const titles = await page.locator('#feedList .card-title').allTextContents();
  assert.ok(titles.some(title => title.includes('商业航天运载火箭完成试车')));
  assert.ok(titles.some(title => title.includes('低空经济新增无人机物流航线')));
  assert.doesNotMatch(await page.locator('#feedList').textContent(), /铁路|重点速递|固态电池/);
  const shots = path.join(root, 'work/v0225/screenshots');
  fs.mkdirSync(shots, { recursive: true });
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  await page.screenshot({ path: path.join(shots, 'industry-only.png') });
  await page.locator('[data-view="starred"]').click();
  await page.waitForSelector(`#feedList .card[data-id="${blocked}"]`);
  assert.match(await page.locator('#feedList').textContent(), /假期重点速递/);
  await page.screenshot({ path: path.join(shots, 'preserved-star.png') });
  const verify = new DatabaseSync(path.join(directory, 'star-picking-pavilion.db'));
  try {
    const row = verify.prepare('SELECT relevant,featured,starred,ai_summary FROM articles WHERE id=?').get(blocked);
    assert.deepEqual({ ...row }, { relevant: 0, featured: 0, starred: 1, ai_summary: '保留原来的分析摘要' });
  } finally { verify.close(); }
  assert.deepEqual(errors, []);
});
