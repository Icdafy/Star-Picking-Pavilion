'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { settleAll } = require('../server/async-work');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

function schedulerFixture(t, overrides = {}) {
  const events = [], intervals = [], timers = [];
  let clock = Date.parse('2026-10-07T00:00:00Z');
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const settings = { collect: { intervalMinutes: 10, analyzeIntervalSeconds: 75 }, ai: {}, dailyReportHour: 8 };
  const dependencies = {
    'node-cron': { schedule: () => ({ stop() {}, destroy() {} }) },
    './collectors': { collectAll: async () => { events.push('collect'); await overrides.collect?.(); return { results: [], skipped: 0 }; } },
    './ai/pipeline': {
      analyzePending: async () => { events.push('analyze'); await overrides.analyze?.(); return { analyzed: 0 }; },
      rescoreAfterClustering: () => { events.push('rescore'); return { changed: 0 }; }
    },
    './ai/stories': {
      groupPending: async options => { events.push(options.limit === 1000 ? 'tail' : 'group'); await overrides.group?.(options); return { processed: 0 }; },
      digestStories: async () => {}, consolidateStories: async () => ({ merged: 0 })
    },
    './ai/hot': { computeHotRanking: () => events.push('hot'), snapshotHeat() {} },
    './ai/daily': { generateDaily() {} },
    './ai/reports': { generatePeriod() {}, previousPeriodKey() {}, enhanceLeads: async () => {} },
    './ai/receipts': { pruneReceipts() {} },
    './retention': { pruneDatabase: () => ({ removedArticles: 0, removedReports: 0 }) },
    './config': { loadSettings: () => settings },
    './schedule-policy': require('../server/schedule-policy'),
    './db': { db: {}, DATABASE_PATH: 'fixture' },
    './database-maintenance': { compactDatabase: () => ({ skipped: false }) }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server/scheduler.js'), 'utf8'), {
    module, require: name => { if (!dependencies[name]) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; },
    console: { log() {}, warn() {}, error() {} },
    Date: FixtureDate,
    setInterval: (callback, ms) => { const item = { callback, ms, active: true }; intervals.push(item); return item; },
    clearInterval: timer => { timer.active = false; },
    setTimeout: (callback, ms) => { if (ms <= 25) return setTimeout(callback, ms); const item = { callback, ms, dueAt: clock + ms }; timers.push(item); return item; },
    clearTimeout: timer => { if (timer?.callback) timer.cancelled = true; else clearTimeout(timer); }
  });
  const scheduler = module.exports;
  t.after(() => scheduler.stopScheduler());
  const advance = async ms => {
    const end = clock + ms;
    while (true) {
      const timer = timers.filter(timer => !timer.cancelled && !timer.fired && timer.dueAt <= end).sort((a, b) => a.dueAt - b.dueAt)[0];
      if (!timer) break;
      clock = timer.dueAt; timer.fired = true; await timer.callback(); await tick();
    }
    clock = end;
  };
  return { scheduler, settings, events, intervals, timers, advance, elapse: ms => { clock += ms; }, clock: () => clock };
}

test('a failed parallel branch waits for its siblings before releasing the caller', async () => {
  const gate = deferred();
  let finished = false;
  const operation = settleAll([Promise.reject(new Error('failed')), gate.promise]).catch(error => { finished = true; throw error; });
  const assertion = assert.rejects(operation, /failed/);
  await tick();
  assert.equal(finished, false);
  gate.resolve('done');
  await assertion;
});

test('manual runs share one complete pipeline and its final grouping remains busy', async t => {
  const tail = deferred();
  t.after(() => tail.resolve());
  const { scheduler, events } = schedulerFixture(t, { group: options => options.limit === 1000 ? tail.promise : undefined });
  const first = scheduler.runPipeline('manual');
  const second = scheduler.runPipeline('manual');
  assert.equal(first, second);
  await tick();
  assert.equal(events.filter(event => event === 'collect').length, 1);
  assert.equal(events.filter(event => event === 'tail').length, 1);
  assert.equal(scheduler.getStatus().running, true);
  assert.equal(scheduler.getStatus().pipelineRunning, true);
  assert.equal((await scheduler.analyzeOnce()).skipped, true);
  assert.equal((await scheduler.collectOnce()).skipped, true);
  assert.equal(scheduler.pruneOnce().skipped, true);
  assert.equal(scheduler.compactOnce().skipped, true);
  let idle = false;
  const waiting = scheduler.waitForSchedulerIdle().then(() => { idle = true; });
  await tick();
  assert.equal(idle, false);
  tail.resolve();
  await first;
  await waiting;
  assert.equal(scheduler.getStatus().running, false);
  assert.equal(scheduler.getStatus().lastPipeline.ok, true);
});

test('a manual request waits for the current analysis batch before collecting', async t => {
  const batch = deferred();
  t.after(() => batch.resolve());
  const { scheduler, events } = schedulerFixture(t, { analyze: () => batch.promise });
  const background = scheduler.analyzeOnce();
  const manual = scheduler.runPipeline();
  await tick();
  assert.equal(events.includes('collect'), false);
  batch.resolve();
  await background;
  await manual;
  assert.equal(events.filter(event => event === 'collect').length, 1);
});

