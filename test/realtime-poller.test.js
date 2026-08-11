'use strict';

// 阶段 3 批 2：realtime-poller 自 app.js 抽离后的 Node 单测。
// 覆盖：依赖护栏、开关持久化、信号比对跳过、后台标签页暂停、
// 新条目高亮（顶部直刷 vs 阅读中横幅）与错误路径。
// 阶段 4：顶部直刷改走 diff.prependFresh 前置插入，补前置/退回路径测试。
// 热点移除批次：轮询不再刷新热度栏，无变化/非信息流轮次直接重新排程。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRealtimePoller } = require('../renderer/realtime-poller');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'realtime-poller.js'), 'utf8');

// 轮询定时器不应阻塞测试进程退出
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms) => { const t = realSetTimeout(fn, ms); if (t?.unref) t.unref(); return t; };

test('realtime-poller 工厂不直读 window，UMD 不泄漏全局且导出冻结', () => {
  assert.doesNotMatch(source, /\bwindow\./, '模块内不得出现裸 window. 直读');
  const modulePath = require.resolve('../renderer/realtime-poller');
  const result = spawnSync(process.execPath, ['-e', `
    delete globalThis.RealtimePoller;
    const api = require(${JSON.stringify(modulePath)});
    process.stdout.write(JSON.stringify({
      exported: typeof api.createRealtimePoller === 'function',
      frozen: Object.isFrozen(api),
      globalCreated: Object.prototype.hasOwnProperty.call(globalThis, 'RealtimePoller')
    }));
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { exported: true, frozen: true, globalCreated: false });
});

test('缺少必需依赖时工厂抛 TypeError', () => {
  assert.throws(() => createRealtimePoller({}), TypeError);
});

function makeEnv({ statsSequence = [], feedItems = [], hidden = false, scrollY = 0,
  view = 'featured', q = '', loading = false, realtime = true, reading = false, diff = null } = {}) {
  const calls = { toast: [], remember: [], loadFeed: 0, scrollToTop: 0, prependFresh: 0, feedProbe: 0 };
  let statsIdx = 0;
  const listeners = {};
  const flashListeners = {};
  const env = {
    calls,
    api: async url => {
      env.lastFeedUrl = url;
      calls.feedProbe += 1;
      if (feedItems === 'fail') throw new Error('feed down');
      return { items: feedItems };
    },
    state: { view, q, loading, realtime, domain: '', category: '',
      knownIds: new Set(), freshIds: new Set(), listed: 0 },
    FEED_VIEWS: ['featured', 'all', 'starred'],
    toast: (m, e) => calls.toast.push([m, !!e]),
    preferenceActions: { remember: (k, v) => calls.remember.push([k, v]) },
    refreshStats: async () => {
      const next = statsSequence[statsIdx++];
      return next === 'fail' ? null : next;
    },
    loadFeed: async () => { calls.loadFeed++; },
    scrollToTop: () => { calls.scrollToTop++; },
    document: {
      hidden,
      addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
      querySelector: () => (reading ? {} : null)
    },
    getScrollY: () => scrollY,
    elements: {
      btnRealtime: {
        attrs: {},
        classList: { toggle() {} },
        setAttribute(k, v) { this.attrs[k] = v; },
        addEventListener(type, fn) { this.onClick = fn; }
      },
      newFlash: {
        hidden: true, textContent: '',
        addEventListener: (type, fn) => { flashListeners[type] = fn; }
      }
    },
    dispatchFlash: type => flashListeners[type]?.(),
    dispatchVisibility: () => (listeners.visibilitychange || []).forEach(fn => fn())
  };
  if (diff) env.diff = diff;
  // btnRealtime classList 闭包修正
  const btnClasses = new Set();
  env.elements.btnRealtime.classList = { toggle(n, on) { if (on) btnClasses.add(n); else btnClasses.delete(n); } };
  env.btnClasses = btnClasses;
  return env;
}

test('setRealtime 切换开关并按需持久化', () => {
  const env = makeEnv();
  const poller = createRealtimePoller(env);
  poller.setRealtime(false);
  assert.equal(env.state.realtime, false);
  assert.equal(env.elements.btnRealtime.attrs['aria-pressed'], 'false');
  assert.deepEqual(env.calls.remember, [['realtime', false]]);
  poller.setRealtime(true, { persist: false });
  assert.equal(env.calls.remember.length, 1);   // persist:false 不落盘
});

test('后台标签页暂停：不拉 stats 也不探测，只重新排程', async () => {
  const env = makeEnv({ hidden: true, statsSequence: [{ today: 1 }] });
  const poller = createRealtimePoller(env);
  await poller.pollRealtime();
  assert.equal(env.calls.loadFeed, 0);
  assert.equal(env.calls.feedProbe, 0);
});

test('stats 信号与上轮相同则整轮跳过，不再探测 feed', async () => {
  const same = { today: 5, pending: 0, featuredToday: 2, articles: 100, starred: 1 };
  const env = makeEnv({ statsSequence: [same, same] });
  const poller = createRealtimePoller(env);
  await poller.pollRealtime();   // 首轮：信号首次记录，探测一次
  assert.equal(env.calls.feedProbe, 1);
  await poller.pollRealtime();   // 次轮：信号未变，直接重新排程
  assert.equal(env.calls.feedProbe, 1);
  assert.equal(env.calls.loadFeed, 0);
});

test('stats 拉取失败时信号记 null，宁可多探一次不漏更新', async () => {
  const env = makeEnv({ statsSequence: ['fail', 'fail'] });
  const poller = createRealtimePoller(env);
  await poller.pollRealtime();
  await poller.pollRealtime();
  assert.equal(env.calls.feedProbe, 2);   // 两轮都探测
});

test('非信息流视图或检索态只重新排程，不探测 feed', async () => {
  const env = makeEnv({ view: 'sources', statsSequence: [{ today: 1 }] });
  const poller = createRealtimePoller(env);
  await poller.pollRealtime();
  assert.equal(env.calls.feedProbe, 0);
  assert.equal(env.lastFeedUrl, undefined);
});

test('顶部且未阅读时新条目直接刷信息流并记 freshIds', async () => {
  const env = makeEnv({
    statsSequence: [{ today: 2 }],
    feedItems: [{ id: 'a' }, { id: 'new-1' }],
    scrollY: 0
  });
  env.state.knownIds = new Set(['a']);
  const poller = createRealtimePoller(env);
  await poller.pollRealtime();
  assert.deepEqual([...env.state.freshIds], ['new-1']);
  assert.equal(env.calls.loadFeed, 1);
  assert.equal(env.elements.newFlash.hidden, true);
});

test('正在阅读时不打断：显示新情报横幅，点击后回顶刷新', async () => {
  const env = makeEnv({
    statsSequence: [{ today: 2 }],
    feedItems: [{ id: 'new-1' }, { id: 'new-2' }],
    reading: true
  });
  const poller = createRealtimePoller(env);
  await poller.pollRealtime();
  assert.equal(env.calls.loadFeed, 0);
  assert.equal(env.elements.newFlash.hidden, false);
  assert.match(env.elements.newFlash.textContent, /2 条新情报/);
  env.dispatchFlash('click');
  assert.equal(env.elements.newFlash.hidden, true);
  assert.equal(env.calls.scrollToTop, 1);
  assert.equal(env.calls.loadFeed, 1);
});

test('feed 探测失败时静默吞掉本轮，不 toast 报错，且回滚信号使下轮重探', async () => {
  const same = { today: 1, pending: 0, featuredToday: 0, articles: 10, starred: 0 };
  const env = makeEnv({ statsSequence: [same, same], feedItems: 'fail' });
  const poller = createRealtimePoller(env);
  await poller.pollRealtime();
  assert.equal(env.calls.toast.length, 0);
  assert.equal(env.calls.feedProbe, 1);
  // 信号未变但上轮探测失败：信号已回滚，必须重探，不漏更新
  await poller.pollRealtime();
  assert.equal(env.calls.feedProbe, 2);
});

// ---------- 阶段 4：顶部新条目优先前置插入，替代整表重载 ----------

function makeDiffFake(applied) {
  const calls = { prependFresh: 0, lastItems: null };
  return {
    calls,
    prependFresh(items) { calls.prependFresh += 1; calls.lastItems = items; return applied; }
  };
}

test('阶段 4：时间轴视图顶部新条目走 prependFresh，不触发整表重载', async () => {
  const diff = makeDiffFake(1);
  const env = makeEnv({
    statsSequence: [{ today: 2 }],
    feedItems: [{ id: 'a' }, { id: 'new-1' }],
    scrollY: 0,
    diff
  });
  env.state.knownIds = new Set(['a']);
  const poller = createRealtimePoller(env);
  await poller.pollRealtime();
  assert.equal(diff.calls.prependFresh, 1);
  assert.deepEqual(diff.calls.lastItems.map(i => i.id), ['new-1']);
  assert.equal(env.calls.loadFeed, 0);            // 不再整表重载
  assert.deepEqual([...env.state.knownIds], ['a', 'new-1']);
  assert.equal(env.state.listed, 1);
  assert.equal(env.state.freshIds.size, 0);       // 已就地高亮
});

test('阶段 4：星标视图不走前置插入，仍整表重载', async () => {
  const diff = makeDiffFake(1);
  const env = makeEnv({
    statsSequence: [{ today: 2 }],
    feedItems: [{ id: 'new-1' }],
    view: 'starred', scrollY: 0,
    diff
  });
  const poller = createRealtimePoller(env);
  await poller.pollRealtime();
  assert.equal(diff.calls.prependFresh, 0);
  assert.equal(env.calls.loadFeed, 1);
});

test('阶段 4：prependFresh 返回 0（空态/骨架等不适用）退回 loadFeed', async () => {
  const diff = makeDiffFake(0);
  const env = makeEnv({
    statsSequence: [{ today: 2 }],
    feedItems: [{ id: 'new-1' }],
    scrollY: 0,
    diff
  });
  const poller = createRealtimePoller(env);
  await poller.pollRealtime();
  assert.equal(diff.calls.prependFresh, 1);
  assert.equal(env.calls.loadFeed, 1);            // 退回整表重载兼底
  assert.deepEqual([...env.state.freshIds], ['new-1']);   // 交给渲染后高亮
});

test('回到前台的 visibilitychange 立即触发一轮轮询', async () => {
  const env = makeEnv({ statsSequence: [{ today: 1 }, { today: 1 }] });
  const poller = createRealtimePoller(env);
  env.dispatchVisibility();
  await new Promise(resolve => realSetTimeout(resolve, 10));
  assert.equal(env.calls.feedProbe, 1);
});
