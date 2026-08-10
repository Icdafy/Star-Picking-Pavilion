'use strict';

// 阶段 3 批 2：feed-controller 自 app.js 抽离后的 Node 单测。
// 覆盖：依赖护栏、分页追加互斥守卫、竞态守卫过期跳过、空态文案三分支、
// 哨兵预取与「加载更多」统一入口、freshIds 高亮。
// 阶段 4：渲染改走 keyed diff（diff 为必需依赖），补 diff 路径与焦点归还测试。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createFeedController } = require('../renderer/feed-controller');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'feed-controller.js'), 'utf8');

test('feed-controller 工厂不直读 window，UMD 不泄漏全局且导出冻结', () => {
  assert.doesNotMatch(source, /\bwindow\./, '模块内不得出现裸 window. 直读');
  const modulePath = require.resolve('../renderer/feed-controller');
  const result = spawnSync(process.execPath, ['-e', `
    delete globalThis.FeedController;
    const api = require(${JSON.stringify(modulePath)});
    process.stdout.write(JSON.stringify({
      exported: typeof api.createFeedController === 'function',
      frozen: Object.isFrozen(api),
      globalCreated: Object.prototype.hasOwnProperty.call(globalThis, 'FeedController')
    }));
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { exported: true, frozen: true, globalCreated: false });
});

test('缺少必需依赖时工厂抛 TypeError', () => {
  assert.throws(() => createFeedController({}), TypeError);
});

function makeGuard() {
  let current = 0;
  return {
    begin: () => { const id = ++current; return { isCurrent: () => id === current }; },
    invalidate: () => { current++; }
  };
}

function makeList() {
  return {
    innerHTML: '', inserted: [],
    insertAdjacentHTML(pos, html) { this.inserted.push(html); },
    // 默认视列表已有卡片；双保险守卫查询 .card[data-id] 时给出存在态，
    // 具体用例需要「列表无卡片」时可覆写为恒 null
    querySelector: sel => (sel.includes('.card[data-id]') ? { classList: { add() {} } } : null)
  };
}

// 阶段 4 假 diff：reconcile 整表写 innerHTML、appendPage 走 insertAdjacentHTML，
// 并把调用记到 calls 上，用于断言「整表重载路径在增量场景不被调用」
function makeDiff(list, calls) {
  const rows = (items, mode) => items.map(i => mode === 'ranked'
    ? `<div class="card ranked" data-id="${i.id}"></div>`
    : `<div class="card" data-id="${i.id}"></div>`).join('');
  return {
    reconcile(items, { mode = 'timeline' } = {}) {
      calls.reconcile += 1;
      list.innerHTML = rows(items, mode);
      return { reused: 0, created: items.length, removed: 0 };
    },
    appendPage(items, { mode = 'timeline' } = {}) {
      calls.appendPage += 1;
      list.insertAdjacentHTML('beforeend', rows(items, mode));
      return { created: items.length };
    }
  };
}

function makeElements() {
  return {
    list: makeList(),
    btnMore: { hidden: true, disabled: false, textContent: '', classes: new Set(),
      classList: { add(n) { this.__s?.add(n); }, remove() {} },
      addEventListener(t, fn) { this.onClick = fn; } },
    feedEnd: { hidden: true },
    newFlash: { hidden: true },
    btnCopyFeed: { disabled: false },
    btnExportFeed: { disabled: false },
    feedToolbarNote: { textContent: '' },
    feedSentinel: {}
  };
}

function createController({ items = [], hasMore = false, view = 'featured', q = '',
  guard = makeGuard(), withObserver = false } = {}) {
  const elements = makeElements();
  const requests = [];
  const calls = { renderSearchContext: 0, reconcile: 0, appendPage: 0 };
  const state = { view, q, domain: '', category: '', page: 0, listed: 0,
    loading: false, knownIds: new Set(), freshIds: new Set() };
  let observerCtor = null;
  const observers = [];
  const deps = {
    api: async url => {
      requests.push(url);
      if (items === 'fail') throw new Error('feed down');
      return { items, hasMore };
    },
    state,
    esc: s => String(s),
    DomUtils: { findFocusKey: () => null, restoreFocusByKey: () => {} },
    format: { delay: () => Promise.resolve(), SKELETON_MIN_MS: 0 },
    card: {
      skeletons: () => '<div class="sk"></div>',
      publishedTime: () => 0,
      starredTime: () => 0
    },
    diff: makeDiff(elements.list, calls),
    feedRequestGuard: guard,
    renderSearchContext: () => { calls.renderSearchContext++; },
    elements
  };
  if (withObserver) {
    observerCtor = function (cb) {
      this.callback = cb;
      this.observed = [];
      this.observe = el => this.observed.push(el);
      observers.push(this);
    };
    deps.IntersectionObserver = observerCtor;
  }
  const ctrl = createFeedController(deps);
  return { ctrl, state, elements, requests, calls, guard, observers };
}

test('reset 加载渲染时间轴并记录 knownIds', async () => {
  const { ctrl, state, elements } = createController({ items: [{ id: 'a' }, { id: 'b' }] });
  await ctrl.loadFeed();
  assert.match(elements.list.innerHTML, /data-id="a"/);
  assert.deepEqual([...state.knownIds], ['a', 'b']);
  assert.equal(state.listed, 2);
  assert.equal(state.loading, false);
});

test('hot 视图走 renderRanked 排行模板', async () => {
  const { ctrl, elements } = createController({ items: [{ id: 'x' }], view: 'hot' });
  await ctrl.loadFeed();
  assert.match(elements.list.innerHTML, /ranked/);
});

test('阶段 4：reset 走 diff.reconcile，分页走 diff.appendPage，整表重载路径不重复触发', async () => {
  const { ctrl, calls, elements } = createController({ items: [{ id: 'a' }], hasMore: true });
  await ctrl.loadFeed();
  assert.equal(calls.reconcile, 1);          // 重置 = 一次 keyed diff 调和
  assert.equal(calls.appendPage, 0);
  elements.btnMore.hidden = false;
  await ctrl.loadNextFeedPage();
  assert.equal(calls.reconcile, 1);          // 分页追加不再整表调和
  assert.equal(calls.appendPage, 1);
  assert.equal(elements.list.inserted.length, 1);   // 追加经 insertAdjacentHTML 落位
});

test('阶段 4：星标视图按 starredTime 基准传入 diff，重置时焦点成对归还', async () => {
  const elements = makeElements();
  const focusCalls = { find: 0, restore: 0 };
  const state = { view: 'starred', q: '', domain: '', category: '', page: 0, listed: 0,
    loading: false, knownIds: new Set(), freshIds: new Set() };
  let timeOfSeen = null;
  const diff = {
    reconcile(items, opts) { timeOfSeen = opts.timeOf; return { reused: 0, created: items.length, removed: 0 }; },
    appendPage() { return { created: 0 }; }
  };
  const ctrl = createFeedController({
    api: async () => ({ items: [{ id: 'a' }], hasMore: false }),
    state, esc: s => String(s),
    DomUtils: {
      findFocusKey: () => { focusCalls.find += 1; return 'star:a'; },
      restoreFocusByKey: () => { focusCalls.restore += 1; }
    },
    format: { delay: () => Promise.resolve(), SKELETON_MIN_MS: 0 },
    card: { skeletons: () => '', publishedTime: item => item.publishedAt, starredTime: item => item.starredAt },
    diff,
    feedRequestGuard: makeGuard(),
    renderSearchContext: () => {},
    elements
  });
  await ctrl.loadFeed();
  // 星标视图的时间基准必须是 starredTime（传入项带 starredAt 时应取它）
  assert.equal(timeOfSeen({ publishedAt: 1, starredAt: 2 }), 2);
  assert.equal(focusCalls.find, 1);
  assert.equal(focusCalls.restore, 1);      // 渲染前后焦点回到同一控件
});

test('分页追加在加载中被守卫拦下，不会并发交错', async () => {
  const { ctrl, state, requests } = createController({ items: [] });
  state.loading = true;
  await ctrl.loadFeed(false);   // 非 reset 且 loading → 直接返回，不发请求
  assert.equal(state.page, 0);
  assert.equal(requests.length, 0, '守卫拦下后不得发出任何请求');
});

test('竞态守卫过期时不写 DOM，且仅在最新请求时复位 loading', async () => {
  const guard = makeGuard();
  const { ctrl, state, elements, guard: g } = createController({ items: [{ id: 'z' }], guard });
  const pending = ctrl.loadFeed();
  guard.invalidate();
  await pending;
  assert.ok(!/data-id="z"/.test(elements.list.innerHTML));
  assert.equal(state.loading, true);   // 非最新请求：不复位，留给最新一轮
});

test('空态按检索/星标/普通给出不同文案', async () => {
  const q = createController({ items: [], q: '火箭', view: 'all' });
  q.state.q = '火箭';
  await q.ctrl.loadFeed();
  assert.match(q.elements.list.innerHTML, /没有检索到相关情报/);

  const starred = createController({ items: [], view: 'starred' });
  await starred.ctrl.loadFeed();
  assert.match(starred.elements.list.innerHTML, /还没有星标情报/);
  assert.match(starred.elements.list.innerHTML, /尚 未 摘 星/);

  const plain = createController({ items: [] });
  await plain.ctrl.loadFeed();
  assert.match(plain.elements.list.innerHTML, /风 平 浪 静/);
});

test('请求失败且仍是最新请求时给出可重试的错误态，并隐藏翻页入口', async () => {
  const { ctrl, elements } = createController({ items: 'fail' });
  await ctrl.loadFeed();
  assert.match(elements.list.innerHTML, /信 号 中 断/);
  assert.match(elements.list.innerHTML, /data-act="retry-feed"/);
  // 失败后列表骤短，哨兵会立刻进入视口：翻页入口必须同步隐藏，
  // 否则 Observer 触发翻页，页码前跳、第 0 页被跳过
  assert.equal(elements.btnMore.hidden, true);
  assert.equal(elements.feedEnd.hidden, true);
});

test('加载失败后哨兵触发不再发起翻页请求', async () => {
  const { ctrl, state, elements, requests, observers } =
    createController({ items: 'fail', hasMore: true, withObserver: true });
  await ctrl.loadFeed();
  assert.equal(requests.length, 1);
  assert.equal(elements.btnMore.hidden, true);
  observers[0].callback([{ isIntersecting: true }]);   // 列表骤短，哨兵必然入视口
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(requests.length, 1, '哨兵不得在失败态后发起翻页');
  assert.equal(state.page, 0, '页码不得前跳，第 0 页不得被跳过');
});

test('列表中没有卡片时翻页入口静默（双保险）', async () => {
  const { ctrl, state, elements, requests } = createController({ items: [{ id: 'a' }], hasMore: true });
  await ctrl.loadFeed();
  assert.equal(elements.btnMore.hidden, false);
  elements.list.querySelector = () => null;   // 模拟错误态/空态列表
  await ctrl.loadNextFeedPage();
  assert.equal(state.page, 0);
  assert.equal(requests.length, 1, '无卡片列表不得翻页');
});

test('加载更多统一入口在隐藏或加载中静默，翻页递增 page', async () => {
  const { ctrl, state, elements } = createController({ items: [{ id: 'n' }], hasMore: true });
  elements.btnMore.hidden = false;
  await ctrl.loadNextFeedPage();
  assert.equal(state.page, 1);   // 先自增再走 loadFeed(false)
  assert.equal(elements.btnMore.disabled, false);   // finally 复原
  assert.equal(elements.btnMore.textContent, '加载更多');
});

test('freshIds 在渲染后打上 card-new 高亮', async () => {
  const { ctrl, state, elements } = createController({ items: [{ id: 'a' }] });
  let hit = null;
  elements.list.querySelector = sel => { hit = sel; return { classList: { add(n) { this.added = n; } } }; };
  state.freshIds = new Set(['a']);
  await ctrl.loadFeed();
  assert.match(hit, /data-id="a"/);
  assert.equal(state.freshIds.size, 0);
});

test('注入 IntersectionObserver 时哨兵被观察，进入视口自动预取下一页', async () => {
  const { ctrl, state, elements, requests, observers } =
    createController({ items: [{ id: 'a' }], hasMore: true, withObserver: true });
  // observer 实例必须真的 observed 了哨兵元素
  assert.equal(observers.length, 1);
  assert.deepEqual(observers[0].observed, [elements.feedSentinel]);
  await ctrl.loadFeed();
  assert.equal(requests.length, 1);
  assert.equal(elements.btnMore.hidden, false);
  // 模拟哨兵进入视口：应触发一次翻页请求
  observers[0].callback([{ isIntersecting: true }]);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(requests.length, 2);
  assert.equal(state.page, 1);
});

test('工具条使能随内容有无切换', async () => {
  const { ctrl, elements } = createController({ items: [{ id: 'a' }] });
  await ctrl.loadFeed();
  assert.equal(elements.btnCopyFeed.disabled, false);
  const empty = createController({ items: [] });
  await empty.ctrl.loadFeed();
  assert.equal(empty.elements.btnCopyFeed.disabled, true);
  assert.equal(empty.elements.feedToolbarNote.textContent, '');
});

// ---------- 批 4：卡片交互层（toggleStar）行为测试 ----------

function createStarController({ starResult, starError = null, view = 'featured' } = {}) {
  const elements = makeElements();
  elements.list.addEventListener = function (type, fn) { this[`on${type}`] = fn; };
  const calls = [];
  const state = { view, q: '', domain: '', category: '', page: 0, listed: 0,
    loading: false, knownIds: new Set(), freshIds: new Set() };
  const ctrl = createFeedController({
    api: async url => {
      calls.push(url);
      if (url.includes('/star')) {
        if (starError) throw new Error(starError);
        return starResult;
      }
      return { items: [], hasMore: false };
    },
    state,
    esc: value => String(value ?? ''),
    DomUtils: { findFocusKey: () => null, restoreFocusByKey() {} },
    format: { delay: () => Promise.resolve(), SKELETON_MIN_MS: 0 },
    card: { skeletons: () => '', publishedTime: x => x, starredTime: x => x },
    diff: { reconcile: () => ({ reused: 0, created: 0, removed: 0 }), appendPage: () => ({ created: 0 }) },
    feedRequestGuard: makeGuard(),
    renderSearchContext: () => {},
    elements,
    toast: (msg, isError) => calls.push(`toast:${msg}:${Boolean(isError)}`),
    refreshStats: () => calls.push('refreshStats')
  });
  return { ctrl, calls, state, elements };
}

function makeStarButton(pressed = false) {
  const attributes = { 'aria-pressed': String(pressed) };
  const label = { textContent: pressed ? '已星标' : '星标' };
  return {
    disabled: false,
    title: '',
    classes: new Set(),
    classList: { toggle(name, on) { if (on) this.__c?.add(name); else this.__c?.delete(name); }, __c: new Set() },
    getAttribute: name => attributes[name] ?? null,
    setAttribute: (name, value) => { attributes[name] = String(value); },
    querySelector: selector => selector === '.card-act-label' ? label : null,
    attributes, label
  };
}

test('toggleStar 成功路径改写按钮态并给出成功提示', async () => {
  const { ctrl, calls } = createStarController({ starResult: { starred: true } });
  const button = makeStarButton(false);
  await ctrl.toggleStar({ dataset: { id: '3' } }, button);
  assert.equal(button.attributes['aria-pressed'], 'true');
  assert.equal(button.label.textContent, '已星标');
  assert.equal(button.title, '取消星标');
  assert.equal(button.disabled, false);
  assert.ok(calls.includes('/api/articles/3/star'));
  assert.ok(calls.includes('toast:已星标，该情报不会被保留策略清理:false'));
  assert.ok(calls.includes('refreshStats'));
});

test('toggleStar 失败时错误 toast 带出后端消息，按钮解锁', async () => {
  const { ctrl, calls } = createStarController({ starError: 'db locked' });
  const button = makeStarButton(false);
  await ctrl.toggleStar({ dataset: { id: '9' } }, button);
  assert.ok(calls.includes('toast:星标操作失败：db locked:true'));
  assert.equal(button.disabled, false);
});

test('未注入 toast 时不接线卡片交互层，toggleStar 为 null', () => {
  const { ctrl } = createController({ items: [] });
  assert.equal(ctrl.toggleStar, null);
});
