'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Schema = require('../renderer/ui-preference-schema');
const CommonLinks = require('../renderer/common-links');
const Bootstrap = require('../renderer/bootstrap');
const { createUiPreferencesStore } = require('../electron/ui-preferences');
const { advancePointerAxis } = require('../renderer/dom-utils');

test('v0231: old saved glow settings receive new optional defaults without rewriting the old file', async t => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-v0231-pointer-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const old = { version: 2, theme: 'dark', pointerEnabled: false, pointerSize: 587, pointerColor: '#112233' };
  const bytes = JSON.stringify(old, null, 4);
  await fs.promises.writeFile(path.join(directory, 'ui-preferences.json'), bytes);
  const store = createUiPreferencesStore({ directory });
  const prefs = await store.load();
  for (const patch of [{ pointerStyle: 'unknown' }, { pointerRingSize: 11 }, { pointerStarsSize: '6' }, { pointerOpacity: 101 }]) {
    assert.throws(() => store.update(patch), /supported pointer effect value/);
  }
  assert.equal(prefs.pointerStyle, 'glow');
  assert.equal(prefs.pointerEnabled, false); assert.equal(prefs.pointerSize, 587); assert.equal(prefs.pointerColor, '#112233');
  assert.equal(await fs.promises.readFile(store.file, 'utf8'), bytes);
  const { version, ...values } = prefs;
  assert.deepEqual(Bootstrap.normalizeUiPreferences(old, CommonLinks, { fallback: Schema.getLegacyUiPreferences(CommonLinks) }), values);
  await store.update({ pointerStyle: 'stars', pointerStarsSize: 11, pointerRingSize: 76, pointerOpacity: 47 });
  const reloaded = await createUiPreferencesStore({ directory }).load();
  assert.equal(reloaded.pointerStyle, 'stars'); assert.equal(reloaded.pointerStarsSize, 11);
  assert.equal(reloaded.pointerRingSize, 76); assert.equal(reloaded.pointerSize, 587); assert.equal(reloaded.pointerOpacity, 47);
});

test('v0231: every style and size is validated identically in renderer and native preference patches', () => {
  for (const [style, spec] of Object.entries(Schema.POINTER_STYLES)) {
    assert.deepEqual(Schema.createUiPreferencePatch('pointerStyle', style, CommonLinks), { pointerStyle: style });
    for (const value of [spec.min, spec.max]) assert.deepEqual(Schema.createUiPreferencePatch(spec.field, value, CommonLinks), { [spec.field]: value });
    for (const value of [spec.min - 1, spec.max + 1, NaN, Infinity, String(spec.min)]) assert.deepEqual(Schema.createUiPreferencePatch(spec.field, value, CommonLinks), {});
  }
  for (const value of ['water', 'smoke', '__proto__', null, {}]) assert.deepEqual(Schema.createUiPreferencePatch('pointerStyle', value, CommonLinks), {});
  for (const value of [0, 101, NaN, '60']) assert.deepEqual(Schema.createUiPreferencePatch('pointerOpacity', value, CommonLinks), {});
  const raw = { pointerStyle: 'ring', pointerSize: 630, pointerCometSize: 780, pointerStarsSize: 2, pointerRingSize: 12, pointerColor: '#ffffff', pointerOpacity: 10 };
  const preferences = Schema.normalizeUiPreferences(raw, CommonLinks);
  for (const [key, value] of Object.entries(raw)) assert.equal(preferences[key], value);
});

test('v0231: elastic following has the same real-time position at 30, 60 and 144 Hz and after a long frame', () => {
  function simulate(rate) {
    const axis = { position: 0, target: 600, velocity: 0 };
    for (let i = 0; i < rate / 2; i++) advancePointerAxis(axis, 1 / rate);
    return axis;
  }
  const reference = simulate(60);
  for (const rate of [30, 144]) {
    const actual = simulate(rate);
    assert.ok(Math.abs(actual.position - reference.position) < .001);
    assert.ok(Math.abs(actual.velocity - reference.velocity) < .001);
  }
  const stalled = { position: 0, target: 600, velocity: 0 };
  assert.equal(advancePointerAxis(stalled, 2), true);
  assert.equal(stalled.position, 600); assert.equal(stalled.velocity, 0);
  stalled.target = 100;
  advancePointerAxis(stalled, 1 / 60);
  assert.ok(stalled.position < 600 && stalled.position > 100);
});
