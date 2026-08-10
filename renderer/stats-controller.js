'use strict';

/* 摘星阁 · 塔台状态（统计数字与管线状态）
   阶段 3 批 2 自 app.js 抽离：setStat 的数字补间与 refreshStats 的整塔刷新。
   api、state、元素、时钟与帧回调一律走依赖注入，便于 Node 单测驱动。 */

(function exposeStatsController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.StatsController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStatsControllerModule() {
  function createStatsController({
    api, state, elements, prefersReducedMotion, now, frame
  } = {}) {
    if (typeof api !== 'function' || !state || !elements
      || typeof prefersReducedMotion !== 'function'
      || typeof now !== 'function' || typeof frame !== 'function') {
      throw new TypeError('stats controller requires api, state, elements, prefersReducedMotion, now and frame dependencies');
    }

    // 统计数字变化时做一次短促补间，避免刷新瞬间的跳字
    function setStat(el, value) {
      const target = Number(value);
      if (!Number.isFinite(target)) { el.textContent = '–'; return; }
      const previous = Number(el.dataset.value);
      el.dataset.value = String(target);
      if (!Number.isFinite(previous) || previous === target || prefersReducedMotion()) {
        el.textContent = target.toLocaleString('zh-CN');
        return;
      }
      const startedAt = now();
      const tick = at => {
        const progress = Math.min(1, (at - startedAt) / 520);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(previous + (target - previous) * eased).toLocaleString('zh-CN');
        if (progress < 1) frame(tick);
      };
      frame(tick);
    }

    async function refreshStats() {
      try {
        const s = await api('/api/stats');
        setStat(elements.statSources, s.sources);
        setStat(elements.statToday, s.today);
        setStat(elements.statFeatured, s.featuredToday);
        const starredCount = elements.tabStarredCount;
        starredCount.hidden = !s.starred;
        starredCount.textContent = s.starred > 99 ? '99+' : String(s.starred || '');
        const busy = s.pipeline?.running;
        elements.statStatus.innerHTML = `<span class="pulse-dot${busy ? ' busy' : ''}"></span>`;
        elements.statStatusLabel.textContent = busy ? '采集中' : (s.aiConfigured ? 'AI 在线' : '启发模式');
        const banner = elements.feedBanner;
        // 星标是用户手动收的，与 AI 是否配置无关，这里不该弹降级提示
        if (!s.aiConfigured && (state.view === 'featured' || state.view === 'hot')) {
          banner.hidden = false;
          banner.innerHTML = '当前为<b>关键词启发式</b>降级模式 —— 在『设置』中填入 DeepSeek API Key 即可启用五维 AI 评分与智能精选。';
        } else banner.hidden = true;
        return s;
      } catch { /* 后端未就绪 */ }
    }

    return Object.freeze({ setStat, refreshStats });
  }

  return Object.freeze({ createStatsController });
});
