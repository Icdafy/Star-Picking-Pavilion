'use strict';

/* 摘星阁 · 视图注册表
   阶段 3 批 3 新增：switchView 的 if-else 分发改为查表调度。
   每个视图通过 registerView({ id, tab, onEnter, onLeave }) 注册（tab 为该视图
   面板容器的选择器），新增面板只需一条注册 + 一段 HTML section，组合根不再
   认识具体视图。工厂不直读 window/document：DOM 访问全部经注入的 $ / $$ / document。 */

(function exposeViewRegistry(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.ViewRegistry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createViewRegistryModule() {
  function createViewRegistry(deps = {}) {
    const {
      $, $$, document: doc, state, FEED_VIEWS = [],
      preferenceActions, scrollToTop, refreshStats,
      // 液态玻璃阶段 3（可选）：切换后目标面板的入场动画引擎
      motion
    } = deps;
    if (typeof $ !== 'function' || typeof $$ !== 'function') {
      throw new TypeError('view registry requires $ and $$ query helpers');
    }
    if (state === null || typeof state !== 'object') {
      throw new TypeError('view registry requires a state object');
    }
    const views = new Map();

    // 注册一个视图。isFeed 表示它属于信息流家族（共享 #viewFeed 与筛选条），
    // tab 决定亮哪个面板容器，onEnter/onLeave 在切换前后按序触发。
    function registerView({ id, tab, isFeed = false, onEnter, onLeave } = {}) {
      if (!id || typeof id !== 'string') {
        throw new TypeError('view registration requires a string id');
      }
      views.set(id, { id, tab, isFeed: Boolean(isFeed), onEnter, onLeave });
    }

    // 导航激活块跟随当前标签滑动，切换时是连续位移而不是跳变
    function syncTabIndicator() {
      const active = $('.tab.active');
      const bar = $('.tab-indicator');
      if (!active || !bar) return;
      bar.style.setProperty('--ti-x', `${active.offsetLeft}px`);
      bar.style.setProperty('--ti-y', `${active.offsetTop}px`);
      bar.style.setProperty('--ti-w', `${active.offsetWidth}px`);
      bar.style.setProperty('--ti-h', `${active.offsetHeight}px`);
      bar.style.setProperty('--ti-o', '1');
    }

    // sticky 日期标题与热度栏的偏移量取决于导航条实际高度（换行时会变）
    function syncNavHeight() {
      const nav = $('.nav');
      if (!nav) return;
      doc.documentElement.style.setProperty(
        '--nav-h', `${Math.round(nav.getBoundingClientRect().height)}px`
      );
    }

    function switchView(view, { persist = true } = {}) {
      const entry = views.get(view);
      const previous = views.get(state.view);
      state.view = view;
      if (persist && preferenceActions) preferenceActions.remember('view', view);
      $$('.tab').forEach(t => {
        const on = t.dataset.view === view;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', on);
      });
      syncTabIndicator();
      const isFeed = FEED_VIEWS.includes(view);
      // 查表显隐：只有注册过的面板才动，未注册的视图不亮任何容器
      const panels = new Set();
      for (const candidate of views.values()) {
        if (candidate.tab) panels.add(candidate.tab);
      }
      for (const selector of panels) {
        const panel = $(selector);
        if (panel) panel.hidden = selector !== (entry && entry.tab);
      }
      // 液态玻璃阶段 3：入场动画不再用 animation:none + 强制重排重放，
      // 改由注入的 motion 引擎只对切换后显示的目标面板播一次 fadeSlideIn
      //（transform + opacity，约 260ms）；其余面板不动，reduced 偏好与
      // static 档在引擎内部自动跳过；未注入 motion 时静默退化为无入场动画
      if (entry && entry.tab && motion && typeof motion.fadeSlideIn === 'function') {
        try { motion.fadeSlideIn($(entry.tab), { duration: 260 }); } catch { /* 动画是增强层 */ }
      }
      const filters = $('#feedFilters');
      if (filters) filters.style.display = isFeed ? '' : 'none';
      if (previous && previous !== entry && typeof previous.onLeave === 'function') previous.onLeave();
      if (entry && typeof entry.onEnter === 'function') entry.onEnter();
      if (typeof refreshStats === 'function') refreshStats();
      if (typeof scrollToTop === 'function') scrollToTop();
    }

    // tab 点击 + APG 方向键约定：焦点落在标签上时即选即切
    function wireTabs(navTabs) {
      $$('.tab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));
      if (!navTabs) return;
      navTabs.addEventListener('keydown', event => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        const tabs = $$('.tab');
        const current = tabs.indexOf(doc.activeElement);
        if (current < 0) return;
        const step = event.key === 'ArrowRight' ? 1 : tabs.length - 1;
        const next = tabs[(current + step) % tabs.length];
        next.focus();
        switchView(next.dataset.view);
        event.preventDefault();
      });
    }

    return Object.freeze({ registerView, switchView, wireTabs, syncTabIndicator, syncNavHeight });
  }

  return Object.freeze({ createViewRegistry });
});
