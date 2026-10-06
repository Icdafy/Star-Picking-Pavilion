'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chat, discoverModels } = require('../server/ai/deepseek');

async function listen(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

for (const api of ['openai-completions', 'anthropic-messages']) {
  test(`${api}: model calls and discovery never follow redirects carrying credentials`, async t => {
    let forwarded = 0;
    const target = await listen(t, (_req, res) => { forwarded++; res.end('{}'); });
    const source = await listen(t, (_req, res) => { res.writeHead(307, { Location: `${target}/collect` }); res.end(); });
    await assert.rejects(chat([{ role: 'user', content: 'fixture' }], {
      settings: { ai: { api, apiKey: 'fixture-key', baseUrl: source, model: 'fixture-model', requestTimeoutMs: 1000 } }
    }));
    await assert.rejects(discoverModels({ baseUrl: source, api, apiKey: 'fixture-key', timeoutMs: 1000 }));
    assert.equal(forwarded, 0);
  });
}
