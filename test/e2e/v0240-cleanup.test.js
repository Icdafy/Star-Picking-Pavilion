'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { launchNativeElectron } = require('./native-electron.cjs');
const root = path.resolve(__dirname, '../..');

test('v0240 real desktop: automatic cleanup opt-out persists across restart and leaves manual cleanup usable', { timeout: 120000 }, async t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0240-cleanup-'));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ collect: { automatic: true, intervalMinutes: 720 } }));
  fs.writeFileSync(path.join(profile, 'ui-preferences.json'), JSON.stringify({ version: 2,
    view: 'settings', theme: 'light', aquaEnabled: false, pointerEnabled: false }));
  const seeded = spawnSync(process.execPath, ['-e', `
    const {db}=require('./server/db');
    const source=db.prepare("INSERT INTO sources(name,type,url,tier,domain,enabled,intl) VALUES ('清理测试','rss','https://cleanup.example/feed','T1','lowaltitude',0,0)").run();
    for (const [slug,starred] of [['expired',0],['starred',1]]) {
      db.prepare("INSERT INTO articles(source_id,url,title,summary_raw,published_at,fetched_at,relevant,starred) VALUES (?,?,?,?,?,?,1,?)")
        .run(source.lastInsertRowid,'https://cleanup.example/'+slug,'低空经济清理测试 '+slug,'低空经济测试情报','2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z',starred);
    }
    db.close();`], { cwd: root, env: { ...process.env, STAR_PICKING_PAVILION_DATA_DIR: profile }, encoding: 'utf8' });
  assert.equal(seeded.status, 0, seeded.stderr);
  let app;
  t.after(async () => {
    await app?.close();
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const errors = [];
  async function launch() {
    app = await launchNativeElectron(root, profile, { startScheduler: true });
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForLoadState('load');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('[data-view="settings"]').click();
    await page.locator('#settingsNav [data-settings-target="settingsStorage"]').click();
    await page.waitForFunction(() => !document.getElementById('setAutomaticCleanup').disabled
      && document.getElementById('lastPruneHint').textContent.includes('保留'));
    return page;
  }
  let page = await launch();
  const toggleLabel = page.locator('label').filter({ has: page.locator('#setAutomaticCleanup') });
  assert.equal(await page.locator('#setAutomaticCleanup').isChecked(), true, 'legacy profiles preserve automatic cleanup');
  assert.match(await page.locator('#lastPruneHint').textContent(), /已开启：每天 08:25/);
  await toggleLabel.click();
  await page.waitForFunction(async () => {
    const settings = await api('/api/settings');
    const status = await api('/api/maintenance');
    return settings.collect.automaticCleanup === false && status.scheduler.activeSchedule.automaticCleanup === false
      && document.getElementById('lastPruneHint').textContent.startsWith('已关闭') && !document.getElementById('setAutomaticCleanup').disabled;
  });
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).collect.automaticCleanup, false);
  assert.equal(await page.locator('#setAutomaticCollect').isChecked(), true);
  assert.equal(await page.locator('#btnPruneNow').isEnabled(), true);

  await app.close(); app = null;
  page = await launch();
  assert.equal(await page.locator('#setAutomaticCleanup').isChecked(), false);
  assert.match(await page.locator('#lastPruneHint').textContent(), /已关闭/);
  const before = await page.evaluate(() => api('/api/maintenance'));
  assert.equal(before.articles, 2);
  assert.equal(before.expiring, 1, 'starred article stays outside cleanup candidates');
  assert.equal(before.scheduler.activeSchedule.enabled, true);
  assert.equal(before.scheduler.activeSchedule.automaticCleanup, false);

  await page.locator('#btnPruneNow').click();
  await page.waitForFunction(() => document.getElementById('pruneResult').textContent.includes('清理完成'));
  const after = await page.evaluate(() => api('/api/maintenance'));
  assert.equal(after.articles, 1);
  assert.equal(after.starred, 1);
  assert.equal(after.expiring, 0);
  assert.equal(after.scheduler.lastPrune.trigger, 'manual');

  await page.locator('label').filter({ has: page.locator('#setAutomaticCleanup') }).click();
  await page.waitForFunction(async () => (await api('/api/maintenance')).scheduler.activeSchedule.automaticCleanup === true
    && document.getElementById('lastPruneHint').textContent.startsWith('已开启：'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).collect.automaticCleanup, true);
  await page.locator('#settingsNav [data-settings-target="settingsCollect"]').click();
  await page.locator('label').filter({ has: page.locator('#setAutomaticCollect') }).click();
  await page.waitForFunction(async () => (await api('/api/maintenance')).scheduler.activeSchedule.enabled === false
    && document.getElementById('lastPruneHint').textContent.includes('等待自动采集'));
  assert.equal(await page.locator('#setAutomaticCleanup').isChecked(), true);
  assert.deepEqual(errors, []);
});
