'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const SettingsFormController = require('../renderer/settings-form-controller');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeInput extends EventTarget {
  constructor(value = '') {
    super();
    this._value = String(value);
    this.dataset = {};
  }

  get value() {
    return this._value;
  }

  set value(value) {
    this._value = String(value);
  }

  fill(value) {
    this.value = String(value);
    this.dispatchEvent(new Event('input'));
  }
}

function createElements() {
  return {
    automatic: new FakeInput(),
    automaticCleanup: new FakeInput(),
    intervalMinutes: new FakeInput(),
    rsshubBase: new FakeInput(),
    retentionDays: new FakeInput(),
    irrelevantRetentionDays: new FakeInput()
  };
}

test('采集间隔发送原值，1 / 17 / 37 / 720 分钟有效，空值与小数不能静默替换', async () => {
  const elements = createElements(), values = [];
  const form = SettingsFormController.createSettingsFormController({ elements, request: async (_, options) => { values.push(options.body.collect.intervalMinutes); return { ok: true }; } });
  for (const minutes of [1, 17, 37, 720]) { elements.intervalMinutes.value = minutes; await form.saveCollect(); }
  assert.deepEqual(values, [1, 17, 37, 720]);
  for (const value of ['', '0', '1.5', '721', 'bad']) { elements.intervalMinutes.value = value; await assert.rejects(form.saveCollect(), /整数分钟/); }
  assert.equal(values.length, 4);
});

function settingsWithPrefix(prefix) {
  return {
    ai: { model: 'deepseek-flash' },
    collect: {
      intervalMinutes: prefix === 'newer' ? 90 : 30,
      rsshubBase: `https://${prefix}-rsshub.example`,
      retentionDays: prefix === 'newer' ? 60 : 30,
      irrelevantRetentionDays: 7
    }
  };
}

test('the settings form no longer owns AI fields: those moved to the models section', () => {
  assert.throws(() => SettingsFormController.createSettingsFormController({ elements: {}, request: async () => ({}) }), /automatic/);
  const controller = SettingsFormController.createSettingsFormController({ elements: createElements(), request: async () => ({}) });
  assert.deepEqual(Object.keys(controller).sort(), ['discard', 'load', 'saveCollect', 'saveRetention']);
});

test('v0.2.37 改动即保存：每个字段只提交自己，空值与越界天数被拒绝，discard 读回服务器值', async () => {
  const elements = createElements();
  const bodies = [];
  const controller = SettingsFormController.createSettingsFormController({
    elements,
    request: async (path, options) => {
      if (options) { bodies.push(options.body); return { ok: true }; }
      return settingsWithPrefix('loaded');
    }
  });
  elements.automatic.checked = true;
  elements.intervalMinutes.fill('bad');
  await controller.saveCollect(['automatic']);
  assert.deepEqual(bodies.at(-1), { collect: { automatic: true } }, '开关不能连带提交另一字段里未确认的输入');
  elements.rsshubBase.fill(' https://hub.example ');
  await controller.saveCollect('rsshubBase');
  assert.deepEqual(bodies.at(-1), { collect: { rsshubBase: 'https://hub.example' } });
  await assert.rejects(controller.saveCollect(['retentionDays']), TypeError);

  for (const [value, pattern] of [['', /整数天/], ['6', /7 至 3650/], ['30.5', /整数天/], ['3651', /整数天/]]) {
    elements.retentionDays.fill(value);
    await assert.rejects(controller.saveRetention(['retentionDays']), pattern);
  }
  elements.retentionDays.fill('365');
  await controller.saveRetention(['retentionDays']);
  assert.deepEqual(bodies.at(-1), { collect: { retentionDays: 365 } });
  elements.irrelevantRetentionDays.fill('0');
  await assert.rejects(controller.saveRetention(['irrelevantRetentionDays']), /1 至 3650/);
  assert.equal(bodies.length, 3);

  // 被拒的输入仍是脏的：普通 load 不覆盖，discard 才读回服务器上的 7 天
  await controller.load();
  assert.equal(elements.irrelevantRetentionDays.value, '0');
  await controller.discard(['irrelevantRetentionDays']);
  assert.equal(elements.irrelevantRetentionDays.value, '7');
});

