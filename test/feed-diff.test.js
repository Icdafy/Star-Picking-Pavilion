'use strict';

// 阶段 4：卡片模板化与 keyed diff 渲染引擎的行为级测试。
// 测试基座为 test/helpers/mini-dom.js（零依赖最小 DOM）：模板直接解析自
// index.html 里的线上 <template id="cardTemplate">，断言的是渲染产物的
// class / data-* / aria-* / 文案行为，而非字符串模板的字面形态。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const DomUtils = require('../renderer/dom-utils');
const FeedCard = require('../renderer/feed-card');
const { MiniDocument, templateFromHtml, serialize } = require('./helpers/mini-dom');

const pageHtml = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

// 确定性格式化桩：渲染契约只关心「时间字段被填进对应节点」，不依赖真实时钟
const formatStub = {
  timeAgo: iso => (iso ? `T:${iso}` : '时间未知'),
  dateLabel: iso => (iso ? `D:${String(iso).slice(0, 10)}` : '日期未知'),
  hhmm: iso => (iso ? `H:${String(iso).slice(11, 16)}` : '--:--')
};

function makeRenderer() {
  const doc = new MiniDocument();
  const template = templateFromHtml(pageHtml, 'cardTemplate', doc);
  const renderer = FeedCard.createCardRenderer({
    esc: DomUtils.escapeHTML,
    safeHttpUrl: DomUtils.safeHttpUrl,
    format: formatStub,
    template,
    doc
  });
  return { doc, template, renderer };
}

function makeDiffList() {
  const { doc, renderer } = makeRenderer();
  const list = doc.createElement('div');
  list.setAttribute('id', 'feedList');
  const diff = FeedCard.createFeedDiffList({ list, renderer });
  return { doc, list, renderer, diff };
}

const day1 = '2026-08-01T09:30:00';
const day2 = '2026-08-02T15:45:00';

function item(id, patch = {}) {
  return Object.assign({
    id, title: `标题 ${id}`, source: '测试源', tier: 't1',
    url: `https://example.com/${id}`, publishedAt: day1, fetchedAt: day1,
    summary: `摘要 ${id}`
  }, patch);
}

// ---------- 模板与渲染器依赖护栏 ----------

test('index.html 必须内置 <template id="cardTemplate"> 且不再新增 script 标签', () => {
  assert.match(pageHtml, /<template id="cardTemplate">/, '卡片模板必须落在 index.html');
  // 模板化是「只增不改」：模板只是新增节点，script 预算（25/25）不动
  const scriptCount = [...pageHtml.matchAll(/<script\b/gi)].length;
  assert.ok(scriptCount <= 25, `脚本标签已有 ${scriptCount} 个，上限 25 个`);
  const { template } = makeRenderer();
  const card = template.content.firstElementChild;
  assert.equal(card.tagName, 'article');
  assert.ok(card.classList.contains('card'));
  // 卡片底栏的留存/分发入口固定在模板里：复制与星标永远存在
  assert.ok(template.content.querySelector('[data-act="copy"]'));
  assert.ok(template.content.querySelector('[data-act="star"]'));
  assert.equal(template.content.querySelector('.card-thumb').getAttribute('loading'), 'lazy');
  assert.equal(template.content.querySelector('.card-thumb').getAttribute('decoding'), 'async');
});

test('createCardRenderer / createFeedDiffList 缺少依赖时抛 TypeError', () => {
  assert.throws(() => FeedCard.createCardRenderer({}), TypeError);
  assert.throws(() => FeedCard.createFeedDiffList({}), TypeError);
  assert.throws(() => FeedCard.createFeedDiffList({ list: {} }), TypeError);
});

// ---------- renderCard 行为断言（DOM 输出契约） ----------

