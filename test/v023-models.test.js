'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { API_TOKEN_HEADER } = require('../server/http-security');
const catalog = require('../server/ai/model-catalog');
const { parseCredentialBundle, serializeCredentialBundle, createRuntimeCredentials } = require('../server/runtime-credentials');
const { modelRows } = require('../server/model-routes');
const { startServer } = require('./helpers/server-child');

test('credential bundle keeps the legacy single-key format until a second provider is added', () => {
  assert.deepEqual(parseCredentialBundle('sk-legacy'), { deepseek: 'sk-legacy' });
  assert.deepEqual(parseCredentialBundle(''), {});
  assert.equal(serializeCredentialBundle({ deepseek: 'sk-legacy' }), 'sk-legacy');
  assert.equal(serializeCredentialBundle({}), '');
  const bundle = serializeCredentialBundle({ openai: 'sk-o', deepseek: 'sk-d' });
  assert.match(bundle, /^\{"spp-credentials":2,/);
  assert.deepEqual(parseCredentialBundle(bundle), { deepseek: 'sk-d', openai: 'sk-o' });
  // 损坏的多密钥包不得把整段 JSON 当成 DeepSeek 密钥发出去
  assert.deepEqual(parseCredentialBundle('{"spp-credentials":2,"keys":'), {});
});

test('runtime credentials post the whole bundle when one provider key changes', async () => {
  const sent = [];
  const parentPort = {
    listeners: [],
    on(event, listener) { this.listeners.push(listener); },
    postMessage(message) {
      sent.push(message);
      queueMicrotask(() => this.listeners.forEach(listener => listener({ type: 'credential:result', requestId: message.requestId, ok: true })));
    }
  };
  const credentials = createRuntimeCredentials({ initialApiKey: 'sk-d', parentPort, randomUUID: () => 'id-1' });
  await credentials.persistProviderKey('openai', 'sk-o');
  assert.deepEqual(parseCredentialBundle(sent[0].apiKey), { deepseek: 'sk-d', openai: 'sk-o' });
  assert.equal(credentials.getProviderKey('openai'), 'sk-o');
  assert.equal(credentials.getApiKey(), 'sk-d');
  assert.deepEqual(credentials.configuredProviders().sort(), ['deepseek', 'openai']);
});

test('provider profiles normalize: DeepSeek always present, declared routes need an endpoint, active model falls back', () => {
  const providers = catalog.sanitizeProviders({
    openai: { models: [{ id: 'gpt-a' }, { id: 'gpt-a' }, { id: '' }], displayName: 'ignored for catalog routes' },
    'my-gateway': { baseUrl: 'https://gw.example/v1/', api: 'nope', models: [{ id: 'm1', input: ['image'] }] },
    'no-endpoint': { models: [{ id: 'x' }] },
    'Bad_ID': { baseUrl: 'https://x.example' }
  });
  assert.deepEqual(Object.keys(providers).sort(), ['deepseek', 'my-gateway', 'openai']);
  assert.deepEqual(providers.openai, { models: [{ id: 'gpt-a' }] });
  assert.deepEqual(providers['my-gateway'], {
    baseUrl: 'https://gw.example/v1', declared: true, api: 'openai-completions',
    models: [{ id: 'm1', input: ['text', 'image'] }]
  });
  assert.equal(catalog.resolveActive(providers, 'openai', 'missing').model, 'gpt-a');
  assert.equal(catalog.resolveActive(providers, 'gone', 'gpt-a').provider, 'deepseek');
  const empty = catalog.resolveActive({ deepseek: {}, anthropic: {} }, 'anthropic', 'x');
  assert.deepEqual([empty.provider, empty.model], ['deepseek', catalog.DEFAULT_MODEL]);
  assert.equal(catalog.describeProvider('local', { baseUrl: 'http://127.0.0.1:8000/v1' }).keyOptional, true);
});

test('model rows are validated row by row with the offending position named', () => {
  assert.deepEqual(modelRows([{ id: ' a ', name: '', contextWindow: '131072', input: ['text', 'image'] }]), [
    { id: 'a', contextWindow: 131072, input: ['text', 'image'] }
  ]);
  assert.throws(() => modelRows([{ id: 'a' }, { id: 'a' }]), /模型 2：模型 ID 不能重复/);
  assert.throws(() => modelRows([{ id: '' }]), /模型 1：模型 ID 不能为空/);
  assert.throws(() => modelRows([{ id: 'a', maxTokens: 1.5 }]), /最大输出 token 数必须是正整数/);
  assert.throws(() => modelRows([{ id: 'a', input: ['audio'] }]), /输入类型/);
});

function mockModelEndpoint(t) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, authorization: req.headers.authorization || null, body });
      res.setHeader('Content-Type', 'application/json');
      if (req.url.endsWith('/models')) {
        res.end(JSON.stringify({ data: [{ id: 'gw-vision', context_length: 262144 }, { id: 'gw-text' }] }));
        return;
      }
      res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    t.after(() => new Promise(done => server.close(done)));
    resolve({ base: `http://127.0.0.1:${server.address().port}/v1`, calls });
  }));
}

