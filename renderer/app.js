'use strict';
/* 摘星阁 · 前端逻辑（零依赖原生 JS）
   v0.6（阶段 4）：app.js 仅为组合根——状态声明、依赖装配与启动序列。
   职责模块按 UMD + 依赖注入拆分：
     format-utils.js / feed-card.js          —— 纯函数、卡片模板渲染与增量 diff
     stats-controller.js / export-controller.js
     feed-controller.js
     daily-view-controller.js / sources-controller.js
     search-controller.js / shortcuts.js
     realtime-poller.js / update-pill.js / settings-view-controller.js
     store.js / view-registry.js              —— 状态层与视图查表调度（批 3）
     common-links-controller.js               —— 常用网址视图接线（批 4）
   阶段 4：整卡模板迁为 index.html 的 <template id="cardTemplate">，
   渲染路径改走 feed-card.js 的 createCardRenderer + createFeedDiffList。 */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const API = '';
const DomUtils = window.DomUtils;
const CommonLinks = window.CommonLinks;
const SettingsFormController = window.SettingsFormController;
const DesktopSettingsController = window.DesktopSettingsController;
const StorageMaintenanceController = window.StorageMaintenanceController;
const DailyArchiveController = window.DailyArchiveController;
const Bootstrap = window.StarPickingPavilionBootstrap;
const Desktop = window.starPickingPavilion || window.windcatcher;
const FormatUtils = window.FormatUtils;
const FeedCard = window.FeedCard;
const StatsController = window.StatsController;
const ExportController = window.ExportController;
const FeedController = window.FeedController;
const DailyViewController = window.DailyViewController;
const SourcesController = window.SourcesController;
const SearchController = window.SearchController;
const Shortcuts = window.Shortcuts;
const RealtimePoller = window.RealtimePoller;
const UpdatePill = window.UpdatePill;
const SettingsViewController = window.SettingsViewController;
const Store = window.Store;
const ViewRegistry = window.ViewRegistry;
const CommonLinksController = window.CommonLinksController;
const AquaShell = window.AquaShell;
// 阶段 3：纯函数与表示层已拆入 renderer/format-utils.js、renderer/feed-card.js，
// 这里按名解构，保持组合根内调用点不变
const formatUtils = FormatUtils;
const {
  timeAgo, localDateString, parseLocalDate, formatBytes,
  delay, SKELETON_MIN_MS, DOMAIN_NAME
} = formatUtils;
const storage = Bootstrap.getSafeStorage(window);
const initialPreferences = Bootstrap.resolveInitialUiPreferences({
  desktop: Desktop,
  storage,
  commonLinks: CommonLinks,
  today: localDateString()
});
const restoredPreferences = initialPreferences.preferences;

// ---------- 状态 ----------
const state = {
  theme: restoredPreferences.theme,
  textScale: restoredPreferences.textScale,   // sm | md | lg | xl —— 整套版面的比例尺
  aquaMode: restoredPreferences.aquaMode,
  aquaBlur: restoredPreferences.aquaBlur,
  aquaFrost: restoredPreferences.aquaFrost,
  aquaHue: restoredPreferences.aquaHue,
  aquaBrightness: restoredPreferences.aquaBrightness,
  aquaBackground: restoredPreferences.aquaBackground,
  aquaWallpaperBlur: restoredPreferences.aquaWallpaperBlur,
  aquaWallpaperFrost: restoredPreferences.aquaWallpaperFrost,
  aquaWhale: restoredPreferences.aquaWhale,
  aquaCritters: restoredPreferences.aquaCritters,
  view: restoredPreferences.view,  // featured | all | daily | links | sources | settings
  domain: restoredPreferences.domain,
  category: restoredPreferences.category,
  linksCategory: restoredPreferences.linksCategory,
  commonLinksFavorites: new Set(restoredPreferences.commonLinksFavorites),
  q: '',
  page: 0,
  listed: 0,             // 当前信息流已列出的条数（用于检索上下文计数）
  loading: false,
  dailyDate: restoredPreferences.dailyDate,
  dailyDates: [],
  realtime: restoredPreferences.realtime,
  knownIds: new Set(),  // 当前 feed 已显示的文章 id
  freshIds: new Set()   // 下次渲染要高亮的新 id
};
// 批 3：状态层经 renderer/store.js 持有同一个 state 对象（引用不变，控制器
// 注入的 state 照旧可用）；主题/缩放/领域等 UI 状态切换改经 store.setState
const store = Store.createStore(state);

