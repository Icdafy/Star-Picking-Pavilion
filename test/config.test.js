'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-config-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = dataDir;
process.env.STAR_PICKING_PAVILION_AI_API_KEY = 'sk-runtime-secret';

const { closeDatabase } = require('../server/db');
const {
  SETTINGS_PATH,
  applySettingsPatch,
  loadSettings,
  saveSettings
} = require('../server/config');

test.after(async () => {
  closeDatabase();
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

test('settings save is atomic and never persists the API key', async () => {
  const settings = loadSettings();
  settings.ai.apiKey = 'sk-plain-must-not-persist';
  settings.collect.intervalMinutes = 17;

  await saveSettings(settings);

  const raw = await fs.promises.readFile(SETTINGS_PATH, 'utf8');
  assert.doesNotMatch(raw, /sk-plain-must-not-persist|sk-runtime-secret/);
  const saved = JSON.parse(raw);
  assert.equal(Object.hasOwn(saved.ai, 'apiKey'), false);
  assert.equal(saved.collect.intervalMinutes, 17);
});

test('failed atomic rename preserves the previous valid settings file', async () => {
  const before = await fs.promises.readFile(SETTINGS_PATH, 'utf8');
  const settings = loadSettings();
  settings.collect.intervalMinutes = 23;

  await assert.rejects(
    saveSettings(settings, { rename: async () => { throw new Error('injected rename failure'); } }),
    /injected rename failure/
  );

  assert.equal(await fs.promises.readFile(SETTINGS_PATH, 'utf8'), before);
  assert.equal((await fs.promises.readdir(dataDir)).some(file => file.endsWith('.tmp')), false);
});

test('changing a remote AI base URL clears the credential unless a replacement is supplied', () => {
  const current = loadSettings();
  const cleared = applySettingsPatch(current, { ai: { baseUrl: 'https://models.example/v1' } });
  assert.equal(cleared.settings.ai.baseUrl, 'https://models.example/v1');
  assert.equal(cleared.apiKey, '');
  assert.equal(cleared.credentialChanged, true);

  const replaced = applySettingsPatch(current, {
    ai: { baseUrl: 'https://models.example/v1', apiKey: 'sk-replacement' }
  });
  assert.equal(replaced.apiKey, 'sk-replacement');
  assert.equal(replaced.settings.ai.apiKey, 'sk-replacement');
});

test('blank credential input preserves the stored key and null explicitly clears it', () => {
  const current = loadSettings();
  const preserved = applySettingsPatch(current, { ai: { apiKey: '' } });
  assert.equal(preserved.apiKey, 'sk-runtime-secret');
  assert.equal(preserved.credentialChanged, false);

  const cleared = applySettingsPatch(current, { ai: { apiKey: null } });
  assert.equal(cleared.apiKey, '');
  assert.equal(cleared.credentialChanged, true);
});

test('insecure remote AI base URLs are rejected', () => {
  assert.throws(
    () => applySettingsPatch(loadSettings(), { ai: { baseUrl: 'http://attacker.example/v1' } }),
    /HTTPS|地址/
  );
  assert.doesNotThrow(
    () => applySettingsPatch(loadSettings(), { ai: { baseUrl: 'http://127.0.0.1:11434/v1' } })
  );
});

test('editable settings reject invalid numeric, URL, and model values', () => {
  const current = loadSettings();
  assert.throws(() => applySettingsPatch(current, []), /设置请求体/);
  assert.throws(() => applySettingsPatch(current, { unexpected: true }), /设置字段/);
  assert.throws(() => applySettingsPatch(current, { ai: [] }), /AI 设置/);
  assert.throws(() => applySettingsPatch(current, { collect: { intervalMinutes: 0 } }), /采集间隔/);
  assert.throws(() => applySettingsPatch(current, { collect: { intervalMinutes: 'ten' } }), /采集间隔/);
  assert.throws(() => applySettingsPatch(current, { collect: { rsshubBase: 'file:///secret' } }), /RSSHub/);
  assert.throws(() => applySettingsPatch(current, { ai: { scoringModel: '' } }), /模型/);

  const valid = applySettingsPatch(current, {
    collect: { intervalMinutes: 30, rsshubBase: 'https://rsshub.example/' }
  });
  assert.equal(valid.settings.collect.intervalMinutes, 30);
  assert.equal(valid.settings.collect.rsshubBase, 'https://rsshub.example');
});

test('loading a malformed legacy settings file normalizes scheduler and request bounds', async () => {
  await fs.promises.writeFile(SETTINGS_PATH, `{
    "__proto__": { "polluted": true },
    "unknown": "discard me",
    "dailyReportHour": 99,
    "ai": { "requestTimeoutMs": -1, "maxBatchPrefilter": 500, "prefilterModel": "" },
    "collect": {
      "intervalMinutes": 9999,
      "analyzeIntervalSeconds": 0,
      "keepDays": -20,
      "requestTimeoutMs": "forever",
      "userAgent": "bad\\nheader",
      "rsshubBase": "file:///private"
    }
  }`, 'utf8');

  const loaded = loadSettings();
  assert.equal(loaded.dailyReportHour, 8);
  assert.equal(loaded.ai.requestTimeoutMs, 60000);
  assert.equal(loaded.ai.maxBatchPrefilter, 20);
  assert.equal(loaded.ai.prefilterModel, 'deepseek-v4-flash');
  assert.equal(loaded.collect.intervalMinutes, 10);
  assert.equal(loaded.collect.analyzeIntervalSeconds, 75);
  assert.equal(loaded.collect.keepDays, 30);
  assert.equal(loaded.collect.requestTimeoutMs, 20000);
  assert.match(loaded.collect.userAgent, /^Mozilla\//);
  assert.equal(loaded.collect.rsshubBase, '');
  assert.equal(Object.hasOwn(loaded, 'unknown'), false);
  assert.equal({}.polluted, undefined);
});