test('late settings load preserves every user edit', async () => {
  const loadGate = deferred();
  const elements = createElements();
  const controller = SettingsFormController.createSettingsFormController({
    elements,
    request: async (path, options) => (options ? { ok: true } : loadGate.promise)
  });

  const loading = controller.load();
  elements.intervalMinutes.fill('45');
  elements.rsshubBase.fill('https://user-rsshub.example');
  loadGate.resolve(settingsWithPrefix('loaded'));
  await loading;

  assert.equal(elements.intervalMinutes.value, '45');
  assert.equal(elements.rsshubBase.value, 'https://user-rsshub.example');
  assert.equal(elements.retentionDays.value, '30');
});

test('automatic cleanup defaults on for old settings, saves independently and rolls back only after discard', async () => {
  const elements = createElements();
  const bodies = [];
  let saved = {}, fail = false;
  const controller = SettingsFormController.createSettingsFormController({
    elements, request: async (_path, options) => {
      if (!options) return { collect: { ...settingsWithPrefix('loaded').collect, ...saved } };
      if (fail) throw new Error('disk full');
      bodies.push(options.body);
      saved = { ...saved, ...options.body.collect };
      return { ok: true };
    }
  });
  await controller.load();
  assert.equal(elements.automaticCleanup.checked, true);
  elements.automaticCleanup.checked = false;
  elements.automaticCleanup.dispatchEvent(new Event('input'));
  elements.retentionDays.fill('invalid');
  await controller.saveRetention(['automaticCleanup']);
  assert.deepEqual(bodies.at(-1), { collect: { automaticCleanup: false } });
  await controller.load();
  assert.equal(elements.automaticCleanup.checked, false);
  elements.automaticCleanup.checked = true;
  elements.automaticCleanup.dispatchEvent(new Event('input'));
  fail = true;
  await assert.rejects(controller.saveRetention(['automaticCleanup']), /disk full/);
  await controller.load();
  assert.equal(elements.automaticCleanup.checked, true, 'ordinary loads preserve an unsaved edit');
  await controller.discard(['automaticCleanup']);
  assert.equal(elements.automaticCleanup.checked, false, 'failed toggle restores persisted setting');
});

test('a late load cannot replace a cleanup toggle edited while loading', async () => {
  const loadGate = deferred();
  const elements = createElements();
  const controller = SettingsFormController.createSettingsFormController({ elements, request: () => loadGate.promise });
  const loading = controller.load();
  elements.automaticCleanup.checked = false;
  elements.automaticCleanup.dispatchEvent(new Event('input'));
  loadGate.resolve(settingsWithPrefix('loaded'));
  await loading;
  assert.equal(elements.automaticCleanup.checked, false);
});

test('an older settings load resolving last cannot roll back a newer load', async () => {
  const older = deferred();
  const newer = deferred();
  const loads = [older.promise, newer.promise];
  const elements = createElements();
  const controller = SettingsFormController.createSettingsFormController({
    elements,
    request: async () => loads.shift()
  });

  const olderLoad = controller.load();
  const newerLoad = controller.load();
  newer.resolve(settingsWithPrefix('newer'));
  await newerLoad;
  older.resolve(settingsWithPrefix('older'));
  await olderLoad;

  assert.equal(elements.intervalMinutes.value, '90');
  assert.equal(elements.rsshubBase.value, 'https://newer-rsshub.example');
  assert.equal(elements.retentionDays.value, '60');
});