// ---------- 动效与滚动 ----------
const reducedMotionQuery = window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;
const prefersReducedMotion = () => Boolean(reducedMotionQuery?.matches);

// 液态玻璃阶段 3：fx-tier 运行时档位——即席推导，不进 store、不持久化、
// 不进偏好 schema。reduced 偏好 → static；否则设备内存或逻辑核心数任一
// 偏低（≤4）→ lite，其余 full。styles.css 尾部的 [data-fx-tier] 覆盖块
// 按档位调整玻璃滤镜强度与时长令牌的值（不新增滤镜声明点）
function resolveFxTier() {
  if (prefersReducedMotion()) return 'static';
  const memory = Number(navigator.deviceMemory);
  const cores = Number(navigator.hardwareConcurrency);
  const lowEnd = (Number.isFinite(memory) && memory > 0 && memory <= 4)
    || (Number.isFinite(cores) && cores > 0 && cores <= 4);
  return lowEnd ? 'lite' : 'full';
}
function syncFxTier() {
  document.documentElement.dataset.fxTier = resolveFxTier();
}
syncFxTier();
// 系统“减少动态效果”可能在应用运行期间切换；同步根档位后，CSS 与
// Aqua Canvas 的 MutationObserver 会一起降到 static，而不是继续跑 24 fps。
reducedMotionQuery?.addEventListener?.('change', syncFxTier);

// 微型运动引擎（dom-utils 阶段 3 新增 createMotion）：matchMedia/document/rAF
// 经 deps 注入；视图切换入场与信息流错峰入场共用这一套 WAAPI 弹簧
const motion = DomUtils.createMotion({
  document,
  matchMedia: window.matchMedia ? query => window.matchMedia(query) : null,
  raf: callback => requestAnimationFrame(callback)
});

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

// 氛围层空闲暂停：页面隐藏或失焦（document.hidden || !document.hasFocus()）
// 时给 body 挂 is-idle，暂停 .aurora/.stars/.comet/.blob 动画（对应
// animation-play-state 规则在 styles.css）；回到前台或重新聚焦立即恢复
function syncIdleState() {
  document.body.classList.toggle('is-idle', document.hidden || !document.hasFocus());
}
document.addEventListener('visibilitychange', syncIdleState);
window.addEventListener('blur', syncIdleState);
window.addEventListener('focus', syncIdleState);
syncIdleState();

// ---------- 主题 ----------
let themeTransitionTimer;
let themeAppliedOnce = false;
function applyTheme(theme, { persist = true } = {}) {
  store.setState({ theme });
  // 平滑过渡：写 data-theme 前给 body 挂临时 theme-transition 类
  //（styles.css 定义 color/background-color/border-color 的 ~260ms 短过渡），
  // 结束后移除——避免常驻全表 transition 拖累滚动。首帧与 reduced
  // 偏好下不挂类；氛围层 animation-play-state 机制不受影响
  if (themeAppliedOnce && !prefersReducedMotion()) {
    document.body.classList.add('theme-transition');
    clearTimeout(themeTransitionTimer);
    themeTransitionTimer = setTimeout(() => document.body.classList.remove('theme-transition'), 320);
  }
  themeAppliedOnce = true;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#04060e' : '#f6f4ee');
  if (persist) {
    preferenceActions.remember('theme', theme);
  }
}
function toggleTheme() {
  const cur = document.documentElement.dataset.theme;
  applyTheme(cur === 'light' ? 'dark' : 'light');
}
$('#btnTheme').addEventListener('click', toggleTheme);

