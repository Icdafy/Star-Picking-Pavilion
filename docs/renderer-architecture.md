# 摘星阁 · 渲染层架构（阶段 3 后）

本文档描述阶段 3「app.js 绞杀者式模块化重构」完成后的 renderer/ 模块边界、
依赖注入约定与新增视图的准入规范。字面契约（被测试逐字断言的代码行）以
[docs/frontend-contracts.md](./frontend-contracts.md) 为准，本文只讲结构。

## 1. 分层与模块边界

```
index.html（静态路由，25 条 <script src>，预算已用尽）
└── app.js —— 组合根（643 行，液态玻璃阶段 3 后实测）
    │ 职责只剩三件事：
    │  1. state 声明与 UI 基础设施（api/toast/confirmGlass/主题/缩放）
    │  2. 依赖装配：把 $/$$/document/state/api/toast 等注入各工厂
    │  3. start() 启动序列（应用偏好 → 切视图 → 起轮询）
    │
    ├── 纯函数层（无 DOM、无状态）
    │   ├── format-utils.js     timeAgo/dateLabel/hhmm/formatBytes/delay 等
    │   └── feed-card.js        scorePill/breakthroughPresentation/entityChipsHtml…
    │
    ├── 状态与调度层
    │   ├── store.js            createStore：getState/setState/subscribe(selector, cb)
    │   └── view-registry.js    registerView({id, tab, onEnter, onLeave}) 查表调度
    │
    ├── 功能控制器层（一个视图/一条职责链一个工厂）
    │   ├── feed-controller.js          loadFeed/分页/哨兵预取 + 卡片交互委托/toggleStar
    │   ├── hot-rail-controller.js      热度栏逐行节点级更新
    │   ├── daily-view-controller.js    日报导航/重生成
    │   ├── sources-controller.js       信源增删与软停用
    │   ├── search-controller.js        检索防抖 + 词库面板
    │   ├── common-links-controller.js  常用网址渲染与焦点恢复
    │   ├── settings-view-controller.js 设置页接线（表单/桌面/归档/备忘）
    │   ├── stats-controller.js         塔台数字补间
    │   ├── export-controller.js        复制/另存为导出
    │   ├── realtime-poller.js          信号化实时轮询（18s）
    │   ├── update-pill.js              自动更新胶囊
    │   └── shortcuts.js                键盘快捷键
    │
    └── 基座（阶段 3 之前已有）
        ├── dom-utils.js / common-links.js / bootstrap.js
        ├── ui-preference-schema.js / settings-form-controller.js
        └── desktop-settings-controller.js / storage-maintenance-controller.js
            / daily-archive-controller.js
```

液态玻璃阶段 3 新增职责（不新建文件，script 预算 25/25 已用尽）：
dom-utils.js 除转义/安全 URL/焦点工具外，新增 `createMotion(deps)`
微型运动引擎（WAAPI，只做 transform/opacity）：spring/fadeSlideIn/
staggerIn 三个 API，matchMedia/document/rAF 经 deps 注入，reduced 偏好
与 static 档直接落终态；消费方为 view-registry（视图切换入场，替代
强制重排重放）与 feed-card 的 createFeedDiffList（reconcile/prependFresh
新建行错峰入场，可选依赖）。fx-tier 运行时档位由组合根 app.js 即席
推导写 `<html data-fx-tier>`（full/lite/static，不进 store/schema/持久化），
styles.css 尾部覆盖块只调 `--glass-blur`/`--dur-glide` 令牌值按档降载，
不新增滤镜声明点与关键帧；realtime-poller 的非关键刷新（热栏）经注入的
idle/rAF 批处理，主循环 setTimeout 自调度不变。

阶段 4 增量 diff 渲染引擎已接管 app.js 中剩余的卡片整卡模板：
cardInner 迁为 index.html 的 `<template id="cardTemplate">`，
renderTimeline/renderRanked/publishedTime/starredTime/DIM_NAMES 迁入
renderer/feed-card.js（createCardRenderer + createFeedDiffList），组合根
只剩 cardRenderer/feedDiffList 的装配与注入。

## 2. 依赖注入约定（所有新模块必须遵守）

1. **UMD 工厂 + Object.freeze + 双暴露**。模块外壳照抄
   `renderer/dom-utils.js` / `renderer/settings-form-controller.js` 的写法：
   `module.exports` 与 `window.X` 双暴露，Node 可 require，浏览器挂全局。
   导出对象与工厂返回值一律 `Object.freeze`。
2. **工厂体内禁止裸读 window/document**。一切 DOM 与全局能力经参数注入
   （`$`、`$$`、`document`、`navigator`、`IntersectionObserver` 等）。
   UMD 包装层的暴露写法（`typeof module === 'object'`）除外。
   每个模块都有对应 lint 式测试：`assert.doesNotMatch(source, /\bwindow\./)`
   + spawnSync 验证 require 不泄漏全局。
