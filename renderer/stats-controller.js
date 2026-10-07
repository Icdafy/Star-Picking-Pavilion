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
    let activityRevision = -1;
    let statsRequest = 0;
    const statAnimations = new WeakMap();
    function renderActivity(schedule = {}) {
      if (Number.isFinite(schedule.revision)) {
        if (schedule.revision < activityRevision) return;
        activityRevision = schedule.revision;
      }
      const busy = schedule.activity ? schedule.activity === 'collecting'
        : Boolean(schedule.collectRunning || schedule.analyzeRunning || schedule.pipelineRunning);
      const label = busy ? '采集中' : '在线';
      if (elements.statStatusLabel.textContent !== label) {
        elements.statStatus.innerHTML = `<span class="pulse-dot${busy ? ' busy' : ''}"></span>`;
        elements.statStatusLabel.textContent = label;
      }
      if (elements.btnRefresh) {
        elements.btnRefresh.classList.toggle('spinning', busy);
        elements.btnRefresh.disabled = busy;
        elements.btnRefresh.setAttribute('aria-busy', String(busy));
      }
      if (elements.collectScheduleStatus) {
        const date = value => new Date(value).toLocaleString('zh-CN', { hour12: false });
        elements.collectScheduleStatus.textContent = busy ? '采集分析任务正在运行；全部完成后恢复在线。'
          : schedule.nextCollectAt ? `下次自动采集：${date(schedule.nextCollectAt)}${schedule.lastRun?.at ? '；最近采集完成：' + date(schedule.lastRun.at) : ''}`
          : schedule.activeSchedule?.enabled ? '在线待命，等待下一次自动任务。'
          : '在线待命；自动采集关闭，点击“立即采集分析”才会开始工作。';
      }
    }

    function setStat(el, value) {
      const animation = (statAnimations.get(el) || 0) + 1;
      statAnimations.set(el, animation);
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
        if (statAnimations.get(el) !== animation) return;
        const progress = Math.min(1, (at - startedAt) / 520);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(previous + (target - previous) * eased).toLocaleString('zh-CN');
        if (progress < 1) frame(tick);
      };
      frame(tick);
    }

    async function refreshStats() {
      const request = ++statsRequest;
      try {
        const s = await api('/api/stats');
        if (request !== statsRequest) return;
        setStat(elements.statSources, s.sources);
        setStat(elements.statToday, s.today);
        setStat(elements.statFeatured, s.featuredToday);
        const starredCount = elements.tabStarredCount;
        starredCount.hidden = !s.starred;
        starredCount.textContent = s.starred > 99 ? '99+' : String(s.starred || '');
        renderActivity(s.pipeline);
        const banner = elements.feedBanner;
        // 星标是用户手动收的，与 AI 是否配置无关，这里不该弹降级提示
        if (!s.aiConfigured && state.view === 'featured') {
          banner.hidden = false;
          banner.innerHTML = '当前为<b>关键词启发式</b>降级模式 —— 在『设置 → 模型』中为分析模型所属的提供商填入 API 密钥即可启用 AI 精选：两次独立评分、自洽中文标题与摘要、事件归组判断与融资事件抽取。';
        } else banner.hidden = true;
        return s;
      } catch { /* 后端未就绪 */ }
    }

    return Object.freeze({ setStat, refreshStats, renderActivity });
  }

  return Object.freeze({ createStatsController });
});
