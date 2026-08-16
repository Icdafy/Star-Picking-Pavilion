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
// 阶段 3 批 1：纯函数拆入独立 UMD 模块，原对 app.js 的字面断言同批迁到
// 新模块源码上（契约内容不变，只换落点）
const formatUtilsSource = fs.readFileSync(path.join(root, 'renderer', 'format-utils.js'), 'utf8');
const feedCardSource = fs.readFileSync(path.join(root, 'renderer', 'feed-card.js'), 'utf8');
// 阶段 3 批 2：功能控制器抽离。loadFeed/日报/信源/检索/快捷键/
// 实时轮询/导出/设置接线分别迁入独立 UMD 模块，被移动的字面断言同批改指
// 新模块源码，契约内容（文案、API 路径、竞态守卫语义）不变
const feedControllerSource = fs.readFileSync(path.join(root, 'renderer', 'feed-controller.js'), 'utf8');
const dailyViewSource = fs.readFileSync(path.join(root, 'renderer', 'daily-view-controller.js'), 'utf8');
const sourcesControllerSource = fs.readFileSync(path.join(root, 'renderer', 'sources-controller.js'), 'utf8');
const searchControllerSource = fs.readFileSync(path.join(root, 'renderer', 'search-controller.js'), 'utf8');
const shortcutsSource = fs.readFileSync(path.join(root, 'renderer', 'shortcuts.js'), 'utf8');
const realtimePollerSource = fs.readFileSync(path.join(root, 'renderer', 'realtime-poller.js'), 'utf8');
const exportControllerSource = fs.readFileSync(path.join(root, 'renderer', 'export-controller.js'), 'utf8');
const settingsViewSource = fs.readFileSync(path.join(root, 'renderer', 'settings-view-controller.js'), 'utf8');
// 阶段 3 批 3：状态层与视图查表调度。switchView 的 if-else 分发改为
// view-registry 查表，isFeed 计算随之迁出；组合根保留 switchView 透传与
// 7 视图注册，FEED_VIEWS 常量仍留在 app.js
const storeSource = fs.readFileSync(path.join(root, 'renderer', 'store.js'), 'utf8');
const viewRegistrySource = fs.readFileSync(path.join(root, 'renderer', 'view-registry.js'), 'utf8');
const aquaShellSource = fs.readFileSync(path.join(root, 'renderer', 'aqua-shell.js'), 'utf8');
// 阶段 3 批 4：切片执行函数迁移。renderCommonLinks 与两段接线迁入
// common-links-controller.js，toggleStar 与 #feedList 点击委托迁入
// feed-controller.js；原对 app.js 的切片/new Function 断言同批改为
// require 新模块的行为级断言
const commonLinksControllerSource = fs.readFileSync(path.join(root, 'renderer', 'common-links-controller.js'), 'utf8');
const settingsFormController = fs.readFileSync(
  path.join(root, 'renderer', 'settings-form-controller.js'),
  'utf8'
);
const dailyArchiveController = fs.existsSync(path.join(root, 'renderer', 'daily-archive-controller.js'))
  ? fs.readFileSync(path.join(root, 'renderer', 'daily-archive-controller.js'), 'utf8')
  : '';
const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');
const AQUA_DEFAULTS = Object.freeze({
  aquaMode: 'mica',
  aquaBlur: 2,
  aquaFrost: 20,
  aquaHue: 220,
  aquaBrightness: 50,
  aquaBackground: 'fluid',
  aquaWallpaperBlur: 0,
  aquaWallpaperFrost: 0,
  aquaWhale: true,
  aquaCritters: true
});
const AQUA_NON_DEFAULTS = Object.freeze({
  aquaMode: 'compat',
  aquaBlur: 0,
  aquaFrost: 100,
  aquaHue: 360,
  aquaBrightness: 0,
  aquaBackground: 'wallpaper',
  aquaWallpaperBlur: 40,
  aquaWallpaperFrost: 100,
  aquaWhale: false,
  aquaCritters: false
});

function createStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    values
  };
}

test('常用网址作为摘星阁顶部主导航的原生视图接入', () => {
  assert.match(html, /data-view="links"[^>]*>[\s\S]*?常用网址<\/button>/);
  assert.match(html, /id="viewLinks"[^>]*class="view"[^>]*hidden/);
  assert.match(html, /云幄\s*·\s*常用网址/);
  assert.match(html, /id="commonLinksCategories"[^>]*tabindex="-1"/);
  assert.match(html, /id="commonLinksGrid"[^>]*tabindex="-1"/);
});

