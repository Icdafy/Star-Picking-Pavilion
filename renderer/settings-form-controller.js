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

    const revisions = Object.fromEntries(FIELD_NAMES.map(name => [name, 0]));
    for (const name of FIELD_NAMES) {
      elements[name].addEventListener('input', () => {
        revisions[name] += 1;
      });
    }

    const snapshot = () => Object.fromEntries(
      FIELD_NAMES.map(name => [name, revisions[name]])
    );
    const isUnchanged = (name, prior) => revisions[name] === prior[name];
    const markSynchronized = names => {
      for (const name of names) revisions[name] += 1;
    };

    function setCredentialState(hasKey) {
      const stored = Boolean(hasKey);
      elements.apiKey.value = '';
      elements.apiKey.dataset.hasStoredKey = String(stored);
      elements.apiKey.placeholder = stored
        ? '已由 Windows 安全保存；输入新值可替换'
        : 'sk-…（留空则使用关键词启发式降级模式）';
      elements.clearApiKeyButton.disabled = !stored;
    }

    async function load() {
      const prior = snapshot();
      const settings = await request('/api/settings');

      if (isUnchanged('apiKey', prior)) {
        setCredentialState(settings.ai._hasKey);
      }
      if (isUnchanged('baseUrl', prior)) {
        elements.baseUrl.value = settings.ai.baseUrl;
      }
      if (isUnchanged('prefilterModel', prior)) {
        elements.prefilterModel.value = settings.ai.prefilterModel;
      }
      if (isUnchanged('scoringModel', prior)) {
        elements.scoringModel.value = settings.ai.scoringModel;
      }
      if (isUnchanged('intervalMinutes', prior)) {
        elements.intervalMinutes.value = settings.collect.intervalMinutes;
      }
      if (isUnchanged('rsshubBase', prior)) {
        elements.rsshubBase.value = settings.collect.rsshubBase || '';
      }
      return settings;
    }

    async function saveAi() {
      const apiKey = elements.apiKey.value.trim();
      const aiPatch = {
        baseUrl: elements.baseUrl.value || 'https://api.deepseek.com',
        prefilterModel: elements.prefilterModel.value || 'deepseek-v4-flash',
        scoringModel: elements.scoringModel.value || 'deepseek-v4-pro'
      };
      if (apiKey) aiPatch.apiKey = apiKey;
      const result = await request('/api/settings', { body: { ai: aiPatch } });
      markSynchronized(AI_FIELD_NAMES);
      setCredentialState(result.credentialConfigured);
      return result;
    }

    async function clearApiKey() {
      const result = await request('/api/settings', {
        body: { ai: { apiKey: null } }
      });
      markSynchronized(['apiKey']);
      setCredentialState(false);
      return result;
    }

    async function saveCollect() {
      const result = await request('/api/settings', {
        body: {
          collect: {
            intervalMinutes: Number(elements.intervalMinutes.value) || 30,
            rsshubBase: elements.rsshubBase.value.trim()
          }
        }
      });
      markSynchronized(COLLECT_FIELD_NAMES);
      return result;
    }

    return Object.freeze({ load, saveAi, clearApiKey, saveCollect });
  }

  return Object.freeze({ createSettingsFormController });
});
