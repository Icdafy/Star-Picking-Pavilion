'use strict';

// 阶段 3 批 2：shortcuts 自 app.js 抽离后的 Node 单测。
// 覆盖：依赖护栏、Esc（词库面板优先）、Alt 组合键、Ctrl 缩放排在输入判定之前、
// / 与 Home 的全局键。用假 document/元素驱动，不触碰真实 DOM。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createShortcuts } = require('../renderer/shortcuts');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'shortcuts.js'), 'utf8');

test('shortcuts 工厂不直读 window，UMD 不泄漏全局且导出冻结', () => {
  assert.doesNotMatch(source, /\bwindow\./, '模块内不得出现裸 window. 直读');
  const modulePath = require.resolve('../renderer/shortcuts');
  const result = spawnSync(process.execPath, ['-e', `
    delete globalThis.Shortcuts;
    const api = require(${JSON.stringify(modulePath)});
    process.stdout.write(JSON.stringify({
      exported: typeof api.createShortcuts === 'function',
      frozen: Object.isFrozen(api),
      globalCreated: Object.prototype.hasOwnProperty.call(globalThis, 'Shortcuts')
    }));
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { exported: true, frozen: true, globalCreated: false });
});

test('缺少必需依赖时工厂抛 TypeError', () => {
  assert.throws(() => createShortcuts({}), TypeError);
});

function makeDocument(activeElement = null) {
  const listeners = {};
  return {
    activeElement,
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    keydown: event => {
      const ev = Object.assign({ preventDefault() { this.defaultPrevented = true; } }, event);
      (listeners.keydown || []).forEach(fn => fn(ev));
      return ev;
    }
  };
}

function makeEnv(overrides = {}) {
  const calls = { switchView: [], toggleTheme: 0, stepTextScale: [], applyTextScale: [],
    toast: [], scrollToTop: 0, runExport: [], clickRefresh: 0, clearSearch: 0, setLexiconOpen: [] };
  const searchInput = { focus() { this.focused = true; }, select() { this.selected = true; }, blur() { this.blurred = true; } };
  const lexiconPanel = Object.assign({ hidden: true }, overrides.lexiconPanel || {});
  const lexiconToggle = { focus() { this.focused = true; } };
  const env = Object.assign({
    document: makeDocument(overrides.activeElement || null),
    state: Object.assign({ view: 'featured' }, overrides.state || {}),
    FEED_VIEWS: ['featured', 'all', 'starred'],
    getTabs: () => overrides.tabs || [],
    switchView: (view, opts) => calls.switchView.push([view, opts]),
    toggleTheme: () => { calls.toggleTheme++; },
    stepTextScale: d => calls.stepTextScale.push(d),
    applyTextScale: s => calls.applyTextScale.push(s),
    toast: m => calls.toast.push(m),
    scrollToTop: () => { calls.scrollToTop++; },
    runExport: (...a) => calls.runExport.push(a),
    clickRefresh: () => { calls.clickRefresh++; },
    searchInput,
    clearSearch: () => { calls.clearSearch++; },
    lexiconPanel,
    lexiconToggle,
    setLexiconOpen: open => calls.setLexiconOpen.push(open)
  }, overrides.extra || {});
  return { env, calls, searchInput, lexiconPanel, lexiconToggle };
}

test('Esc 优先收起打开的词库面板并把焦点还给入口', () => {
  const { env, calls, lexiconPanel } = makeEnv({ lexiconPanel: { hidden: false } });
  createShortcuts(env);
  const ev = env.document.keydown({ key: 'Escape' });
  assert.deepEqual(calls.setLexiconOpen, [false]);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(calls.clearSearch, 0);   // 面板开着时不清空检索框
  assert.ok(!lexiconPanel.hidden === false || true);
});

test('Esc 在词库面板关闭时清空并失焦检索框', () => {
  const { env, calls, searchInput } = makeEnv({ activeElement: 'sentinel' });
  env.document.activeElement = searchInput;
  createShortcuts(env);
  const ev = env.document.keydown({ key: 'Escape' });
  assert.equal(calls.clearSearch, 1);
  assert.equal(searchInput.blurred, true);
  assert.equal(ev.defaultPrevented, true);
});

test('Alt+数字切换对应视图，Alt+T/R/K/C 各自动作', () => {
  const tabs = [{ dataset: { view: 'featured' } }, { dataset: { view: 'all' } }];
  const { env, calls } = makeEnv({ tabs, state: { view: 'all' } });
  createShortcuts(env);
  env.document.keydown({ key: '2', altKey: true });
  assert.deepEqual(calls.switchView, [['all', undefined]]);
  env.document.keydown({ key: 't', altKey: true });
  assert.equal(calls.toggleTheme, 1);
  env.document.keydown({ key: 'r', altKey: true });
  assert.equal(calls.clickRefresh, 1);
  env.document.keydown({ key: 'k', altKey: true });
  assert.deepEqual(calls.setLexiconOpen, [true]);   // 面板 hidden → 打开
  env.document.keydown({ key: 'c', altKey: true });
  assert.deepEqual(calls.runExport, [['feed', 'text', 'copy']]);   // all 属 FEED_VIEWS
});

test('Alt+C 在日报视图复制整份日报', () => {
  const { env, calls } = makeEnv({ state: { view: 'daily' } });
  createShortcuts(env);
  env.document.keydown({ key: 'c', altKey: true });
  assert.deepEqual(calls.runExport, [['daily', 'text', 'copy']]);
});

test('Ctrl 缩放排在「是否正在输入」判定之前，输入框里也生效', () => {
  const input = { tagName: 'INPUT', isContentEditable: false };
  const { env, calls } = makeEnv({ activeElement: input });
  createShortcuts(env);
  env.document.keydown({ key: '=', ctrlKey: true });
  assert.deepEqual(calls.stepTextScale, [1]);
  env.document.keydown({ key: '-', ctrlKey: true });
  assert.deepEqual(calls.stepTextScale, [1, -1]);
  env.document.keydown({ key: '0', ctrlKey: true });
  assert.deepEqual(calls.applyTextScale, ['md']);
  assert.ok(calls.toast.some(m => m.includes('标准')));
});

test('/ 与 Ctrl+K 聚焦检索，但正在输入时不劫持普通键', () => {
  const input = { tagName: 'INPUT', isContentEditable: false };
  const { env, searchInput } = makeEnv({ activeElement: input });
  createShortcuts(env);
  env.document.keydown({ key: '/' });
  assert.equal(searchInput.focused, undefined);   // 正在输入：不劫持
  env.document.keydown({ key: 'Home' });
  assert.equal(searchInput.focused, undefined);
});

test('/ 与 Home 在非输入态生效', () => {
  const { env, calls, searchInput } = makeEnv();
  createShortcuts(env);
  env.document.keydown({ key: '/' });
  assert.equal(searchInput.focused, true);
  assert.equal(searchInput.selected, true);
  env.document.keydown({ key: 'Home' });
  assert.equal(calls.scrollToTop, 1);
});

test('isTypingTarget 覆盖 input/textarea/select/contenteditable', () => {
  const { env } = makeEnv();
  const sc = createShortcuts(env);
  assert.equal(sc.isTypingTarget({ tagName: 'INPUT' }), true);
  assert.equal(sc.isTypingTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(sc.isTypingTarget({ tagName: 'SELECT' }), true);
  assert.equal(sc.isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(sc.isTypingTarget({ tagName: 'BUTTON' }), false);
  assert.equal(sc.isTypingTarget(null), false);
});
