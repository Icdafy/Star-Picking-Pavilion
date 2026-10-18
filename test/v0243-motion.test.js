'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createFrameRateProbe, createMotion, createPointerEffects } = require('../renderer/dom-utils');
const { stepSpring, smoothValue, createFrameBudgetMonitor } = require('../renderer/aurora-engine');
const { advanceFluidPointer } = require('../renderer/dsh-aqua-engine');

const RATES = [60, 70, 120, 144];
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

class TrackedTarget extends EventTarget {
  registrations = new Map();
  addEventListener(type, callback, options) {
    if (!this.registrations.has(type)) this.registrations.set(type, new Set());
    this.registrations.get(type).add(callback); super.addEventListener(type, callback, options);
  }
  removeEventListener(type, callback, options) {
    this.registrations.get(type)?.delete(callback); super.removeEventListener(type, callback, options);
  }
  get listenerCount() { return [...this.registrations.values()].reduce((sum, listeners) => sum + listeners.size, 0); }
}

function environment() {
  const frames = new Map(), timers = new Map();
  let id = 0, time = 0, focused = true;
  const doc = new TrackedTarget(); doc.hidden = false; doc.hasFocus = () => focused;
  doc.documentElement = { dataset: { fxTier: 'full' }, style: { setProperty() {}, removeProperty() {} } };
  const win = new TrackedTarget();
  win.CustomEvent = CustomEvent;
  win.performance = { now: () => time };
  win.requestAnimationFrame = callback => { frames.set(++id, callback); return id; };
  win.cancelAnimationFrame = handle => frames.delete(handle);
  win.setTimeout = (callback, delay) => { timers.set(++id, { callback, delay }); return id; };
  win.clearTimeout = handle => timers.delete(handle);
  win.matchMedia = () => ({ matches: false });
  return { doc, win, frames, timers,
    frame(interval) { time += interval; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(time)); },
    sample(hz, count = 25) { for (let i = 0; i < count; i++) this.frame(1000 / hz); },
    fireTimers(delay) { for (const [key, timer] of [...timers]) if (timer.delay === delay) { timers.delete(key); timer.callback(); } },
    focus(value) { focused = value; win.dispatchEvent(new Event(value ? 'focus' : 'blur')); },
    hidden(value) { doc.hidden = value; doc.dispatchEvent(new Event('visibilitychange')); },
    get time() { return time; }
  };
}

function nativeBridge(read = () => Promise.resolve({ displayId: 'primary', refreshRate: 144 })) {
  let listener = null, unsubscribed = false, reads = 0;
  return { bridge: {
    getDisplayRefreshRate() { reads++; return read(); },
    onDisplayRefreshRateChanged(callback) { listener = callback; return () => { listener = null; unsubscribed = true; }; }
  }, change(rate, displayId = 'secondary') { listener?.({ refreshRate: rate, displayId }); },
  get reads() { return reads; }, get unsubscribed() { return unsubscribed; } };
}

test('v0243: native fractional refresh rates normalize to four profiles, preserving other displays', async () => {
  for (const [reported, expected] of [[59.94, 60], [69.9, 70], [119.88, 120], [143.9, 144], [75, 75], [165, 165], [240, 240], [83.25, 83.25]]) {
    const env = environment();
    const native = nativeBridge(() => Promise.resolve({ refreshRate: reported, displayId: 'primary' }));
    const changes = []; env.win.addEventListener('refresh-rate-change', event => changes.push(event.detail));
    const probe = createFrameRateProbe({ document: env.doc, window: env.win, desktop: native.bridge });
    await tick();
    assert.equal(probe.hz, expected); assert.equal(probe.detectedHz, expected); assert.equal(probe.source, 'native');
    assert.deepEqual(changes.at(-1), { hz: expected, detectedHz: expected, mode: 'auto', source: 'native' });
    assert.equal(env.doc.documentElement.dataset.refreshRateDetected, String(expected));
    assert.equal(env.frames.size, 0, 'valid system data cancels fallback sampling');
    probe.dispose();
  }
});

