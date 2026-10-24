'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProgressTracker, runWithProgress, beginTask } = require('../server/task-progress');
const { chat } = require('../server/ai/deepseek');

function fixture() {
  let at = 0;
  return { tracker: createProgressTracker({ phase: 'analyzing' }, { now: () => at }),
    advance: value => { at += value; } };
}

test('parallel stage tasks keep independent clocks and request 1/1 never replaces stage totals', () => {
  const { tracker, advance } = fixture();
  tracker.update({ stage: 'collecting', taskId: 'source:1', status: 'running', done: 0, total: 2 });
  advance(10);
  tracker.update({ stage: 'scoring', done: 0, total: 40 });
  tracker.update({ stage: 'scoring', taskId: 'score:1', status: 'running', done: 0, total: 1 });
  advance(10);
  tracker.update({ stage: 'understanding', taskId: 'understand:1', status: 'running', done: 0, total: 1 });
  tracker.update({ stage: 'request', taskId: 'request:1', taskOnly: true, status: 'running', done: 0, total: 1 });
  advance(20);
  let progress = tracker.snapshot();
  assert.equal(progress.analysisStage, 'understanding');
  assert.equal(progress.stageTotal, null, 'an individual understanding task has no batch denominator');
  assert.equal(progress.stages.find(row => row.stage === 'collecting').status, 'running');
  assert.equal(progress.stages.find(row => row.stage === 'collecting').elapsedMs, 40);
  assert.equal(progress.stages.find(row => row.stage === 'scoring').elapsedMs, 30);
  tracker.update({ stage: 'scoring', taskId: 'score:1', status: 'completed', done: 1, total: 1 });
  progress = tracker.snapshot();
  assert.equal(progress.stages.find(row => row.stage === 'scoring').total, 40);
  assert.equal(progress.stages.find(row => row.stage === 'scoring').done, 0);
  assert.equal(progress.analysisStage, 'understanding', 'an older task completion cannot steal foreground progress');
  advance(10);
  tracker.update({ stage: 'understanding', taskId: 'understand:1', status: 'completed' });
  progress = tracker.snapshot();
  assert.equal(progress.analysisStage, 'collecting');
  assert.equal(progress.stages.find(row => row.stage === 'understanding').elapsedMs, 30);
  tracker.update({ stage: 'collecting', taskId: 'source:1', status: 'completed', done: 1, total: 2 });
  assert.equal(tracker.snapshot().stages.find(row => row.stage === 'collecting').status, 'running', 'unfinished queued sources do not become complete');
});

test('completed stages stop accumulating time and resumed stages add only active periods', () => {
  const { tracker, advance } = fixture();
  tracker.update({ stage: 'translation', status: 'running', done: 0, total: 8 });
  advance(30);
  tracker.update({ stage: 'translation', status: 'completed', done: 8, total: 8 });
  advance(50);
  assert.equal(tracker.snapshot().stageElapsedMs, 30);
  tracker.update({ stage: 'translation', status: 'running', done: 0, total: 2 });
  advance(20);
  assert.equal(tracker.snapshot().stageElapsedMs, 50);
  tracker.update({ stage: 'translation', status: 'completed', done: 2, total: 2 });
  assert.equal(tracker.snapshot().elapsedMs, 100);
  assert.equal(tracker.snapshot().stages[0].elapsedMs, 50);
});

test('new batch request starts clear the prior 100 percent until new aggregate counts arrive', () => {
  const { tracker, advance } = fixture();
  tracker.update({ stage: 'scoring', batchId: 1, status: 'running', done: 0, total: 40 });
  advance(30);
  tracker.update({ stage: 'scoring', batchId: 1, status: 'completed', done: 40, total: 40 });
  assert.equal(tracker.snapshot().stageDone, 40);
  assert.equal(tracker.snapshot().stageTotal, 40);
  advance(20);
  tracker.update({ stage: 'scoring', batchId: 2, taskId: 'score:next-a', status: 'running', done: 0, total: 1 });
  let snapshot = tracker.snapshot();
  assert.equal(snapshot.stageDone, null);
  assert.equal(snapshot.stageTotal, null);
  assert.equal(snapshot.stageElapsedMs, 30, 'scope reset preserves prior batch elapsed time');
  tracker.update({ stage: 'scoring', batchId: 2, taskId: 'score:next-b', status: 'running', done: 0, total: 1 });
  assert.equal(tracker.snapshot().stageTotal, null);
  advance(10);
  tracker.update({ stage: 'scoring', batchId: 2, done: 3, total: 20 });
  tracker.update({ stage: 'scoring', batchId: 2, taskId: 'score:next-c', status: 'running', done: 0, total: 1 });
  snapshot = tracker.snapshot();
  assert.equal(snapshot.stageDone, 3, 'same-batch concurrency preserves current aggregate progress');
  assert.equal(snapshot.stageTotal, 20);
  assert.equal(snapshot.stageElapsedMs, 40);
  tracker.update({ stage: 'scoring', batchId: 2, taskId: 'score:next-a', status: 'completed', done: 1, total: 1 });
  assert.equal(tracker.snapshot().stageDone, 3, 'same-batch task completion does not replace its denominator');
  assert.equal(tracker.snapshot().stageTotal, 20);
  tracker.update({ stage: 'scoring', done: 4, total: 20 });
  assert.equal(tracker.snapshot().stageDone, 4, 'unscoped maintenance remains compatible with aggregate updates');
  assert.doesNotMatch(JSON.stringify(tracker.snapshot()), /batchId|activeSince/);
});