3. **依赖在工厂入口集中校验**，缺失即抛 `TypeError`，不允许运行到一半才
   发现缺依赖。可选依赖（如 feed-controller 的卡片交互层）用
   「注入了才接线」的方式降级。
4. **装配顺序造成的循环依赖用闭包懒解析**，不引入事件总线：
   `runTermSearch: term => searchController.runTermSearch(term)`、
   `registryDeps` 代理同此思路。
5. **状态共享靠引用**：`store = Store.createStore(state)` 持有同一个 state
   对象，控制器注入的 `state` 仍是原引用；UI 级状态切换（theme/textScale/
   domain）走 `store.setState`，跨请求的临时量（page/loading）直接改字段。
6. **竞态守卫统一用 `Bootstrap.createLatestRequestGuard()`**，由组合根创建
   后注入对应控制器，测试用假守卫驱动。

## 3. 契约清单位置

- 字面断言落点与切片边界：[docs/frontend-contracts.md](./frontend-contracts.md)
  第 6 节（含阶段 3 各批的锚点落点变更说明）；性能护栏预算见第 8 节。
- 测试即契约：
  - `test/renderer-integration.test.js` —— 集成级字面/行为断言总入口
  - `test/typography.test.js`、`test/perf-guard.test.js` —— 排版与性能护栏
  - `test/<模块名>.test.js` —— 每个 renderer 模块一个 Node 单测
    （lint/UMD 护栏 + 假依赖行为分支：竞态跳过、错误路径、空态）
- 纪律：被字面断言的代码行若移动/改写，必须在同一批变更里把断言升级为对
  新模块的 require 级/行为级断言，并在测试注释写明变更原因。禁止出现
  「代码已改、测试后补」的中间态。

## 4. 新增视图/面板准入规范

新增一个视图**只需一个注册 + 一段 HTML section**，不得改动 switchView：

1. 在 `renderer/index.html` 增加视图面板：
   `<section id="viewXxx" class="view" hidden>…</section>`，以及导航 tab：
   `<button class="tab" data-view="xxx" aria-controls="viewXxx">…</button>`。
2. 在 `renderer/app.js` 的视图注册区增加一条：
   `viewRegistry.registerView({ id: 'xxx', tab: '#viewXxx', onEnter: () => … })`。
   信息流家族视图另加 `isFeed: true` 并进入 `FEED_VIEWS` 集合
   （会同时获得筛选条、导出与实时轮询——这是语义承诺，不是样式）。
3. 视图自身逻辑写成新控制器工厂（遵守第 2 节约定）。**script 标签预算已
   用尽（25/25）**：新控制器不得新增 `<script src>`，应并入职责最接近的
   既有模块，或先合并现有模块腾出名额。
4. 同步更新契约：`docs/frontend-contracts.md` 的脚本清单与锚点清单、
   `test/renderer-integration.test.js` 的导航/视图断言、
   e2e 与响应式测试对 8 视图的枚举。

## 5. 演进记录（阶段 3 各批与阶段 4）

| 批次 | 内容 | app.js 行数 | 测试数 |
| --- | --- | --- | --- |
| 起点 | 单一巨文件 | ≈ 1800 | 502 |
| 批 1 | format-utils.js / feed-card.js 纯函数抽离 | — | 502 |
| 批 2 | 11 个功能控制器抽离 | ≈ 855 | 601 |
| 批 3 | store.js + view-registry.js（查表调度） | ≈ 826 | 615 |
| 批 4 | renderCommonLinks / toggleStar / 卡片交互委托迁出 | 707 | 624 |
| 阶段 4 | 卡片模板化（<template id="cardTemplate">）+ keyed diff 渲染引擎（feed-card.js 的 createCardRenderer/createFeedDiffList；feed-controller 走 reconcile/appendPage，realtime-poller 走 prependFresh） | 597 | 647 |
| 液态玻璃阶段 3 | WAAPI 动效引擎内联 dom-utils.js（createMotion）+ fx-tier 运行时档位 + 视图切换去强制重排 + 信息流错峰入场 + 轮询 idle/rAF 批处理 + 主题平滑过渡 | 643 | 673 |

script 标签：9 → 11 → 22 → 24 → 25（上限 25，预算已用尽，见 perf-guard
测试注释与契约文档第 8 节的上调说明）；阶段 4 全部新代码放进既有
feed-card.js / feed-controller.js / realtime-poller.js，未新增脚本。
app.js 未达「约 300 行」的最终形态，差额主体是组合根理应持有的 UI
基础设施（toast/api/主题/缩放/偏好持久化/视图注册与启动序列）；在脚本
预算封顶的约束下不再强行外移，避免为凑行数制造职责漂移的碎片模块。

阶段 4 测试基座：test/helpers/mini-dom.js（零依赖最小 DOM，含从 index.html
正则抽取并解析真实 <template> 的 templateFromHtml），支撑模板填充与
diff 调和的行为级断言（test/feed-diff.test.js）；perf-guard 整表赋值
上限由 4 下调为 3（骨架/空态/失败态），并新增 keyed diff 接入断言。
