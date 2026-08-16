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
    toast, preferenceActions, dailyRequestGuard, elements
  } = {}) {
    if (typeof api !== 'function' || !state
      || typeof esc !== 'function' || typeof safeUrl !== 'function'
      || !format || typeof skeletons !== 'function'
      || typeof toast !== 'function' || !preferenceActions
      || !dailyRequestGuard || !elements?.body) {
      throw new TypeError('daily view controller requires api, state, esc, safeUrl, format, skeletons, toast, preferenceActions, dailyRequestGuard and elements.body dependencies');
    }
    const { delay, SKELETON_MIN_MS, DOMAIN_NAME, parseLocalDate, localDateString } = format;

    async function loadDaily(date) {
      const request = dailyRequestGuard.begin();
      const body = elements.body;
      body.innerHTML = skeletons(3);
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
        elements.sub.textContent =
          `${r.total} 条精选 · 低空经济 ${r.byDomain.lowaltitude} 条 · 商业航天 ${r.byDomain.aerospace} 条 · 生成于 ${new Date(r.generatedAt).toLocaleTimeString('zh-CN')}`;
        if (!r.sections.length) {
          body.innerHTML = `<div class="empty-state glass"><div class="es-icon">今 日 无 风</div><p>该日期暂无精选情报（可能尚未采集或全部低于精选阈值）</p></div>`;
          return;
        }
        body.innerHTML = r.sections.map(sec => `
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
              <a href="${safeUrl(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>
              ${summary ? `<div class="di-meta">${esc(summary)}</div>` : ''}
              <div class="di-meta">${esc(source)} · ${esc(tier)} · ${DOMAIN_NAME[it.domain] || ''}</div>
            </div>
          </div>`;
        }).join('')}
      </div>`).join('');
      } catch (e) {
        if (!request.isCurrent()) return;
        body.innerHTML = `<div class="empty-state glass"><div class="es-icon">信 号 中 断</div><p>日报加载失败：${esc(e.message)}</p>
      <button type="button" class="btn-ghost btn-compact es-retry" data-act="retry-daily">重试</button></div>`;
      }
    }

    elements.body.addEventListener('click', event => {
      if (event.target.closest('[data-act="retry-daily"]')) loadDaily(state.dailyDate);
    });

    function shiftDaily(days) {
      const cur = state.dailyDate ? parseLocalDate(state.dailyDate) : new Date();
      cur.setDate(cur.getDate() + days);
      const d = localDateString(cur);
      if (d > localDateString()) return;
      state.dailyDate = d;
      preferenceActions.remember('dailyDate', d);
      loadDaily(d);
    }

    if (elements.prev) elements.prev.addEventListener('click', () => shiftDaily(-1));
    if (elements.next) elements.next.addEventListener('click', () => shiftDaily(1));
    if (elements.regen) {
      elements.regen.addEventListener('click', async () => {
        const btn = elements.regen;
        btn.disabled = true;
        btn.classList.add('is-busy');
        try {
          await api('/api/daily/regenerate', { body: { date: state.dailyDate } });
          toast('日报已重新生成');
          loadDaily(state.dailyDate);
        } catch (error) {
          toast('日报重新生成失败：' + error.message, true);
        } finally {
          btn.disabled = false;
          btn.classList.remove('is-busy');
        }
      });
    }

    return Object.freeze({ loadDaily, shiftDaily });
  }

  return Object.freeze({ createDailyViewController });
});
