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
  const settings = { collect: { automatic: overrides.automatic ?? true, intervalMinutes: 10, analyzeIntervalSeconds: 75 }, ai: {}, dailyReportHour: 8 };
  const dependencies = {
    'node-cron': { schedule: () => ({ stop() {}, destroy() {} }) },
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
    './ai/receipts': { pruneReceipts() {} },
    './retention': { pruneDatabase: () => { events.push('prune'); return overrides.prune?.() || { removedArticles: 0, removedReports: 0 }; } },
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
