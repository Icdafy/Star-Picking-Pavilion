'use strict';

/* 摘星阁 · 键盘快捷键
   阶段 3 批 2 自 app.js 抽离：Esc（词库面板优先于检索框）、Alt 组合键、
   Ctrl 缩放（排在「是否正在输入」判定之前）、聚焦检索与回顶。
   document、状态与全部动作回调一律走依赖注入。 */

(function exposeShortcuts(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.Shortcuts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createShortcutsModule() {
  function createShortcuts({
    document, state, FEED_VIEWS, getTabs,
    switchView, toggleTheme, stepTextScale, applyTextScale, toast,
    scrollToTop, runExport, clickRefresh,
    searchInput, clearSearch, lexiconPanel, lexiconToggle, setLexiconOpen
  } = {}) {
    if (!document || !state || !Array.isArray(FEED_VIEWS) || typeof getTabs !== 'function'
      || typeof switchView !== 'function' || typeof toggleTheme !== 'function'
      || typeof stepTextScale !== 'function' || typeof applyTextScale !== 'function'
      || typeof toast !== 'function' || typeof scrollToTop !== 'function'
      || typeof runExport !== 'function' || typeof clickRefresh !== 'function'
      || !searchInput || typeof clearSearch !== 'function'
      || !lexiconPanel || !lexiconToggle || typeof setLexiconOpen !== 'function') {
      throw new TypeError('shortcuts requires document, state, FEED_VIEWS and action dependencies');
    }

    function isTypingTarget(element) {
      if (!element) return false;
      const tag = element.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable === true;
    }

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        // 词库面板优先于检索框：面板开着时 Esc 的意思是「收起它」，不是「清空我刚输的词」
        if (!lexiconPanel.hidden) {
          setLexiconOpen(false);
          lexiconToggle.focus();
          event.preventDefault();
          return;
        }
        if (document.activeElement === searchInput) {
          clearSearch();
          searchInput.blur();
          event.preventDefault();
        }
        return;
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        const tabIndex = '12345678'.indexOf(event.key);
        if (tabIndex >= 0) {
          const tab = getTabs()[tabIndex];
          if (tab) { switchView(tab.dataset.view); event.preventDefault(); }
          return;
        }
        const letter = String(event.key).toLowerCase();
        if (letter === 't') { toggleTheme(); event.preventDefault(); return; }
        if (letter === 'r') { clickRefresh(); event.preventDefault(); return; }
        if (letter === 'k') { setLexiconOpen(lexiconPanel.hidden); event.preventDefault(); return; }
        // 复制当前视图：信息流复制列表，日报复制整份日报
        if (letter === 'c') {
          if (FEED_VIEWS.includes(state.view)) runExport('feed', 'text', 'copy');
          else if (state.view === 'daily') runExport('daily', 'text', 'copy');
          event.preventDefault();
          return;
        }
        return;
      }
      // 缩放快捷键放在「是否正在输入」判定之前：Ctrl +/- 是全局手势，
      // 光标停在检索框里时也该管用。
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        if (event.key === '=' || event.key === '+') { stepTextScale(1); event.preventDefault(); return; }
        if (event.key === '-' || event.key === '_') { stepTextScale(-1); event.preventDefault(); return; }
        if (event.key === '0') { applyTextScale('md'); toast('界面缩放：标准'); event.preventDefault(); return; }
      }
      if (isTypingTarget(document.activeElement)) return;
      const focusesSearch = event.key === '/'
        || ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'k');
      if (focusesSearch) {
        searchInput.focus();
        searchInput.select();
        event.preventDefault();
        return;
      }
      if (event.key === 'Home') { scrollToTop(); event.preventDefault(); }
    });

    return Object.freeze({ isTypingTarget });
  }

  return Object.freeze({ createShortcuts });
});
