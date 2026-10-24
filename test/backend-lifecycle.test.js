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
  const events = [], intervals = [], timers = [], cronTasks = [];
  let clock = Date.parse('2026-10-07T00:00:00Z');
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const settings = { collect: { automatic: overrides.automatic ?? true, intervalMinutes: 10, analyzeIntervalSeconds: 75 }, ai: {}, dailyReportHour: 8 };
  const dependencies = {
    'node-cron': { schedule: (expression, callback) => {
      const task = { expression, callback, active: true, start() { this.active = true; }, stop() { this.active = false; }, destroy() {} };
      cronTasks.push(task); return task;
    } },
    './collectors': { collectAll: async onProgress => { events.push('collect'); await overrides.collect?.(onProgress); return { results: [], skipped: 0 }; } },
    './ai/pipeline': {
      pendingAnalysisCount: () => overrides.remaining?.() || 0,
      analyzePending: async (onProgress, limit, options) => { events.push('analyze'); return await overrides.analyze?.(onProgress, limit, options) || { analyzed: 0 }; },
      rescoreAfterClustering: () => { events.push('rescore'); return { changed: 0 }; }
    },
    './ai/stories': {
      groupPending: async options => { events.push(options.limit === 1000 ? 'tail' : 'group'); return await overrides.group?.(options) || { processed: 0 }; },
      digestStories: async () => {}, consolidateStories: async () => ({ merged: 0 })
    },
    './ai/hot': { computeHotRanking: () => events.push('hot'), snapshotHeat() {} },
    './ai/daily': { generateDaily() {} },
    './ai/reports': { generatePeriod() {}, previousPeriodKey() {}, enhanceLeads: async () => {} },
    './ai/receipts': { pruneReceipts() { events.push('pruneReceipts'); } },
    './retention': { pruneDatabase: () => { events.push('prune'); return overrides.prune?.() || { removedArticles: 0, removedReports: 0 }; } },
    './config': { loadSettings: () => settings },
    './schedule-policy': require('../server/schedule-policy'),
    './task-progress': require('../server/task-progress'),
    './db': { db: {}, DATABASE_PATH: 'fixture' },
    './database-maintenance': { compactDatabase: () => { events.push('compact'); return { skipped: false }; } }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server/scheduler.js'), 'utf8'), {
    module, require: name => { if (!dependencies[name]) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; },
    console: { log() {}, warn() {}, error() {} },
    Date: FixtureDate,
    setImmediate,
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
  return { scheduler, settings, events, intervals, timers, cronTasks, advance, elapse: ms => { clock += ms; }, clock: () => clock };
}

test('automatic cleanup opt-out blocks scheduled deletion and compaction without stopping collection or manual maintenance', async t => {
  const { scheduler, settings, events, timers, cronTasks } = schedulerFixture(t);
  scheduler.startScheduler();
  const cleanup = cronTasks.find(task => task.expression === '25 8 * * *');
  assert.ok(cleanup);
  cleanup.callback();
  assert.deepEqual(events, ['pruneReceipts', 'prune', 'compact']);
  const collectionTimer = timers.find(timer => !timer.cancelled);

  settings.collect.automaticCleanup = false;
  assert.equal(scheduler.refreshSchedulerSettings(), true);
  assert.equal(scheduler.getStatus().activeSchedule.enabled, true);
  assert.equal(scheduler.getStatus().activeSchedule.automaticCleanup, false);
  assert.equal(collectionTimer.cancelled, undefined, 'cleanup preference must not reset collection deadline');
  events.length = 0;
  cleanup.callback();
  assert.deepEqual(events, [], 'the already registered callback must honor the disabled setting');
  assert.equal((await scheduler.requestPrune('manual').completion).ok, true);
  assert.deepEqual(events, ['prune'], 'manual cleanup remains available');

  settings.collect.automaticCleanup = true;
  assert.equal(scheduler.refreshSchedulerSettings(), true);
  events.length = 0;
  cleanup.callback();
  assert.deepEqual(events, ['pruneReceipts', 'prune', 'compact']);
  settings.collect.automatic = false;
  scheduler.refreshSchedulerSettings();
  events.length = 0;
  cleanup.callback();
  assert.deepEqual(events, [], 'automatic cleanup remains coupled to automatic collection');
});

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

