# 摘星阁合并云幄常用网址 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将捕风司完整更名为摘星阁，并把云幄源码中的 14 个常用网址、分类筛选、星标持久化、稳定排序和系统浏览器外链能力原生合并进摘星阁。

**Architecture:** 保持现有 Electron + 原生 HTML/CSS/JavaScript + Node 后端架构。新增一个无依赖、可同时供浏览器和 CommonJS 使用的常用网址领域模块，由现有 `app.js` 负责 DOM 渲染和视图切换；品牌更名只改用户可见与内容身份字段，保留 `windcatcher` 内部兼容标识。

**Tech Stack:** Electron 42、Node.js 22、原生 JavaScript、HTML、CSS、Node `node:test`、Electron Builder。

---

## 文件结构

- Create: `renderer/common-links.js` — 云幄网址数据、分类、星标清洗、筛选和稳定排序。
- Create: `test/common-links.test.js` — 常用网址领域规则单元测试。
- Create: `test/renderer-integration.test.js` — 导航、视图、脚本接线和样式静态集成测试。
- Create: `test/branding.test.js` — 摘星阁用户可见品牌与内部兼容标识测试。
- Modify: `package.json` — 添加测试命令并更新产品品牌字段。
- Modify: `renderer/index.html` — 增加常用网址标签页与视图，更新品牌。
- Modify: `renderer/app.js` — 接入常用网址状态、渲染、事件与视图切换，更新注释品牌。
- Modify: `renderer/styles.css` — 增加摘星阁风格的网址视图，更新注释品牌。
- Modify: `electron/main.js` — 更新窗口标题。
- Modify: `server/index.js` — 更新启动日志品牌。
- Modify: `server/ai/pipeline.js` — 更新 AI 身份品牌。
- Modify: `build/make-icon.py` — 更新图标脚本说明品牌。
- Modify: `README.md` — 更新项目品牌标题与描述中出现的旧名。

### Task 1: 用测试锁定云幄常用网址领域规则

**Files:**
- Create: `test/common-links.test.js`
- Create: `renderer/common-links.js`
- Modify: `package.json`

- [ ] **Step 1: 添加测试命令并写失败的领域测试**

在 `package.json` 的 `scripts` 中加入：

```json
"test": "node --test test/*.test.js"
```

创建 `test/common-links.test.js`：

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ALL_CATEGORY,
  LINKS,
  STORAGE_KEY,
  getCategories,
  getDefaultFavoriteIds,
  parseFavoriteIds,
  filterAndSortLinks
} = require('../renderer/common-links');

