'use strict';

// 阶段 3 批 2：stats-controller 自 app.js 抽离后的 Node 单测。
// 覆盖：依赖护栏、setStat 数字补间与降级直写、refreshStats 的塔台状态/
// 星标徽标/降级横幅分支与错误路径。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createStatsController } = require('../renderer/stats-controller');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'stats-controller.js'), 'utf8');

test('stats-controller 工厂不直读 window，UMD 不泄漏全局且导出冻结', () => {
  assert.doesNotMatch(source, /\bwindow\./, '模块内不得出现裸 window. 直读');
  const modulePath = require.resolve('../renderer/stats-controller');
  const result = spawnSync(process.execPath, ['-e', `
    delete globalThis.StatsController;
    const api = require(${JSON.stringify(modulePath)});
    process.stdout.write(JSON.stringify({
      exported: typeof api.createStatsController === 'function',
      frozen: Object.isFrozen(api),
      globalCreated: Object.prototype.hasOwnProperty.call(globalThis, 'StatsController')
    }));
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { exported: true, frozen: true, globalCreated: false });
});

test('缺少必需依赖时工厂抛 TypeError', () => {
  assert.throws(() => createStatsController({}), TypeError);
  assert.throws(() => createStatsController({ api: () => {} }), TypeError);
});

function makeElements() {
  return {
    statSources: { textContent: '', dataset: {} },
    statToday: { textContent: '', dataset: {} },
    statFeatured: { textContent: '', dataset: {} },
    tabStarredCount: { hidden: true, textContent: '' },
    statStatus: { innerHTML: '' },
    statStatusLabel: { textContent: '' },
    feedBanner: { hidden: true, innerHTML: '' }
  };
}

function createController({ reduced = false, stats, view = 'featured' } = {}) {
  const elements = makeElements();
  const frames = [];
  let clock = 0;
  const ctrl = createStatsController({
    api: async () => {
      if (stats === 'fail') throw new Error('backend down');
      return stats;
    },
    state: { view },
    elements,
    prefersReducedMotion: () => reduced,
    now: () => clock,
    frame: cb => frames.push(cb)
  });
  return { ctrl, elements, frames, tick: at => { clock = at; const cb = frames.shift(); if (cb) cb(at); } };
}

test('setStat 首次赋值与非法值直写，不做补间', () => {
  const { ctrl, elements } = createController();
  ctrl.setStat(elements.statSources, 128);
  assert.equal(elements.statSources.textContent, '128');
  ctrl.setStat(elements.statToday, 'abc');
  assert.equal(elements.statToday.textContent, '–');
});

test('setStat 在减少动效偏好下直接落终值，不进补间帧', () => {
  const { ctrl, elements, frames } = createController({ reduced: true });
  ctrl.setStat(elements.statSources, 10);
  ctrl.setStat(elements.statSources, 50);
  assert.equal(elements.statSources.textContent, '50');
  assert.equal(frames.length, 0);
});

test('setStat 数值变化时做 520ms 补间，终点收敛到目标值', () => {
  const { ctrl, elements, tick } = createController();
  ctrl.setStat(elements.statSources, 0);
  ctrl.setStat(elements.statSources, 100);
  tick(260);   // 半程：缓动未到终值但应在区间内
  const midway = Number(elements.statSources.textContent);
  assert.ok(midway > 0 && midway < 100, `补间半程应介于区间，实际 ${midway}`);
  tick(600);   // 越过终点：收敛终值且不再排队帧
  assert.equal(elements.statSources.textContent, '100');
});

test('refreshStats 刷新塔台数字、星标徽标与采集状态', async () => {
  const { ctrl, elements } = createController({
    stats: { sources: 12, today: 30, featuredToday: 5, starred: 3, articles: 200, pipeline: { running: true }, aiConfigured: true }
  });
  const s = await ctrl.refreshStats();
  assert.equal(s.today, 30);
  assert.equal(elements.tabStarredCount.hidden, false);
  assert.equal(elements.tabStarredCount.textContent, '3');
  assert.match(elements.statStatus.innerHTML, /pulse-dot busy/);
  assert.equal(elements.statStatusLabel.textContent, '采集中');
  assert.equal(elements.feedBanner.hidden, true);
});

test('星标数超过 99 折叠为 99+，星标视图不弹降级横幅', async () => {
  const { ctrl, elements } = createController({
    view: 'starred',
    stats: { sources: 1, today: 0, featuredToday: 0, starred: 150, aiConfigured: false }
  });
  await ctrl.refreshStats();
  assert.equal(elements.tabStarredCount.textContent, '99+');
  assert.equal(elements.feedBanner.hidden, true);
});

test('未配置 AI 且处于精选视图时展示降级横幅', async () => {
  const { ctrl, elements } = createController({
    view: 'featured',
    stats: { sources: 1, today: 0, featuredToday: 0, starred: 0, aiConfigured: false }
  });
  await ctrl.refreshStats();
  assert.equal(elements.feedBanner.hidden, false);
  assert.match(elements.feedBanner.innerHTML, /关键词启发式/);
});

test('refreshStats 后端失败时静默返回 undefined，不抛出', async () => {
  const { ctrl } = createController({ stats: 'fail' });
  assert.equal(await ctrl.refreshStats(), undefined);
});