test('renderCard：featured 卡的 class/data-id/data-domain 与 meta 行', () => {
  const { renderer } = makeRenderer();
  const card = renderer.renderCard(item(7, { featured: true, domain: 'aerospace', category: '发射' }));
  assert.equal(card.getAttribute('data-id'), '7');
  assert.equal(card.getAttribute('data-domain'), 'aerospace');
  assert.ok(card.classList.contains('is-featured'));
  assert.equal(card.querySelector('.meta-source').textContent, '测试源');
  const tier = card.querySelector('.tier-chip');
  assert.ok(tier.classList.contains('tier-chip') && tier.classList.contains('tier-t1'));
  assert.equal(tier.textContent, 't1');
  assert.equal(card.querySelector('.cat-tag').textContent, '发射');
  assert.equal(card.querySelector('.meta-time').textContent, `T:${day1}`);
  // 标题链接经 safeHttpUrl 过闸，target/rel 保持契约
  const title = card.querySelector('.card-title');
  assert.equal(title.getAttribute('href'), 'https://example.com/7');
  assert.equal(title.getAttribute('target'), '_blank');
  assert.equal(title.getAttribute('rel'), 'noopener');
  assert.equal(title.textContent, '标题 7');
  // card-foot 始终存在，复制/星标焦点键按 data-focus-key 契约落位
  assert.ok(card.querySelector('.card-foot'));
  assert.equal(card.querySelector('[data-act="copy"]').getAttribute('data-focus-key'), 'copy:7');
  assert.equal(card.querySelector('.star-toggle').getAttribute('data-focus-key'), 'star:7');
});

test('renderCard：无图不出缩略图，带图时 card-content 加 has-thumb', () => {
  const { renderer } = makeRenderer();
  const noImg = renderer.renderCard(item(1));
  assert.equal(noImg.querySelector('.card-thumb'), null);
  assert.ok(!noImg.querySelector('.card-content').classList.contains('has-thumb'));
  const withImg = renderer.renderCard(item(2, { image: 'https://cdn.example.com/a.jpg' }));
  const thumb = withImg.querySelector('.card-thumb');
  assert.equal(thumb.getAttribute('src'), 'https://cdn.example.com/a.jpg');
  assert.ok(withImg.querySelector('.card-content').classList.contains('has-thumb'));
  // javascript: 等危险协议一律被 safeHttpUrl 拦成 #，等价于无图
  const badImg = renderer.renderCard(item(3, { image: 'javascript:alert(1)' }));
  assert.equal(badImg.querySelector('.card-thumb'), null);
});

test('renderCard：实体 chips 落位 card-text，原子事件 ≥2 才渲染', () => {
  const { renderer } = makeRenderer();
  const one = renderer.renderCard(item(1, {
    entities: [{ name: '蓝箭航天', type: 'org' }],
    events: [{ actor: '朱雀三号', actionClass: 'launch' }]
  }));
  // 实体/事件经 HTML 插槽注入，断言序列化产物里的结构与文案
  const oneHtml = serialize(one);
  assert.match(oneHtml, /class="card-entities"/);
  assert.match(oneHtml, /data-entity="蓝箭航天"/);
  assert.doesNotMatch(oneHtml, /class="card-events"/, '单事件不渲染原子事件块');
  const two = renderer.renderCard(item(2, {
    events: [
      { actor: '朱雀三号', actionClass: 'launch', object: '遥二' },
      { actor: '某发射场', actionClass: 'facility' }
    ]
  }));
  const twoHtml = serialize(two);
  assert.match(twoHtml, /class="card-events"/);
  assert.match(twoHtml, /原子事件 2/);
  assert.match(twoHtml, /发射入轨/);
});

test('renderCard：星标态 aria-pressed/is-on/文案与五维、事件簇入口', () => {
  const { renderer } = makeRenderer();
  const starred = renderer.renderCard(item(5, { starred: true }));
  const star = starred.querySelector('.star-toggle');
  assert.equal(star.getAttribute('aria-pressed'), 'true');
  assert.ok(star.classList.contains('is-on'));
  assert.equal(star.getAttribute('title'), '取消星标');
  assert.equal(star.querySelector('.card-act-label').textContent, '已星标');
  const plain = renderer.renderCard(item(6));
  assert.equal(plain.querySelector('.star-toggle').getAttribute('aria-pressed'), 'false');
  assert.equal(plain.querySelector('.card-act-label').textContent, '星标');
  // 无研判内容时五维入口与分解盒不存在；无簇时簇入口与簇盒不存在
  assert.equal(plain.querySelector('.dims-toggle'), null);
  assert.equal(plain.querySelector('.dims'), null);
  assert.equal(plain.querySelector('.cluster-toggle'), null);
  assert.equal(plain.querySelector('.cluster-items'), null);
  const rich = renderer.renderCard(item(8, {
    clusterId: 3, clusterSize: 4,
    scores: { importance: 80, novelty: 70, credibility: 60, impact: 50, timeliness: 40 }
  }));
  const clusterToggle = rich.querySelector('.cluster-toggle');
  assert.equal(clusterToggle.getAttribute('data-cluster'), '3');
  assert.equal(clusterToggle.getAttribute('data-self'), '8');
  assert.match(clusterToggle.textContent, /4 篇关联报道/);
  assert.ok(rich.querySelector('.cluster-items').hidden);
  assert.ok(rich.querySelector('.dims-toggle'));
  assert.match(rich.querySelector('.dims').textContent, /重要性/);
});

