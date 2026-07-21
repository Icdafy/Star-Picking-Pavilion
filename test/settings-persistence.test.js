'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { persistSettingsUpdate } = require('../server/settings-persistence');

test('credential changes roll back when the settings file cannot be committed', async () => {
  const calls = [];
  const currentSettings = { ai: { apiKey: 'old-secret' } };
  const update = {
    settings: { ai: { apiKey: 'new-secret' } },
    apiKey: 'new-secret',
    credentialChanged: true
  };

  await assert.rejects(persistSettingsUpdate({
    currentSettings,
    update,
    persistCredential: async value => { calls.push(['credential', value]); },
    saveSettings: async () => { calls.push(['settings']); throw new Error('disk full'); }
  }), /disk full/);

  assert.deepEqual(calls, [
    ['credential', 'new-secret'],
    ['settings'],
    ['credential', 'old-secret']
  ]);
});

test('unchanged credentials are not rewritten', async () => {
  const calls = [];
  await persistSettingsUpdate({
    currentSettings: { ai: { apiKey: 'same' } },
    update: { settings: { ai: { apiKey: 'same' } }, apiKey: 'same', credentialChanged: false },
    persistCredential: async value => { calls.push(['credential', value]); },
    saveSettings: async () => { calls.push(['settings']); }
  });
  assert.deepEqual(calls, [['settings']]);
});
