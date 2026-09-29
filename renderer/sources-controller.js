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
    let importSourceId = null;
    // v0.2.2：两百多个信源平铺无法查找——列表在本地按关键词、类型、领域与运行状态筛选，不重复请求
    let allSources = [];
    const filter = { q: '', status: '', type: '', domain: '' };
    const TYPE_LABEL = { rss: 'RSS', html: '网页', api: '接口', wechat: '公众号', external: '外部导入', bing: '必应' };

    function statusOf(s) {
      if (!s.enabled) return 'off';
      if (s.health?.state === 'failing' || s.health?.consecutiveErrors || String(s.last_status || '').startsWith('error')) return 'err';
      return 'on';
    }

    function matches(s) {
      if (filter.status && statusOf(s) !== filter.status) return false;
      if (filter.type && s.type !== filter.type) return false;
      if (filter.domain && s.domain !== filter.domain) return false;
      if (filter.q) {
        const text = `${s.name} ${s.url} ${s.note || ''}`.toLowerCase();
        if (!filter.q.toLowerCase().split(/\s+/).filter(Boolean).every(word => text.includes(word))) return false;
      }
      return true;
    }

    function renderSummary(shown) {
      if (!elements.summary) return;
      const counts = { on: 0, err: 0, off: 0 };
      for (const s of allSources) counts[statusOf(s)]++;
      const items = allSources.reduce((sum, s) => sum + (Number(s.item_count) || 0), 0);
      elements.summary.innerHTML = `<span><b>${allSources.length}</b> 个信源</span><span class="ok"><b>${counts.on}</b> 运行中</span>`
        + `<span class="err"><b>${counts.err}</b> 异常或退避</span><span class="off"><b>${counts.off}</b> 已停用</span>`
        + `<span>累计采集 <b>${items.toLocaleString('zh-CN')}</b> 条</span>`
        + (shown !== allSources.length ? `<span class="src-shown">筛选出 <b>${shown}</b> 个</span>` : '');
    }

    function renderList() {
      const list = elements.list;
      const focusKey = DomUtils.findFocusKey(list);
      const shown = allSources.filter(matches);
      renderSummary(shown.length);
      if (!shown.length) {
        list.innerHTML = `<div class="empty-state glass"><div class="es-icon">查 无 此 源</div><p>没有符合筛选条件的信源，可清空搜索或切换状态、类型与领域。</p>
      <button type="button" class="btn-ghost btn-compact" data-act="clear-source-filters">清空筛选</button></div>`;
        return;
      }
      list.innerHTML = shown.map(sourceCard).join('');
      if (focusKey) DomUtils.restoreFocusByKey(list, focusKey, list);
    }

    function clearFilters() {
      Object.assign(filter, { q: '', status: '', type: '', domain: '' });
      if (elements.search) elements.search.value = '';
      if (elements.type) elements.type.value = '';
      if (elements.domain) elements.domain.value = '';
      syncStatusChips();
      renderList();
    }

    function syncStatusChips() {
      for (const chip of elements.status?.querySelectorAll?.('[data-source-status]') || []) {
        const on = chip.dataset.sourceStatus === filter.status;
        chip.classList.toggle('active', on);
        chip.setAttribute('aria-pressed', String(on));
      }
    }

    function sourceCard(s) {
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
          <span>${s.type === 'external' ? '外部导入' : esc(s.type.toUpperCase())}</span>
          <span>${DOMAIN_NAME[s.domain] || '双领域'}</span>
          <span>累计 ${s.item_count} 条</span>
          ${health.consecutiveErrors
            ? `<span style="color:var(--danger-ink)">连续失败 ${health.consecutiveErrors} 次</span>`
            : s.error_count ? `<span>累计失败 ${s.error_count} 次</span>` : ''}
          <span>${s.last_fetch_at ? timeAgo(s.last_fetch_at) : s.type === 'external' ? '等待导入' : '未采集'}</span>
        </div>
        ${s.note ? `<div class="src-meta" style="margin-top:4px">${esc(s.note)}</div>` : ''}
        <div class="src-actions">
          <button data-act="toggle" data-focus-key="src-toggle:${s.id}">${s.enabled ? '停用' : '启用'}</button>
          ${s.type === 'external' ? `<button data-act="import" data-focus-key="src-import:${s.id}"${s.enabled ? '' : ' disabled'}>导入内容</button>` : ''}
          ${health.pausedUntil ? `<button data-act="retry" data-focus-key="src-retry:${s.id}">立即重试</button>` : ''}
          <button data-act="remove" class="danger" data-focus-key="src-remove:${s.id}"${s.enabled ? '' : ' disabled'}>${s.enabled ? '移出监控' : '已移出监控'}</button>
        </div>
      </div>`;
    }

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
        allSources = Array.isArray(sources) ? sources : [];
        renderList();
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
      if (btn.dataset.act === 'clear-source-filters') { clearFilters(); return; }
      const id = btn.closest('.src-card').dataset.id;
      try {
        if (btn.dataset.act === 'import') {
          if (btn.disabled || !elements.ingestDialog || !elements.ingestForm) return;
          importSourceId = Number(id);
          elements.ingestForm.reset();
          elements.ingestSourceName.textContent = btn.closest('.src-card').querySelector('.src-name').textContent;
          elements.ingestResult.textContent = '';
          elements.ingestDialog.showModal();
        } else if (btn.dataset.act === 'toggle') {
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
      const urlInput = elements.form.elements.url;
      if (urlInput) urlInput.placeholder = typeSelect.value === 'external'
        ? 'external://my-crawler（自定义唯一标识）' : 'https://… 或 eastmoney://关键词';
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
        e.preventDefault();
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
          toast(body.type === 'external' ? '信源已创建，可在信源卡片导入内容' : '信源已提报，下轮采集生效');
          elements.dialog.close();
          e.target.reset();
          syncHtmlFields();
          loadSources();
        } catch (err) {
          toast('保存失败：' + err.message, true);
        }
      });
    }

    elements.ingestForm?.addEventListener('submit', async e => {
      if (e.submitter?.value !== 'ok') return;
      e.preventDefault();
      const button = e.submitter;
      button.disabled = true;
      try {
        const form = elements.ingestForm;
        let items;
        try { items = JSON.parse(form.elements.items.value); }
        catch { throw new Error('请输入有效的 JSON 数组'); }
        if (!Array.isArray(items) || !items.length || items.length > 50) throw new Error('每次须导入 1–50 条文章');
        if (form.elements.backfill.checked) items = items.map(item => ({ ...item, backfill: true }));
        const result = await api('/api/ingest/items', { body: { sourceId: importSourceId, items } });
        elements.ingestResult.textContent = `新增 ${result.created} 条，重复 ${result.duplicates} 条。待下一轮采集分析后呈现。`;
        await loadSources();
      } catch (error) {
        elements.ingestResult.textContent = `导入失败：${error.message}`;
      } finally { button.disabled = false; }
    });

    let searchTimer = null;
    elements.search?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { filter.q = String(elements.search.value || '').trim().slice(0, 60); renderList(); }, 160);
    });
    elements.status?.addEventListener('click', event => {
      const chip = event.target.closest('[data-source-status]');
      if (!chip) return;
      filter.status = chip.dataset.sourceStatus || '';
      syncStatusChips();
      renderList();
    });
    elements.type?.addEventListener('change', () => { filter.type = elements.type.value || ''; renderList(); });
    elements.domain?.addEventListener('change', () => { filter.domain = elements.domain.value || ''; renderList(); });

    return Object.freeze({ loadSources, filterState: () => ({ ...filter }), TYPE_LABEL });
  }

  return Object.freeze({ createSourcesController });
});