test('ready articles are analyzed and grouped before the slowest source finishes', async t => {
  const source = deferred(); t.after(() => source.resolve());
  let analysisCalls = 0;
  const fixture = schedulerFixture(t, {
    collect: async progress => { progress({ source: 'fast', added: 2, completed: 1, total: 2 }); await source.promise; },
    analyze: (_progress, limit) => limit === 0 ? { analyzed: 0 } : { analyzed: analysisCalls++ === 0 ? 2 : 0, featured: 1 }
  });
  const run = fixture.scheduler.runPipeline();
  await tick();
  const status = fixture.scheduler.getStatus();
  assert.equal(status.collectRunning, true);
  assert.equal(status.pipelineProgress.sourcesCompleted, 1);
  assert.equal(status.pipelineProgress.sourcesTotal, 2);
  assert.equal(status.pipelineProgress.analyzed, 2);
  assert.ok(fixture.events.includes('group'), '已到资料归组后即可供首屏读取');
  assert.equal(fixture.events.includes('tail'), false);
  source.resolve(); await run;
  assert.equal(fixture.scheduler.getStatus().pipelineProgress.phase, 'completed');
});

test('budget exhaustion waits for collection without hot-looping analysis', async t => {
  const source = deferred(); t.after(() => source.resolve());
  let calls = 0;
  const fixture = schedulerFixture(t, {
    collect: async progress => { progress({ source: 'first', added: 1, completed: 1, total: 2 }); await source.promise;
      progress({ source: 'second', added: 1, completed: 2, total: 2 }); },
    analyze: () => { calls++; return { analyzed: 0, budgetPaused: true, remaining: 2 }; },
    remaining: () => 2
  });
  const run = fixture.scheduler.runPipeline();
  await tick(); await tick();
  assert.equal(calls, 1);
  assert.equal(fixture.scheduler.getStatus().running, true);
  source.resolve();
  const result = await run;
  assert.equal(result.budgetPaused, true);
  assert.equal(result.hasMore, true);
  assert.equal(calls, 1, '预算阻断不重入抽干与付费修补');
  assert.equal(fixture.scheduler.getStatus().pipelineProgress.phase, 'paused');
});

test('a failed collection drains in-flight analysis before another pipeline may run', async t => {
  const article = deferred(), failSource = deferred();
  t.after(() => { article.resolve(); failSource.resolve(); });
  let analyzed = false;
  const fixture = schedulerFixture(t, {
    collect: async () => { await failSource.promise; throw new Error('source failed'); },
    analyze: async () => { await article.promise; analyzed = true; return { analyzed: 0 }; }
  });
  const run = fixture.scheduler.runPipeline();
  const rejected = assert.rejects(run, /source failed/);
  failSource.resolve(); await tick();
  assert.equal(fixture.scheduler.getStatus().pipelineRunning, true);
  assert.equal(analyzed, false);
  article.resolve(); await rejected;
  assert.equal(analyzed, true);
  assert.equal(fixture.scheduler.getStatus().pipelineRunning, false);
  assert.equal(fixture.scheduler.getStatus().pipelineProgress.phase, 'failed');
});

test('UNKNOWN enrichment and translation-only progress receive a follow-up analysis batch', async t => {
  let calls = 0;
  const fixture = schedulerFixture(t, { analyze: (_progress, limit) => {
    if (limit === 0) return { analyzed: 0 };
    calls++;
    return calls === 1 ? { analyzed: 0, retryPending: 1 } : calls === 2
      ? { analyzed: 0, translation: { translated: 1 } } : { analyzed: calls === 3 ? 1 : 0 };
  } });
  const result = await fixture.scheduler.runPipeline();
  assert.equal(result.analyzed, 1);
  assert.equal(calls, 4);
});