// ---------- 界面缩放 ----------
// 档位只写到 <html data-ui-scale> 上，倍率与全部尺寸由 CSS 的 rem 体系派生，
// 所以这里不需要逐个元素改字号——字号、行距、留白、圆角、栏宽是一起动的。
const TEXT_SCALES = ['sm', 'md', 'lg', 'xl'];
function applyTextScale(scale, { persist = true } = {}) {
  if (!TEXT_SCALES.includes(scale)) return;
  store.setState({ textScale: scale });
  document.documentElement.dataset.uiScale = scale;
  $$('[data-text-scale]').forEach(button => {
    const on = button.dataset.textScale === scale;
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', String(on));
  });
  // 缩放会改变导航条高度与标签位置，粘顶偏移和指示块要跟着重算
  syncNavHeight();
  syncTabIndicator();
  if (persist) preferenceActions.remember('textScale', scale);
}
function stepTextScale(delta) {
  const next = TEXT_SCALES[TEXT_SCALES.indexOf(state.textScale) + delta];
  if (!next) return;
  applyTextScale(next);
  toast(`界面缩放：${TEXT_SCALE_LABELS[next]}`);
}
const TEXT_SCALE_LABELS = { sm: '小', md: '标准', lg: '大', xl: '特大' };
$('#textScaleOptions').addEventListener('click', event => {
  const button = event.target.closest('[data-text-scale]');
  if (button) applyTextScale(button.dataset.textScale);
});

// ---------- 工具 ----------
async function api(path, opts) {
  const res = await fetch(API + path, opts && opts.body ? {
    method: opts.method || 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts.body)
  } : opts);
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(payload?.error || `请求失败（${res.status}）`);
  if (payload === null) throw new Error('服务返回了无效响应');
  return payload;
}

function esc(s) {
  return DomUtils.escapeHTML(s);
}
const safeUrl = value => esc(DomUtils.safeHttpUrl(value));

// 卡片表示层纯函数（评分胶囊 / 技术突破 / 实体 / 原子事件 / 骨架屏）
// 已拆入 renderer/feed-card.js，esc 与安全 URL 工具经依赖注入交给工厂
const feedCard = FeedCard.createFeedCard({
  esc,
  safeHttpUrl: DomUtils.safeHttpUrl,
  format: formatUtils
});
const { skeletons } = feedCard;

// 阶段 4：卡片模板渲染器 + keyed diff 列表渲染器。
// 整卡模板在 index.html 的 <template id="cardTemplate">，cloneNode(true)
// + 字段级填充；信息流整表重载/分页追加/实时前置插入统一走 diff 调和
const cardRenderer = FeedCard.createCardRenderer({
  esc,
  safeHttpUrl: DomUtils.safeHttpUrl,
  format: formatUtils,
  template: $('#cardTemplate'),
  doc: document
});
const feedDiffList = FeedCard.createFeedDiffList({
  list: $('#feedList'),
  renderer: cardRenderer,
  // 阶段 3（液态玻璃）：新增节点错峰入场经 motion 引擎，可选依赖
  motion
});

let toastTimer;
function toast(msg, isError) {
  // 文本必须与消息完全一致：桌面端 E2E 会按前缀断言保存结果，图标一律走 CSS
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  // 连续触发时强制重放弹簧入场：文本变了但气泡原地不动，用户分辨不出
  // 「这是一条新消息」——撤下再挂上，与 switchView 重放视图入场同款手法
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  // 驻留时长随字数走：短消息不晾着碍事，长消息让人读得完
  const hold = Math.min(6000, 2400 + String(msg).length * 45);
  toastTimer = setTimeout(() => el.classList.remove('show'), hold);
}

// ---------- 主题化确认 ----------
// 破坏性操作的最后一道关卡。原生 confirm() 的系统灰窗与玻璃拟态设计语言
// 完全脱节，且无法随主题、缩放档位变化；换上同源的 <dialog>。
function confirmGlass(message, { title = '请确认', okText = '确定' } = {}) {
  const dialog = $('#confirmDialog');
  $('#confirmDialogTitle').textContent = title;
  $('#confirmDialogMessage').textContent = message;
  $('#confirmDialogOk').textContent = okText;
  return new Promise(resolve => {
    // method="dialog" 的表单把按钮 value 写进 returnValue；Esc/外点关闭一律视为取消
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
    dialog.showModal();
  });
}

