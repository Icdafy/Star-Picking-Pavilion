# 摘星阁前端契约登记（现行基线）

> 本文档是阶段 0 的契约基线：逐条登记前端与后端之间**被测试字面锁定**的约定。
> `test/*.test.js` 大量使用对 `renderer/index.html`、`renderer/app.js`、`renderer/styles.css`
> 源码文本的字面正则断言——后续任何重构阶段都必须把本文档当作检查表，
> 逐条核对后再动手；任何一条被破坏，`npm test` 会立即报出来。
>
> 当前统计口径：Aqua 外壳升级后，页面实际加载的三份 CSS 合计约 235.5 KiB，
> 早期模块化记录中的文件体积为历史值；当前页面脚本为 27 条，预算 27/27 已用尽。

---

## 1. server/index.js —— HTTP API 契约

测试归属：`test/feed-query.test.js`、`test/feed-pagination.test.js`、`test/server-security.test.js`、
`test/http-security.test.js`、`test/renderer-integration.test.js`（前端调用侧）等。

### 1.1 鉴权机制

- 所有 `/api/*` 请求先过 `authorize()`（`server/http-security.js`），校验三元组：
  `host`、`origin`、token 头；不通过返回 `403 { error: 'forbidden' }`。
- token 头常量：`API_TOKEN_HEADER = 'x-star-picking-pavilion-token'`。
- 期望 token 来自环境变量 `STAR_PICKING_PAVILION_API_TOKEN`（可为空字符串）。
- 端口来自 `STAR_PICKING_PAVILION_PORT || WINDCATCHER_PORT || 7644`，仅绑定 `127.0.0.1`。
- 所有 JSON 响应都带 `RESPONSE_SECURITY_HEADERS`（含 CSP）。

### 1.2 端点与响应形状

| 方法 | 路径 | 响应形状 |
| --- | --- | --- |
| GET | `/api/feed` | `{ items, page, hasMore }`（见 1.3） |
| GET | `/api/stats` | 统计快照 + `pipeline` + `aiConfigured`（见 1.4，5 秒 TTL 缓存） |
| GET | `/api/categories` | `CATEGORIES` 数组 |
| GET | `/api/lexicon` | `{ version, groups, termCount, matchedTermCount }`（60 秒 TTL 缓存） |
| GET | `/api/cluster/:id` | `articleRow[]`（按 quality_score 倒序） |
| POST | `/api/articles/:id/star` | body `{ starred }` → `{ ok, starred, starredAt }`；不存在返回 404 `{ error: '情报不存在' }` |
| GET | `/api/daily?date=` | `{ report, dates }` |
| GET | `/api/daily/archive?date=` | `{ date, markdown, jsonl, manifest:{ schemaVersion, productVersion, generatedAt, window, summary } }` |
| POST | `/api/daily/regenerate` | `generateDaily()` 的返回值 |
| GET | `/api/export` | `{ filename, count, format, content }`（daily / feed 两种 kind） |
| POST | `/api/collect` | `202 { started: true }` |
| GET | `/api/maintenance` | `{ databaseBytes, database, articles, irrelevant, starred, expiring, retentionDays, irrelevantRetentionDays, ...维护快照, scheduler }` |
| POST | `/api/maintenance/prune` | `{ ok, ...pruneOnce 结果, databaseBytes }` |
| POST | `/api/maintenance/compact` | `{ ok: !skipped, ...compactOnce 结果 }`；异常时按 `describeDatabaseMaintenanceError` 返回 |
| GET | `/api/sources` | 未移除的信源数组，每条附 `health: describeHealth(...)` |
| POST | `/api/sources` | `{ id }` |
| PATCH | `/api/sources/:id` | `{ ok }`；不存在 404 `{ error: '不存在' }` |
| POST | `/api/sources/:id/retry` | `{ ok }`；不存在 404 `{ error: '信源不存在' }` |
| DELETE | `/api/sources/:id` | `{ ok, removed: true }`；置 enabled=0 和 removed_at，从列表和计数移除入口，保留历史来源行及文章外键；明确 POST 同一地址可恢复原来源编号 |
| GET | `/api/settings` | 设置对象，`ai.apiKey` 被剥离、以 `ai._hasKey` 布尔替代 |
| POST | `/api/settings` | `{ ok, credentialConfigured }` |
| POST | `/api/settings/test` | `{ ok }` 或 `{ ok: false, error }`（恒 200） |
| GET | `/api/feedback` | 最近 50 条 `{ id, kind, content, createdAt }[]` |
| POST | `/api/feedback` | `{ ok, id }` |
| DELETE | `/api/feedback/:id` | `{ ok }`；不存在 404 `{ error: '反馈不存在' }` |
| — | 其余 `/api/*` | `404 { error: 'not found' }` |

### 1.3 /api/feed 分页契约（重点）

- 返回形状固定为 `{ items, page, hasMore }`；`FEED_PAGE_SIZE = 30`。
- `hasMore` 用「取 SIZE+1 条、多出即有更多」实现；`items` 最多 30 条。
- 查询参数（`parseFeedQuery`）：`view`（featured/all/starred）、`domain`、`category`、`q`（检索词）、`page`。
- 视图语义：
  - `featured`：`featured = 1` 且 `relevant = 1`；
  - `all`：`relevant IS NULL OR relevant = 1`；
  - `starred`：`starred = 1`，按 `COALESCE(starred_at, fetched_at) DESC, a.id DESC` 排序，**不做事件簇折叠**。
  - 其余视图按 `COALESCE(event_date, published_at, fetched_at) DESC, a.id DESC` 排序。
  - `domain` 筛选同时包含该领域与 `both`（跨领域条目两边都该看见）。
