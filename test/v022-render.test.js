'use strict';
// v0.2.2 表示层：一级市场概览、融资筛选工具条、机构榜与市场概览默认分区
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const DomUtils = require('../renderer/dom-utils');
const { IntelRender, CapitalViewController } = require('../renderer/intel-views');

const render = IntelRender.createIntelRender({ esc: DomUtils.escapeHTML, safeHttpUrl: DomUtils.safeHttpUrl, timeAgo: () => '1 小时前' });
const EVIL = '<img src=x onerror=alert(1)>';

const deal = patch => Object.assign({
  id: 1, companyId: 'govy', companyName: '高域科技', domain: 'lowaltitude', round: 'A轮', stage: 'early', kind: 'equity',
  amountText: '8亿元', amountCny: 8e8, tier: 'b1', investors: ['晨熹资本'], leadInvestors: [], status: 'completed', date: '2026-09-22',
  dateBasis: 'published', sourceCount: 3, article: { url: 'https://example.com/a', title: '原文', source: '示例' }
}, patch);

const overview = {
  days: 90,
  totals: { deals: 3, companies: 3, completed: 2, rumored: 1, withInvestors: 2, disclosedCny: 1.08e9, disclosedCount: 2, largeRounds: 2, excluded: 1, lowaltitude: 2, aerospace: 1 },
  stages: [{ id: 'early', label: '早期', count: 2 }, { id: 'growth', label: '成长期', count: 1 }, { id: 'late', label: '后期', count: 0 }],
  tiers: [{ id: 'b1', label: '亿元级', count: 2 }, { id: 'unknown', label: '金额未披露', count: 1 }],
  segments: [{ label: EVIL, count: 1 }],
  monthly: [{ month: '2026-08', total: 1, lowaltitude: 0, aerospace: 1 }, { month: '2026-09', total: 2, lowaltitude: 2, aerospace: 0 }],
  large: [deal({ companyName: EVIL, article: { url: 'javascript:alert(1)' } })],
  pipeline: [deal({ id: 2, companyId: null, companyName: '示例航天', round: 'IPO', kind: 'ipo', stage: 'ipo' })],
  recent: [],
  investors: [{ name: '晨熹资本', deals: 2, leads: 1, companies: ['高域科技'] }],
  excludedKinds: [{ id: 'secondary', label: '上市公司再融资', count: 1 }]
};

test('概览：KPI、可点击阶段条、月度堆叠柱与排除说明；外部文本全部转义', () => {
  const html = render.capitalOverview(overview);
  assert.match(html, /class="cap-kpis"/);
  assert.match(html, /融资事件<\/span><b class="ck-value">3<\/b>/);
  assert.match(html, /10\.8 亿元/);
  assert.match(html, /低空 67% · 航天 33%/);
  assert.match(html, /data-deal-stage="early"/);
  assert.doesNotMatch(html, /data-deal-stage="late"/, '零计数阶段不可点击');
  assert.match(html, /class="cap-months" role="img" aria-label="2026-08 1 起，2026-09 2 起"/);
  assert.match(html, /data-investor="晨熹资本"/);
  assert.match(html, /另有 1 起（上市公司再融资 1 起）不属于一级市场股权交易/);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(render.capitalOverview({ days: 30, totals: { deals: 0 } }), /近 30 天还没有抽取到一级市场融资事件/);
});

test('融资工具条保留当前阶段、性质与排序；融资行显示量级与非股权性质', () => {
  const tools = render.dealTools({ stage: 'growth', kind: 'all', sort: 'amount' });
  assert.match(tools, /class="chip active" data-deal-stage="growth" aria-pressed="true"/);
  assert.match(tools, /<option value="all" selected>/);
  assert.match(tools, /<option value="amount" selected>/);
  assert.match(tools, /data-act="deals-export" data-format="csv"/);
  const rows = render.dealList([deal(), deal({ id: 3, kind: 'secondary', tier: 'b10', round: '未披露' })]);
  assert.match(rows, /<small class="deal-tier b1">亿元级<\/small>/);
  assert.match(rows, /已宣布|已完成/);
  assert.match(rows, / · 上市公司再融资/);
  assert.match(render.dealList([], { emptyText: '自定义空态' }), /自定义空态/);
});