test('宽屏指挥栏保留七视图语义，并为每个导航项提供内联 SVG 图标', () => {
  assert.match(html, /<aside class="command-rail glass"[^>]*aria-label="摘星阁指挥栏">/);
  const navStart = html.indexOf('<nav class="nav"');
  const navEnd = html.indexOf('</nav>', navStart);
  assert.ok(navStart >= 0 && navEnd > navStart, '缺少独立主导航结构');
  const navigation = html.slice(navStart, navEnd);
  const buttons = [...navigation.matchAll(/<button class="tab(?: active)?" data-view="([^"]+)"[\s\S]*?<\/button>/g)];
  assert.deepEqual(
    buttons.map(match => match[1]),
    ['featured', 'all', 'starred', 'daily', 'links', 'sources', 'settings']
  );
  for (const [markup, view] of buttons.map(match => [match[0], match[1]])) {
    assert.match(markup, /<span class="tab-glyph" aria-hidden="true"><svg viewBox="0 0 20 20">[\s\S]*?(?:<path|<circle)/, `${view} 缺少可继承主题色的 SVG 图标`);
  }
  assert.doesNotMatch(navigation, /<img\b|data:image\//i, '导航图标必须保持内联、无外部资源依赖');
});

test('领域模块在应用脚本之前加载', () => {
  const domUtilsIndex = html.indexOf('<script src="dom-utils.js"></script>');
  const schemaIndex = html.indexOf('<script src="ui-preference-schema.js"></script>');
  const bootstrapIndex = html.indexOf('<script src="bootstrap.js"></script>');
  const styleIndex = html.indexOf('<link rel="stylesheet" href="styles.css">');
  const aquaStyleIndex = html.indexOf('<link rel="stylesheet" href="aqua-shell.css">');
  const moduleIndex = html.indexOf('<script src="common-links.js"></script>');
  const aquaIndex = html.indexOf('<script src="aqua-shell.js"></script>');
  const appIndex = html.indexOf('<script src="app.js"></script>');
  assert.ok(schemaIndex >= 0 && schemaIndex < bootstrapIndex);
  assert.ok(bootstrapIndex < styleIndex);
  assert.ok(aquaStyleIndex > styleIndex, 'Aqua 增强样式必须在基础样式之后覆盖令牌');
  assert.ok(domUtilsIndex >= 0);
  assert.ok(moduleIndex > domUtilsIndex);
  assert.ok(moduleIndex >= 0);
  assert.ok(aquaIndex > moduleIndex && aquaIndex < appIndex, 'Aqua UMD 必须先于组合根加载');
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
  // 批 4：外链模板随常用网址控制器迁出
  assert.match(commonLinksControllerSource, /class="common-links-open"[^>]*target="_blank"[^>]*rel="noopener"/);
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
  // 批 2：设置页接线迁入 renderer/settings-view-controller.js，断言改指新模块
  assert.match(settingsViewSource, /SettingsFormController\.createSettingsFormController/);
  assert.match(settingsViewSource, /settingsForm\.load\(\)/);
  assert.match(settingsViewSource, /settingsForm\.saveAi\(\)/);
  assert.match(settingsViewSource, /settingsForm\.clearApiKey\(\)/);
  assert.match(settingsViewSource, /settingsForm\.saveCollect\(\)/);
});

test('设置页提供可访问的桌面运行开关', () => {
  assert.match(html, /<script src="desktop-settings-controller\.js"><\/script>/);
  assert.match(html, /id="setCloseToTray"[^>]*type="checkbox"[^>]*role="switch"/);
  assert.match(html, /id="setLaunchAtLogin"[^>]*type="checkbox"[^>]*role="switch"/);
  assert.match(html, /id="desktopSettingsResult"[^>]*role="status"[^>]*aria-live="polite"/);
  // 批 2：桌面运行开关接线随设置视图控制器迁出
  assert.match(settingsViewSource, /DesktopSettingsController\.createDesktopSettingsController/);
  assert.match(settingsViewSource, /Desktop\.getDesktopSettings/);
  assert.match(settingsViewSource, /Desktop\.updateDesktopSettings/);
  assert.ok(css.includes('.desktop-switch'));
  assert.ok(css.includes('.switch-track'));
});

test('界面展示后端的安全错误消息并捕获设置保存失败', () => {
  assert.match(app, /const payload = await res\.json\(\)\.catch\(\(\) => null\)/);
  assert.match(app, /throw new Error\(payload\?\.error \|\| `请求失败/);
  // 批 2：错误 toast 随各自控制器迁移，断言改指对应模块源码
  assert.match(settingsViewSource, /AI 配置保存失败：/);
  assert.match(settingsViewSource, /采集设置保存失败：/);
  assert.match(settingsViewSource, /清除密钥失败：/);
  assert.match(dailyViewSource, /日报重新生成失败：/);
  assert.match(sourcesControllerSource, /信源操作失败：/);
  assert.match(settingsViewSource, /反馈保存失败：/);
});

test('日报导航使用本地日历日期而不是 UTC 日期切片', () => {
  // localDateString 已随批 1 迁到 renderer/format-utils.js
  assert.match(formatUtilsSource, /function localDateString\(date = new Date\(\)\)/);
  assert.doesNotMatch(formatUtilsSource, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
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
        ...AQUA_NON_DEFAULTS,
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
    ...AQUA_NON_DEFAULTS,
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
    ...AQUA_DEFAULTS,
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
    version: 2,
    theme: 'light',
    textScale: 'lg',
    ...AQUA_NON_DEFAULTS,
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
  const { version: _version, ...expectedPreferences } = storedPreferences;

  assert.deepEqual(result, {
    preferences: expectedPreferences,
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
    ...AQUA_DEFAULTS,
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

test('production preference actions persist all Aqua values as minimal patches and ignore invalid or transient input', () => {
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
    ['aquaMode', 'compat', { aquaMode: 'compat' }],
    ['aquaBlur', 0, { aquaBlur: 0 }],
    ['aquaFrost', 100, { aquaFrost: 100 }],
    ['aquaHue', 360, { aquaHue: 360 }],
    ['aquaBrightness', 0, { aquaBrightness: 0 }],
    ['aquaBackground', 'wallpaper', { aquaBackground: 'wallpaper' }],
    ['aquaWallpaperBlur', 40, { aquaWallpaperBlur: 40 }],
    ['aquaWallpaperFrost', 100, { aquaWallpaperFrost: 100 }],
    ['aquaWhale', false, { aquaWhale: false }],
    ['aquaCritters', false, { aquaCritters: false }],
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
  assert.equal(actions.remember('aquaMode', 'glass'), null);
  assert.equal(actions.remember('aquaBlur', -Number.EPSILON), null);
  assert.equal(actions.remember('aquaFrost', 100.000001), null);
  assert.equal(actions.remember('aquaHue', Number.POSITIVE_INFINITY), null);
  assert.equal(actions.remember('aquaBrightness', '50'), null);
  assert.equal(actions.remember('aquaBackground', 'video'), null);
  assert.equal(actions.remember('aquaWallpaperBlur', Number.NaN), null);
  assert.equal(actions.remember('aquaWallpaperFrost', -1), null);
  assert.equal(actions.remember('aquaWhale', 1), null);
  assert.equal(actions.remember('aquaCritters', 'false'), null);
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
  // 批 2：dailyDate 的 remember 随日报控制器迁出，realtime 随实时轮询器迁出，
  // 其余字段仍由组合根持久化；检索视图切换（persist:false）随检索控制器迁出
  // 批 3：view 的 remember 随 switchView 查表调度迁到 renderer/view-registry.js
  // 批 4：linksCategory/commonLinksFavorites 的 remember 随常用网址接线迁到
  // renderer/common-links-controller.js
  for (const field of [
    'theme',
    'domain',
    'category'
  ]) {
    assert.match(app, new RegExp(`preferenceActions\\.remember\\(\\s*'${field}'`));
  }
  assert.match(viewRegistrySource, /preferenceActions\.remember\(\s*'view'/);
  assert.match(commonLinksControllerSource, /preferenceActions\.remember\(\s*'linksCategory'/);
  // 评审修复轮：锚点从纯字符串匹配改回 remember 调用形态，锁定收藏集
  // 确实经偏好持久化路径写回（调用在 common-links-controller.js 中实际存在）
  assert.match(commonLinksControllerSource, /preferenceActions\.remember\(\s*'commonLinksFavorites'/);
  assert.match(dailyViewSource, /preferenceActions\.remember\(\s*'dailyDate'/);
  assert.match(realtimePollerSource, /preferenceActions\.remember\('realtime', on\)/);
  assert.match(app, /const preferenceActions = Bootstrap\.createUiPreferenceActions\(/);
  assert.match(app, /const storage = Bootstrap\.getSafeStorage\(window\)/);
  assert.doesNotMatch(app, /storage:\s*localStorage/);
  assert.match(searchControllerSource, /switchView\('all',\s*\{\s*persist:\s*false\s*\}\)/);
  assert.match(app, /applyTheme\(state\.theme,\s*\{\s*persist:\s*false\s*\}\)/);
  assert.match(app, /setRealtime\(state\.realtime,\s*\{\s*persist:\s*false\s*\}\)/);
  assert.match(app, /switchView\(state\.view,\s*\{\s*persist:\s*false\s*\}\)/);
  assert.match(app, /if \(initialPreferences\.migrationPatch\)\s*persistUiPreferences\(initialPreferences\.migrationPatch\)/);
  assert.doesNotMatch(app, /preferenceActions\.remember\(['"](?:q|page|scroll|expanded|draft|toast)/);
  assert.match(app, /if \(FEED_VIEWS\.includes\(state\.view\)\)\s*\{[\s\S]*await initCategories\(\);[\s\S]*switchView\(state\.view,\s*\{\s*persist:\s*false\s*\}\)/);
  assert.match(app, /else\s*\{[\s\S]*switchView\(state\.view,\s*\{\s*persist:\s*false\s*\}\);[\s\S]*initCategories\(\)/);
  assert.match(app, /start\(\)\.catch\(\(\) => toast\('界面初始化失败，请刷新重试', true\)\)/);
});

test('Aqua 外观实验室完整接入恢复、控件、最小持久化与本机壁纸边界', () => {
  for (const [id, min, max] of [
    ['setAquaBlur', 0, 40],
    ['setAquaFrost', 0, 100],
    ['setAquaHue', 0, 360],
    ['setAquaBrightness', 0, 100],
    ['setAquaWallpaperBlur', 0, 40],
    ['setAquaWallpaperFrost', 0, 100]
  ]) {
    assert.match(
      html,
      new RegExp(`id="${id}" type="range" min="${min}" max="${max}" step="1"`),
      `${id} 缺少与共享 schema 一致的边界`
    );
  }
  assert.match(html, /data-aqua-mode="mica"[^>]*aria-pressed="true"/);
  assert.match(html, /data-aqua-mode="compat"[^>]*aria-pressed="false"/);
  assert.match(html, /data-aqua-background="fluid"[^>]*aria-pressed="true"/);
  assert.match(html, /data-aqua-background="wallpaper"[^>]*aria-pressed="false"/);
  assert.match(html, /id="setAquaWhale" type="checkbox" role="switch" checked/);
  assert.match(html, /id="setAquaCritters" type="checkbox" role="switch" checked/);
  assert.match(html, /class="wallpaper-file-input" id="setAquaWallpaper" type="file" accept="image\/png,image\/jpeg,image\/webp"/);
  assert.doesNotMatch(html, /id="setAquaWallpaper"[^>]*\bhidden\b/, '壁纸文件控件必须可由键盘聚焦');
  assert.match(html, /id="btnAquaWallpaperClear"[^>]*type="button"/);
  assert.match(html, /id="btnAquaReset"[^>]*type="button"/);
  assert.match(html, /id="aquaPalettePresets"[^>]*role="group"[^>]*aria-label="当前主题的流体配色预设"/);
  assert.match(aquaShellSource, /const FLUID_PALETTES = Object\.freeze\(\{[\s\S]*?light:[\s\S]*?dark:/);
  assert.match(aquaShellSource, /palettePresets\.replaceChildren\(fragment\)/);
  assert.match(aquaShellSource, /listen\(palettePresets, 'click',[\s\S]*?update\('aquaHue', hue\);[\s\S]*?update\('aquaBrightness', brightness\);[\s\S]*?flushPersist\(\)/);

  for (const field of Object.keys(AQUA_DEFAULTS)) {
    assert.match(app, new RegExp(`${field}: restoredPreferences\\.${field}`));
  }
  assert.match(app, /const aquaShell = AquaShell\.createAquaShell\(\{[\s\S]*?storage,[\s\S]*?preferences: restoredPreferences,[\s\S]*?persist: persistUiPreferences,[\s\S]*?onChange: patch => store\.setState\(patch\)/);
  assert.match(app, /pagehide['"], \(\) => aquaShell\.dispose\(\), \{ once: true \}/);

  assert.match(aquaShellSource, /const FIELDS = Object\.freeze\(Object\.keys\(DEFAULTS\)\)/);
  assert.match(aquaShellSource, /pendingPatch\[field\] = state\[field\]/);
  assert.match(aquaShellSource, /return Promise\.resolve\(persist\(patch\)\)/);
  assert.match(aquaShellSource, /const WALLPAPER_KEY = 'star-picking-pavilion\.aqua-wallpaper\.v1'/);
  assert.match(aquaShellSource, /writeStorage\(storage, WALLPAPER_KEY, dataUrl \|\| ''\)/);
  assert.match(aquaShellSource, /wallpaperWriteQueue = task\.then\(\(\) => undefined, \(\) => undefined\)/);
  assert.match(aquaShellSource, /field === 'aquaBackground' && next\.aquaBackground !== 'wallpaper'[\s\S]{0,100}?wallpaperRequest \+= 1/);
  assert.match(aquaShellSource, /writeWallpaperAsset\(previousWallpaper\)\.catch\(\(\) => \{\}\)/);
  assert.match(aquaShellSource, /navigation\?\.setAttribute\('aria-orientation', vertical \? 'vertical' : 'horizontal'\)/);
});

test('Aqua 氛围层位于根画布之上、应用外壳之下，Canvas 不会画在不可见层', () => {
  const aquaCss = fs.readFileSync(path.join(root, 'renderer', 'aqua-shell.css'), 'utf8');
  assert.match(aquaCss, /\.atmosphere\s*\{[\s\S]*?z-index:\s*0;[\s\S]*?pointer-events:\s*none;/);
  assert.match(aquaCss, /\.app-stage\s*\{[\s\S]*?position:\s*relative;[\s\S]*?z-index:\s*1;/);
  assert.match(aquaCss, /\.aqua-fluid-canvas[\s\S]*?display:\s*block;/);
});

test('daily loading begins a production request token and guards response and error commits', () => {
  // 批 2：loadDaily/shiftDaily 迁入 renderer/daily-view-controller.js，
  // 切片断言改指新模块源码，守卫变量名（dailyRequestGuard）保持不变
  const start = dailyViewSource.indexOf('async function loadDaily');
  const end = dailyViewSource.indexOf('function shiftDaily');
  const source = dailyViewSource.slice(start, end);

  assert.match(source, /const request = dailyRequestGuard\.begin\(\)/);
  assert.match(source, /const \[data\] = await Promise\.all\(\[\s*api\(/);
  assert.match(source, /if \(!request\.isCurrent\(\)\) return/);
  assert.match(source, /catch \(e\)\s*\{[\s\S]*if \(!request\.isCurrent\(\)\) return/);
});

test('常用网址重渲染后将键盘焦点恢复到同一控制项', () => {
  assert.match(app, /const DomUtils = window\.DomUtils;/);
  // 批 4：renderCommonLinks 模板与两段接线迁到 renderer/common-links-controller.js，
  // 焦点恢复契约（data-focus-key + restoreFocusByKey）随之改指新模块；
  // 重渲染后 fallback 直接传已持有的区域元素，不再重新查一次 DOM
  assert.match(commonLinksControllerSource, /data-focus-key="category:\$\{esc\(category\)\}"/);
  assert.match(commonLinksControllerSource, /data-focus-key="favorite:\$\{esc\(item\.id\)\}"/);
  assert.match(
    commonLinksControllerSource,
    /function renderCommonLinks\(focusKey, fallbackTarget\)\s*\{/
  );
  assert.match(commonLinksControllerSource, /DomUtils\.restoreFocusByKey\(doc, focusKey, fallbackTarget\);\s*\}/);
  assert.match(
    commonLinksControllerSource,
    /const focusKey = button\.dataset\.focusKey;[\s\S]*renderCommonLinks\(focusKey, categories\);/
  );
  assert.match(
    commonLinksControllerSource,
    /const focusKey = button\.dataset\.focusKey;[\s\S]*renderCommonLinks\(focusKey, grid\);/
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
  // 批 4：renderCommonLinks 与两段接线已迁到 renderer/common-links-controller.js，
  // 不再从 app.js 切片 + new Function，改为 require 新模块后以同一套假依赖
  // 驱动工厂，行为断言原样保留
  const { createCommonLinksController } = require('../renderer/common-links-controller');
  createCommonLinksController({
    $: selector => elements[selector],
    document: fakeDocument,
    state,
    esc: value => String(value ?? ''),
    safeUrl: value => String(value ?? ''),
    commonLinks: CommonLinks,
    domUtils: require('../renderer/dom-utils'),
    preferenceActions,
    elements: { categories, grid, count }
  });

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
  // 批 4：外链 href 模板随常用网址控制器迁出
  assert.match(commonLinksControllerSource, /href="\$\{safeUrl\(item\.url\)\}"/);
});

test('文章、图片、事件簇和日报的远程地址全部通过安全 URL 工具', () => {
  assert.match(app, /const safeUrl = value => esc\(DomUtils\.safeHttpUrl\(value\)\);/);
  // 阶段 4：缩略图 src 随卡片模板迁到 renderer/feed-card.js，改经
  // safeHttpUrl 过闸后字段级填充（行为断言见 test/feed-diff.test.js）
  assert.match(feedCardSource, /const thumbSrc = safeHttpUrl\(item\.image\);/);
  assert.match(feedCardSource, /thumb\.setAttribute\('src', thumbSrc\);/);
  // 批 4：事件簇 i.url 留在 feed-controller，常用网址 item.url 随控制器迁出
  assert.match(feedControllerSource, /href="\$\{safeUrl\(i\.url\)\}"/);
  assert.match(commonLinksControllerSource, /href="\$\{safeUrl\(item\.url\)\}"/);
  // 批 2：日报模板里的 it.url 随控制器迁出，断言改指新模块
  assert.match(dailyViewSource, /href="\$\{safeUrl\(it\.url\)\}"/);
});

test('v4 卡片使用领域色条、异步缩略图与样式表托管的日报间距', () => {
  // 阶段 4：整卡模板迁为 index.html 的 <template id="cardTemplate">，
  // 原对 app.js 字符串模板的字面断言改指模板本体与填充行为
  assert.match(html, /<template id="cardTemplate">[\s\S]*?<article class="card" data-id="">/);
  assert.match(html, /class="card-thumb"[^>]*loading="lazy"[^>]*decoding="async"/);
  // is-featured / data-domain 由渲染器字段级填充（行为断言见 test/feed-diff.test.js）
  assert.match(feedCardSource, /card\.classList\.add\('is-featured'\)/);
  assert.match(feedCardSource, /card\.setAttribute\('data-domain', String\(item\.domain\)\)/);
  // 批 2：日报模板随日报视图控制器迁出
  assert.match(dailyViewSource, /<div class="daily-section glass">/);
  assert.doesNotMatch(dailyViewSource, /class="daily-section glass"\s+style=/);
});

test('长信息流与日报跳过离屏渲染但保留固有占位', () => {
  // 阶段 4 窗口化校准结论：实测卡片高度与 auto 18rem 占位无明显偏离，锁定值不动
  assert.match(
    css,
    /\.card\s*\{[^}]*content-visibility:\s*auto;[^}]*contain-intrinsic-size:\s*auto 18rem;/s
  );
  assert.match(
    css,
    /\.daily-section\s*\{[^}]*content-visibility:\s*auto;[^}]*contain-intrinsic-size:\s*auto 20rem;/s
  );
});

test('sticky 日期分组头在 .card 之外，不受卡片 content-visibility 包含影响', () => {
  // 窗口化校准验证：.date-head 自带 sticky 规则且自身不挂 content-visibility；
  // 渲染结构上 date-head 是 date-group 的直接子节点、与 .card 平级之外，
  // 天然不被卡片的 contain 影响——天然满足，不改样式，只加验证
  const dateHeadRule = css.match(/\.date-head\s*\{[^}]*\}/);
  assert.ok(dateHeadRule, '缺少 .date-head 规则');
  assert.match(dateHeadRule[0], /position:\s*sticky/);
  assert.doesNotMatch(dateHeadRule[0], /content-visibility/);
  assert.doesNotMatch(css, /\.date-group\s*\{[^}]*content-visibility/s);
  assert.match(css, /\.date-head-glass\s*\{[^}]*background:\s*var\(--glass-bg-soft\);[^}]*backdrop-filter:/s);
  assert.match(css, /--sticky-top:\s*calc\(var\(--desktop-titlebar-height, 32px\)/);
  // 分组外壳在 feed-card.js 里生成：date-group > date-head，卡片另行挂载
  assert.match(feedCardSource, /group\.setAttribute\('class', 'date-group'\)/);
  assert.match(feedCardSource, /head\.setAttribute\('class', 'date-head'\)/);
  assert.match(feedCardSource, /glass\.setAttribute\('class', 'date-head-glass'\)/);
});

test('信源移除操作明确说明为保留记录的软停用', () => {
  // 批 2：信源文案随信源控制器迁出
  assert.match(sourcesControllerSource, /移出监控/);
  assert.match(sourcesControllerSource, /已采集文章和信源记录都会保留/);
  assert.doesNotMatch(sourcesControllerSource, /确定删除该信源/);
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
  // 批 2：loadFeed 迁入 renderer/feed-controller.js，断言改指新模块源码；
  // 守卫仍在组合根创建并注入，变量名（feedRequestGuard）保持不变
  assert.doesNotMatch(feedControllerSource, /async function loadFeed[\s\S]{0,200}?if \(state\.loading\) return;/);
  assert.match(app, /const feedRequestGuard = Bootstrap\.createLatestRequestGuard\(\);/);
  assert.match(feedControllerSource, /if \(!reset && state\.loading\) return;/);
  assert.match(feedControllerSource, /const request = feedRequestGuard\.begin\(\);/);
  // 过期响应既不能改 DOM，也不能提前解除 loading 标志
  assert.match(feedControllerSource, /const \[data\] = await Promise\.all\(\[\s*api\('\/api\/feed\?' \+ params\),[\s\S]{0,120}?\]\);\s*\n\s*if \(!request\.isCurrent\(\)\) return;/);
  // 骨架屏有最短驻留：本地接口毫秒级返回时，骨架不该只是一闪而过的噪点
  // 批 1：SKELETON_MIN_MS 迁到 renderer/format-utils.js
  assert.match(formatUtilsSource, /const SKELETON_MIN_MS = \d+;/);
  assert.match(feedControllerSource, /if \(request\.isCurrent\(\)\) state\.loading = false;/);
});

test('信源卡片展示失败退避状态并提供立即重试', () => {
  // 批 2：信源卡片模板与重试路由随信源控制器迁出
  assert.match(sourcesControllerSource, /health\.pausedUntil/);
  assert.match(sourcesControllerSource, /暂停至/);
  assert.match(sourcesControllerSource, /连续失败 \$\{health\.consecutiveErrors\} 次/);
  assert.match(sourcesControllerSource, /data-act="retry"/);
  assert.match(sourcesControllerSource, /\/api\/sources\/\$\{id\}\/retry/);
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
  // 批 2：存储治理与保留设置接线随设置视图控制器迁出
  assert.match(settingsViewSource, /requestDatabase: \(\) => api\('\/api\/maintenance'\)/);
  assert.match(settingsViewSource, /'\/api\/maintenance\/prune'/);
  assert.match(settingsViewSource, /await settingsForm\.saveRetention\(\)/);
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
  // 批 2：存储治理控制器装配随设置视图控制器迁出
  assert.match(settingsViewSource, /StorageMaintenanceController\.createStorageMaintenanceController/);
  assert.match(settingsViewSource, /Desktop\.getStorageSnapshot/);
  assert.match(settingsViewSource, /Desktop\.clearManagedCache/);
  assert.match(settingsViewSource, /Desktop\.deleteLegacyData/);
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
  // 批 2：每日归档装配随设置视图控制器迁出
  assert.match(settingsViewSource, /DailyArchiveController\.createDailyArchiveController/);
  for (const method of [
    'getDailyArchiveSettings',
    'chooseDailyArchiveDirectory',
    'setDailyArchiveEnabled',
    'saveCurrentDailyArchive',
    'retryDailyArchives'
  ]) {
    assert.match(settingsViewSource, new RegExp(`Desktop\\?\\.${method}|Desktop\\.${method}`));
  }
  assert.match(settingsViewSource, /dailyArchive\?\.load\(\)/);
  assert.match(settingsViewSource, /每日新闻简报自动归档仅在安装版中可用/);
  assert.match(dailyArchiveController, /createDailyArchiveController/);
  assert.match(dailyArchiveController, /aria-busy/);
  assert.match(dailyArchiveController, /pendingDates/);
});

test('technical breakthrough heat boosts are visible and explained with sanitized signals', () => {
  // 批 1：breakthroughPresentation 迁到 renderer/feed-card.js，字段名断言改指新模块
  assert.match(feedCardSource, /breakthroughBonus/);
  assert.match(feedCardSource, /breakthroughScore/);
  assert.match(feedCardSource, /breakthroughSignals/);
  // 阶段 4：徽标与依据的构建器随 cardInner 同批迁入 feed-card.js
  assert.match(feedCardSource, /class="breakthrough-pill"/);
  assert.match(feedCardSource, /技术突破 <b>\+\$\{breakthrough\.bonus/);
  assert.match(feedCardSource, /class="breakthrough-explanation"/);
  assert.match(feedCardSource, /esc\(breakthrough\.explanation\)/);
  assert.ok(css.includes('.breakthrough-pill'), '缺少技术突破徽标样式');
  assert.ok(css.includes('.breakthrough-explanation'), '缺少技术突破说明样式');
});

test('v0.0.14 卡片呈现实体标签与原子事件，实体点击即检索', () => {
  // 批 1：entityChipsHtml/atomicEventsHtml 迁到 renderer/feed-card.js
  assert.match(feedCardSource, /class="card-entities"/);
  assert.match(feedCardSource, /class="card-entity"[^]*?data-entity="\$\{esc\(entity\.name\)\}"/);
  assert.match(feedCardSource, /class="card-events"/);
  assert.match(feedCardSource, /原子事件 \$\{list\.length\}/);
  // 原子事件只在真的拆出多件事时展示，单事件卡片不加这一块噪声
  assert.match(feedCardSource, /if \(list\.length < 2\) return '';/);
  // 词库面板与实体标签共用同一条检索路径，两处不会各写一份
  // 批 2：runTermSearch 随检索控制器迁到 renderer/search-controller.js；
  // 批 4：实体标签点击委托随卡片交互层迁到 renderer/feed-controller.js
  assert.match(searchControllerSource, /function runTermSearch\(term\)/);
  assert.match(feedControllerSource, /const entityBtn = e\.target\.closest\('\.card-entity'\);/);
  assert.match(feedControllerSource, /runTermSearch\(entityBtn\.dataset\.entity\)/);
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
  // 批 2：设置表单装配迁到 renderer/settings-view-controller.js，字段表落点改指新模块
  assert.match(settingsViewSource, /model: \$\('#setModel'\)/);
  assert.doesNotMatch(app, /prefilterModel|scoringModel/);
  assert.doesNotMatch(settingsViewSource, /prefilterModel|scoringModel/);
});

test('星标作为一等信息流视图接入导航、筛选与实时轮询', () => {
  assert.match(html, /data-view="starred"[^>]*aria-controls="viewFeed"/);
  assert.match(html, /id="tabStarredCount"/);
  assert.match(app, /const FEED_VIEWS = \['featured', 'all', 'starred'\];/);
  // isFeed 必须与轮询、导出共用同一个集合，否则星标视图会拿不到筛选条与增量刷新
  // 批 3：switchView 改查表调度，isFeed 计算随迁入 renderer/view-registry.js
  assert.match(viewRegistrySource, /const isFeed = FEED_VIEWS\.includes\(view\);/);
  assert.doesNotMatch(app, /'hot'/);
  // 批 3：7 个视图全部经注册表接入：循环注册覆盖 FEED_VIEWS 三个信息流视图
  //（共享 #viewFeed），另四个面板逐条注册；组合根的 switchView 退化为注册表
  // 透传（启动序列断言仍可命中）
  assert.equal((app.match(/registerView\(\{ id:/g) || []).length, 5);
  assert.match(app, /for \(const feedView of FEED_VIEWS\)[\s\S]{0,160}?tab: '#viewFeed', isFeed: true/);
  assert.match(app, /return viewRegistry\.switchView\(view, \{ persist \}\);/);
  // 批 3：状态层经 renderer/store.js 持有同一个 state 对象，UI 状态切换走 setState
  assert.match(app, /const store = Store\.createStore\(state\);/);
  assert.match(app, /store\.setState\(\{ theme \}\);/);
  assert.match(viewRegistrySource, /function registerView\(\{ id, tab, isFeed = false, onEnter, onLeave \} = \{\}\)/);
  assert.ok(css.includes('.tab-count'), '缺少 .tab-count 样式');
});

test('每张卡片都提供星标与复制入口，星标状态可被键盘感知', () => {
  // 阶段 4：底栏入口固化进 <template id="cardTemplate">，复制与星标固定在每张卡片上
  assert.match(html, /<template id="cardTemplate">[\s\S]*data-act="star"/);
  assert.match(html, /<template id="cardTemplate">[\s\S]*data-act="copy"/);
  // 模板默认未星标（aria-pressed="false"）；starred 态由渲染器字段级填充
  assert.match(html, /class="card-act star-toggle" data-act="star"[^>]*aria-pressed="false"/);
  assert.match(feedCardSource, /starToggle\.setAttribute\('aria-pressed', 'true'\)/);
  assert.match(feedCardSource, /starToggle\.classList\.add\('is-on'\)/);
  // card-foot 始终存在：模板里底栏不依赖事件簇/五维分条件，留存与分发入口不缺席
  assert.match(html, /<template id="cardTemplate">[\s\S]*<div class="card-foot">[\s\S]*data-act="copy"[\s\S]*data-act="star"[\s\S]*<\/template>/);
  // 批 4：星标 API 调用与失败文案随 toggleStar 迁到 renderer/feed-controller.js
  assert.match(feedControllerSource, /\/api\/articles\/\$\{id\}\/star/);
  assert.match(feedControllerSource, /星标操作失败：/);
  for (const selector of ['.card-act', '.star-toggle.is-on', '.card-foot-gap']) {
    assert.ok(css.includes(selector), `缺少 ${selector} 样式`);
  }
});

test('星标视图的时间轴按收藏时间分组，不会按发布时间乱序', () => {
  // 阶段 4：starredTime/renderTimeline/分组逻辑随卡片渲染迁入 renderer/feed-card.js
  assert.match(feedCardSource, /const starredTime = item => item\.starredAt \|\| item\.fetchedAt;/);
  assert.match(feedCardSource, /function renderTimeline\(items, startIdx, timeOf = publishedTime\)/);
  assert.match(feedCardSource, /const label = dateLabel\(timeOf\(item\)\);/);
  // 批 2：loadFeed 调用点随信息流控制器迁到 renderer/feed-controller.js；
  // 阶段 4 改为先选定时间基准再走 keyed diff 调和，星标时间轴语义不变
  assert.match(feedControllerSource, /const timeOf = state\.view === 'starred' \? starredTime : publishedTime;/);
  assert.match(feedControllerSource, /diff\.reconcile\(data\.items, \{ mode, startIdx, timeOf \}\)/);
});

test('在星标视图取消星标后整表重载，卡片不会滞留在收藏夹里', () => {
  // 批 4：toggleStar 迁到 renderer/feed-controller.js，不再从 app.js 切片，
  // 改为 require 新模块后以假依赖驱动行为：星标视图里取消星标必须整表重载
  const { createFeedController } = require('../renderer/feed-controller');
  const calls = [];
  const state = { view: 'starred', loading: false, page: 0, listed: 0, q: '', domain: '', category: '', knownIds: new Set(), freshIds: new Set() };
  const listElement = {
    innerHTML: '',
    addEventListener() {},
    querySelector: () => null
  };
  const ctrl = createFeedController({
    api: path => {
      calls.push(path);
      if (path.includes('/star')) return Promise.resolve({ starred: false });
      return Promise.resolve({ items: [], hasMore: false });   // /api/feed 整表重载
    },
    state,
    esc: value => String(value ?? ''),
    DomUtils: { findFocusKey: () => null, restoreFocusByKey() {} },
    format: { delay: () => Promise.resolve(), SKELETON_MIN_MS: 0 },
    card: {
      skeletons: () => '',
      publishedTime: x => x, starredTime: x => x
    },
    // 阶段 4：diff 为必需依赖，这里只需空实现的假对象
    diff: {
      reconcile: () => ({ reused: 0, created: 0, removed: 0 }),
      appendPage: () => ({ created: 0 })
    },
    feedRequestGuard: { begin: () => ({ isCurrent: () => true }) },
    renderSearchContext: () => {},
    elements: {
      list: listElement,
      btnMore: { hidden: true, disabled: false, classList: { add() {}, remove() {} }, addEventListener() {}, textContent: '' }
    },
    toast: (msg, isError) => calls.push(`toast:${msg}:${Boolean(isError)}`),
    refreshStats: () => calls.push('refreshStats')
  });
  const attributes = { 'aria-pressed': 'true' };
  const button = {
    disabled: false,
    getAttribute: name => attributes[name] ?? null,
    setAttribute: (name, value) => { attributes[name] = value; },
    classList: { toggle() {} },
    querySelector: () => null
  };
  return ctrl.toggleStar({ dataset: { id: '7' } }, button).then(() => {
    assert.deepEqual(calls, [
      '/api/articles/7/star',
      'toast:已取消星标:false',
      '/api/feed?view=starred&page=0',
      'refreshStats'
    ], '星标视图取消星标：先提示、再整表重载、最后刷塔台');
    assert.equal(button.disabled, false, '结束后按钮必须解锁');
  });
});

test('导出走服务端渲染，界面只负责复制或另存为', () => {
  // 批 2：导出逻辑迁到 renderer/export-controller.js，字面断言改指新模块
  assert.match(exportControllerSource, /await api\('\/api\/export\?' \+ exportParams\(kind, format\)\)/);
  assert.match(exportControllerSource, /navigator\.clipboard\?\.writeText/);
  assert.match(exportControllerSource, /document\.execCommand\('copy'\)/);   // 沙箱内剪贴板不可用时的回退路径
  assert.match(exportControllerSource, /anchor\.download = filename;/);
  assert.match(exportControllerSource, /导出失败：/);
  for (const id of ['btnCopyFeed', 'btnExportFeed', 'btnCopyDaily', 'btnExportDaily']) {
    assert.ok(html.includes(`id="${id}"`), `缺少导出控件 ${id}`);
  }
  assert.ok(css.includes('.copy-scratch'), '缺少剪贴板回退容器样式');
});

test('情报备忘可回看与删除，不再是只写不读', () => {
  assert.match(html, /id="feedbackList"[^>]*aria-live="polite"/);
  // 批 2：情报备忘接线随设置视图控制器迁到 renderer/settings-view-controller.js
  assert.match(settingsViewSource, /async function loadFeedback\(\)/);
  assert.match(settingsViewSource, /await api\('\/api\/feedback'\)/);
  assert.match(settingsViewSource, /await api\(`\/api\/feedback\/\$\{id\}`, \{ method: 'DELETE' \}\)/);
  assert.match(settingsViewSource, /备忘删除失败：/);
  assert.ok(css.includes('.note-list'), '缺少 .note-list 样式');
});

test('快捷键随第八个视图扩展，并新增复制当前视图', () => {
  // 批 2：键盘快捷键迁到 renderer/shortcuts.js
  assert.match(shortcutsSource, /const tabIndex = '12345678'\.indexOf\(event\.key\);/);
  assert.match(shortcutsSource, /if \(letter === 'c'\)/);
  assert.match(html, /切换第 1–7 个视图/);
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
  // 批 2：词库面板逻辑随检索控制器迁到 renderer/search-controller.js
  assert.match(searchControllerSource, /await api\('\/api\/lexicon'\)/);
  assert.match(searchControllerSource, /data-lex-term="\$\{esc\(item\.term\)\}"/);
  assert.match(searchControllerSource, /class="lex-count">\$\{item\.count\}/);
  // 面板上的条数按「全部动态」口径统计，选词后就必须落到同一个视图，
  // 否则在「精选」里检索会看到远少于面板承诺的结果，那个数字立刻不可信
  assert.match(searchControllerSource, /if \(state\.view === 'all'\) loadFeed\(\);\s*\n\s*else switchView\('all', \{ persist: false \}\);/);
  for (const selector of ['.lexicon-panel', '.lexicon-terms', '.lex-term', '.lex-count', '.lex-term.is-empty']) {
    assert.ok(css.includes(selector), `缺少 ${selector} 样式`);
  }
  // 面板是绝对定位的，必须有定位基准，否则会飘到页面左上角
  assert.match(css, /\.tower-actions \{[^}]*position: relative/);
});

test('词库面板抢占 Esc 并有独立快捷键，且点击面板之外会收起', () => {
  // 批 2：Esc/Alt+K 随快捷键迁到 renderer/shortcuts.js，切片边界同批改指新模块；
  // outside-click 收起逻辑随检索控制器迁到 renderer/search-controller.js
  const source = shortcutsSource.slice(shortcutsSource.indexOf("if (event.key === 'Escape')"), shortcutsSource.indexOf('if (event.altKey'));
  assert.match(source, /if \(!lexiconPanel\.hidden\) \{[\s\S]*setLexiconOpen\(false\)/);
  assert.match(shortcutsSource, /if \(letter === 'k'\) \{ setLexiconOpen\(lexiconPanel\.hidden\)/);
  assert.match(searchControllerSource, /if \(lexiconPanel\.contains\(event\.target\) \|\| lexiconToggle\.contains\(event\.target\)\) return;/);
});

test('库体积展示对空库和各量级都给出可读结果', () => {
  // 批 1：formatBytes 迁到 renderer/format-utils.js，不再从 app.js 切片 + new Function，
  // 改为 require 新模块直接执行，行为断言原样保留
  const { formatBytes } = require('../renderer/format-utils');
  assert.equal(formatBytes(0), '0 MB');
  assert.equal(formatBytes(-5), '0 MB');
  assert.equal(formatBytes(NaN), '0 MB');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(10 * 1024 * 1024), '10.0 MB');
  assert.equal(formatBytes(3 * 1024 * 1024 * 1024), '3.00 GB');
});

// —— 阶段 2（交互增强与响应式补全）新增契约 ——
// 「加载更多」升级为哨兵 + IntersectionObserver 自动预取；契约变更点：
// 新增 #feedSentinel 元素与 loadNextFeedPage 统一入口，#btnMore 保留为降级入口

test('信息流哨兵自动预取下一页，加载更多保留为键盘可达的降级入口', () => {
  assert.match(html, /id="feedSentinel"[^>]*aria-hidden="true"/);
  // 哨兵在 #feedList 之后、不替代任何既有元素
  assert.match(html, /id="feedList"[\s\S]*id="feedSentinel"[\s\S]*id="btnMore"/);
  assert.match(html, /id="btnMore"[^>]*hidden[^>]*>加载更多</);
  // 批 2：哨兵与翻页逻辑随信息流控制器迁到 renderer/feed-controller.js；
  // IntersectionObserver 构造器改为依赖注入（InjectedIntersectionObserver）
  assert.match(feedControllerSource, /new InjectedIntersectionObserver\(/);
  assert.match(feedControllerSource, /feedSentinelObserver\.observe\(feedSentinel\)/);
  // 哨兵与按钮共用同一条翻页路径，并与 loading 守卫协同防重复触发
  assert.match(feedControllerSource, /async function loadNextFeedPage[\s\S]{0,300}?if \(btn\.hidden \|\| state\.loading\) return;/);
  assert.match(feedControllerSource, /elements\.btnMore\.addEventListener\('click', loadNextFeedPage\)/);
  // 分页大小 30 与 /api/feed 服务端契约不变
  assert.match(feedControllerSource, /const startIdx = state\.page \* 30;/);
});

test('实时轮询先比对 stats 信号再探测，无变化轮次直接跳过', () => {
  // 轮询瘦身：仅当 today/pending 等信号相对上轮变化时才探测 feed，
  // 无变化轮次直接跳过；stats 拉取失败时宁可多探一次不漏更新
  // 批 2：轮询迁到 renderer/realtime-poller.js、card-new 高亮迁到 renderer/feed-controller.js
  assert.match(realtimePollerSource, /const stats = await refreshStats\(\);/);
  // 信号未变轮次直接跳过 feed 探测
  assert.match(realtimePollerSource, /if \(signals !== null && signals === lastPollSignals\) return schedule\(\);/);
  // 探测失败时回滚信号：本轮信号不得被静默消费，下轮重探不漏更新
  assert.match(realtimePollerSource, /catch \{[\s\S]*?lastPollSignals = null;/);
  assert.match(realtimePollerSource, /\[s\.today, s\.pending, s\.featuredToday, s\.articles, s\.starred\]\.join\('\|'\)/);
  // 18 秒周期不变
  assert.match(realtimePollerSource, /pollTimer = setTimeout\(pollRealtime, 18000\);/);
  // freshIds 新条目高亮路径保持：card-new 类由阶段 1 样式承接
  assert.match(feedControllerSource, /if \(el\) el\.classList\.add\('card-new'\);/);
});

test('氛围层在页面隐藏或窗口失焦时暂停，回到前台立即恢复', () => {
  // 脚本侧给 body 挂/卸 is-idle，对应 styles.css 阶段 1 已就绪的 paused 规则
  assert.match(app, /document\.body\.classList\.toggle\('is-idle', document\.hidden \|\| !document\.hasFocus\(\)\);/);
  assert.match(app, /document\.addEventListener\('visibilitychange', syncIdleState\);/);
  assert.match(app, /window\.addEventListener\('blur', syncIdleState\);/);
  assert.match(app, /window\.addEventListener\('focus', syncIdleState\);/);
  assert.match(
    css,
    // 液态玻璃阶段 1：氛围层新增 .blob 液态光斑，暂停选择器同口径追加
    // body.is-idle .blob，故此处字面断言同步登记新增项（原三项不变）
    /body\.is-idle \.aurora, body\.is-idle \.stars, body\.is-idle \.comet, body\.is-idle \.blob \{ animation-play-state: paused; \}/
  );
});

test('液态玻璃阶段 3：WAAPI 动效引擎、fx-tier 档位与视图切换改造', () => {
  // 运动引擎落在既有 dom-utils.js（script 预算 25/25 已用尽，不新建文件）：
  // createMotion 工厂导出 spring/fadeSlideIn/staggerIn，matchMedia/document/rAF
  // 经 deps 注入，并接入 view-registry（视图切换入场）与 feed-card（错峰入场）
  const domUtilsSource = fs.readFileSync(path.join(root, 'renderer', 'dom-utils.js'), 'utf8');
  assert.match(domUtilsSource, /function createMotion\(deps/);
  assert.match(domUtilsSource, /spring,\s*\n\s*fadeSlideIn,\s*\n\s*staggerIn,/);
  assert.match(app, /const motion = DomUtils\.createMotion\(\{/);
  assert.match(app, /ViewRegistry\.createViewRegistry\(\{[\s\S]{0,260}?motion,/);
  assert.match(app, /FeedCard\.createFeedDiffList\(\{[\s\S]{0,200}?motion/);
  // 视图切换不再强制重排重放，改对目标面板播 fadeSlideIn
  assert.doesNotMatch(viewRegistrySource, /void sec\.offsetHeight/);
  assert.match(viewRegistrySource, /motion\.fadeSlideIn\(\$\(entry\.tab\), \{ duration: 260 \}\);/);
  // fx-tier 运行时档位：写 <html data-fx-tier>，不进 store/schema、不持久化
  assert.match(app, /document\.documentElement\.dataset\.fxTier = resolveFxTier\(\);/);
  assert.match(app, /reducedMotionQuery\?\.addEventListener\?\.\('change', syncFxTier\);/);
  assert.match(app, /navigator\.deviceMemory/);
  assert.match(app, /navigator\.hardwareConcurrency/);
  // 覆盖块只改令牌值：lite 降模糊与时长，static 置 none 并关停光斑动画；
  // 滤镜声明点不新增（计数护栏另行拦截），不出现新的声明行。
  // 评审修复轮：lite 档同 static 口径关停两枚 blob 的持续动画，仅 full 档保留
  assert.match(css, /\[data-fx-tier="lite"\] \{[\s\S]*?--glass-blur: blur\(8px\) saturate\(110%\);/);
  assert.match(css, /\[data-fx-tier="lite"\] \{[\s\S]*?--dur-glide: 320ms;/);
  assert.match(css, /\[data-fx-tier="lite"\] \.blob \{ animation: none; \}/);
  assert.match(css, /\[data-fx-tier="static"\] \{[\s\S]*?--glass-blur: none;/);
  assert.match(css, /\[data-fx-tier="static"\] \.blob \{ animation: none; \}/);
  // 主题切换平滑过渡：临时 theme-transition 类只过渡颜色族属性
  assert.match(app, /document\.body\.classList\.add\('theme-transition'\);/);
  assert.match(app, /document\.body\.classList\.remove\('theme-transition'\), 320\);/);
  assert.match(css, /body\.theme-transition[\s\S]*?transition: color 260ms/);
  // 轮询主循环 setTimeout 自调度不动
  assert.match(realtimePollerSource, /pollTimer = setTimeout\(pollRealtime, 18000\);/);
});