- 其余视图做事件簇折叠：`cluster_id IS NULL OR a.id = c.main_article_id`。
- 检索：≥3 字走 FTS5 trigram，FTS 语法错误或短词降级到全文影子表的 LIKE（`%` `_` `\` 需转义），均覆盖中文标题、实体和主体公司；在完整命中集上过滤、事件折叠、排序后分页，词库计数复用同一条件，不再预截取 500 条。
- 单条形状 `articleRow`：`id, title, url, summary, reason, image, publishedAt, fetchedAt,
  domain, category, quality, heat, featured, scores, tags, source, tier, clusterId, clusterSize,
  breakthroughScore, breakthroughBonus, breakthroughSignals, scoringVersion, entities, topics,
  events, eventKey, starred, starredAt, analyzed`。老数据 entities/topics/events 为空数组，前端「没有就不渲染」。
- 导出（`/api/export`）固定 `page=0`、`size = EXPORT_MAX_ITEMS = 200`，不受界面翻页影响。

### 1.4 /api/stats 的 5 秒 TTL 缓存（重点）

- `STATS_CACHE_TTL_MS = 5_000`；缓存对象 `statsCache = { at, counts }`。
- 计数由 `countStats()` 聚合，信源排除已移除入口，情报保留历史全表口径：`sources, sourcesTotal, articles, today,
  relevantToday, featuredToday, starred, pending`；响应再合并 `pipeline: getStatus()`
  与 `aiConfigured`（这两项不缓存，始终取最新）。
- 界面每 18 秒轮询一次；写操作通过 `invalidateStatsCache()` 立即失效缓存，触发点：
  star、collect、prune、sources 增/改/删。

---

## 2. electron/preload.js —— IPC 通道契约

测试归属：`test/preload.test.js`、`test/renderer-integration.test.js`（调用侧）。

### 2.1 sendSync 通道（预加载时同步取值）

- `app:get-version` → 面向用户的公开 `version` 字符串（来自 `build.buildVersion`，不暴露 electron-updater 内部比较号）
- `preferences:get` → `{ preferences, hasStoredPreferences }`

### 2.2 invoke 与 send 通道

| 前端方法 | 通道 |
| --- | --- |
| `updatePreferences(patch)` | `preferences:update` |
| `getAppearanceWallpaper()` | `appearance-wallpaper:get` |
| `saveAppearanceWallpaper(dataUrl)` | `appearance-wallpaper:save`（参数 `{ dataUrl }`） |
| `clearAppearanceWallpaper()` | `appearance-wallpaper:clear` |
| `getDesktopSettings()` | `desktop-settings:get` |
| `updateDesktopSettings(patch)` | `desktop-settings:update` |
| `getStorageSnapshot()` | `storage:get` |
| `clearManagedCache()` | `storage:clear-cache` |
| `deleteLegacyData(id)` | `storage:delete-legacy`（参数 `{ id }`） |
| `getDailyArchiveSettings()` | `daily-archive:get` |
| `chooseDailyArchiveDirectory()` | `daily-archive:choose-directory` |
| `setDailyArchiveEnabled(enabled)` | `daily-archive:set-enabled`（参数 `{ enabled }`） |
| `saveCurrentDailyArchive()` | `daily-archive:save-current` |
| `retryDailyArchives()` | `daily-archive:retry` |
| `checkForUpdates()` | `update:check`（invoke） |
| `installUpdate()` | `update:install`（send） |

所有 invoke 返回值都经 `cloneAndFreeze()` 深冻结后交给渲染层。

外观壁纸二进制不进入偏好 JSON：主进程只接受签名匹配的 PNG/JPEG/WebP，
压缩后 data URL 上限 3 MB，并以原子替换写入 `userData/appearance/wallpaper.asset`。
IPC payload 只接受 plain object 或 null-prototype object；读取损坏资产时回落为空值。

### 2.3 on 通道

- `update:status`：经 `onUpdateStatus(cb)` 订阅；payload 状态为
  `idle / checking / current / available / downloading / downloaded / installing / error`。

### 2.4 双全局别名约束（重要）

- `desktopApi` 是一个 `Object.freeze` 的单一对象，静态字段：
  `isElectron: true, version, preferences（深冻结）, hasStoredPreferences`。
- 同一个对象被暴露两次：
  ```js
  contextBridge.exposeInMainWorld('starPickingPavilion', desktopApi);
  contextBridge.exposeInMainWorld('windcatcher', desktopApi);
  ```
- `window.starPickingPavilion` 与 `window.windcatcher` 指向**同一冻结对象**（windcatcher
  是旧名兼容别名，不可删）。app.js 中以 `starPickingPavilion || window.windcatcher` 取值，
  这一字面写法被测试锁定。

---

## 3. renderer/ui-preference-schema.js —— UI 偏好 schema 契约

测试归属：`test/ui-preference-schema.test.js`、`test/typography.test.js`、
`test/renderer-integration.test.js`。

### 3.1 UI_PREFERENCE_FIELDS（20 字段，顺序冻结）

```
theme, textScale, aquaMode, aquaBlur, aquaFrost, aquaHue, aquaBrightness,
aquaBackground, aquaWallpaperBlur, aquaWallpaperFrost, aquaWhale, aquaCritters,
view, domain, category, dailyDate,
linksCategory, commonLinksFavorites, realtime, closeToTray
```

### 3.2 枚举值集合

| 集合 | 值 |
| --- | --- |
| `THEMES` | `light`, `dark` |
| `VIEWS` | `featured`, `all`, `starred`, `daily`, `links`, `sources`, `settings` |
| `DOMAINS` | `''`, `lowaltitude`, `aerospace` |
| `TEXT_SCALES` | `sm`, `md`, `lg`, `xl`（导出为冻结数组，typography 测试 deepEqual） |
| `AQUA_MODES` | `mica`, `compat` |
| `AQUA_BACKGROUNDS` | `fluid`, `wallpaper` |

### 3.3 version

- schema 模块本身不带 version；UI 偏好的落盘快照带 `version: 1`，
  由 `electron/ui-preferences.js` 强制（`patch.version !== 1` 直接抛 TypeError）。
- 默认值（`getDefaultUiPreferences`）：`theme: 'dark', textScale: 'md', aquaMode: 'mica',
  aquaBlur: 24, aquaFrost: 42, aquaHue: 172, aquaBrightness: 50,
  aquaBackground: 'fluid', aquaWallpaperBlur: 4, aquaWallpaperFrost: 18,
  aquaWhale: true, aquaCritters: true, view: 'featured',
  domain: '', category: '', dailyDate: null, linksCategory: ALL_CATEGORY,
  commonLinksFavorites: 默认收藏 id 列表, realtime: true, closeToTray: false`。
- 未知字段（如 `q`、`page`）一律不恢复；`dailyDate` 不允许晚于 today；
  `commonLinksFavorites` 去重且只保留合法 id。

---

## 4. renderer/bootstrap.js —— 存储键与迁移链契约

测试归属：`test/bootstrap.test.js`、`test/renderer-integration.test.js`、`test/typography.test.js`。

### 4.1 STORAGE_KEYS（现用键）

| 字段 | 键 |
| --- | --- |
| theme | `star-picking-pavilion.theme` |
| realtime | `star-picking-pavilion.realtime` |
| commonLinksFavorites | `star-picking-pavilion.common-links.favorites` |
| uiPreferences | `star-picking-pavilion.ui-preferences`（单一 JSON 快照） |

### 4.2 LEGACY_STORAGE_KEYS（windcatcher 迁移链）

| 字段 | 旧键（按顺序尝试） |
| --- | --- |
| theme | `wc-theme` |
| realtime | `wc-realtime`（值域 `'on' / 'off'`） |
| commonLinksFavorites | `zxg-common-links-favorites` |

- 迁移由 `migrateStorage()` 完成：新键存在则直接用；否则逐个旧键校验后写入新键。
- 常用网址收藏另有 `commonLinks.STORAGE_KEY / commonLinks.LEGACY_STORAGE_KEYS` 一条平行迁移链，
  bootstrap 中的调用形态 `migrateStorage(storage, commonLinks.STORAGE_KEY,
  commonLinks.LEGACY_STORAGE_KEYS, commonLinks.isValidFavoriteStorage` 被字面锁定。
- app.js 禁止再出现 `localStorage.setItem('wc-theme'…)` / `'wc-realtime'` 写法（doesNotMatch）。
- `initializeTheme` / `initializeTextScale` 在样式表加载前把 `data-theme` / `data-ui-scale`
  写到 `<html>`，避免开屏闪烁——因此 index.html 的脚本顺序契约中 bootstrap.js 必须排在
  styles.css 链接之前（见第 5 节）。

---

## 5. renderer/index.html —— DOM 契约

测试归属：`test/renderer-integration.test.js`、`test/typography.test.js`。

### 5.1 脚本/样式加载顺序（字面锁定）

以下标签必须**逐字存在**且顺序固定：

1. `<script src="dom-utils.js"></script>`
2. `<script src="ui-preference-schema.js"></script>`（在 bootstrap 之前）
3. `<script src="bootstrap.js"></script>`（在 styles.css 链接之前）
4. `<link rel="stylesheet" href="fonts/source-han-sans-sc/index.css">`（在 styles.css 之前）
5. `<link rel="stylesheet" href="styles.css">`
6. `<link rel="stylesheet" href="aqua-shell.css">`（在 styles.css 之后）
7. `<script src="common-links.js"></script>`（在 dom-utils 之后）
7. `<script src="settings-form-controller.js"></script>`（在 app.js 之前）
8. `<script src="desktop-settings-controller.js"></script>`
9. `storage-maintenance-controller.js`、`daily-archive-controller.js` 两个脚本引用
10. 阶段 3 批 2 抽离的功能模块脚本（均在 app.js 之前、common-links 序列之后）：
  `format-utils.js`、`feed-card.js`、`stats-controller.js`、`export-controller.js`、
  `feed-controller.js`、`daily-view-controller.js`、
  `sources-controller.js`、`search-controller.js`、`shortcuts.js`、`realtime-poller.js`、
  `update-pill.js`、`settings-view-controller.js`
11. 阶段 3 批 4 常用网址视图接线脚本（app.js 之前）：`common-links-controller.js`
12. 阶段 3 批 3 状态层与视图调度脚本（app.js 之前）：`store.js`、`view-registry.js`
13. `<script src="aqua-shell.js"></script>`（紧邻 app.js 之前，唯一新增的外观运行时）
14. `<script src="app.js"></script>` 最后（组合根：state 声明、依赖装配与 start()）

约束：所有 `<script>` 必须外置（带 `src`，无内联）；全文不得出现 ` onXxx=` 内联事件；
`<link rel="icon" type="image/svg+xml" href="/favicon.svg">` 逐字存在。

### 5.2 被字面断言的元素 id / class / 属性清单

**导航与视图**
- `data-view="links"` 按钮，文案 `常用网址`；`data-view="starred"` 按钮带 `aria-controls="viewFeed"`
- `id="viewLinks"` 且 `class="view"` 且初始 `hidden`；标题文案 `云幄 · 常用网址`
- `id="commonLinksCategories"`、`id="commonLinksGrid"`，均带 `tabindex="-1"`
- `id="tabStarredCount"`

**检索/词库**
- `id="btnLexicon"` 带 `aria-expanded="false"`、`aria-controls="lexiconPanel"`
- `id="lexiconPanel"` 带 `role="dialog"` 且初始 `hidden`
- `id="lexiconFilter"`；`id="lexiconBody"` 带 `aria-live="polite"`
- 三个领域筛选项：`data-lex-domain=""`、`data-lex-domain="lowaltitude"`、`data-lex-domain="aerospace"`

**信息流预取（阶段 2 新增）**
- `id="feedSentinel"` 带 `class="feed-sentinel"` 与 `aria-hidden="true"`，位于 `#feedList` 之后、
  `.feed-foot` 之前，是 IntersectionObserver 的观察点
- `id="btnMore"` 保留为键盘可达与降级入口，与哨兵共用 `loadNextFeedPage` 翻页路径

**卡片模板（阶段 4 新增）**
- `<template id="cardTemplate">` 位于 index.html（#toast 之后、脚本块之前，只增不改）；
  内含 `article.card`、`card-head/card-meta/meta-source/tier-chip/cat-tag/meta-time`、
  `card-score-group`、`a.card-title`（target=_blank rel=noopener）、`card-content/card-text/
  card-summary/card-tags`、`img.card-thumb`（loading=lazy decoding=async referrerpolicy=no-referrer）、
  `card-reason/cr-label/cr-text`、`card-foot`（cluster-toggle/dims-toggle/card-foot-gap/
  data-act="copy"/star-toggle data-act="star" aria-pressed="false"/card-act-label）、
  `cluster-items`（hidden）、`dims` 全部节点；不适用项由渲染器填充时移除。
  唯一有意的增量：meta-time span 新增 class 钩子（无样式影响），其余结构与
  旧字符串模板逐字等价；行为断言见 test/feed-diff.test.js（mini-dom 解析线上模板）

**设置页**
- Aqua Glass Lab：`setAquaBlur/setAquaFrost/setAquaHue/setAquaBrightness`、
  `setAquaWallpaper/setAquaWallpaperBlur/setAquaWallpaperFrost`、
  `setAquaWhale/setAquaCritters`、`btnAquaWallpaperClear/btnAquaReset`；
  模式和背景分段按钮分别使用 `data-aqua-mode` / `data-aqua-background` 与
  `aria-pressed`。壁纸 file input 不得用 `hidden`，应保留键盘可聚焦的视觉隐藏实现。
- 模型（v0.2.3，照搬 DeepSeek Harness Models 页）：`#modelsCard` 内 `#modelsSection` 由
  `SettingsFormController.createModelsSettings` 渲染——`#modelsActiveSelect`（选项值 `provider|modelId`）、
  `#btnTestModel`、`#modelTestResult`（role=status）、`.model-row[data-provider]`（`.model-dot.is-ok/is-missing/is-local`）、
  `[data-models-act]` 动作、`[data-models-field]` 字段；勾选弹窗 `#modelPickerDialog`。密钥框为 password 且从不回填。
- 不得出现 `setPrefilterModel` / `setScoringModel` / `setModel` / `setApiKey`；不得出现含 `deepseek-v4-pro` 的 placeholder/value
- 预筛、图文、原子事件和日报共用一个分析模型（默认 `deepseek-flash`，即 DeepSeek V4.1 Flash）；未声明图片输入的模型跳过图文理解。
- 新闻右上角 `.event-time-badge` 显示“当日报道／事后 N 天报道／计划事件／延期／暂停／事件日期待确认／报道日期待确认”。API 提供 `eventDate`、`reportedAt`、`reportDelayDays`、`timingStatus`（`dated/planned/postponed/unknown`）、独立的 `eventStatus` 和 `timingReason`；悬停解释证据缺失原因。卡片 `.meta-time` 使用报道发布时间，未知时明确提示；时间轴分组仍跟随事件日期优先的排序口径。
- 每张新闻只展示一个 `.card-thumb` 右侧缩略图，优先使用视觉筛选结果；不再有下方图片证据区。
- `id="setCloseToTray"`、`id="setLaunchAtLogin"`：`type="checkbox"` 且 `role="switch"`
- `id="desktopSettingsResult"` 带 `role="status"`、`aria-live="polite"`
- `id="setRetentionDays"`（type=number min=7 max=3650）、`id="setIrrelevantRetentionDays"`（min=1 max=3650）
- `id="btnSaveRetention"`、`id="btnPruneNow"`；统计位 `id="msArticles"`、`id="msTotal"`、`id="msExpiring"`

**存储治理（v0.0.12）**
- ids：`msDatabase`、`msReclaimable`、`msCache`、`msMigrationResidue`、`msLegacy`、`msTotal`、
  `btnCompactNow`、`btnClearCache`、`btnDeleteLegacy`、`compactResult`、`cacheResult`、`legacyResult`

**每日归档（v0.0.13）**
- ids：`dailyArchiveEnabled`（role="switch"）、`dailyArchivePath`（dir="auto"）、
  `btnChooseDailyArchive`、`btnSaveDailyArchive`、`btnRetryDailyArchive`、`dailyArchiveNextRun`、
  `dailyArchiveLastSuccess`、`dailyArchivePending`、`dailyArchiveStatus`（aria-live="polite"）

**导出与备忘**
- ids：`btnCopyFeed`、`btnExportFeed`、`btnCopyDaily`、`btnExportDaily`
- `id="feedbackList"` 带 `aria-live="polite"`

**界面缩放（typography 测试）**
- `id="textScaleOptions"`；四个 `class="scale-option"` 分别带
  `data-text-scale="sm|md|lg|xl"`
- 档位按钮**不得**复用 `class="pill"`（领域筛选按 .pill 批量改选中态，共用会互相污染）

**快捷键帮助文案**
- `切换第 1–8 个视图`；`<kbd>Alt</kbd><kbd>C</kbd>`

**hidden 元素兜底**
- 初始带 `hidden` 的元素 ≥ 4 个（当前 12 个），配合 CSS 的 `[hidden]` 兜底规则（见第 7 节）。

---

## 6. renderer/app.js —— 字面锚点契约

测试归属：`test/renderer-integration.test.js`、`test/typography.test.js`。
以下锚点被正则逐字断言，重构时**措辞、空格、标点都是契约的一部分**。

阶段 3 批 2 后锚点落点变更：app.js 退化为组合根，下列锚点中标注（→ 模块名）的
已随职责迁到对应 UMD 模块，测试断言同批改指新模块源码，契约内容不变：
哨兵/翻页/feed 竞态（→ feed-controller.js）、轮询信号（→ realtime-poller.js）、
日报（→ daily-view-controller.js）、
信源（→ sources-controller.js）、检索与词库（→ search-controller.js）、
快捷键（→ shortcuts.js）、导出（→ export-controller.js）、设置接线与备忘
（→ settings-view-controller.js）、塔台数字（→ stats-controller.js）、
更新胶囊（→ update-pill.js）。卡片模板与星标/常用网址接线暂留 app.js。
阶段 3 批 3 后：switchView 的 if-else 分发改为 view-registry 查表调度，
`const isFeed = FEED_VIEWS.includes(view);` 与 `preferenceActions.remember('view', …)`
迁到 renderer/view-registry.js；syncTabIndicator/syncNavHeight 同迁，组合根解构
保持调用点不变；状态层经 renderer/store.js 持有同一个 state 对象（引用不变，
theme/textScale/domain 等 UI 状态切换改经 store.setState）；8 个视图经
registerView({ id, tab, onEnter, onLeave }) 全部注册，FEED_VIEWS 常量与
switchView(state.view, { persist: false }) 启动序列仍留在 app.js。
阶段 3 批 4 后（切片执行函数全部退出 app.js）：renderCommonLinks 模板与
分类/常用两段接线迁到 renderer/common-links-controller.js（焦点恢复契约
data-focus-key + restoreFocusByKey 不变，fallback 改传已持有的区域元素）；
toggleStar 与 #feedList 点击委托（星标/复制/实体即检索/五维/事件簇）迁到
renderer/feed-controller.js（新增可选依赖 toast/refreshStats/copyText/
runTermSearch/safeUrl/timeAgo，不注入则不接线交互层）。test/renderer-integration
中最后两处切片 + new Function 断言同批改为 require 新模块的行为级断言，
契约行为（星标视图取消星标整表重载、焦点恢复、持久化补丁）原样保留。
阶段 4（信息流增量 diff 渲染引擎）：整卡模板 cardInner 迁为 index.html 的
<template id="cardTemplate">，renderTimeline/publishedTime/starredTime/
DIM_NAMES 迁入 renderer/feed-card.js（新增 createCardRenderer：cloneNode(true) +
字段级填充；createFeedDiffList：reconcile/appendPage/prependFresh 三路径按 data-id
调和）。feed-controller 的 diff 为必需依赖：loadFeed 重置走 diff.reconcile、
分页走 diff.appendPage，整表 innerHTML 赋值点由 4 降为 3（骨架/空态/失败态）；
realtime-poller 的 diff 为可选依赖：时间轴视图（featured/all）顶部新条目优先
diff.prependFresh（仅前置插入 + .card-new 高亮，同步 knownIds/listed），不适用
场景（星标/空态/骨架/失败态）由返回 0 退回 loadFeed。焦点归还
（findFocusKey/restoreFocusByKey）、竞态守卫、freshIds 高亮契约不变；test/perf-guard
整表赋值上限同批下调 4 → 3 并新增 keyed diff 接入断言。DOM 输出契约不变：
class/data-*/aria-*/文案/链接结构逐字等价，原字面断言同批改指模板本体与
渲染产物行为断言。
最终评审修复后的增量契约（行为级断言见 test/feed-diff.test.js 与
test/feed-controller.test.js）：date-group 新增 data-group-time 属性记录首条目
原始时间值，prependFresh 在标签不一致时比较新旧——新分组不晚于既有首组
（轮询中源站翻出的旧文）返回 0 退回整表重载，时间轴不得倒序；reconcile 的
复用池按 .tl-row 行壳收集，复用行的卡片正文经 refreshRowCard 随新数据整卡刷新；loadFeed 失败
分支同步隐藏 #btnMore/#feedEnd，loadNextFeedPage 另加「列表无卡片静默」
双保险，失败后哨兵不得翻页。

### 6.1 状态与初始化

- `view: restoredPreferences.view`（其后须出现 links 相关逻辑）；`textScale: restoredPreferences.textScale`
- `const FEED_VIEWS = ['featured', 'all', 'starred'];`
- `const isFeed = FEED_VIEWS.includes(view);`；禁止硬编码视图列表的 `.includes`
- `const preferenceActions = Bootstrap.createUiPreferenceActions(`
- `const storage = Bootstrap.getSafeStorage(window)`；禁止 `storage: localStorage`
- `StarPickingPavilionBootstrap`、`starPickingPavilion || window.windcatcher`
- `resolveInitialUiPreferences({ … commonLinks: CommonLinks`
- `if (initialPreferences.migrationPatch) persistUiPreferences(initialPreferences.migrationPatch)`
- 启动入口：`start().catch(() => toast('界面初始化失败，请刷新重试', true)`
- 初始化顺序两条分支都被锁定：
  `if (FEED_VIEWS.includes(state.view)) { … await initCategories(); … switchView(state.view, { persist: false })`
  以及 else 分支 `switchView(state.view, { persist: false }); … initCategories()`

### 6.2 偏好持久化

- 8+1 个 remember 调用：`preferenceActions.remember('theme'|'view'|'domain'|'category'|
  'dailyDate'|'linksCategory'|'commonLinksFavorites'|'realtime'|'textScale', …)`
- 禁止 remember 瞬态字段（q/page/scroll/expanded/draft/toast）
- 恢复路径统一 `{ persist: false }`：`switchView('all', { persist: false })`、
  `applyTheme(state.theme, { persist: false })`、`setRealtime(state.realtime, { persist: false })`、
  `switchView(state.view, { persist: false })`、`applyTextScale(state.textScale, { persist: false })`
- 禁止 `localStorage.setItem('wc-theme|wc-realtime'`

### 6.3 信息流加载（竞态与骨架）

- `const feedRequestGuard = Bootstrap.createLatestRequestGuard();`
- `if (!reset && state.loading) return;`（禁止旧式 `if (state.loading) return;` 开头）
- `const request = feedRequestGuard.begin();`
- `const [data] = await Promise.all([ api('/api/feed?' + params), … ]);` 紧接 `if (!request.isCurrent()) return;`
- `const SKELETON_MIN_MS = <数字>;`（骨架最短驻留）
- `if (request.isCurrent()) state.loading = false;`
- 日报段：`const request = dailyRequestGuard.begin()`、`if (!request.isCurrent()) return`（正常与 catch 两处）

### 6.3a 哨兵预取与轮询瘦身（阶段 2 新增）

- 下一页统一入口 `async function loadNextFeedPage()`，开头即
  `if (btn.hidden || state.loading) return;`（无更多/加载中/非信息流视图时哨兵静默）；
  `elements.btnMore.addEventListener('click', loadNextFeedPage)`（→ feed-controller.js，
  批 2 起按钮经依赖注入）
- 哨兵观察器（→ feed-controller.js）：`new InjectedIntersectionObserver(` …
  `feedSentinelObserver.observe(feedSentinel)`；构造器改为依赖注入，未注入时降级为
  纯按钮翻页。阶段 4 起分页追加走 `diff.appendPage`（模板克隆片段 appendChild，
  与 insertAdjacentHTML 语义等价），不新增整表赋值点（perf-guard 上限 3 处）
- 轮询瘦身（→ realtime-poller.js）：`pollRealtime` 先 `const stats = await refreshStats();`，以
  `[s.today, s.pending, s.featuredToday, s.articles, s.starred].join('|')` 作为信号快照；
  `if (signals !== null && signals === lastPollSignals) return schedule();`
  无变化轮次直接跳过并重新排程；
  feed 探测失败时回滚 `lastPollSignals = null`，本轮信号不得被静默消费，
  下轮重探不漏更新；18 秒周期 `pollTimer = setTimeout(pollRealtime, 18000);` 不变
- 氛围层空闲暂停：`syncIdleState()` 在 visibilitychange/blur/focus 时
  `document.body.classList.toggle('is-idle', document.hidden || !document.hasFocus());`，
  对应 styles.css 的 `body.is-idle .aurora, … { animation-play-state: paused; }`

### 6.4 卡片与渲染

阶段 4 后落点变更：整卡结构固化在 index.html 的 `<template id="cardTemplate">`
（字面断言改指模板本体），字段填充与时间轴/排行片段在 renderer/feed-card.js
（行为断言见 test/feed-diff.test.js），DOM 输出与旧字符串模板逐字等价：

- 卡片开标签：模板内 `<article class="card" data-id="">`；`is-featured`/`data-domain`
  由渲染器字段级填充（feed-card.js：`card.classList.add('is-featured')`、
  `card.setAttribute('data-domain', String(item.domain))`）
- `class="card-thumb"` 带 `loading="lazy"`、`decoding="async"`（模板静态；
  src 经 `safeHttpUrl` 过闸，拦截为 `#` 时移除节点）
- `<div class="daily-section glass">`，且**不得**跟内联 style
- 星标：模板内 `data-act="star"`、`data-act="copy"`、默认 `aria-pressed="false"`；
  starred 态由渲染器填充（`starToggle.setAttribute('aria-pressed', 'true')`、
  `starToggle.classList.add('is-on')`）
- card-foot 始终存在：模板内底栏（cluster-toggle/dims-toggle/card-foot-gap/复制/星标）
  不依赖事件簇/五维分条件，留存与分发入口固定在每张卡片
- `/api/articles/${id}/star`；`星标操作失败：`
- 星标时间轴（→ feed-card.js）：`const starredTime = item => item.starredAt || item.fetchedAt;`、
  `function renderTimeline(items, startIdx, timeOf = publishedTime)`、
  `const label = dateLabel(timeOf(item));`；调用点（→ feed-controller.js）改为
  `const timeOf = state.view === 'starred' ? starredTime : publishedTime;` +
  `diff.reconcile(data.items, { mode, startIdx, timeOf })`
- 技术突破：`breakthroughBonus/Score/Signals`、`class="breakthrough-pill"`、
  `技术突破 <b>+${breakthrough.bonus`、`class="breakthrough-explanation"`、`esc(breakthrough.explanation)`
  （构建器均在 feed-card.js）
- 实体与事件：`class="card-entities"`、`class="card-entity"` 带 `data-entity="${esc(entity.name)}"`、
  `class="card-events"`、`原子事件 ${list.length}`、`if (list.length < 2) return '';`
  （均在 feed-card.js）、`function runTermSearch(term)`（→ search-controller.js；实体标签
  点击在 feed-controller.js 的 feedList 委托中调用）、`const entityBtn = e.target.closest('.card-entity');`

### 6.5 安全与工具

- `const DomUtils = window.DomUtils;`
- `function esc(s) { return DomUtils.escapeHTML(s); }`
- `const safeUrl = value => esc(DomUtils.safeHttpUrl(value));`
- 所有远程地址走 safeUrl：`href="${safeUrl(item.url)}"`、`it.url`、`i.url` 三处；`src="${safeUrl(item.image)}"`
- 常用网址外链：`class="common-links-open"` 带 `target="_blank"`、`rel="noopener"`
- `function localDateString(date = new Date())`；禁止 `new Date().toISOString().slice(0, 10)`
- api 错误处理：`const payload = await res.json().catch(() => null)`、
  `throw new Error(payload?.error || \`请求失败`
- `function formatBytes(bytes)` —— 测试会用正则整体抽出该函数执行，
  函数体必须自包含、以行首 `}` 结束

### 6.6 各控制器接线

- `SettingsFormController.createSettingsFormController`；`settingsForm.load() / saveAi() /
  clearApiKey() / saveCollect() / saveRetention()`
- `DesktopSettingsController.createDesktopSettingsController`；`Desktop.getDesktopSettings`、
  `Desktop.updateDesktopSettings`
- `StorageMaintenanceController.createStorageMaintenanceController`；`Desktop.getStorageSnapshot /
  clearManagedCache / deleteLegacyData`
- `DailyArchiveController.createDailyArchiveController`；`dailyArchive?.load()`；五个 daily-archive
  方法（`Desktop\.?方法名` 形式）；文案 `每日新闻简报自动归档仅在安装版中可用`
- `requestDatabase: () => api('/api/maintenance')`；`'/api/maintenance/prune'`
- `model: $('#setModel')`；禁止 `prefilterModel|scoringModel`

### 6.7 常用网址（renderCommonLinks）

- `function renderCommonLinks(focusKey, fallbackTarget) {`（签名被锁定）
- `data-focus-key="category:${esc(category)}"`、`data-focus-key="favorite:${esc(item.id)}"`
- `DomUtils.restoreFocusByKey(document, focusKey, fallbackTarget); }`
- 两处点击分支：`const focusKey = button.dataset.focusKey; … renderCommonLinks(focusKey, $('#commonLinksCategories'));`
  与 `… $('#commonLinksGrid'));`
- `renderCommonLinks`、`commonLinksCategories`、`commonLinksGrid`、`#viewLinks`、`writeBrowserUiPreferences` 均须出现

### 6.8 词库面板、导出、备忘、快捷键等文案锚点

- `await api('/api/lexicon')`；`data-lex-term="${esc(item.term)}"`；`class="lex-count">${item.count}`
  （→ search-controller.js）
- 选词落点：`if (state.view === 'all') loadFeed();\n else switchView('all', { persist: false });`
  （→ search-controller.js）
- Esc 处理：`if (!lexiconPanel.hidden) { … setLexiconOpen(false)`、
  `if (letter === 'k') { setLexiconOpen(lexiconPanel.hidden)`（→ shortcuts.js）；
  `if (lexiconPanel.contains(event.target) || lexiconToggle.contains(event.target)) return;`
  （→ search-controller.js）
- 导出（→ export-controller.js）：`await api('/api/export?' + exportParams(kind, format))`、
  `navigator.clipboard?.writeText`、`document.execCommand('copy')`、`anchor.download = filename;`、
  `导出失败：`（navigator/document 经依赖注入）
- 备忘（→ settings-view-controller.js）：`async function loadFeedback()`、`await api('/api/feedback')`、
  ``await api(`/api/feedback/${id}`, { method: 'DELETE' })``、`备忘删除失败：`
- 快捷键（→ shortcuts.js）：`const tabIndex = '1234567890'.indexOf(event.key);`、`if (letter === 'c')`
- 缩放：`document.documentElement.dataset.uiScale = scale;`、
  `preferenceActions.remember('textScale', scale)`；`applyTextScale('md')`（→ shortcuts.js 的 Ctrl+0 复位）；
  `$$('.domain-pills .pill').forEach(pill => {` 与 `$$('.domain-pills .pill').forEach(p => p.addEventListener`；
  禁止 `$$('.pill')`
- `function applyTextScale` 体内须依次 `syncNavHeight();` 与 `syncTabIndicator();`
- 缩放快捷键 `if (event.key === '=' || event.key === '+')` 必须出现在
  `if (isTypingTarget(document.activeElement)) return;` 之前
- 信源退避：`health.pausedUntil`、`暂停至`、`连续失败 ${health.consecutiveErrors} 次`、
  `data-act="retry"`、`/api/sources/${id}/retry`
- 信源移除文案：`移出监控`、`已采集文章及其来源信息都会保留`；停用项也可移除，不暗示会删除历史文章
- 各错误 toast 文案（逐字）：`AI 配置保存失败：`、`采集设置保存失败：`、`清除密钥失败：`、
  `日报重新生成失败：`、`信源操作失败：`、`反馈保存失败：`、`星标操作失败：`

### 6.9 函数区段注释边界（切片执行的边界契约）

`renderer-integration.test.js` 会用 `app.indexOf('<起点>')` 到 `app.indexOf('<边界>')`
切片后用 `new Function` 执行，或只断言切片内容。**注释行本身即契约**，不得改名、不得移位：

| 切片起点 | 边界锚点 | 用途 |
| --- | --- | --- |
| `function renderCommonLinks` | `// ---------- 视图切换 ----------` | 抽装 renderCommonLinks 执行 |
| `async function loadDaily` | `function shiftDaily` | 日报竞态断言 |
| `async function toggleStar` | `// 卡片交互` | 星标视图取消后整表重载断言 |
| `if (event.key === 'Escape')` | `if (event.altKey` | 词库面板抢占 Esc 断言 |
| `function formatBytes(bytes)` | 行首 `}` | 整体抽函数执行 |

app.js 全部区段注释（顺序固定，是导航也是边界）：
状态 / 动效与滚动 / 主题 / 界面缩放 / 工具 / 主题化确认 / 剪贴板与文件导出 / 塔台状态 /
卡片渲染 / 日报 / 信源 / 设置 / 云幄 · 常用网址 / 视图切换 / 检索 /
核心词库面板 / 键盘快捷键 / 滚动态：导航加重、回到顶部 / 实时更新 /
自动更新提示（仅桌面壳内生效）/ 启动。

---

## 7. renderer/styles.css —— 锁定规则清单

测试归属：`test/typography.test.js`、`test/responsive-layout.test.js`、
`test/renderer-integration.test.js`。

### 7.1 排版契约（typography.test.js）

- **根字号唯一行**：全表只允许一行 px 字号，且必须是
  `font-size: calc(clamp(15px, 14px + .15625vw, 18.5px) * var(--ui-scale));`
- **九档字号阶梯**：`--t-2xs --t-xs --t-sm --t-base --t-md --t-lg --t-xl --t-2xl --t-3xl`，
  顺序固定、全部 rem、单调递增、`--t-base: 1rem`、最小档 ≥ `.75rem`
- **四档缩放**：`:root[data-ui-scale="sm|md|lg|xl"] { --ui-scale: <倍率>; }` 各一行，
  倍率单调递增且 md = 1
- **字体栈三行**（及其派生）：
  - `--font-latin: 'Times New Roman',`
  - `--font-hans: 'Source Han Sans SC', 'Noto Sans SC',`
  - `--font-sans: var(--font-latin), var(--font-hans);`
  - `--font-display/ui/body/mono: var(--font-sans);` 四行
  - 禁止残留：`Smiley Sans / SmileySans / FangSong / 仿宋 / Cascadia Mono / Consolas / monospace`
- **间距/圆角/栏宽全 rem**：`--sp-*`、`--radius-*`、`--shell`、`--gutter`
- 字距不得用整数 px（必须 em）；行高不得用 px（必须无单位倍数）
- `body { … line-height: 1.75;`；长文选择器组
  `.card-summary, .cr-text, .hint, .empty-state p, … line-height: 1.9;`
- **`[hidden]` 兜底**：`[hidden] { display: none !important; }` 逐字存在；
  禁止 `.xxx:not([hidden])` 补丁与 `.lexicon-panel[hidden]` 残留
- 顶栏换行：`.tower {\n  display: flex; flex-wrap: wrap;`；
  `.stat-label` 与 `.brand-text p` 带 `white-space: nowrap;`
- 主样式表不得以 `@import` 开头（字体表走并行 `<link>`）

### 7.2 响应式契约（responsive-layout.test.js）

- **body 容器查询**：`body { … container-type: inline-size; … container-name: app; }`，
  配合 `@container app (max-width:` 断点（阶段 2 后共 10 处 @container app）
- 内在尺寸网格：`.common-links-grid`、`.src-list` 必须
  `grid-template-columns: repeat(auto-fit, minmax(min(100%, …`；
  `.settings-grid`、`.storage-breakdown`、`.maintenance-action-grid` 均 `repeat(auto-fit,`
- `.feed-layout` 单列栅格：`grid-template-columns: 1fr;`，容器查询降列规则
  保留以兼容窄容器断言；
- **8 处 flex-wrap 锁定选择器**（`flex-wrap: wrap;` 逐字）：
  `.tower`、`.tower-actions`、`.nav`、`.nav-tabs`、`.nav-filters`、
  `.feed-toolbar`、`.daily-actions`、`.btn-row`
  （另有 `.daily-archive-actions` 单独断言）
- 表单不撑破：`.field input, .field select, .field textarea { … min-width: 0; … width: 100%;`
- `.glass-dialog { … max-height: min(92vh, 45rem); … overflow: auto;`
- 长文/长路径断行：`.hint, … overflow-wrap: anywhere;`、`.daily-archive-path … overflow-wrap: anywhere;`
- `@container app (max-width: 45rem)` 下 `.daily-archive-status-grid { grid-template-columns: 1fr;`

**阶段 2 响应式补全（新增，锁定）**
- `.feed-sentinel` 哨兵样式存在
- `@container app (max-width: 53.75rem)` 下：`.lexicon-panel` 收窄内边距与 max-height；
  `.maintenance-stats { grid-template-columns: 1fr 1fr;`（存储治理中间宽度先降栏）；
  `.daily-head` 收紧间距
- `@container app (max-width: 45rem)` 下：`.glass-dialog` 内边距收敛为 `var(--sp-5)`、
  `.glass-dialog h3` 降为 `var(--t-lg)`；`.daily-title { flex-basis: 100%;`、
  `.daily-actions { width: 100%;`（标题独占一行、动作组整行居中）

### 7.3 组件契约（renderer-integration.test.js）

- **content-visibility 两行**：
  - `.card { … content-visibility: auto; … contain-intrinsic-size: auto 18rem;`
  - `.daily-section { … content-visibility: auto; … contain-intrinsic-size: auto 20rem;`
- 常用网址：`.common-links-head / .common-links-categories / .common-links-grid /
  .common-links-card / .common-links-favorite.is-active / .common-links-open`、
  `@container app (max-width: 45rem)`；`.common-links-card` 用 `var(--glass-border)`；
  `.common-links-favorite.is-active` 用 `var(--c-teal)`
- 桌面开关：`.desktop-switch`、`.switch-track`
- 信源退避：`.src-backoff`、`.src-card.is-failing`
- 存储维护：`.maintenance-stats`、`.storage-breakdown`、`.maintenance-action-grid`
- 技术突破：`.breakthrough-pill`、`.breakthrough-explanation`
- 实体与事件：`.card-entity`、`.card-events`
- 星标：`.tab-count`、`.card-act`、`.star-toggle.is-on`、`.card-foot-gap`
- 导出与备忘：`.copy-scratch`、`.note-list`
- 词库面板：`.lexicon-panel`、`.lexicon-terms`、`.lex-term`、`.lex-count`、`.lex-term.is-empty`；
  `.tower-actions { … position: relative`（绝对定位面板的定位基准）

### 7.4 液态玻璃阶段 1：令牌族与装饰节点登记（纯 CSS，新增）

**动效令牌族（:root，追加在既有动效令牌后）**

下表为阶段 1 历史值；v0.2.7 候选更新值及清理语义见 7.5。

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--dur-snap` | `160ms` | 开关/按压类即时小反馈 |
| `--dur-glide` | `480ms` | 浮层与光斑的大面积缓过渡 |
| `--spring-light` | `cubic-bezier(.3, 1.2, .4, 1)` | 轻快微弹：胶囊、图标等小控件 |
| `--spring-medium` | `cubic-bezier(.34, 1.56, .5, 1)` | 标准液态弹：浮层悬停、.glass 基元默认档 |
| `--spring-heavy` | `cubic-bezier(.3, 1.8, .4, 1)` | 沉稳大弹性：大幅位移强调动画 |
| `--veil-blur` | `blur(6px)` | sticky 日期标题薄纱模糊强度（date-head 引用，替代原硬编码） |

既有 `--ease-spring: cubic-bezier(.34, 1.4, .44, 1)` 逐字保留作为历史别名。

**双主题玻璃令牌（值升级，声明点不增不减）**

- `--glass-blur`：升级为 blur + saturate + brightness 组合（暗 `blur(28px) saturate(170%) brightness(1.06)`；
  亮 `blur(22px) saturate(150%) brightness(1.03)`）
- `--glass-bg / -deep / -soft`：双层渐变（主渐变三档透明度分层 + color-mix 青色辅光自右下漫入），
  两主题各一套
- `--glass-border-strong / --glass-shadow / --glass-shadow-lift`：高光更锐、海拔近影密远影软拉开层次
- `--card-bg / --card-shadow / --card-shadow-lift`：近实底液态微渐变 + 双层柔影（卡片维持素面决策，
  未引入 backdrop-filter，历史决策注释见 styles.css .card 块上方）

**本阶段新增令牌（两个主题块各一套，暗/亮取值不同）**

| 令牌 | 消费方 |
| --- | --- |
| `--glass-specular` | `.glass::before` 顶部宽镜面光带 |
| `--glass-rim` | `.glass::after` 内顶光/边缘折射高光（inset、pointer-events: none） |

**.glass 基元液态化**：悬停微浮起（`translateY(-2px)` + `--glass-shadow-lift`，仅
transform/box-shadow 过渡，曲线取 `--spring-medium`）；`backdrop-filter: var(--glass-blur);`
与其 `-webkit-` 前缀行逐字不动（perf-guard 计数锚点）。

**氛围层装饰节点（index.html .atmosphere 内，只增不改）**

- `<div class="blob blob-a"></div>`、`<div class="blob blob-b"></div>`（位于 .comet 之后、.grain 之前）；
  CSS 用 radial-gradient 光斑 + 元素 filter: blur(70px) 柔化，定位取 inset 安全百分比，不造成横向溢出
- 动画仅新增一组 `blob-drift`（两枚光斑错相复用），@keyframes 基线 18 → 19，
  上限 20，余 1 组；后续新增动效前必须先考虑复用既有组
- 已纳入 `body.is-idle … { animation-play-state: paused; }`（同口径追加 `body.is-idle .blob`，
  renderer-integration 的字面断言已同批更新并注明原因）与
  `@media (prefers-reduced-motion: reduce)` 的 `animation: none` 选择器列表

**阶段 2：交互缓动弹簧化口径与 transition 属性豁免清单（新增）**

缓动升级只改令牌引用与时长，不改选择器结构；颜色族 transition
（color/background/border-color/box-shadow 等）保留原 `--ease` 缓动，
仅 transform 类位移换弹簧曲线，避免观感一次性失控：

| 批次 | 选择器 | 口径 |
| --- | --- | --- |
| 悬停浮起（卡片级） | `.card`、`.common-links-card` | transform/box-shadow → `--spring-medium` + `--dur` |
| 悬停浮起（小控件） | `.lex-term`、`.btn-icon`、`.btn-primary`/`.btn-ghost`、`.src-card`、`.new-flash`、`.common-links-open`、`.update-pill` 等 | transform → `--spring-light` + `--dur-snap` |
| 按压缩放 | 全站通用 `:active` 组 + `.to-top:active` | `:active` 内独立声明 `transition: transform var(--dur-snap) var(--spring-light)`，抬起回落基线过渡自然带弹 |
| 弹层进出 | `.toast`、`.to-top`、`.glass-dialog`（v0.2.3 起开合都走 transition + @starting-style）、`.lexicon-panel.is-open`（消费 dialog-in） | `--spring-medium`，浮层入场配 `--dur-glide`、常驻浮层配 `--dur` |
| tab 指示块 | `.tab-indicator` | transform → `--spring-medium` + `--dur`；width/height 保留（见豁免） |
| 既有入场消费方 | view-in（`.view`/`.common-links-card`/`.empty-state`）、card-in、flash-in、reveal、star-pop | 关键帧本体不动，消费处 timing-function 换 `--spring-medium`/`--spring-light`，不新增关键帧 |

配套治理：全表 15 处 `transition: all` 已改为显式属性清单（all 会隐式
带上全部布局属性）；开关滑块 `.switch-track::after` 的过渡限定为
transform + background。perf-guard 新增「transition 只过渡合成层友好
属性」断言：白名单为 transform / opacity / visibility 与颜色族，出现
布局类属性（width/height/top/left/right/bottom/margin/padding）或 all
即失败；唯一显式豁免是 `.tab-indicator` 的 width/height（跟随目标 tab
实测尺寸，脚本写 --ti-w/--ti-h，尺寸跟随没有 transform 等价物），
styles.css 该块内有同口径豁免注释。全部改动均被既有
`prefers-reduced-motion: reduce` 的全局 1ms 兜底覆盖，本阶段未新增
循环动画，body.is-idle 暂停口径不变。

**阶段 3：WAAPI 动效引擎、fx-tier 运行时档位与视图切换改造（新增）**

*运动引擎落点*：当前 script 预算 27/27 已用尽，引擎内联进既有
`renderer/dom-utils.js`，新增导出 `DomUtils.createMotion(deps)` 工厂
（UMD + Object.freeze，matchMedia/document/rAF 经 deps 注入）：

| API | 语义 |
| --- | --- |
| `spring(el, { keyframes \| from/to, duration, stiffness, delay })` | 优先 `el.animate()`；预烘焙帧（11 帧，落在 8-12）走 linear，双帧走弹簧 bezier；终态先落 inline，`fill: 'backwards'` 保 delay 期应用首帧不闪现（评审修复轮登记）；结束后取消动画对象，rAF 仅作再等一帧的可选优化，缺失时直接取消 |
| `fadeSlideIn(el, opts)` | translateY 10px→0 + opacity 0→1，默认 320ms（可覆写，视图切换用 260ms） |
| `staggerIn(els, opts)` | 错峰入场，上限 `STAGGER_LIMIT = 8` 截断，delay 逐节点递增 45ms（可覆写），返回实际参与数 |

reduced 偏好或 `data-fx-tier="static"` 一律直接落终态不播动画；
`el.animate` 缺席或抛错同样优雅降级，动画始终是增强层。
消费方：view-registry（switchView 只对切换后显示的目标面板播一次
fadeSlideIn，删除了 `animation:none + void offsetHeight` 强制重排重放，
显隐/onEnter/onLeave/refreshStats/scrollToTop 时序不变）、feed-card
（createFeedDiffList 的 reconcile/prependFresh 仅对本次实际新建行调
staggerIn，motion 为可选依赖）。test/view-registry 原对重放手法的断言
同批升级为行为级断言（motion 被调用/只作用于显示面板/未注入静默退化）。

*fx-tier 档位表*：app.js 启动时即席推导写 `document.documentElement.dataset.fxTier`，
不进 store、不持久化、不进 UI_PREFERENCE_FIELDS：

| 档位 | 推导条件 |
| --- | --- |
| `static` | prefers-reduced-motion 命中 |
| `lite` | navigator.deviceMemory ≤4 或 navigator.hardwareConcurrency ≤4 |
| `full` | 其余 |

*覆盖块口径*（styles.css 尾部独立区段）：`[data-fx-tier="lite"]` 只改
`--glass-blur: blur(8px) saturate(110%)` 与 `--dur-glide: 320ms` 两个令牌的
值；`[data-fx-tier="static"]` 置 `--glass-blur: none` 并对
`.aurora/.stars/.comet/.blob` 写 `animation: none`（与既有 reduced 媒体
查询双保险）。关键口径：覆盖块只改 `--glass-blur` 令牌的值，不新增
滤镜声明点（消费处仍读同一令牌，计数维持 9 处）、不新增关键帧；
区段注释避开被计数的英文字面词。

*主题切换平滑过渡*：applyTheme 写 data-theme 前给 body 挂临时
`theme-transition` 类（styles.css 定义该类下 color/background-color/
border-color 的 260ms 短过渡），约 320ms 后由定时器移除；首帧与
reduced 偏好不挂类，避免常驻全表 transition 拖累滚动。

**评审修复轮：动效收敛与降级口径登记（新增）**

- `.glass` 悬停上浮限定非 sticky 玻璃浮层：选择器改为
  `.glass:not(.nav):hover`。`.nav` 是 sticky
  容器，悬停不得整体位移（且 .nav 自身 transition 声明会级联覆盖 .glass
  的过渡，造成无过渡瞬时跳变）；悬停浮起语义不变，仍只过渡
  transform/box-shadow。
- diff 新建行入场收敛（stagger 与 card-in 不双跑）：motion.staggerIn
  命中的行由 feed-card staggerCreated 挂 `.stagger-in` 并清除卡片的 inline
  animationDelay，styles.css 以 `.stagger-in .card { animation: none; }`
  关掉行内卡片的 CSS 入场，入场只走行级运动引擎；复用行经
  refreshRowCard 摘除该类，卡片 CSS 入场（含 inline 延迟）保持原样；
  首屏整表渲染路径（renderTimeline/renderRanked/appendPage）不挂标，
  原有 CSS 入场不变；错峰上限之外的新建行同样不挂标，继续走卡片 CSS
  入场，不出现入场空档。
- fx-tier lite 档关停氛围光斑：`[data-fx-tier="lite"] .blob { animation: none; }`
  与 static 同口径，仅 full 档保留 blob-drift；lite 档同时保留降模糊
  （--glass-blur）与缩短光斑缓过渡（--dur-glide）两个令牌降级。
- 运动引擎清理口径：spring 的 `el.animate` 选项 `fill` 只取 backwards
  （delay 期应用首帧，避免错峰延迟期以 inline 终态闪现）；终态由 inline
  settle 保证，结束后的取消链不以 rAF 为必要依赖，rAF 缺失时直接取消，
  rAF 仅作「再等一帧」的可选优化。
- is-idle 口径：实现（document.hidden || !document.hasFocus()）与
  renderer-integration 的字面断言不动，仅同批修正 styles.css / app.js
  注释口径为「页面隐藏或失焦」。
- 阴影阶梯海拔消费口径（v6.5 令牌族收尾）：`--shadow-sm` → `.src-card:hover`（悬停微浮起）、
  `--shadow-md` → `.lexicon-panel`（页内锚定的中型浮层，z-index 60）、
  `--shadow-lg` → `.glass-dialog`（最高层模态弹层）。词库面板终审由
  `--shadow-lg` 降为 `--shadow-md`：它压在滚动正文之上但非模态，
  中档海拔语义更准，且与模态弹层拉开层级；`.to-top` 等玻璃浮层
  控件继续走 `--glass-shadow` 玻璃令牌族，不与阴影阶梯混用。

---

### 7.5 v0.2.7 候选：最新意图、可中断运动与运行中清理

本节描述当前开发分支，发布状态与失败证据见 `docs/v027-validation.md`；
7.4 中的阶段值与旧演进记录保留供追溯，以本节说明当前变化。

- 导航仍先更新选中态与面板显隐，取消离开面板的运动；onLeave 在
  onEnter 之前、refreshStats 在 scrollToTop 之前。续跑将壳层刷新与
  滚动复位提前到控制器写入新内容前，避免 scrollTo 同步计算新内容和
  首次字体布局；旧视图调度测试与真实导航/焦点回归继续验证结果。

- createMotion 三档默认时长为 light 160ms / medium 260ms / heavy 320ms，
  fadeSlideIn 默认位移 6px，staggerIn 默认步长 25ms，上限八节点（175ms）。
  显式调用参数仍可覆盖，旧依赖行为不变。
- 同一元素只持有最新 Animation；`cancel(el)`、`cancelTree(root)`、
  `cancelAll()` 与 `dispose()` 负责释放。reduced-motion change、
  visibilitychange 和 window blur 立即清理；隐藏/失焦/static 时直接终态。
  `restoreStyles:true` 用于 Toast、按钮、词库、新行，结束或取消后恢复原
  inline；默认 false 保持旧视图入场的终态写入契约。
- `--dur-slow` 与 full 档 `--dur-glide` 为 280ms；medium 曲线为
  `cubic-bezier(.22, .9, .3, 1)`，heavy 为 `cubic-bezier(.2, .8, .3, 1)`。
  light 与历史别名保持原值，lite 档沿用已有令牌覆盖。
- `.view` 与词库不叠加 CSS 入场；信息流新增行全部关闭重复卡片入场，
  只选当前可见的前八个新行播 WAAPI。注入 motion 时复用行标记
  `.motion-reused`；没有此增强依赖时保持旧快照契约。
- 阅读中的新情报通知使用 sticky 与等额负下边距，保持文档流高度不变，
  避免滚动锚定推移正文；复用 `--stack-top` 在粘顶工具栏下显示，保持键盘
  可达和原点击加载行为。真实取证同时检查滚动、焦点、可见性与点击命中。
- 主题同步更新 state/DOM、原生主题 IPC 与持久化意图；按钮反馈 140ms，
  颜色过渡 260ms、临时类 320ms 后清除。reduced-motion/visibilitychange
  清掉临时类。颜色过渡收敛到主要表面/控件，不再全子树逐属性过渡。
- 静态档与 body.is-idle 的 CSS animation/transition 直接关闭，包括伪元素；
  full/lite 前台档仍播放既有氛围与交互运动。Aqua/DSH 的图形引擎未改。
- 列表重置保留原骨架和最短驻留；aria-busy 与工具栏提供等待反馈。
  请求返回时复核 view/domain/category/q 及输入框最新意图；实时轮询同时
  校验序号与上下文，并把卡片内焦点视为阅读状态。
- 确认框每次清空 returnValue，取消不能继承上次 OK；旧 close 事件不能
  清掉重新打开命令面板的 ARIA/焦点；词库选词把焦点交给检索框。

原冻结文件与失败样本保留。用户明确续跑后只纠正真实前台、语义颜色及
确认结果的观测时序；旧版本相关测试同步目标版本，行为、预算、阈值和
原测试数量不变，见 `docs/v027-protocol-2.md`。当前本地869单元与12桌面
回归通过，仍须独立CI和参考作品体验完成后才能正式发布。

## 8. 性能护栏基线（test/perf-guard.test.js）

静态预算，阈值 = 当前值 + 小幅余量；重构阶段不得使这些数字上升：

| 指标 | Aqua 外壳升级后基线 | 护栏上限 |
| --- | --- | --- |
| 页面实际加载的全部本地 CSS | ≈ 293,000 B（约 286 KiB，含字体分片索引、v0.2.0 intel.css、v0.2.3 模型设置与 v0.2.4 命令面板） | ≤ 292 KiB |
| index.html `<script>` 标签总数 | 27（v0.2.0 新增合并后的 intel-views.js） | ≤ 27 |
| 全部已加载 CSS 的 `@keyframes` 数量 | 20 | ≤ 20 |
| loadFeed 段内 `#feedList` 整表 `list.innerHTML =` 调用点 | 3（阶段 4 由 4 下调） | ≤ 3（防回退，无余量） |
| 全部已加载 CSS 的 `backdrop-filter` 声明 | 9 | ≤ 10 |

除数字预算外还有定性护栏。其一（阶段 2 新增，液态玻璃阶段 4 登记）：
transition 过渡属性白名单断言「transition 只过渡合成层
友好属性，布局类属性与 all 不参与过渡」——先剥注释再解析全部
transition 声明，允许 transform / opacity / visibility 与颜色族，出现
布局类属性或 `all` 即失败；唯一豁免 `.tab-indicator` 的 width/height
（尺寸跟随无 transform 等价物，见第 7.4 节豁免清单）。该护栏无数值
基线，口径以本节与第 7.4 节阶段 2 登记为准。
其二（液态玻璃阶段 3 新增，fx-tier / motion 定性护栏，见第 7.4 节阶段 3）：
styles.css 与 aqua-shell.css 的 fx-tier 覆盖只允许通过令牌降载，
不得新增滤镜声明点（backdrop-filter 计数维持 9 处）、不得
新增关键帧组（计数见上表），区段注释避开被全文计数的英文字面词；
动效引擎（dom-utils.js 的 createMotion）始终是增强层——reduced 偏好或
`data-fx-tier="static"` 一律直接落终态，`el.animate` 缺席或抛错同样
优雅降级，不得把动画变成关键路径。

脚本标签预算上调说明（9/10 → 11/20 → 22/25 → 24/25 → 25/25）：模块化拆分必然把单一大文件拆成
多个职责单一的 UMD 模块，每个模块需要一条 `<script src>` 引用；这些都是本地静态文件，
加载开销可忽略（无网络、无 CDN，后续还可加 `defer`），换来的是依赖注入可测性与
绞杀者式演进空间。这是护栏的有意演进，不是绕过；批 4 新增
common-links-controller 后基线为 24；Aqua 外壳只新增一个集中式
`aqua-shell.js` 后到达 25，与上限持平，预算正式用尽——
后续任何阶段都不得再新增脚本标签（只准在既有模块内迁移或合并）。
若需要突破 25 说明模块又在碎片化，应合并职责相近的模块，而不是继续放宽预算。

v0.2.0 上调说明（26/26 → 27/27，CSS 250 → 275 KiB）：新增“当前热点”“一级市场”两个一等视图与刊期（周报、月报）。
表示层（IntelRender）与两个视图控制器按上面的原则**合并**为单一的 `intel-views.js`，只净增一个脚本边界；
新增样式集中在 `intel.css`（约 18 KiB），发布前逐一核对了 styles.css 与 aqua-shell.css 的类选择器，
没有可清理的死规则。两项上限都只覆盖本次新增，没有预留余量。

v0.2.3 上调说明（CSS 275 → 292 KiB，脚本仍 27/27，关键帧仍 20/20）：设置页「模型」一节照搬 DeepSeek Harness 的
Models 页（提供商行、编辑卡、模型目录编辑器、添加卡分段切换、勾选弹窗），样式约 15 KiB，集中在 styles.css
末尾的「v0.2.3 模型设置」区段；可读性与动效升级约 3 KiB。脚本**没有**新增：模型设置按「设置表单」职责并入
既有的 `settings-form-controller.js`。新动效全部复用既有关键帧（card-in、spin、shimmer）或走
transition / @starting-style / View Transitions，关键帧总数不变。

v0.2.4 说明（预算不上调：CSS 仍 ≤ 292 KiB，脚本 27/27，关键帧 20/20，backdrop-filter 9/10）：命令面板与键盘
浏览样式约 3.4 KiB，集中在 styles.css 的「v0.2.4 命令面板」区段，复用 `.glass-dialog` 的材质与开合过渡，
不新增关键帧与滤镜；腾挪空间来自字体分片索引的无损压缩（去掉逐块注释与缩进，声明逐字不变，约 −5.6 KiB）。
行为并入既有的 `shortcuts.js`（`createCommandPalette` / `rankCommands`），不新增脚本标签。

v0.2.5 说明（预算不变：CSS ≈ 292,300 B ≤ 292 KiB，脚本 27/27，关键帧 20/20，backdrop-filter 9/10）：标题栏改为无缝——
`.desktop-titlebar-liquid-glass` 去掉描边、投影、`::before` / `::after` 流动高光与独立底色，只留一层 12px 模糊并用
`mask-image` 自上而下淡出（scroll edge effect），backdrop-filter 处数不变；滚动条去掉 html 上的
`scrollbar-width` / `scrollbar-color`（Chromium 121 起它们会让 `::-webkit-scrollbar` 定制整体失效），改为 14px 轨道 + 8px 胶囊。

说明：阶段 4 起 feed 整表赋值的 3 个落点分别是 骨架屏、空态、失败态；
正常数据整表重载改走 keyed diff 调和（`diff.reconcile`），分页追加走
`diff.appendPage`，实时新条目走 `diff.prependFresh` 前置插入，三者都不产生
整表 innerHTML 赋值。perf-guard 另有关联断言：feed-controller 必须出现
`diff.reconcile(`/`diff.appendPage(`，realtime-poller 必须出现 `diff.prependFresh(`，
防止退回字符串模板整表拼接。

### v0.2.8 原始偏好与滚动条

原始偏好统一在 ui-preference-schema.js，不含个人资产或密钥。新用户为浅色、背景效果关闭；已有文件与浏览器配置优先，旧配置缺省字段使用旧默认值，false／0／空收藏不被覆盖。Aqua 恢复默认共用同一原始定义。

窗口滚动条的样式须同时覆盖 html 和 body 的轨道，留出标题栏高度 + 4px；只检查 html 的计算值不足以证明实际绘制正确。真实 Electron 回归使用截图像素检查首个滑块像素在标题栏之后，并验证拖拽、滚轮和键盘。内部列表不增加此空白。颜色跟随背景色相和深浅主题，壁纸及背景关闭使用中性色；强制颜色使用系统色。v0.2.9 起 #appViewport 在标题栏下方独立滚动，现有布局、脚本、动画与滤镜预算不变。

### v0.2.10 版本与交互运动

左上角 #appVersion 由 Desktop.version 或 GET /api/version 赋值；都读取 package.json，UI 不另存版本。选择块仍同步提交 --ti-x/y/w/h/o，但尺寸立即落定，过渡只插值 transform；重新选中同一几何不重播，中断从当前视觉矩形继续。新增局部选择块不进入按钮查询或键盘顺序。光波最多 4 个、单按钮最多 1 个；追光最多 1 个，仅 full 档开放，鼠标静止后停止 RAF。static、运行中减少动画与隐藏／失焦必须取消运动并保留可见选中态，退出销毁监听。CSS／脚本／关键帧／滤镜预算不变，测试以新增真实 Electron 用例及既有布局矩阵核验。

## v0.2.12 工作区补充契约

- 侧栏顺序为 `hot, featured, all, starred, daily, capital, releases, links, sources, settings`；`daily` 的公开名称为情报日志，日报／周报／月报仍使用原 ID 和接口。Alt+1–9／0 跟随上述顺序，G U 打开更新日志。
- `GET /api/releases` 立即返回 `{ items, currentVersion, lastSyncedAt, syncError }`；`GET /api/releases?sync=1` 同步 GitHub 正式版本，网络失败仍以 200 返回可用本机记录与明确状态。接口沿用原鉴权。
- `config/release-history.json` 包含 GitHub 39 个历史正式版本及本版说明；本版正文必须与 `RELEASE_NOTES.md` 一致。构建、版本校验和单元测试均检查此约定。
- 设置九章顺序由静态导航 `data-settings-target` 与卡片 `data-settings-section` 保持一致；实际滚动容器为 `#appViewport`，`aria-current=location` 仅标识当前章节。导航点击不改 URL／偏好；键盘点击把焦点交给标题，鼠标点击保留目录焦点。
- 日志控制器并入既有 `intel-views.js` 边界，设置导航并入 `settings-view-controller.js`，页面脚本仍为 27 条。样式／关键帧／滤镜预算沿用；CSS 的 CRLF 最坏口径为 298,334 B，低于 292 KiB 的 299,008 B。

### v0.2.13 工作区页头与日志横幅

八个页头共用 `.page-banner`：`.banner-copy` 放栏目、主标题及说明，右侧保留状态／操作／网址计数，`.banner-art` 为 aria-hidden 的轨道装饰。三种信息流共用面板但由 feed-controller 按 state.view 同步各自文案。时段问候在次级文字中显示；矮窗口不隐藏页头。文字分层入场复用运动引擎，轨道和轻闪复用 sweep／twinkle，lite／static 和减少动画停止持续运动，后台暂停，系统强制颜色隐藏装饰。

`.daily-toolbar` 同时容纳 #periodSwitch 与复制／导出／重新生成；`.daily-head` 紧随其后，独立展示日期、状态、生成信息、日期导航及 #dailyMetrics。日报使用精选和两领域统计，周／月报使用精选、热点及资本事件。读取时清除旧值、禁用日期与导出，失败显示恢复提示；竞态守卫阻止过期响应回填。日报专属操作范围沿用。布局矩阵覆盖十个视图、四窗口、四缩放共 160 个组合，断言精度沿用。v0.2.13 的 CSS CRLF 最坏口径 298,936 B，脚本 27、关键帧 20，预算未上调。

## v0.2.14 工作区布局补充

热点、情报日志加入同一 `.page-banner`，全工作区十个视图采用共享页头；#hotMeta 与 #hotDomains 的控制器绑定保持。情报日志出刊节奏 #dailySchedule 移入页头，工具栏保持周期与日报操作，报告概况宽屏两列、53.75rem 以下单列。#dailySub 只展示生成信息，三项统计由 #dailyMetrics 单独表达；状态、竞态、失败及日期边界沿用。

一级市场 #capitalTabs 使用六个等宽分区，面板 #capitalBody 以 aria-labelledby 关联当前分区。方向键／Home／End 只移动焦点，Enter／Space 原生点击激活；只有当前焦点入口参与顺序 Tab。#capitalTabHint 解释当前用途，领域、时间、标的范围、搜索带可见标签。#capitalDays 在公司热度与公司库禁用并隐藏，#capitalTimeNote 解释适用范围；热度实际周期由既有 API 响应在内容中展示。切换分区保留所有筛选，公司档案隐藏整组搜索标签。

沿用 160 项布局组合与原交互元素边界精度，原样式 292 KiB、脚本 27、关键帧 20 与滤镜预算均不变。v0.2.14 实测与发布证据见 [验证记录](v0214-validation.md)。

## v0.2.16 日期与更新入口

报告日期和 #dailyPrev／#dailyNext 同处 .daily-date-controls，日期在左右等宽按钮之间居中。宽屏导航区域为统计左侧的整块空间；窄屏在原高度内分行。既有横幅高度、报告操作、请求竞态与日期边界继续适用。

#updatePill 移入 .rail-footer，保留 SVG 和文本子节点，仅按状态改变属性。#updateProgress 提供确定进度，#updateStatus 按 10% 分段播报。手动检查 IPC 仅接受当前窗口 sender，并由协调器阻止并发、下载／安装中检查及 30 秒内重复请求。安装仍经 send 请求、仅在主进程 downloaded 状态启用，先优雅关闭后端再启动 NSIS。

环形进度以 SVG pathLength=100 对应百分比，未知进度复用 spin。低功耗和减少动画停止旋转，static 停止过渡，后台暂停，高对比度保留可见轨道。292 KiB、27 脚本、20 关键帧及滤镜预算保持不变。

## v0.2.17 动效与主题更新珠

#updatePill 保留固定圆形命中范围，尺寸从 2.75rem 增至 3.25rem；SVG viewBox=52，半径 23，描边 3.4。新增 .update-core 独立承载图标与数字，跟随外观色相生成的 --update-accent／--update-ink 在深浅主题中具有不同亮度，前景随主题立即切换。外环保持真实百分比，内芯的跟手 translate 与状态 transform 动画独立；选择跟手对象必须明确优先 .update-core，不能用按 DOM 顺序选到 .update-ring 的组合选择器。

DomUtils.createMotion 增加 revealText、unfold、layoutChange：文字最多六个语义层，保留完整中文；展开一次提交布局，对最多八个可见邻项通过 transform 做 FLIP，不做 height／width tween；局部裁切使用 clipPath，结束／取消必须恢复原 CSS。相同元素的双帧 spring 被打断时先采集当前视觉帧，旧回调不得覆盖新状态。五维图形通过 scaleX 填充，数值不参与动画计算。static 立即落定，lite 缩短语义过渡。

交互装饰继续委托监听与按需单个 RAF：最多两个表面和两个控件，页头星轨、内芯与图标提供小幅跟随，命中范围及正文不移动。离开／移除／禁用／滚动／后台／销毁都清理装饰及临时 translate；触摸与 forced-colors 不启用追光。滚入只观察九个静态设置章节，未入场内容仍然可见。details 立即改变原生 open 状态，Enter 与 Escape 沿用浏览器语义；dialog／popover 清理必须核对实际 open 状态，防止旧 close／toggle 事件影响重新打开的层。

维持 292 KiB、27 脚本、20 关键帧及 10 处玻璃滤镜的现有预算。新增断言归属 test/v0217-motion.test.js、test/e2e/v0217-motion.test.js，原 160 布局、48 刊期、32 更新入口矩阵保留。专项附加 96 组配色／材质／缩放检查，文字对比度 ≥4.5、环形前景对比度 ≥3。

## v0.2.19 报告日期位置

.daily-date-controls 在既有日期网格行内使用 align-self: start，让日期和两侧导航略微上移。标题留白、日期字号、横幅高度与统计分列保持；窄窗口按剩余空间自然适配。沿用原 48 组刊期布局及导出、复制、重新生成验收。