test('many individually completed sources do not exhaust the article processing cap', async t => {
  let pending = 0;
  const fixture = schedulerFixture(t, {
    collect: async progress => {
      for (let index = 0; index < 75; index++) {
        pending++;
        progress({ source: String(index), added: 1, completed: index + 1, total: 75 });
        await tick(); await tick();
      }
    },
    analyze: (_progress, limit) => { if (limit === 0) return { analyzed: 0 };
      const count = pending; pending = 0; return { analyzed: count, remaining: pending }; }
  });
  const result = await fixture.scheduler.runPipeline();
  assert.equal(result.analyzed, 75);
  assert.equal(pending, 0);
  assert.equal(result.hasMore, false);
});

test('articles arriving after the 2400 article cap remain visible in final pending status', async t => {
  const slow = deferred(); t.after(() => slow.resolve());
  let analyzed = 0, pending = 0;
  const fixture = schedulerFixture(t, {
    collect: async progress => {
      await slow.promise; pending++;
      progress({ source: 'slow', added: 1, completed: 1, total: 1 });
    },
    analyze: (_progress, limit) => {
      if (!limit) return { analyzed: 0, remaining: pending };
      analyzed += limit;
      if (analyzed === 2400) slow.resolve();
      return { analyzed: limit, remaining: 0 };
    },
    remaining: () => pending
  });
  const result = await fixture.scheduler.runPipeline();
  assert.equal(result.analyzed, 2400);
  assert.equal(result.hasMore, true);
  assert.equal(fixture.scheduler.getStatus().pipelineProgress.phase, 'paused');
});

test('a grouping budget pause remains visible after all articles are already scored', async t => {
  const fixture = schedulerFixture(t, { group: () => ({ processed: 0, budgetPaused: true }) });
  const result = await fixture.scheduler.runPipeline();
  assert.equal(result.analyzed, 0);
  assert.equal(result.budgetPaused, true);
  assert.equal(fixture.scheduler.getStatus().pipelineProgress.phase, 'paused');
});

test('a prune request reserves its lock before acknowledgment and completes exactly once', async t => {
  const { scheduler, events } = schedulerFixture(t);
  const accepted = scheduler.requestPrune();
  assert.equal(accepted.started, true);
  assert.equal(scheduler.getStatus().pruneRunning, true);
  assert.equal(scheduler.requestPrune().started, false);
  assert.equal((await scheduler.collectOnce()).reason, 'maintenance');
  assert.equal((await scheduler.analyzeOnce()).reason, 'maintenance');
  assert.equal(scheduler.compactOnce().skipped, true);
  const completed = await accepted.completion;
  assert.equal(completed.id, accepted.pruneId);
  assert.equal(completed.ok, true);
  assert.equal(events.filter(event => event === 'prune').length, 1);
  assert.equal(scheduler.getStatus().pruneRunning, false);
});

test('busy prune requests do not claim acceptance, and shutdown drains an already accepted prune', async t => {
  const gate = deferred(); t.after(() => gate.resolve());
  const { scheduler } = schedulerFixture(t, { collect: () => gate.promise });
  const pipeline = scheduler.runPipeline();
  assert.equal(scheduler.requestPrune().started, false);
  gate.resolve(); await pipeline;
  const accepted = scheduler.requestPrune();
  scheduler.stopScheduler();
  await scheduler.waitForSchedulerIdle();
  assert.equal((await accepted.completion).ok, true);
  assert.equal(scheduler.requestPrune().reason, 'stopping');
});

test('background prune failures release the lock and expose an identifiable failure for retry', async t => {
  let fail = true;
  const { scheduler } = schedulerFixture(t, { prune: () => { if (fail) throw new Error('SQLITE_IOERR: private fixture path'); } });
  const accepted = scheduler.requestPrune();
  const failure = await accepted.completion;
  assert.equal(failure.id, accepted.pruneId);
  assert.equal(failure.ok, false);
  assert.doesNotMatch(failure.error, /private|SQLITE_IOERR/);
  assert.equal(scheduler.getStatus().pruneRunning, false);
  fail = false;
  assert.equal((await scheduler.requestPrune().completion).ok, true);
});

