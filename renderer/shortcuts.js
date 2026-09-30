'use strict';

/* 摘星阁 · 键盘快捷键
   阶段 3 批 2 自 app.js 抽离：Esc（词库面板优先于检索框）、Alt 组合键、
   Ctrl 缩放（排在「是否正在输入」判定之前）、聚焦检索与回顶。
   document、状态与全部动作回调一律走依赖注入。

   v0.2.4 键盘优先层（参照 Linear / Raycast / Vercel 的 ⌘K 范式）：
   - 命令面板：Ctrl+K 在任何位置打开（输入框里也行），ARIA combobox + listbox，
     输入框始终持有焦点，aria-activedescendant 指向高亮项；中文名、拼音全拼、
     拼音首字母与英文别名都能命中，输入任意词可直接落到情报库检索。
   - 跳转序列：先按 G 再按目标键（G F 精选、G H 热点……），1.5 秒内有效。
   - 列表导航：J / K 在卡片间移动焦点，O 或 Enter 打开原文，S 星标，C 复制，E 展开关联。
   面板本身的 DOM 由调用方给出（<dialog>、输入框、列表），这里只做行为。 */

(function exposeShortcuts(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.Shortcuts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createShortcutsModule() {
  // G 之后的第二键 → 视图。字母取英文视图名首字母，与侧栏顺序一致；设置沿用各家通行的逗号。
  const GO_KEYS = Object.freeze({
    f: 'featured', h: 'hot', c: 'capital', a: 'all', s: 'starred',
    d: 'daily', l: 'links', r: 'sources', ',': 'settings'
  });
  const GO_WINDOW_MS = 1500;

  function normalize(text) {
    return String(text ?? '').toLowerCase().replace(/[\s·・\-_/|]+/g, '');
  }

  // 子序列匹配：query 的每个字符按序出现在 text 里即算命中，返回紧凑度分（越紧越高）
  function subsequenceScore(text, query) {
    let from = 0;
    let gaps = 0;
    for (const ch of query) {
      const at = text.indexOf(ch, from);
      if (at < 0) return 0;
      gaps += at - from;
      from = at + 1;
    }
    return Math.max(1, 30 - gaps);
  }

  // 单个命令对查询词的得分：名称全等 > 名称前缀 > 别名前缀（拼音 / 首字母 / 英文）
  // > 名称包含 > 别名包含 > 子序列。0 表示不命中。
  function scoreCommand(command, query) {
    const q = normalize(query);
    if (!q) return 1;
    const label = normalize(command.label);
    const aliases = (command.aliases || []).map(normalize).filter(Boolean);
    if (label === q) return 1000;
    if (label.startsWith(q)) return 800 - label.length;
    if (aliases.some(alias => alias === q)) return 700;
    if (aliases.some(alias => alias.startsWith(q))) return 600;
    if (label.includes(q)) return 500 - label.indexOf(q);
    if (aliases.some(alias => alias.includes(q))) return 400;
    const fuzzy = Math.max(subsequenceScore(label, q), ...aliases.map(alias => subsequenceScore(alias, q)));
    return fuzzy ? 100 + fuzzy : 0;
  }

  // 纯函数：按得分排序并保留分组原序作为次序键；空查询时最近用过的排在最前。
  function rankCommands(commands, query, recent = []) {
    const q = normalize(query);
    const scored = [];
    commands.forEach((command, index) => {
      if (command.available && command.available() === false) return;
      const score = scoreCommand(command, q);
      if (score > 0) scored.push({ command, score, index });
    });
    if (!q) {
      const recentRank = new Map(recent.map((id, i) => [id, i]));
      return scored
        .sort((a, b) => a.index - b.index)
        .map(({ command }) => (recentRank.has(command.id) ? { ...command, group: '最近使用', recentIndex: recentRank.get(command.id) } : command))
        .sort((a, b) => (a.recentIndex ?? Infinity) - (b.recentIndex ?? Infinity));
    }
    return scored.sort((a, b) => b.score - a.score || a.index - b.index).map(({ command }) => command);
  }

  function createCommandPalette({
    document, dialog, input, list, getCommands, onSearch, storage, recentKey = 'spp.palette.recent'
  } = {}) {
    if (!document || !dialog || !input || !list || typeof getCommands !== 'function') {
      throw new TypeError('command palette requires document, dialog, input, list and getCommands');
    }
    let items = [];
    let active = 0;
    let recent = [];
    try {
      const saved = JSON.parse(storage?.getItem(recentKey) || '[]');
      if (Array.isArray(saved)) recent = saved.filter(id => typeof id === 'string').slice(0, 5);
    } catch { /* 偏好是增强层，读不到就当没有 */ }

    function remember(id) {
      if (!id || id === 'search') return;
      recent = [id, ...recent.filter(entry => entry !== id)].slice(0, 5);
      try { storage?.setItem(recentKey, JSON.stringify(recent)); } catch { /* 同上 */ }
    }

    function buildItems(query) {
      const ranked = rankCommands(getCommands(), query, recent);
      const text = String(query ?? '').trim();
      if (text && typeof onSearch === 'function') {
        const search = { id: 'search', group: '检索', label: `在情报库中检索「${text}」`, hint: 'Enter', run: () => onSearch(text) };
        // 没有命令命中时检索排第一，否则垫在命令之后：输入词本身就是最常见的意图
        return ranked.length ? [...ranked, search] : [search];
      }
      return ranked;
    }

    function optionId(index) {
      return `palette-opt-${index}`;
    }

    function render() {
      list.textContent = '';
      let group = null;
      items.forEach((command, index) => {
        if (command.group && command.group !== group) {
          group = command.group;
          const head = document.createElement('li');
          head.setAttribute('role', 'presentation');
          head.className = 'palette-group';
          head.textContent = group;
          list.appendChild(head);
        }
        const option = document.createElement('li');
        option.id = optionId(index);
        option.setAttribute('role', 'option');
        option.className = 'palette-option';
        option.dataset.index = String(index);
        option.setAttribute('aria-selected', String(index === active));
        const label = document.createElement('span');
        label.className = 'palette-label';
        label.textContent = command.label;
        option.appendChild(label);
        if (command.detail) {
          const detail = document.createElement('span');
          detail.className = 'palette-detail';
          detail.textContent = command.detail;
          option.appendChild(detail);
        }
        const keys = command.keys || (command.hint ? [command.hint] : []);
        if (keys.length) {
          const kbd = document.createElement('span');
          kbd.className = 'palette-keys';
          kbd.setAttribute('aria-hidden', 'true');
          for (const key of keys) {
            const cap = document.createElement('kbd');
            cap.textContent = key;
            kbd.appendChild(cap);
          }
          option.appendChild(kbd);
        }
        list.appendChild(option);
      });
      if (!items.length) {
        const none = document.createElement('li');
        none.setAttribute('role', 'presentation');
        none.className = 'palette-empty';
        none.textContent = '没有匹配的命令';
        list.appendChild(none);
      }
      syncActive();
    }

    function syncActive() {
      const options = list.querySelectorAll('[role="option"]');
      options.forEach(option => option.setAttribute('aria-selected', String(Number(option.dataset.index) === active)));
      if (items.length) {
        input.setAttribute('aria-activedescendant', optionId(active));
        const current = list.querySelector(`#${optionId(active)}`);
        current?.scrollIntoView?.({ block: 'nearest' });
      } else input.removeAttribute('aria-activedescendant');
    }

    function refresh() {
      items = buildItems(input.value);
      active = 0;
      render();
    }

    function move(delta) {
      if (!items.length) return;
      active = (active + delta + items.length) % items.length;
      syncActive();
    }

    function runAt(index) {
      const command = items[index];
      if (!command) return;
      close();
      remember(command.id);
      // 关闭后再执行：切视图、开别的对话框都不该与面板的焦点归还打架
      try { command.run(); } catch { /* 单个命令失败不拖垮面板 */ }
    }

    let returnFocus = null;
    function open(query = '') {
      if (dialog.open) {
        input.select?.();
        return;
      }
      returnFocus = document.activeElement;
      input.value = query;
      refresh();
      dialog.showModal();
      input.focus();
      input.setAttribute('aria-expanded', 'true');
    }

    function close() {
      if (!dialog.open) return;
      dialog.close();
    }

    dialog.addEventListener('close', () => {
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      const target = returnFocus;
      returnFocus = null;
      // close 事件是异步派发的：命令若已把焦点交给别处（检索框、某张卡片），就不再抢回来
      const current = document.activeElement;
      const focusIsLoose = !current || current === document.body || dialog.contains?.(current);
      if (focusIsLoose && target && typeof target.focus === 'function' && document.contains?.(target) !== false) {
        try { target.focus({ preventScroll: true }); } catch { /* 焦点归还是尽力而为 */ }
      }
    });

    input.addEventListener('input', refresh);
    input.addEventListener('keydown', event => {
      if (event.isComposing) return; // 中文输入法选词时的方向键 / 回车不归面板
      if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')) { move(1); event.preventDefault(); return; }
      if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')) { move(-1); event.preventDefault(); return; }
      if (event.key === 'PageDown') { move(5); event.preventDefault(); return; }
      if (event.key === 'PageUp') { move(-5); event.preventDefault(); return; }
      if (event.key === 'Enter') { runAt(active); event.preventDefault(); }
    });
    list.addEventListener('pointermove', event => {
      const option = event.target.closest?.('[role="option"]');
      if (!option) return;
      const index = Number(option.dataset.index);
      if (index !== active) { active = index; syncActive(); }
    });
    list.addEventListener('click', event => {
      const option = event.target.closest?.('[role="option"]');
      if (option) runAt(Number(option.dataset.index));
    });
    // 点在对话框留白（::backdrop）上即关闭
    dialog.addEventListener('click', event => {
      if (event.target === dialog) close();
    });

    return Object.freeze({
      open,
      close,
      isOpen: () => Boolean(dialog.open),
      toggle: query => (dialog.open ? close() : open(query))
    });
  }

  function createShortcuts({
    document, state, FEED_VIEWS, getTabs,
    switchView, toggleTheme, stepTextScale, applyTextScale, toast,
    scrollToTop, runExport, clickRefresh,
    searchInput, clearSearch, lexiconPanel, lexiconToggle, setLexiconOpen,
    palette, getNavItems, now = () => Date.now()
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

    // —— 列表导航：J / K 在当前视图的条目间移动焦点 ——
    function navItems() {
      if (typeof getNavItems !== 'function') return [];
      try { return Array.from(getNavItems() || []); } catch { return []; }
    }
    function currentNavIndex(items) {
      const focused = document.activeElement;
      if (!focused) return -1;
      return items.findIndex(item => item === focused || item.contains?.(focused));
    }
    function focusNav(delta) {
      const items = navItems();
      if (!items.length) return false;
      const current = currentNavIndex(items);
      const next = current < 0 ? (delta > 0 ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, current + delta));
      const item = items[next];
      if (!item.hasAttribute?.('tabindex')) item.setAttribute?.('tabindex', '-1');
      item.focus?.({ preventScroll: true });
      item.scrollIntoView?.({ block: 'center', behavior: 'auto' });
      return true;
    }
    // 对焦点所在条目执行动作：按选择器找到条目里的控件并点击
    function actOnFocused(selector) {
      const items = navItems();
      const index = currentNavIndex(items);
      if (index < 0) return false;
      const control = items[index].querySelector?.(selector);
      if (!control) return false;
      control.click();
      return true;
    }

    let goPendingAt = -Infinity;

    document.addEventListener('keydown', event => {
      // Ctrl+K：命令面板优先（输入框里也可唤起，与各家 ⌘K 一致）；未接入面板时退回聚焦检索
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
        && String(event.key).toLowerCase() === 'k' && palette) {
        palette.toggle();
        event.preventDefault();
        return;
      }
      // 面板开着时，键盘归面板（Esc 由 <dialog> 自己的 cancel 处理）
      if (palette && palette.isOpen()) return;
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
      if (event.key === 'Home') { scrollToTop(); event.preventDefault(); return; }
      // 以下单键只在无修饰键时生效，免得抢走系统与浏览器的组合键
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat && !/^[jk]$/i.test(event.key)) return;
      const key = String(event.key).toLowerCase();
      if (now() - goPendingAt <= GO_WINDOW_MS) {
        goPendingAt = -Infinity;
        const view = GO_KEYS[key];
        if (view && getTabs().some(tab => tab.dataset.view === view)) {
          switchView(view);
          event.preventDefault();
        }
        return;
      }
      if (key === 'g') { goPendingAt = now(); event.preventDefault(); return; }
      if (key === '?' && palette) { palette.open(''); event.preventDefault(); return; }
      if (key === 'j') { if (focusNav(1)) event.preventDefault(); return; }
      if (key === 'k') { if (focusNav(-1)) event.preventDefault(); return; }
      // Enter 只在焦点落在条目本身时代为打开原文；落在条目里的按钮上时交给按钮自己
      const focusedIsItem = navItems().includes(document.activeElement);
      if (key === 'o' || (key === 'enter' && focusedIsItem)) {
        if (actOnFocused('.card-title, .hot-title a')) event.preventDefault();
        return;
      }
      if (key === 's') { if (actOnFocused('[data-act="star"]')) event.preventDefault(); return; }
      if (key === 'c') { if (actOnFocused('[data-act="copy"]')) event.preventDefault(); return; }
      if (key === 'e') { if (actOnFocused('.cluster-toggle, [data-act="story"], .dims-toggle')) event.preventDefault(); }
    });

    return Object.freeze({ isTypingTarget });
  }

  return Object.freeze({ createShortcuts, createCommandPalette, rankCommands, scoreCommand, GO_KEYS });
});