test('迁入云幄源码中的全部 14 个合法网址', () => {
  assert.equal(LINKS.length, 14);
  assert.equal(new Set(LINKS.map(item => item.id)).size, 14);
  for (const item of LINKS) {
    assert.equal(typeof item.name, 'string');
    assert.ok(item.name.length > 0);
    assert.match(item.url, /^https?:\/\//);
    assert.equal(typeof item.category, 'string');
    assert.equal(typeof item.description, 'string');
    assert.ok(Array.isArray(item.tags));
    assert.equal(typeof item.pinned, 'boolean');
  }
});

test('分类保持云幄源码顺序并在最前提供全部', () => {
  assert.deepEqual(getCategories(), [
    '全部', '督办计划', '项目投资', '财税办公', '综合办公', '合同印鉴', 'AI'
  ]);
  assert.equal(ALL_CATEGORY, '全部');
});

test('默认星标完整保留云幄 pinned 配置', () => {
  assert.deepEqual([...getDefaultFavoriteIds()], [
    'key-work-progress',
    'work-plan',
    'industrial-investment-project-library',
    'industrial-investment-project-excel',
    'invoice-verification',
    'qichacha',
    'chengjian-oa',
    'seal-use-records',
    'contract-filing-records',
    'kimi-ai',
    'doubao-ai',
    'yuanbao-ai'
  ]);
});

test('缺失、损坏和非数组存储回退默认星标', () => {
  const expected = [...getDefaultFavoriteIds()];
  assert.deepEqual([...parseFavoriteIds(null)], expected);
  assert.deepEqual([...parseFavoriteIds('{bad json')], expected);
  assert.deepEqual([...parseFavoriteIds(JSON.stringify({ id: 'work-plan' }))], expected);
});

test('空数组有效且未知或重复 ID 被清洗', () => {
  assert.deepEqual([...parseFavoriteIds('[]')], []);
  assert.deepEqual(
    [...parseFavoriteIds(JSON.stringify(['travel-memo', 'missing', 'travel-memo']))],
    ['travel-memo']
  );
  assert.equal(STORAGE_KEY, 'zxg-common-links-favorites');
});

test('按分类筛选后星标优先且每组保持原始顺序', () => {
  const result = filterAndSortLinks({
    category: '项目投资',
    favoriteIds: new Set(['fund-project-excel'])
  });
  assert.deepEqual(result.map(item => item.id), [
    'fund-project-excel',
    'industrial-investment-project-library',
    'industrial-investment-project-excel'
  ]);
  assert.equal(result[0].isFavorite, true);
  assert.equal(result[1].isFavorite, false);
});

test('全部分类返回全部条目', () => {
  assert.equal(filterAndSortLinks({ category: ALL_CATEGORY, favoriteIds: new Set() }).length, 14);
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `npm test`

Expected: FAIL，错误包含 `Cannot find module '../renderer/common-links'`。

- [ ] **Step 3: 实现最小领域模块**

创建 `renderer/common-links.js`，使用以下结构和云幄 `src/main.jsx` 第 8–135 行的 14 个完整对象；迁入时逐字段复制，不改变 URL：

```js
'use strict';

(function exposeCommonLinks(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CommonLinks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCommonLinks() {
  const ALL_CATEGORY = '全部';
  const STORAGE_KEY = 'zxg-common-links-favorites';
  const rawLinks = [
    { id: 'key-work-progress', name: '重点工作推进情况', url: 'https://kdocs.cn/l/cdynqdek9Grz', category: '督办计划', description: '查看重点工作进展、阶段性推进情况和需要持续跟进的事项。', tags: ['重点工作', '推进情况', '跟踪'], pinned: true },
    { id: 'work-plan', name: '工作计划', url: 'https://www.kdocs.cn/l/ceLNYZKEnfVt', category: '督办计划', description: '汇总日常工作安排、计划事项和后续执行节点。', tags: ['计划', '安排', '节点'], pinned: true },
    { id: 'travel-memo', name: '外出备忘', url: 'https://www.kdocs.cn/l/cf4eyjJHmZdN', category: '督办计划', description: '记录外出事项、行程提醒和临时备忘内容。', tags: ['外出', '备忘', '提醒'], pinned: false },
    { id: 'industrial-investment-project-library', name: '产投项目库', url: 'https://www.kdocs.cn/ent/618840529/3001739888', category: '项目投资', description: '进入产投项目资料库，集中查看项目相关文档和信息。', tags: ['产投', '项目库', '资料'], pinned: true },
    { id: 'industrial-investment-project-excel', name: '产投项目Excel', url: 'https://www.kdocs.cn/l/cscKdxg3exuL', category: '项目投资', description: '打开产投项目台账表格，查看或维护项目清单数据。', tags: ['产投', 'Excel', '台账'], pinned: true },
    { id: 'fund-project-excel', name: '基金项目Excel', url: 'https://www.kdocs.cn/l/ch0RuMujDMQL', category: '项目投资', description: '打开基金项目台账表格，查看或维护基金项目数据。', tags: ['基金', 'Excel', '项目'], pinned: false },
    { id: 'invoice-verification', name: '发票查验', url: 'https://inv-veri.chinatax.gov.cn/index.html', category: '财税办公', description: '进入国家税务总局发票查验平台；如页面打不开，可在空白处输入 thisisunsafe 后回车。', tags: ['发票', '查验', '税务'], pinned: true },
    { id: 'qichacha', name: '企查查', url: 'https://www.qcc.com/', category: '综合办公', description: '进入企查查，查询企业工商信息、股权结构和经营风险。', tags: ['企查查', '企业查询', '工商信息'], pinned: true },
    { id: 'chengjian-oa', name: '城建OA', url: 'http://121.37.86.182:8088/seeyon/main.do?method=index', category: '综合办公', description: '进入城建 OA 办公系统，处理流程审批和日常办公事项。', tags: ['OA', '审批', '办公'], pinned: true },
    { id: 'seal-use-records', name: '印鉴使用记录表', url: 'https://f.kdocs.cn/g/GLu4FEL9/', category: '合同印鉴', description: '登记和查看印鉴使用记录，便于流程留痕和后续核对。', tags: ['印鉴', '使用记录', '登记表'], pinned: true },
    { id: 'contract-filing-records', name: '合同备案记录表', url: 'https://f.kdocs.cn/g/QfgmT3M7/', category: '合同印鉴', description: '登记和查看合同备案记录，集中维护合同备案台账。', tags: ['合同', '备案', '记录表'], pinned: true },
    { id: 'kimi-ai', name: 'Kimi', url: 'https://www.kimi.com/agent?chat_enter_method=change_model', category: 'AI', description: '进入 Kimi，处理长文阅读、资料梳理和中文对话任务。', tags: ['Kimi', 'AI', '长文'], pinned: true },
    { id: 'doubao-ai', name: '豆包', url: 'https://www.doubao.com/chat', category: 'AI', description: '进入豆包，进行日常问答、内容生成和办公辅助。', tags: ['豆包', 'AI', '问答'], pinned: true },
    { id: 'yuanbao-ai', name: '元宝', url: 'https://yuanbao.tencent.com/chat/naQivTmsDa?yb_channel=3009&yb_dl=js', category: 'AI', description: '进入腾讯元宝，进行 AI 对话、搜索和资料整理。', tags: ['元宝', 'AI', '腾讯'], pinned: true }
  ];
  const LINKS = Object.freeze(rawLinks.map(item => Object.freeze({
    ...item,
    tags: Object.freeze([...item.tags])
  })));

  function getCategories(links = LINKS) {
    return [ALL_CATEGORY, ...new Set(links.map(item => item.category))];
  }

  function getDefaultFavoriteIds(links = LINKS) {
    return new Set(links.filter(item => item.pinned).map(item => item.id));
  }

  function parseFavoriteIds(serialized, links = LINKS) {
    const fallback = () => getDefaultFavoriteIds(links);
    if (serialized == null) return fallback();
    try {
      const value = JSON.parse(serialized);
      if (!Array.isArray(value)) return fallback();
      const validIds = new Set(links.map(item => item.id));
      return new Set(value.filter(id => typeof id === 'string' && validIds.has(id)));
    } catch {
      return fallback();
    }
  }

  function filterAndSortLinks({ category = ALL_CATEGORY, favoriteIds = new Set(), links = LINKS } = {}) {
    return links
      .map((item, order) => ({ ...item, order, isFavorite: favoriteIds.has(item.id) }))
      .filter(item => category === ALL_CATEGORY || item.category === category)
      .sort((a, b) => a.isFavorite === b.isFavorite ? a.order - b.order : a.isFavorite ? -1 : 1);
  }

  return Object.freeze({
    ALL_CATEGORY,
    STORAGE_KEY,
    LINKS,
    getCategories,
    getDefaultFavoriteIds,
    parseFavoriteIds,
    filterAndSortLinks
  });
});
```

- [ ] **Step 4: 运行领域测试并确认通过**

Run: `npm test`

Expected: 7 tests passed, 0 failed。

- [ ] **Step 5: 提交领域模块**

```bash
git add package.json renderer/common-links.js test/common-links.test.js
git commit -m "feat: 添加云幄常用网址领域模块"
```

### Task 2: 用失败测试接入导航、视图和交互

**Files:**
- Create: `test/renderer-integration.test.js`
- Modify: `renderer/index.html`
- Modify: `renderer/app.js`

- [ ] **Step 1: 写失败的渲染层接线测试**

创建 `test/renderer-integration.test.js`：

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');

test('常用网址作为摘星阁顶部主导航的原生视图接入', () => {
  assert.match(html, /data-view="links"[^>]*>常用网址<\/button>/);
  assert.match(html, /id="viewLinks"[^>]*class="view"[^>]*hidden/);
  assert.match(html, /云幄\s*·\s*常用网址/);
  assert.match(html, /id="commonLinksCategories"/);
  assert.match(html, /id="commonLinksGrid"/);
});

test('领域模块在应用脚本之前加载', () => {
  const moduleIndex = html.indexOf('<script src="common-links.js"></script>');
  const appIndex = html.indexOf('<script src="app.js"></script>');
  assert.ok(moduleIndex >= 0);
  assert.ok(appIndex > moduleIndex);
});

test('视图切换、分类、星标和持久化均接入 app.js', () => {
  assert.match(app, /view:\s*'featured'.*links/s);
  assert.match(app, /#viewLinks/);
  assert.match(app, /renderCommonLinks/);
  assert.match(app, /commonLinksCategories/);
  assert.match(app, /commonLinksGrid/);
  assert.match(app, /CommonLinks\.STORAGE_KEY/);
  assert.match(app, /localStorage\.setItem/);
});
```

- [ ] **Step 2: 运行接线测试并确认缺少标签页而失败**

Run: `node --test test/renderer-integration.test.js`

Expected: FAIL，第一项失败信息包含 `data-view="links"`。

- [ ] **Step 3: 在 HTML 中增加标签、视图和脚本**

在“情报日报”之后增加：

```html
<button class="tab" data-view="links" role="tab" aria-selected="false">常用网址</button>
```

在 `viewSources` 之前增加：

```html
<section id="viewLinks" class="view" hidden>
  <header class="common-links-head glass">
    <div>
      <p class="common-links-kicker">云幄 · 常用网址</p>
      <h2 class="view-title">让常用系统安静、有序、即刻可达</h2>
      <p>统一收纳督办计划、项目投资、财税办公、综合办公、合同印鉴与 AI 工具入口。</p>
    </div>
    <div class="common-links-summary" aria-label="网址数量">
      <strong id="commonLinksCount">14</strong>
      <span>个常用入口</span>
    </div>
  </header>
  <div class="common-links-toolbar glass" aria-label="网址分类">
    <div id="commonLinksCategories" class="common-links-categories" role="group" aria-label="网址分类"></div>
  </div>
  <div id="commonLinksGrid" class="common-links-grid" aria-live="polite"></div>
</section>
```

在 `app.js` 前增加：

```html
<script src="common-links.js"></script>
```

- [ ] **Step 4: 在 app.js 接入状态、渲染和事件**

在工具常量之后加入：

```js
const CommonLinks = window.CommonLinks;

function loadCommonLinkFavorites() {
  try {
    return CommonLinks.parseFavoriteIds(localStorage.getItem(CommonLinks.STORAGE_KEY));
  } catch {
    return CommonLinks.getDefaultFavoriteIds();
  }
}
```

在 `state` 中加入：

```js
linksCategory: CommonLinks.ALL_CATEGORY,
commonLinksFavorites: loadCommonLinkFavorites(),
```

把视图注释更新为：

```js
view: 'featured',     // featured | hot | all | daily | links | sources | settings
```

在“设置”逻辑之后、“视图切换”之前加入：

```js
function persistCommonLinkFavorites() {
  try {
    localStorage.setItem(
      CommonLinks.STORAGE_KEY,
      JSON.stringify([...state.commonLinksFavorites])
    );
  } catch { /* 存储不可用时保留当前会话内状态 */ }
}

function renderCommonLinks() {
  const categories = CommonLinks.getCategories();
  $('#commonLinksCategories').innerHTML = categories.map(category => `
    <button class="common-links-category${category === state.linksCategory ? ' is-active' : ''}"
      data-links-category="${esc(category)}" type="button"
      aria-pressed="${category === state.linksCategory}">${esc(category)}</button>
  `).join('');

  const items = CommonLinks.filterAndSortLinks({
    category: state.linksCategory,
    favoriteIds: state.commonLinksFavorites
  });
  $('#commonLinksCount').textContent = String(items.length);
  $('#commonLinksGrid').innerHTML = items.map((item, index) => `
    <article class="common-links-card glass" style="animation-delay:${Math.min(index * 28, 280)}ms">
      <div class="common-links-card-head">
        <div>
          <span class="common-links-label">${esc(item.category)}</span>
          <h3>${esc(item.name)}</h3>
        </div>
        <button class="common-links-favorite${item.isFavorite ? ' is-active' : ''}"
          data-link-favorite="${esc(item.id)}" type="button"
          aria-pressed="${item.isFavorite}" title="${item.isFavorite ? '取消常用' : '设为常用'}">
          <span aria-hidden="true">${item.isFavorite ? '★' : '☆'}</span>
          ${item.isFavorite ? '已常用' : '设为常用'}
        </button>
      </div>
      <p>${esc(item.description)}</p>
      <div class="common-links-tags">${item.tags.map(tag => `<span>${esc(tag)}</span>`).join('')}</div>
      <a class="common-links-open" href="${esc(item.url)}" target="_blank" rel="noopener">打开 <span aria-hidden="true">↗</span></a>
    </article>
  `).join('');
}

$('#commonLinksCategories').addEventListener('click', event => {
  const button = event.target.closest('button[data-links-category]');
  if (!button) return;
  state.linksCategory = button.dataset.linksCategory;
  renderCommonLinks();
});

$('#commonLinksGrid').addEventListener('click', event => {
  const button = event.target.closest('button[data-link-favorite]');
  if (!button) return;
  const id = button.dataset.linkFavorite;
  if (state.commonLinksFavorites.has(id)) state.commonLinksFavorites.delete(id);
  else state.commonLinksFavorites.add(id);
  persistCommonLinkFavorites();
  renderCommonLinks();
});
```

在 `switchView` 中加入：

```js
$('#viewLinks').hidden = view !== 'links';
```

并在加载分支加入：

```js
else if (view === 'links') renderCommonLinks();
```

- [ ] **Step 5: 运行渲染层接线测试并确认通过**

Run: `node --test test/renderer-integration.test.js`

Expected: 3 tests passed, 0 failed。

- [ ] **Step 6: 运行完整测试并提交接线**

Run: `npm test`

Expected: 10 tests passed, 0 failed。

```bash
git add renderer/index.html renderer/app.js test/renderer-integration.test.js
git commit -m "feat: 接入云幄常用网址视图"
```

### Task 3: 用测试约束摘星阁主题下的网址视觉

**Files:**
- Modify: `test/renderer-integration.test.js`
- Modify: `renderer/styles.css`

- [ ] **Step 1: 添加失败的样式完整性测试**

在 `test/renderer-integration.test.js` 中读取 CSS 并增加：

```js
const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');

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
```

- [ ] **Step 2: 运行测试并确认因样式缺失而失败**

Run: `node --test test/renderer-integration.test.js`

Expected: FAIL，错误包含 `缺少 .common-links-head`。

- [ ] **Step 3: 添加完整的摘星阁风格样式**

在主内容样式之后加入以下前缀化规则，并使用现有主题变量：

```css
/* ---------- 云幄 · 常用网址 ---------- */
.common-links-head {
  display: flex; align-items: flex-end; justify-content: space-between; gap: 28px;
  margin-bottom: 16px; padding: 26px 28px;
}
.common-links-head .view-title { margin: 5px 0 6px; }
.common-links-head p:last-child { color: var(--c-fg-dim); max-width: 780px; }
.common-links-kicker {
  color: var(--c-teal); font-family: var(--font-display); font-size: 13px;
  font-weight: 700; letter-spacing: 3px;
}
.common-links-summary {
  display: flex; flex-direction: column; align-items: center; flex: 0 0 auto;
  min-width: 112px; padding: 10px 16px; border-left: 1px solid var(--rail-line);
}
.common-links-summary strong { color: var(--c-orange); font: 700 28px/1 var(--font-mono); }
.common-links-summary span { color: var(--c-fg-faint); font-size: 12px; margin-top: 6px; }
.common-links-toolbar { margin-bottom: 18px; padding: 12px 16px; }
.common-links-categories { display: flex; flex-wrap: wrap; gap: 7px; }
.common-links-category {
  border: 1px solid var(--glass-border); border-radius: 99px; background: transparent;
  color: var(--c-fg-dim); cursor: pointer; font-family: var(--font-body);
  font-size: 13px; padding: 6px 15px; transition: all var(--dur) var(--ease);
}
.common-links-category:hover { background: var(--hover-bg); color: var(--c-fg); }
.common-links-category.is-active {
  border-color: var(--c-teal); background: rgba(13,148,136,.1); color: var(--c-teal); font-weight: 700;
}
[data-theme="dark"] .common-links-category.is-active { color: #aef3e6; border-color: rgba(94,234,212,.4); }
.common-links-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(285px, 1fr)); gap: 16px; }
.common-links-card {
  display: flex; flex-direction: column; gap: 14px; min-height: 250px; padding: 22px;
  border-color: var(--glass-border); animation: view-in var(--dur-slow) var(--ease) backwards;
  transition: transform var(--dur) var(--ease), border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.common-links-card:hover { transform: translateY(-2px); border-color: var(--c-fg-faint); }
.common-links-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.common-links-label { color: var(--c-teal); font-size: 12px; font-weight: 700; }
.common-links-card h3 { font-family: var(--font-display); font-size: 21px; letter-spacing: 1px; margin-top: 5px; }
.common-links-card > p { color: var(--c-fg-dim); font-size: 14px; line-height: 1.65; }
.common-links-favorite {
  display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; border: 1px solid var(--glass-border);
  border-radius: 99px; background: var(--input-bg); color: var(--c-fg-dim); cursor: pointer;
  font-family: var(--font-body); font-size: 12px; padding: 5px 10px; transition: all var(--dur) var(--ease);
}
.common-links-favorite:hover { color: var(--c-fg); border-color: var(--c-fg-faint); }
.common-links-favorite.is-active { color: var(--c-teal); border-color: var(--c-teal); background: rgba(13,148,136,.08); }
.common-links-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.common-links-tags span {
  border: 1px solid var(--glass-border); border-radius: 99px; background: var(--hover-bg);
  color: var(--c-fg-faint); font-size: 12px; padding: 4px 9px;
}
.common-links-open {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; margin-top: auto;
  min-height: 40px; border: 1px solid var(--glass-border); border-radius: 99px;
  color: var(--c-fg); font-weight: 700; text-decoration: none; transition: all var(--dur) var(--ease);
}
.common-links-open:hover { color: var(--c-teal); border-color: var(--c-teal); transform: translateY(-1px); }
.common-links-category:focus-visible,
.common-links-favorite:focus-visible,
.common-links-open:focus-visible { outline: 2px solid var(--c-teal); outline-offset: 3px; }
@media (max-width: 720px) {
  .common-links-head { align-items: flex-start; flex-direction: column; padding: 20px; }
  .common-links-summary { align-items: flex-start; border-left: 0; border-top: 1px solid var(--rail-line); width: 100%; }
  .common-links-grid { grid-template-columns: 1fr; }
  .common-links-card-head { flex-direction: column; }
}
```

- [ ] **Step 4: 运行渲染层测试和完整测试**

Run: `node --test test/renderer-integration.test.js`

Expected: 4 tests passed, 0 failed。

Run: `npm test`

Expected: 11 tests passed, 0 failed。

- [ ] **Step 5: 提交视觉样式**

```bash
git add renderer/styles.css test/renderer-integration.test.js
git commit -m "style: 融合常用网址到摘星阁视觉"
```

### Task 4: 用失败测试完成捕风司到摘星阁的产品更名

**Files:**
- Create: `test/branding.test.js`
- Modify: `package.json`
- Modify: `renderer/index.html`
- Modify: `renderer/app.js`
- Modify: `renderer/styles.css`
- Modify: `electron/main.js`
- Modify: `server/index.js`
- Modify: `server/ai/pipeline.js`
- Modify: `build/make-icon.py`
- Modify: `README.md`

- [ ] **Step 1: 写失败的品牌与兼容性测试**

创建 `test/branding.test.js`：

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const brandedFiles = [
  'package.json',
  'renderer/index.html',
  'renderer/app.js',
  'renderer/styles.css',
  'electron/main.js',
  'server/index.js',
  'server/ai/pipeline.js',
  'build/make-icon.py',
  'README.md'
];

test('所有用户可见和内容身份统一为摘星阁', () => {
  for (const file of brandedFiles) {
    assert.doesNotMatch(read(file), /捕风司/, `${file} 仍含旧品牌`);
  }
  assert.match(read('renderer/index.html'), /<h1>摘星阁<\/h1>/);
  assert.equal(pkg.productName, '摘星阁');
  assert.equal(pkg.build.productName, '摘星阁');
  assert.equal(pkg.build.nsis.shortcutName, '摘星阁');
  assert.match(pkg.description, /^摘星阁/);
  assert.equal(pkg.author, '摘星阁');
});

test('内部兼容标识保持不变', () => {
  assert.equal(pkg.name, 'windcatcher');
  assert.equal(pkg.build.appId, 'com.windcatcher.app');
  assert.equal(pkg.build.win.artifactName, 'Windcatcher-Setup-${version}.${ext}');
  assert.match(read('server/db.js'), /windcatcher\.db/);
  assert.match(read('electron/preload.js'), /windcatcher/);
});

test('云幄名称在常用网址功能中保持不变', () => {
  assert.match(read('renderer/index.html'), /云幄\s*·\s*常用网址/);
});
```

- [ ] **Step 2: 运行品牌测试并确认旧品牌导致失败**

Run: `node --test test/branding.test.js`

Expected: FAIL，错误包含 `package.json 仍含旧品牌`。

- [ ] **Step 3: 更新 package.json 产品字段**

应用以下精确值：

```json
{
  "productName": "摘星阁",
  "description": "摘星阁 · 低空经济与商业航天热点情报站（聚合信源 + AI 精选，本地运行）",
  "author": "摘星阁",
  "build": {
    "productName": "摘星阁",
    "copyright": "Copyright © 2026 摘星阁",
    "nsis": {
      "shortcutName": "摘星阁"
    }
  }
}
```

只替换上述叶子字段，不覆盖 `build` 其他内容。

- [ ] **Step 4: 更新全部用户可见和内容身份旧名**

在测试列出的文件中逐处将中文旧品牌 `捕风司` 替换为 `摘星阁`。必须包括：

- `renderer/index.html` 的 `<title>` 与 `<h1>`。
- `electron/main.js` 的 BrowserWindow 标题。
- `server/index.js` 的启动日志。
- `server/ai/pipeline.js` 的两个系统身份提示词。
- `renderer/app.js`、`renderer/styles.css` 与 `build/make-icon.py` 的品牌注释。
- `README.md` 的项目标题和正文旧名。

不替换 `windcatcher`、`Windcatcher`、`com.windcatcher.app`、`windcatcher.db` 或 `window.windcatcher`。

- [ ] **Step 5: 运行品牌测试并确认通过**

Run: `node --test test/branding.test.js`

Expected: 3 tests passed, 0 failed。

- [ ] **Step 6: 运行完整测试并提交更名**

Run: `npm test`

Expected: 14 tests passed, 0 failed。

```bash
git add package.json renderer/index.html renderer/app.js renderer/styles.css electron/main.js server/index.js server/ai/pipeline.js build/make-icon.py README.md test/branding.test.js
git commit -m "chore: 将产品品牌更名为摘星阁"
```

### Task 5: 运行构建、运行时和视觉验收

**Files:**
- Modify only if verification reveals a defect: files already listed above

- [ ] **Step 1: 运行完整自动测试与静态检查**

Run: `npm test`

Expected: 14 tests passed, 0 failed。

Run: `git diff --check`

Expected: no output, exit 0。

Run: `npm ls --depth=0`

Expected: exit 0, no missing dependency。

- [ ] **Step 2: 验证 Electron Builder 配置与目录包**

Run: `npx electron-builder --win --dir --publish never`

Expected: exit 0，`dist/win-unpacked/摘星阁.exe` 存在，构建日志无配置错误。

- [ ] **Step 3: 启动本地服务进行浏览器运行时检查**

使用隐藏窗口启动服务：

```powershell
$zxgServer = Start-Process -FilePath node -ArgumentList 'server/index.js' -WorkingDirectory 'F:\摘星阁\捕风司' -WindowStyle Hidden -PassThru
```

打开 `http://127.0.0.1:7644/`，检查：

- 品牌显示“摘星阁”。
- 原六个视图可以切换。
- “常用网址”可以进入且显示“云幄 · 常用网址”。
- 全部显示 14 个条目；六个业务分类数量分别为 3、3、1、2、2、3。
- 默认星标为 12 个；切换“外出备忘”后置顶，刷新后仍保持。
- 深空夜航和宣纸白均无文字溢出、重叠、横向滚动或失焦不可见。
- 1440px、1080px 和 720px 以下宽度分别呈现合理多列、收缩多列和单列布局。

完成后停止该精确进程：

```powershell
Stop-Process -Id $zxgServer.Id
```

- [ ] **Step 4: 验证 Electron 外链策略**

检查 `electron/main.js` 的 `setWindowOpenHandler` 与 `will-navigate` 仍只把 `http:`/`https:` 交给 `shell.openExternal`。在 Electron 开发运行中分别点击一个 HTTPS 地址与“城建OA”的 HTTP 地址，确认均由系统浏览器打开，摘星阁窗口 URL 保持 `http://127.0.0.1:7644/`。

- [ ] **Step 5: 做要求到证据的最终审计**

逐项核对设计文档验收标准：

- 更名：品牌测试、HTML 实际显示、安装包可执行文件名。
- 云幄名称保持：品牌测试与常用网址标题。
- 摘星阁主体不变：原六视图运行时检查与无后端结构 diff。
- 常用网址完整：14 条数据测试、分类测试、运行时计数。
- 交互完整：筛选、星标、刷新持久化、稳定排序与外链检查。
- 范围受控：依赖树无 React/Vite，Git diff 不含云幄目录修改。

- [ ] **Step 6: 提交验证中产生的必要修复**

仅当 Step 1–5 发现并修复问题时执行：

```bash
git add -- package.json renderer/common-links.js renderer/index.html renderer/app.js renderer/styles.css electron/main.js server/index.js server/ai/pipeline.js build/make-icon.py README.md test/common-links.test.js test/renderer-integration.test.js test/branding.test.js
git commit -m "fix: 修正常用网址验收问题"
```

若没有产生修复，不创建空提交。

## 完成定义

- 所有自动测试、依赖检查和 Electron 目录构建通过。
- 设计文档中的每条验收标准都有当前运行产生的直接证据。
- Git 工作树干净，云幄目录未被修改，摘星阁原功能无回归。
- 只有满足以上条件后才能将目标标记为完成。
