'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readDisplayRefreshRate, registerDisplayRefreshRateIpc, watchDisplayRefreshRate } = require('../electron/display-refresh-rate');
const { createTrustedIpcMain } = require('../electron/ipc-policy');

function fixture() {
  const screen = new EventEmitter(), window = new EventEmitter();
  let bounds = { x: 0, y: 0, width: 900, height: 700 }, rate = 60, destroyed = false;
  const sent = [], timers = new Map(), intervals = new Map();
  let next = 0;
  window.getBounds = () => bounds;
  window.isDestroyed = () => destroyed;
  window.isVisible = () => true;
  window.isFocused = () => true;
  window.webContents = { isDestroyed: () => destroyed, send: (...args) => sent.push(args) };
  screen.getDisplayMatching = rect => ({ id: rect.x > 1000 ? 2 : 1, displayFrequency: rate });
  return { screen, window, sent, timers, intervals,
    setRate(value) { rate = value; },
    moveToSecondDisplay() { bounds = { ...bounds, x: 1500 }; window.emit('move'); },
    destroy() { destroyed = true; window.emit('closed'); },
    flush() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    options: { screen, window,
      setTimeout(fn) { const id = ++next; timers.set(id, fn); return id; },
      clearTimeout(id) { timers.delete(id); },
      setInterval(fn) { const id = ++next; intervals.set(id, fn); return id; },
      clearInterval(id) { intervals.delete(id); } }
  };
}

test('native refresh uses the window display and preserves fractional rates, rejects invalid driver data', () => {
  const f = fixture();
  for (const rate of [59.94, 60, 70, 120, 144, 165]) {
    f.setRate(rate);
    assert.deepEqual(readDisplayRefreshRate(f), { displayId: '1', refreshRate: rate });
  }
  f.moveToSecondDisplay();
  assert.equal(readDisplayRefreshRate(f).displayId, '2');
  for (const rate of [0, 1, -60, NaN, Infinity, '144', null, 1001]) {
    f.setRate(rate);
    assert.equal(readDisplayRefreshRate(f).refreshRate, null);
  }
  f.destroy();
  assert.deepEqual(readDisplayRefreshRate(f), { displayId: '', refreshRate: null });
  assert.deepEqual(readDisplayRefreshRate({}), { displayId: '', refreshRate: null });
});

test('native refresh tracks same-size cross-screen moves both ways, refresh-only driver changes and cleanup', () => {
  const f = fixture();
  const monitor = watchDisplayRefreshRate(f.options);
  f.window.emit('focus'); f.flush();
  assert.deepEqual(f.sent.at(-1), ['display-refresh-rate:changed', { displayId: '1', refreshRate: 60 }]);
  f.setRate(144); f.moveToSecondDisplay(); f.flush();
  assert.deepEqual(f.sent.at(-1)[1], { displayId: '2', refreshRate: 144 });
  f.setRate(70); f.screen.emit('display-metrics-changed'); f.flush();
  assert.equal(f.sent.at(-1)[1].refreshRate, 70);
  f.setRate(60);
  [...f.intervals.values()].forEach(fn => fn());
  assert.equal(f.sent.at(-1)[1].refreshRate, 60, 'foreground polling catches refresh-only changes');
  const count = f.sent.length;
  f.window.emit('resize'); f.window.emit('resize'); f.flush();
  assert.equal(f.sent.length, count, 'unchanged native snapshots are not broadcast');
  f.window.emit('move');
  f.destroy(); monitor.dispose();
  assert.equal(f.timers.size, 0);
  assert.equal(f.intervals.size, 0);
  assert.equal(f.screen.eventNames().length, 0);
  assert.equal(f.window.eventNames().length, 0);
});

test('refresh IPC uses the existing trusted sender boundary and ignores renderer supplied display identity', () => {
  const f = fixture(), handlers = new Map();
  let trusted = false;
  const ipcMain = createTrustedIpcMain({ ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} },
    isTrusted: () => trusted });
  registerDisplayRefreshRateIpc({ ipcMain, screen: f.screen, getWindow: () => f.window });
  const get = handlers.get('display-refresh-rate:get');
  assert.throws(() => get({}, { displayId: 'other' }), /不允许/);
  trusted = true;
  assert.deepEqual(get({}, { displayId: 'other' }), { displayId: '1', refreshRate: 60 });
});
