'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDailyArchiveBundleRequester
} = require('../electron/daily-archive-request');

function responseFrom(chunks, {
  status = 200,
  contentLength = null
} = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === 'content-length' ? contentLength : null;
      }
    },
    body: {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield Buffer.from(chunk);
      },
      async cancel() {}
    }
  };
}

test('daily archive requester authenticates and parses a bounded JSON response', async () => {
  let observed;
  const requester = createDailyArchiveBundleRequester(4567, 'secret-token', {
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return responseFrom([
        JSON.stringify({ date: '2026-07-31', markdown: '', jsonl: '', manifest: {} })
      ]);
    }
  });

  const result = await requester('2026-07-31');

  assert.equal(result.date, '2026-07-31');
  assert.equal(
    observed.url,
    'http://127.0.0.1:4567/api/daily/archive?date=2026-07-31'
  );
  assert.equal(observed.options.headers['x-star-picking-pavilion-token'], 'secret-token');
  assert.ok(observed.options.signal instanceof AbortSignal);
});

test('daily archive requester rejects declared and streamed bodies over the limit', async () => {
  const declared = createDailyArchiveBundleRequester(4567, 'token', {
    maxResponseBytes: 8,
    fetchImpl: async () => responseFrom(['{}'], { contentLength: '9' })
  });
  await assert.rejects(declared('2026-07-31'), /响应过大/);

  const streamed = createDailyArchiveBundleRequester(4567, 'token', {
    maxResponseBytes: 8,
    fetchImpl: async () => responseFrom(['12345', '67890'])
  });
  await assert.rejects(streamed('2026-07-31'), /响应过大/);
});

test('daily archive requester aborts a stalled request at the configured timeout', async () => {
  const requester = createDailyArchiveBundleRequester(4567, 'token', {
    timeoutMs: 30_000,
    setTimer: callback => {
      callback();
      return 1;
    },
    clearTimer: () => {},
    fetchImpl: async (_url, { signal }) => {
      assert.equal(signal.aborted, true);
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }
  });

  await assert.rejects(requester('2026-07-31'), /请求超时/);
});