test('unscoped collection and tail events do not reset scoped batch counts by themselves', () => {
  const { tracker } = fixture();
  tracker.update({ stage: 'collecting', taskId: 'source:1', status: 'running', done: 0, total: 201 });
  tracker.update({ stage: 'grouping', batchId: 1, status: 'completed', done: 40, total: 40 });
  tracker.update({ stage: 'collecting', taskId: 'source:1', status: 'completed', done: 1, total: 201 });
  assert.equal(tracker.snapshot().stages.find(row => row.stage === 'collecting').total, 201);
  tracker.update({ stage: 'grouping', batchId: 2, taskId: 'group:next', status: 'running', done: 0, total: 1 });
  assert.equal(tracker.snapshot().stageTotal, null);
  tracker.update({ stage: 'grouping', batchId: 2, status: 'running', done: 1, total: 5 });
  tracker.update({ stage: 'grouping', status: 'running' });
  assert.equal(tracker.snapshot().stageDone, 1);
  assert.equal(tracker.snapshot().stageTotal, 5);
  tracker.update({ stage: 'grouping', status: 'running', done: 0, total: 1000 });
  assert.equal(tracker.snapshot().stageDone, 0);
  assert.equal(tracker.snapshot().stageTotal, 1000, 'tail reports its own actual aggregate');
});

test('bounded active task lists report the full count and keep retry waits visible first', () => {
  const { tracker, advance } = fixture();
  for (let index = 0; index < 19; index++) tracker.update({ stage: 'request', taskOnly: true,
    taskId: `request:${index}`, status: 'running', current: `模型任务 ${index}` });
  tracker.update({ stage: 'request', taskOnly: true, taskId: 'request:18', status: 'retrying', retryInMs: 1000, attempt: 2 });
  advance(300);
  const snapshot = tracker.snapshot();
  assert.equal(snapshot.activeTaskCount, 19);
  assert.equal(snapshot.activeTasks.length, 16);
  assert.equal(snapshot.activeTasks[0].id, 'request:18');
  assert.equal(snapshot.activeTasks[0].status, 'retrying');
  assert.equal(snapshot.activeTasks[0].retryInMs, 700);
  tracker.update({ stage: 'request', taskOnly: true, taskId: 'request:18', status: 'completed' });
  assert.equal(tracker.snapshot().activeTaskCount, 18);
  assert.equal(tracker.snapshot().activeTasks.some(task => task.id === 'request:18'), false);
});

test('budget pauses remove the task and preserve paused stage instead of claiming completion', () => {
  const { tracker, advance } = fixture();
  tracker.update({ stage: 'editorial', status: 'running', done: 1, total: 4 });
  tracker.update({ stage: 'editorial', taskId: 'digest:2', status: 'running' });
  advance(20);
  tracker.update({ stage: 'editorial', taskId: 'digest:2', status: 'paused' });
  assert.equal(tracker.snapshot().activeTasks.length, 0);
  tracker.update({ phase: 'paused', message: '预算已用尽' });
  const paused = tracker.snapshot();
  assert.equal(paused.stages[0].status, 'paused');
  assert.equal(paused.phase, 'paused');
  advance(1000);
  tracker.update({ stage: 'editorial', status: 'completed', done: 4, total: 4, phase: 'completed' });
  assert.deepEqual(tracker.snapshot(), paused, 'finished receipts ignore late observers and freeze all clocks');
});