// ---------- renderTimeline / renderRanked 分组与行结构 ----------

test('renderTimeline：日期分组头与行结构保持契约', () => {
  const { renderer } = makeRenderer();
  const frag = renderer.renderTimeline([
    item('a', { publishedAt: day2 }),
    item('b', { publishedAt: day2 }),
    item('c', { publishedAt: day1 })
  ], 0);
  const holder = new MiniDocument().createDocumentFragment();
  holder.appendChild(frag);
  const groups = holder.querySelectorAll('.date-group');
  assert.equal(groups.length, 2);
  assert.ok(groups[0].querySelector('.date-head').textContent.includes(`D:${day2.slice(0, 10)}`));
  assert.match(groups[0].querySelector('.dh-count').textContent, /2 条/);
  assert.match(groups[1].querySelector('.dh-count').textContent, /1 条/);
  const rows = holder.querySelectorAll('.tl-row');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].querySelector('.tl-time').textContent, `H:${day2.slice(11, 16)}`);
  // 入场延迟随组内序号递增并封顶
  assert.equal(rows[0].querySelector('.card').style.animationDelay, '0ms');
  assert.equal(rows[1].querySelector('.card').style.animationDelay, '35ms');
});

test('renderRanked：名次编号、前三名 top 类与行结构', () => {
  const { renderer } = makeRenderer();
  const frag = renderer.renderRanked([item('x'), item('y'), item('z'), item('w')], 0);
  const holder = new MiniDocument().createDocumentFragment();
  holder.appendChild(frag);
  const rows = holder.querySelectorAll('.rank-row');
  assert.equal(rows.length, 4);
  assert.equal(rows[0].querySelector('.card-rank').textContent, '01');
  assert.ok(rows[0].querySelector('.card-rank').classList.contains('top'));
  assert.ok(rows[2].querySelector('.card-rank').classList.contains('top'));
  assert.ok(!rows[3].querySelector('.card-rank').classList.contains('top'));
  assert.equal(rows[3].querySelector('.card-rank').textContent, '04');
});

// ---------- keyed diff：reconcile ----------

test('reconcile：同数据集二次调和产物等价，且全部复用不新建', () => {
  const { list, diff } = makeDiffList();
  const items = [item('a', { publishedAt: day2 }), item('b'), item('c')];
  diff.reconcile(items);
  const snapshot = serialize(list);
  const rowsBefore = list.querySelectorAll('.tl-row');
  const result = diff.reconcile(items);
  assert.deepEqual(result, { reused: 3, created: 0, removed: 0 });
  assert.equal(serialize(list), snapshot, '同数据集 diff 前后 HTML 快照必须等价');
  const rowsAfter = list.querySelectorAll('.tl-row');
  rowsBefore.forEach((row, i) => assert.equal(rowsAfter[i], row, '旧行节点必须原样复用'));
});

test('reconcile：增量只新增缺失项、复用旧节点，多余项被移除', () => {
  const { list, diff } = makeDiffList();
  diff.reconcile([item('a'), item('b')]);
  const rowA = list.querySelector('.card[data-id="a"]').closest('.tl-row');
  const rowB = list.querySelector('.card[data-id="b"]').closest('.tl-row');
  const result = diff.reconcile([item('a'), item('n'), item('c')]);
  assert.equal(result.reused, 1);
  assert.equal(result.created, 2);
  assert.equal(result.removed, 1);
  const ids = list.querySelectorAll('.card[data-id]').map(c => c.getAttribute('data-id'));
  assert.deepEqual(ids, ['a', 'n', 'c']);
  assert.equal(list.querySelector('.card[data-id="a"]').closest('.tl-row'), rowA, '保留项的行节点不得重建');
  assert.equal(rowB.parentNode, null, '移除项的行节点应离开列表');
  // 分组计数随调和刷新
  assert.match(list.querySelector('.dh-count').textContent, /3 条/);
});

