'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createCredentialStore } = require('../electron/credential-store');

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: buffer => buffer.toString('utf8').replace(/^encrypted:/, '')
  };
}

test('credential store encrypts the API key and never writes plaintext', async t => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-credential-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const store = createCredentialStore({ safeStorage: fakeSafeStorage(), directory });

  await store.set('sk-test-secret');

  assert.equal(await store.get(), 'sk-test-secret');
  assert.doesNotMatch(await fs.promises.readFile(store.file, 'utf8'), /sk-test-secret/);
  assert.match(await fs.promises.readFile(store.file, 'utf8'), /ciphertext/);
});

test('legacy plaintext settings migrate only after encrypted value verifies', async t => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-credential-migration-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const settingsFile = path.join(directory, 'settings.json');
  await fs.promises.writeFile(settingsFile, JSON.stringify({
    ai: { apiKey: 'sk-legacy-secret', baseUrl: 'https://api.deepseek.com' },
    theme: 'dark'
  }));
  const store = createCredentialStore({ safeStorage: fakeSafeStorage(), directory });

  assert.equal(await store.migratePlaintextSettings(settingsFile), true);

  const saved = JSON.parse(await fs.promises.readFile(settingsFile, 'utf8'));
  assert.equal(Object.hasOwn(saved.ai, 'apiKey'), false);
  assert.equal(saved.theme, 'dark');
  assert.equal(await store.get(), 'sk-legacy-secret');
  const files = await fs.promises.readdir(directory);
  assert.equal(files.some(file => file.includes('plaintext-backup')), false);
  for (const file of files) {
    assert.doesNotMatch(await fs.promises.readFile(path.join(directory, file), 'utf8'), /sk-legacy-secret/);
  }
});

test('credential store refuses to persist when OS encryption is unavailable', async t => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-credential-unavailable-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const store = createCredentialStore({
    safeStorage: { ...fakeSafeStorage(), isEncryptionAvailable: () => false },
    directory
  });

  await assert.rejects(store.set('sk-test-secret'), /不可用|encryption/i);
  assert.equal(fs.existsSync(store.file), false);
});