test('saved intervals replace existing timers without scheduling a second startup run', t => {
  const { scheduler, settings, intervals, timers } = schedulerFixture(t);
  scheduler.startScheduler();
  assert.equal(intervals.filter(timer => timer.active).length, 0);
  const startupCount = timers.filter(timer => timer.ms === 2500).length;
  settings.collect.intervalMinutes = 37;
  settings.collect.analyzeIntervalSeconds = 90;
  assert.equal(scheduler.refreshSchedulerSettings(), true);
  assert.deepEqual(intervals.filter(timer => timer.active).map(timer => timer.ms), []);
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
    assert.equal(fixture.events.filter(event => event === 'collect').length, 0);
    await fixture.advance(minutes * 60000 - 1);
    assert.equal(fixture.events.filter(event => event === 'collect').length, 0);
    await fixture.advance(1);
    assert.equal(fixture.events.filter(event => event === 'collect').length, 1);
    await fixture.advance(minutes * 60000);
    assert.equal(fixture.events.filter(event => event === 'collect').length, 2);
    fixture.scheduler.stopScheduler();
    await fixture.advance(minutes * 60000);
    assert.equal(fixture.events.filter(event => event === 'collect').length, 2);
  }
});

test('manual collection cancels the old deadline and waits a whole interval after completion', async t => {
  const fixture = schedulerFixture(t);
  fixture.scheduler.startScheduler();
  await fixture.advance(9 * 60000);
  await fixture.scheduler.runPipeline('manual');
  const count = () => fixture.events.filter(event => event === 'collect').length;
  assert.equal(count(), 1);
  await fixture.advance(60000); // 原来的自动采集时间
  assert.equal(count(), 1);
  await fixture.advance(9 * 60000);
  assert.equal(count(), 2);
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
  assert.equal(fixture.intervals.filter(timer => timer.active).length, 0);
});

test('default idle performs no collection, analysis or maintenance even after a day', async t => {
  const fixture = schedulerFixture(t, { automatic: false });
  fixture.scheduler.startScheduler();
  await fixture.advance(24 * 60 * 60000);
  assert.deepEqual(fixture.events, []);
  assert.equal(fixture.intervals.length, 0);
  assert.equal(fixture.timers.length, 0);
  assert.equal(fixture.scheduler.getStatus().activity, 'online');
  assert.equal(fixture.scheduler.getStatus().nextCollectAt, null);
});

test('one authoritative status covers collection, analysis and the tail, then becomes online', async t => {
  const gate = deferred(); t.after(() => gate.resolve());
  const fixture = schedulerFixture(t, { automatic: false, group: options => options.limit === 1000 ? gate.promise : undefined });
  fixture.scheduler.startScheduler();
  const states = [];
  const unsubscribe = fixture.scheduler.subscribeStatus(status => states.push(status));
  const run = fixture.scheduler.runPipeline('manual');
  await tick();
  assert.equal(fixture.scheduler.getStatus().activity, 'collecting');
  assert.equal(states[0].activity, 'online');
  assert.ok(states.slice(1).every(status => status.activity === 'collecting'));
  assert.ok(states.some(status => status.collectRunning));
  assert.ok(states.some(status => status.analyzeRunning));
  gate.resolve(); await run;
  assert.equal(states.at(-1).activity, 'online');
  assert.ok(states.every((status, index) => index === 0 || status.revision > states[index - 1].revision));
  assert.equal(fixture.scheduler.getStatus().nextCollectAt, null);
  unsubscribe();
});

test('opting into automatic jobs runs the complete pipeline; turning off leaves no later timer', async t => {
  const fixture = schedulerFixture(t, { automatic: false });
  fixture.scheduler.startScheduler();
  fixture.settings.collect.automatic = true;
  fixture.scheduler.refreshSchedulerSettings();
  await fixture.advance(10 * 60000);
  assert.ok(fixture.events.includes('collect') && fixture.events.includes('analyze') && fixture.events.includes('tail'));
  const completed = [...fixture.events];
  fixture.settings.collect.automatic = false;
  fixture.scheduler.refreshSchedulerSettings();
  await fixture.advance(24 * 60 * 60000);
  assert.deepEqual(fixture.events, completed);
  assert.equal(fixture.scheduler.getStatus().nextCollectAt, null);
});