// ---------- 剪贴板与文件导出 ----------
// 阶段 3 批 2 拆入 renderer/export-controller.js：
// navigator/document 经依赖注入，导出按钮随工厂一并接线
const exportController = ExportController.createExportController({
  api, toast, state, navigator, document,
  elements: {
    btnCopyFeed: $('#btnCopyFeed'),
    btnExportFeed: $('#btnExportFeed'),
    btnCopyDaily: $('#btnCopyDaily'),
    btnExportDaily: $('#btnExportDaily')
  }
});
const { runExport, copyText } = exportController;

function persistUiPreferences(patch) {
  const sanitized = Bootstrap.sanitizeUiPreferencesPatch(patch, CommonLinks, {
    today: localDateString()
  });
  if (Object.keys(sanitized).length === 0) return Promise.resolve(null);
  try {
    const operation = Desktop?.updatePreferences
      ? Desktop.updatePreferences(sanitized)
      : Bootstrap.writeBrowserUiPreferences(
        storage,
        sanitized,
        CommonLinks,
        { today: localDateString() }
      );
    return Promise.resolve(operation).catch(() => {
      toast('界面选择保存失败，请重试', true);
      return null;
    });
  } catch {
    toast('界面选择保存失败，请重试', true);
    return Promise.resolve(null);
  }
}

const preferenceActions = Bootstrap.createUiPreferenceActions({
  commonLinks: CommonLinks,
  persist: persistUiPreferences,
  today: () => localDateString()
});
const aquaShell = AquaShell.createAquaShell({
  document,
  window,
  storage,
  preferences: restoredPreferences,
  wallpaperStore: Desktop?.isElectron
    && typeof Desktop.getAppearanceWallpaper === 'function'
    && typeof Desktop.saveAppearanceWallpaper === 'function'
    && typeof Desktop.clearAppearanceWallpaper === 'function'
    ? {
        load: () => Desktop.getAppearanceWallpaper(),
        save: dataUrl => Desktop.saveAppearanceWallpaper(dataUrl),
        clear: () => Desktop.clearAppearanceWallpaper()
      }
    : null,
  persist: persistUiPreferences,
  onChange: patch => store.setState(patch)
});
window.addEventListener('pagehide', () => aquaShell.dispose(), { once: true });
const dailyRequestGuard = Bootstrap.createLatestRequestGuard();
const feedRequestGuard = Bootstrap.createLatestRequestGuard();

// 共用同一个信息流视图集合：星标要和精选/全部动态一样享有筛选、导出与实时轮询
const FEED_VIEWS = ['featured', 'all', 'starred'];

// ---------- 塔台状态 ----------
// setStat/refreshStats 拆入 renderer/stats-controller.js（批 2），
// 时钟与帧回调经依赖注入，Node 单测可直接驱动补间
const statsController = StatsController.createStatsController({
  api, state,
  elements: {
    statSources: $('#statSources'),
    statToday: $('#statToday'),
    statFeatured: $('#statFeatured'),
    tabStarredCount: $('#tabStarredCount'),
    statStatus: $('#statStatus'),
    statStatusLabel: $('#statStatusLabel'),
    feedBanner: $('#feedBanner')
  },
  prefersReducedMotion,
  now: () => performance.now(),
  frame: callback => requestAnimationFrame(callback)
});
const { refreshStats } = statsController;

// ---------- 卡片渲染 ----------
// 阶段 4：整卡模板迁为 index.html 的 <template id="cardTemplate">，
// cardInner/renderTimeline 迁入 renderer/feed-card.js
// （createCardRenderer / createFeedDiffList），组合根只留上方装配。

document.addEventListener('error', event => {
  // 缩略图加载失败只隐去图形、保留占位：移除节点会让卡片正文横向撑开，
  // 列表里出现一次可见的布局抖动
  const img = event.target;
  if (img?.matches?.('img.card-thumb')) img.classList.add('is-broken');
}, true);

