'use strict';

/* 摘星阁 · 信息流控制器
   阶段 3 批 2 自 app.js 抽离：loadFeed（竞态守卫 + 骨架最短驻留 + 焦点归还）、
   工具条使能、哨兵自动预取与「加载更多」统一入口。
   阶段 3 批 4 追加：卡片交互层——toggleStar（星标 API + 星标视图整表重载）
   与 #feedList 点击事件委托（星标/复制/实体即检索/五维展开/事件簇）。
   阶段 4：整表渲染改走 keyed diff 调和（diff.reconcile / diff.appendPage），
   同 data-id 的行节点复用、缺失项才新建；骨架/空态/失败态仍为整表赋值。 */

(function exposeFeedController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.FeedController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createFeedControllerModule() {
  // 导出按钮只在真的有内容可导时才可用，避免复制出一份空文档
  const VIEW_EXPORT_LABEL = Object.freeze({
    featured: '精选', all: '全部动态', starred: '星标'
  });

  function createFeedController({
    api, state, esc, DomUtils, format, card, diff,
    feedRequestGuard, renderSearchContext, elements,
    IntersectionObserver: InjectedIntersectionObserver,
    // 批 4 卡片交互依赖（均可选：不注入则不接线交互层）
    toast, refreshStats, copyText, runTermSearch, safeUrl, timeAgo
  } = {}) {
    if (typeof api !== 'function' || !state || typeof esc !== 'function'
      || !DomUtils || !format || !card || !diff
      || typeof diff.reconcile !== 'function' || typeof diff.appendPage !== 'function'
      || !feedRequestGuard || typeof renderSearchContext !== 'function'
      || !elements?.list || !elements?.btnMore) {
      throw new TypeError('feed controller requires api, state, esc, DomUtils, format, card, diff, feedRequestGuard, renderSearchContext and elements dependencies');
    }
    const { delay, SKELETON_MIN_MS } = format;
    const { skeletons, publishedTime, starredTime } = card;

    function syncFeedToolbar(hasItems) {
      if (elements.btnCopyFeed) elements.btnCopyFeed.disabled = !hasItems;
      if (elements.btnExportFeed) elements.btnExportFeed.disabled = !hasItems;
      if (elements.feedToolbarNote) {
        elements.feedToolbarNote.textContent = hasItems
          ? `可把当前「${VIEW_EXPORT_LABEL[state.view] || '列表'}」列表整份带走（最多 200 条）`
          : '';
      }
    }

    async function loadFeed(reset = true) {
      // 分页追加不能并发，否则两批结果会交错；整表重载则以最后一次请求为准，
      // 这样在加载途中切换领域/分类不会被静默丢弃。
      if (!reset && state.loading) return;
      const request = feedRequestGuard.begin();
      state.loading = true;
      const list = elements.list;
      // 整表替换会丢掉键盘焦点——先记住焦点所在的控件，渲染后归还
      const focusKey = reset ? DomUtils.findFocusKey(list) : null;
      if (reset) { state.page = 0; state.listed = 0; list.innerHTML = skeletons(); if (elements.newFlash) elements.newFlash.hidden = true; }
      try {
        const params = new URLSearchParams({ view: state.view, page: state.page });
        if (state.domain) params.set('domain', state.domain);
        if (state.category) params.set('category', state.category);
        if (state.q) params.set('q', state.q);
        const [data] = await Promise.all([
          api('/api/feed?' + params),
          reset ? delay(SKELETON_MIN_MS) : Promise.resolve()
        ]);
        if (!request.isCurrent()) return;
        const startIdx = state.page * 30;
        // 阶段 4：渲染走 keyed diff 调和——同 data-id 的节点复用、缺失项才新建，
        // 避免整页卡片全量解析
        const mode = 'timeline';
        const timeOf = state.view === 'starred' ? starredTime : publishedTime;
        if (reset) diff.reconcile(data.items, { mode, startIdx, timeOf });
        else diff.appendPage(data.items, { mode, startIdx, timeOf });
        state.listed = reset ? data.items.length : state.listed + data.items.length;
        renderSearchContext();
        // 记录已知 id；高亮本次新到达的条目（实时插入）
        if (reset) state.knownIds = new Set(data.items.map(i => i.id));
        else data.items.forEach(i => state.knownIds.add(i.id));
        if (state.freshIds.size) {
          for (const id of state.freshIds) {
            const el = list.querySelector(`.card[data-id="${id}"]`);
            if (el) el.classList.add('card-new');
          }
          state.freshIds.clear();
        }
        if (reset && !data.items.length) {
          const emptyCopy = state.q ? '没有检索到相关情报，换个关键词试试'
            : state.view === 'starred' ? '还没有星标情报 —— 在任意卡片右下角点「星标」，收起来的情报不会被保留策略清理'
              : '暂无内容 —— 点击右上角刷新按钮立即采集，或等待定时任务';
          list.innerHTML = `<div class="empty-state glass">
        <div class="es-icon">${state.view === 'starred' && !state.q ? '尚 未 摘 星' : '风 平 浪 静'}</div>
        <p>${emptyCopy}</p>
      </div>`;
        }
        syncFeedToolbar(data.items.length > 0 || state.listed > 0);
        elements.btnMore.hidden = !data.hasMore;
        if (elements.feedEnd) elements.feedEnd.hidden = data.hasMore || !data.items.length;
        if (reset && focusKey) DomUtils.restoreFocusByKey(list, focusKey, list);
      } catch (e) {
        if (!request.isCurrent()) return;
        // 失败后列表骤短为错误态，哨兵会立刻进入视口——翻页入口必须同步
        // 隐藏，否则 Observer 触发 loadNextFeedPage，页码前跳、第 0 页被跳过
        elements.btnMore.hidden = true;
        if (elements.feedEnd) elements.feedEnd.hidden = true;
        // 失败不是终点：给出重试动作，而不是留一行死文字让人去找全局刷新
        if (reset) list.innerHTML = `<div class="empty-state glass"><div class="es-icon">信 号 中 断</div><p>后端连接失败：${esc(e.message)}</p>
      <button type="button" class="btn-ghost btn-compact es-retry" data-act="retry-feed">重试</button></div>`;
      } finally {
        if (request.isCurrent()) state.loading = false;
      }
    }

    // 下一页统一入口：哨兵自动预取与「加载更多」按钮共用同一条路径。
    // btnMore 保留为键盘可达入口与降级手段（Observer 不可用或哨兵不可见时仍可点击）。
    async function loadNextFeedPage() {
      const btn = elements.btnMore;
      // 无更多数据、加载中或非信息流视图时哨兵静默，防止重复触发
      if (btn.hidden || state.loading) return;
      // 双保险：列表里没有卡片（失败态/空态/骨架）时静默，防止页码前跳
      if (!elements.list.querySelector('.card[data-id]')) return;
      btn.disabled = true;
      btn.classList.add('is-busy');
      btn.textContent = '加载中…';
      state.page++;
      try {
        await loadFeed(false);
      } finally {
        btn.disabled = false;
        btn.classList.remove('is-busy');
        btn.textContent = '加载更多';
      }
    }
    elements.btnMore.addEventListener('click', loadNextFeedPage);

    // 哨兵自动预取：滚动接近列表底部即提前拉下一页；竞态仍由 feedRequestGuard
    // 与 loadFeed 的 loading 守卫兜住，分页追加走 diff.appendPage 不整表重渲染
    if (InjectedIntersectionObserver) {
      const feedSentinelObserver = new InjectedIntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) loadNextFeedPage();
        }
      }, { rootMargin: '600px 0px' });   // 提前约六屏身位预取，翻页感受接近无缝
      const feedSentinel = elements.feedSentinel;
      if (feedSentinel) feedSentinelObserver.observe(feedSentinel);
    }

    // ---------- 卡片交互（批 4 自 app.js 迁入） ----------
    let toggleStar = null;
    if (typeof toast === 'function') {
      toggleStar = async function toggleStar(card, button) {
        const id = Number(card.dataset.id);
        const starred = button.getAttribute('aria-pressed') !== 'true';
        button.disabled = true;
        try {
          const result = await api(`/api/articles/${id}/star`, { body: { starred } });
          // 在星标视图里取消星标 = 从收藏夹里移出，必须整表重载，否则卡片会留在原地
          if (state.view === 'starred' && !result.starred) {
            toast('已取消星标');
            await loadFeed();
            if (refreshStats) refreshStats();
            return;
          }
          button.classList.toggle('is-on', result.starred);
          button.setAttribute('aria-pressed', String(result.starred));
          button.querySelector('.card-act-label').textContent = result.starred ? '已星标' : '星标';
          button.title = result.starred ? '取消星标' : '星标留存（不受保留天数清理）';
          button.querySelector('path')?.setAttribute('fill', result.starred ? 'currentColor' : 'none');
          toast(result.starred ? '已星标，该情报不会被保留策略清理' : '已取消星标');
          if (refreshStats) refreshStats();
        } catch (error) {
          toast('星标操作失败：' + error.message, true);
        } finally {
          button.disabled = false;
        }
      };

      // 卡片交互：星标 / 复制 / 展开五维 / 事件簇
      elements.list.addEventListener('click', async e => {
        if (e.target.closest('[data-act="retry-feed"]')) { loadFeed(); return; }
        const actionBtn = e.target.closest('.card-act');
        if (actionBtn) {
          const card = actionBtn.closest('.card');
          if (actionBtn.dataset.act === 'star') return toggleStar(card, actionBtn);
          const title = card.querySelector('.card-title');
          const copied = await copyText(`${title.textContent.trim()}\n${title.href}`);
          toast(copied ? '已复制标题与链接' : '复制失败，请手动选择文本', !copied);
          return;
        }
        // 实体标签即检索入口：看到「蓝箭航天」就想知道它最近还有什么动静，
        // 这一步不该再让人回到搜索框里手打一遍
        const entityBtn = e.target.closest('.card-entity');
        if (entityBtn) {
          runTermSearch(entityBtn.dataset.entity);
          return;
        }
        const dimsBtn = e.target.closest('.dims-toggle');
        if (dimsBtn) {
          const card = dimsBtn.closest('.card');
          dimsBtn.setAttribute('aria-expanded', String(card.classList.toggle('expanded')));
          return;
        }
        const tgl = e.target.closest('.cluster-toggle');
        if (tgl) {
          const box = tgl.closest('.card').querySelector('.cluster-items');
          if (!box) return;
          tgl.classList.toggle('open');
          if (box.hidden && !box.dataset.loaded) {
            box.hidden = false;
            // 骨架要包在 .skeleton 里才有高度与微光——裸 .sk-line 是个隐形元素，
            // 点击后到数据到达前看起来「毫无反应」
            box.innerHTML = '<div class="skeleton"><div class="sk-line" style="width:60%"></div></div>';
            try {
              const items = await api('/api/cluster/' + tgl.dataset.cluster);
              const selfId = Number(tgl.dataset.self);
              box.innerHTML = items.filter(i => i.id !== selfId).map(i => `
          <div class="cluster-item">
            <a href="${safeUrl(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>
            <span class="ci-meta">${esc(i.source)} · <b class="ci-tier tier-${esc(i.tier)}">${esc(i.tier)}</b> · ${timeAgo(i.publishedAt || i.fetchedAt)}</span>
          </div>`).join('') || '<div class="cluster-item">（无其他报道）</div>';
              box.dataset.loaded = '1';
            } catch { box.innerHTML = '<div class="cluster-item">加载失败</div>'; }
          } else {
            box.hidden = !box.hidden;
          }
          tgl.setAttribute('aria-expanded', String(!box.hidden));
          return;
        }
        const card = e.target.closest('.card');
        if (card && !e.target.closest('a, button')) {
          const expanded = card.classList.toggle('expanded');
          card.querySelector('.dims-toggle')?.setAttribute('aria-expanded', String(expanded));
        }
      });
    }

    return Object.freeze({ loadFeed, loadNextFeedPage, syncFeedToolbar, toggleStar });
  }

  return Object.freeze({ createFeedController });
});
