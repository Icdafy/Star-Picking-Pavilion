'use strict';

/* 摘星阁 · 情报日报视图
   阶段 3 批 2 自 app.js 抽离：日报加载（竞态守卫 + 骨架最短驻留）、
   日期前后翻与重新生成。所有依赖一律注入，工厂体不直读 window/document。 */

(function exposeDailyViewController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.DailyViewController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDailyViewControllerModule() {
  function createDailyViewController({
    api, state, esc, safeUrl, format, skeletons,
    toast, preferenceActions, dailyRequestGuard, elements, render = null
  } = {}) {
    if (typeof api !== 'function' || !state
      || typeof esc !== 'function' || typeof safeUrl !== 'function'
      || !format || typeof skeletons !== 'function'
      || typeof toast !== 'function' || !preferenceActions
      || !dailyRequestGuard || !elements?.body) {
      throw new TypeError('daily view controller requires api, state, esc, safeUrl, format, skeletons, toast, preferenceActions, dailyRequestGuard and elements.body dependencies');
    }
    const { delay, SKELETON_MIN_MS, DOMAIN_NAME, parseLocalDate, localDateString } = format;
    // v0.2.0：日报之外还有周报、月报（刊期不写入偏好，每次进入默认看日报）
    const period = { kind: 'daily', keys: { weekly: null, monthly: null }, lists: { weekly: [], monthly: [] } };
    const names = { daily: '日报', weekly: '周报', monthly: '月报' };
    let selection = null;
    let regenerating = false;
    const metricNames = () => period.kind === 'daily' ? ['精选情报', '低空经济', '商业航天'] : ['精选情报', '热点事件', '资本事件'];

    function reportLoading() {
      selection = null;
      elements.exportMenu?.hidePopover?.();
      elements.overview?.setAttribute('aria-busy', 'true');
      elements.date.textContent = `正在读取${names[period.kind]}…`;
      elements.sub.textContent = '正在读取本期报告…';
      if (elements.reportState) elements.reportState.textContent = '正在读取';
      metricNames().forEach((label, i) => { if (elements.metricLabels?.[i]) elements.metricLabels[i].textContent = label; });
      for (const node of elements.metricValues || []) node.textContent = '–';
      for (const node of [elements.prev, elements.next, elements.copy, elements.exportButton, elements.regen]) if (node) node.disabled = true;
    }

    function reportReady(report) {
      const daily = period.kind === 'daily';
      selection = daily ? { kind: 'daily', date: report.date } : { kind: period.kind, key: report.key };
      elements.sub.textContent = '';
      const labels = metricNames();
      const values = daily ? [report.total, report.byDomain.lowaltitude, report.byDomain.aerospace]
        : [report.totals.featured, report.totals.stories, report.totals.deals];
      labels.forEach((label, i) => {
        if (elements.metricLabels?.[i]) elements.metricLabels[i].textContent = label;
        if (elements.metricValues?.[i]) elements.metricValues[i].textContent = String(values[i] ?? 0);
      });
      if (elements.reportState) elements.reportState.textContent = daily ? '日报' : report.finished ? '已定稿' : '本期进行中';
      elements.overview?.setAttribute('aria-busy', 'false');
      for (const node of [elements.copy, elements.exportButton]) if (node) node.disabled = false;
      if (elements.regen) elements.regen.disabled = regenerating;
      if (elements.prev) elements.prev.disabled = !daily && period.lists[period.kind].indexOf(report.key) >= period.lists[period.kind].length - 1;
      if (elements.next) elements.next.disabled = daily ? report.date >= localDateString() : period.lists[period.kind].indexOf(report.key) <= 0;
    }

    function reportFailed() {
      selection = null;
      for (const node of [elements.copy, elements.exportButton, elements.regen]) if (node) node.disabled = true;
      elements.overview?.setAttribute('aria-busy', 'false');
      elements.date.textContent = `${names[period.kind]}暂不可用`;
      elements.sub.textContent = '报告未能加载，可在下方重试。';
      if (elements.reportState) elements.reportState.textContent = '读取失败';
    }

    function syncPeriodSwitch() {
      for (const button of elements.periods?.querySelectorAll('[data-period]') || []) {
        const on = button.dataset.period === period.kind;
        button.classList.toggle('active', on);
        button.setAttribute('aria-pressed', String(on));
      }
      if (elements.copy) {
        elements.copy.textContent = `复制${names[period.kind]}`;
        elements.copy.title = `把整份${names[period.kind]}复制成纯文本，直接贴进微信群或邮件`;
      }
      if (elements.exportButton) elements.exportButton.title = `把整份${names[period.kind]}存成文件`;
      if (elements.schedule) elements.schedule.textContent = { daily: '每日 08:00 出刊', weekly: '每周一出刊', monthly: '每月 1 日出刊' }[period.kind];
      elements.prev?.setAttribute?.('aria-label', period.kind === 'daily' ? '前一天' : '前一期');
      elements.next?.setAttribute?.('aria-label', period.kind === 'daily' ? '后一天' : '后一期');
    }

    async function loadPeriod(kind, key) {
      const request = dailyRequestGuard.begin();
      const body = elements.body;
      body.innerHTML = skeletons(3);
      reportLoading();
      try {
        const [data] = await Promise.all([
          api(`/api/reports?kind=${kind}${key ? `&key=${encodeURIComponent(key)}` : ''}`),
          delay(SKELETON_MIN_MS)
        ]);
        if (!request.isCurrent()) return;
        const r = data.report;
        period.keys[kind] = r.key;
        period.lists[kind] = data.keys || [];
        elements.date.textContent = r.label;
        const range = /^(.*?)(（.*）)$/.exec(r.label);
        if (range) elements.date.innerHTML = `${esc(range[1])} <span class="daily-date-range">${esc(range[2])}</span>`;
        reportReady(r);
        const html = render ? render.issueBlocks(r) : '';
        body.innerHTML = html || `<div class="empty-state glass"><div class="es-icon">尚 无 刊 期</div><p>这一期还没有可收录的精选与热点。</p></div>`;
      } catch (e) {
        if (!request.isCurrent()) return;
        reportFailed();
        body.innerHTML = `<div class="empty-state glass"><div class="es-icon">信 号 中 断</div><p>刊期加载失败：${esc(e.message)}</p>
      <button type="button" class="btn-ghost btn-compact es-retry" data-act="retry-daily">重试</button></div>`;
      }
    }

    function reload() {
      syncPeriodSwitch();
      return period.kind === 'daily' ? loadDaily(state.dailyDate) : loadPeriod(period.kind, period.keys[period.kind]);
    }

    async function loadDaily(date) {
      if (period.kind !== 'daily') return loadPeriod(period.kind, period.keys[period.kind]);
      const request = dailyRequestGuard.begin();
      const body = elements.body;
      body.innerHTML = skeletons(3);
      reportLoading();
      try {
        const [data] = await Promise.all([
          api('/api/daily' + (date ? `?date=${date}` : '')),
          delay(SKELETON_MIN_MS)
        ]);
        if (!request.isCurrent()) return;
        const r = data.report;
        state.dailyDate = r.date;
        state.dailyDates = data.dates;
        elements.date.textContent = r.date.replace(/-/g, ' / ');
        reportReady(r);
        const before = render ? render.issueBlocks(r, { parts: ['lead', 'hot'] }) : '';
        const after = render ? render.issueBlocks(r, { parts: ['deals', 'portfolio', 'companies', 'breakthroughs'] }) : '';
        if (!r.sections.length) {
          body.innerHTML = before + `<div class="empty-state glass"><div class="es-icon">今 日 无 风</div><p>该日期暂无精选情报（可能尚未采集或全部低于精选阈值）</p></div>` + after;
          return;
        }
        body.innerHTML = before + r.sections.map(sec => `
      <div class="daily-section glass">
        <div class="daily-section-title">${esc(sec.category)}</div>
        ${sec.items.map(it => {
          const quality = it.quality ?? it.quality_score;
          const summary = it.aiSummary || it.ai_summary || '';
          const source = it.sourceName || it.source_name || '';
          const tier = it.sourceTier || it.tier || '';
          return `
          <div class="daily-item">
            <span class="di-score">${quality != null && Number.isFinite(Number(quality)) ? Math.round(quality) : '—'}</span>
            <div>
              <a href="${safeUrl(it.url)}" target="_blank" rel="noopener"${it.titleZh && it.titleZh !== it.title ? ` title="原标题：${esc(it.title)}"` : ''}>${esc(it.titleZh || it.title)}</a>
              ${summary ? `<div class="di-meta">${esc(summary)}</div>` : ''}
              <div class="di-meta">${esc(source)} · ${esc(tier)} · ${DOMAIN_NAME[it.domain] || ''}</div>
            </div>
          </div>`;
        }).join('')}
      </div>`).join('') + after;
      } catch (e) {
        if (!request.isCurrent()) return;
        reportFailed();
        body.innerHTML = `<div class="empty-state glass"><div class="es-icon">信 号 中 断</div><p>日报加载失败：${esc(e.message)}</p>
      <button type="button" class="btn-ghost btn-compact es-retry" data-act="retry-daily">重试</button></div>`;
      }
    }

    elements.body.addEventListener('click', event => {
      if (event.target.closest('[data-act="retry-daily"]')) { reload(); return; }
      const company = event.target.closest('[data-company]');
      if (company && typeof elements.onCompany === 'function') elements.onCompany(company.dataset.company);
    });

    elements.periods?.addEventListener('click', event => {
      const button = event.target.closest('[data-period]');
      if (!button || !['daily', 'weekly', 'monthly'].includes(button.dataset.period)) return;
      period.kind = button.dataset.period;
      return reload();
    });

    // 周报、月报按期号前后翻：期号列表由服务端给出（新 → 旧）
    function shiftPeriod(step) {
      const list = period.lists[period.kind] || [];
      const index = list.indexOf(period.keys[period.kind]);
      const next = list[index - step];
      if (index < 0 || !next) return;
      return loadPeriod(period.kind, next);
    }

    function shiftDaily(days) {
      if (period.kind !== 'daily') return shiftPeriod(days);
      const cur = state.dailyDate ? parseLocalDate(state.dailyDate) : new Date();
      cur.setDate(cur.getDate() + days);
      const d = localDateString(cur);
      if (d > localDateString()) return;
      state.dailyDate = d;
      preferenceActions.remember('dailyDate', d);
      return loadDaily(d);
    }

    if (elements.prev) elements.prev.addEventListener('click', () => shiftDaily(-1));
    if (elements.next) elements.next.addEventListener('click', () => shiftDaily(1));
    if (elements.regen) {
      elements.regen.addEventListener('click', async () => {
        if (!selection || regenerating) return;
        const target = { ...selection };
        const label = names[target.kind];
        const btn = elements.regen;
        regenerating = true;
        btn.disabled = true;
        btn.classList.add('is-busy');
        try {
          await api(target.kind === 'daily' ? '/api/daily/regenerate' : '/api/reports/regenerate',
            { body: target.kind === 'daily' ? { date: target.date } : { kind: target.kind, key: target.key } });
          toast(`${label}已重新生成`);
          if (selection && JSON.stringify(selection) === JSON.stringify(target)) await reload();
        } catch (error) {
          toast(`${label}重新生成失败：` + error.message, true);
        } finally {
          regenerating = false;
          btn.disabled = !selection;
          btn.classList.remove('is-busy');
        }
      });
    }

    syncPeriodSwitch();
    return Object.freeze({ loadDaily, shiftDaily, reload, getSelection: () => selection && { ...selection } });
  }

  return Object.freeze({ createDailyViewController });
});
