'use strict';

// 阶段 3 批 2：search-controller 自 app.js 抽离后的 Node 单测。
// 覆盖：依赖护栏、防抖检索（含非信息流视图切换）、检索上下文条、清除检索、
// 词库面板载入/失败态、选词即检索固定落到 all 视图、outside-click 收起。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createSearchController } = require('../renderer/search-controller');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'search-controller.js'), 'utf8');

test('search-controller 工厂不直读 window，UMD 不泄漏全局且导出冻结', () => {
  assert.doesNotMatch(source, /\bwindow\./, '模块内不得出现裸 window. 直读');
  const modulePath = require.resolve('../renderer/search-controller');
  const result = spawnSync(process.execPath, ['-e', `
    delete globalThis.SearchController;
    const api = require(${JSON.stringify(modulePath)});
    process.stdout.write(JSON.stringify({
      exported: typeof api.createSearchController === 'function',
      frozen: Object.isFrozen(api),
      globalCreated: Object.prototype.hasOwnProperty.call(globalThis, 'SearchController')
    }));
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { exported: true, frozen: true, globalCreated: false });
});

test('缺少必需依赖时工厂抛 TypeError', () => {
  assert.throws(() => createSearchController({}), TypeError);
});

function makeEnv({ view = 'featured', lexicon = 'fail' } = {}) {
  const calls = { loadFeed: 0, switchView: [] };
  const docListeners = {};
  const inputListeners = {};
  const env = {
    calls,
    api: async url => {
      env.lastUrl = url;
      if (url.startsWith('/api/lexicon')) {
        if (lexicon === 'fail') throw new Error('lexicon down');
        return lexicon;
      }
      return {};
    },
    state: { view, q: '', listed: 0 },
    esc: s => String(s),
    FEED_VIEWS: ['featured', 'hot', 'all', 'starred'],
    loadFeed: () => { calls.loadFeed++; },
    switchView: (v, opts) => calls.switchView.push([v, opts]),
    document: { addEventListener: (t, fn) => { (docListeners[t] ||= []).push(fn); } },
    elements: {
      searchInput: { value: '', addEventListener: (t, fn) => { inputListeners[t] = fn; },
        focus() { this.focused = true; } },
      searchBox: { classes: new Set(),
        classList: { toggle(n, on) { if (on) this.__s?.add(n); else this.__s?.delete(n); } } },
      searchContext: { hidden: true, innerHTML: '',
        addEventListener: () => {} },
      lexiconPanel: { hidden: true, classes: new Set(),
        classList: { toggle() {} },
        contains: el => el?.__insidePanel === true },
      lexiconToggle: { attrs: {}, classes: new Set(),
        classList: { toggle() {} },
        setAttribute(k, v) { this.attrs[k] = v; },
        focus() { this.focused = true; },
        contains: el => el?.__insideToggle === true,
        addEventListener: (t, fn) => { env.toggleClick = fn; } },
      lexiconFilter: { value: '', focus() { this.focused = true; }, addEventListener: () => {} },
      lexiconBody: { innerHTML: '', addEventListener: () => {} },
      lexiconSummary: { textContent: '' }
    },
    input: event => inputListeners.input?.(event),
    docClick: target => (docListeners.click || []).forEach(fn => fn({ target }))
  };
  // searchBox classList 闭包修正
  const boxClasses = new Set();
  env.elements.searchBox.classList = { toggle(n, on) { if (on) boxClasses.add(n); else boxClasses.delete(n); } };
  env.boxClasses = boxClasses;
  return env;
}

test('输入防抖 350ms 后落 state.q 并刷新信息流', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const env = makeEnv({ view: 'all' });
  createSearchController(env);
  env.input({ target: { value: ' 朱雀 ' } });
  assert.equal(env.state.q, '');            // 防抖未到点
  t.mock.timers.tick(350);
  assert.equal(env.state.q, '朱雀');
  assert.equal(env.calls.loadFeed, 1);
});

test('非信息流视图检索时切到 all 而不直接 loadFeed', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const env = makeEnv({ view: 'settings' });
  createSearchController(env);
  env.input({ target: { value: '星舰' } });
  t.mock.timers.tick(350);
  assert.deepEqual(env.calls.switchView, [['all', { persist: false }]]);
  assert.equal(env.calls.loadFeed, 0);
});

test('renderSearchContext 无检索词时隐藏，有词时给计数与清除按钮', () => {
  const env = makeEnv();
  const ctrl = createSearchController(env);
  ctrl.renderSearchContext();
  assert.equal(env.elements.searchContext.hidden, true);
  env.state.q = '低空'; env.state.listed = 12;
  ctrl.renderSearchContext();
  assert.equal(env.elements.searchContext.hidden, false);
  assert.match(env.elements.searchContext.innerHTML, /低空/);
  assert.match(env.elements.searchContext.innerHTML, /12/);
  assert.match(env.elements.searchContext.innerHTML, /data-act="clear-search"/);
});

test('clearSearch 只在原本有词时才重载信息流，并取消未触发的防抖', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const env = makeEnv({ view: 'all' });
  const ctrl = createSearchController(env);
  ctrl.clearSearch();                        // 无词：不重载
  assert.equal(env.calls.loadFeed, 0);
  env.input({ target: { value: 'abc' } });   // 挂起一个防抖
  env.state.q = 'abc';
  ctrl.clearSearch();                        // 有词：重载一次
  assert.equal(env.calls.loadFeed, 1);
  t.mock.timers.tick(350);
  assert.equal(env.calls.loadFeed, 1);       // 被清空的防抖没有再跑
  assert.equal(env.elements.searchInput.value, '');
});

test('词库面板载入失败给出失败提示，成功时渲染词与命中数', async () => {
  const bad = makeEnv();
  const badCtrl = createSearchController(bad);
  await badCtrl.loadLexicon();
  assert.match(bad.elements.lexiconBody.innerHTML, /词库载入失败/);

  const good = makeEnv({
    lexicon: {
      termCount: 2, matchedTermCount: 1,
      groups: [{ domain: 'aerospace', label: '商业航天', terms: [
        { term: '朱雀三号', count: 5, query: '朱雀' },
        { term: '冷门词', count: 0 }
      ] }]
    }
  });
  const goodCtrl = createSearchController(good);
  await goodCtrl.loadLexicon();
  assert.match(good.elements.lexiconBody.innerHTML, /data-lex-term="朱雀三号"/);
  assert.match(good.elements.lexiconBody.innerHTML, /class="lex-count">5/);
  assert.match(good.elements.lexiconBody.innerHTML, /is-empty/);   // 0 命中词沉底标记
  assert.match(good.elements.lexiconSummary.textContent, /2 个核心词/);
});

test('runTermSearch 固定落到 all 视图：同视图直刷，异视图切换', () => {
  const inAll = makeEnv({ view: 'all' });
  createSearchController(inAll).runTermSearch(' 亿航 ');
  assert.equal(inAll.state.q, '亿航');
  assert.equal(inAll.calls.loadFeed, 1);
  assert.equal(inAll.calls.switchView.length, 0);

  const elsewhere = makeEnv({ view: 'featured' });
  createSearchController(elsewhere).runTermSearch('亿航');
  assert.deepEqual(elsewhere.calls.switchView, [['all', { persist: false }]]);
  assert.equal(elsewhere.calls.loadFeed, 0);

  const blank = makeEnv();
  createSearchController(blank).runTermSearch('   ');
  assert.equal(blank.calls.loadFeed, 0);   // 空词不检索
});

test('点击面板之外收起，点面板内不收起', () => {
  const env = makeEnv({
    lexicon: { termCount: 0, matchedTermCount: 0, groups: [] }
  });
  const ctrl = createSearchController(env);
  ctrl.setLexiconOpen(true);
  assert.equal(env.elements.lexiconPanel.hidden, false);
  env.docClick({ __insidePanel: true });
  assert.equal(env.elements.lexiconPanel.hidden, false);   // 面板内点击不收起
  env.docClick({});
  assert.equal(env.elements.lexiconPanel.hidden, true);
});

test('setLexiconOpen 同步 aria-expanded 并在打开时聚焦筛选框', () => {
  const env = makeEnv();
  const ctrl = createSearchController(env);
  ctrl.setLexiconOpen(true);
  assert.equal(env.elements.lexiconToggle.attrs['aria-expanded'], 'true');
  assert.equal(env.elements.lexiconFilter.focused, true);
  ctrl.setLexiconOpen(false);
  assert.equal(env.elements.lexiconToggle.attrs['aria-expanded'], 'false');
});
