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
    '@media (max-width: 720px)'
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
  for (const id of ['msArticles', 'msSize', 'msExpiring']) {
    assert.ok(html.includes(`id="${id}"`), `缺少统计位 ${id}`);
  }
  assert.match(app, /await api\('\/api\/maintenance'\)/);
  assert.match(app, /'\/api\/maintenance\/prune'/);
  assert.match(app, /await settingsForm\.saveRetention\(\)/);
  assert.match(settingsFormController, /RETENTION_FIELD_NAMES/);
  assert.match(settingsFormController, /retentionDays: Number\(elements\.retentionDays\.value\)/);
  assert.ok(css.includes('.maintenance-stats'), '缺少 .maintenance-stats 样式');
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
