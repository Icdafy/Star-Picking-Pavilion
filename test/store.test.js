'use strict';

// 阶段 3 批 3：store 自 app.js 抽离后的 Node 单测。
// 覆盖：UMD/lint 护栏、同引用持有 state、补丁合并、选择器级订阅通知、
// 取消订阅与异常隔离。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createStore } = require('../renderer/store');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'store.js'), 'utf8');

test('store 工厂不直读 window，UMD 不泄漏全局且导出冻结', () => {
  assert.doesNotMatch(source, /\bwindow\./, '模块内不得出现裸 window. 直读');
  const modulePath = require.resolve('../renderer/store');
  const result = spawnSync(process.execPath, ['-e', `
    delete globalThis.Store;
    const api = require(${JSON.stringify(modulePath)});
    process.stdout.write(JSON.stringify({
      exported: typeof api.createStore === 'function',
      frozen: Object.isFrozen(api),
      globalCreated: Object.prototype.hasOwnProperty.call(globalThis, 'Store')
    }));
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { exported: true, frozen: true, globalCreated: false });
});

test('createStore 持有同一个 state 对象，组合根与控制器共享引用', () => {
  const initial = { theme: 'dark', view: 'featured' };
  const store = createStore(initial);
  assert.equal(store.getState(), initial, 'getState 必须返回注入的同一对象');
  assert.ok(Object.isFrozen(store));
  assert.throws(() => createStore(null), TypeError);
  assert.throws(() => createStore('state'), TypeError);
});

test('setState 合并补丁并返回 state；非法补丁静默忽略', () => {
  const store = createStore({ a: 1, b: 2 });
  const next = store.setState({ b: 3 });
  assert.equal(next, store.getState());
  assert.deepEqual({ a: next.a, b: next.b }, { a: 1, b: 3 });
  assert.equal(store.setState(null), store.getState());
  assert.equal(store.setState('x'), store.getState());
});

test('订阅只在选择器值（Object.is）变化时触发，取消后不再通知', () => {
  const store = createStore({ view: 'featured', q: '' });
  const seen = [];
  const unsubscribe = store.subscribe(s => s.view, value => seen.push(value));
  store.setState({ q: '航天' });          // view 未变，不得通知
  store.setState({ view: 'hot' });
  store.setState({ view: 'hot' });        // 同值不得重复通知
  assert.deepEqual(seen, ['hot']);
  unsubscribe();
  store.setState({ view: 'all' });
  assert.deepEqual(seen, ['hot']);
  unsubscribe();                          // 重复取消无副作用
});

test('一个订阅者的选择器在通知时抛错不连累其他订阅者', () => {
  const store = createStore({ n: 0 });
  const seen = [];
  let selectorCalls = 0;
  store.subscribe(() => {
    selectorCalls += 1;
    if (selectorCalls > 1) throw new Error('boom');   // 首次订阅时正常，通知时抛错
    return store.getState().n;
  }, () => seen.push('bad'));
  store.subscribe(s => s.n, value => seen.push(value));
  store.setState({ n: 1 });
  assert.deepEqual(seen, [1]);
  assert.throws(() => store.subscribe('x', () => {}), TypeError);
  assert.throws(() => store.subscribe(s => s, null), TypeError);
});

test('一个订阅者的回调抛错不阻断其余订阅者，与选择器隔离对称', () => {
  const store = createStore({ n: 0 });
  const seen = [];
  store.subscribe(s => s.n, () => { throw new Error('callback boom'); });
  store.subscribe(s => s.n, value => seen.push(value));
  store.setState({ n: 1 });
  assert.deepEqual(seen, [1], '回调抛错不得阻断后续订阅者');
});

test('回调内再 setState 不丢通知（同步串行）', () => {
  const store = createStore({ step: 0 });
  const seen = [];
  store.subscribe(s => s.step, value => {
    seen.push(value);
    if (value === 1) store.setState({ step: 2 });
  });
  store.setState({ step: 1 });
  assert.deepEqual(seen, [1, 2]);
});
