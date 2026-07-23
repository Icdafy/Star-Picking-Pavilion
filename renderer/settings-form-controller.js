'use strict';

(function exposeSettingsFormController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.SettingsFormController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSettingsFormModule() {
  const FIELD_NAMES = Object.freeze([
    'apiKey',
    'baseUrl',
    'prefilterModel',
    'scoringModel',
    'intervalMinutes',
    'rsshubBase'
  ]);
  const AI_FIELD_NAMES = Object.freeze([
    'apiKey',
    'baseUrl',
    'prefilterModel',
    'scoringModel'
  ]);
  const COLLECT_FIELD_NAMES = Object.freeze(['intervalMinutes', 'rsshubBase']);

  function createSettingsFormController({ elements, request } = {}) {
    if (!elements || typeof request !== 'function') {
      throw new TypeError('settings form elements and request are required');
    }
    for (const name of FIELD_NAMES) {
      if (!elements[name] || typeof elements[name].addEventListener !== 'function') {
        throw new TypeError(`settings form field is required: ${name}`);
      }
    }
    if (!elements.clearApiKeyButton) {
      throw new TypeError('clear API key button is required');
    }

    const fieldStates = Object.fromEntries(FIELD_NAMES.map(name => [
      name,
      { revision: 0, dirty: false }
    ]));
    let latestLoadSequence = 0;
    for (const name of FIELD_NAMES) {
      elements[name].addEventListener('input', () => {
        fieldStates[name].revision += 1;
        fieldStates[name].dirty = true;
      });
    }

    const snapshot = () => Object.fromEntries(
      FIELD_NAMES.map(name => [name, fieldStates[name].revision])
    );
    const canApplyLoad = (name, prior) => (
      !fieldStates[name].dirty
      && fieldStates[name].revision === prior[name]
    );
    const markSynchronizedIfUnchanged = (name, prior) => {
      if (fieldStates[name].revision !== prior[name]) return false;
      fieldStates[name].revision += 1;
      fieldStates[name].dirty = false;
      return true;
    };

    function updateCredentialMetadata(hasKey) {
      const stored = Boolean(hasKey);
      elements.apiKey.dataset.hasStoredKey = String(stored);
      elements.apiKey.placeholder = stored
        ? '已由 Windows 安全保存；输入新值可替换'
        : 'sk-…（留空则使用关键词启发式降级模式）';
      elements.clearApiKeyButton.disabled = !stored;
    }

    async function load() {
      const sequence = ++latestLoadSequence;
      const prior = snapshot();
      const settings = await request('/api/settings');
      if (sequence !== latestLoadSequence) return settings;

      if (canApplyLoad('apiKey', prior)) {
        elements.apiKey.value = '';
        updateCredentialMetadata(settings.ai._hasKey);
      }
      if (canApplyLoad('baseUrl', prior)) {
        elements.baseUrl.value = settings.ai.baseUrl;
      }
      if (canApplyLoad('prefilterModel', prior)) {
        elements.prefilterModel.value = settings.ai.prefilterModel;
      }
      if (canApplyLoad('scoringModel', prior)) {
        elements.scoringModel.value = settings.ai.scoringModel;
      }
      if (canApplyLoad('intervalMinutes', prior)) {
        elements.intervalMinutes.value = settings.collect.intervalMinutes;
      }
      if (canApplyLoad('rsshubBase', prior)) {
        elements.rsshubBase.value = settings.collect.rsshubBase || '';
      }
      return settings;
    }

    async function saveAi() {
      const submitted = snapshot();
      const apiKey = elements.apiKey.value.trim();
      const aiPatch = {
        baseUrl: elements.baseUrl.value || 'https://api.deepseek.com',
        prefilterModel: elements.prefilterModel.value || 'deepseek-v4-flash',
        scoringModel: elements.scoringModel.value || 'deepseek-v4-pro'
      };
      if (apiKey) aiPatch.apiKey = apiKey;
      const result = await request('/api/settings', { body: { ai: aiPatch } });
      let apiKeySynchronized = false;
      for (const name of AI_FIELD_NAMES) {
        const synchronized = markSynchronizedIfUnchanged(name, submitted);
        if (name === 'apiKey') apiKeySynchronized = synchronized;
      }
      updateCredentialMetadata(result.credentialConfigured);
      if (apiKeySynchronized) elements.apiKey.value = '';
      return result;
    }

    async function clearApiKey() {
      const submitted = snapshot();
      const result = await request('/api/settings', {
        body: { ai: { apiKey: null } }
      });
      const apiKeySynchronized = markSynchronizedIfUnchanged('apiKey', submitted);
      updateCredentialMetadata(result.credentialConfigured);
      if (apiKeySynchronized) elements.apiKey.value = '';
      return result;
    }

    async function saveCollect() {
      const submitted = snapshot();
      const result = await request('/api/settings', {
        body: {
          collect: {
            intervalMinutes: Number(elements.intervalMinutes.value) || 30,
            rsshubBase: elements.rsshubBase.value.trim()
          }
        }
      });
      for (const name of COLLECT_FIELD_NAMES) {
        markSynchronizedIfUnchanged(name, submitted);
      }
      return result;
    }

    return Object.freeze({ load, saveAi, clearApiKey, saveCollect });
  }

  return Object.freeze({ createSettingsFormController });
});