test('real request and article callbacks reach pipeline snapshots and heartbeat clocks until completion', async t => {
  const { progressTask } = require('../server/ai/progress');
  const { chat } = require('../server/ai/deepseek');
  const gate = deferred();
  t.after(() => gate.resolve());
  let calls = 0;
  const fixture = schedulerFixture(t, {
    automatic: false,
    collect: async progress => {
      progress({ stage: 'collecting', taskId: 'source:1', status: 'running', current: { title: '本地慢源' }, done: 0, total: 1,
        completed: 0, sourcesCompleted: 0, sourcesTotal: 1 });
      progress({ stage: 'collecting', taskId: 'source:1', status: 'completed', current: { title: '本地慢源' }, done: 1, total: 1,
        completed: 1, sourcesCompleted: 1, sourcesTotal: 1, added: 1 });
    },
    analyze: async (onProgress, limit) => {
      if (!limit || calls++) return { analyzed: 0 };
      onProgress({ stage: 'scoring', done: 0, total: 40, message: '真实回调等待模型' });
      await progressTask(onProgress, { stage: 'scoring', taskId: 'score:1', current: { title: '商业航天试验' } },
        () => chat([{ role: 'user', content: 'private-prompt' }], {
          settings: { ai: { apiKey: 'sk-local-secret-fixture', baseUrl: 'http://127.0.0.1:4321/private', model: 'local', activeProvider: 'custom' } },
          fetchImpl: async () => { await gate.promise; return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })); }
        }));
      onProgress({ stage: 'scoring', status: 'completed', done: 1, total: 40 });
      return { analyzed: 1, featured: 1 };
    }
  });
  const snapshots = [];
  fixture.scheduler.subscribeStatus(status => snapshots.push(status));
  const operation = fixture.scheduler.runPipeline();
  await tick();
  const first = fixture.scheduler.getStatus();
  assert.equal(first.pipelineProgress.sourcesCompleted, 1);
  assert.equal(first.pipelineRunning, true);
  assert.equal(first.pipelineProgress.stageTotal, 40);
  assert.equal(first.pipelineProgress.activeTasks.length, 2, 'article task and actual chat request are both observed');
  const revision = first.revision;
  await fixture.advance(3000);
  const later = fixture.scheduler.getStatus();
  assert.ok(later.revision >= revision + 3);
  assert.equal(later.pipelineProgress.elapsedMs, 3000);
  assert.ok(later.pipelineProgress.activeTasks.every(task => task.elapsedMs === 3000));
  assert.equal(later.pipelineProgress.stageDone, 0);
  assert.doesNotMatch(JSON.stringify(later.pipelineProgress), /private-prompt|sk-local|127\.0\.0\.1|headers|Authorization/);
  gate.resolve();
  await operation;
  const finished = fixture.scheduler.getStatus();
  assert.equal(finished.pipelineProgress.phase, 'completed');
  assert.equal(finished.pipelineProgress.activeTasks.length, 0);
  assert.deepEqual(finished.lastPipeline.progress, finished.pipelineProgress);
  const revisions = snapshots.length;
  await fixture.advance(5000);
  assert.deepEqual(fixture.scheduler.getStatus().pipelineProgress, finished.pipelineProgress);
  assert.equal(snapshots.length, revisions, 'completed runs stop heartbeat notifications');
});

test('pipeline defers repeated full-window rescoring to its tail while standalone batches still rescore', async t => {
  let batches = 0;
  const fixture = schedulerFixture(t, { automatic: false, analyze: (_onProgress, limit) => {
    if (!limit) return { analyzed: 0 };
    return { analyzed: ++batches <= 2 ? 2 : 0 };
  } });
  const result = await fixture.scheduler.runPipeline();
  assert.equal(result.analyzed, 4);
  assert.equal(fixture.events.filter(event => event === 'rescore').length, 1);
  assert.equal(fixture.events.filter(event => event === 'group').length, 3);
  assert.equal(fixture.events.filter(event => event === 'tail').length, 1);
  const standalone = schedulerFixture(t, { analyze: () => ({ analyzed: 1 }) });
  await standalone.scheduler.analyzeOnce();
  assert.equal(standalone.events.filter(event => event === 'rescore').length, 1);
});