// ---------- 信息流 / 日报 / 信源 / 设置（批 2 控制器装配） ----------
// renderSearchContext 在检索控制器里实现；信息流渲染后需要刷新它，
// 用延迟闭包打破两个控制器的装配先后依赖
const feedController = FeedController.createFeedController({
  api, state, esc, DomUtils,
  format: formatUtils,
  card: { skeletons, publishedTime: FeedCard.publishedTime, starredTime: FeedCard.starredTime },
  diff: feedDiffList,
  feedRequestGuard,
  renderSearchContext: () => searchController.renderSearchContext(),
  // 批 4：卡片交互层（toggleStar + 点击委托）随工厂接线；
  // runTermSearch 来自后面装配的检索控制器，用闭包懒解析
  toast, refreshStats, safeUrl, timeAgo,
  copyText,
  runTermSearch: term => searchController.runTermSearch(term),
  elements: {
    list: $('#feedList'),
    btnMore: $('#btnMore'),
    feedEnd: $('#feedEnd'),
    newFlash: $('#newFlash'),
    btnCopyFeed: $('#btnCopyFeed'),
    btnExportFeed: $('#btnExportFeed'),
    feedToolbarNote: $('#feedToolbarNote'),
    feedSentinel: $('#feedSentinel')
  },
  IntersectionObserver: window.IntersectionObserver
});
const { loadFeed, syncFeedToolbar } = feedController;

// 批 4：toggleStar 与 #feedList 点击委托已随信息流控制器迁出，
// 组合根只保留 loadFeed/工具条接线

const dailyViewController = DailyViewController.createDailyViewController({
  api, state, esc, safeUrl,
  format: formatUtils,
  skeletons,
  toast, preferenceActions, dailyRequestGuard,
  elements: {
    body: $('#dailyBody'),
    date: $('#dailyDate'),
    sub: $('#dailySub'),
    prev: $('#dailyPrev'),
    next: $('#dailyNext'),
    regen: $('#dailyRegen')
  }
});
const { loadDaily } = dailyViewController;

const sourcesController = SourcesController.createSourcesController({
  api, state, esc, DomUtils,
  format: formatUtils,
  skeletons,
  toast, confirmGlass,
  elements: {
    list: $('#sourcesList'),
    addButton: $('#btnAddSource'),
    dialog: $('#srcDialog'),
    form: $('#srcForm'),
    htmlFields: $('#srcHtmlFields')
  }
});
const { loadSources } = sourcesController;

// ---------- 设置 ----------
// 设置页全部接线拆入 renderer/settings-view-controller.js（批 2），
// 组合根只负责注入 $、api 与各子控制器工厂
const settingsViewController = SettingsViewController.createSettingsViewController({
  $, api, esc, timeAgo, formatBytes, toast, confirmGlass, refreshStats,
  Desktop, SettingsFormController, DesktopSettingsController,
  StorageMaintenanceController, DailyArchiveController
});
const { loadSettings } = settingsViewController;

// ---------- 云幄 · 常用网址（批 4 拆入 renderer/common-links-controller.js） ----------
// renderCommonLinks 模板与分类/常用点击接线随工厂迁出，
// $、document、CommonLinks、DomUtils 经依赖注入
const commonLinksController = CommonLinksController.createCommonLinksController({
  $, document, state, esc, safeUrl,
  commonLinks: CommonLinks,
  domUtils: DomUtils,
  preferenceActions,
  elements: {
    categories: $('#commonLinksCategories'),
    grid: $('#commonLinksGrid'),
    count: $('#commonLinksCount')
  }
});
const renderCommonLinks = commonLinksController.renderCommonLinks;

// ---------- 视图切换 ----------
// 批 3：switchView 的 if-else 分发改为查表调度（renderer/view-registry.js）。
// loadFeed 等依赖经 registryDeps 代理懒解析，注册表可以先于各控制器装配；
// syncTabIndicator/syncNavHeight 随注册表迁出，这里解构保持调用点不变
const registryDeps = {};
const viewRegistry = ViewRegistry.createViewRegistry({
  $, $$, document, state, FEED_VIEWS,
  preferenceActions, scrollToTop,
  isRailLayout: () => window.matchMedia('(min-width: 70rem)').matches,
  // 阶段 3（液态玻璃）：视图切换入场改经 motion 引擎，不再强制重排重放
  motion,
  refreshStats: () => registryDeps.refreshStats && registryDeps.refreshStats()
});
const { syncTabIndicator, syncNavHeight } = viewRegistry;

