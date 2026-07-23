'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSettingsUpdateCoordinator,
  persistSettingsUpdate
} = require('../server/settings-persistence');

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

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

test('serializes complete settings transactions and recovers the queue after failure', async () => {
  const calls = [];
  const failFirstSave = deferred();
  const firstSaveStarted = deferred();
  const rollbackStarted = deferred();
  const finishRollback = deferred();
  let runtimeKey = 'dummy-old';
  let storedSettings = { ai: { apiKey: 'dummy-old' }, revision: 'old' };

  const coordinator = createSettingsUpdateCoordinator({
    loadSettings: () => {
      calls.push(['load', storedSettings.revision]);
      return structuredClone(storedSettings);
    },
    applySettingsPatch: (currentSettings, patch) => {
      calls.push(['apply', patch.revision, currentSettings.revision]);
      return {
        settings: { ai: { apiKey: patch.apiKey }, revision: patch.revision },
        apiKey: patch.apiKey,
        credentialChanged: true
      };
    },
    persistCredential: async value => {
      calls.push(['credential', value]);
      if (value === 'dummy-old' && runtimeKey === 'dummy-a') {
        rollbackStarted.resolve();
        await finishRollback.promise;
      }
      runtimeKey = value;
    },
    saveSettings: async settings => {
      calls.push(['settings', settings.revision]);
      if (settings.revision === 'A') {
        firstSaveStarted.resolve();
        await failFirstSave.promise;
        throw new Error('dummy disk failure');
      }
      storedSettings = structuredClone(settings);
    }
  });

  const failedA = assert.rejects(
    coordinator.submit({ revision: 'A', apiKey: 'dummy-a' }),
    /dummy disk failure/
  );
  await firstSaveStarted.promise;

  const updateBPromise = coordinator.submit({ revision: 'B', apiKey: 'dummy-b' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [
    ['load', 'old'],
    ['apply', 'A', 'old'],
    ['credential', 'dummy-a'],
    ['settings', 'A']
  ]);

  failFirstSave.resolve();
  await rollbackStarted.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [
    ['load', 'old'],
    ['apply', 'A', 'old'],
    ['credential', 'dummy-a'],
    ['settings', 'A'],
    ['credential', 'dummy-old']
  ]);

  finishRollback.resolve();
  await failedA;
  const updateB = await updateBPromise;

  assert.equal(updateB.settings.revision, 'B');
  assert.equal(runtimeKey, 'dummy-b');
  assert.equal(storedSettings.revision, 'B');
  assert.deepEqual(calls, [
    ['load', 'old'],
    ['apply', 'A', 'old'],
    ['credential', 'dummy-a'],
    ['settings', 'A'],
    ['credential', 'dummy-old'],
    ['load', 'old'],
    ['apply', 'B', 'old'],
    ['credential', 'dummy-b'],
    ['settings', 'B']
  ]);
});