test('v0243: rAF fallback detects 60/70/120/144 and uncommon rates with occasional long frames', () => {
  for (const hz of [...RATES, 75, 165, 240, 83.25]) {
    const env = environment(), probe = createFrameRateProbe({ document: env.doc, window: env.win });
    for (let i = 0; i < 25; i++) env.frame(i === 8 ? 40 : 1000 / hz);
    near(probe.hz, hz, .01); assert.equal(probe.source, 'raf');
    probe.dispose();
  }
});

test('v0243: delayed native result outranks a slow startup rAF fallback and cannot be downgraded by rAF', async () => {
  const env = environment(), read = deferred(), native = nativeBridge(() => read.promise);
  const probe = createFrameRateProbe({ document: env.doc, window: env.win, desktop: native.bridge });
  env.sample(60); assert.equal(probe.hz, 60); assert.equal(probe.source, 'raf');
  read.resolve({ refreshRate: 144, displayId: 'primary' }); await tick();
  assert.equal(probe.hz, 144); assert.equal(probe.source, 'native');
  const pending = probe.measure('replace'); env.sample(60, 40); await pending;
  assert.equal(probe.hz, 144); assert.equal(probe.source, 'native');
  probe.dispose();
});

test('v0243: invalid or unavailable native data uses rAF and recovers on a valid native event', async () => {
  for (const value of [null, 0, -10, NaN, Infinity, 2000, '144']) {
    const env = environment(), native = nativeBridge(() => Promise.resolve({ refreshRate: value }));
    const probe = createFrameRateProbe({ document: env.doc, window: env.win, desktop: native.bridge });
    await tick(); env.sample(70); assert.equal(probe.hz, 70); assert.equal(probe.source, 'raf');
    native.change(119.88); assert.equal(probe.hz, 120); assert.equal(probe.source, 'native');
    probe.dispose();
  }
  const env = environment(), native = nativeBridge(() => Promise.reject(new Error('display unavailable')));
  const probe = createFrameRateProbe({ document: env.doc, window: env.win, desktop: native.bridge });
  await tick(); env.sample(120); assert.equal(probe.hz, 120); probe.dispose();
});

test('v0243: shared state tracks manual modes, caps to physical display and publishes only changes', async () => {
  const env = environment(), native = nativeBridge();
  const probe = createFrameRateProbe({ document: env.doc, window: env.win, desktop: native.bridge }); await tick();
  let changes = 0; env.win.addEventListener('refresh-rate-change', () => changes++);
  for (const rate of RATES) { probe.setMode(String(rate)); assert.equal(probe.hz, rate); }
  const previous = changes; probe.setMode('144'); assert.equal(changes, previous);
  native.change(60); assert.equal(probe.mode, '144'); assert.equal(probe.detectedHz, 60); assert.equal(probe.hz, 60);
  assert.deepEqual(env.doc.documentElement.dataset, { fxTier: 'full', refreshRate: '60', refreshRateDetected: '60', refreshRateMode: '144', refreshRateSource: 'native' });
  native.change(240); probe.setMode('auto'); assert.equal(probe.hz, 240);
  probe.setMode('invalid'); assert.equal(probe.mode, 'auto'); probe.dispose();
});

test('v0243: monitor events replace both faster and slower rates and invalidate stale native/rAF work', async () => {
  const env = environment(), old = deferred(), native = nativeBridge(() => old.promise);
  const probe = createFrameRateProbe({ document: env.doc, window: env.win, desktop: native.bridge });
  const staleFrame = [...env.frames.values()][0];
  native.change(144); native.change(60); assert.equal(probe.hz, 60);
  old.resolve({ refreshRate: 240 }); await tick(); staleFrame(1000 / 240);
  assert.equal(probe.hz, 60); assert.equal(env.frames.size, 0);
  native.change(120); assert.equal(probe.hz, 120);
  probe.dispose();
});

