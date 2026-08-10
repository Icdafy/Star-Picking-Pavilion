'use strict';

// 阶段 3 批 3：view-registry 自 app.js 抽离后的 Node 单测。
// 覆盖：UMD/lint 护栏、查表调度（面板显隐/onEnter/onLeave/persist）、
// 信息流筛选条、未注册视图、tab 接线与方向键约定、指示块与导航高度。
// 液态玻璃阶段 3：入场动画由「animation:none + 强制重排重放」改为注入
// motion 引擎对目标面板播 fadeSlideIn，原对重放手法的断言升级为
// 行为级断言（motion 被调用/只作用于显示面板/未注入时静默退化）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createViewRegistry } = require('../renderer/view-registry');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'view-registry.js'), 'utf8');

test('view-registry 工厂不直读 window，UMD 不泄漏全局且导出冻结', () => {
  assert.doesNotMatch(source, /\bwindow\./, '模块内不得出现裸 window. 直读');
  // 液态玻璃阶段 3：强制重排重放手法（写 animation:none 再读 offsetHeight）
  // 已移除，改经注入的 motion 引擎播入场动画——源码不得再出现旧手法
  assert.doesNotMatch(source, /void sec\.offsetHeight/, '不得保留强制重排重放入场动画');
  const modulePath = require.resolve('../renderer/view-registry');
  const result = spawnSync(process.execPath, ['-e', `
    delete globalThis.ViewRegistry;
    const api = require(${JSON.stringify(modulePath)});
    process.stdout.write(JSON.stringify({
      exported: typeof api.createViewRegistry === 'function',
      frozen: Object.isFrozen(api),
      globalCreated: Object.prototype.hasOwnProperty.call(globalThis, 'ViewRegistry')
    }));
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { exported: true, frozen: true, globalCreated: false });
});

function makeElement(extra = {}) {
  const classes = new Set();
  const attributes = {};
  const listeners = {};
  const properties = {};
  return Object.assign({
    dataset: {},
    hidden: false,
    offsetHeight: 0,
    offsetLeft: 0,
    offsetTop: 0,
    offsetWidth: 0,
    style: { animation: '', display: '', properties, setProperty(name, value) { properties[name] = value; } },
    classList: {
      toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); },
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      has: name => classes.has(name)
    },
    setAttribute: (name, value) => { attributes[name] = String(value); },
    getAttribute: name => (name in attributes ? attributes[name] : null),
    attributes,
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    dispatch: (type, event = {}) => (listeners[type] || []).forEach(fn => fn(event)),
    focus() { this.focused = true; }
  }, extra);
}

// 假 DOM：panels 登记视图面板选择器；tabs/views 为可追加的数组
function makeWorld(panels = {}) {
  const tabs = [];
  const views = [];
  const indicator = makeElement();
  const feedFilters = makeElement();
  const nav = makeElement({ getBoundingClientRect: () => ({ height: 64.4 }) });
  const navTabs = makeElement();
  const documentElement = makeElement();
  const bySelector = new Map(Object.entries(panels));
  bySelector.set('.tab-indicator', indicator);
  bySelector.set('#feedFilters', feedFilters);
  bySelector.set('.nav', nav);
  bySelector.set('.nav-tabs', navTabs);
  const doc = { documentElement, activeElement: null };
  const $ = selector => {
    if (bySelector.has(selector)) return bySelector.get(selector);
    if (selector === '.tab.active') return tabs.find(t => t.classList.has('active')) || null;
    return null;
  };
  const $$ = selector => {
    if (selector === '.tab') return tabs;
    if (selector === '.view') return views;
    return [];
  };
  return { tabs, views, indicator, feedFilters, nav, navTabs, doc, $, $$ };
}

test('依赖注入护栏：缺 $/$$/state 直接拒绝', () => {
  assert.throws(() => createViewRegistry({}), TypeError);
  assert.throws(() => createViewRegistry({ $: () => {}, $$: () => [] }), TypeError);
  assert.throws(() => createViewRegistry({ $: () => {}, $$: () => [], state: null }), TypeError);
  const world = makeWorld();
  const registry = createViewRegistry({ $: world.$, $$: world.$$, document: world.doc, state: { view: 'featured' } });
  assert.throws(() => registry.registerView({}), TypeError);
  assert.throws(() => registry.registerView({ id: '' }), TypeError);
});

test('switchView 查表调度：面板显隐、onEnter/onLeave、persist 与全局副作用', () => {
  const entered = [];
  const left = [];
  const viewFeed = makeElement();
  const viewDaily = makeElement();
  const viewLinks = makeElement();
  const world = makeWorld({ '#viewFeed': viewFeed, '#viewDaily': viewDaily, '#viewLinks': viewLinks });
  world.views.push(viewFeed, viewDaily, viewLinks);
  world.tabs.push(
    makeElement({ dataset: { view: 'featured' } }),
    makeElement({ dataset: { view: 'daily' } })
  );
  const state = { view: 'featured', dailyDate: '2026-08-09' };
  const remembered = [];
  const calls = [];
  // 液态玻璃阶段 3：入场动画改为注入 motion 引擎，用假引擎记录调用
  const motionCalls = [];
  const motion = { fadeSlideIn: (el, opts) => motionCalls.push([el, opts]) };
  const registry = createViewRegistry({
    $: world.$, $$: world.$$, document: world.doc, state,
    FEED_VIEWS: ['featured', 'hot', 'all', 'starred'],
    preferenceActions: { remember: (key, value) => remembered.push([key, value]) },
    scrollToTop: () => calls.push('scrollToTop'),
    refreshStats: () => calls.push('refreshStats'),
    motion
  });
  registry.registerView({ id: 'featured', tab: '#viewFeed', isFeed: true, onEnter: () => entered.push('featured'), onLeave: () => left.push('featured') });
  registry.registerView({ id: 'daily', tab: '#viewDaily', onEnter: () => entered.push('daily'), onLeave: () => left.push('daily') });
  registry.registerView({ id: 'links', tab: '#viewLinks', onEnter: () => entered.push('links') });

  registry.switchView('daily');

  assert.equal(state.view, 'daily');
  assert.deepEqual(remembered, [['view', 'daily']], '默认 persist 必须落盘');
  assert.equal(viewDaily.hidden, false);
  assert.equal(viewFeed.hidden, true);
  assert.equal(viewLinks.hidden, true);
  assert.equal(world.feedFilters.style.display, 'none', '非信息流视图收起筛选条');
  assert.deepEqual(entered, ['daily']);
  assert.deepEqual(left, ['featured']);
  assert.deepEqual(calls, ['refreshStats', 'scrollToTop'], '先刷塔台状态再回顶部');
  // 入场动画升级（液态玻璃阶段 3）：原断言检查 animation 被重置回 ''，
  // 旧手法已删，改为行为级断言——motion 只对切换后显示的目标面板播
  // 一次 fadeSlideIn，其余面板不动
  assert.equal(motionCalls.length, 1);
  assert.equal(motionCalls[0][0], viewDaily);
  assert.equal(motionCalls[0][1].duration, 260);
});

test('未注入 motion 时切换静默退化为无入场动画，显隐语义不变', () => {
  // 液态玻璃阶段 3：motion 是可选依赖，缺失时不得影响查表调度本身
  const viewFeed = makeElement();
  const viewDaily = makeElement();
  const world = makeWorld({ '#viewFeed': viewFeed, '#viewDaily': viewDaily });
  world.views.push(viewFeed, viewDaily);
  const state = { view: 'featured' };
  const registry = createViewRegistry({ $: world.$, $$: world.$$, document: world.doc, state });
  registry.registerView({ id: 'featured', tab: '#viewFeed', isFeed: true });
  registry.registerView({ id: 'daily', tab: '#viewDaily' });

  registry.switchView('daily', { persist: false });

  assert.equal(viewDaily.hidden, false);
  assert.equal(viewFeed.hidden, true);
});

test('信息流视图亮筛选条，persist:false 不落盘', () => {
  const viewFeed = makeElement();
  const world = makeWorld({ '#viewFeed': viewFeed });
  world.views.push(viewFeed);
  const state = { view: 'daily' };
  const remembered = [];
  const registry = createViewRegistry({
    $: world.$, $$: world.$$, document: world.doc, state,
    FEED_VIEWS: ['featured', 'hot', 'all', 'starred'],
    preferenceActions: { remember: (key, value) => remembered.push([key, value]) }
  });
  registry.registerView({ id: 'featured', tab: '#viewFeed', isFeed: true });
  registry.registerView({ id: 'daily', tab: '#viewDaily' });

  registry.switchView('featured', { persist: false });

  assert.equal(world.feedFilters.style.display, '', '信息流视图必须显示筛选条');
  assert.equal(viewFeed.hidden, false);
  assert.deepEqual(remembered, [], 'persist:false 不得触发 remember');
});

test('未注册视图不亮任何面板也不触发 onEnter，但状态与塔台副作用照常', () => {
  const viewFeed = makeElement();
  const world = makeWorld({ '#viewFeed': viewFeed });
  world.views.push(viewFeed);
  const state = { view: 'featured' };
  const calls = [];
  const registry = createViewRegistry({
    $: world.$, $$: world.$$, document: world.doc, state,
    scrollToTop: () => calls.push('scrollToTop'),
    refreshStats: () => calls.push('refreshStats')
  });
  registry.registerView({ id: 'featured', tab: '#viewFeed', isFeed: true });

  registry.switchView('mystery');

  assert.equal(state.view, 'mystery');
  assert.equal(viewFeed.hidden, true);
  assert.deepEqual(calls, ['refreshStats', 'scrollToTop']);
});

test('tab 激活态与 aria-selected 跟随当前视图', () => {
  const world = makeWorld();
  const state = { view: 'featured' };
  const registry = createViewRegistry({ $: world.$, $$: world.$$, document: world.doc, state });
  const tabA = makeElement({ dataset: { view: 'featured' } });
  const tabB = makeElement({ dataset: { view: 'daily' } });
  world.tabs.push(tabA, tabB);
  registry.registerView({ id: 'featured', tab: '#viewFeed' });
  registry.registerView({ id: 'daily', tab: '#viewDaily' });

  registry.switchView('daily', { persist: false });

  assert.equal(tabA.classList.has('active'), false);
  assert.equal(tabB.classList.has('active'), true);
  assert.equal(tabB.getAttribute('aria-selected'), 'true');
  assert.equal(tabA.getAttribute('aria-selected'), 'false');
});

test('syncNavHeight 把导航条高度四舍五入写进 --nav-h；syncTabIndicator 写位移变量', () => {
  const world = makeWorld();
  const registry = createViewRegistry({ $: world.$, $$: world.$$, document: world.doc, state: { view: 'featured' } });
  registry.syncNavHeight();
  assert.equal(world.doc.documentElement.style.properties['--nav-h'], '64px');

  const active = makeElement({ offsetLeft: 12, offsetTop: 4, offsetWidth: 80, offsetHeight: 32 });
  active.classList.add('active');
  world.tabs.push(active);
  registry.syncTabIndicator();
  const vars = world.indicator.style.properties;
  assert.equal(vars['--ti-x'], '12px');
  assert.equal(vars['--ti-w'], '80px');
  assert.equal(vars['--ti-o'], '1');
});

test('wireTabs：点击即切换，方向键循环移动并即选即切', () => {
  const world = makeWorld();
  const state = { view: 'featured' };
  const registry = createViewRegistry({ $: world.$, $$: world.$$, document: world.doc, state });
  const tabA = makeElement({ dataset: { view: 'featured' } });
  const tabB = makeElement({ dataset: { view: 'daily' } });
  world.tabs.push(tabA, tabB);
  registry.registerView({ id: 'featured', tab: '#viewFeed' });
  registry.registerView({ id: 'daily', tab: '#viewDaily' });
  registry.wireTabs(world.navTabs);

  tabB.dispatch('click');
  assert.equal(state.view, 'daily');

  // 焦点在第一个 tab 上按 ArrowLeft 应循环到最后一个并切换
  world.doc.activeElement = tabA;
  let prevented = false;
  world.navTabs.dispatch('keydown', { key: 'ArrowLeft', preventDefault: () => { prevented = true; } });
  assert.equal(state.view, 'daily');
  assert.equal(tabB.focused, true);
  assert.equal(prevented, true);
  // 焦点不在 tab 上时不响应：不切换也不阻止默认行为
  world.doc.activeElement = makeElement();
  const before = state.view;
  prevented = false;
  world.navTabs.dispatch('keydown', { key: 'ArrowRight', preventDefault: () => { prevented = true; } });
  assert.equal(state.view, before);
  assert.equal(prevented, false);
});