// 7 个视图全部注册：三个信息流视图共享 #viewFeed，onEnter 各自触发加载
for (const feedView of FEED_VIEWS) {
  viewRegistry.registerView({ id: feedView, tab: '#viewFeed', isFeed: true, onEnter: () => registryDeps.loadFeed() });
}
viewRegistry.registerView({ id: 'daily', tab: '#viewDaily', onEnter: () => registryDeps.loadDaily(state.dailyDate) });
viewRegistry.registerView({ id: 'links', tab: '#viewLinks', onEnter: () => registryDeps.renderCommonLinks() });
viewRegistry.registerView({ id: 'sources', tab: '#viewSources', onEnter: () => registryDeps.loadSources() });
viewRegistry.registerView({ id: 'settings', tab: '#viewSettings', onEnter: () => registryDeps.loadSettings() });

function switchView(view, { persist = true } = {}) {
  return viewRegistry.switchView(view, { persist });
}

viewRegistry.wireTabs($('.nav-tabs'));

function setDomain(domain, { persist = true, load = true } = {}) {
  store.setState({ domain });
  // 选择器必须限定在领域胶囊内：页面上还有别处用同一视觉形态的按钮（如设置页的
  // 缩放档位），全局抓 .pill 会把它们的选中态一起清掉，还会给它们绑上领域筛选。
  $$('.domain-pills .pill').forEach(pill => {
    const on = pill.dataset.domain === domain;
    pill.classList.toggle('active', on);
    pill.setAttribute('aria-pressed', String(on));
  });
  if (persist) preferenceActions.remember('domain', domain);
  if (load) {
    loadFeed();
  }
}

$$('.domain-pills .pill').forEach(p => p.addEventListener('click', () => setDomain(p.dataset.domain)));

// 分类 chips
async function initCategories() {
  try {
    const cats = await api('/api/categories');
    const resolved = Bootstrap.resolveDynamicCategory(state.category, cats);
    state.category = resolved.category;
    if (resolved.patch) persistUiPreferences(resolved.patch);
    $('#catChips').innerHTML = cats.map(c => {
      const on = c === state.category;
      return `<button class="chip${on ? ' active' : ''}" data-cat="${esc(c)}" aria-pressed="${on}">${esc(c)}</button>`;
    }).join('');
    $$('.chip').forEach(ch => ch.addEventListener('click', () => {
      const on = ch.classList.contains('active');
      $$('.chip').forEach(x => {
        x.classList.remove('active');
        x.setAttribute('aria-pressed', 'false');
      });
      if (!on) {
        ch.classList.add('active');
        ch.setAttribute('aria-pressed', 'true');
      }
      state.category = on ? '' : ch.dataset.cat;
      preferenceActions.remember('category', state.category);
      loadFeed();
    }));
    syncNavHeight();
  } catch {}
}

// ---------- 检索与词库（批 2 控制器装配） ----------
const searchController = SearchController.createSearchController({
  api, state, esc, FEED_VIEWS, loadFeed, switchView, document,
  elements: {
    searchInput: $('#searchInput'),
    searchBox: $('#searchBox'),
    searchClear: $('#searchClear'),
    searchContext: $('#searchContext'),
    lexiconPanel: $('#lexiconPanel'),
    lexiconToggle: $('#btnLexicon'),
    lexiconFilter: $('#lexiconFilter'),
    lexiconClose: $('#lexiconClose'),
    lexiconBody: $('#lexiconBody'),
    lexiconSummary: $('#lexiconSummary'),
    lexiconScopes: $('.lexicon-scopes'),
    lexiconScopeButtons: $$('.lexicon-scopes [data-lex-domain]')
  }
});
const { syncSearchBox, clearSearch, setLexiconOpen, runTermSearch } = searchController;

// 批 3：视图注册表的加载依赖在各控制器全部装配完成后统一接线，
// 懒解析进 registryDeps 代理（renderCommonLinks 为函数声明，可直接引用）
Object.assign(registryDeps, {
  loadFeed, loadDaily, loadSources, loadSettings, renderCommonLinks, refreshStats
});