test('persisted batch results update global counts before return and returning does not count them twice', async t => {
  const gate = deferred();
  t.after(() => gate.resolve());
  let calls = 0, pending = 40, countQueries = 0;
  const fixture = schedulerFixture(t, { automatic: false,
    remaining: () => { countQueries++; return pending; },
    analyze: async (onProgress, limit) => {
      if (!limit || calls++) return { analyzed: 0, featured: 0 };
      pending = 24;
      onProgress({ stage: 'scoring', status: 'running', done: 16, total: 40, featured: 5 });
      onProgress({ stage: 'prefilter', status: 'running', done: 40, total: 40 });
      onProgress({ stage: 'scoring', taskId: 'score:another', status: 'running', done: 0, total: 1 });
      onProgress({ stage: 'scoring', taskId: 'score:another', status: 'completed', done: 1, total: 1 });
      onProgress({ stage: 'scoring', status: 'running', done: 16, total: 40, featured: 5 });
      await gate.promise;
      pending = 0;
      return { analyzed: 40, featured: 8, remaining: 0 };
    }
  });
  const operation = fixture.scheduler.runPipeline();
  await tick();
  let progress = fixture.scheduler.getStatus().pipelineProgress;
  assert.equal(progress.analyzed, 16);
  assert.equal(progress.featured, 5);
  assert.equal(progress.remaining, 24);
  assert.equal(countQueries, 1, 'aggregate callbacks, duplicate events and per-request 1/1 never query the full queue');
  assert.equal(fixture.scheduler.getStatus().analyzeRunning, true);
  gate.resolve();
  const result = await operation;
  progress = fixture.scheduler.getStatus().pipelineProgress;
  assert.equal(result.analyzed, 40);
  assert.equal(result.featured, 8);
  assert.equal(progress.analyzed, 40, 'the batch return replaces its partial progress instead of adding it again');
  assert.equal(progress.featured, 8);
  assert.equal(progress.remaining, 0);
});

test('newly collected articles join the live queue without per-item queries or stale batch snapshot loss', async t => {
  const source = deferred(), batch = deferred();
  t.after(() => { source.resolve(); batch.resolve(); });
  let calls = 0, pending = 40, countQueries = 0;
  const fixture = schedulerFixture(t, { automatic: false,
    remaining: () => { countQueries++; return pending; },
    collect: async progress => {
      await source.promise;
      pending += 3;
      progress({ stage: 'collecting', status: 'completed', taskId: 'source:late',
        source: 'late', added: 3, done: 1, completed: 1, total: 1 });
    },
    analyze: async (onProgress, limit) => {
      if (!limit || calls++) return { analyzed: 0, featured: 0, remaining: pending };
      pending -= 16;
      onProgress({ stage: 'scoring', status: 'running', done: 16, total: 40, featured: 4 });
      await batch.promise;
      return { analyzed: 16, featured: 4, remaining: 24 };
    }
  });
  const snapshots = [];
  fixture.scheduler.subscribeStatus(status => snapshots.push(status));
  const operation = fixture.scheduler.runPipeline();
  await tick();
  assert.equal(fixture.scheduler.getStatus().pipelineProgress.remaining, 24);
  assert.equal(countQueries, 1);
  source.resolve();
  await tick();
  let progress = fixture.scheduler.getStatus().pipelineProgress;
  assert.equal(progress.analyzed, 16);
  assert.equal(progress.featured, 4);
  assert.equal(progress.remaining, 27);
  assert.equal(countQueries, 1, 'source arrivals update the live count by their committed additions');
  const afterArrival = snapshots.length;
  batch.resolve();
  const result = await operation;
  progress = fixture.scheduler.getStatus().pipelineProgress;
  assert.equal(result.analyzed, 16);
  assert.equal(result.featured, 4);
  assert.equal(progress.remaining, 27);
  assert.ok(snapshots.slice(afterArrival).every(status => status.pipelineProgress.remaining === 27),
    'the batch return cannot overwrite newly collected articles using its older remaining snapshot');
});
