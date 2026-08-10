'use strict';

/* 摘星阁 · 右侧热度栏
   阶段 3 批 2 自 app.js 抽离：骨架、热度行模板、轮询轮次的逐行更新与
   竞态守卫下的整栏加载。api/state/转义工具/守卫一律走依赖注入。 */

(function exposeHotRailController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.HotRailController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHotRailControllerModule() {
  function createHotRailController({
    api, state, esc, safeUrl, safeHttpUrl, timeAgo, hotRailRequestGuard, elements
  } = {}) {
    if (typeof api !== 'function' || !state
      || typeof esc !== 'function' || typeof safeUrl !== 'function'
      || typeof safeHttpUrl !== 'function' || typeof timeAgo !== 'function'
      || !hotRailRequestGuard || !elements?.list) {
      throw new TypeError('hot rail controller requires api, state, esc, safeUrl, safeHttpUrl, timeAgo, hotRailRequestGuard and elements.list dependencies');
    }
    const box = elements.list;

    function hotRailSkeletons() {
      return Array.from({ length: 3 }, () => `
    <div class="hot-item skeleton" aria-hidden="true">
      <span class="hi-rank sk-line" style="width:1.2rem"></span>
      <span><span class="sk-line" style="width:88%"></span><span class="sk-line" style="width:52%;height:.625rem"></span></span>
    </div>`).join('');
    }

    // 热度行模板：首屏整段构建与后续补行共用，字段与逐行更新（syncHotRailRow）保持一致
    function hotItemTemplate(it, i, silent) {
      return `
      <a class="hot-item" href="${safeUrl(it.url)}" target="_blank" rel="noopener" title="${esc(it.title)}"${silent ? ' style="animation:none"' : ` style="animation-delay:${Math.min(i, 9) * 40}ms"`}>
        <span class="hi-rank">${i + 1}</span>
        <span>
          <span class="hi-title">${esc(it.title)}</span>
          <span class="hi-meta">
            <span class="hi-heat">${Math.round(it.heat ?? 0)}°</span>
            ${it.clusterSize > 1 ? `<span>${it.clusterSize} 篇关联报道</span>` : `<span>${esc(it.source)}</span>`}
            <span>${timeAgo(it.publishedAt || it.fetchedAt)}</span>
          </span>
        </span>
      </a>`;
    }

    // 轮询轮次的逐行更新：复用现有行节点，只改 textContent 与链接属性，
    // 不整段重渲染、不重放入场动画
    function syncHotRailRow(row, it, i) {
      row.setAttribute('href', safeHttpUrl(it.url));
      row.setAttribute('title', it.title);
      row.querySelector('.hi-rank').textContent = String(i + 1);
      row.querySelector('.hi-title').textContent = it.title;
      const meta = row.querySelector('.hi-meta');
      meta.children[0].textContent = `${Math.round(it.heat ?? 0)}°`;
      meta.children[1].textContent = it.clusterSize > 1 ? `${it.clusterSize} 篇关联报道` : it.source;
      meta.children[2].textContent = timeAgo(it.publishedAt || it.fetchedAt);
    }

    // 首屏先给骨架占位，别让右栏空白地等响应；之后的轮询原地逐行更新
    async function loadHotRail() {
      const request = hotRailRequestGuard.begin();
      if (!box.dataset.painted) box.innerHTML = hotRailSkeletons();
      try {
        const params = new URLSearchParams({ view: 'hot', page: 0 });
        if (state.domain) params.set('domain', state.domain);
        const data = await api('/api/feed?' + params);
        if (!request.isCurrent()) return;
        const top = data.items.slice(0, 10);
        if (!top.length) { box.innerHTML = '<div class="hot-rail-sub">暂无热点</div>'; return; }
        const firstPaint = !box.dataset.painted;
        box.dataset.painted = '1';
        if (firstPaint) {
          box.innerHTML = top.map((it, i) => hotItemTemplate(it, i, false)).join('');
          return;
        }
        const rows = [...box.querySelectorAll('.hot-item')];
        if (!rows.length) {
          // 上一轮是「暂无热点」空态：没有可复用的行节点，静默重建一次
          box.innerHTML = top.map((it, i) => hotItemTemplate(it, i, true)).join('');
          return;
        }
        top.forEach((it, i) => {
          if (rows[i]) syncHotRailRow(rows[i], it, i);
          else box.insertAdjacentHTML('beforeend', hotItemTemplate(it, i, true));
        });
        for (const extra of rows.slice(top.length)) extra.remove();
      } catch { if (request.isCurrent()) box.innerHTML = ''; }
    }

    return Object.freeze({ hotRailSkeletons, hotItemTemplate, syncHotRailRow, loadHotRail });
  }

  return Object.freeze({ createHotRailController });
});
