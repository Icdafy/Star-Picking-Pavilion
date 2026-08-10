'use strict';

/* 摘星阁 · 常用网址视图控制器
   阶段 3 批 4 自 app.js 抽离：renderCommonLinks 整段模板与分类/常用两组
   点击接线。重渲染会把控件整个替换掉，键盘焦点靠 data-focus-key 标记 +
   DomUtils.restoreFocusByKey 归还到同一控制项（或退到稳定区域）。
   工厂不直读 window/document：$、document 与 CommonLinks/DomUtils 全部注入。 */

(function exposeCommonLinksController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.CommonLinksController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCommonLinksControllerModule() {
  function createCommonLinksController({
    $, document: doc, state, esc, safeUrl,
    commonLinks: CommonLinks, domUtils: DomUtils,
    preferenceActions, elements
  } = {}) {
    if (typeof $ !== 'function' || !state || typeof esc !== 'function'
      || typeof safeUrl !== 'function' || !CommonLinks || !DomUtils
      || !preferenceActions || !elements?.categories || !elements?.grid) {
      throw new TypeError('common links controller requires $, state, esc, safeUrl, commonLinks, domUtils, preferenceActions and elements dependencies');
    }
    const categories = elements.categories;
    const grid = elements.grid;
    const count = elements.count;

    function renderCommonLinks(focusKey, fallbackTarget) {
      const cats = CommonLinks.getCategories();
      categories.innerHTML = cats.map(category => `
    <button class="common-links-category${category === state.linksCategory ? ' is-active' : ''}"
      data-links-category="${esc(category)}" data-focus-key="category:${esc(category)}" type="button"
      aria-pressed="${category === state.linksCategory}">${esc(category)}</button>
  `).join('');

      const items = CommonLinks.filterAndSortLinks({
        category: state.linksCategory,
        favoriteIds: state.commonLinksFavorites
      });
      if (count) count.textContent = String(items.length);
      grid.innerHTML = items.map((item, index) => `
    <article class="common-links-card glass" style="animation-delay:${Math.min(index * 28, 280)}ms">
      <div class="common-links-card-head">
        <div>
          <span class="common-links-label">${esc(item.category)}</span>
          <h3>${esc(item.name)}</h3>
        </div>
        <button class="common-links-favorite${item.isFavorite ? ' is-active' : ''}"
          data-link-favorite="${esc(item.id)}" data-focus-key="favorite:${esc(item.id)}" type="button"
          aria-pressed="${item.isFavorite}" title="${item.isFavorite ? '取消常用' : '设为常用'}">
          <span aria-hidden="true">${item.isFavorite ? '★' : '☆'}</span>
          ${item.isFavorite ? '已常用' : '设为常用'}
        </button>
      </div>
      <p>${esc(item.description)}</p>
      <div class="common-links-tags">${item.tags.map(tag => `<span>${esc(tag)}</span>`).join('')}</div>
      <a class="common-links-open" href="${safeUrl(item.url)}" target="_blank" rel="noopener">打开 <span aria-hidden="true">↗</span></a>
    </article>
  `).join('');
      DomUtils.restoreFocusByKey(doc, focusKey, fallbackTarget);
    }

    categories.addEventListener('click', event => {
      const button = event.target.closest('button[data-links-category]');
      if (!button) return;
      const focusKey = button.dataset.focusKey;
      state.linksCategory = button.dataset.linksCategory;
      preferenceActions.remember('linksCategory', state.linksCategory);
      renderCommonLinks(focusKey, categories);
    });

    grid.addEventListener('click', event => {
      const button = event.target.closest('button[data-link-favorite]');
      if (!button) return;
      const focusKey = button.dataset.focusKey;
      const id = button.dataset.linkFavorite;
      if (state.commonLinksFavorites.has(id)) state.commonLinksFavorites.delete(id);
      else state.commonLinksFavorites.add(id);
      preferenceActions.remember(
        'commonLinksFavorites',
        [...state.commonLinksFavorites]
      );
      renderCommonLinks(focusKey, grid);
    });

    return Object.freeze({ renderCommonLinks });
  }

  return Object.freeze({ createCommonLinksController });
});
