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
    diff, onPipelineComplete
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
      f.textContent = `🛰 ${n} 条情报已更新 · 点击查看`;
      f.hidden = false;
    }
    elements.newFlash.addEventListener('click', () => {
      elements.newFlash.hidden = true;
      scrollToTop();
      loadFeed();           // freshIds 已在轮询中设置，渲染后会高亮
    });

    let pollTimer;
    let activePoll = null;
    let activityPollPending = false;
    let pipelineBusy = false;
    let watchingPipeline = false;
    let watchAfterRequest = 0;
    let activityRevision = -1;
    let pipelineRefreshPending = false;
    let disposed = false;
    let pollRequest = 0;
    let lastPollContext = null;
    // 轮询信号快照：先拉 /api/stats，仅当计数信号相对上轮变化时才探测 feed
    let lastPollSignals = null;
    function pollSignalsOf(s) {
      return [s.today, s.pending, s.featuredToday, s.articles, s.starred,
        s.pipeline?.pipelineProgress?.analyzed, s.pipeline?.pipelineProgress?.batches,
        s.pipeline?.lastPipeline?.at].join('|');
    }
    function pollRealtime() {
      if (disposed) return Promise.resolve();
      // 按钮、前台恢复和状态推送共用一轮请求，慢响应不会叠出请求队列。
      if (activePoll) return activePoll;
      activePoll = runPollRealtime().finally(() => {
        activePoll = null;
        if (activityPollPending && !disposed) {
          activityPollPending = false;
          pollRealtime();
        }
      });
      return activePoll;
    }
    async function runPollRealtime() {
      clearTimeout(pollTimer);
      const request = ++pollRequest;
      const context = () => [state.view, state.domain, state.category, state.q].join('\u0000');
      const startedContext = context();
      const current = () => !disposed && request === pollRequest && !document.hidden && context() === startedContext;
      const schedule = () => { if (!disposed && request === pollRequest) pollTimer = setTimeout(pollRealtime,
        pipelineBusy ? (document.hidden ? 5000 : 1500) : 18000); };
      if (document.hidden && !watchingPipeline) return schedule();
      const stats = await refreshStats();
      if (disposed) return;
      if (stats?.pipeline && (!Number.isFinite(stats.pipeline.revision) || stats.pipeline.revision >= activityRevision)) {
        if (Number.isFinite(stats.pipeline.revision)) activityRevision = stats.pipeline.revision;
        pipelineBusy = stats.pipeline.activity === 'collecting'
          || Boolean(stats.pipeline.pipelineRunning || stats.pipeline.collectRunning || stats.pipeline.analyzeRunning);
        if (watchingPipeline && request >= watchAfterRequest && !pipelineBusy) {
          watchingPipeline = false;
          const result = stats.pipeline.lastPipeline;
          if (result?.ok === false) toast('采集分析失败，请检查信源或模型设置', true);
          else if (stats.pipeline.pipelineProgress?.phase === 'paused') toast('采集已完成，部分分析等待预算或重试');
          else toast('采集分析完成');
          lastPollSignals = null;
          pipelineRefreshPending = true;
        }
      }
      if (!current()) { lastPollSignals = null; return schedule(); }
      if (pipelineRefreshPending && !state.loading) {
        pipelineRefreshPending = false;
        if (FEED_VIEWS.includes(state.view)) {
          const reading = getScrollY() >= 220 || document.querySelector('.card.expanded, .cluster-items:not([hidden])')
            || document.activeElement?.closest?.('.card');
          if (reading) {
            elements.newFlash.textContent = '🛰 情报分析已更新 · 点击查看';
            elements.newFlash.hidden = false;
          } else { await loadFeed(); }
        }
        if (typeof onPipelineComplete === 'function') {
          try { await onPipelineComplete(); } catch { /* 视图恢复失败不阻断后续轮询 */ }
        }
      }
      if (!current()) { lastPollSignals = null; return schedule(); }
      // 无变化轮次直接跳过 feed 探测；stats 拉取失败时宁可多探一次不漏更新
      const signals = stats ? pollSignalsOf(stats) : null;
      if (startedContext !== lastPollContext) lastPollSignals = null;
      if (signals !== null && signals === lastPollSignals) return schedule();
      // 仅信息流视图、非检索、非加载中才做增量探测
      if (!FEED_VIEWS.includes(state.view) || state.q || state.loading) return schedule();
      lastPollSignals = signals;
      lastPollContext = startedContext;
      try {
        const params = new URLSearchParams({ view: state.view, page: 0 });
        if (state.domain) params.set('domain', state.domain);
        if (state.category) params.set('category', state.category);
        const data = await api('/api/feed?' + params);
        if (!current() || state.loading) { lastPollSignals = null; return schedule(); }
        const newItems = data.items.filter(i => !state.knownIds.has(i.id));
        if (newItems.length) {
          const atTop = getScrollY() < 220;
          const reading = document.querySelector('.card.expanded, .cluster-items:not([hidden])')
            || document.activeElement?.closest?.('.card');
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
      clearTimeout(pollTimer);
      if (!disposed) pollTimer = setTimeout(pollRealtime, pipelineBusy ? 1500 : 18000);
    }

    function watchPipeline() {
      watchingPipeline = true;
      watchAfterRequest = pollRequest + 1;
      pipelineBusy = true;
      lastPollSignals = null;
      // 采集 POST 之前发出的旧“在线”响应不能被当作本轮任务已完成。
      return activePoll ? activePoll.then(pollRealtime, pollRealtime) : pollRealtime();
    }
    function observeActivity(status) {
      if (Number.isFinite(status.revision)) {
        if (status.revision < activityRevision) return;
        activityRevision = status.revision;
      }
      const busy = status.activity === 'collecting'
        || Boolean(status.pipelineRunning || status.collectRunning || status.analyzeRunning);
      const changed = pipelineBusy !== busy;
      pipelineBusy = busy;
      if (changed) {
        if (activePoll) activityPollPending = true;
        else pollRealtime();
      }
    }
    function dispose() {
      disposed = true;
      clearTimeout(pollTimer);
    }

    return Object.freeze({ setRealtime, showNewFlash, pollRealtime, watchPipeline, observeActivity, start, dispose });
  }

  return Object.freeze({ createRealtimePoller });
});