test('stopped and failed runs retain truthful stage outcomes and partial failures remain visible', () => {
  for (const phase of ['stopped', 'failed']) {
    const { tracker, advance } = fixture();
    tracker.update({ stage: 'scoring', status: 'running', done: 1, total: 5 });
    advance(17);
    tracker.update({ phase });
    assert.equal(tracker.snapshot().stages[0].status, phase);
    advance(100);
    assert.equal(tracker.snapshot().elapsedMs, 17);
  }
  const { tracker } = fixture();
  tracker.update({ stage: 'collecting', taskId: 'source:1', status: 'failed', done: 1, total: 1,
    warning: '一个信源失败，其他结果已保存' });
  tracker.update({ phase: 'completed' });
  assert.equal(tracker.snapshot().stages[0].status, 'failed');
  assert.equal(tracker.snapshot().warnings.length, 1);
});

test('request retries expose bounded countdowns and numeric attempt counts without changing phase', () => {
  const { tracker, advance } = fixture();
  tracker.update({ stage: 'scoring', done: 8, total: 40 });
  tracker.update({ stage: 'request', taskOnly: true, taskId: 'request:1', status: 'retrying', attempt: 2,
    retryInMs: 1500, label: '模型限流等待' });
  advance(600);
  const progress = tracker.snapshot();
  assert.equal(progress.stageTotal, 40);
  assert.equal(progress.activeTasks[0].retryInMs, 900);
  assert.equal(progress.activeTasks[0].attempt, 2);
  tracker.update({ stage: 'request', taskOnly: true, taskId: 'request:1', status: 'running' });
  assert.equal(tracker.snapshot().activeTasks[0].retryInMs, null);
  tracker.update({ stage: 'request', taskOnly: true, taskId: 'request:1', status: 'failed' });
  assert.equal(tracker.snapshot().activeTasks.length, 0);
});

test('snapshots whitelist public fields and redact credentials and addresses in displayed strings', () => {
  const { tracker } = fixture();
  tracker.update({ stage: 'content', taskId: 'content:1', status: 'running',
    current: { title: '标题 https://private.test/?token=secret sk-private-key' },
    error: 'secret provider response', headers: { Authorization: 'Bearer secret' },
    url: 'https://private.test', prompts: ['secret prompt'], settings: { apiKey: 'secret key' },
    warning: '见 https://private.test Bearer secret-token', message: '使用 sk-example-private-token' });
  const json = JSON.stringify(tracker.snapshot());
  assert.doesNotMatch(json, /private\.test|sk-private|sk-example|secret-token|secret provider|secret prompt|secret key|headers|Authorization|settings|prompts/);
  assert.match(json, /地址已隐藏/);
  assert.match(json, /密钥已隐藏/);
});

test('async request observers stay isolated between concurrent runs and observer failure cannot fail work', async () => {
  const a = [], b = [];
  await Promise.all([
    runWithProgress(event => a.push(event), async () => { const task = beginTask({ label: 'A' }); await Promise.resolve(); task.end(); }),
    runWithProgress(event => b.push(event), async () => { const task = beginTask({ label: 'B' }); await Promise.resolve(); task.end(); })
  ]);
  assert.deepEqual(a.map(event => [event.label, event.status]), [['A', 'running'], ['A', 'completed']]);
  assert.deepEqual(b.map(event => [event.label, event.status]), [['B', 'running'], ['B', 'completed']]);
  await runWithProgress(() => { throw new Error('observer unavailable'); }, async () => {
    const task = beginTask(); task.update({ status: 'retrying' }); task.end();
  });
});

test('actual model requests report retries and failures without exposing payload, endpoint or credentials', async () => {
  const events = [];
  const options = { settings: { ai: { apiKey: 'sk-secret-local-fixture', baseUrl: 'http://127.0.0.1:4321/private',
    model: 'local-fixture', activeProvider: 'custom', providerName: 'fixture' } },
    fetchImpl: async () => { if (events.some(event => event.status === 'retrying')) return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
      return new Response('private rejected body sk-secret-local-fixture', { status: 429, headers: { 'retry-after': '0' } }); } };
  const value = await runWithProgress(event => events.push(event), () => chat([{ role: 'user', content: 'private prompt' }], options));
  assert.equal(value, '{"ok":true}');
  assert.ok(events.some(event => event.status === 'retrying' && event.attempt === 2 && event.retryInMs === 0));
  assert.equal(events.at(-1).status, 'completed');
  assert.doesNotMatch(JSON.stringify(events), /private prompt|private rejected|sk-secret|127\.0\.0\.1|Authorization|headers/);
  const failure = [];
  await assert.rejects(runWithProgress(event => failure.push(event), () => chat([], {
    ...options, fetchImpl: async () => new Response('private failure payload', { status: 403 })
  })), /403/);
  assert.equal(failure.at(-1).status, 'failed');
  assert.doesNotMatch(JSON.stringify(failure), /private failure payload|sk-secret|127\.0\.0\.1/);
});
