'use strict';

/* 摘星阁 · 监控信源视图
   阶段 3 批 2 自 app.js 抽离：信源列表加载（焦点记忆 + 骨架最短驻留）、
   启停/重试/移出监控与新增信源提报。依赖一律注入。 */

(function exposeSourcesController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.SourcesController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSourcesControllerModule() {
  function createSourcesController({
    api, state, esc, DomUtils, format, skeletons,
    toast, confirmGlass, elements
  } = {}) {
    if (typeof api !== 'function' || !state
      || typeof esc !== 'function' || !DomUtils || !format
      || typeof skeletons !== 'function' || typeof toast !== 'function'
      || typeof confirmGlass !== 'function' || !elements?.list) {
      throw new TypeError('sources controller requires api, state, esc, DomUtils, format, skeletons, toast, confirmGlass and elements.list dependencies');
    }
    const { timeAgo, hhmm, DOMAIN_NAME, delay, SKELETON_MIN_MS } = format;

    async function loadSources() {
      const list = elements.list;
      // 每次操作后整表重载会丢键盘焦点——先记下，渲染后归还
      const focusKey = DomUtils.findFocusKey(list);
      list.innerHTML = skeletons(4);
      try {
        const [sources] = await Promise.all([
          api('/api/sources'),
          delay(SKELETON_MIN_MS)
        ]);
        list.innerHTML = sources.map(s => {
          const st = !s.enabled ? 'idle' : s.last_status?.startsWith('error') ? 'err' : s.last_status === 'ok' ? 'ok' : 'idle';
          const health = s.health || {};
          const paused = health.pausedUntil
            ? `<span class="src-backoff" title="连续失败后自动拉长重试间隔，避免每轮空转">
             暂停至 ${esc(hhmm(health.pausedUntil))}</span>`
            : '';
          return `
      <div class="src-card glass${health.state === 'failing' ? ' is-failing' : ''}" data-id="${s.id}">
        <div class="src-row1">
          <span class="src-status ${st}" title="${esc(s.last_status || '未采集')}"></span>
          <span class="src-name" title="${esc(s.url)}">${esc(s.name)}</span>
          <span class="tier-chip tier-${esc(s.tier)}">${esc(s.tier)}</span>
          ${paused}
        </div>
        <div class="src-meta">
          <span>${esc(s.type.toUpperCase())}</span>
          <span>${DOMAIN_NAME[s.domain] || '双领域'}</span>
          <span>累计 ${s.item_count} 条</span>
          ${health.consecutiveErrors
            ? `<span style="color:var(--danger-ink)">连续失败 ${health.consecutiveErrors} 次</span>`
            : s.error_count ? `<span>累计失败 ${s.error_count} 次</span>` : ''}
          <span>${s.last_fetch_at ? timeAgo(s.last_fetch_at) : '未采集'}</span>
        </div>
        ${s.note ? `<div class="src-meta" style="margin-top:4px">${esc(s.note)}</div>` : ''}
        <div class="src-actions">
          <button data-act="toggle" data-focus-key="src-toggle:${s.id}">${s.enabled ? '停用' : '启用'}</button>
          ${health.pausedUntil ? `<button data-act="retry" data-focus-key="src-retry:${s.id}">立即重试</button>` : ''}
          <button data-act="remove" class="danger" data-focus-key="src-remove:${s.id}"${s.enabled ? '' : ' disabled'}>${s.enabled ? '移出监控' : '已移出监控'}</button>
        </div>
      </div>`;
        }).join('');
        if (focusKey) DomUtils.restoreFocusByKey(list, focusKey, list);
      } catch (e) {
        list.innerHTML = `<div class="empty-state glass"><div class="es-icon">信 号 中 断</div><p>加载失败：${esc(e.message)}</p>
      <button type="button" class="btn-ghost btn-compact es-retry" data-act="retry-sources">重试</button></div>`;
      }
    }

    elements.list.addEventListener('click', async e => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'retry-sources') { loadSources(); return; }
      const id = btn.closest('.src-card').dataset.id;
      try {
        if (btn.dataset.act === 'toggle') {
          const enabled = btn.textContent === '启用';
          await api(`/api/sources/${id}`, { method: 'PATCH', body: { enabled } });
          toast(enabled ? '信源已启用' : '信源已停用');
          loadSources();
        } else if (btn.dataset.act === 'retry') {
          await api(`/api/sources/${id}/retry`, { body: {} });
          toast('已清除退避，下轮采集会重新尝试');
          loadSources();
        } else if (btn.dataset.act === 'remove') {
          if (btn.disabled) return;
          if (!await confirmGlass('确定将该信源移出监控？已采集文章和信源记录都会保留。', { title: '移出信源', okText: '移出监控' })) return;
          await api(`/api/sources/${id}`, { method: 'DELETE' });
          toast('信源已移出监控');
          loadSources();
        }
      } catch (error) {
        toast('信源操作失败：' + error.message, true);
      }
    });

    function syncHtmlFields() {
      const htmlFields = elements.htmlFields;
      const typeSelect = elements.form?.elements?.type;
      if (!htmlFields || !typeSelect) return;
      htmlFields.hidden = typeSelect.value !== 'html';
    }

    if (elements.addButton && elements.dialog) {
      elements.addButton.addEventListener('click', () => {
        syncHtmlFields();
        elements.dialog.showModal();
      });
    }
    if (elements.form) {
      elements.form.elements?.type?.addEventListener('change', syncHtmlFields);
      elements.form.addEventListener('submit', async e => {
        if (e.submitter?.value !== 'ok') return;
        const fd = new FormData(e.target);
        const body = Object.fromEntries(fd.entries());
        const list = String(body.selectorList || '').trim();
        const datePattern = String(body.selectorDate || '').trim();
        delete body.selectorList;
        delete body.selectorDate;
        if (body.type === 'html' && list) {
          body.selector = { list };
          if (datePattern) body.selector.datePattern = datePattern;
        }
        try {
          await api('/api/sources', { body });
          toast('信源已提报，下轮采集生效');
          e.target.reset();
          syncHtmlFields();
          loadSources();
        } catch (err) {
          toast('保存失败：' + err.message, true);
        }
      });
    }

    return Object.freeze({ loadSources });
  }

  return Object.freeze({ createSourcesController });
});
