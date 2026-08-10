'use strict';

/* 摘星阁 · 检索与核心词库面板
   阶段 3 批 2 自 app.js 抽离：检索框防抖、检索上下文条、词库面板
   （载入/筛选/领域口径/选词即检索）与 outside-click 收起。
   document 与各元素一律走依赖注入。 */

(function exposeSearchController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.SearchController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSearchControllerModule() {
  function createSearchController({
    api, state, esc, FEED_VIEWS, loadFeed, switchView, document, elements
  } = {}) {
    if (typeof api !== 'function' || !state || typeof esc !== 'function'
      || !Array.isArray(FEED_VIEWS) || typeof loadFeed !== 'function'
      || typeof switchView !== 'function' || !document
      || !elements?.searchInput || !elements?.lexiconPanel || !elements?.lexiconToggle) {
      throw new TypeError('search controller requires api, state, esc, FEED_VIEWS, loadFeed, switchView, document and elements dependencies');
    }
    const searchInput = elements.searchInput;
    const lexiconPanel = elements.lexiconPanel;
    const lexiconToggle = elements.lexiconToggle;
    const lexiconFilter = elements.lexiconFilter;
    const lexiconBody = elements.lexiconBody;

    function syncSearchBox() {
      elements.searchBox.classList.toggle('has-value', Boolean(searchInput.value));
    }

    // 检索上下文条：明确当前处于检索态，并给出一键退出
    function renderSearchContext() {
      const box = elements.searchContext;
      if (!state.q) {
        box.hidden = true;
        box.innerHTML = '';
        return;
      }
      box.hidden = false;
      box.innerHTML = `检索 <strong>「${esc(state.q)}」</strong>`
        + ` · 已列出 <span class="sc-count">${state.listed}</span> 条`
        + '<button type="button" data-act="clear-search">清除检索</button>';
    }

    function clearSearch() {
      const hadQuery = Boolean(state.q);
      clearTimeout(searchTimer);   // 丢掉尚未触发的防抖，避免清空后又跑一次空检索
      searchInput.value = '';
      state.q = '';
      syncSearchBox();
      renderSearchContext();
      if (hadQuery) loadFeed();
    }

    let searchTimer;
    searchInput.addEventListener('input', e => {
      syncSearchBox();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.q = e.target.value.trim();
        if (!FEED_VIEWS.includes(state.view)) {
          switchView('all', { persist: false });
        }
        else loadFeed();
      }, 350);
    });

    if (elements.searchClear) {
      elements.searchClear.addEventListener('click', () => {
        clearSearch();
        searchInput.focus();
      });
    }

    if (elements.searchContext) {
      elements.searchContext.addEventListener('click', event => {
        if (event.target.closest('button[data-act="clear-search"]')) clearSearch();
      });
    }

    // ---------- 核心词库面板 ----------
    // 一份纯词表没有用处：用户真正要判断的是「这个词在我已经捕到的情报里有多少条」。
    // 所以面板把词库和本地库的命中数一起展示——0 条的词自然沉下去，有量的词一眼可见，
    // 点一下就把它填进检索框，省掉「想不起来该搜什么」这一步。
    const lexiconState = { data: null, loading: false, domain: '', onlyHits: false, filter: '' };

    function lexiconVisibleGroups() {
      const keyword = lexiconState.filter.trim().toLowerCase();
      return (lexiconState.data?.groups || [])
        .filter(group => !lexiconState.domain || group.domain === lexiconState.domain)
        .map(group => ({
          ...group,
          terms: group.terms.filter(item => {
            if (lexiconState.onlyHits && !item.count) return false;
            if (!keyword) return true;
            return [item.term, ...(item.aliases || [])]
              .some(surface => String(surface).toLowerCase().includes(keyword));
          })
        }))
        .filter(group => group.terms.length);
    }

    // 服务端会在规范词与别名里挑命中最多的那个当检索式。挑中的若不是规范词，
    // 得在悬浮提示里说清楚——否则用户点「亿航智能」、检索框里出现「亿航」会以为是 bug。
    function lexiconTermHint(item) {
      const parts = [];
      if (item.query && item.query !== item.term) parts.push(`按「${item.query}」检索，命中最多`);
      if (item.aliases?.length) parts.push('含别名：' + item.aliases.join('、'));
      return parts.join(' · ') || item.term;
    }

    function renderLexicon() {
      const body = lexiconBody;
      const summary = elements.lexiconSummary;
      if (lexiconState.loading) { body.innerHTML = '<p class="lexicon-empty">正在统计库内命中…</p>'; return; }
      if (!lexiconState.data) { body.innerHTML = '<p class="lexicon-empty">词库载入失败，稍后重试</p>'; return; }

      const groups = lexiconVisibleGroups();
      const shown = groups.reduce((sum, group) => sum + group.terms.length, 0);
      summary.textContent = `${lexiconState.data.termCount} 个核心词 · ${lexiconState.data.matchedTermCount} 个在库中有命中`
        + (shown === lexiconState.data.termCount ? '' : ` · 当前显示 ${shown} 个`);

      if (!groups.length) {
        body.innerHTML = '<p class="lexicon-empty">没有符合条件的词</p>';
        return;
      }
      body.innerHTML = groups.map(group => `
    <section class="lexicon-group">
      <h4><span class="lex-dot lex-dot-${group.domain === 'aerospace' ? 'ae' : 'la'}" aria-hidden="true"></span>${esc(group.label)}</h4>
      <div class="lexicon-terms">
        ${group.terms.map(item => `
          <button type="button" class="lex-term${item.count ? '' : ' is-empty'}"
                  data-lex-term="${esc(item.term)}"
                  data-lex-query="${esc(item.query || item.term)}"
                  title="${esc(lexiconTermHint(item))}">
            ${esc(item.term)}<span class="lex-count">${item.count}</span>
          </button>`).join('')}
      </div>
    </section>`).join('');
    }

    async function loadLexicon(force = false) {
      if (lexiconState.data && !force) return;
      lexiconState.loading = true;
      renderLexicon();
      try {
        lexiconState.data = await api('/api/lexicon');
      } catch {
        lexiconState.data = null;
      } finally {
        lexiconState.loading = false;
        renderLexicon();
      }
    }

    function setLexiconOpen(open) {
      lexiconPanel.hidden = !open;
      lexiconPanel.classList.toggle('is-open', open);
      lexiconToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      lexiconToggle.classList.toggle('is-on', open);
      if (open) {
        loadLexicon();
        lexiconFilter.focus();
      }
    }

    lexiconToggle.addEventListener('click', () => setLexiconOpen(lexiconPanel.hidden));
    if (elements.lexiconClose) {
      elements.lexiconClose.addEventListener('click', () => {
        setLexiconOpen(false);
        lexiconToggle.focus();
      });
    }

    if (lexiconFilter) {
      lexiconFilter.addEventListener('input', event => {
        lexiconState.filter = event.target.value;
        renderLexicon();
      });
    }

    if (elements.lexiconScopes) {
      elements.lexiconScopes.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;
        if (button.dataset.lexHits !== undefined) {
          lexiconState.onlyHits = !lexiconState.onlyHits;
          button.classList.toggle('active', lexiconState.onlyHits);
          button.setAttribute('aria-pressed', lexiconState.onlyHits ? 'true' : 'false');
        } else {
          lexiconState.domain = button.dataset.lexDomain || '';
          for (const scope of elements.lexiconScopeButtons) {
            scope.classList.toggle('active', scope === button);
          }
        }
        renderLexicon();
      });
    }

    // 选词即检索。固定落到「全部动态」，不管当前在哪个视图：
    // 面板上的条数是按全部动态的口径算的，若停在「精选」里检索，
    // 面板写 45、结果只有 1 条，这个数字立刻就不可信了。
    // 「点一个词就检索它」的唯一实现：词库面板与卡片上的实体标签共用。
    // 两处若各写一份，防抖计时器和视图切换的处理迟早会漂开。
    function runTermSearch(term) {
      const query = String(term || '').trim();
      if (!query) return;
      clearTimeout(searchTimer);
      searchInput.value = query;
      state.q = query;
      syncSearchBox();
      if (state.view === 'all') loadFeed();
      else switchView('all', { persist: false });
    }

    if (lexiconBody) {
      lexiconBody.addEventListener('click', event => {
        const button = event.target.closest('button[data-lex-term]');
        if (!button) return;
        setLexiconOpen(false);
        runTermSearch(button.dataset.lexQuery || button.dataset.lexTerm);
      });
    }

    // 点面板之外或按 Esc 收起：面板浮在顶栏下方，不该赖着不走
    document.addEventListener('click', event => {
      if (lexiconPanel.hidden) return;
      if (lexiconPanel.contains(event.target) || lexiconToggle.contains(event.target)) return;
      setLexiconOpen(false);
    });

    return Object.freeze({
      syncSearchBox, renderSearchContext, clearSearch,
      setLexiconOpen, runTermSearch, loadLexicon
    });
  }

  return Object.freeze({ createSearchController });
});