test('v0243: a valid native push completes an in-flight manual detection successfully', async () => {
  const env = environment(), read = deferred(), native = nativeBridge(() => read.promise);
  const probe = createFrameRateProbe({ document: env.doc, window: env.win, desktop: native.bridge });
  const pending = probe.measure('replace'); native.change(144);
  assert.equal(await pending, true); assert.equal(probe.hz, 144);
  read.resolve({ refreshRate: 60 }); await tick(); assert.equal(probe.hz, 144); probe.dispose();
});

test('v0243: resize re-reads a lower OS rate; focus and visibility abort samples and pending reads', async () => {
  const env = environment(), requests = [];
  const native = nativeBridge(() => { const request = deferred(); requests.push(request); return request.promise; });
  const probe = createFrameRateProbe({ document: env.doc, window: env.win, desktop: native.bridge });
  requests[0].resolve({ refreshRate: 144 }); await tick();
  env.win.dispatchEvent(new Event('resize')); env.fireTimers(200);
  requests[1].resolve({ refreshRate: 60 }); await tick(); assert.equal(probe.hz, 60);
  const pending = probe.measure('replace'); env.hidden(true); assert.equal(await pending, false);
  requests[2].resolve({ refreshRate: 240 }); await tick(); assert.equal(probe.hz, 60);
  env.hidden(false); requests[3].resolve({ refreshRate: 70 }); await tick(); assert.equal(probe.hz, 70);
  env.focus(false); assert.equal(await probe.measure('replace'), false);
  env.focus(true); requests[4].resolve({ refreshRate: 120 }); await tick(); assert.equal(probe.hz, 120);
  probe.dispose();
});

test('v0243: RAF measure promise waits for completion, legacy confirm replaces a lower rate', async () => {
  const env = environment(), probe = createFrameRateProbe({ document: env.doc, window: env.win });
  let completed = false; const pending = probe.measure('replace').then(value => { completed = true; return value; });
  env.sample(144, 24); await tick(); assert.equal(completed, false);
  env.sample(144, 1); assert.equal(await pending, true); assert.equal(probe.hz, 144);
  env.fireTimers(4000); env.sample(60); assert.equal(probe.hz, 60);
  const abort = probe.measure('replace'); env.focus(false); assert.equal(await abort, false); assert.equal(env.frames.size, 0);
  env.focus(true); env.sample(70); assert.equal(probe.hz, 70); probe.dispose();
});

test('v0243: dispose cancels frames/timers/subscriptions, settles promises and ignores late callbacks', async () => {
  const env = environment(), read = deferred(), native = nativeBridge(() => read.promise);
  const probe = createFrameRateProbe({ document: env.doc, window: env.win, desktop: native.bridge });
  const pending = probe.measure('replace'), staleFrame = [...env.frames.values()][0];
  const before = { ...env.doc.documentElement.dataset };
  probe.dispose(); assert.equal(await pending, false); assert.equal(env.frames.size, 0); assert.equal(env.timers.size, 0);
  assert.equal(env.doc.listenerCount, 0); assert.equal(env.win.listenerCount, 0); assert.equal(native.unsubscribed, true);
  read.resolve({ refreshRate: 240 }); await tick(); staleFrame(5); native.change(144); env.focus(true);
  assert.deepEqual(env.doc.documentElement.dataset, before); assert.equal(await probe.measure('replace'), false);
  assert.doesNotThrow(() => probe.dispose());
});

test('v0243: unfocused startup and missing platform APIs remain idle', async () => {
  const env = environment(); env.focus(false);
  const native = nativeBridge(), probe = createFrameRateProbe({ document: env.doc, window: env.win, desktop: native.bridge });
  assert.equal(env.frames.size, 0); assert.equal(native.reads, 0); probe.dispose();
  const bare = createFrameRateProbe(); assert.equal(await bare.measure('replace'), false); bare.dispose();
});

