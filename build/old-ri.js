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

test('甯哥敤缃戝潃浣滀负鎽樻槦闃侀《閮ㄤ富瀵艰埅鐨勫師鐢熻鍥炬帴鍏?, () => {
  assert.match(html, /data-view="links"[^>]*>甯哥敤缃戝潃<\/button>/);
  assert.match(html, /id="viewLinks"[^>]*class="view"[^>]*hidden/);
  assert.match(html, /浜戝箘\s*路\s*甯哥敤缃戝潃/);
  assert.match(html, /id="commonLinksCategories"[^>]*tabindex="-1"/);
  assert.match(html, /id="commonLinksGrid"[^>]*tabindex="-1"/);
});

test('棰嗗煙妯″潡鍦ㄥ簲鐢ㄨ剼鏈箣鍓嶅姞杞?, () => {
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

test('椤甸潰澹版槑鍙敱鐜版湁闈欐€佽矾鐢辨彁渚涚殑鎽樻槦闃佸浘鏍?, () => {
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/);
  const favicon = fs.readFileSync(path.join(root, 'renderer', 'favicon.svg'), 'utf8');
  assert.match(favicon, /^<svg[^>]*aria-label="鎽樻槦闃?/);
});

test('瑙嗗浘鍒囨崲銆佸垎绫汇€佹槦鏍囧拰鎸佷箙鍖栧潎鎺ュ叆 app.js', () => {
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

test('璁剧疆椤典笉鎺ユ敹瀵嗛挜鍐呭锛岀┖杈撳叆涓嶄細瑕嗙洊宸蹭繚瀛樼殑瀵嗛挜', () => {
  assert.doesNotMatch(app, /setApiKey['"]\)\.value\s*=\s*s\.ai\.apiKey/);
  assert.match(settingsFormController, /if \(apiKey\) aiPatch\.apiKey = apiKey/);
  assert.match(settingsFormController, /apiKey:\s*null/);
  assert.match(html, /id="btnClearAiKey"/);
});

test('璁剧疆椤甸€氳繃绔炴€佸畨鍏ㄦ帶鍒跺櫒鍔犺浇鍜屼繚瀛樺叏閮ㄥ彲缂栬緫瀛楁', () => {
  const controllerIndex = html.indexOf('<script src="settings-form-controller.js"></script>');
  const appIndex = html.indexOf('<script src="app.js"></script>');
  assert.ok(controllerIndex >= 0 && controllerIndex < appIndex);
  assert.match(app, /SettingsFormController\.createSettingsFormController/);
  assert.match(app, /settingsForm\.load\(\)/);
  assert.match(app, /settingsForm\.saveAi\(\)/);
  assert.match(app, /settingsForm\.clearApiKey\(\)/);
  assert.match(app, /settingsForm\.saveCollect\(\)/);
});

test('璁剧疆椤垫彁渚涘彲璁块棶鐨勬闈㈣繍琛屽紑鍏?, () => {
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

test('鐣岄潰灞曠ず鍚庣鐨勫畨鍏ㄩ敊璇秷鎭苟鎹曡幏璁剧疆淇濆瓨澶辫触', () => {
  assert.match(app, /const payload = await res\.json\(\)\.catch\(\(\) => null\)/);
  assert.match(app, /throw new Error\(payload\?\.error \|\| `璇锋眰澶辫触/);
  assert.match(app, /AI 閰嶇疆淇濆瓨澶辫触锛?);
  assert.match(app, /閲囬泦璁剧疆淇濆瓨澶辫触锛?);
  assert.match(app, /娓呴櫎瀵嗛挜澶辫触锛?);
  assert.match(app, /鏃ユ姤閲嶆柊鐢熸垚澶辫触锛?);
  assert.match(app, /淇℃簮鎿嶄綔澶辫触锛?);
  assert.match(app, /鍙嶉淇濆瓨澶辫触锛?);
});

test('鏃ユ姤瀵艰埅浣跨敤鏈湴鏃ュ巻鏃ユ湡鑰屼笉鏄?UTC 鏃ユ湡鍒囩墖', () => {
  assert.match(app, /function localDateString\(date = new Date\(\)\)/);
  assert.doesNotMatch(app, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
});

test('椤甸潰鑴氭湰鍏ㄩ儴澶栫疆涓斿姩鎬佹覆鏌撲笉浣跨敤鍐呰仈浜嬩欢澶勭悊鍣?, () => {
  const scriptTags = [...html.matchAll(/<script\b([^>]*)>/gi)];
  assert.ok(scriptTags.length > 0);
  for (const [, attributes] of scriptTags) assert.match(attributes, /\bsrc="[^"]+"/);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(app, /\son[a-z]+\s*=/i);
});

test('搴旂敤浣跨敤瑙勮寖瀛樺偍閿苟鍙縼绉绘湁鏁堢殑鏃ф槦鏍囨暟缁?, () => {
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
        category: '鏀跨瓥',
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
    category: '鏀跨瓥',
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
    category: '浜т笟',
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
    ['category', '鏀跨瓥', { category: '鏀跨瓥' }],
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
    Bootstrap.resolveDynamicCategory('宸蹭笅绾垮垎绫?, ['鏀跨瓥', '浜т笟']),
    { category: '', patch: { category: '' } }
  );
  assert.deepEqual(
    Bootstrap.resolveDynamicCategory('鏀跨瓥', ['鏀跨瓥', '浜т笟']),
    { category: '鏀跨瓥', patch: null }
  );
  assert.deepEqual(
    Bootstrap.resolveDynamicCategory('', ['鏀跨瓥', '浜т笟']),
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
  assert.match(app, /start\(\)\.catch\(\(\) => toast\('鐣岄潰鍒濆鍖栧け璐ワ紝璇峰埛鏂伴噸璇?, true\)\)/);
});

test('daily loading begins a production request token and guards response and error commits', () => {
  const start = app.indexOf('async function loadDaily');
  const end = app.indexOf('function shiftDaily');
  const source = app.slice(start, end);

  assert.match(source, /const request = dailyRequestGuard\.begin\(\)/);
  assert.match(source, /const \[data\] = await Promise\.all\(\[\s*api\(/);
  assert.match(source, /if \(!request\.isCurrent\(\)\) return/);
  assert.match(source, /catch \(e\)\s*\{[\s\S]*if \(!request\.isCurrent\(\)\) return/);
});

test('甯哥敤缃戝潃閲嶆覆鏌撳悗灏嗛敭鐩樼劍鐐规仮澶嶅埌鍚屼竴鎺у埗椤?, () => {
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

test('鐐瑰嚮鎺т欢鐨?focus key 琚樉寮忎紶鍏ユ覆鏌撳苟鎭㈠鍒版浛鎹㈡帶浠舵垨绋冲畾鍖哄煙', () => {
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
  const end = app.indexOf('// ---------- 瑙嗗浘鍒囨崲 ----------');
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

test('甯哥敤缃戝潃娓叉煋閫氳繃鍏变韩宸ュ叿杞箟鏂囨湰骞堕檺鍒跺閾惧崗璁?, () => {
  assert.match(app, /function esc\(s\)\s*\{\s*return DomUtils\.escapeHTML\(s\);\s*\}/);
  assert.match(app, /const safeUrl = value => esc\(DomUtils\.safeHttpUrl\(value\)\);/);
  assert.match(app, /href="\$\{safeUrl\(item\.url\)\}"/);
});

test('鏂囩珷銆佸浘鐗囥€佺儹鐐广€佷簨浠剁皣鍜屾棩鎶ョ殑杩滅▼鍦板潃鍏ㄩ儴閫氳繃瀹夊叏 URL 宸ュ叿', () => {
  assert.match(app, /const safeUrl = value => esc\(DomUtils\.safeHttpUrl\(value\)\);/);
  assert.match(app, /src="\$\{safeUrl\(item\.image\)\}"/);
  for (const expression of ['item.url', 'it.url', 'i.url']) {
    assert.match(app, new RegExp(`href="\\$\\{safeUrl\\(${expression.replace('.', '\\.') }\\)\\}"`));
  }
});

test('v4 鍗＄墖浣跨敤棰嗗煙鑹叉潯銆佸紓姝ョ缉鐣ュ浘涓庢牱寮忚〃鎵樼鐨勬棩鎶ラ棿璺?, () => {
  assert.match(
    app,
    /<article class="card\$\{item\.featured \? ' is-featured' : ''\}" data-id="\$\{item\.id\}"\$\{item\.domain \? ` data-domain="\$\{esc\(item\.domain\)\}"` : ''\}/
  );
  assert.match(app, /class="card-thumb"[^>]*loading="lazy"[^>]*decoding="async"/);
  assert.match(app, /<div class="daily-section glass">/);
  assert.doesNotMatch(app, /class="daily-section glass"\s+style=/);
});

test('闀夸俊鎭祦涓庢棩鎶ヨ烦杩囩灞忔覆鏌撲絾淇濈暀鍥烘湁鍗犱綅', () => {
  assert.match(
    css,
    /\.card\s*\{[^}]*content-visibility:\s*auto;[^}]*contain-intrinsic-size:\s*auto 18rem;/s
  );
  assert.match(
    css,
    /\.daily-section\s*\{[^}]*content-visibility:\s*auto;[^}]*contain-intrinsic-size:\s*auto 20rem;/s
  );
});

test('淇℃簮绉婚櫎鎿嶄綔鏄庣‘璇存槑涓轰繚鐣欒褰曠殑杞仠鐢?, () => {
  assert.match(app, /绉诲嚭鐩戞帶/);
  assert.match(app, /宸查噰闆嗘枃绔犲拰淇℃簮璁板綍閮戒細淇濈暀/);
  assert.doesNotMatch(app, /纭畾鍒犻櫎璇ヤ俊婧?);
});

test('甯哥敤缃戝潃娌跨敤 Electron 鐨勫畨鍏ㄥ閾剧瓥鐣?, () => {
  const electronMain = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  assert.match(electronMain, /setWindowOpenHandler/);
  assert.match(electronMain, /parsed\.protocol === 'http:' \|\| parsed\.protocol === 'https:'/);
  assert.match(electronMain, /parsed\.username \|\| parsed\.password/);
  assert.match(electronMain, /shell\.openExternal\(url\)/);
  assert.match(electronMain, /return \{ action: 'deny' \}/);
});

test('甯哥敤缃戝潃娌跨敤鎽樻槦闃佷富棰樺苟鍏峰鍝嶅簲寮忓拰浜や簰鐘舵€?, () => {
  for (const selector of [
    '.common-links-head',
    '.common-links-categories',
    '.common-links-grid',
    '.common-links-card',
    '.common-links-favorite.is-active',
    '.common-links-open',
    '@container app (max-width: 45rem)'
  ]) assert.ok(css.includes(selector), `缂哄皯 ${selector}`);
  assert.match(css, /\.common-links-card[\s\S]*var\(--glass-border\)/);
  assert.match(css, /\.common-links-favorite\.is-active[\s\S]*var\(--c-teal\)/);
});

test('淇℃伅娴侀噸杞戒互鏈€鍚庝竴娆¤姹備负鍑嗭紝鍔犺浇閫斾腑鍒囨崲绛涢€変笉浼氳涓㈠純', () => {
  // 鏃у疄鐜版槸 `if (state.loading) return;`锛屼細鎶婂姞杞芥湡闂寸殑绛涢€夌偣鍑婚潤榛樺悶鎺?  assert.doesNotMatch(app, /async function loadFeed[\s\S]{0,200}?if \(state\.loading\) return;/);
  assert.match(app, /const feedRequestGuard = Bootstrap\.createLatestRequestGuard\(\);/);
  assert.match(app, /if \(!reset && state\.loading\) return;/);
  assert.match(app, /const request = feedRequestGuard\.begin\(\);/);
  // 杩囨湡鍝嶅簲鏃笉鑳芥敼 DOM锛屼篃涓嶈兘鎻愬墠瑙ｉ櫎 loading 鏍囧織
  assert.match(app, /const \[data\] = await Promise\.all\(\[\s*api\('\/api\/feed\?' \+ params\),[\s\S]{0,120}?\]\);\s*\n\s*if \(!request\.isCurrent\(\)\) return;/);
  // 楠ㄦ灦灞忔湁鏈€鐭┗鐣欙細鏈湴鎺ュ彛姣绾ц繑鍥炴椂锛岄鏋朵笉璇ュ彧鏄竴闂€岃繃鐨勫櫔鐐?  assert.match(app, /const SKELETON_MIN_MS = \d+;/);
  assert.match(app, /if \(request\.isCurrent\(\)\) state\.loading = false;/);
});

test('鍙充晶鐑害鏍忓悓鏍蜂涪寮冭繃鏈熷搷搴?, () => {
  assert.match(app, /const hotRailRequestGuard = Bootstrap\.createLatestRequestGuard\(\);/);
  assert.match(app, /async function loadHotRail[\s\S]{0,400}?if \(!request\.isCurrent\(\)\) return;/);
});

test('淇℃簮鍗＄墖灞曠ず澶辫触閫€閬跨姸鎬佸苟鎻愪緵绔嬪嵆閲嶈瘯', () => {
  assert.match(app, /health\.pausedUntil/);
  assert.match(app, /鏆傚仠鑷?);
  assert.match(app, /杩炵画澶辫触 \$\{health\.consecutiveErrors\} 娆?);
  assert.match(app, /data-act="retry"/);
  assert.match(app, /\/api\/sources\/\$\{id\}\/retry/);
  assert.ok(css.includes('.src-backoff'), '缂哄皯 .src-backoff 鏍峰紡');
  assert.ok(css.includes('.src-card.is-failing'), '缂哄皯 .src-card.is-failing 鏍峰紡');
});

test('璁剧疆椤垫彁渚涙暟鎹繚鐣欓厤缃笌鏈湴搴撲綋绉鍥?, () => {
  assert.match(html, /id="setRetentionDays"[^>]*type="number"[^>]*min="7"[^>]*max="3650"/);
  assert.match(html, /id="setIrrelevantRetentionDays"[^>]*type="number"[^>]*min="1"[^>]*max="3650"/);
  assert.match(html, /id="btnSaveRetention"/);
  assert.match(html, /id="btnPruneNow"/);
  for (const id of ['msArticles', 'msTotal', 'msExpiring']) {
    assert.ok(html.includes(`id="${id}"`), `缂哄皯缁熻浣?${id}`);
  }
  assert.match(app, /requestDatabase: \(\) => api\('\/api\/maintenance'\)/);
  assert.match(app, /'\/api\/maintenance\/prune'/);
  assert.match(app, /await settingsForm\.saveRetention\(\)/);
  assert.match(settingsFormController, /RETENTION_FIELD_NAMES/);
  assert.match(settingsFormController, /retentionDays: Number\(elements\.retentionDays\.value\)/);
  assert.ok(css.includes('.maintenance-stats'), '缂哄皯 .maintenance-stats 鏍峰紡');
});

test('v0.0.12 鏁版嵁缁存姢闈㈡澘鍒嗙鏁版嵁搴撱€佺紦瀛樸€佽縼绉绘畫鐣欏拰鏃у簱鎿嶄綔', () => {
  assert.match(html, /storage-maintenance-controller\.js/);
  for (const id of [
    'msDatabase', 'msReclaimable', 'msCache', 'msMigrationResidue',
    'msLegacy', 'msTotal', 'btnCompactNow', 'btnClearCache',
    'btnDeleteLegacy', 'compactResult', 'cacheResult', 'legacyResult'
  ]) {
    assert.ok(html.includes(`id="${id}"`), `缂哄皯瀛樺偍娌荤悊鎺т欢 ${id}`);
  }
  assert.match(app, /StorageMaintenanceController\.createStorageMaintenanceController/);
  assert.match(app, /Desktop\.getStorageSnapshot/);
  assert.match(app, /Desktop\.clearManagedCache/);
  assert.match(app, /Desktop\.deleteLegacyData/);
  assert.ok(css.includes('.storage-breakdown'), '缂哄皯瀛樺偍鏄庣粏缃戞牸');
  assert.ok(css.includes('.maintenance-action-grid'), '缂哄皯缁存姢鎿嶄綔缃戞牸');
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
    assert.ok(html.includes(`id="${id}"`), `缂哄皯姣忔棩褰掓。鎺т欢 ${id}`);
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
  assert.match(app, /姣忔棩鏂伴椈绠€鎶ヨ嚜鍔ㄥ綊妗ｄ粎鍦ㄥ畨瑁呯増涓彲鐢?);
  assert.match(dailyArchiveController, /createDailyArchiveController/);
  assert.match(dailyArchiveController, /aria-busy/);
  assert.match(dailyArchiveController, /pendingDates/);
});

test('technical breakthrough heat boosts are visible and explained with sanitized signals', () => {
  assert.match(app, /breakthroughBonus/);
  assert.match(app, /breakthroughScore/);
  assert.match(app, /breakthroughSignals/);
  assert.match(app, /class="breakthrough-pill"/);
  assert.match(app, /鎶€鏈獊鐮?<b>\+\$\{breakthrough\.bonus/);
  assert.match(app, /class="breakthrough-explanation"/);
  assert.match(app, /esc\(breakthrough\.explanation\)/);
  assert.ok(css.includes('.breakthrough-pill'), '缂哄皯鎶€鏈獊鐮村窘鏍囨牱寮?);
  assert.ok(css.includes('.breakthrough-explanation'), '缂哄皯鎶€鏈獊鐮磋鏄庢牱寮?);
});

test('v0.0.14 鍗＄墖鍛堢幇瀹炰綋鏍囩涓庡師瀛愪簨浠讹紝瀹炰綋鐐瑰嚮鍗虫绱?, () => {
  assert.match(app, /class="card-entities"/);
  assert.match(app, /class="card-entity"[^]*?data-entity="\$\{esc\(entity\.name\)\}"/);
  assert.match(app, /class="card-events"/);
  assert.match(app, /鍘熷瓙浜嬩欢 \$\{list\.length\}/);
  // 鍘熷瓙浜嬩欢鍙湪鐪熺殑鎷嗗嚭澶氫欢浜嬫椂灞曠ず锛屽崟浜嬩欢鍗＄墖涓嶅姞杩欎竴鍧楀櫔澹?  assert.match(app, /if \(list\.length < 2\) return '';/);
  // 璇嶅簱闈㈡澘涓庡疄浣撴爣绛惧叡鐢ㄥ悓涓€鏉℃绱㈣矾寰勶紝涓ゅ涓嶄細鍚勫啓涓€浠?  assert.match(app, /function runTermSearch\(term\)/);
  assert.match(app, /const entityBtn = e\.target\.closest\('\.card-entity'\);/);
  assert.match(app, /runTermSearch\(entityBtn\.dataset\.entity\)/);
  assert.ok(css.includes('.card-entity'), '缂哄皯瀹炰綋鏍囩鏍峰紡');
  assert.ok(css.includes('.card-events'), '缂哄皯鍘熷瓙浜嬩欢鏍峰紡');
});

test('v0.0.14 璁剧疆椤靛彧鏆撮湶鍗曚竴鍒嗘瀽妯″瀷瀛楁', () => {
  assert.match(html, /id="setModel"[^>]*placeholder="deepseek-v4-flash"/);
  assert.doesNotMatch(html, /setPrefilterModel|setScoringModel/);
  // v4-pro 鍙兘浣滀负銆屽凡绉婚櫎銆嶇殑璇存槑鍑虹幇锛屼笉鑳藉啀鏄换浣曡緭鍏ユ鐨勫€欓€夊€?  assert.doesNotMatch(html, /(?:placeholder|value)="[^"]*deepseek-v4-pro/);
  assert.match(html, /deepseek-v4-pro 宸蹭粠鏈簲鐢ㄧЩ闄?);
  assert.match(html, /DeepSeek-V4-Flash-0731/);
  assert.match(app, /model: \$\('#setModel'\)/);
  assert.doesNotMatch(app, /prefilterModel|scoringModel/);
});

test('鏄熸爣浣滀负涓€绛変俊鎭祦瑙嗗浘鎺ュ叆瀵艰埅銆佺瓫閫変笌瀹炴椂杞', () => {
  assert.match(html, /data-view="starred"[^>]*aria-controls="viewFeed"/);
  assert.match(html, /id="tabStarredCount"/);
  assert.match(app, /const FEED_VIEWS = \['featured', 'hot', 'all', 'starred'\];/);
  // isFeed 蹇呴』涓庤疆璇€佸鍑哄叡鐢ㄥ悓涓€涓泦鍚堬紝鍚﹀垯鏄熸爣瑙嗗浘浼氭嬁涓嶅埌绛涢€夋潯涓庡閲忓埛鏂?  assert.match(app, /const isFeed = FEED_VIEWS\.includes\(view\);/);
  assert.doesNotMatch(app, /\['featured', 'hot', 'all'\]\.includes/);
  assert.ok(css.includes('.tab-count'), '缂哄皯 .tab-count 鏍峰紡');
});

test('姣忓紶鍗＄墖閮芥彁渚涙槦鏍囦笌澶嶅埗鍏ュ彛锛屾槦鏍囩姸鎬佸彲琚敭鐩樻劅鐭?, () => {
  assert.match(app, /data-act="star"/);
  assert.match(app, /data-act="copy"/);
  assert.match(app, /aria-pressed="\$\{item\.starred \? 'true' : 'false'\}"/);
  // 搴曟爮姝ゅ墠鍙湪瀛樺湪浜嬩欢绨囨垨浜旂淮鍒嗘椂鎵嶆覆鏌擄紝閭ｆ牱澶ч儴鍒嗗崱鐗囧氨娌℃湁鐣欏瓨鍏ュ彛
  assert.match(app, /const foot = `<div class="card-foot">\$\{cluster\}\$\{dimsToggle\}\$\{actions\}<\/div>`/);
  assert.match(app, /\/api\/articles\/\$\{id\}\/star/);
  assert.match(app, /鏄熸爣鎿嶄綔澶辫触锛?);
  for (const selector of ['.card-act', '.star-toggle.is-on', '.card-foot-gap']) {
    assert.ok(css.includes(selector), `缂哄皯 ${selector} 鏍峰紡`);
  }
});

test('鏄熸爣瑙嗗浘鐨勬椂闂磋酱鎸夋敹钘忔椂闂村垎缁勶紝涓嶄細鎸夊彂甯冩椂闂翠贡搴?, () => {
  assert.match(app, /const starredTime = item => item\.starredAt \|\| item\.fetchedAt;/);
  assert.match(app, /function renderTimeline\(items, startIdx, timeOf = publishedTime\)/);
  assert.match(app, /const label = dateLabel\(timeOf\(item\)\);/);
  assert.match(app, /renderTimeline\(data\.items, 0, state\.view === 'starred' \? starredTime : publishedTime\)/);
});

test('鍦ㄦ槦鏍囪鍥惧彇娑堟槦鏍囧悗鏁磋〃閲嶈浇锛屽崱鐗囦笉浼氭粸鐣欏湪鏀惰棌澶归噷', () => {
  const source = app.slice(app.indexOf('async function toggleStar'), app.indexOf('// 鍗＄墖浜や簰'));
  assert.match(source, /if \(state\.view === 'starred' && !result\.starred\)/);
  assert.match(source, /await loadFeed\(\);/);
});

test('瀵煎嚭璧版湇鍔＄娓叉煋锛岀晫闈㈠彧璐熻矗澶嶅埗鎴栧彟瀛樹负', () => {
  assert.match(app, /await api\('\/api\/export\?' \+ exportParams\(kind, format\)\)/);
  assert.match(app, /navigator\.clipboard\?\.writeText/);
  assert.match(app, /document\.execCommand\('copy'\)/);   // 娌欑鍐呭壀璐存澘涓嶅彲鐢ㄦ椂鐨勫洖閫€璺緞
  assert.match(app, /anchor\.download = filename;/);
  assert.match(app, /瀵煎嚭澶辫触锛?);
  for (const id of ['btnCopyFeed', 'btnExportFeed', 'btnCopyDaily', 'btnExportDaily']) {
    assert.ok(html.includes(`id="${id}"`), `缂哄皯瀵煎嚭鎺т欢 ${id}`);
  }
  assert.ok(css.includes('.copy-scratch'), '缂哄皯鍓创鏉垮洖閫€瀹瑰櫒鏍峰紡');
});

test('鎯呮姤澶囧繕鍙洖鐪嬩笌鍒犻櫎锛屼笉鍐嶆槸鍙啓涓嶈', () => {
  assert.match(html, /id="feedbackList"[^>]*aria-live="polite"/);
  assert.match(app, /async function loadFeedback\(\)/);
  assert.match(app, /await api\('\/api\/feedback'\)/);
  assert.match(app, /await api\(`\/api\/feedback\/\$\{id\}`, \{ method: 'DELETE' \}\)/);
  assert.match(app, /澶囧繕鍒犻櫎澶辫触锛?);
  assert.ok(css.includes('.note-list'), '缂哄皯 .note-list 鏍峰紡');
});

test('蹇嵎閿殢绗叓涓鍥炬墿灞曪紝骞舵柊澧炲鍒跺綋鍓嶈鍥?, () => {
  assert.match(app, /const tabIndex = '12345678'\.indexOf\(event\.key\);/);
  assert.match(app, /if \(letter === 'c'\)/);
  assert.match(html, /鍒囨崲绗?1鈥? 涓鍥?);
  assert.match(html, /<kbd>Alt<\/kbd><kbd>C<\/kbd>/);
});

test('鐣岄潰鍋忓ソ鎺ュ彈鏄熸爣瑙嗗浘锛岄噸鍚悗鑳藉洖鍒版敹钘忓す', () => {
  const schema = require('../renderer/ui-preference-schema');
  assert.equal(schema.isValidUiPreferenceValue('view', 'starred', CommonLinks), true);
  assert.deepEqual(
    schema.createUiPreferencePatch('view', 'starred', CommonLinks),
    { view: 'starred' }
  );
  assert.deepEqual(schema.createUiPreferencePatch('view', 'nonsense', CommonLinks), {});
});

test('鏍稿績璇嶅簱闈㈡澘鎸傚湪妫€绱㈡鏃侊紝甯﹀簱鍐呭懡涓暟骞朵笖閫夎瘝鍗虫绱?, () => {
  // 鍏ュ彛绱ц创妫€绱㈡锛氶潰鏉挎湇鍔＄殑姝ｆ槸銆屾垜璇ユ悳浠€涔堛€嶈繖涓€姝?  assert.match(html, /id="btnLexicon"[^>]*aria-expanded="false"[^>]*aria-controls="lexiconPanel"/);
  assert.match(html, /id="lexiconPanel"[^>]*role="dialog"[^>]*hidden/);
  assert.match(html, /id="lexiconFilter"/);
  assert.match(html, /id="lexiconBody"[^>]*aria-live="polite"/);
  for (const scope of ['data-lex-domain=""', 'data-lex-domain="lowaltitude"', 'data-lex-domain="aerospace"']) {
    assert.ok(html.includes(scope), `缂哄皯棰嗗煙绛涢€?${scope}`);
  }
  assert.match(app, /await api\('\/api\/lexicon'\)/);
  assert.match(app, /data-lex-term="\$\{esc\(item\.term\)\}"/);
  assert.match(app, /class="lex-count">\$\{item\.count\}/);
  // 闈㈡澘涓婄殑鏉℃暟鎸夈€屽叏閮ㄥ姩鎬併€嶅彛寰勭粺璁★紝閫夎瘝鍚庡氨蹇呴』钀藉埌鍚屼竴涓鍥撅紝
  // 鍚﹀垯鍦ㄣ€岀簿閫夈€嶉噷妫€绱細鐪嬪埌杩滃皯浜庨潰鏉挎壙璇虹殑缁撴灉锛岄偅涓暟瀛楃珛鍒讳笉鍙俊
  assert.match(app, /if \(state\.view === 'all'\) loadFeed\(\);\s*\n\s*else switchView\('all', \{ persist: false \}\);/);
  for (const selector of ['.lexicon-panel', '.lexicon-terms', '.lex-term', '.lex-count', '.lex-term.is-empty']) {
    assert.ok(css.includes(selector), `缂哄皯 ${selector} 鏍峰紡`);
  }
  // 闈㈡澘鏄粷瀵瑰畾浣嶇殑锛屽繀椤绘湁瀹氫綅鍩哄噯锛屽惁鍒欎細椋樺埌椤甸潰宸︿笂瑙?  assert.match(css, /\.tower-actions \{[^}]*position: relative/);
});

test('璇嶅簱闈㈡澘鎶㈠崰 Esc 骞舵湁鐙珛蹇嵎閿紝涓旂偣鍑婚潰鏉夸箣澶栦細鏀惰捣', () => {
  const source = app.slice(app.indexOf("if (event.key === 'Escape')"), app.indexOf('if (event.altKey'));
  assert.match(source, /if \(!lexiconPanel\.hidden\) \{[\s\S]*setLexiconOpen\(false\)/);
  assert.match(app, /if \(letter === 'k'\) \{ setLexiconOpen\(lexiconPanel\.hidden\)/);
  assert.match(app, /if \(lexiconPanel\.contains\(event\.target\) \|\| lexiconToggle\.contains\(event\.target\)\) return;/);
});

test('搴撲綋绉睍绀哄绌哄簱鍜屽悇閲忕骇閮界粰鍑哄彲璇荤粨鏋?, () => {
  const source = app.match(/function formatBytes\(bytes\)[\s\S]*?\n\}/)[0];
  const formatBytes = new Function(`${source}\nreturn formatBytes;`)();
  assert.equal(formatBytes(0), '0 MB');
  assert.equal(formatBytes(-5), '0 MB');
  assert.equal(formatBytes(NaN), '0 MB');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(10 * 1024 * 1024), '10.0 MB');
  assert.equal(formatBytes(3 * 1024 * 1024 * 1024), '3.00 GB');
});
