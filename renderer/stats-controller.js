'use strict';

/* 摘星阁 · 塔台状态（统计数字与管线状态）
   阶段 3 批 2 自 app.js 抽离：setStat 的数字补间与 refreshStats 的整塔刷新。
   api、state、元素、时钟与帧回调一律走依赖注入，便于 Node 单测驱动。 */

(function exposeStatsController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.StatsController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStatsControllerModule() {
  const PHASES = Object.freeze({ waiting: '等待中', collecting: '采集中', 'collecting-analyzing': '采集分析中',
    analyzing: '分析中', grouping: '归组中', editorial: '综述中', completed: '本轮已完成',
    paused: '本轮暂缓', failed: '本轮未完成', stopped: '本轮已停止' });
  const count = value => Number.isFinite(value) && value >= 0 ? Math.floor(value).toLocaleString('zh-CN') : '0';
  function duration(value) {
    if (!Number.isFinite(value) || value < 0) return '—';
    const seconds = Math.floor(value / 1000);
    if (seconds < 60) return `${seconds}秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
    return `${Math.floor(seconds / 3600)}小时${Math.floor(seconds % 3600 / 60)}分`;
  }
  function pipelinePresentation(schedule = {}) {
    const busy = schedule.activity ? schedule.activity === 'collecting'
      : Boolean(schedule.collectRunning || schedule.analyzeRunning || schedule.pipelineRunning);
    const progress = schedule.pipelineProgress || schedule.lastPipeline?.progress || null;
    const terminal = ['completed', 'paused', 'failed', 'stopped'].includes(progress?.phase);
    const label = busy ? progress?.stageLabel || PHASES[progress?.phase] || '采集中' : terminal ? PHASES[progress.phase] : '在线';
    // 每条进度只解释当前步骤；信源结束后，不能把 201/201 当作整轮任务完成。
    const stageTotal = progress?.stageTotal;
    const stageDone = progress?.stageDone;
    const measured = Number.isFinite(stageTotal) && stageTotal > 0 && Number.isFinite(stageDone);
    const sourceOnly = progress?.phase === 'collecting' && !progress.analysisStage && progress.sourcesTotal > 0;
    const ratio = measured ? Math.max(0, Math.min(1, stageDone / stageTotal))
      : sourceOnly ? Math.max(0, Math.min(1, progress.sourcesCompleted / progress.sourcesTotal)) : null;
    const stageCount = measured ? `${count(stageDone)}/${count(stageTotal)}` : '';
    const summary = progress ? [
      `信源 ${count(progress.sourcesCompleted)}/${count(progress.sourcesTotal)}`,
      `新增 ${count(progress.collected)} 条`, `已分析 ${count(progress.analyzed)} 条`, `精选 ${count(progress.featured)} 条`,
      Number.isFinite(progress.remaining) ? `待分析 ${count(progress.remaining)} 条` : '',
      Number.isFinite(progress.elapsedMs) ? `${busy ? '已用' : '总用时'} ${duration(progress.elapsedMs)}` : '',
      Number.isFinite(progress.stageElapsedMs) && busy ? `当前步骤 ${duration(progress.stageElapsedMs)}` : ''
    ].filter(Boolean).join('；') : '';
    const sections = [];
    const tasks = (progress?.activeTasks || []).slice(0, 12).map(task => [
      task.label || '处理中', task.current,
      task.status === 'retrying' || task.status === 'retry' ? `重试${task.attempt ? `第 ${count(task.attempt)} 次` : '等待'}` : '',
      Number.isFinite(task.retryInMs) && task.retryInMs > 0 ? `${duration(task.retryInMs)}后重试` : '',
      Number.isFinite(task.elapsedMs) ? `已用 ${duration(task.elapsedMs)}` : ''
    ].filter(Boolean).join(' · '));
    const taskCount = Number.isFinite(progress?.activeTaskCount) ? Math.max(tasks.length, progress.activeTaskCount)
      : Array.isArray(progress?.activeTasks) ? progress.activeTasks.length : 0;
    if (tasks.length) sections.push({ label: taskCount > tasks.length ? `正在处理（共${count(taskCount)}项，显示前${tasks.length}项）` : '正在处理', lines: tasks });
    const stages = (progress?.stages || []).slice(0, 32).map(stage => [
      stage.label || stage.stage || '步骤',
      Number.isFinite(stage.total) && stage.total > 0 ? `${count(stage.done)}/${count(stage.total)}`
        : Number.isFinite(stage.done) && stage.done > 0 ? `已处理 ${count(stage.done)}` : '',
      duration(stage.elapsedMs),
      ({ running: '进行中', completed: '已完成', paused: '暂缓', failed: '未完成', skipped: '已跳过', stopped: '已停止' })[stage.status] || ''
    ].filter(Boolean).join(' · '));
    if (stages.length) sections.push({ label: '步骤记录（并行步骤耗时不相加）', lines: stages });
    const warnings = (progress?.warnings || []).slice(0, 12).filter(Boolean).map(String);
    if (warnings.length) sections.push({ label: '需要留意', lines: warnings });
    const detail = progress && (busy || terminal) ? [label, stageCount ? `当前步骤 ${stageCount}` : '', summary, progress.message].filter(Boolean).join('；') : '';
    return {
      busy, label, detail, progress, terminal, sections, summary,
      tone: progress?.phase === 'failed' ? 'error' : busy ? 'busy' : progress?.phase === 'completed' ? 'ready' : 'info',
      value: [stageCount, Number.isFinite(progress?.elapsedMs) ? duration(progress.elapsedMs) : ''].filter(Boolean).join(' · '),
      ratio: terminal ? null : ratio,
      facts: progress ? [['总用时', duration(progress.elapsedMs)], ['信源', `${count(progress.sourcesCompleted)}/${count(progress.sourcesTotal)}`],
        ['已分析', count(progress.analyzed)], ['待分析', Number.isFinite(progress.remaining) ? count(progress.remaining) : '—']] : []
    };
  }
  function createStatsController({
    api, state, elements, prefersReducedMotion, now, frame, onActivity
  } = {}) {
    if (typeof api !== 'function' || !state || !elements
      || typeof prefersReducedMotion !== 'function'
      || typeof now !== 'function' || typeof frame !== 'function') {
      throw new TypeError('stats controller requires api, state, elements, prefersReducedMotion, now and frame dependencies');
    }

    // 统计数字变化时做一次短促补间，避免刷新瞬间的跳字
    let activityRevision = -1;
    let statsRequest = 0;
    let activityBusy = false;
    const statAnimations = new WeakMap();
    function renderActivity(schedule = {}) {
      if (Number.isFinite(schedule.revision)) {
        if (schedule.revision < activityRevision) return;
        activityRevision = schedule.revision;
      }
      const presentation = pipelinePresentation(schedule);
      const { busy, detail, progress } = presentation;
      activityBusy = busy;
      const label = busy ? presentation.label : '在线';
      if (elements.statStatusLabel.textContent !== label) {
        elements.statStatus.innerHTML = `<span class="pulse-dot${busy ? ' busy' : ''}"></span>`;
        elements.statStatusLabel.textContent = label;
      }
      if (elements.btnRefresh) {
        elements.btnRefresh.classList.toggle('spinning', busy);
        elements.btnRefresh.disabled = busy;
        elements.btnRefresh.setAttribute('aria-busy', String(busy));
        elements.btnRefresh.setAttribute('title', busy && detail ? detail : '立即采集分析（Alt+R）');
        elements.btnRefresh.setAttribute('aria-label', busy && detail ? detail : '立即采集分析');
      }
      elements.statStatusLabel.title = detail;
      // v0.2.39 流体云：同一份管线状态交给顶部胶囊，进行中显示阶段、进度与计数。
      if (typeof onActivity === 'function') {
        try { onActivity(presentation); } catch { /* 增强层 */ }
      }
      if (elements.pipelineRunDetails) {
        elements.pipelineRunDetails.hidden = !progress || (!busy && !presentation.terminal);
        if (elements.pipelineRunSummary) elements.pipelineRunSummary.textContent = detail;
        if (elements.pipelineRunLines) elements.pipelineRunLines.textContent = presentation.sections
          .map(section => `${section.label}\n${section.lines.join('\n')}`).join('\n\n');
      }
      if (elements.collectScheduleStatus) {
        const date = value => new Date(value).toLocaleString('zh-CN', { hour12: false });
        const next = schedule.nextCollectAt ? `下次自动采集：${date(schedule.nextCollectAt)}${schedule.lastRun?.at ? '；最近采集完成：' + date(schedule.lastRun.at) : ''}`
          : schedule.activeSchedule?.enabled ? '在线待命，等待下一次自动任务。'
          : '在线待命；自动采集关闭，点击“立即采集分析”才会开始工作。';
        elements.collectScheduleStatus.textContent = busy ? (detail || '采集分析任务正在运行；全部完成后恢复在线。')
          : [presentation.terminal ? detail : '', next].filter(Boolean).join('；');
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

    return Object.freeze({ setStat, refreshStats, renderActivity, isBusy: () => activityBusy });
  }

  return Object.freeze({ createStatsController, pipelinePresentation, duration });
});