test('v0243: native-only environments wait for async measurement and a hung read can fall back safely', async () => {
  const env = environment(); delete env.win.requestAnimationFrame;
  const native = nativeBridge(), probe = createFrameRateProbe({ document: env.doc, window: env.win, desktop: native.bridge });
  assert.equal(await probe.measure('replace'), true); assert.equal(probe.hz, 144); probe.dispose();
  const fallback = environment(), pending = deferred(), bridge = nativeBridge(() => pending.promise);
  const sampled = createFrameRateProbe({ document: fallback.doc, window: fallback.win, desktop: bridge.bridge });
  const measurement = sampled.measure('replace'); fallback.fireTimers(1500); fallback.sample(70);
  assert.equal(await measurement, true); assert.equal(sampled.hz, 70); sampled.dispose();
});

test('v0243: exact spring and scrolling-speed filters follow identical physical time in all four profiles', () => {
  for (const ratio of [.3, 1, 1.8]) {
    const results = RATES.map(hz => {
      const axis = { p: -30, v: 15, t: 80 };
      let remaining = .5;
      while (remaining > 1e-9) { const dt = Math.min(1 / hz, remaining); stepSpring(axis, dt, 260, ratio, 1e-12); remaining -= dt; }
      return axis;
    });
    for (const result of results) { near(result.p, results[0].p); near(result.v, results[0].v); }
  }
  const speeds = RATES.map(hz => {
    let speed = 0;
    for (const target of [3400, 0]) for (let remaining = .2; remaining > 1e-9;) {
      const dt = Math.min(1 / hz, remaining); speed = smoothValue(speed, target, dt); remaining -= dt;
    }
    return speed;
  });
  speeds.forEach(speed => near(speed, speeds[0]));
});

test('v0243: sampled motion changes density without changing duration or spring easing', () => {
  const calls = [];
  for (const hz of RATES) {
    const env = environment(); env.win.CSS = { supports: () => true };
    const el = { dataset: {}, style: { setProperty() {} }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 40 }),
      animate(keyframes, options) { calls.push({ keyframes, options }); return { cancel() {}, finished: new Promise(() => {}) }; } };
    const motion = createMotion({ document: env.doc, window: env.win, frameRate: { hz }, tempo: 1.382 });
    motion.retargetIndicator(el, { x: 0, y: 120, width: 100, height: 40 });
    near(calls.at(-1).options.duration, 300 * 1.382); assert.equal(calls.at(-1).keyframes.at(-1).transform, 'translate(0px, 120px) scale(1, 1)');
    assert.equal(calls.at(-1).keyframes.length, Math.min(48, Math.round(300 * 1.382 * hz / 1000)) + 1);
    motion.dispose();
  }
});

test('v0243: sustained-load governor uses the same wall-clock interval and ignores jitter/idle/rate changes', () => {
  for (const hz of RATES) {
    const monitor = createFrameBudgetMonitor(); let triggeredAt = null;
    for (let frame = 1; frame <= hz * 2; frame++) if (monitor.record(1 / hz, 900 / hz, hz)) { triggeredAt = frame / hz; break; }
    assert.ok(triggeredAt >= 1.2 - 1e-8 && triggeredAt <= 1.2 + 1 / hz, `${hz}: ${triggeredAt}`);
    monitor.reset();
    for (let i = 0; i < hz * 4; i++) assert.equal(monitor.record((i % 8 === 0 ? 2 : 1) / hz, 0, hz), false);
    monitor.reset();
    for (let i = 0; i < hz; i++) monitor.record(1 / hz, 900 / hz, hz);
    assert.equal(monitor.record(.8, 0, hz), false, 'idle interval clears previous load');
    for (let i = 0; i < hz / 2; i++) assert.equal(monitor.record(1 / hz, 900 / hz, hz), false);
    assert.equal(monitor.record(1 / 60, 15, hz === 60 ? 144 : 60), false, 'display change clears the old budget');
  }
});

