'use strict';

/* 摘星阁 · 轻量状态存储
   阶段 3 批 3 新增：发布-订阅 store。组合根用它持有 UI 状态，
   getState 返回当前状态引用，setState 合并补丁并通知选择器值变化的订阅者。
   工厂不依赖任何全局对象，初始状态经参数注入。 */

(function exposeStore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.Store = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStoreModule() {
  function createStore(initialState = {}) {
    if (initialState === null || typeof initialState !== 'object') {
      throw new TypeError('store requires an initial state object');
    }
    const state = initialState;
    const subscribers = new Set();

    function getState() {
      return state;
    }

    // 通知订阅者放在合并之后、同步执行：回调里再 setState 也不会丢通知
    function notify() {
      for (const entry of [...subscribers]) {
        let next;
        try {
          next = entry.selector(state);
        } catch {
          continue;   // 选择器抛错不该连累其他订阅者
        }
        if (!Object.is(next, entry.last)) {
          entry.last = next;
          try {
            entry.callback(next);
          } catch {
            // 回调抛错同样不该连累其他订阅者，与选择器异常隔离对称
          }
        }
      }
    }

    function setState(patch) {
      if (patch === null || typeof patch !== 'object') return state;
      // Object.assign 会把 __proto__ 这类自有键解释成原型 setter；虽然当前所有
      // 补丁都是内部白名单字面量，仍按纵深防御拒绝危险键，杜绝未来误接外部数据。
      if (Object.keys(patch).some(key =>
        key === '__proto__' || key === 'constructor' || key === 'prototype')) {
        return state;
      }
      Object.assign(state, patch);
      notify();
      return state;
    }

    // 订阅某个派生值：仅当选择器结果（Object.is）变化时回调。
    // 返回取消函数；重复取消无副作用。
    function subscribe(selector, callback) {
      if (typeof selector !== 'function' || typeof callback !== 'function') {
        throw new TypeError('store.subscribe requires a selector and a callback');
      }
      const entry = { selector, callback, last: selector(state) };
      subscribers.add(entry);
      return () => subscribers.delete(entry);
    }

    return Object.freeze({ getState, setState, subscribe });
  }

  return Object.freeze({ createStore });
});
