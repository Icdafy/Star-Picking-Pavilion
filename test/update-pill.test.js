'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createUpdatePill } = require('../renderer/update-pill');
const source = fs.readFileSync(path.join(__dirname, '../renderer/update-pill.js'), 'utf8');

test('update button is an isolated frozen UMD factory', () => {
  assert.doesNotMatch(source, /\bwindow\./);
  const result = spawnSync(process.execPath, ['-e', `delete globalThis.UpdatePill;const api=require(${JSON.stringify(require.resolve('../renderer/update-pill'))});process.stdout.write(JSON.stringify([typeof api.createUpdatePill,Object.isFrozen(api),Object.hasOwn(globalThis,'UpdatePill')]));`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ['function', true, false]);
});

function element() {
  const attrs = new Map(), classes = new Set(), listeners = {};
  return { hidden: true, disabled: false, textContent: '', title: '', dataset: {},
    setAttribute: (key, value) => attrs.set(key, value), getAttribute: key => attrs.get(key), removeAttribute: key => attrs.delete(key),
    classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name), has: name => classes.has(name) },
    addEventListener: (name, handler) => { listeners[name] = handler; }, dispatch: name => listeners[name]?.() };
}
function fixture(bridge = {}) {
  const pill = element(), arc = element(), icon = element(), value = element(), caption = element(), progress = element(), live = element();
  const nodes = { arc, icon, value, caption };
  pill.querySelector = selector => nodes[selector.match(/data-update-(\w+)/)[1]];
  let onStatus, installed = 0, checked = 0;
  const desktop = { onUpdateStatus: handler => { onStatus = handler; }, installUpdate: () => { installed++; },
    checkForUpdates: async () => { checked++; return { started: true }; }, ...bridge };
  const ctrl = createUpdatePill({ desktop, pill, progress, live });
  return { pill, arc, icon, value, caption, progress, live, ctrl, status: payload => onStatus(payload),
    get installed() { return installed; }, get checked() { return checked; } };
}

test('browser-only pages have no update control', () => {
  assert.equal(createUpdatePill({}), null);
  assert.equal(createUpdatePill({ desktop: {}, pill: element() }), null);
  assert.equal(createUpdatePill({ desktop: { onUpdateStatus() {} } }), null);
});

test('the button retains its structure and renders real progress, ready and installing states', async () => {
  const f = fixture();
  assert.equal(f.pill.hidden, false);
  assert.equal(f.pill.getAttribute('aria-label'), '检查更新');
  f.status({ status: 'available', version: '0.6.0' });
  assert.equal(f.pill.dataset.indeterminate, 'true');
  f.status({ status: 'downloading', percent: 42 });
  assert.equal(f.value.textContent, '42%');
  assert.equal(f.arc.getAttribute('stroke-dashoffset'), '58');
  assert.equal(f.progress.getAttribute('aria-valuenow'), '42');
  assert.equal(f.pill.getAttribute('aria-label'), '下载更新 0.6.0 42%');
  await f.pill.dispatch('click');
  assert.equal(f.installed, 0); assert.equal(f.checked, 0);
  f.status({ status: 'downloaded', version: '0.6.0' });
  assert.equal(f.pill.classList.has('ready'), true);
  assert.equal(f.caption.textContent, '重启');
  assert.equal(f.arc.getAttribute('stroke-dashoffset'), '0');
  assert.equal(f.progress.hidden, true);
  await f.pill.dispatch('click'); await f.pill.dispatch('click');
  assert.equal(f.installed, 1);
  assert.equal(f.ctrl.status, 'installing');
  assert.equal(f.pill.disabled, true);
  assert.equal(f.pill.getAttribute('aria-label'), '正在重启安装 0.6.0…');
  assert.equal(f.pill.textContent, '', 'never replaces child SVG and value nodes');
});

test('progress clamps numbers and shows an indeterminate arc for unknown progress', () => {
  const f = fixture();
  for (const [percent, value] of [[-8, 0], [120, 100], [45.8, 46]]) {
    f.status({ status: 'downloading', percent });
    assert.equal(f.value.textContent, `${value}%`);
    assert.equal(f.arc.getAttribute('stroke-dashoffset'), String(100 - value));
  }
  for (const percent of [NaN, Infinity, undefined, '44']) {
    f.status({ status: 'downloading', percent });
    assert.equal(f.pill.dataset.indeterminate, 'true');
    assert.equal(f.value.hidden, true);
    assert.equal(f.progress.getAttribute('aria-valuenow'), undefined);
  }
});

test('manual checks lock duplicate clicks and retain newer IPC results', async () => {
  let resolve, count = 0;
  const f = fixture({ checkForUpdates: () => { count++; return new Promise(done => { resolve = done; }); } });
  const pending = f.pill.dispatch('click');
  await f.pill.dispatch('click'); assert.equal(count, 1);
  assert.equal(f.ctrl.status, 'checking');
  f.status({ status: 'downloaded', version: '0.6.0' });
  resolve({ started: false, reason: 'throttled' }); await pending;
  assert.equal(f.ctrl.status, 'downloaded');
  assert.equal(f.caption.textContent, '重启');
});

test('failed checks support retry, reset tooltips, and recover from rejected IPC', async () => {
  let fail = true;
  const f = fixture({ checkForUpdates: async () => { if (fail) throw new Error('网络不可达'); return { started: true }; } });
  await f.pill.dispatch('click');
  assert.equal(f.ctrl.status, 'error'); assert.match(f.pill.title, /网络不可达/);
  assert.equal(f.pill.classList.has('error'), true);
  fail = false; await f.pill.dispatch('click');
  assert.equal(f.ctrl.status, 'checking'); assert.equal(f.pill.classList.has('error'), false);
  f.status({ status: 'current', version: '0.6.0' });
  assert.equal(f.pill.title, '已是最新版本 0.6.0');
  assert.equal(f.caption.textContent, '最新');
});

test('progress announcements update at 10% intervals without suppressing visible progress', () => {
  const f = fixture();
  f.status({ status: 'downloading', percent: 41 }); const first = f.live.textContent;
  f.status({ status: 'downloading', percent: 42 });
  assert.equal(f.live.textContent, first); assert.equal(f.value.textContent, '42%');
  f.status({ status: 'downloading', percent: 50 }); assert.match(f.live.textContent, /50%/);
});
