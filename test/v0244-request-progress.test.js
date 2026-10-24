'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chat } = require('../server/ai/deepseek');
const { createProgressTracker, runWithProgress } = require('../server/task-progress');

const messages = [{ role: 'system', content: 'private-system-prompt' }, { role: 'user', content: 'private-user-prompt' }];
function options(api, fetchImpl) {
  return { settings: { ai: { api, apiKey: 'sk-fake-private-fixture-key', baseUrl: 'http://127.0.0.1:4321/private-endpoint',
    model: 'local-test-model', activeProvider: 'custom', providerName: 'fixture' } }, fetchImpl };
}
function success(api) {
  return new Response(JSON.stringify(api === 'anthropic-messages'
    ? { content: [{ type: 'text', text: '{"ok":true}' }] }
    : { choices: [{ message: { content: '{"ok":true}' } }] }));
}
function assertPrivate(events) {
  assert.doesNotMatch(JSON.stringify(events), /private-system-prompt|private-user-prompt|sk-fake-private|127\.0\.0\.1|private-endpoint|private-provider-payload|headers|Authorization|apiKey/);
}

for (const api of ['openai-chat-completions', 'anthropic-messages']) {
  test(`${api} rate limiting reports waiting, retry attempt, resumed request and completion`, async () => {
    const events = [];
    let requests = 0;
    const value = await runWithProgress(event => events.push(event), () => chat(messages, options(api, async () => {
      if (++requests === 1) return new Response('private-provider-payload', { status: 429, headers: { 'retry-after': '0' } });
      return success(api);
    })));
    assert.equal(value, '{"ok":true}');
    assert.equal(requests, 2);
    assert.equal(events[0].status, 'running');
    const waitingIndex = events.findIndex(event => event.status === 'retrying');
    assert.ok(waitingIndex > 0);
    assert.equal(events[waitingIndex].label, '模型限流等待');
    assert.equal(events[waitingIndex].attempt, 2);
    assert.equal(events[waitingIndex].retryInMs, 0);
    assert.ok(events.slice(waitingIndex + 1).some(event => event.status === 'running' && event.attempt === 2));
    assert.equal(events.at(-1).status, 'completed');
    assert.ok(events.every(event => event.taskOnly === true && event.stage === 'request'));
    assert.equal(new Set(events.map(event => event.taskId)).size, 1);
    assertPrivate(events);
  });

  test(`${api} transport retry exposes its backoff while retaining a single active task`, async () => {
    const events = [];
    const tracker = createProgressTracker({ phase: 'analyzing' });
    let requests = 0;
    const value = await runWithProgress(event => { events.push(event); tracker.update(event); }, () => chat(messages, options(api, async () => {
      if (++requests === 1) throw new Error('private-provider-payload http://127.0.0.1:4321/private-endpoint');
      assert.equal(tracker.snapshot().activeTasks.length, 1);
      return success(api);
    })));
    assert.equal(value, '{"ok":true}');
    const waiting = events.find(event => event.status === 'retrying');
    assert.equal(waiting.label, '网络重试等待');
    assert.equal(waiting.retryInMs, 500);
    assert.equal(waiting.attempt, 2);
    assert.equal(events.at(-1).status, 'completed');
    assert.equal(tracker.snapshot().activeTasks.length, 0);
    assertPrivate(events);
  });

  test(`${api} terminal provider errors clear the active request and only expose a generic warning`, async () => {
    const events = [];
    const tracker = createProgressTracker({ phase: 'analyzing' });
    await assert.rejects(runWithProgress(event => { events.push(event); tracker.update(event); }, () => chat(messages,
      options(api, async () => new Response('private-provider-payload sk-fake-private-fixture-key', { status: 403 })))), /403/);
    assert.equal(events.at(-1).status, 'failed');
    assert.match(events.at(-1).warning, /模型请求失败/);
    assert.equal(tracker.snapshot().activeTasks.length, 0);
    assert.equal(tracker.snapshot().warnings.length, 1);
    assertPrivate(events);
    assertPrivate(tracker.snapshot());
  });

  test(`${api} broken observers cannot change a successful paid request or trigger another request`, async () => {
    let requests = 0, reports = 0;
    const value = await runWithProgress(() => { reports++; throw new Error('observer failure'); }, () => chat(messages,
      options(api, async () => { requests++; return success(api); })));
    assert.equal(value, '{"ok":true}');
    assert.equal(requests, 1);
    assert.ok(reports >= 2);
  });
}