test('机构榜显示领域、阶段分布与最近日期，机构名可点击检索', () => {
  const html = render.investorTable([{ name: EVIL, deals: 2, leads: 1, companies: ['甲'], domains: ['aerospace'], last: '2026-09-20', stages: [{ id: 'early', label: '早期', count: 2 }] }]);
  assert.match(html, /data-investor="&lt;img/);
  assert.match(html, /早期 2/);
  assert.match(html, /最近 2026-09-20/);
  assert.doesNotMatch(html, /<img/);
});

test('一级市场默认打开“市场概览”，阶段条跳转融资动态并带上阶段筛选', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.match(html, /class="chip active" type="button" role="tab" aria-selected="true" data-capital-tab="overview">市场概览/);
  const calls = [];
  const listeners = {};
  const body = { innerHTML: '', addEventListener: (type, fn) => { listeners[type] = fn; } };
  const controller = CapitalViewController.createCapitalViewController({
    api: async url => { calls.push(url); return url.startsWith('/api/capital/overview') ? overview : { deals: [], discovered: [], investors: [] }; },
    esc: DomUtils.escapeHTML, render, skeletons: () => '', toast: () => {},
    requestGuard: { begin: () => ({ isCurrent: () => true }) },
    elements: { body }
  });
  await controller.load();
  assert.equal(controller.state().tab, 'overview');
  assert.match(calls[0], /^\/api\/capital\/overview\?days=90$/);
  const target = { dataset: { dealStage: 'growth' } };
  await listeners.click({ target: { closest: selector => (selector === '[data-deal-stage]' ? target : null) } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.state().tab, 'deals');
  assert.equal(controller.state().stage, 'growth');
  assert.match(calls.at(-1), /^\/api\/deals\?days=90&stage=growth$/);
  const investor = { dataset: { investor: '晨熹资本' } };
  await listeners.click({ target: { closest: selector => (selector === '[data-investor]' ? investor : null) } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.state().q, '晨熹资本');
  assert.equal(controller.state().stage, '');
  assert.match(decodeURIComponent(calls.at(-1)), /q=晨熹资本/);
});

test('信源监控台：本地按关键词、状态、类型与领域筛选，并显示运行统计', async () => {
  const { createSourcesController } = require('../renderer/sources-controller');
  const format = require('../renderer/format-utils');
  const listeners = {};
  const on = name => ({ addEventListener: (type, fn) => { listeners[`${name}:${type}`] = fn; } });
  const list = { innerHTML: '', ...on('list') };
  const summary = { innerHTML: '' };
  const search = { value: '', ...on('search') };
  const typeSelect = { value: '', ...on('type') };
  const chips = [{ dataset: { sourceStatus: '' }, classList: { toggle() {} }, setAttribute() {} }, { dataset: { sourceStatus: 'err' }, classList: { toggle() {} }, setAttribute() {} }];
  const status = { querySelectorAll: () => chips, ...on('status') };
  const sources = [
    { id: 1, name: '上交所·科创板IPO·航空航天', url: 'sseipo://?csrc=C37', type: 'api', tier: 'T1', domain: 'both', enabled: 1, last_status: 'ok', item_count: 4, health: {} },
    { id: 2, name: 'eVTOL Insights', url: 'https://evtolinsights.com/feed/', type: 'rss', tier: 'T2', domain: 'lowaltitude', enabled: 1, last_status: 'error: 403', item_count: 0, health: { consecutiveErrors: 2 } },
    { id: 3, name: '示例停用源', url: 'https://example.com', type: 'html', tier: 'T2', domain: 'aerospace', enabled: 0, item_count: 7, health: {} }
  ];
  const ctrl = createSourcesController({
    api: async () => sources, state: {}, esc: DomUtils.escapeHTML,
    DomUtils: { findFocusKey: () => null, restoreFocusByKey: () => {} },
    format: { ...format, delay: async () => {} }, skeletons: () => '', toast: () => {}, confirmGlass: async () => true,
    elements: { list, summary, search, status, type: typeSelect }
  });
  await ctrl.loadSources();
  assert.match(summary.innerHTML, /<b>3<\/b> 个信源/);
  assert.match(summary.innerHTML, /<b>1<\/b> 运行中/);
  assert.match(summary.innerHTML, /<b>1<\/b> 异常或退避/);
  assert.match(summary.innerHTML, /累计采集 <b>11<\/b> 条/);
  assert.equal((list.innerHTML.match(/class="src-card/g) || []).length, 3);
  listeners['status:click']({ target: { closest: () => chips[1] } });
  assert.equal((list.innerHTML.match(/class="src-card/g) || []).length, 1);
  assert.match(list.innerHTML, /eVTOL Insights/);
  assert.match(summary.innerHTML, /筛选出 <b>1<\/b> 个/);
  listeners['status:click']({ target: { closest: () => chips[0] } });
  typeSelect.value = 'api';
  listeners['type:change']();
  assert.match(list.innerHTML, /科创板IPO/);
  search.value = '不存在的名字';
  listeners['search:input']();
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.match(list.innerHTML, /查 无 此 源/);
  await listeners['list:click']({ target: { closest: () => ({ dataset: { act: 'clear-source-filters' } }) } });
  assert.deepEqual(ctrl.filterState(), { q: '', status: '', type: '', domain: '' });
  assert.equal((list.innerHTML.match(/class="src-card/g) || []).length, 3);
});
