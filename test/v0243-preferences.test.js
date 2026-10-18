'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Schema = require('../renderer/ui-preference-schema');
const CommonLinks = require('../renderer/common-links');
const Aqua = require('../renderer/aqua-shell');
const { createUiPreferencesStore } = require('../electron/ui-preferences');

function eventTarget(values = {}) {
  const listeners = new Map();
  return Object.assign(values, {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
    emit(type, values = {}) {
      return Promise.all([...listeners.get(type) || []].map(handler => handler({ currentTarget: this, ...values })));
    },
    listenerCount(type) { return listeners.get(type)?.size || 0; }
  });
}

function element(values = {}) {
  return eventTarget({
    dataset: {}, value: '', textContent: '', disabled: false,
    style: { setProperty() {} },
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    toggleAttribute() {}, remove() {},
    ...values
  });
}

function shellFixture(preferences = {}, overrides = {}) {
  const view = Object.fromEntries(['setRefreshRate', 'refreshRateStatus', 'btnRefreshRateDetect', 'btnAquaReset'].map(id => [id, element()]));
  const doc = eventTarget({
    documentElement: element({ dataset: { theme: 'light' } }), hidden: false,
    hasFocus: () => true, getElementById: id => view[id] || null,
    querySelector: () => null, querySelectorAll: () => [], createElement: () => element()
  });
  const win = eventTarget({ setTimeout, clearTimeout, matchMedia: () => eventTarget({ matches: false }) });
  const modes = [];
  const measurements = [];
  const frameRate = {
    mode: 'auto', detectedHz: 144, hz: 144, source: 'native',
    setMode(mode) {
      this.mode = mode;
      modes.push(mode);
      this.hz = mode === 'auto' ? this.detectedHz : Math.min(this.detectedHz, Number(mode));
      win.emit('refresh-rate-change');
    },
    async measure(mode) { measurements.push(mode); },
    ...overrides
  };
  const patches = [];
  const changes = [];
  const shell = Aqua.createAquaShell({ document: doc, window: win, frameRate, preferences,
    persist: patch => patches.push(patch), onChange: patch => changes.push(patch) });
  return { view, win, frameRate, modes, measurements, patches, changes, shell };
}

test('refresh choice validates identically in the shared schema and appearance controller, including legacy auto', () => {
  assert.deepEqual(Schema.REFRESH_RATES, ['auto', '60', '70', '120', '144']);
  assert.equal(Schema.DEFAULT_APPEARANCE.refreshRate, 'auto');
  assert.equal(Schema.getLegacyUiPreferences(CommonLinks).refreshRate, 'auto');
  assert.ok(Aqua.FIELDS.includes('refreshRate'));
  for (const mode of Schema.REFRESH_RATES) {
    assert.equal(Aqua.normalizeSettings({ refreshRate: mode }).refreshRate, mode);
    assert.equal(Schema.normalizeUiPreferences({ refreshRate: mode }, CommonLinks).refreshRate, mode);
    assert.deepEqual(Schema.createUiPreferencePatch('refreshRate', mode, CommonLinks), { refreshRate: mode });
  }
  for (const invalid of [undefined, null, 60, 144, '90', 'native', 'AUTO', {}, []]) {
    assert.equal(Aqua.normalizeSettings({ refreshRate: invalid }).refreshRate, 'auto');
    assert.equal(Schema.normalizeUiPreferences({ refreshRate: invalid }, CommonLinks).refreshRate, 'auto');
    assert.deepEqual(Schema.createUiPreferencePatch('refreshRate', invalid, CommonLinks), {});
  }
});

test('desktop preference persistence retains the local choice while rejecting measured hardware fields', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spp-v0243-refresh-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createUiPreferencesStore({ directory });
  await store.load();
  await store.update({ refreshRate: '70' });
  assert.throws(() => store.update({ detectedHz: 144, hz: 70, source: 'native' }), /unsupported|unknown|invalid/i);
  const persisted = JSON.parse(await fs.readFile(store.file, 'utf8'));
  assert.equal(persisted.refreshRate, '70');
  for (const field of ['detectedHz', 'hz', 'source']) assert.equal(Object.hasOwn(persisted, field), false);
  assert.equal((await createUiPreferencesStore({ directory }).load()).refreshRate, '70');
  assert.throws(() => store.update({ refreshRate: 144 }), /refreshRate/i);
  assert.equal(store.getSnapshot().refreshRate, '70');
});

test('refresh controls apply once, persist only choices, and update live hardware status without feedback', async () => {
  const fixture = shellFixture();
  const { shell, view, modes, patches, changes, frameRate, win } = fixture;
  assert.deepEqual(modes, ['auto']);
  assert.equal(view.setRefreshRate.value, 'auto');
  assert.match(view.refreshRateStatus.textContent, /检测到 144 Hz.*当前动效采样 144 Hz.*系统显示器信息.*自动适配/);
  view.setRefreshRate.value = '120';
  await view.setRefreshRate.emit('change');
  assert.deepEqual(modes, ['auto', '120']);
  assert.deepEqual(patches, [{ refreshRate: '120' }]);
  assert.deepEqual(changes, [{ refreshRate: '120' }]);
  assert.match(view.refreshRateStatus.textContent, /当前动效采样 120 Hz.*手动 120 Hz/);
  frameRate.detectedHz = 60;
  frameRate.hz = 60;
  frameRate.source = 'raf';
  await win.emit('refresh-rate-change');
  assert.match(view.refreshRateStatus.textContent, /检测到 60 Hz.*采样 60 Hz.*本机动效实测.*受显示器刷新率限制/);
  assert.equal(view.setRefreshRate.value, '120', 'moving the window does not replace the user choice');
  assert.equal(patches.length, 1);
  assert.equal(modes.length, 2, 'hardware events cannot re-enter setMode');
  await view.setRefreshRate.emit('change');
  assert.equal(patches.length, 1, 'unchanged control emits no extra persistence');
  shell.dispose();
  assert.equal(win.listenerCount('refresh-rate-change'), 0);
  assert.equal(view.setRefreshRate.listenerCount('change'), 0);
});

