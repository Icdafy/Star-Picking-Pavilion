'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../server/ai/model-catalog');
const { chat, discoverModels } = require('../server/ai/deepseek');
const { modelFor, modelIdentity } = require('../server/ai/model-policy');
const { createModelRoutes } = require('../server/model-routes');

const legacyFlashIds = ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'];

function settings(provider = 'deepseek', model = 'deepseek-flash') {
  return { ai: {
    activeProvider: provider, model, baseUrl: 'https://api.deepseek.com',
    api: 'openai-completions', apiKey: 'test-only', requestTimeoutMs: 1000,
    providers: { deepseek: {} }
  } };
}

function response(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

test('Flash profiles upgrade both retired IDs to the 1017 native vision model while preserving other models', () => {
  const rawModels = [
    { id: legacyFlashIds[0], name: 'DeepSeek V4 Flash', input: ['text'], maxTokens: 8000 },
    { id: legacyFlashIds[1], name: 'DeepSeek Flash Vision Exp', input: ['text', 'image'] },
    { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', input: ['text'] },
    { id: 'deepseek-v4-pro', name: 'Pro', input: ['text'] },
    { id: 'my-private-flash', name: '私有模型', input: ['text'] }
  ];
  const profiles = catalog.sanitizeProviders({
    deepseek: { models: rawModels },
    gateway: { baseUrl: 'https://gateway.example/v1', models: rawModels }
  });
  assert.deepEqual(profiles.deepseek.models, [
    { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash 1017', input: ['text', 'image'], maxTokens: 8000 },
    rawModels[3], rawModels[4]
  ]);
  assert.deepEqual(profiles.gateway.models, rawModels, 'custom routes own their IDs and input declarations');
  const active = catalog.resolveActive(profiles, 'deepseek', legacyFlashIds[1]);
  assert.equal(active.model, 'deepseek-flash');
  assert.equal(catalog.acceptsImages(active.entry), true);
  assert.equal(catalog.describeProvider('deepseek').models[0].name, 'DeepSeek V4.1 Flash 1017');
});

test('request boundary upgrades Flash aliases from settings and explicit overrides across both protocols', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return url.endsWith('/messages')
      ? response({ content: [{ type: 'text', text: '{"ok":true}' }] })
      : response({ choices: [{ message: { content: '{"ok":true}' } }] });
  };
  const messages = [{ role: 'user', content: [
    { type: 'text', text: '请看图并只回复 JSON' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }
  ] }];
  for (const api of ['openai-completions', 'anthropic-messages']) {
    for (const id of legacyFlashIds) {
      const configured = settings('deepseek', id);
      configured.ai.api = api;
      await chat(messages, { settings: configured, fetchImpl });
      await chat(messages, { settings: { ...configured, ai: { ...configured.ai, model: 'deepseek-v4-pro' } }, model: ` ${id} `, fetchImpl });
    }
  }
  assert.equal(requests.length, 8);
  assert.ok(requests.every(request => request.body.model === 'deepseek-flash'));
  assert.equal(requests[0].body.messages[0].content[1].type, 'image_url');
  assert.equal(requests.at(-1).body.messages[0].content[1].type, 'image');

  for (const [provider, model] of [['gateway', legacyFlashIds[0]], ['openai', legacyFlashIds[1]], ['deepseek', 'deepseek-v4-pro'], ['deepseek', 'my-custom-model']]) {
    await chat(messages, { settings: settings(provider, model), fetchImpl });
    assert.equal(requests.at(-1).body.model, model);
  }
  const legacySettings = settings(undefined, legacyFlashIds[0]);
  delete legacySettings.ai.activeProvider;
  await chat(messages, { settings: legacySettings, fetchImpl });
  assert.equal(requests.at(-1).body.model, 'deepseek-flash');
});

test('model discovery merges retired Flash aliases with the current ID only on the DeepSeek route', async () => {
  const listed = [
    { id: legacyFlashIds[0], display_name: 'DeepSeek V4 Flash', input_modalities: ['text'], context_length: 1000000 },
    { id: legacyFlashIds[1] },
    { id: 'deepseek-flash' },
    { id: 'deepseek-v4-pro' },
    { id: 'custom-flash' }
  ];
  const fetchImpl = async () => response({ data: listed });
  const official = await discoverModels({ baseUrl: 'https://api.deepseek.com', fetchImpl });
  assert.deepEqual(official.find(model => model.id === 'deepseek-flash'), {
    id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash 1017', input: ['text', 'image'], contextWindow: 1000000
  });
  assert.deepEqual(official.map(model => model.id), ['custom-flash', 'deepseek-flash', 'deepseek-v4-pro']);
  const custom = await discoverModels({ provider: 'gateway', baseUrl: 'https://gateway.example/v1', fetchImpl });
  assert.equal(custom.length, 5);
  assert.equal(custom.find(model => model.id === legacyFlashIds[0]).name, 'DeepSeek V4 Flash');
  assert.deepEqual(custom.find(model => model.id === legacyFlashIds[0]).input, ['text']);
  const proxied = await discoverModels({ provider: 'deepseek', baseUrl: 'https://gateway.example/v1', fetchImpl });
  assert.deepEqual(proxied, official);
});

test('DeepSeek Flash receipt identities contain the serving release so old rolling-alias outputs are not reused', () => {
  const configured = settings();
  const oldIdentity = JSON.stringify(['deepseek', 'openai-completions', 'https://api.deepseek.com', 'deepseek-flash']);
  assert.notEqual(modelIdentity(configured), oldIdentity);
  assert.equal(JSON.parse(modelIdentity(configured)).at(-1), 'DeepSeek-V4.1-Flash-1017');
  for (const model of legacyFlashIds) {
    assert.equal(modelFor(settings('deepseek', model)), 'deepseek-flash');
    assert.equal(modelIdentity(settings('deepseek', model)), modelIdentity(configured));
  }
  assert.equal(modelFor(settings('gateway', legacyFlashIds[0])), legacyFlashIds[0]);
  assert.deepEqual(JSON.parse(modelIdentity(settings('deepseek', 'deepseek-v4-pro'))), [
    'deepseek', 'openai-completions', 'https://api.deepseek.com', 'deepseek-v4-pro'
  ]);
});

test('models routes give discovery its provider identity and connection tests report the canonical Flash ID', async () => {
  let discoveredTarget;
  let testedSettings;
  const routes = createModelRoutes({
    loadSettings: () => settings(),
    coordinator: {},
    credentials: { configuredProviders: () => ['deepseek'], getProviderKey: () => 'test-only' },
    discoverModels: async target => { discoveredTarget = target; return []; },
    testConnection: async configured => { testedSettings = configured; return true; }
  });
  async function request(pathname, body) {
    let result;
    const handled = await routes.handle({
      req: { method: 'POST' }, res: {}, pathname,
      readJsonBody: async () => body,
      json: (res, status, data) => { result = { status, ...data }; }
    });
    assert.equal(handled, true);
    return result;
  }
  const discovered = await request('/api/models/discover', { provider: 'deepseek' });
  assert.equal(discovered.ok, true);
  assert.equal(discoveredTarget.provider, 'deepseek');
  const tested = await request('/api/models/test', { provider: 'deepseek', model: legacyFlashIds[1] });
  assert.equal(tested.ok, true);
  assert.equal(tested.model, 'deepseek-flash');
  assert.equal(testedSettings.ai.model, 'deepseek-flash');
});
