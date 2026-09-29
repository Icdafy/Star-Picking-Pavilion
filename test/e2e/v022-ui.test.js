'use strict';
// v0.2.2 真实 Electron：一级市场默认打开市场概览，阶段下钻到融资动态，导出 CSV；信源监控台本地筛选；窄窗口无横向溢出
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { _electron: electron } = require('playwright');

const root = path.join(__dirname, '..', '..');

// 在独立子进程里预置一笔真实结构的融资事件（测试进程自己不持有数据库连接）
function seed(dir) {
  const script = `
    const { db, insertArticle, closeDatabase } = require('./server/db');
    const deals = require('./server/ai/deals');
    const url = 'https://example.org/v022-e2e/1';
    const source = Number(db.prepare("INSERT INTO sources(name,type,url,tier,domain) VALUES('示例创投','html',?,'T2','aerospace')").run(url).lastInsertRowid);
    insertArticle({ sourceId: source, title: '示例航天完成数亿元B轮融资', url, canonicalUrl: url, summaryRaw: '示例资本领投' });
    const id = db.prepare('SELECT id FROM articles WHERE url=?').get(url).id;
    db.prepare("UPDATE articles SET relevant=1, analyzed=1, published_at=?, domain='aerospace' WHERE id=?").run(new Date().toISOString(), id);
    db.exec('BEGIN');
    deals.recordDeal({ id }, deals.normalizeDeal({ company: '示例航天', round: 'B轮', amount: '数亿元', investors: ['示例资本'], leadInvestors: ['示例资本'], status: 'completed' }), { domain: 'aerospace' });
    db.exec('COMMIT');
    closeDatabase();`;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: root, env: { ...process.env, STAR_PICKING_PAVILION_DATA_DIR: dir }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('market overview drills into deals, exports CSV, and sources filter locally', { timeout: 90_000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v022-ui-'));
  fs.copyFileSync(path.join(__dirname, 'fixtures/empty-settings.json'), path.join(dir, 'settings.json'));
  seed(dir);
  const app = await electron.launch({ args: ['.', '--hidden'], cwd: root, env: { ...process.env,
    STAR_PICKING_PAVILION_TEST_DATA_DIR: dir, STAR_PICKING_PAVILION_NO_SCHEDULER: '1', STAR_PICKING_PAVILION_DISABLE_AUTO_UPDATE: '1' } });
  t.after(async () => { await app.close().catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }); });
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  await page.waitForSelector('.nav');
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1280, 820); w.showInactive(); });

  await page.locator('[data-view="capital"]').click();
  await page.waitForSelector('#capitalBody .cap-kpis');
  assert.equal(await page.locator('[data-capital-tab="overview"]').getAttribute('aria-selected'), 'true');
  assert.match(await page.locator('.cap-kpis').textContent(), /融资事件\s*1/);
  await page.locator('#capitalBody [data-deal-stage="growth"]').click();
  await page.waitForSelector('#capitalBody .deal-tools');
  assert.equal(await page.locator('[data-capital-tab="deals"]').getAttribute('aria-selected'), 'true');
  assert.match(await page.locator('#capitalBody .deal-list').textContent(), /示例航天/);
  assert.equal(await page.locator('#capitalBody [data-deal-stage="growth"]').getAttribute('aria-pressed'), 'true');

  // Electron 用会话级 will-download 处理 a[download]：主进程侧落盘到测试目录再核对内容
  const saved = path.join(dir, 'export.csv');
  await app.evaluate(({ session }, target) => new Promise(resolve => {
    globalThis.__sppDownload = new Promise(done => session.defaultSession.once('will-download', (_event, item) => {
      item.setSavePath(target);
      item.once('done', (_e, state) => done({ state, filename: item.getFilename() }));
    }));
    resolve();
  }), saved);
  await page.locator('#capitalBody [data-act="deals-export"][data-format="csv"]').click();
  const result = await app.evaluate(() => globalThis.__sppDownload);
  assert.equal(result.state, 'completed');
  assert.match(result.filename, /^一级市场融资-\d{4}-\d{2}-\d{2}\.csv$/);
  assert.match(fs.readFileSync(saved, 'utf8'), /示例航天,/);

  await page.locator('[data-view="sources"]').click();
  await page.waitForSelector('#sourcesList .src-card');
  const total = await page.locator('#sourcesList .src-card').count();
  assert.ok(total > 100);
  await page.locator('#sourcesSearch').fill('科创板IPO');
  await page.waitForFunction(n => document.querySelectorAll('#sourcesList .src-card').length < n, total);
  assert.match(await page.locator('#sourcesList').textContent(), /上交所·科创板IPO·航空航天/);
  assert.match(await page.locator('#sourcesSummary').textContent(), /筛选出/);
  await page.locator('#sourcesSearch').fill('');
  await page.locator('#sourcesStatus [data-source-status="off"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#sourcesList .src-card')].every(card => /启用/.test(card.textContent)));

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(800, 700));
  await page.waitForTimeout(300);
  for (const view of ['capital', 'sources']) {
    await page.locator(`[data-view="${view}"]`).click();
    await page.waitForTimeout(400);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${view} 窄窗口无横向溢出`);
  }
});
