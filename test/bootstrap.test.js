'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const bootstrapPath = path.join(root, 'renderer', 'bootstrap.js');

function createStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    values
  };
}

test('CommonJS loading exports a frozen API without global pollution', () => {
  delete globalThis.StarPickingPavilionBootstrap;
  const api = require('../renderer/bootstrap');

  assert.equal(globalThis.StarPickingPavilionBootstrap, undefined);
  assert.equal(Object.isFrozen(api), true);
  assert.deepEqual(api.STORAGE_KEYS, {
    theme: 'star-picking-pavilion.theme',
    realtime: 'star-picking-pavilion.realtime',
    commonLinksFavorites: 'star-picking-pavilion.common-links.favorites'
  });
});

test('migrateStorage keeps the current value and does not inspect legacy keys', () => {
  const { migrateStorage } = require('../renderer/bootstrap');
  const storage = createStorage({ current: 'current-value', legacy: 'legacy-value' });
  let validations = 0;

  assert.equal(migrateStorage(storage, 'current', ['legacy'], () => { validations += 1; return true; }), 'current-value');
  assert.equal(validations, 0);
  assert.equal(storage.values.get('current'), 'current-value');
});

test('migrateStorage copies the first valid legacy value only', () => {
  const { migrateStorage } = require('../renderer/bootstrap');
  const storage = createStorage({ invalid: 'no', valid: 'yes' });

  assert.equal(migrateStorage(storage, 'current', ['invalid', 'valid'], value => value === 'yes'), 'yes');
  assert.equal(storage.values.get('current'), 'yes');
});

test('invalid legacy values never overwrite the current key', () => {
  const { migrateStorage } = require('../renderer/bootstrap');
  const storage = createStorage({ legacy: 'invalid' });

  assert.equal(migrateStorage(storage, 'current', ['legacy'], value => value === 'valid'), null);
  assert.equal(storage.values.has('current'), false);
});

test('browser head load migrates a valid legacy theme and applies it', () => {
  const source = fs.readFileSync(bootstrapPath, 'utf8');
  const localStorage = createStorage({ 'wc-theme': 'light' });
  const document = { documentElement: { dataset: {}, style: {} } };
  const context = vm.createContext({ localStorage, document });

  vm.runInContext(source, context, { filename: bootstrapPath });

  assert.equal(context.StarPickingPavilionBootstrap.STORAGE_KEYS.theme, 'star-picking-pavilion.theme');
  assert.equal(Object.isFrozen(context.StarPickingPavilionBootstrap), true);
  assert.equal(localStorage.values.get('star-picking-pavilion.theme'), 'light');
  assert.equal(document.documentElement.dataset.theme, 'light');
});

test('bootstrap is external, precedes the stylesheet, and replaces the inline theme script', () => {
  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  const bootstrapIndex = html.indexOf('<script src="bootstrap.js"></script>');
  const styleIndex = html.indexOf('<link rel="stylesheet" href="styles.css">');

  assert.ok(bootstrapIndex >= 0 && bootstrapIndex < styleIndex);
  assert.doesNotMatch(html, /<script(?!\s+src=)[^>]*>/i);
});