// 手动采集
$('#btnRefresh').addEventListener('click', async function () {
  this.classList.add('spinning');
  try {
    await api('/api/collect', { body: {} });
    toast('采集管线已启动，稍候自动刷新');
    const poll = setInterval(async () => {
      const s = await refreshStats();
      if (s && !s.pipeline?.running && !s.pending) {
        clearInterval(poll);
        this.classList.remove('spinning');
        if (FEED_VIEWS.includes(state.view)) { loadFeed(); }
        toast('采集分析完成');
      }
    }, 4000);
    setTimeout(() => { clearInterval(poll); this.classList.remove('spinning'); }, 300000);
  } catch (e) {
    this.classList.remove('spinning');
    toast('启动失败：' + e.message, true);
  }
});

// ---------- 键盘快捷键（批 2 拆入 renderer/shortcuts.js） ----------
Shortcuts.createShortcuts({
  document, state, FEED_VIEWS,
  getTabs: () => $$('.tab'),
  switchView, toggleTheme, stepTextScale, applyTextScale, toast,
  scrollToTop, runExport,
  clickRefresh: () => $('#btnRefresh').click(),
  searchInput: $('#searchInput'), clearSearch,
  lexiconPanel: $('#lexiconPanel'), lexiconToggle: $('#btnLexicon'), setLexiconOpen
});

// ---------- 滚动态：导航加重、回到顶部 ----------
// 直接在事件里判定：滚动回调本就在布局之后，读 scrollY 不额外触发重排；
// 而 requestAnimationFrame 在窗口隐藏（托盘后台运行）时会被暂停，用它反而会漏更新。
let scrolledState = null;
let toTopState = null;
function syncScrollState() {
  const y = window.scrollY;
  const scrolled = y > 8;
  const showTop = y > 560;
  if (scrolled !== scrolledState) {
    scrolledState = scrolled;
    document.body.classList.toggle('is-scrolled', scrolled);
  }
  if (showTop !== toTopState) {
    toTopState = showTop;
    $('#toTop').classList.toggle('show', showTop);
  }
}
window.addEventListener('scroll', syncScrollState, { passive: true });
window.addEventListener('resize', () => { syncNavHeight(); syncTabIndicator(); });
$('#toTop').addEventListener('click', scrollToTop);

// ---------- 实时更新（批 2 拆入 renderer/realtime-poller.js） ----------
const realtimePoller = RealtimePoller.createRealtimePoller({
  api, state, FEED_VIEWS, toast, preferenceActions,
  refreshStats, loadFeed, scrollToTop,
  document,
  getScrollY: () => window.scrollY,
  elements: { btnRealtime: $('#btnRealtime'), newFlash: $('#newFlash') },
  diff: feedDiffList
});
const { setRealtime } = realtimePoller;

// ---------- 自动更新提示（批 2 拆入 renderer/update-pill.js） ----------
UpdatePill.createUpdatePill({ desktop: Desktop, pill: $('#updatePill') });

// ---------- 启动 ----------
async function start() {
  applyTheme(state.theme, { persist: false });
  applyTextScale(state.textScale, { persist: false });
  setDomain(state.domain, { persist: false, load: false });
  setRealtime(state.realtime, { persist: false });
  syncSearchBox();
  syncFeedToolbar(false);
  syncNavHeight();
  syncScrollState();
  if (window.ResizeObserver) {
    const shellObserver = new ResizeObserver(() => { syncNavHeight(); syncTabIndicator(); });
    [$('.nav'), $('.tower'), $('#feedFilters')].filter(Boolean).forEach(node => shellObserver.observe(node));
  }
  if (document.fonts?.ready) document.fonts.ready.then(syncTabIndicator).catch(() => {});
  if (initialPreferences.migrationPatch) persistUiPreferences(initialPreferences.migrationPatch);
  if (FEED_VIEWS.includes(state.view)) {
    await initCategories();
    switchView(state.view, { persist: false });
  } else {
    switchView(state.view, { persist: false });
    initCategories();
  }
  realtimePoller.start();   // 自调度实时增量循环
}

start().catch(() => toast('界面初始化失败，请刷新重试', true));
