'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchNativeElectron } = require('./native-electron.cjs');
const root = path.resolve(__dirname, '../..');

test('native activity view explains post-capture work, retries and elapsed time and keeps a reviewable result', { timeout: 60000 }, async t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0244-progress-'));
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
  await page.waitForSelector('.nav');
  const snapshot = { revision: 100000, activity: 'collecting', pipelineProgress: {
    phase: 'analyzing', analysisStage: 'scoring', stageLabel: '双独立评分与内容理解', stageDone: 4, stageTotal: 20,
    sourcesCompleted: 201, sourcesTotal: 201, collected: 20, analyzed: 4, featured: 2, remaining: 16,
    elapsedMs: 74000, stageElapsedMs: 12000, startedAt: '2026-10-24T06:00:00.000Z',
    message: '捕捉已结束，研判仍在进行。',
    activeTasks: [{ id: 'call-1', label: '第一次独立评分', current: '<img src=x onerror=alert(1)>', status: 'retrying',
      elapsedMs: 12000, attempt: 2, retryInMs: 5000 }],
    stages: [{ stage: 'collecting', label: '捕捉信源', done: 201, total: 201, elapsedMs: 62000, status: 'completed' },
      { stage: 'scoring', label: '双独立评分与内容理解', done: 4, total: 20, elapsedMs: 12000, status: 'running' }],
    warnings: []
  } };
  // Drive the app's real SSE listener and composition root with deterministic status fixtures.
  const emit = value => page.evaluate(status => activityStream.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(status) })), value);
  await emit(snapshot);
  await page.waitForSelector('#fluidCloud[data-state="capsule"]');
  assert.equal(await page.locator('#statStatusLabel').textContent(), '双独立评分与内容理解');
  assert.equal(await page.locator('#btnRefresh').isDisabled(), true);
  assert.equal(await page.locator('.fluid-cloud-value').textContent(), '4/20 · 1分14秒');
  await page.locator('#fluidCloudCapsule').click();
  await page.waitForSelector('#fluidCloud[data-state="expanded"]');
  assert.equal(await page.locator('#fluidCloudPanel [role="progressbar"]').getAttribute('aria-valuenow'), '20');
  assert.match(await page.locator('.fluid-cloud-detail').textContent(), /待分析 16 条；已用 1分14秒；当前步骤 12秒/);
  assert.match(await page.locator('.fluid-cloud-process').textContent(), /第一次独立评分.*5秒后重试/);
  assert.match(await page.locator('.fluid-cloud-process').textContent(), /捕捉信源.*201\/201.*已完成/);
  assert.equal(await page.locator('#fluidCloudPanel img').count(), 0, 'article text remains plain text');
  await page.waitForFunction(() => {
    const panel = document.getElementById('fluidCloudPanel');
    const shell = document.querySelector('.fluid-cloud-shell');
    const a = panel.getBoundingClientRect(), b = shell.getBoundingClientRect();
    return Number(getComputedStyle(panel).opacity) > .99 && b.width + 2 >= a.width && b.height + 2 >= a.height;
  });
  assert.equal(await page.locator('#fluidCloudPanel').evaluate(panel => panel.scrollWidth <= panel.clientWidth + 1), true, 'long task details wrap inside the panel');
  const shots = path.join(root, 'work/v0244/screenshots');
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, 'analysis-progress.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600));
  await page.waitForFunction(() => {
    const panel = document.getElementById('fluidCloudPanel').getBoundingClientRect();
    const shell = document.querySelector('.fluid-cloud-shell').getBoundingClientRect();
    return innerWidth <= 800 && panel.left >= 0 && panel.right <= innerWidth && panel.bottom <= innerHeight
      && shell.width + 2 >= panel.width && shell.height + 2 >= panel.height;
  });
  assert.equal(await page.locator('#fluidCloudPanel').evaluate(panel => panel.scrollWidth <= panel.clientWidth + 1), true);
  await page.screenshot({ path: path.join(shots, 'analysis-progress-compact.png') });

  // Unknown totals stay indeterminate, while an observed heartbeat advances both clocks.
  const heartbeat = structuredClone(snapshot);
  heartbeat.revision++;
  Object.assign(heartbeat.pipelineProgress, { stageTotal: null, elapsedMs: 75000, stageElapsedMs: 13000 });
  await page.getByRole('button', { name: '查看全部动态', exact: true }).focus();
  await emit(heartbeat);
  assert.equal(await page.locator('#fluidCloudPanel [role="progressbar"]').getAttribute('aria-valuenow'), null);
  assert.equal(await page.locator('#fluidCloudPanel [role="progressbar"]').getAttribute('data-indeterminate'), 'true');
  assert.match(await page.locator('.fluid-cloud-detail').textContent(), /已用 1分15秒；当前步骤 13秒/);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), '查看全部动态', 'heartbeats retain keyboard action focus');

  const paused = structuredClone(heartbeat);
  paused.revision++;
  paused.activity = 'online';
  Object.assign(paused.pipelineProgress, { phase: 'paused', activeTasks: [], message: '预算已用完，待分析资料保留到下一轮。',
    warnings: ['本小时预算已用完；16 条资料保留待分析。'] });
  await emit(paused);
  assert.equal(await page.locator('#btnRefresh').isDisabled(), false);
  assert.equal(await page.locator('#btnRefresh').getAttribute('aria-label'), '立即采集分析');
  assert.equal(await page.locator('.fluid-cloud-panel-title').textContent(), '本轮暂缓');
  assert.equal(await page.locator('#fluidCloudPanel [role="progressbar"]').isVisible(), false);
  assert.match(await page.locator('.fluid-cloud-process').textContent(), /16 条资料保留待分析/);
  await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await page.waitForSelector('#fluidCloud[data-state="hidden"]');
  await page.locator('[data-view="settings"]').click();
  await page.locator('#pipelineRunDetails summary').click();
  assert.match(await page.locator('#pipelineRunSummary').textContent(), /本轮暂缓.*总用时 1分15秒/);
  assert.match(await page.locator('#pipelineRunLines').textContent(), /捕捉信源.*201\/201.*已完成/);
  assert.match(await page.locator('#pipelineRunLines').textContent(), /16 条资料保留待分析/);
  await emit(snapshot);
  assert.equal(await page.locator('#btnRefresh').isDisabled(), false, 'late running snapshots cannot undo the result');
  assert.deepEqual(errors, []);
});
