'use strict';
// v0.2.0 表示层：情报视图的纯函数渲染（转义、空态、刊期版块选择）与卡片新增字段
//（自洽中文标题、内容类型、两次评分说明、主体公司、一级市场行、AIHOT 五轴）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const DomUtils = require('../renderer/dom-utils');
const FeedCard = require('../renderer/feed-card');
const { IntelRender, CapitalViewController } = require('../renderer/intel-views');
const { MiniDocument, templateFromHtml, serialize } = require('./helpers/mini-dom');

const pageHtml = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const render = IntelRender.createIntelRender({ esc: DomUtils.escapeHTML, safeHttpUrl: DomUtils.safeHttpUrl, timeAgo: () => '1 小时前' });

const EVIL = '<img src=x onerror=alert(1)>';

test('hot list escapes untrusted titles, sources and companies and neutralizes unsafe links', () => {
  const html = render.hotList([{
    rank: 1, storyId: 9, title: EVIL, digest: EVIL, domain: 'aerospace', category: '发射与任务', heat: 41.3, trend: 'up', trendPct: 23.5,
    badges: ['surge', 'new', 'evil'], participantCount: 5, reportCount: 7, sourceNames: [EVIL], firstReportAt: '2026-09-29T00:00:00Z',
    companies: [{ id: 'landspace', name: EVIL, watch: 2 }],
    representative: { url: 'javascript:alert(1)', source: EVIL },
    sparkline: [{ heat: 10 }, { heat: 30 }, { heat: 20 }]
  }]);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /&lt;img/);
  assert.match(html, /class="hot-badge surge"/);
  assert.doesNotMatch(html, /hot-badge evil/, '未知徽标不渲染');
  assert.match(html, /data-story="9"/);
  assert.match(html, /<polyline points="0,/);
  assert.match(render.hotList([], { windowHours: 48, halfLifeHours: 24, minParticipants: 2 }), /近 48 小时还没有被 2 个以上独立信源/);
});

test('deal list marks lead investors, registered companies and unregistered subjects', () => {
  const html = render.dealList([
    { companyId: 'autoflight', companyName: '峰飞航空', company: { watch: 2 }, domain: 'lowaltitude', round: 'B轮', amountText: '10亿元',
      investors: ['甲资本', '乙资本'], leadInvestors: ['乙资本'], status: 'completed', date: '2026-09-01', sourceCount: 3,
      article: { url: 'https://example.com/a', title: 't', source: '投资界' } },
    { companyId: null, companyName: '某新公司', round: '天使轮', amountText: '', amountCny: null, investors: [], leadInvestors: [], status: 'rumored', firstSeenAt: '2026-09-02T00:00:00Z' }
  ]);
  assert.match(html, /<b title="领投">乙资本<\/b>/);
  assert.match(html, /data-company="autoflight"/);
  assert.match(html, /<i>被投<\/i>/);
  assert.match(html, /class="deal-company unregistered"/);
  assert.match(html, /共 3 篇/);
  assert.match(html, /传闻/);
  assert.match(html, /未披露/);
  assert.doesNotMatch(render.dealList([], {}), /deal-row/);
  assert.match(render.dealList([{ companyName: 'x', round: 'A轮', investors: [], leadInvestors: [] }], { showCompany: false }), /deal-list compact/);
});

test('issue blocks follow the requested parts and order', () => {
  const issue = {
    lead: '导语', leadSource: 'model', totals: { relevant: 3, featured: 1, stories: 2, deals: 1 },
    hot: [{ title: '热点', participants: 3, reports: 4, representative: { url: 'https://example.com/h' }, domain: 'aerospace' }],
    sections: [{ category: '政策法规', items: [{ title: '政策', url: 'https://example.com/p', score: 70 }] }],
    deals: [{ companyName: '公司', round: 'A轮', investors: [], leadInvestors: [] }],
    portfolio: [{ id: 'landspace', name: '蓝箭航天', watch: 2, items: [{ title: '动态', url: 'https://example.com/d' }] }],
    companies: [{ id: 'landspace', name: '蓝箭航天', participants: 3, reports: 4 }],
    breakthroughs: []
  };
  const all = render.issueBlocks(issue);
  const order = ['issue-lead', 'issue-hot', '政策法规', 'issue-deals', 'issue-portfolio', 'issue-companies'].map(marker => all.indexOf(marker));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(order.every(index => index >= 0));
  assert.match(all, /主编导语/);
  const partial = render.issueBlocks(issue, { parts: ['hot', 'lead'] });
  assert.ok(partial.indexOf('issue-hot') < partial.indexOf('issue-lead'));
  assert.doesNotMatch(partial, /issue-deals/);
});

