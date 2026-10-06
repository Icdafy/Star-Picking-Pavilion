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
    setInterval: (callback, ms) => { const item = { callback, ms, active: true }; intervals.push(item); return item; },
    clearInterval: timer => { timer.active = false; },
    setTimeout: (callback, ms) => { if (ms <= 25) return setTimeout(callback, ms); const item = { callback, ms }; timers.push(item); return item; },
    clearTimeout: timer => { if (timer?.callback) timer.cancelled = true; else clearTimeout(timer); }
  });
  const scheduler = module.exports;
  t.after(() => scheduler.stopScheduler());
  return { scheduler, settings, events, intervals, timers };
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
  assert.equal(intervals.filter(timer => timer.active).length, 2);
  const startupCount = timers.length;
  settings.collect.intervalMinutes = 37;
  settings.collect.analyzeIntervalSeconds = 90;
  assert.equal(scheduler.refreshSchedulerSettings(), true);
  assert.deepEqual(intervals.filter(timer => timer.active).map(timer => timer.ms), [37 * 60000, 90000]);
  assert.equal(timers.length, startupCount);
  assert.equal(scheduler.refreshSchedulerSettings(), false);
  assert.equal(scheduler.getStatus().activeSchedule.collectionIntervalMs, 37 * 60000);
  scheduler.stopScheduler();
  assert.equal(intervals.filter(timer => timer.active).length, 0);
  assert.equal(scheduler.refreshSchedulerSettings(), false);
});