test('reconcile：ranked 模式同步行名次与 top 类', () => {
  const { list, diff } = makeDiffList();
  diff.reconcile([item('a'), item('b'), item('c'), item('d')], { mode: 'ranked' });
  const rowC = list.querySelector('.card[data-id="c"]').closest('.rank-row');
  // 重排后 c 升到第 1：名次文案与 top 类必须同步，节点仍复用
  const result = diff.reconcile([item('c'), item('a'), item('b'), item('d')], { mode: 'ranked' });
  assert.equal(result.reused, 4);
  assert.equal(result.created, 0);
  assert.equal(list.querySelector('.card[data-id="c"]').closest('.rank-row'), rowC);
  const rankC = rowC.querySelector('.card-rank');
  assert.equal(rankC.textContent, '01');
  assert.ok(rankC.classList.contains('top'));
  const rankD = list.querySelector('.card[data-id="d"]').closest('.rank-row').querySelector('.card-rank');
  assert.equal(rankD.textContent, '04');
  assert.ok(!rankD.classList.contains('top'));
});

test('reconcile：空数据集清空列表（空态由控制器接手），不回退整表赋值', () => {
  const { list, diff } = makeDiffList();
  diff.reconcile([item('a')]);
  const result = diff.reconcile([]);
  assert.equal(result.removed, 1);
  assert.equal(list.querySelectorAll('.card[data-id]').length, 0);
});

// ---------- keyed diff：appendPage / prependFresh ----------

test('appendPage：分页追加只增不减，既有节点不动', () => {
  const { list, diff } = makeDiffList();
  diff.reconcile([item('a')]);
  const rowA = list.querySelector('.card[data-id="a"]').closest('.tl-row');
  const result = diff.appendPage([item('p1', { publishedAt: '2026-07-30T08:00:00' })], { startIdx: 1 });
  assert.equal(result.created, 1);
  assert.deepEqual(
    list.querySelectorAll('.card[data-id]').map(c => c.getAttribute('data-id')),
    ['a', 'p1']
  );
  assert.equal(list.querySelector('.card[data-id="a"]').closest('.tl-row'), rowA);
  assert.equal(list.querySelectorAll('.date-group').length, 2, '分页自带日期分组');
});

test('prependFresh：合并进既有首组，打 card-new 并刷新计数', () => {
  const { list, diff } = makeDiffList();
  diff.reconcile([item('old', { publishedAt: day1 })]);
  const applied = diff.prependFresh([
    item('n1', { publishedAt: day1 }),
    item('n2', { publishedAt: day1 })
  ]);
  assert.equal(applied, 2);
  assert.deepEqual(
    list.querySelectorAll('.card[data-id]').map(c => c.getAttribute('data-id')),
    ['n1', 'n2', 'old'],
    '新条目前置，同组内按给定顺序排在旧条目前'
  );
  const news = list.querySelectorAll('.card.card-new');
  assert.deepEqual(news.map(c => c.getAttribute('data-id')), ['n1', 'n2']);
  assert.equal(list.querySelectorAll('.date-group').length, 1, '同日期标签合并进首组');
  assert.match(list.querySelector('.dh-count').textContent, /3 条/);
});

test('prependFresh：跨日期新建分组插到最前，多组按新旧次序落位', () => {
  const { list, diff } = makeDiffList();
  diff.reconcile([item('old', { publishedAt: day1 })]);
  const applied = diff.prependFresh([
    item('n2', { publishedAt: day2 }),
    item('n1', { publishedAt: day1 })
  ]);
  assert.equal(applied, 2);
  const groups = list.querySelectorAll('.date-group');
  assert.equal(groups.length, 2);
  assert.ok(groups[0].querySelector('.date-head').textContent.includes(`D:${day2.slice(0, 10)}`));
  assert.deepEqual(
    groups[0].querySelectorAll('.card[data-id]').map(c => c.getAttribute('data-id')),
    ['n2']
  );
  assert.deepEqual(
    groups[1].querySelectorAll('.card[data-id]').map(c => c.getAttribute('data-id')),
    ['n1', 'old']
  );
});

