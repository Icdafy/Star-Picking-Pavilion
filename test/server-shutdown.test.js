'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createServerShutdownLifecycle } = require('../server/shutdown-lifecycle');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('MessageEvent and direct control messages share one ordered graceful shutdown', async () => {
  const events = [];
  const httpClosed = deferred();
  const schedulerIdle = deferred();
  const lifecycle = createServerShutdownLifecycle({
    stopScheduler: () => events.push('scheduler:stop'),
    closeHttpServer: () => {
      events.push('http:close');
      return httpClosed.promise;
    },
    waitForSchedulerIdle: () => {
      events.push('scheduler:idle');
      return schedulerIdle.promise;
    },
    closeDatabase: () => events.push('database:close'),
    notifyStoppedAndExit: message => events.push(['notify', message])
  });

  const first = lifecycle.handleControlMessage({
    type: 'message',
    data: { type: 'server:shutdown' }
  });
  const second = lifecycle.handleControlMessage({ type: 'server:shutdown' });

  assert.equal(first, second);
  assert.deepEqual(events, ['scheduler:stop', 'http:close', 'scheduler:idle']);

  httpClosed.resolve();
  await Promise.resolve();
  assert.deepEqual(events, ['scheduler:stop', 'http:close', 'scheduler:idle']);

  schedulerIdle.resolve();
  await first;
  assert.deepEqual(events, [
    'scheduler:stop',
    'http:close',
    'scheduler:idle',
    'database:close',
    ['notify', { type: 'server:stopped' }]
  ]);
});

test('unrelated control messages do not start shutdown', () => {
  let stopped = false;
  const lifecycle = createServerShutdownLifecycle({
    stopScheduler: () => { stopped = true; },
    closeHttpServer: async () => {},
    waitForSchedulerIdle: async () => {},
    closeDatabase: () => {},
    notifyStoppedAndExit: () => {}
  });

  assert.equal(lifecycle.handleControlMessage({ data: { type: 'credential:result' } }), undefined);
  assert.equal(stopped, false);
});
