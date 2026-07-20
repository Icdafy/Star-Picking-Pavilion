'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const CommonLinks = require('../renderer/common-links');
const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');

test('常用网址作为摘星阁顶部主导航的原生视图接入', () => {
  assert.match(html, /data-view="links"[^>]*>常用网址<\/button>/);
  assert.match(html, /id="viewLinks"[^>]*class="view"[^>]*hidden/);
  assert.match(html, /云幄\s*·\s*常用网址/);
  assert.match(html, /id="commonLinksCategories"[^>]*tabindex="-1"/);
  assert.match(html, /id="commonLinksGrid"[^>]*tabindex="-1"/);
});

test('领域模块在应用脚本之前加载', () => {
  const domUtilsIndex = html.indexOf('<script src="dom-utils.js"></script>');
  const moduleIndex = html.indexOf('<script src="common-links.js"></script>');
  const appIndex = html.indexOf('<script src="app.js"></script>');
  assert.ok(domUtilsIndex >= 0);
  assert.ok(moduleIndex > domUtilsIndex);
  assert.ok(moduleIndex >= 0);
  assert.ok(appIndex > moduleIndex);
});

test('页面声明可由现有静态路由提供的摘星阁图标', () => {
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/);
  const favicon = fs.readFileSync(path.join(root, 'renderer', 'favicon.svg'), 'utf8');
  assert.match(favicon, /^<svg[^>]*aria-label="摘星阁"/);
});

test('视图切换、分类、星标和持久化均接入 app.js', () => {
  assert.match(app, /view:\s*'featured'.*links/s);
  assert.match(app, /#viewLinks/);
  assert.match(app, /renderCommonLinks/);
  assert.match(app, /commonLinksCategories/);
  assert.match(app, /commonLinksGrid/);
  assert.match(app, /CommonLinks\.STORAGE_KEY/);
  assert.match(app, /localStorage\.setItem/);
  assert.match(app, /class="common-links-open"[^>]*target="_blank"[^>]*rel="noopener"/);
});

test('应用使用规范存储键并只迁移有效的旧星标数组', () => {
  assert.match(app, /StarPickingPavilionBootstrap/);
  assert.match(app, /starPickingPavilion\s*\|\|\s*window\.windcatcher/);
  assert.match(app, /migrateStorage\(localStorage,\s*CommonLinks\.STORAGE_KEY,\s*CommonLinks\.LEGACY_STORAGE_KEYS,\s*CommonLinks\.isValidFavoriteStorage\)/);
  assert.doesNotMatch(app, /localStorage\.setItem\(['"]wc-(?:theme|realtime)/);
});

test('常用网址重渲染后将键盘焦点恢复到同一控制项', () => {
  assert.match(app, /const DomUtils = window\.DomUtils;/);
  assert.match(app, /data-focus-key="category:\$\{esc\(category\)\}"/);
  assert.match(app, /data-focus-key="favorite:\$\{esc\(item\.id\)\}"/);
  assert.match(
    app,
    /function renderCommonLinks\(focusKey, fallbackTarget\)\s*\{/
  );
  assert.match(app, /DomUtils\.restoreFocusByKey\(document, focusKey, fallbackTarget\);\s*\}/);
  assert.match(
    app,
    /const focusKey = button\.dataset\.focusKey;[\s\S]*renderCommonLinks\(focusKey, \$\('#commonLinksCategories'\)\);/
  );
  assert.match(
    app,
    /const focusKey = button\.dataset\.focusKey;[\s\S]*renderCommonLinks\(focusKey, \$\('#commonLinksGrid'\)\);/
  );
});

test('点击控件的 focus key 被显式传入渲染并恢复到替换控件或稳定区域', () => {
  const listeners = {};
  const makeRegion = name => ({
    innerHTML: '',
    textContent: '',
    addEventListener(type, listener) { listeners[`${name}:${type}`] = listener; },
    focus(options) {
      fakeDocument.focusedRegion = name;
      fakeDocument.focusOptions = options;
    }
  });
  const categories = makeRegion('categories');
  const grid = makeRegion('grid');
  const count = makeRegion('count');
  const elements = {
    '#commonLinksCategories': categories,
    '#commonLinksGrid': grid,
    '#commonLinksCount': count
  };
  const fakeDocument = {
    focusedKey: null,
    focusedRegion: null,
    querySelectorAll() {
      const markup = `${categories.innerHTML}${grid.innerHTML}`;
      return [...markup.matchAll(/data-focus-key="([^"]+)"/g)].map(match => ({
        getAttribute: name => name === 'data-focus-key' ? match[1] : null,
        focus: () => { fakeDocument.focusedKey = match[1]; }
      }));
    }
  };
  const state = {
    linksCategory: CommonLinks.ALL_CATEGORY,
    commonLinksFavorites: CommonLinks.getDefaultFavoriteIds()
  };
  const start = app.indexOf('function renderCommonLinks');
  const end = app.indexOf('// ---------- 视图切换 ----------');
  const install = new Function(
    '$', 'CommonLinks', 'DomUtils', 'state', 'esc', 'document', 'persistCommonLinkFavorites',
    `'use strict';\n${app.slice(start, end)}\nreturn renderCommonLinks;`
  );
  install(
    selector => elements[selector],
    CommonLinks,
    require('../renderer/dom-utils'),
    state,
    value => String(value ?? ''),
    fakeDocument,
    () => {}
  );

  const categoryControl = {
    dataset: { linksCategory: 'AI', focusKey: 'category:AI' }
  };
  listeners['categories:click']({ target: { closest: () => categoryControl } });
  assert.equal(fakeDocument.focusedKey, 'category:AI');

  fakeDocument.focusedKey = null;
  const disappearedFavorite = {
    dataset: { linkFavorite: 'missing-link', focusKey: 'favorite:missing-link' }
  };
  listeners['grid:click']({ target: { closest: () => disappearedFavorite } });
  assert.equal(fakeDocument.focusedKey, null);
  assert.equal(fakeDocument.focusedRegion, 'grid');
  assert.deepEqual(fakeDocument.focusOptions, { preventScroll: true });
});

test('常用网址渲染通过共享工具转义文本并限制外链协议', () => {
  assert.match(app, /function esc\(s\)\s*\{\s*return DomUtils\.escapeHTML\(s\);\s*\}/);
  assert.match(app, /href="\$\{esc\(DomUtils\.safeHttpUrl\(item\.url\)\)\}"/);
});

test('常用网址沿用 Electron 的安全外链策略', () => {
  const electronMain = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  assert.match(electronMain, /setWindowOpenHandler/);
  assert.match(electronMain, /\^https\?:/);
  assert.match(electronMain, /shell\.openExternal\(url\)/);
  assert.match(electronMain, /return \{ action: 'deny' \}/);
});

test('常用网址沿用摘星阁主题并具备响应式和交互状态', () => {
  for (const selector of [
    '.common-links-head',
    '.common-links-categories',
    '.common-links-grid',
    '.common-links-card',
    '.common-links-favorite.is-active',
    '.common-links-open',
    '@media (max-width: 720px)'
  ]) assert.ok(css.includes(selector), `缺少 ${selector}`);
  assert.match(css, /\.common-links-card[\s\S]*var\(--glass-border\)/);
  assert.match(css, /\.common-links-favorite\.is-active[\s\S]*var\(--c-teal\)/);
});