test('prependFresh：列表无日期分组（空态/骨架/失败态/排行视图）返回 0，退回整表重载', () => {
  const { list, diff } = makeDiffList();
  assert.equal(diff.prependFresh([item('n')]), 0, '空列表不可前置');
  list.innerHTML = '<div class="empty-state glass"><p>风 平 浪 静</p></div>';
  assert.equal(diff.prependFresh([item('n')]), 0, '空态不可前置');
  diff.reconcile([item('r')], { mode: 'ranked' });
  assert.equal(diff.prependFresh([item('n')]), 0, '排行视图不可前置');
});

test('prependFresh：新条目分组更旧时不前置，返回 0 交由调用方整表重载', () => {
  const { list, diff } = makeDiffList();
  diff.reconcile([item('old', { publishedAt: day2 })]);   // 既有首组是较新的一天
  // 轮询中源站翻出的旧文：「昨天」分组不得插到「今天」之上
  const applied = diff.prependFresh([item('stale', { publishedAt: day1 })]);
  assert.equal(applied, 0);
  assert.deepEqual(
    list.querySelectorAll('.card[data-id]').map(c => c.getAttribute('data-id')),
    ['old'],
    '回退前列表不得被改动'
  );
  assert.equal(list.querySelectorAll('.date-group').length, 1);
});

test('prependFresh：新条目混有更旧分组时整体回退，不做部分插入', () => {
  const { list, diff } = makeDiffList();
  diff.reconcile([item('old', { publishedAt: day2 })]);
  const applied = diff.prependFresh([
    item('n1', { publishedAt: day2 }),
    item('stale', { publishedAt: day1 })
  ]);
  assert.equal(applied, 0, '含更旧分组时不得部分应用');
  assert.deepEqual(
    list.querySelectorAll('.card[data-id]').map(c => c.getAttribute('data-id')),
    ['old']
  );
});

// ---------- keyed diff：跨模式调和与复用行内容刷新 ----------

test('reconcile：跨模式调和（timeline → ranked）全重建，行结构不串模式', () => {
  const { list, diff } = makeDiffList();
  diff.reconcile([item('a'), item('b')]);
  const result = diff.reconcile([item('a'), item('b')], { mode: 'ranked' });
  assert.equal(result.reused, 0, '异模式行不得复用');
  assert.equal(result.created, 2);
  assert.equal(list.querySelectorAll('.rank-row').length, 2);
  assert.equal(list.querySelectorAll('.tl-row').length, 0);
  assert.equal(list.querySelectorAll('.date-group').length, 0, 'rank-row 不得挂进 date-group');
  // 反向调和同样全重建
  const back = diff.reconcile([item('a'), item('b')]);
  assert.equal(back.reused, 0);
  assert.equal(list.querySelectorAll('.tl-row').length, 2);
  assert.equal(list.querySelectorAll('.rank-row').length, 0);
});

test('reconcile：同模式复用行的卡片内容随新数据刷新，行壳仍复用', () => {
  const { list, diff } = makeDiffList();
  diff.reconcile([item('a', { title: '旧标题', summary: '旧摘要' })]);
  const rowA = list.querySelector('.card[data-id="a"]').closest('.tl-row');
  const result = diff.reconcile([item('a', { title: '新标题', summary: '新摘要' })]);
  assert.equal(result.reused, 1);
  assert.equal(list.querySelector('.card[data-id="a"]').closest('.tl-row'), rowA, '行壳节点仍复用');
  assert.equal(list.querySelector('.card-title').textContent, '新标题', '卡片正文必须随新数据刷新');
  assert.equal(list.querySelector('.card-summary').textContent, '新摘要');
});

test('reconcile：ranked 模式复用行的卡片内容同样随新数据刷新', () => {
  const { list, diff } = makeDiffList();
  diff.reconcile([item('a', { title: '旧标题' })], { mode: 'ranked' });
  const result = diff.reconcile([item('a', { title: '新标题' })], { mode: 'ranked' });
  assert.equal(result.reused, 1);
  assert.equal(list.querySelector('.card-title').textContent, '新标题');
});

// ---------- 液态玻璃阶段 3：motion 错峰入场（可选增强层） ----------
// motion 经 deps 注入：只对本次实际新建的行节点调 staggerIn，
// 缺失或抛错时静默跳过，列表数据正确性不受影响

function makeDiffListWithMotion(motion) {
  const { doc, renderer } = makeRenderer();
  const list = doc.createElement('div');
  list.setAttribute('id', 'feedList');
  const diff = FeedCard.createFeedDiffList({ list, renderer, motion });
  return { list, diff };
}

