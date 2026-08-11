'use strict';

/* 摘星阁 · 实时更新（信号化轮询）
   阶段 3 批 2 自 app.js 抽离：实时开关、新情报横幅与「先比对 stats 信号、
   变化才探测 feed」的自调度轮询。document 与滚动位置经依赖注入。
   阶段 4：顶部直刷新改走 diff.prependFresh——仅前置插入新条目并打
   .card-new 高亮，替代整表重载；不适用场景退回 loadFeed。
   主循环 setTimeout 自调度不动——窗口隐藏时 rAF 会被暂停，
   关键调度必须维持 setTimeout。 */

(function exposeRealtimePoller(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.RealtimePoller = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRealtimePollerModule() {
  function createRealtimePoller({
    api, state, FEED_VIEWS, toast, preferenceActions,
    refreshStats, loadFeed, scrollToTop,
    document, getScrollY, elements,
    // 阶段 4（可选）：keyed diff 渲染器，注入后顶部新条目走前置插入
    diff
  } = {}) {
    if (typeof api !== 'function' || !state || !Array.isArray(FEED_VIEWS)
      || typeof toast !== 'function' || !preferenceActions
      || typeof refreshStats !== 'function' || typeof loadFeed !== 'function'
      || typeof scrollToTop !== 'function'
      || !document || typeof getScrollY !== 'function'
      || !elements?.btnRealtime || !elements?.newFlash) {
      throw new TypeError('realtime poller requires api, state, FEED_VIEWS, toast, preferenceActions, refreshStats, loadFeed, scrollToTop, document, getScrollY and elements dependencies');
    }

    function setRealtime(on, { persist = true } = {}) {
      state.realtime = on;
      const btn = elements.btnRealtime;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
      if (persist) preferenceActions.remember('realtime', on);
    }
    elements.btnRealtime.addEventListener('click', () => {
      setRealtime(!state.realtime);
      toast(state.realtime ? '已开启实时更新' : '已暂停实时更新');
      if (state.realtime) pollRealtime();
    });

    function showNewFlash(n) {
      const f = elements.newFlash;
      f.textContent = `🛰 ${n} 条新情报 · 点击查看`;
      f.hidden = false;
    }
    elements.newFlash.addEventListener('click', () => {
      elements.newFlash.hidden = true;
      scrollToTop();
      loadFeed();           // freshIds 已在轮询中设置，渲染后会高亮
    });

    let pollTimer;
    // 轮询信号快照：先拉 /api/stats，仅当计数信号相对上轮变化时才探测 feed
    let lastPollSignals = null;
    function pollSignalsOf(s) {
      return [s.today, s.pending, s.featuredToday, s.articles, s.starred].join('|');
    }
    async function pollRealtime() {
      clearTimeout(pollTimer);
      const schedule = () => { pollTimer = setTimeout(pollRealtime, 18000); };
      if (document.hidden) return schedule();          // 后台标签页暂停
      const stats = await refreshStats();
      // 无变化轮次直接跳过 feed 探测；stats 拉取失败时宁可多探一次不漏更新
      const signals = stats ? pollSignalsOf(stats) : null;
      if (signals !== null && signals === lastPollSignals) return schedule();
      lastPollSignals = signals;
      // 仅信息流视图、非检索、非加载中才做增量探测
      if (!FEED_VIEWS.includes(state.view) || state.q || state.loading) return schedule();
      try {
        const params = new URLSearchParams({ view: state.view, page: 0 });
        if (state.domain) params.set('domain', state.domain);
        if (state.category) params.set('category', state.category);
        const data = await api('/api/feed?' + params);
        const newItems = data.items.filter(i => !state.knownIds.has(i.id));
        if (newItems.length) {
          const atTop = getScrollY() < 220;
          const reading = document.querySelector('.card.expanded, .cluster-items:not([hidden])');
          state.freshIds = new Set(newItems.map(i => i.id));
          if (state.realtime && atTop && !reading) {
            elements.newFlash.hidden = true;
            // 阶段 4：时间轴视图（发布时间基准）优先前置插入，不整表重载；
            // 星标或不适用前置的状态由 prependFresh 返回 0 退回 loadFeed
            const canPrepend = diff && typeof diff.prependFresh === 'function'
              && (state.view === 'featured' || state.view === 'all');
            const applied = canPrepend ? diff.prependFresh(newItems) : 0;
            if (applied) {
              newItems.forEach(i => state.knownIds.add(i.id));
              state.listed = (state.listed || 0) + applied;
              state.freshIds = new Set();               // 已就地高亮，无需留给下轮渲染
            } else {
              await loadFeed();                          // 在顶部且未展开阅读 → 直接刷新并高亮新条目
            }
          } else {
            showNewFlash(newItems.length);               // 正在阅读 → 不打断，给可点横幅
          }
        }
      } catch {
        // 后端波动，忽略本轮；但信号必须回滚——否则本轮信号已被消费，
        // 探测错过的更新要等下次计数变化才重试
        lastPollSignals = null;
      }
      schedule();
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pollRealtime(); });

    function start() {
      pollTimer = setTimeout(pollRealtime, 18000);   // 自调度实时增量循环
    }

    return Object.freeze({ setRealtime, showNewFlash, pollRealtime, start });
  }

  return Object.freeze({ createRealtimePoller });
});
