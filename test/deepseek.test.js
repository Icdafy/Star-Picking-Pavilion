'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { chat } = require('../server/ai/deepseek');

function settings(baseUrl = 'https://models.example/v1') {
  return { ai: { apiKey: 'sk-test-only', baseUrl, requestTimeoutMs: 1000 } };
}

function response({ contentLength, chunks = ['{"choices":[{"message":{"content":"ok"}}]}'] } = {}) {
  return {
    ok: true,
    status: 200,
    url: 'https://models.example/v1/chat/completions',
    headers: { get: name => name === 'content-length' && contentLength != null ? String(contentLength) : null },
    body: {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield Buffer.from(chunk);
      }
    }
  };
}

test('AI client rejects an unsafe stored base URL before sending the credential', async () => {
  let calls = 0;
  await assert.rejects(chat([{ role: 'user', content: 'test' }], {
    settings: settings('http://attacker.example/v1'),
    model: 'example',
    fetchImpl: async () => { calls++; return response(); }
  }), /HTTPS|地址/);
  assert.equal(calls, 0);
});

test('AI client bounds remote response bodies before parsing JSON', async () => {
  await assert.rejects(chat([{ role: 'user', content: 'test' }], {
    settings: settings(),
    model: 'example',
    maxResponseBytes: 16,
    fetchImpl: async () => response({ contentLength: 17, chunks: [] })
  }), /16.*字节|过大/);

  const out = await chat([{ role: 'user', content: 'test' }], {
    settings: settings(),
    model: 'example',
    maxResponseBytes: 128,
    fetchImpl: async () => response()
  });
  assert.equal(out, 'ok');
});
