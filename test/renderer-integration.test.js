'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const CommonLinks = require('../renderer/common-links');
const Bootstrap = require('../renderer/bootstrap');
const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
const settingsFormController = fs.readFileSync(
  path.join(root, 'renderer', 'settings-form-controller.js'),
  'utf8'
);
const dailyArchiveController = fs.existsSync(path.join(root, 'renderer', 'daily-archive-controller.js'))
  ? fs.readFileSync(path.join(root, 'renderer', 'daily-archive-controller.js'), 'utf8')
  : '';
const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');

function createStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    values
  };
}

test('常用网址作为摘星阁顶部主导航的原生视图接入', () => {
  assert.match(html, /data-view="links"[^>]*>常用网址<\/button>/);
  assert.match(html, /id="viewLinks"[^>]*class="view"[^>]*hidden/);
  assert.match(html, /云幄\s*·\s*常用网址/);
  assert.match(html, /id="commonLinksCategories"[^>]*tabindex="-1"/);
  assert.match(html, /id="commonLinksGrid"[^>]*tabindex="-1"/);
});

test('领域模块在应用脚本之前加载', () => {
  const domUtilsIndex = html.indexOf('<script src="dom-utils.js"></script>');
  const schemaIndex = html.indexOf('<script src="ui-preference-schema.js"></script>');
  const bootstrapIndex = html.indexOf('<script src="bootstrap.js"></script>');
  const styleIndex = html.indexOf('<link rel="stylesheet" href="styles.css">');
  const moduleIndex = html.indexOf('<script src="common-links.js"></script>');
  const appIndex = html.indexOf('<script src="app.js"></script>');
  assert.ok(schemaIndex >= 0 && schemaIndex < bootstrapIndex);
  assert.ok(bootstrapIndex < styleIndex);
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
  assert.match(app, /view:\s*restoredPreferences\.view.*links/s);
  assert.match(app, /#viewLinks/);
  assert.match(app, /renderCommonLinks/);
  assert.match(app, /commonLinksCategories/);
  assert.match(app, /commonLinksGrid/);
  assert.match(
    fs.readFileSync(path.join(root, 'renderer', 'bootstrap.js'), 'utf8'),
    /commonLinks\.STORAGE_KEY/
  );
  assert.match(app, /writeBrowserUiPreferences/);
  assert.match(app, /class="common-links-open"[^>]*target="_blank"[^>]*rel="noopener"/);
});

test('设置页不接收密钥内容，空输入不会覆盖已保存的密钥', () => {
  assert.doesNotMatch(app, /setApiKey['"]\)\.value\s*=\s*s\.ai\.apiKey/);
  assert.match(settingsFormController, /if \(apiKey\) aiPatch\.apiKey = apiKey/);
  assert.match(settingsFormController, /apiKey:\s*null/);
  assert.match(html, /id="btnClearAiKey"/);
});

test('设置页通过竞态安全控制器加载和保存全部可编辑字段', () => {
  const controllerIndex = html.indexOf('<script src="settings-form-controller.js"></script>');
  const appIndex = html.indexOf('<script src="app.js"></script>');
  assert.ok(controllerIndex >= 0 && controllerIndex < appIndex);
  assert.match(app, /SettingsFormController\.createSettingsFormController/);
  assert.match(app, /settingsForm\.load\(\)/);
  assert.match(app, /settingsForm\.saveAi\(\)/);
  assert.match(app, /settingsForm\.clearApiKey\(\)/);
  assert.match(app, /settingsForm\.saveCollect\(\)/);
});

test('设置页提供可访问的桌面运行开关', () => {
  assert.match(html, /<script src="desktop-settings-controller\.js"><\/script>/);
  assert.match(html, /id="setCloseToTray"[^>]*type="checkbox"[^>]*role="switch"/);
  assert.match(html, /id="setLaunchAtLogin"[^>]*type="checkbox"[^>]*role="switch"/);
  assert.match(html, /id="desktopSettingsResult"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(app, /DesktopSettingsController\.createDesktopSettingsController/);
  assert.match(app, /Desktop\.getDesktopSettings/);
  assert.match(app, /Desktop\.updateDesktopSettings/);
  assert.ok(css.includes('.desktop-switch'));
  assert.ok(css.includes('.switch-track'));
});

test('界面展示后端的安全错误消息并捕获设置保存失败', () => {
  assert.match(app, /const payload = await res\.json\(\)\.catch\(\(\) => null\)/);
  assert.match(app, /throw new Error\(payload\?\.error \|\| `请求失败/);
  assert.match(app, /AI 配置保存失败：/);
  assert.match(app, /采集设置保存失败：/);
  assert.match(app, /清除密钥失败：/);
  assert.match(app, /日报重新生成失败：/);
  assert.match(app, /信源操作失败：/);
  assert.match(app, /反馈保存失败：/);
});

test('日报导航使用本地日历日期而不是 UTC 日期切片', () => {
  assert.match(app, /function localDateString\(date = new Date\(\)\)/);
  assert.doesNotMatch(app, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
});

test('页面脚本全部外置且动态渲染不使用内联事件处理器', () => {
  const scriptTags = [...html.matchAll(/<script\b([^>]*)>/gi)];
  assert.ok(scriptTags.length > 0);
  for (const [, attributes] of scriptTags) assert.match(attributes, /\bsrc="[^"]+"/);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(app, /\son[a-z]+\s*=/i);
});

test('应用使用规范存储键并只迁移有效的旧星标数组', () => {
  assert.match(app, /StarPickingPavilionBootstrap/);
  assert.match(app, /starPickingPavilion\s*\|\|\s*window\.windcatcher/);
  assert.match(app, /resolveInitialUiPreferences\(\{[\s\S]*commonLinks:\s*CommonLinks/);
  assert.match(
    fs.readFileSync(path.join(root, 'renderer', 'bootstrap.js'), 'utf8'),
    /migrateStorage\(\s*storage,\s*commonLinks\.STORAGE_KEY,\s*commonLinks\.LEGACY_STORAGE_KEYS,\s*commonLinks\.isValidFavoriteStorage/
  );
  assert.doesNotMatch(app, /localStorage\.setItem\(['"]wc-(?:theme|realtime)/);
});

test('desktop stored preference snapshot defensively becomes the complete initial UI state', () => {
  const favoriteId = CommonLinks.LINKS[0].id;
  const result = Bootstrap.resolveInitialUiPreferences({
    desktop: {
      hasStoredPreferences: true,
      preferences: {
        theme: 'light',
        textScale: 'xl',
        view: 'links',
        domain: 'aerospace',
        category: '政策',
        dailyDate: '2026-07-22',
        linksCategory: 'AI',
        commonLinksFavorites: [favoriteId, favoriteId, 'missing'],
        realtime: false,
        closeToTray: true,
        q: 'must-not-restore',
        page: 99
      }
    },
    storage: createStorage({ 'wc-theme': 'dark' }),
    commonLinks: CommonLinks,
    today: '2026-07-23'
  });

  assert.deepEqual(result.preferences, {
    theme: 'light',
    textScale: 'xl',
    view: 'links',
    domain: 'aerospace',
    category: '政策',
    dailyDate: '2026-07-22',
    linksCategory: 'AI',
    commonLinksFavorites: [favoriteId],
    realtime: false,
    closeToTray: true
  });
  assert.equal(result.migrationPatch, null);
  assert.equal(Object.hasOwn(result.preferences, 'q'), false);
  assert.equal(Object.hasOwn(result.preferences, 'page'), false);
});

test('desktop without stored preferences creates one complete legacy migration patch', () => {
  const favoriteId = CommonLinks.LINKS[0].id;
  const storage = createStorage({
    'wc-theme': 'light',
    'wc-realtime': 'off',
    'zxg-common-links-favorites': JSON.stringify([favoriteId])
  });
  const result = Bootstrap.resolveInitialUiPreferences({
    desktop: { hasStoredPreferences: false, preferences: { theme: 'dark', realtime: true } },
    storage,
    commonLinks: CommonLinks,
    today: '2026-07-23'
  });

  assert.deepEqual(result.preferences, {
    theme: 'light',
    textScale: 'md',
    view: 'featured',
    domain: '',
    category: '',
    dailyDate: null,
    linksCategory: CommonLinks.ALL_CATEGORY,
    commonLinksFavorites: [favoriteId],
    realtime: false,
    closeToTray: false
  });
  assert.deepEqual(result.migrationPatch, result.preferences);
  assert.notEqual(result.migrationPatch, result.preferences);
});

test('browser preferences restore every meaningful field from one namespaced JSON value', () => {
  const favoriteId = CommonLinks.LINKS[0].id;
  const storedPreferences = {
    theme: 'light',
    textScale: 'lg',
    view: 'daily',
    domain: 'lowaltitude',
    category: '产业',
    dailyDate: '2026-07-22',
    linksCategory: 'AI',
    commonLinksFavorites: [favoriteId],
    realtime: false,
    closeToTray: false
  };
  const result = Bootstrap.resolveInitialUiPreferences({
    desktop: null,
    storage: createStorage({
      [Bootstrap.STORAGE_KEYS.uiPreferences]: JSON.stringify(storedPreferences)
    }),
    commonLinks: CommonLinks,
    today: '2026-07-23'
  });

  assert.deepEqual(result, {
    preferences: storedPreferences,
    migrationPatch: null
  });
});

test('browser preferences safely fall back to all readable legacy selections after corrupt JSON', () => {
  const favoriteId = CommonLinks.LINKS[0].id;
  const result = Bootstrap.resolveInitialUiPreferences({
    desktop: null,
    storage: createStorage({
      [Bootstrap.STORAGE_KEYS.uiPreferences]: '{"theme":',
      'wc-theme': 'light',
      'wc-realtime': 'off',
      'zxg-common-links-favorites': JSON.stringify([favoriteId, favoriteId, 'missing'])
    }),
    commonLinks: CommonLinks,
    today: '2026-07-23'
  });

  assert.deepEqual(result.preferences, {
    theme: 'light',
    textScale: 'md',
    view: 'featured',
    domain: '',
    category: '',
    dailyDate: null,
    linksCategory: CommonLinks.ALL_CATEGORY,
    commonLinksFavorites: [favoriteId],
    realtime: false,
    closeToTray: false
  });
  assert.equal(result.migrationPatch, null);
});

test('production preference actions persist exactly eight minimal patches and ignore invalid or transient input', () => {
  const favoriteId = CommonLinks.LINKS[0].id;
  const persisted = [];
  const persistResults = [];
  const actions = Bootstrap.createUiPreferenceActions({
    commonLinks: CommonLinks,
    persist: patch => {
      persisted.push(patch);
      const result = Promise.resolve(patch);
      persistResults.push(result);
      return result;
    },
    today: () => '2026-07-23'
  });
  const cases = [
    ['theme', 'light', { theme: 'light' }],
    ['view', 'daily', { view: 'daily' }],
    ['domain', 'lowaltitude', { domain: 'lowaltitude' }],
    ['category', '政策', { category: '政策' }],
    ['dailyDate', '2026-07-22', { dailyDate: '2026-07-22' }],
    ['linksCategory', 'AI', { linksCategory: 'AI' }],
    ['commonLinksFavorites', [favoriteId, favoriteId, 'missing'], { commonLinksFavorites: [favoriteId] }],
    ['realtime', false, { realtime: false }]
  ];

  assert.deepEqual(persisted, [], 'constructing actions must not persist during initialization');
  const actionResults = cases.map(([field, value]) => actions.remember(field, value));
  assert.deepEqual(persisted, cases.map(([, , expected]) => expected));
  assert.deepEqual(actionResults, persistResults);

  for (const field of ['q', 'page', 'scrollY', 'expandedCard', 'draft', 'toast']) {
    assert.equal(actions.remember(field, 'transient'), null);
  }
  assert.equal(actions.remember('theme', 'sepia'), null);
  assert.equal(actions.remember('dailyDate', '2026-07-24'), null);
  assert.equal(actions.remember('linksCategory', 'missing'), null);
  assert.deepEqual(persisted, cases.map(([, , expected]) => expected));
});

test('latest request guard rejects an older daily response completed after the latest one', () => {
  const guard = Bootstrap.createLatestRequestGuard();
  const committed = [];
  const older = guard.begin();
  const latest = guard.begin();

  assert.equal(latest.commit(() => committed.push('latest')), true);
  assert.equal(older.commit(() => committed.push('older')), false);
  assert.deepEqual(committed, ['latest']);
});

test('dynamic category repair only persists a missing restored category', () => {
  assert.deepEqual(
    Bootstrap.resolveDynamicCategory('已下线分类', ['政策', '产业']),
    { category: '', patch: { category: '' } }
  );
  assert.deepEqual(
    Bootstrap.resolveDynamicCategory('政策', ['政策', '产业']),
    { category: '政策', patch: null }
  );
  assert.deepEqual(
    Bootstrap.resolveDynamicCategory('', ['政策', '产业']),
    { category: '', patch: null }
  );
});

test('app wires every selection to a minimal patch, skips search view persistence, and does not write on normal startup', () => {
  for (const field of [
    'theme',
    'view',
    'domain',
    'category',
    'dailyDate',
    'linksCategory',
    'commonLinksFavorites',
    'realtime'
  ]) {
    assert.match(app, new RegExp(`preferenceActions\\.remember\\(\\s*'${field}'`));
  }
  assert.match(app, /const preferenceActions = Bootstrap\.createUiPreferenceActions\(/);
  assert.match(app, /const storage = Bootstrap\.getSafeStorage\(window\)/);
  assert.doesNotMatch(app, /storage:\s*localStorage/);
  assert.match(app, /switchView\('all',\s*\{\s*persist:\s*false\s*\}\)/);
  assert.match(app, /applyTheme\(state\.theme,\s*\{\s*persist:\s*false\s*\}\)/);
  assert.match(app, /setRealtime\(state\.realtime,\s*\{\s*persist:\s*false\s*\}\)/);
  assert.match(app, /switchView\(state\.view,\s*\{\s*persist:\s*false\s*\}\)/);
  assert.match(app, /if \(initialPreferences\.migrationPatch\)\s*persistUiPreferences\(initialPreferences\.migrationPatch\)/);
  assert.doesNotMatch(app, /preferenceActions\.remember\(['"](?:q|page|scroll|expanded|draft|toast)/);
  assert.match(app, /if \(FEED_VIEWS\.includes\(state\.view\)\)\s*\{[\s\S]*await initCategories\(\);[\s\S]*switchView\(state\.view,\s*\{\s*persist:\s*false\s*\}\)/);
  assert.match(app, /else\s*\{[\s\S]*switchView\(state\.view,\s*\{\s*persist:\s*false\s*\}\);[\s\S]*initCategories\(\)/);
  assert.match(app, /start\(\)\.catch\(\(\) => toast\('界面初始化失败，请刷新重试', true\)\)/);
});

test('daily loading begins a production request token and guards response and error commits', () => {
  const start = app.indexOf('async function loadDaily');
  const end = app.indexOf('function shiftDaily');
  const source = app.slice(start, end);

  assert.match(source, /const request = dailyRequestGuard\.begin\(\)/);
  assert.match(source, /const data = await api\(/);
  assert.match(source, /if \(!request\.isCurrent\(\)\) return/);
  assert.match(source, /catch \(e\)\s*\{[\s\S]*if \(!request\.isCurrent\(\)\) return/);
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
  const preferencePatches = [];
  const preferenceActions = Bootstrap.createUiPreferenceActions({
    commonLinks: CommonLinks,
    persist: patch => { preferencePatches.push(patch); },
    today: () => '2026-07-23'
  });
  const start = app.indexOf('function renderCommonLinks');
  const end = app.indexOf('// ---------- 视图切换 ----------');
  const install = new Function(
    '$', 'CommonLinks', 'DomUtils', 'state', 'esc', 'safeUrl', 'document',
    'preferenceActions',
    `'use strict';\n${app.slice(start, end)}\nreturn renderCommonLinks;`
  );
  install(
    selector => elements[selector],
    CommonLinks,
    require('../renderer/dom-utils'),
    state,
    value => String(value ?? ''),
    value => String(value ?? ''),
    fakeDocument,
    preferenceActions
  );

  const categoryControl = {
    dataset: { linksCategory: 'AI', focusKey: 'category:AI' }
  };
  listeners['categories:click']({ target: { closest: () => categoryControl } });
  assert.equal(fakeDocument.focusedKey, 'category:AI');
  assert.deepEqual(preferencePatches[0], { linksCategory: 'AI' });

  fakeDocument.focusedKey = null;
  const disappearedFavorite = {
    dataset: { linkFavorite: 'missing-link', focusKey: 'favorite:missing-link' }
  };
  listeners['grid:click']({ target: { closest: () => disappearedFavorite } });
  assert.equal(fakeDocument.focusedKey, null);
  assert.equal(fakeDocument.focusedRegion, 'grid');
  assert.deepEqual(fakeDocument.focusOptions, { preventScroll: true });
  assert.deepEqual(
    preferencePatches[1],
    { commonLinksFavorites: [...CommonLinks.getDefaultFavoriteIds()] }
  );
});

test('常用网址渲染通过共享工具转义文本并限制外链协议', () => {
  assert.match(app, /function esc\(s\)\s*\{\s*return DomUtils\.escapeHTML\(s\);\s*\}/);
  assert.match(app, /const safeUrl = value => esc\(DomUtils\.safeHttpUrl\(value\)\);/);
  assert.match(app, /href="\$\{safeUrl\(item\.url\)\}"/);
});

test('文章、图片、热点、事件簇和日报的远程地址全部通过安全 URL 工具', () => {
  assert.match(app, /const safeUrl = value => esc\(DomUtils\.safeHttpUrl\(value\)\);/);
  assert.match(app, /src="\$\{safeUrl\(item\.image\)\}"/);
  for (const expression of ['item.url', 'it.url', 'i.url']) {
    assert.match(app, new RegExp(`href="\\$\\{safeUrl\\(${expression.replace('.', '\\.') }\\)\\}"`));
  }
});

test('v4 卡片使用领域色条、异步缩略图与样式表托管的日报间距', () => {
  assert.match(
    app,
    /<article class="card\$\{item\.featured \? ' is-featured' : ''\}" data-id="\$\{item\.id\}"\$\{item\.domain \? ` data-domain="\$\{esc\(item\.domain\)\}"` : ''\}/
  );
  assert.match(app, /class="card-thumb"[^>]*loading="lazy"[^>]*decoding="async"/);
  assert.match(app, /<div class="daily-section glass">/);
  assert.doesNotMatch(app, /class="daily-section glass"\s+style=/);
});

test('长信息流与日报跳过离屏渲染但保留固有占位', () => {
  assert.match(
    css,
    /\.card\s*\{[^}]*content-visibility:\s*auto;[^}]*contain-intrinsic-size:\s*auto 14rem;/s
  );
  assert.match(
    css,
    /\.daily-section\s*\{[^}]*content-visibility:\s*auto;[^}]*contain-intrinsic-size:\s*auto 20rem;/s
  );
});

test('信源移除操作明确说明为保留记录的软停用', () => {
  assert.match(app, /移出监控/);
  assert.match(app, /已采集文章和信源记录都会保留/);
  assert.doesNotMatch(app, /确定删除该信源/);
});

test('常用网址沿用 Electron 的安全外链策略', () => {
  const electronMain = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  assert.match(electronMain, /setWindowOpenHandler/);
  assert.match(electronMain, /parsed\.protocol === 'http:' \|\| parsed\.protocol === 'https:'/);
  assert.match(electronMain, /parsed\.username \|\| parsed\.password/);
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
    '@container app (max-width: 45rem)'
  ]) assert.ok(css.includes(selector), `缺少 ${selector}`);
  assert.match(css, /\.common-links-card[\s\S]*var\(--glass-border\)/);
  assert.match(css, /\.common-links-favorite\.is-active[\s\S]*var\(--c-teal\)/);
});

test('信息流重载以最后一次请求为准，加载途中切换筛选不会被丢弃', () => {
  // 旧实现是 `if (state.loading) return;`，会把加载期间的筛选点击静默吞掉
  assert.doesNotMatch(app, /async function loadFeed[\s\S]{0,200}?if \(state\.loading\) return;/);
  assert.match(app, /const feedRequestGuard = Bootstrap\.createLatestRequestGuard\(\);/);
  assert.match(app, /if \(!reset && state\.loading\) return;/);
  assert.match(app, /const request = feedRequestGuard\.begin\(\);/);
  // 过期响应既不能改 DOM，也不能提前解除 loading 标志
  assert.match(app, /const data = await api\('\/api\/feed\?' \+ params\);\s*\n\s*if \(!request\.isCurrent\(\)\) return;/);
  assert.match(app, /if \(request\.isCurrent\(\)\) state\.loading = false;/);
});

test('右侧热度栏同样丢弃过期响应', () => {
  assert.match(app, /const hotRailRequestGuard = Bootstrap\.createLatestRequestGuard\(\);/);
  assert.match(app, /async function loadHotRail[\s\S]{0,400}?if \(!request\.isCurrent\(\)\) return;/);
});

test('信源卡片展示失败退避状态并提供立即重试', () => {
  assert.match(app, /health\.pausedUntil/);
  assert.match(app, /暂停至/);
  assert.match(app, /连续失败 \$\{health\.consecutiveErrors\} 次/);
  assert.match(app, /data-act="retry"/);
  assert.match(app, /\/api\/sources\/\$\{id\}\/retry/);
  assert.ok(css.includes('.src-backoff'), '缺少 .src-backoff 样式');
  assert.ok(css.includes('.src-card.is-failing'), '缺少 .src-card.is-failing 样式');
});

test('设置页提供数据保留配置与本地库体积视图', () => {
  assert.match(html, /id="setRetentionDays"[^>]*type="number"[^>]*min="7"[^>]*max="3650"/);
  assert.match(html, /id="setIrrelevantRetentionDays"[^>]*type="number"[^>]*min="1"[^>]*max="3650"/);
  assert.match(html, /id="btnSaveRetention"/);
  assert.match(html, /id="btnPruneNow"/);
  for (const id of ['msArticles', 'msTotal', 'msExpiring']) {
    assert.ok(html.includes(`id="${id}"`), `缺少统计位 ${id}`);
  }
  assert.match(app, /requestDatabase: \(\) => api\('\/api\/maintenance'\)/);
  assert.match(app, /'\/api\/maintenance\/prune'/);
  assert.match(app, /await settingsForm\.saveRetention\(\)/);
  assert.match(settingsFormController, /RETENTION_FIELD_NAMES/);
  assert.match(settingsFormController, /retentionDays: Number\(elements\.retentionDays\.value\)/);
  assert.ok(css.includes('.maintenance-stats'), '缺少 .maintenance-stats 样式');
});

test('v0.0.12 数据维护面板分离数据库、缓存、迁移残留和旧库操作', () => {
  assert.match(html, /storage-maintenance-controller\.js/);
  for (const id of [
    'msDatabase', 'msReclaimable', 'msCache', 'msMigrationResidue',
    'msLegacy', 'msTotal', 'btnCompactNow', 'btnClearCache',
    'btnDeleteLegacy', 'compactResult', 'cacheResult', 'legacyResult'
  ]) {
    assert.ok(html.includes(`id="${id}"`), `缺少存储治理控件 ${id}`);
  }
  assert.match(app, /StorageMaintenanceController\.createStorageMaintenanceController/);
  assert.match(app, /Desktop\.getStorageSnapshot/);
  assert.match(app, /Desktop\.clearManagedCache/);
  assert.match(app, /Desktop\.deleteLegacyData/);
  assert.ok(css.includes('.storage-breakdown'), '缺少存储明细网格');
  assert.ok(css.includes('.maintenance-action-grid'), '缺少维护操作网格');
});

test('v0.0.13 settings expose the complete daily research archive workflow', () => {
  assert.match(html, /daily-archive-controller\.js/);
  for (const id of [
    'dailyArchiveEnabled',
    'dailyArchivePath',
    'btnChooseDailyArchive',
    'btnSaveDailyArchive',
    'btnRetryDailyArchive',
    'dailyArchiveNextRun',
    'dailyArchiveLastSuccess',
    'dailyArchivePending',
    'dailyArchiveStatus'
  ]) {
    assert.ok(html.includes(`id="${id}"`), `缺少每日归档控件 ${id}`);
  }
  assert.match(html, /id="dailyArchiveEnabled"[^>]*role="switch"/);
  assert.match(html, /id="dailyArchivePath"[^>]*dir="auto"/);
  assert.match(html, /id="dailyArchiveStatus"[^>]*aria-live="polite"/);
  assert.match(app, /DailyArchiveController\.createDailyArchiveController/);
  for (const method of [
    'getDailyArchiveSettings',
    'chooseDailyArchiveDirectory',
    'setDailyArchiveEnabled',
    'saveCurrentDailyArchive',
    'retryDailyArchives'
  ]) {
    assert.match(app, new RegExp(`Desktop\\?\\.${method}|Desktop\\.${method}`));
  }
  assert.match(app, /dailyArchive\?\.load\(\)/);
  assert.match(app, /每日新闻简报自动归档仅在安装版中可用/);
  assert.match(dailyArchiveController, /createDailyArchiveController/);
  assert.match(dailyArchiveController, /aria-busy/);
  assert.match(dailyArchiveController, /pendingDates/);
});

test('technical breakthrough heat boosts are visible and explained with sanitized signals', () => {
  assert.match(app, /breakthroughBonus/);
  assert.match(app, /breakthroughScore/);
  assert.match(app, /breakthroughSignals/);
  assert.match(app, /class="breakthrough-pill"/);
  assert.match(app, /技术突破 <b>\+\$\{breakthrough\.bonus/);
  assert.match(app, /class="breakthrough-explanation"/);
  assert.match(app, /esc\(breakthrough\.explanation\)/);
  assert.ok(css.includes('.breakthrough-pill'), '缺少技术突破徽标样式');
  assert.ok(css.includes('.breakthrough-explanation'), '缺少技术突破说明样式');
});

test('v0.0.14 卡片呈现实体标签与原子事件，实体点击即检索', () => {
  assert.match(app, /class="card-entities"/);
  assert.match(app, /class="card-entity"[^]*?data-entity="\$\{esc\(entity\.name\)\}"/);
  assert.match(app, /class="card-events"/);
  assert.match(app, /原子事件 \$\{list\.length\}/);
  // 原子事件只在真的拆出多件事时展示，单事件卡片不加这一块噪声
  assert.match(app, /if \(list\.length < 2\) return '';/);
  // 词库面板与实体标签共用同一条检索路径，两处不会各写一份
  assert.match(app, /function runTermSearch\(term\)/);
  assert.match(app, /const entityBtn = e\.target\.closest\('\.card-entity'\);/);
  assert.match(app, /runTermSearch\(entityBtn\.dataset\.entity\)/);
  assert.ok(css.includes('.card-entity'), '缺少实体标签样式');
  assert.ok(css.includes('.card-events'), '缺少原子事件样式');
});

test('v0.0.14 设置页只暴露单一分析模型字段', () => {
  assert.match(html, /id="setModel"[^>]*placeholder="deepseek-v4-flash"/);
  assert.doesNotMatch(html, /setPrefilterModel|setScoringModel/);
  // v4-pro 只能作为「已移除」的说明出现，不能再是任何输入框的候选值
  assert.doesNotMatch(html, /(?:placeholder|value)="[^"]*deepseek-v4-pro/);
  assert.match(html, /deepseek-v4-pro 已从本应用移除/);
  assert.match(html, /DeepSeek-V4-Flash-0731/);
  assert.match(app, /model: \$\('#setModel'\)/);
  assert.doesNotMatch(app, /prefilterModel|scoringModel/);
});

test('星标作为一等信息流视图接入导航、筛选与实时轮询', () => {
  assert.match(html, /data-view="starred"[^>]*aria-controls="viewFeed"/);
  assert.match(html, /id="tabStarredCount"/);
  assert.match(app, /const FEED_VIEWS = \['featured', 'hot', 'all', 'starred'\];/);
  // isFeed 必须与轮询、导出共用同一个集合，否则星标视图会拿不到筛选条与增量刷新
  assert.match(app, /const isFeed = FEED_VIEWS\.includes\(view\);/);
  assert.doesNotMatch(app, /\['featured', 'hot', 'all'\]\.includes/);
  assert.ok(css.includes('.tab-count'), '缺少 .tab-count 样式');
});

test('每张卡片都提供星标与复制入口，星标状态可被键盘感知', () => {
  assert.match(app, /data-act="star"/);
  assert.match(app, /data-act="copy"/);
  assert.match(app, /aria-pressed="\$\{item\.starred \? 'true' : 'false'\}"/);
  // 底栏此前只在存在事件簇或五维分时才渲染，那样大部分卡片就没有留存入口
  assert.match(app, /const foot = `<div class="card-foot">\$\{cluster\}\$\{dimsToggle\}\$\{actions\}<\/div>`/);
  assert.match(app, /\/api\/articles\/\$\{id\}\/star/);
  assert.match(app, /星标操作失败：/);
  for (const selector of ['.card-act', '.star-toggle.is-on', '.card-foot-gap']) {
    assert.ok(css.includes(selector), `缺少 ${selector} 样式`);
  }
});

test('星标视图的时间轴按收藏时间分组，不会按发布时间乱序', () => {
  assert.match(app, /const starredTime = item => item\.starredAt \|\| item\.fetchedAt;/);
  assert.match(app, /function renderTimeline\(items, startIdx, timeOf = publishedTime\)/);
  assert.match(app, /const label = dateLabel\(timeOf\(item\)\);/);
  assert.match(app, /renderTimeline\(data\.items, 0, state\.view === 'starred' \? starredTime : publishedTime\)/);
});

test('在星标视图取消星标后整表重载，卡片不会滞留在收藏夹里', () => {
  const source = app.slice(app.indexOf('async function toggleStar'), app.indexOf('// 卡片交互'));
  assert.match(source, /if \(state\.view === 'starred' && !result\.starred\)/);
  assert.match(source, /await loadFeed\(\);/);
});

test('导出走服务端渲染，界面只负责复制或另存为', () => {
  assert.match(app, /await api\('\/api\/export\?' \+ exportParams\(kind, format\)\)/);
  assert.match(app, /navigator\.clipboard\?\.writeText/);
  assert.match(app, /document\.execCommand\('copy'\)/);   // 沙箱内剪贴板不可用时的回退路径
  assert.match(app, /anchor\.download = filename;/);
  assert.match(app, /导出失败：/);
  for (const id of ['btnCopyFeed', 'btnExportFeed', 'btnCopyDaily', 'btnExportDaily']) {
    assert.ok(html.includes(`id="${id}"`), `缺少导出控件 ${id}`);
  }
  assert.ok(css.includes('.copy-scratch'), '缺少剪贴板回退容器样式');
});

test('情报备忘可回看与删除，不再是只写不读', () => {
  assert.match(html, /id="feedbackList"[^>]*aria-live="polite"/);
  assert.match(app, /async function loadFeedback\(\)/);
  assert.match(app, /await api\('\/api\/feedback'\)/);
  assert.match(app, /await api\(`\/api\/feedback\/\$\{id\}`, \{ method: 'DELETE' \}\)/);
  assert.match(app, /备忘删除失败：/);
  assert.ok(css.includes('.note-list'), '缺少 .note-list 样式');
});

test('快捷键随第八个视图扩展，并新增复制当前视图', () => {
  assert.match(app, /const tabIndex = '12345678'\.indexOf\(event\.key\);/);
  assert.match(app, /if \(letter === 'c'\)/);
  assert.match(html, /切换第 1–8 个视图/);
  assert.match(html, /<kbd>Alt<\/kbd><kbd>C<\/kbd>/);
});

test('界面偏好接受星标视图，重启后能回到收藏夹', () => {
  const schema = require('../renderer/ui-preference-schema');
  assert.equal(schema.isValidUiPreferenceValue('view', 'starred', CommonLinks), true);
  assert.deepEqual(
    schema.createUiPreferencePatch('view', 'starred', CommonLinks),
    { view: 'starred' }
  );
  assert.deepEqual(schema.createUiPreferencePatch('view', 'nonsense', CommonLinks), {});
});

test('核心词库面板挂在检索框旁，带库内命中数并且选词即检索', () => {
  // 入口紧贴检索框：面板服务的正是「我该搜什么」这一步
  assert.match(html, /id="btnLexicon"[^>]*aria-expanded="false"[^>]*aria-controls="lexiconPanel"/);
  assert.match(html, /id="lexiconPanel"[^>]*role="dialog"[^>]*hidden/);
  assert.match(html, /id="lexiconFilter"/);
  assert.match(html, /id="lexiconBody"[^>]*aria-live="polite"/);
  for (const scope of ['data-lex-domain=""', 'data-lex-domain="lowaltitude"', 'data-lex-domain="aerospace"']) {
    assert.ok(html.includes(scope), `缺少领域筛选 ${scope}`);
  }
  assert.match(app, /await api\('\/api\/lexicon'\)/);
  assert.match(app, /data-lex-term="\$\{esc\(item\.term\)\}"/);
  assert.match(app, /class="lex-count">\$\{item\.count\}/);
  // 面板上的条数按「全部动态」口径统计，选词后就必须落到同一个视图，
  // 否则在「精选」里检索会看到远少于面板承诺的结果，那个数字立刻不可信
  assert.match(app, /if \(state\.view === 'all'\) loadFeed\(\);\s*\n\s*else switchView\('all', \{ persist: false \}\);/);
  for (const selector of ['.lexicon-panel', '.lexicon-terms', '.lex-term', '.lex-count', '.lex-term.is-empty']) {
    assert.ok(css.includes(selector), `缺少 ${selector} 样式`);
  }
  // 面板是绝对定位的，必须有定位基准，否则会飘到页面左上角
  assert.match(css, /\.tower-actions \{[^}]*position: relative/);
});

test('词库面板抢占 Esc 并有独立快捷键，且点击面板之外会收起', () => {
  const source = app.slice(app.indexOf("if (event.key === 'Escape')"), app.indexOf('if (event.altKey'));
  assert.match(source, /if \(!lexiconPanel\.hidden\) \{[\s\S]*setLexiconOpen\(false\)/);
  assert.match(app, /if \(letter === 'k'\) \{ setLexiconOpen\(lexiconPanel\.hidden\)/);
  assert.match(app, /if \(lexiconPanel\.contains\(event\.target\) \|\| lexiconToggle\.contains\(event\.target\)\) return;/);
});

test('库体积展示对空库和各量级都给出可读结果', () => {
  const source = app.match(/function formatBytes\(bytes\)[\s\S]*?\n\}/)[0];
  const formatBytes = new Function(`${source}\nreturn formatBytes;`)();
  assert.equal(formatBytes(0), '0 MB');
  assert.equal(formatBytes(-5), '0 MB');
  assert.equal(formatBytes(NaN), '0 MB');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(10 * 1024 * 1024), '10.0 MB');
  assert.equal(formatBytes(3 * 1024 * 1024 * 1024), '3.00 GB');
});