test('industry info renders thresholds, the weight table and budget usage', () => {
  const html = render.industryInfo({
    axes: { sig: '实质份量', act: '投资可行动性' },
    itemTypes: [{ id: 'launch_flight', label: '发射与飞行', category: '发射与任务', weights: { sig: 3, act: 1 } }],
    thresholds: { T1: 58, T2: 67 },
    budget: { hourCalls: 3, maxCallsPerHour: 900, dayCalls: 10, maxCallsPerDay: 9000, receipts: 42 },
    prompts: [{ name: 'selection-score', version: 'abcdef123456' }, { name: 'safety', version: 'x' }]
  });
  assert.match(html, /<b>T1<\/b> 58/);
  assert.match(html, /投资可行动性/);
  assert.match(html, /<td>3<\/td><td>1<\/td>/);
  assert.match(html, /本小时 <b>3<\/b> \/ 900/);
  assert.match(html, /selection-score@abcdef123456/);
  assert.doesNotMatch(html, /safety@/);
});

test('capital view splits alias input on Chinese and Latin separators', () => {
  assert.deepEqual(CapitalViewController.splitNames('蓝箭、LandSpace, 朱雀；天鹊\n'), ['蓝箭', 'LandSpace', '朱雀', '天鹊']);
});

const pureCard = FeedCard.createFeedCard({ esc: DomUtils.escapeHTML, safeHttpUrl: DomUtils.safeHttpUrl, format: { timeAgo: () => 'T' } });

function makeRenderer() {
  const doc = new MiniDocument();
  const template = templateFromHtml(pageHtml, 'cardTemplate', doc);
  return FeedCard.createCardRenderer({
    esc: DomUtils.escapeHTML,
    safeHttpUrl: DomUtils.safeHttpUrl,
    format: { timeAgo: () => 'T', dateLabel: () => 'D', hhmm: () => 'H' },
    template,
    doc
  });
}

const v2Item = patch => Object.assign({
  id: 7, title: 'Starship completes first orbital flight', titleZh: 'SpaceX 星舰首次完成入轨飞行', source: 'SpaceNews', tier: 'T2',
  url: 'https://example.com/7', publishedAt: '2026-09-28T08:00:00Z', fetchedAt: '2026-09-28T09:00:00Z',
  summary: '摘要', category: '发射与任务', itemType: 'launch_flight', itemTypeLabel: '发射与飞行', featured: true, quality: 72,
  scorePasses: [70, 74], threshold: 67, reason: '推荐理由正文',
  scores: { significance: 80, novelty: 60, credibility: 70, resonance: 90, actionability: 40 },
  subjects: [{ id: 'spacex', name: 'SpaceX', role: 'primary' }, { id: null, name: '无库公司', role: 'primary' }],
  deal: { company: '某火箭', round: 'B轮', amountText: '数亿元', investors: ['甲', '乙'], leadInvestors: ['甲'], status: 'completed' }
}, patch);

test('v0.2 cards show the self-contained title, type label, dual-pass score and AIHOT axes', () => {
  const card = makeRenderer().renderCard(v2Item());
  const title = card.querySelector('.card-title');
  assert.equal(title.textContent, 'SpaceX 星舰首次完成入轨飞行');
  assert.equal(title.getAttribute('title'), '原标题：Starship completes first orbital flight');
  assert.equal(card.querySelector('.cat-tag').textContent, '发射与任务 · 发射与飞行');
  const html = serialize(card);
  // 评分胶囊经 innerHTML 注入（最小 DOM 不解析），直接断言它的纯函数构建器
  const pill = pureCard.scorePill(v2Item());
  assert.match(pill, /两次独立评分 70 \/ 74，平均 72；信源门槛 67（两次之和需 ≥ 134）/);
  assert.match(pill, /精选 <b>72<\/b>/);
  assert.match(pureCard.scorePill(v2Item({ featured: false })), /注意力 <b>72<\/b>/);
  assert.match(html, /投资可行动性/);
  assert.doesNotMatch(html, /行业影响/);
  assert.match(html, /推荐理由/);
});

test('v0.2 cards link registered subject companies and show the extracted deal', () => {
  const html = serialize(makeRenderer().renderCard(v2Item()));
  assert.match(html, /class="card-company is-primary" type="button" data-company="spacex"/);
  assert.doesNotMatch(html, /无库公司/, '不在公司库的主体不渲染成可点击公司');
  assert.match(html, /class="card-deal"/);
  assert.match(html, /领投 甲/);
  assert.match(html, /参投 乙/);
});

test('legacy cards keep the v0.1 dimensions, research label and score wording', () => {
  const html = serialize(makeRenderer().renderCard(v2Item({
    titleZh: null, itemType: null, itemTypeLabel: null, scorePasses: null, subjects: [], deal: null, featured: false, quality: 64,
    scores: { importance: 70, novelty: 60, credibility: 70, impact: 50, timeliness: 60 }
  })));
  assert.match(html, /行业影响/);
  assert.match(html, /情报研判/);
  assert.match(pureCard.scorePill(v2Item({ scorePasses: null, featured: false, quality: 64 })), /质量 <b>64<\/b>/);
  assert.doesNotMatch(html, /card-deal|card-companies/);
});
