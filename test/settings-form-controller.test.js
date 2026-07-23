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
