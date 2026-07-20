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

test('insecure remote AI base URLs are rejected', () => {
  assert.throws(
    () => applySettingsPatch(loadSettings(), { ai: { baseUrl: 'http://attacker.example/v1' } }),
    /HTTPS|地址/
  );
  assert.doesNotThrow(
    () => applySettingsPatch(loadSettings(), { ai: { baseUrl: 'http://127.0.0.1:11434/v1' } })
  );
});
