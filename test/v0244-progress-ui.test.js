'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pipelinePresentation, createStatsController, duration } = require('../renderer/stats-controller');
const { normalizeActivity } = require('../renderer/fluid-cloud');

const base = { phase: 'analyzing', stageLabel: '双独立评分与内容理解', stageDone: 4, stageTotal: 20,
  sourcesCompleted: 201, sourcesTotal: 201, collected: 20, analyzed: 4, featured: 2, remaining: 16,
  elapsedMs: 74000, stageElapsedMs: 12000, message: '预筛完成后，三项研判并行执行。' };

test('current step progress replaces completed source fraction and exposes queue and both clocks', () => {
  const view = pipelinePresentation({ activity: 'collecting', pipelineProgress: base });
  assert.equal(view.label, '双独立评分与内容理解');
  assert.equal(view.ratio, .2);
  assert.equal(view.value, '4/20 · 1分14秒');
  assert.match(view.detail, /信源 201\/201/);
  assert.match(view.detail, /待分析 16 条；已用 1分14秒；当前步骤 12秒/);
  assert.equal(view.busy, true);
});

test('unknown workload and empty workload never invent an overall fraction after source completion', () => {
  for (const stageTotal of [null, undefined, 0]) {
    const view = pipelinePresentation({ activity: 'collecting', pipelineProgress: { ...base, stageTotal } });
    assert.equal(view.ratio, null);
    assert.equal(view.value, '1分14秒');
    assert.equal(normalizeActivity('pipeline', { progress: view.ratio }).progress, null);
  }
  assert.equal(normalizeActivity('zero', { progress: 0 }).progress, 0);
  const legacy = pipelinePresentation({ activity: 'collecting', pipelineProgress: { phase: 'collecting', sourcesCompleted: 2, sourcesTotal: 10 } });
  assert.equal(legacy.ratio, .2);
  assert.equal(pipelinePresentation({ activity: 'collecting', pipelineProgress: { phase: 'collecting-analyzing', sourcesCompleted: 201, sourcesTotal: 201 } }).ratio, null);
});

test('parallel tasks explain retry waits and stage history distinguishes partial and completed work', () => {
  const view = pipelinePresentation({ activity: 'collecting', pipelineProgress: { ...base,
    activeTasks: [{ id: 'model-1', label: '第一次独立评分', current: '<img src=x onerror=alert(1)>', elapsedMs: 18000,
      status: 'retrying', attempt: 2, retryInMs: 5000 }],
    stages: [{ stage: 'collecting', label: '捕捉信源', done: 201, total: 201, elapsedMs: 60000, status: 'completed' },
      { stage: 'analyzing', label: '研判资料', done: 4, total: 20, elapsedMs: 12000, status: 'running' }],
    warnings: ['模型限流，正在退避后重试。'] } });
  assert.match(view.sections[0].lines[0], /第一次独立评分 · <img.*重试第 2 次 · 5秒后重试 · 已用 18秒/);
  assert.match(view.sections[1].label, /并行步骤耗时不相加/);
  assert.match(view.sections[1].lines[0], /201\/201 · 1分0秒 · 已完成/);
  assert.match(view.sections[1].lines[1], /4\/20 · 12秒 · 进行中/);
  assert.deepEqual(view.sections[2].lines, ['模型限流，正在退避后重试。']);
});

test('task truncation discloses total work instead of hiding additional parallel activity', () => {
  const view = pipelinePresentation({ activity: 'collecting', pipelineProgress: { ...base, activeTaskCount: 19,
    activeTasks: Array.from({ length: 16 }, (_, id) => ({ id, label: `任务${id}` })) } });
  assert.equal(view.sections[0].lines.length, 12);
  assert.equal(view.sections[0].label, '正在处理（共19项，显示前12项）');
});

test('completed, paused and failed runs remain reviewable without showing progress or blocking a new run', () => {
  for (const phase of ['completed', 'paused', 'failed', 'stopped']) {
    const view = pipelinePresentation({ activity: 'online', lastPipeline: { progress: { ...base, phase } } });
    assert.equal(view.busy, false);
    assert.equal(view.terminal, true);
    assert.equal(view.ratio, null);
    assert.match(view.detail, /总用时 1分14秒/);
    assert.equal(view.tone, phase === 'failed' ? 'error' : phase === 'completed' ? 'ready' : 'info');
  }
  assert.equal(pipelinePresentation({ activity: 'online' }).terminal, false);
});

test('latest activity controls accessible status, the run record and completion callback together', () => {
  const attributes = {};
  const elements = {
    statStatus: { innerHTML: '' }, statStatusLabel: { textContent: '' },
    btnRefresh: { classList: { toggle() {} }, setAttribute: (key, value) => attributes[key] = value },
    collectScheduleStatus: { textContent: '' }, pipelineRunDetails: { hidden: true },
    pipelineRunSummary: { textContent: '' }, pipelineRunLines: { textContent: '' }
  };
  const activity = [];
  const controller = createStatsController({ api: async () => {}, state: {}, elements,
    now: () => 0, frame() {}, prefersReducedMotion: () => true, onActivity: view => activity.push(view) });
  controller.renderActivity({ revision: 11, activity: 'collecting', pipelineProgress: base });
  assert.equal(elements.btnRefresh.disabled, true);
  assert.equal(elements.pipelineRunDetails.hidden, false);
  assert.match(elements.pipelineRunSummary.textContent, /当前步骤 4\/20/);
  controller.renderActivity({ revision: 12, activity: 'online', pipelineProgress: { ...base, phase: 'paused',
    warnings: ['本小时预算已用完，16条保留待分析。'] } });
  assert.equal(elements.btnRefresh.disabled, false);
  assert.equal(attributes['aria-busy'], 'false');
  assert.equal(elements.statStatusLabel.textContent, '在线');
  assert.match(elements.pipelineRunLines.textContent, /本小时预算已用完/);
  assert.equal(activity.at(-1).label, '本轮暂缓');
  assert.equal(activity.at(-1).progress.phase, 'paused');
  controller.renderActivity({ revision: 10, activity: 'collecting', pipelineProgress: base });
  assert.equal(elements.btnRefresh.disabled, false);
  assert.equal(activity.length, 2);
});

test('elapsed format shows observed time without estimating remaining time', () => {
  assert.equal(duration(0), '0秒');
  assert.equal(duration(999), '0秒');
  assert.equal(duration(61000), '1分1秒');
  assert.equal(duration(3720000), '1小时2分');
  assert.equal(duration(-1), '—');
  assert.equal(duration(null), '—');
});
