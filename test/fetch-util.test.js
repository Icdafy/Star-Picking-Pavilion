'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { fetchText } = require('../server/collectors/fetch-util');

const settings = { collect: { requestTimeoutMs: 1000, userAgent: 'test-agent' } };

function response({ chunks = [], contentLength, url = 'https://example.com/feed' } = {}) {
  return {
    ok: true,
    status: 200,
    url,
    headers: {
      get(name) {
        if (name.toLowerCase() === 'content-length' && contentLength !== undefined) return String(contentLength);
        if (name.toLowerCase() === 'content-type') return 'text/plain; charset=utf-8';
        return null;
      }
    },
    body: {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield Buffer.from(chunk);
      }
    }
  };
}

test('collector fetch bounds declared and streamed response sizes', async () => {
  await assert.rejects(
    fetchText('https://example.com/large', settings, {
      maxResponseBytes: 8,
      fetchImpl: async () => response({ contentLength: 9 })
    }),
    /8.*字节|过大/
  );
  await assert.rejects(
    fetchText('https://example.com/chunked', settings, {
      maxResponseBytes: 8,
      fetchImpl: async () => response({ chunks: ['12345', '6789'] })
    }),
    /8.*字节|过大/
  );
});

test('collector fetch decodes bounded responses and rejects non-web URLs', async () => {
  const text = await fetchText('https://example.com/small', settings, {
    maxResponseBytes: 16,
    fetchImpl: async () => response({ chunks: ['摘星阁'] })
  });
  assert.equal(text, '摘星阁');
  await assert.rejects(
    fetchText('file:///private', settings, { fetchImpl: async () => response() }),
    /HTTP|HTTPS/
  );
});
