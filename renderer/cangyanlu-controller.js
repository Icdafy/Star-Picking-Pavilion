'use strict';

/* 摘星阁 · 藏言录模块（v0.3.0）
   藏言录是独立开发的单文件提示词仓库，随包原样附带，由主进程以固定来源
   cangyanlu://app 在专属分区里提供（见 electron/cangyanlu.js）。这里只负责三件事：
   首次进入时挂载 <webview>、把它铺满工作区剩余高度、加载失败或进程退出时给出重试。
   藏言录自己的界面、数据与快捷键都留在它的文档里；工厂不直读 window/document，全部注入。 */

(function exposeCangyanluController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.CangyanluController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCangyanluControllerModule() {
  const SOURCE = 'cangyanlu://app/';
  const PARTITION = 'persist:cangyanlu';
  // Chromium 主动中止上一次导航（重新载入时常见），不算失败
  const ERR_ABORTED = -3;

  function createCangyanluController({
    document: doc, window: win, view, host, viewport, desktop, getPinned, observe = []
  } = {}) {
    if (!doc || !win || !view || !host || !viewport) {
      throw new TypeError('cangyanlu controller requires document, window, view, host and viewport dependencies');
    }
    const status = host.querySelector('[data-cyl-status]');
    const title = host.querySelector('[data-cyl-title]');
    const note = host.querySelector('[data-cyl-note]');
    const retry = host.querySelector('[data-cyl-retry]');
    let frame = null;
    let pendingMeasure = 0;
    let resizeObserver = null;

    function setStatus(state, heading = '', detail = '') {
      host.dataset.state = state;
      if (!status) return;
      status.hidden = state === 'ready';
      if (title) title.textContent = heading;
      if (note) note.textContent = detail;
      if (retry) retry.hidden = state !== 'error';
    }

    function mount() {
      if (frame) return frame;
      // 浏览器开发模式（npm run server）没有桌面壳，也就没有藏言录的固定来源与本地分区
      if (!desktop?.isElectron) {
        setStatus('unavailable', '藏言录需在摘星阁桌面版中使用', '提示词保存在桌面版的本地分区里，浏览器开发模式不加载这个模块。');
        return null;
      }
      frame = doc.createElement('webview');
      frame.className = 'cyl-frame';
      // 分区必须先于地址写入：webview 一旦开始导航就不能再换分区
      frame.setAttribute('partition', PARTITION);
      frame.setAttribute('allowpopups', '');
      frame.setAttribute('aria-label', '藏言录 · 提示词仓库');
      frame.addEventListener('dom-ready', () => setStatus('ready'));
      frame.addEventListener('did-fail-load', event => {
        if (event.isMainFrame === false || event.errorCode === ERR_ABORTED) return;
        setStatus('error', '藏言录没有载入', `${event.errorDescription || '加载失败'}，可以重新载入。`);
      });
      frame.addEventListener('render-process-gone', () => {
        setStatus('error', '藏言录意外退出', '提示词都已保存在本机，重新载入即可继续。');
      });
      frame.setAttribute('src', SOURCE);
      setStatus('loading', '正在展开藏言录…');
      host.appendChild(frame);
      return frame;
    }

    // 从视图顶端量到视口底端。用 offsetTop 链而不是包围盒：入场动画的 transform 不改变落点。
    function viewTop() {
      let top = 0;
      for (let node = view; node && node !== viewport; node = node.offsetParent) {
        top += node.offsetTop || 0;
        if (!node.offsetParent && node !== viewport) {
          return view.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
        }
      }
      return top;
    }

    // 吸顶的塔台（宽屏）或导航（窄屏）始终留在视口顶端：藏言录从它下方开始，一直铺到视口底端。
    // 窄屏顶部还叠着品牌与塔台，进入时把视口滚到藏言录紧贴吸顶导航的位置，让出整块高度。
    function measure({ align = false } = {}) {
      pendingMeasure = 0;
      if (view.hidden) return;
      const px = value => Number.parseFloat(value) || 0;
      const main = view.parentElement;
      const padding = main ? px(win.getComputedStyle(main).paddingBottom) : 0;
      const top = viewTop();
      const pinned = typeof getPinned === 'function' ? getPinned() : null;
      let start = top;
      if (pinned) {
        const style = win.getComputedStyle(pinned);
        start = Math.min(top, px(style.top) + pinned.offsetHeight + px(style.marginBottom));
      }
      view.style.setProperty('--cyl-h', `${Math.max(0, Math.floor(viewport.clientHeight - start - padding))}px`);
      if (align) viewport.scrollTop = Math.max(0, top - start);
    }

    function scheduleMeasure() {
      if (pendingMeasure || view.hidden) return;
      pendingMeasure = win.requestAnimationFrame(() => measure());
    }

    function enter() {
      mount();
      measure({ align: true });
      if (!resizeObserver && typeof win.ResizeObserver === 'function') {
        resizeObserver = new win.ResizeObserver(scheduleMeasure);
        [viewport, ...observe].filter(Boolean).forEach(node => resizeObserver.observe(node));
      }
    }

    function reload() {
      if (!frame) return;
      setStatus('loading', '正在重新载入藏言录…');
      frame.reload();
    }

    retry?.addEventListener('click', reload);
    win.addEventListener('resize', scheduleMeasure);

    return Object.freeze({ enter, measure, reload, getFrame: () => frame });
  }

  return Object.freeze({ createCangyanluController, SOURCE, PARTITION });
});
