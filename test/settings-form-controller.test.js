'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

let SettingsFormController;
try {
  SettingsFormController = require('../renderer/settings-form-controller');
} catch {
  SettingsFormController = null;
}

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

class FakeInput extends EventTarget {
  constructor(value = '') {
    super();
    this._value = String(value);
    this.dataset = {};
    this.placeholder = '';
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
    apiKey: new FakeInput(),
    baseUrl: new FakeInput(),
    prefilterModel: new FakeInput(),
    scoringModel: new FakeInput(),
    intervalMinutes: new FakeInput(),
    rsshubBase: new FakeInput(),
    clearApiKeyButton: { disabled: true }
  };
}

const loadedSettings = Object.freeze({
  ai: {
    _hasKey: false,
    baseUrl: 'https://loaded.example/v1',
    prefilterModel: 'loaded-prefilter',
    scoringModel: 'loaded-scoring'
  },
  collect: {
    intervalMinutes: 10,
    rsshubBase: 'https://loaded-rsshub.example'
  }
});

function settingsWithPrefix(prefix, hasKey = false) {
  return {
    ai: {
      _hasKey: hasKey,
      baseUrl: `https://${prefix}.example/v1`,
      prefilterModel: `${prefix}-prefilter`,
      scoringModel: `${prefix}-scoring`
    },
    collect: {
      intervalMinutes: prefix === 'newer' ? 90 : 30,
      rsshubBase: `https://${prefix}-rsshub.example`
    }
  };
}

test('late settings load preserves every user edit and AI save still supplies the API key', async () => {
  assert.ok(SettingsFormController, 'settings form controller must exist');
  const loadGate = deferred();
  const elements = createElements();
  const requests = [];
  const request = async (path, options) => {
    requests.push({ path, options });
    if (!options) return loadGate.promise;
    return { ok: true, credentialConfigured: true };
  };
  const controller = SettingsFormController.createSettingsFormController({
    elements,
    request
  });

  const loading = controller.load();
  elements.apiKey.fill('sk-user-edit');
  elements.baseUrl.fill('https://user.example/v1');
  elements.prefilterModel.fill('user-prefilter');
  elements.scoringModel.fill('user-scoring');
  elements.intervalMinutes.fill('45');
  elements.rsshubBase.fill('https://user-rsshub.example');

  loadGate.resolve(loadedSettings);
  await loading;

  assert.equal(elements.apiKey.value, 'sk-user-edit');
  assert.equal(elements.baseUrl.value, 'https://user.example/v1');
  assert.equal(elements.prefilterModel.value, 'user-prefilter');
  assert.equal(elements.scoringModel.value, 'user-scoring');
  assert.equal(elements.intervalMinutes.value, '45');
  assert.equal(elements.rsshubBase.value, 'https://user-rsshub.example');

  await controller.saveAi();
  assert.deepEqual(requests[1], {
    path: '/api/settings',
    options: {
      body: {
        ai: {
          apiKey: 'sk-user-edit',
          baseUrl: 'https://user.example/v1',
          prefilterModel: 'user-prefilter',
          scoringModel: 'user-scoring'
        }
      }
    }
  });

  await controller.saveCollect();
  assert.deepEqual(requests[2], {
    path: '/api/settings',
    options: {
      body: {
        collect: {
          intervalMinutes: 45,
          rsshubBase: 'https://user-rsshub.example'
        }
      }
    }
  });
});

test('successful save and explicit clear reset credential state while a later clean load still applies', async () => {
  assert.ok(SettingsFormController, 'settings form controller must exist');
  const elements = createElements();
  const loads = [
    {
      ai: {
        _hasKey: true,
        baseUrl: 'https://reloaded.example/v1',
        prefilterModel: 'reloaded-prefilter',
        scoringModel: 'reloaded-scoring'
      },
      collect: {
        intervalMinutes: 60,
        rsshubBase: 'https://reloaded-rsshub.example'
      }
    }
  ];
  const request = async (path, options) => {
    if (!options) return loads.shift();
    if (options.body.ai?.apiKey === null) {
      return { ok: true, credentialConfigured: false };
    }
    return { ok: true, credentialConfigured: true };
  };
  const controller = SettingsFormController.createSettingsFormController({
    elements,
    request
  });

  elements.apiKey.fill('sk-saved');
  elements.baseUrl.fill('https://saved.example/v1');
  elements.prefilterModel.fill('saved-prefilter');
  elements.scoringModel.fill('saved-scoring');
  await controller.saveAi();

  assert.equal(elements.apiKey.value, '');
  assert.equal(elements.apiKey.dataset.hasStoredKey, 'true');
  assert.equal(elements.clearApiKeyButton.disabled, false);

  elements.apiKey.fill('sk-unsaved-replacement');
  await controller.clearApiKey();
  assert.equal(elements.apiKey.value, '');
  assert.equal(elements.apiKey.dataset.hasStoredKey, 'false');
  assert.equal(elements.clearApiKeyButton.disabled, true);

  await controller.load();
  assert.equal(elements.apiKey.value, '');
  assert.equal(elements.apiKey.dataset.hasStoredKey, 'true');
  assert.equal(elements.baseUrl.value, 'https://reloaded.example/v1');
  assert.equal(elements.prefilterModel.value, 'reloaded-prefilter');
  assert.equal(elements.scoringModel.value, 'reloaded-scoring');
  assert.equal(elements.intervalMinutes.value, '60');
  assert.equal(elements.rsshubBase.value, 'https://reloaded-rsshub.example');
});