test('shutdown drains a pipeline tail and admits no new stages or jobs', async t => {
  const tail = deferred();
  t.after(() => tail.resolve());
  const { scheduler, events } = schedulerFixture(t, { group: options => options.limit === 1000 ? tail.promise : undefined });
  const run = scheduler.runPipeline();
  await tick();
  scheduler.stopScheduler();
  const before = events.length;
  assert.equal((await scheduler.runPipeline()).reason, 'stopping');
  assert.equal((await scheduler.collectOnce()).reason, 'stopping');
  assert.equal((await scheduler.analyzeOnce()).reason, 'stopping');
  assert.equal(scheduler.compactOnce().reason, 'stopping');
  tail.resolve();
  assert.equal((await run).reason, 'stopping');
  await scheduler.waitForSchedulerIdle();
  assert.equal(events.length, before);
});

test('failed pipelines release their lock and can be retried', async t => {
  let failing = true;
  const { scheduler } = schedulerFixture(t, { collect: () => { if (failing) throw new Error('offline'); } });
  await assert.rejects(scheduler.runPipeline(), /offline/);
  assert.equal(scheduler.getStatus().running, false);
  assert.equal(scheduler.getStatus().lastPipeline.ok, false);
  failing = false;
  await scheduler.runPipeline();
  assert.equal(scheduler.getStatus().lastPipeline.ok, true);
});

test('saved intervals replace existing timers without scheduling a second startup run', t => {
  const { scheduler, settings, intervals, timers } = schedulerFixture(t);
  scheduler.startScheduler();
  assert.equal(intervals.filter(timer => timer.active).length, 1);
  const startupCount = timers.filter(timer => timer.ms === 2500).length;
  settings.collect.intervalMinutes = 37;
  settings.collect.analyzeIntervalSeconds = 90;
  assert.equal(scheduler.refreshSchedulerSettings(), true);
  assert.deepEqual(intervals.filter(timer => timer.active).map(timer => timer.ms), [90000]);
  assert.equal(timers.filter(timer => !timer.cancelled && timer.ms === 37 * 60000).length, 1);
  assert.equal(timers.filter(timer => timer.ms === 2500).length, startupCount);
  assert.equal(scheduler.refreshSchedulerSettings(), false);
  assert.equal(scheduler.getStatus().activeSchedule.collectionIntervalMs, 37 * 60000);
  scheduler.stopScheduler();
  assert.equal(intervals.filter(timer => timer.active).length, 0);
  assert.equal(scheduler.refreshSchedulerSettings(), false);
});

test('1, 17, 37, 60, 90 and 720 minute schedules fire only at their exact deadline', async t => {
  for (const minutes of [1, 17, 37, 60, 90, 720]) {
    const fixture = schedulerFixture(t);
    fixture.settings.collect.intervalMinutes = minutes;
    fixture.scheduler.startScheduler();
    await fixture.advance(2500); // 启动采集完成是下一次间隔的起点
    assert.equal(fixture.events.filter(event => event === 'collect').length, 1);
    await fixture.advance(minutes * 60000 - 1);
    assert.equal(fixture.events.filter(event => event === 'collect').length, 1);
    await fixture.advance(1);
    assert.equal(fixture.events.filter(event => event === 'collect').length, 2);
    await fixture.advance(minutes * 60000);
    assert.equal(fixture.events.filter(event => event === 'collect').length, 3);
    fixture.scheduler.stopScheduler();
    await fixture.advance(minutes * 60000);
    assert.equal(fixture.events.filter(event => event === 'collect').length, 3);
  }
});

test('manual collection cancels the old deadline and waits a whole interval after completion', async t => {
  const fixture = schedulerFixture(t);
  fixture.scheduler.startScheduler();
  await fixture.advance(2500 + 9 * 60000);
  await fixture.scheduler.runPipeline('manual');
  const count = () => fixture.events.filter(event => event === 'collect').length;
  assert.equal(count(), 2);
  await fixture.advance(60000); // 原来的自动采集时间
  assert.equal(count(), 2);
  await fixture.advance(9 * 60000);
  assert.equal(count(), 3);
});

test('long collection and interval changes cannot leave a second collection timer', async t => {
  const gate = deferred(); t.after(() => gate.resolve());
  const fixture = schedulerFixture(t, { collect: () => gate.promise });
  fixture.scheduler.startScheduler();
  const run = fixture.scheduler.runPipeline('manual');
  await tick();
  fixture.elapse(20 * 60000);
  fixture.settings.collect.intervalMinutes = 37;
  fixture.scheduler.refreshSchedulerSettings();
  assert.equal(fixture.scheduler.getStatus().nextCollectAt, null);
  gate.resolve(); await run;
  assert.equal(Date.parse(fixture.scheduler.getStatus().nextCollectAt) - fixture.clock(), 37 * 60000);
  assert.equal(fixture.timers.filter(timer => !timer.cancelled && !timer.fired && timer.ms === 37 * 60000).length, 1);
});

test('changing only analysis cadence preserves the current collection deadline', async t => {
  const fixture = schedulerFixture(t); fixture.scheduler.startScheduler();
  await fixture.advance(2500 + 60000);
  const deadline = fixture.scheduler.getStatus().nextCollectAt;
  fixture.settings.collect.analyzeIntervalSeconds = 90;
  assert.equal(fixture.scheduler.refreshSchedulerSettings(), true);
  assert.equal(fixture.scheduler.getStatus().nextCollectAt, deadline);
  assert.equal(fixture.intervals.filter(timer => timer.active && timer.ms === 90000).length, 1);
});