test('re-detection replaces the measurement and default reset restores auto while preserving other explicit switches', async () => {
  const { shell, view, modes, measurements, patches } = shellFixture({ refreshRate: '70', aquaEnabled: true, pointerEnabled: false });
  await view.btnRefreshRateDetect.emit('click');
  assert.deepEqual(measurements, ['replace']);
  assert.equal(view.btnRefreshRateDetect.disabled, false);
  assert.equal(view.btnRefreshRateDetect.attributes.get('aria-busy'), 'false');
  assert.equal(patches.length, 0, 'measurements are never stored as preferences');
  await view.btnAquaReset.emit('click');
  assert.equal(shell.getSettings().refreshRate, 'auto');
  assert.equal(shell.getSettings().aquaEnabled, true);
  assert.equal(shell.getSettings().pointerEnabled, false);
  assert.deepEqual(modes, ['70', 'auto']);
  assert.equal(patches.at(-1).refreshRate, 'auto');
  assert.equal(view.setRefreshRate.value, 'auto');
  shell.dispose();
});

test('failed detection leaves the existing rate in use and keeps the retry action available', async () => {
  for (const measure of [async () => false, async () => { throw new Error('unavailable'); }]) {
    const { shell, view, modes, patches } = shellFixture({ refreshRate: '60' }, { measure });
    await view.btnRefreshRateDetect.emit('click');
    assert.equal(view.btnRefreshRateDetect.disabled, false);
    assert.match(view.refreshRateStatus.textContent, /检测未完成.*继续使用当前采样档位/);
    assert.deepEqual(modes, ['60']);
    assert.deepEqual(patches, []);
    shell.dispose();
  }
});

test('re-detection remains busy until the asynchronous probe finishes and the fallback is labelled honestly', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { shell, view, frameRate } = shellFixture({}, { source: 'default', detectedHz: 60, hz: 60, measure: () => pending });
  assert.match(view.refreshRateStatus.textContent, /等待检测.*采样 60 Hz.*保守默认值/);
  assert.doesNotMatch(view.refreshRateStatus.textContent, /检测到 60 Hz/);
  const detection = view.btnRefreshRateDetect.emit('click');
  assert.equal(view.btnRefreshRateDetect.disabled, true);
  assert.equal(view.btnRefreshRateDetect.attributes.get('aria-busy'), 'true');
  assert.match(view.refreshRateStatus.textContent, /正在检测/);
  frameRate.source = 'native';
  frameRate.detectedHz = 144;
  frameRate.hz = 144;
  finish();
  await detection;
  assert.equal(view.btnRefreshRateDetect.disabled, false);
  assert.match(view.refreshRateStatus.textContent, /检测到 144 Hz.*系统显示器信息/);
  shell.dispose();
});

function backdropFixture(hz, tier = 'full') {
  let time = 0;
  let nextFrame = 0;
  let draws = 0;
  const frames = new Map();
  const gradient = { addColorStop() {} };
  const context = {
    clearRect() { draws += 1; }, fillRect() {}, createRadialGradient: () => gradient,
    beginPath() {}, arc() {}, fill() {}
  };
  const canvas = { clientWidth: 480, clientHeight: 320, getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 480, height: 320 }) };
  const doc = eventTarget({ documentElement: { dataset: { theme: 'light', fxTier: tier } } });
  const win = eventTarget({ performance: { now: () => time },
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); }
  });
  const backdrop = Aqua.createFluidBackdrop({ canvas, document: doc, window: win, frameRate: { hz } });
  return {
    backdrop, get draws() { return draws; }, get pending() { return frames.size; },
    step(now) { time = now; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(now)); }
  };
}

test('compatibility backdrop follows all four display cadences and lite uses a stable divisor', () => {
  for (const hz of [60, 70, 120, 144]) {
    for (const tier of ['full', 'lite']) {
      const fixture = backdropFixture(hz, tier);
      for (let index = 1; index <= hz; index += 1) fixture.step(index * 1000 / hz);
      const expected = hz / (tier === 'lite' ? 2 : 1);
      assert.ok(Math.abs(fixture.draws - 1 - expected) <= 1, `${hz} Hz ${tier}: ${fixture.draws - 1} draws instead of ${expected}`);
      fixture.backdrop.dispose();
      assert.equal(fixture.pending, 0);
    }
  }
});

test('compatibility backdrop does not leave animation work scheduled when static or paused', () => {
  const staticFixture = backdropFixture(144, 'static');
  assert.equal(staticFixture.draws, 1);
  assert.equal(staticFixture.pending, 0);
  staticFixture.backdrop.setPaused(false);
  assert.equal(staticFixture.pending, 0);
  staticFixture.backdrop.dispose();
  const fixture = backdropFixture(144);
  assert.equal(fixture.pending, 1);
  fixture.backdrop.setPaused(true);
  assert.equal(fixture.pending, 0);
  const pausedDraws = fixture.draws;
  fixture.step(500);
  assert.equal(fixture.draws, pausedDraws);
  fixture.backdrop.setPaused(false);
  assert.equal(fixture.pending, 1);
  fixture.backdrop.dispose();
  assert.equal(fixture.pending, 0);
});