test('editing API key B while key A is saving preserves B but updates stored credential metadata', async () => {
  const saveGate = deferred();
  const elements = createElements();
  const request = async (path, options) => {
    if (options) return saveGate.promise;
    return settingsWithPrefix('late-load', true);
  };
  const controller = SettingsFormController.createSettingsFormController({
    elements,
    request
  });

  elements.apiKey.fill('sk-key-a');
  const saving = controller.saveAi();
  elements.apiKey.fill('sk-key-b');
  saveGate.resolve({ ok: true, credentialConfigured: true });
  await saving;

  assert.equal(elements.apiKey.value, 'sk-key-b');
  assert.equal(elements.apiKey.dataset.hasStoredKey, 'true');
  assert.match(elements.apiKey.placeholder, /Windows/);
  assert.equal(elements.clearApiKeyButton.disabled, false);

  await controller.load();
  assert.equal(elements.apiKey.value, 'sk-key-b');
});

test('editing API key B while clear is pending preserves B but applies cleared metadata', async () => {
  const clearGate = deferred();
  const elements = createElements();
  const request = async (path, options) => {
    if (options) return clearGate.promise;
    return settingsWithPrefix('late-load', true);
  };
  const controller = SettingsFormController.createSettingsFormController({
    elements,
    request
  });

  elements.apiKey.fill('sk-key-a');
  const clearing = controller.clearApiKey();
  elements.apiKey.fill('sk-key-b');
  clearGate.resolve({ ok: true, credentialConfigured: false });
  await clearing;

  assert.equal(elements.apiKey.value, 'sk-key-b');
  assert.equal(elements.apiKey.dataset.hasStoredKey, 'false');
  assert.match(elements.apiKey.placeholder, /^sk-/);
  assert.equal(elements.clearApiKeyButton.disabled, true);

  await controller.load();
  assert.equal(elements.apiKey.value, 'sk-key-b');
  assert.equal(elements.apiKey.dataset.hasStoredKey, 'false');
});

test('failed save leaves all unsaved fields dirty across a later settings load', async () => {
  const elements = createElements();
  let failed = false;
  const request = async (path, options) => {
    if (options && !failed) {
      failed = true;
      throw new Error('injected save failure');
    }
    return loadedSettings;
  };
  const controller = SettingsFormController.createSettingsFormController({
    elements,
    request
  });

  elements.apiKey.fill('sk-unsaved');
  elements.baseUrl.fill('https://unsaved.example/v1');
  elements.prefilterModel.fill('unsaved-prefilter');
  elements.scoringModel.fill('unsaved-scoring');
  elements.intervalMinutes.fill('75');
  elements.rsshubBase.fill('https://unsaved-rsshub.example');

  await assert.rejects(controller.saveAi(), /injected save failure/);
  await controller.load();

  assert.equal(elements.apiKey.value, 'sk-unsaved');
  assert.equal(elements.baseUrl.value, 'https://unsaved.example/v1');
  assert.equal(elements.prefilterModel.value, 'unsaved-prefilter');
  assert.equal(elements.scoringModel.value, 'unsaved-scoring');
  assert.equal(elements.intervalMinutes.value, '75');
  assert.equal(elements.rsshubBase.value, 'https://unsaved-rsshub.example');
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
  newer.resolve(settingsWithPrefix('newer', true));
  await newerLoad;
  older.resolve(settingsWithPrefix('older', false));
  await olderLoad;

  assert.equal(elements.apiKey.dataset.hasStoredKey, 'true');
  assert.equal(elements.baseUrl.value, 'https://newer.example/v1');
  assert.equal(elements.prefilterModel.value, 'newer-prefilter');
  assert.equal(elements.scoringModel.value, 'newer-scoring');
  assert.equal(elements.intervalMinutes.value, '90');
  assert.equal(elements.rsshubBase.value, 'https://newer-rsshub.example');
});

test('successful AI and collect saves mark unchanged submitted fields clean for later reload', async () => {
  const elements = createElements();
  const calls = [];
  const request = async (path, options) => {
    calls.push({ path, options });
    if (options) return { ok: true, credentialConfigured: true };
    return settingsWithPrefix('reloaded', true);
  };
  const controller = SettingsFormController.createSettingsFormController({
    elements,
    request
  });

  elements.apiKey.fill('sk-synchronized');
  elements.baseUrl.fill('https://saved.example/v1');
  elements.prefilterModel.fill('saved-prefilter');
  elements.scoringModel.fill('saved-scoring');
  elements.intervalMinutes.fill('55');
  elements.rsshubBase.fill('https://saved-rsshub.example');
  await controller.saveAi();
  await controller.saveCollect();
  await controller.load();

  assert.equal(elements.apiKey.value, '');
  assert.equal(elements.apiKey.dataset.hasStoredKey, 'true');
  assert.equal(elements.baseUrl.value, 'https://reloaded.example/v1');
  assert.equal(elements.prefilterModel.value, 'reloaded-prefilter');
  assert.equal(elements.scoringModel.value, 'reloaded-scoring');
  assert.equal(elements.intervalMinutes.value, '30');
  assert.equal(elements.rsshubBase.value, 'https://reloaded-rsshub.example');
  assert.equal(calls.length, 3);
});