test('models API adds, edits, selects, discovers, tests and removes providers without ever echoing keys', async t => {
  const server = await startServer(t);
  const endpoint = await mockModelEndpoint(t);
  const headers = { [API_TOKEN_HEADER]: server.token, 'content-type': 'application/json' };
  const call = async (method, pathname, body) => {
    const response = await server.request({ method, pathname, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.doesNotMatch(response.body, /sk-gw-secret|sk-openai-secret/);
    return { status: response.status, data: JSON.parse(response.body) };
  };

  const initial = await call('GET', '/api/models');
  assert.equal(initial.status, 200);
  assert.equal(initial.data.activeProvider, 'deepseek');
  assert.equal(initial.data.activeModel, catalog.DEFAULT_MODEL);
  assert.deepEqual(initial.data.providers.map(row => row.provider), ['deepseek']);
  assert.equal(initial.data.providers[0].removable, false);
  assert.equal(initial.data.catalog.find(row => row.provider === 'openai').added, false);

  // 目录路由：添加 OpenAI，只填密钥与一行模型
  const adopted = await call('POST', '/api/models/providers/openai', { apiKey: 'sk-openai-secret', models: [{ id: 'gpt-test' }] });
  assert.equal(adopted.status, 200);
  const openai = adopted.data.providers.find(row => row.provider === 'openai');
  assert.equal(openai.keyConfigured, true);
  assert.deepEqual(openai.models, [{ id: 'gpt-test' }]);

  // 自定义模型 API：四项门控
  assert.equal((await call('POST', '/api/models/providers', { provider: 'gw', baseUrl: endpoint.base, api: 'openai-completions', models: [] })).status, 400);
  assert.equal((await call('POST', '/api/models/providers', { provider: 'openai', baseUrl: endpoint.base, api: 'openai-completions', models: [{ id: 'x' }] })).status, 400);
  assert.equal((await call('POST', '/api/models/providers', { provider: 'gw', baseUrl: 'http://gw.example/v1', api: 'openai-completions', models: [{ id: 'x' }] })).status, 400);

  // 获取：询问表单当前的端点与尚未保存的密钥
  const discovered = await call('POST', '/api/models/discover', { provider: 'gw', baseUrl: endpoint.base, api: 'openai-completions', apiKey: 'sk-gw-secret' });
  assert.deepEqual(discovered.data, { ok: true, models: [{ id: 'gw-text' }, { id: 'gw-vision', contextWindow: 262144 }] });
  assert.equal(endpoint.calls.at(-1).authorization, 'Bearer sk-gw-secret');

  const created = await call('POST', '/api/models/providers', {
    provider: 'gw', displayName: '我的网关', baseUrl: endpoint.base, api: 'openai-completions',
    apiKey: 'sk-gw-secret', models: [{ id: 'gw-vision', input: ['text', 'image'] }, { id: 'gw-text', input: ['text'] }]
  });
  assert.equal(created.status, 200);
  const gw = created.data.providers.find(row => row.provider === 'gw');
  assert.equal(gw.declared, true);
  assert.equal(gw.displayName, '我的网关');
  assert.equal(gw.keyConfigured, true);

  // 选定分析模型；目录外的模型被拒
  assert.equal((await call('POST', '/api/models/active', { provider: 'gw', model: 'nope' })).status, 400);
  const selected = await call('POST', '/api/models/active', { provider: 'gw', model: 'gw-text' });
  assert.equal(selected.data.activeProvider, 'gw');
  assert.equal(selected.data.activeModel, 'gw-text');
  const settings = await call('GET', '/api/settings');
  assert.equal(settings.data.ai.model, 'gw-text');
  assert.equal(settings.data.ai.baseUrl, endpoint.base);
  assert.equal(settings.data.ai._hasKey, true);

  // 测试连接走已存密钥与所选模型
  const tested = await call('POST', '/api/models/test', { provider: 'gw' });
  assert.equal(tested.data.ok, true, tested.data.error);
  const chatCall = endpoint.calls.at(-1);
  assert.equal(chatCall.url, '/v1/chat/completions');
  assert.equal(chatCall.authorization, 'Bearer sk-gw-secret');
  assert.equal(JSON.parse(chatCall.body).model, 'gw-text');
  assert.equal('thinking' in JSON.parse(chatCall.body), false);

  // 已存密钥不会发往表单里改过的新地址
  await call('POST', '/api/models/discover', { provider: 'gw', baseUrl: `${endpoint.base}/other` });
  assert.equal(endpoint.calls.at(-1).authorization, null);

  // 改端点而不重新输入密钥：旧密钥作废
  const moved = await call('POST', '/api/models/providers/gw', { baseUrl: `${endpoint.base}/moved` });
  assert.equal(moved.data.providers.find(row => row.provider === 'gw').keyConfigured, false);

  // 删除当前分析模型所属的提供商：回落 DeepSeek
  assert.equal((await call('DELETE', '/api/models/providers/deepseek')).status, 400);
  const removed = await call('DELETE', '/api/models/providers/gw');
  assert.equal(removed.status, 200);
  assert.equal(removed.data.activeProvider, 'deepseek');
  assert.deepEqual(removed.data.providers.map(row => row.provider), ['deepseek', 'openai']);
});