function makeMotionSpy({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    // 与真实引擎一致：暴露错峰上限，供 diff 列表对齐挂标范围
    STAGGER_LIMIT: 8,
    staggerIn(rows) {
      if (fail) throw new Error('motion crashed');
      calls.push(rows.slice());
      return rows.length;
    }
  };
}

test('reconcile：注入 motion 后仅新建行参与错峰入场，复用行不重复动画', () => {
  const motion = makeMotionSpy();
  const { list, diff } = makeDiffListWithMotion(motion);
  diff.reconcile([item('a'), item('b'), item('c')]);
  assert.equal(motion.calls.length, 1);
  assert.equal(motion.calls[0].length, 3, '首次调和三行全新');
  // 二次调和只有新增行入场，复用行不得再动画
  diff.reconcile([item('a'), item('b'), item('c'), item('d')]);
  assert.equal(motion.calls.length, 2);
  assert.equal(motion.calls[1].length, 1);
  assert.equal(motion.calls[1][0].querySelector('.card').getAttribute('data-id'), 'd');
  assert.equal(list.querySelectorAll('.card[data-id]').length, 4);
  // 评审修复轮：复用行不得被挂错峰标记，卡片 CSS 入场延迟保持原样
  const reusedRow = list.querySelector('.card[data-id="a"]').closest('.tl-row');
  assert.ok(!reusedRow.classList.contains('stagger-in'));
  assert.equal(reusedRow.querySelector('.card').style.animationDelay, '0ms');
});

test('reconcile/prependFresh：stagger 命中的新建行不再同时播卡片 CSS 入场', () => {
  const motion = makeMotionSpy();
  const { list, diff } = makeDiffListWithMotion(motion);
  diff.reconcile([item('a'), item('b')]);
  // 命中 stagger 的行挂 .stagger-in（styles.css 据此关掉卡片 CSS 入场），
  // 行构建器写入的 inline animationDelay 一并清除：入场只走行级 motion
  const rows = list.querySelectorAll('.tl-row');
  rows.forEach(row => assert.ok(row.classList.contains('stagger-in')));
  rows.forEach(row => assert.equal(row.querySelector('.card').style.animationDelay, ''));
  // CSS 侧规则存在：stagger 行的卡片不再播 card-in
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  assert.match(css, /\.stagger-in \.card \{ animation: none; \}/);
  // prependFresh 前置的新行同口径挂标并清除延迟
  const applied = diff.prependFresh([item('n1', { publishedAt: day1 })]);
  assert.equal(applied, 1);
  const freshRow = list.querySelector('.card[data-id="n1"]').closest('.tl-row');
  assert.ok(freshRow.classList.contains('stagger-in'));
  assert.equal(freshRow.querySelector('.card').style.animationDelay, '');
});

test('prependFresh：前置插入的新行参与错峰入场，既有行不动', () => {
  const motion = makeMotionSpy();
  const { list, diff } = makeDiffListWithMotion(motion);
  diff.reconcile([item('old', { publishedAt: day1 })]);
  motion.calls.length = 0;
  // 新条目按新→旧排列（时间轴契约）：一条新建更晚的分组、一条并入当天首组
  const applied = diff.prependFresh([
    item('n2', { publishedAt: day2 }),
    item('n1', { publishedAt: day1 })
  ]);
  assert.equal(applied, 2);
  assert.equal(motion.calls.length, 1);
  assert.equal(motion.calls[0].length, 2, '只作用于本次新增节点');
  const ids = motion.calls[0].map(row => row.querySelector('.card').getAttribute('data-id'));
  assert.deepEqual(ids.sort(), ['n1', 'n2']);
});

test('motion 缺失或抛错时静默降级，渲染结果与无动画时一致', () => {
  const bare = makeDiffListWithMotion(null);
  bare.diff.reconcile([item('a'), item('b')]);
  assert.equal(bare.list.querySelectorAll('.card[data-id]').length, 2);
  const failing = makeDiffListWithMotion(makeMotionSpy({ fail: true }));
  failing.diff.reconcile([item('a'), item('b')]);
  assert.equal(failing.list.querySelectorAll('.card[data-id]').length, 2, '动画层崩溃不影响列表数据');
});