test('successful saves mark unchanged submitted fields clean; failed saves keep them dirty', async () => {
  const elements = createElements();
  const calls = [];
  let failNext = false;
  const controller = SettingsFormController.createSettingsFormController({
    elements,
    request: async (path, options) => {
      calls.push({ path, options });
      if (options && failNext) throw new Error('injected save failure');
      return options ? { ok: true } : settingsWithPrefix('reloaded');
    }
  });

  elements.intervalMinutes.fill('55');
  elements.rsshubBase.fill('https://saved-rsshub.example');
  await controller.saveCollect();
  assert.deepEqual(calls[0].options.body, { collect: { automatic: false, intervalMinutes: 55, rsshubBase: 'https://saved-rsshub.example' } });
  elements.retentionDays.fill('120');
  failNext = true;
  await assert.rejects(controller.saveRetention(['retentionDays']), /injected save failure/);
  failNext = false;
  await controller.load();

  assert.equal(elements.intervalMinutes.value, '30');
  assert.equal(elements.rsshubBase.value, 'https://reloaded-rsshub.example');
  assert.equal(elements.retentionDays.value, '120', '保存失败的字段仍是用户的值');
});

test('capacity fields read 256K / 1M shorthands and write back the shortest round-trip spelling', () => {
  const { parseCapacity, formatCapacity } = SettingsFormController;
  assert.equal(parseCapacity(''), undefined);
  assert.equal(parseCapacity('131072'), 131072);
  assert.equal(parseCapacity('256K'), 256000);
  assert.equal(parseCapacity('1m'), 1000000);
  assert.equal(parseCapacity('2.3M'), 2300000);
  assert.ok(Number.isNaN(parseCapacity('lots')));
  assert.equal(formatCapacity(256000), '256K');
  assert.equal(formatCapacity(1000000), '1M');
  assert.equal(formatCapacity(131072), '131072');
  assert.equal(formatCapacity(undefined), '');
});

test('API key drafts reject quoted values, env lines and whitespace, but blank means keep the stored key', () => {
  const { apiKeyFailure } = SettingsFormController;
  assert.equal(apiKeyFailure(''), '');
  assert.equal(apiKeyFailure('sk-valid_123'), '');
  assert.match(apiKeyFailure('   '), /留空则保持/);
  assert.match(apiKeyFailure('"sk-quoted"'), /格式错误/);
  assert.match(apiKeyFailure('OPENAI_API_KEY=sk-x'), /格式错误/);
  assert.match(apiKeyFailure('sk a'), /格式错误/);
});

test('model rows are validated by position, and payloads drop blank optional fields', () => {
  const { modelRowsFailure, draftRow, rowPayload } = SettingsFormController;
  const rows = [draftRow({ id: 'a' }), draftRow({ id: 'a' })];
  assert.deepEqual(modelRowsFailure(rows), { index: 1, message: '模型 ID 不能重复。' });
  assert.deepEqual(modelRowsFailure([draftRow({ id: '' })]), { index: 0, message: '模型 ID 不能为空。' });
  const capacity = draftRow({ id: 'x' });
  capacity.contextText = '12.5';
  assert.match(modelRowsFailure([capacity]).message, /上下文窗口/);
  const row = draftRow({ id: ' gpt-x ', contextWindow: 128000, input: ['text', 'image'] });
  row.name = '  ';
  assert.deepEqual(rowPayload(row), { id: 'gpt-x', contextWindow: 128000, input: ['text', 'image'] });
});

test('provider drafts inherit the catalog models until the user overrides them', () => {
  const { providerDraft } = SettingsFormController;
  const deepseek = providerDraft({
    provider: 'deepseek', declared: false, keyConfigured: true, api: 'openai-completions',
    baseUrl: 'https://api.deepseek.com', defaultBaseUrl: 'https://api.deepseek.com', baseUrlCustomized: false,
    models: [{ id: 'deepseek-flash' }], modelsCustomized: false
  });
  assert.equal(deepseek.overridden, false);
  assert.equal(deepseek.baseUrl, '', '未改过的端点留空，占位符显示提供商默认');
  assert.deepEqual(deepseek.defaults, [{ id: 'deepseek-flash' }]);
  assert.equal(deepseek.detailsOpen, false);
  const gateway = providerDraft({
    provider: 'gw', declared: true, displayName: '网关', api: 'anthropic-messages',
    baseUrl: 'https://gw.example', models: [], modelsCustomized: false
  });
  assert.equal(gateway.overridden, true);
  assert.equal(gateway.baseUrl, 'https://gw.example');
  assert.equal(gateway.detailsOpen, true, '没有模型时直接展开自定义设置');
});
