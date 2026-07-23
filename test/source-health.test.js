'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_BACKOFF_MS,
  UNHEALTHY_AFTER_ERRORS,
  backoffDelayMs,
  nextFetchAtIso,
  isDue,
  describeHealth
} = require('../server/source-health');

const TEN_MINUTES = 10 * 60_000;

test('a healthy source is never delayed', () => {
  assert.equal(backoffDelayMs(0, TEN_MINUTES), 0);
  assert.equal(nextFetchAtIso(0, TEN_MINUTES, 1_000), null);
});

test('consecutive failures double the retry delay up to a six hour ceiling', () => {
  assert.equal(backoffDelayMs(1, TEN_MINUTES), TEN_MINUTES);
  assert.equal(backoffDelayMs(2, TEN_MINUTES), 2 * TEN_MINUTES);
  assert.equal(backoffDelayMs(4, TEN_MINUTES), 8 * TEN_MINUTES);
  assert.equal(backoffDelayMs(6, TEN_MINUTES), 32 * TEN_MINUTES);   // 5小时20分，尚未触顶
  assert.equal(backoffDelayMs(7, TEN_MINUTES), MAX_BACKOFF_MS);     // 64×10 分钟被削到 6 小时
  assert.equal(backoffDelayMs(500, TEN_MINUTES), MAX_BACKOFF_MS);
});

test('invalid counters and intervals never produce a delay', () => {
  for (const errors of [null, undefined, NaN, -3, 'many']) {
    assert.equal(backoffDelayMs(errors, TEN_MINUTES), 0);
  }
  for (const interval of [0, -1, NaN, null, 'soon']) {
    assert.equal(backoffDelayMs(3, interval), 0);
  }
});

test('next fetch timestamp is the failure moment plus the backoff delay', () => {
  const nowMs = Date.parse('2026-07-24T00:00:00.000Z');
  assert.equal(nextFetchAtIso(3, TEN_MINUTES, nowMs), new Date(nowMs + 4 * TEN_MINUTES).toISOString());
});

test('a source is due when it has no schedule, a past schedule, or an unparsable one', () => {
  const nowMs = Date.parse('2026-07-24T00:00:00.000Z');
  assert.equal(isDue({ next_fetch_at: null }, nowMs), true);
  assert.equal(isDue({}, nowMs), true);
  assert.equal(isDue({ next_fetch_at: '2026-07-23T23:59:00.000Z' }, nowMs), true);
  assert.equal(isDue({ next_fetch_at: '2026-07-24T00:00:00.000Z' }, nowMs), true);
  assert.equal(isDue({ next_fetch_at: '2026-07-24T00:00:01.000Z' }, nowMs), false);
  assert.equal(isDue({ next_fetch_at: '不是时间' }, nowMs), true);
});

test('health summary separates disabled, paused, degraded and failing sources', () => {
  const nowMs = Date.parse('2026-07-24T00:00:00.000Z');
  const future = '2026-07-24T06:00:00.000Z';

  assert.deepEqual(describeHealth({ enabled: 0, consecutive_errors: 9 }, nowMs), {
    state: 'disabled', consecutiveErrors: 9, pausedUntil: null
  });
  assert.deepEqual(describeHealth({ enabled: 1, consecutive_errors: 0 }, nowMs), {
    state: 'ok', consecutiveErrors: 0, pausedUntil: null
  });
  assert.deepEqual(describeHealth({ enabled: 1, consecutive_errors: 2, next_fetch_at: future }, nowMs), {
    state: 'degraded', consecutiveErrors: 2, pausedUntil: future
  });
  assert.deepEqual(
    describeHealth({ enabled: 1, consecutive_errors: UNHEALTHY_AFTER_ERRORS, next_fetch_at: future }, nowMs),
    { state: 'failing', consecutiveErrors: UNHEALTHY_AFTER_ERRORS, pausedUntil: future }
  );
  // 退避时间已过：仍记着失败次数，但不再显示为暂停
  assert.equal(
    describeHealth({ enabled: 1, consecutive_errors: 3, next_fetch_at: '2026-07-23T00:00:00.000Z' }, nowMs).pausedUntil,
    null
  );
});