test('v0243: pointer material quality tolerates jitter and requires sustained slow rendering at every Hz', () => {
  for (const hz of RATES) {
    const env = environment(); env.doc.body = {}; env.doc.documentElement.dataset.refreshRateDetected = String(hz);
    const effects = createPointerEffects({ document: env.doc, window: env.win });
    for (let i = 0; i < hz * 4; i++) effects.recordFrame((i % 8 === 0 ? 2 : 1) / hz, 0);
    assert.equal(effects.getSnapshot().compositionLite, false);
    for (let i = 0; i < Math.ceil(hz * 1.3); i++) effects.recordFrame(1 / hz, 900 / hz);
    assert.equal(effects.getSnapshot().compositionLite, true); effects.dispose();
  }
});

test('v0243: fluid pointer filters preserve the upstream 30Hz motion across all refresh profiles', () => {
  const results = [30, ...RATES].map(hz => {
    const pointer = { x: .9, y: .2, smoothX: .5, smoothY: .5, svx: .03, svy: -.01 };
    for (let i = 0; i < hz; i++) advanceFluidPointer(pointer, 1 / hz);
    return pointer;
  });
  for (const pointer of results) for (const key of ['smoothX', 'smoothY', 'svx', 'svy']) near(pointer[key], results[0][key], 1e-12);
});

function shaderEnvironment(hz, { reduced = false, tier = 'full' } = {}) {
  const env = environment(), media = new TrackedTarget(); media.matches = reduced;
  env.win.matchMedia = query => query.includes('reduced-motion') ? media : { matches: false };
  env.win.navigator = { userAgent: 'Windows' }; env.win.devicePixelRatio = 1;
  env.doc.documentElement.dataset.fxTier = tier;
  let draws = 0, decayProduct = 1;
  const gl = new Proxy({
    createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), createTexture: () => ({}), createFramebuffer: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true, getUniformLocation: (_, name) => name, getAttribLocation: () => 0,
    uniform1f(name, value) { if (name === 'u_decay') decayProduct *= value; }, drawArrays() { draws++; }
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const canvas = { ownerDocument: env.doc, clientWidth: 160, clientHeight: 90, getContext: () => gl };
  const context = { module: { exports: {} }, window: env.win, navigator: env.win.navigator, performance: env.win.performance,
    requestAnimationFrame: env.win.requestAnimationFrame, cancelAnimationFrame: env.win.cancelAnimationFrame, console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/dsh-aqua-engine.js'), 'utf8'), context);
  const api = context.module.exports;
  const handle = api.attachFluidShader(canvas, api.SITE_FLUID_PARAMS, { frameRate: { hz } });
  return { ...env, handle, media, get draws() { return draws; }, get decayProduct() { return decayProduct; } };
}

test('v0243: actual fluid shader renders every display frame with identical one-second decay', () => {
  for (const hz of RATES) {
    const env = shaderEnvironment(hz); env.sample(hz, hz);
    assert.equal(env.draws, hz * 2, `${hz}Hz renders both shader passes each frame`);
    near(env.decayProduct, Math.pow(.96, 30), 1e-10);
    env.handle.setPaused(true); assert.equal(env.frames.size, 0);
    const previous = env.draws; env.sample(hz); assert.equal(env.draws, previous);
    env.handle.setPaused(false); env.sample(hz, 2); assert.equal(env.draws, previous + 4);
    env.handle.dispose(); assert.equal(env.frames.size, 0); assert.equal(env.media.listenerCount, 0);
  }
});

test('v0243: reduced/static fluid has no continuous frames and reduced-motion changes resume correctly', () => {
  for (const options of [{ reduced: true }, { tier: 'static' }]) {
    const env = shaderEnvironment(144, options); assert.equal(env.frames.size, 0); assert.equal(env.draws, 2);
    env.handle.setPaused(true); env.handle.setPaused(false); assert.equal(env.frames.size, 0); env.handle.dispose();
  }
  const env = shaderEnvironment(120, { reduced: true });
  env.media.matches = false; env.media.dispatchEvent(new Event('change')); assert.equal(env.frames.size, 1);
  env.sample(120, 3); const previous = env.draws;
  env.media.matches = true; env.media.dispatchEvent(new Event('change'));
  assert.equal(env.frames.size, 0); assert.equal(env.draws, previous + 2); env.handle.dispose();
});
