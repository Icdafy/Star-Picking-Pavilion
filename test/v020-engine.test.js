'use strict';
// v0.2.0 AIHOT 内核的确定性单测：行业包、入选判定、公司库、融资事件、事件归组、热度、刊期、回执与预算。
// 全部是纯代码路径（不调模型、不访问网络），回归时这里必须先红。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v020-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = dataDir;

const { db, closeDatabase, insertArticle, now } = require('../server/db');
const industry = require('../server/industry');
const editorial = require('../server/ai/editorial');
const companies = require('../server/ai/companies');
const deals = require('../server/ai/deals');
const stories = require('../server/ai/stories');
const hot = require('../server/ai/hot');
const reports = require('../server/ai/reports');
const receipts = require('../server/ai/receipts');
const { heuristicAnalyze, persistAnalysis } = require('../server/ai/pipeline');

test.after(async () => {
  closeDatabase();
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

const HOUR = 3600e3;

function reset() {
  for (const table of ['story_signals', 'story_heat_hourly', 'hot_rankings', 'article_companies', 'deals', 'articles_fts', 'articles', 'clusters', 'period_reports', 'model_receipts', 'model_usage']) {
    db.exec(`DELETE FROM ${table}`);
  }
  db.exec('DELETE FROM sources');
  db.exec("DELETE FROM meta WHERE key = 'storiesMigrated'");
}

let seq = 0;
function source(name = '测试源', tier = 'T2') {
  return Number(db.prepare(`INSERT INTO sources (name, type, url, tier, domain) VALUES (?, 'rss', ?, ?, 'both')`)
    .run(name, `https://example.com/source-${++seq}`, tier).lastInsertRowid);
}

function article(sourceId, fields = {}) {
  const url = `https://example.com/a-${++seq}`;
  insertArticle({ sourceId, title: fields.title || `资料 ${seq}`, url, canonicalUrl: url, summaryRaw: fields.summary || '' });
  const id = db.prepare('SELECT id FROM articles WHERE url = ?').get(url).id;
  const at = fields.at || now();
  db.prepare(`UPDATE articles SET relevant = 1, analyzed = 1, analysis_version = 3, domain = ?, category = ?,
      ai_summary = ?, title_zh = ?, published_at = ?, fetched_at = ?, attention_score = ?, quality_score = ?,
      featured = ?, event_key = ?, events_json = ?, subjects_json = ?, participant_key = ?, publisher_id = ?, historical = ?
    WHERE id = ?`).run(fields.domain || 'aerospace', fields.category || '发射与任务', fields.summary || '', fields.titleZh || null,
    at, fields.fetchedAt || at, fields.score ?? 60, fields.score ?? 60, fields.featured ? 1 : 0, fields.eventKey || null,
    JSON.stringify(fields.events || []), JSON.stringify(fields.subjects || []), fields.participant || null, fields.publisher || null,
    fields.historical ? 1 : 0, id);
  return id;
}

// ---------- 行业包 ----------

test('industry pack: every item type row sums to 10 and attention stays in 0–100', () => {
  const taxonomy = industry.loadTaxonomy();
  assert.ok(taxonomy.itemTypes.length >= 7);
  for (const type of taxonomy.itemTypes) {
    assert.equal(Object.values(type.weights).reduce((a, b) => a + b, 0), 10, type.id);
    assert.equal(industry.computeAttention(type.id, { sig: 10, nov: 10, cred: 10, reson: 10, act: 10 }).score, 100);
    assert.equal(industry.computeAttention(type.id, { sig: 0, nov: 0, cred: 0, reson: 0, act: 0 }).score, 0);
  }
  // 轴分越界被夹到 0–10，未知类型回落到“企业与产业动态”
  assert.equal(industry.computeAttention('nope', { sig: 99, nov: -3, cred: 5, reson: 5, act: 5 }).itemType, 'industry_move');
  assert.equal(industry.computeAttention('launch_flight', { sig: 8, nov: 6, cred: 8, reson: 7, act: 5 }).score, 71);
});

test('industry pack: prompts expand every variable and partial, and the version is a content hash', () => {
  for (const name of ['prefilter', 'selection-score', 'content-understanding', 'group-pair', 'story-digest', 'report-lead']) {
    const prompt = industry.renderPrompt(name, { periodLabel: '日报' });
    assert.doesNotMatch(prompt.text, /\{\{/, `${name} 还有未展开的变量`);
    assert.match(prompt.text, /输入安全边界/, `${name} 缺少安全边界片段`);
    assert.match(prompt.version, /^[0-9a-f]{12}$/);
  }
  assert.notEqual(industry.renderPrompt('report-lead', { periodLabel: '日报' }).version,
    industry.renderPrompt('report-lead', { periodLabel: '周报' }).version);
  const score = industry.renderPrompt('selection-score').text;
  assert.match(score, /financing_capital/);
  assert.match(score, /投资可行动性/);
  assert.match(score, /\| launch_flight \| 3 \| 2 \| 2 \| 2 \| 1 \|/);
});

// ---------- 判断与写作的输出收口 ----------

test('prefilter output must map one-to-one onto the batch', () => {
  const ok = editorial.normalizePrefilter({ results: [{ i: 1, label: 'block', d: null }, { i: 0, label: 'PASS', d: 'B', reason: '商业发射' }] }, 2);
  assert.deepEqual(ok.map(r => [r.label, r.domain]), [['PASS', 'aerospace'], ['BLOCK', null]]);
  for (const bad of [
    { results: [{ i: 0, label: 'PASS' }] },
    { results: [{ i: 0, label: 'PASS' }, { i: 0, label: 'PASS' }] },
    { results: [{ i: 0, label: 'PASS' }, { i: 1, label: 'MAYBE' }] },
    { results: [{ i: 0, label: 'PASS' }, { i: 2, label: 'PASS' }] }
  ]) {
    assert.throws(() => editorial.normalizePrefilter(bad, 2), error => error.parseFailure === true);
  }
});

test('score output is five integer axes; the total is computed by code from the type weights', () => {
  const pass = editorial.normalizeScore({ itemType: 'financing_capital', sig: 8.4, nov: 3, cred: 7, reson: 12, act: 7, attentionScore: 99 });
  assert.deepEqual(pass.axes, { sig: 8, nov: 3, cred: 7, reson: 10, act: 7 });
  assert.equal(pass.score, 8 * 3 + 3 * 1 + 7 * 2 + 10 * 2 + 7 * 2);
  assert.throws(() => editorial.normalizeScore({ itemType: 'launch_flight', sig: 5 }), error => error.parseFailure);
});

test('understanding keeps only whitelisted tags and derives the category from the item type', () => {
  const u = editorial.normalizeUnderstanding({
    itemType: 'tech_explainer', authorRole: 'boss', tags: ['可回收火箭', '满分', '技术解读', '可回收火箭'],
    titleZh: '液氧甲烷与液氧煤油路线对比', summaryZh: '文章对比两条路线的成本与复用性。', editorialJudgment: '理由',
    subjects: ['蓝箭航天', '', '星河动力'], fact: { title: '路线对比', occurredAt: '2026-13-40' }, deal: ['bad']
  });
  assert.equal(u.category, '技术研发');
  assert.equal(u.authorRole, 'relayer');
  assert.deepEqual(u.tags, ['可回收火箭', '技术解读']);
  assert.deepEqual(u.subjects, ['蓝箭航天', '星河动力']);
  assert.equal(u.fact.occurredAt, null);
  assert.equal(u.deal, null);
  assert.throws(() => editorial.normalizeUnderstanding({ itemType: 'x', summaryZh: 's' }), error => error.parseFailure);
});

test('selection compares the sum of two passes with twice the tier threshold', () => {
  const selection = { ...industry.loadSelection(), thresholds: { T1: 58, 'T1.5': 62, T2: 67 }, heuristicDiscount: 0.9 };
  assert.deepEqual(editorial.decideSelection({ scoreA: 66, scoreB: 68, tier: 'T2' }, selection), { threshold: 67, attention: 67, selected: true });
  assert.equal(editorial.decideSelection({ scoreA: 66, scoreB: 67, tier: 'T2' }, selection).selected, false);
  // 官方一手门槛更低：同样两次评分，T1 入选、T2 不入选
  assert.equal(editorial.decideSelection({ scoreA: 60, scoreB: 58, tier: 'T1' }, selection).selected, true);
  assert.equal(editorial.decideSelection({ scoreA: 60, scoreB: 58, tier: 'T2' }, selection).selected, false);
  assert.equal(editorial.decideSelection({ scoreA: 61, scoreB: 61, tier: 'T2', heuristic: true }, selection).threshold, 60.3);
  assert.deepEqual(editorial.averagedAxes({ axes: { sig: 8, nov: 4, cred: 6, reson: 7, act: 5 } }, { axes: { sig: 6, nov: 4, cred: 8, reson: 7, act: 5 } }),
    { significance: 70, novelty: 40, credibility: 70, resonance: 70, actionability: 50 });
});

// ---------- 公司库 ----------

test('company matching respects Chinese word edges and Latin word boundaries', () => {
  companies.syncCompanySeed({ force: true });
  const names = text => [...companies.matchText(text).values()].map(hit => hit.id);
  assert.deepEqual(names('千亿航天SY300FF液体火箭发动机评审立项'), []);
  assert.deepEqual(names('亿航发布VT35新机型'), ['ehang']);
  assert.deepEqual(names('高峰飞行活动'), []);
  assert.deepEqual(names('谷神星一号成功发射'), ['galactic-energy']);
  assert.deepEqual(names('Joby Aviation 与 Jobyland'), ['joby']);
  const subjects = companies.resolveSubjects({ title: '蓝箭航天朱雀三号完成首飞，星河动力同日发射', text: '另据 SpaceX 消息', modelSubjects: ['北京天兵科技有限公司', '某未知火箭公司'] });
  assert.deepEqual(subjects.map(s => [s.id, s.role]), [
    ['space-pioneer', 'primary'], ['landspace', 'primary'], ['galactic-energy', 'primary'], [null, 'primary'], ['spacex', 'mention']
  ]);
});

test('watching a company creates its search line; seed sync never overwrites the user mark', () => {
  reset();
  const marked = companies.setWatch('vertaxi', 2, '二期基金');
  assert.equal(marked.watch, 2);
  assert.equal(marked.sourceCreated, true);
  assert.ok(db.prepare("SELECT id FROM sources WHERE url = 'eastmoney://御风未来'").get());
  assert.equal(companies.setWatch('vertaxi', 1).sourceCreated, false, '已有检索线不重复创建');
  companies.syncCompanySeed({ force: true });
  assert.equal(companies.getCompany('vertaxi').watch, 1);
  assert.equal(companies.getCompany('vertaxi').watchNote, '二期基金');
  assert.throws(() => companies.setWatch('vertaxi', 5), /关注级别/);
});

test('adding a custom company links historical reports by its names', () => {
  reset();
  const src = source();
  const hit = article(src, { title: '某某低空科技完成A轮融资', summary: '某某低空科技专注物流 eVTOL。' });
  article(src, { title: '无关的发射新闻' });
  const result = companies.addCompany({ name: '某某低空科技', aliases: ['某某低空'], domain: 'lowaltitude', watch: 2 });
  assert.equal(result.linked, 1);
  assert.equal(result.company.custom, true);
  assert.equal(db.prepare('SELECT role FROM article_companies WHERE article_id = ?').get(hit).role, 'primary');
  assert.throws(() => companies.addCompany({ name: '某某低空科技' }), error => error.status === 409);
  companies.removeCompany(result.company.id);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM article_companies WHERE article_id = ?').get(hit).c, 0);
  assert.throws(() => companies.removeCompany('landspace'), error => error.status === 400);
});

// ---------- 融资事件 ----------

test('rounds and amounts are normalized without inventing precision', () => {
  assert.equal(deals.normalizeRound('Pre A+轮'), 'Pre-A+轮');
  assert.equal(deals.normalizeRound('b1轮'), 'B1轮');
  assert.equal(deals.normalizeRound('A+轮'), 'A+轮');
  assert.equal(deals.normalizeRound('新一轮'), '未披露');
  assert.equal(deals.normalizeRound('上市辅导备案'), '上市辅导');
  assert.equal(deals.parseAmountCny('3亿元'), 3e8);
  assert.equal(deals.parseAmountCny('5000万元人民币'), 5e7);
  for (const vague of ['数亿元', '近10亿元', '超3亿元', '1.2亿美元', '2亿多元']) assert.equal(deals.parseAmountCny(vague), null, vague);
});

test('heuristic deal extraction reads company, round, amount and investors from the headline', () => {
  const lead = deals.heuristicDeal({ title: '混动eVTOL企业追梦空天科技再获数亿元A+轮融资，由某资本领投' });
  assert.equal(lead.company, '追梦空天科技');
  assert.equal(lead.round, 'A+轮');
  assert.equal(lead.amountText, '数亿元');
  assert.deepEqual(lead.leadInvestors, ['某资本']);
  assert.equal(lead.status, 'completed');
  const after = deals.heuristicDeal({ title: '星际荣耀完成E轮近10亿元融资，布局可复用液氧甲烷火箭' });
  assert.equal(after.amountText, '近10亿元');
  assert.equal(deals.heuristicDeal({ title: '东方空间即将完成C轮融资' }).status, 'announced');
  assert.equal(deals.heuristicDeal({ title: '独家｜知情人士称某火箭公司洽谈新一轮融资' }), null);
});

test('reports of the same deal merge into one record with upgraded status and investor union', () => {
  reset();
  const src = source();
  const first = article(src, { title: '峰飞航空获B轮融资' });
  const second = article(src, { title: '峰飞航空完成B轮融资' });
  const rumor = { company: '峰飞航空科技', round: 'B轮', amountText: '', amountCny: null, investors: ['甲资本'], leadInvestors: [], date: null, status: 'rumored' };
  deals.recordDeal({ id: first }, rumor, { origin: 'heuristic', domain: 'lowaltitude' });
  deals.recordDeal({ id: second }, { ...rumor, amountText: '10亿元', amountCny: 1e9, investors: ['乙资本'], leadInvestors: ['乙资本'], status: 'completed' }, { origin: 'model' });
  const [deal] = deals.listDeals({ days: 30 });
  assert.equal(deals.listDeals({ days: 30 }).length, 1);
  assert.equal(deal.companyId, 'autoflight');
  assert.equal(deal.status, 'completed');
  assert.equal(deal.sourceCount, 2);
  assert.deepEqual(deal.investors.sort(), ['乙资本', '甲资本']);
  assert.equal(deal.amountText, '10亿元');
  assert.deepEqual(deals.investorBoard({ days: 30 }).map(i => [i.name, i.leads]).sort(), [['乙资本', 1], ['甲资本', 0]]);
  // 轮次不明的战略融资按月份分桶，不会把相隔数月的两次并成一条
  assert.notEqual(deals.dealKey('x', '战略融资', '2026-01-10'), deals.dealKey('x', '战略融资', '2026-06-10'));
  assert.equal(deals.dealKey('x', 'B轮', '2026-01-10'), deals.dealKey('x', 'B轮', '2026-06-10'));
});

// ---------- 事件归组与热度 ----------

test('grouping attaches near-duplicate reports, keeps different events apart and lets history found nothing', async () => {
  reset();
  const a = source('官方', 'T1');
  const b = source('媒体甲');
  const c = source('媒体乙');
  const at = new Date(Date.now() - 2 * HOUR).toISOString();
  const first = article(a, { title: '朱雀三号遥二运载火箭发射成功一子级完成海上回收', summary: '蓝箭航天朱雀三号遥二运载火箭在东风商业航天创新试验区发射成功，一子级完成海上回收。', at });
  const echo = article(b, { title: '蓝箭航天朱雀三号遥二发射成功 一子级海上回收', summary: '朱雀三号遥二运载火箭发射成功，一子级完成海上回收，蓝箭航天宣布。', at });
  const other = article(c, { title: '峰飞航空盛世龙获颁生产许可证', summary: '峰飞航空盛世龙 eVTOL 获颁生产许可证。', domain: 'lowaltitude', at });
  const old = article(c, { title: '十年前的一次试车回顾', summary: '回顾。', historical: true, at });
  const stats = await stories.groupPending({});
  assert.equal(stats.processed, 4);
  const story = id => db.prepare('SELECT cluster_id FROM articles WHERE id = ?').get(id).cluster_id;
  assert.ok(story(first));
  assert.equal(story(echo), story(first), '同一件事归入同一事件');
  assert.notEqual(story(other), story(first), '另一件事单独成事件');
  assert.equal(story(old), null, '历史资料不开新事件');
  assert.ok(db.prepare('SELECT grouped_at FROM articles WHERE id = ?').get(old).grouped_at);
  const main = db.prepare('SELECT main_article_id, size FROM clusters WHERE id = ?').get(story(first));
  assert.equal(main.size, 2);
  assert.equal(main.main_article_id, first, 'T1 官方稿当代表稿');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM story_signals WHERE story_id = ?').get(story(first)).c, 2);
  // 再跑一轮不重复处理
  assert.equal((await stories.groupPending({})).processed, 0);
});

test('an identical primary event key groups reports whose wording differs completely', async () => {
  reset();
  const at = new Date(Date.now() - HOUR).toISOString();
  const key = '垣信卫星|launch|千帆极轨07组';
  const x = article(source(), { title: '千帆极轨07组卫星发射成功', eventKey: key, at });
  const y = article(source(), { title: '长征六号改运载火箭一箭十八星', eventKey: key, at });
  await stories.groupPending({});
  const story = id => db.prepare('SELECT cluster_id FROM articles WHERE id = ?').get(id).cluster_id;
  assert.equal(story(x), story(y));
});

test('heat counts each independent participant once and decays with a 24-hour half-life', () => {
  const atMs = Date.parse('2026-09-29T12:00:00Z');
  const iso = hours => new Date(atMs - hours * HOUR).toISOString();
  const config = { windowHours: 48, halfLifeHours: 24 };
  const rows = hot.aggregateHeat([
    { story_id: 1, participant_key: 'pub:a', observed_at: iso(0) },
    { story_id: 1, participant_key: 'pub:a', observed_at: iso(10) }, // 同一出版方：只算最近一次
    { story_id: 1, participant_key: 'pub:b', observed_at: iso(24) },
    { story_id: 1, participant_key: 'pub:c', observed_at: iso(49) }, // 窗口外
    { story_id: 2, participant_key: 'pub:a', observed_at: iso(1) }
  ], atMs, config);
  const one = rows.find(r => r.storyId === 1);
  assert.equal(one.participants, 2);
  assert.ok(Math.abs(one.heat - 1.5) < 1e-9);
  // pub:a 首次出现在 10 小时前，不算近 6 小时的新参与者
  assert.equal(one.recent6h, 0);
  assert.equal(hot.heatIndex(one.heat), 15);
});

test('hot ranking lists only events with enough independent sources, with badges and representative', async () => {
  reset();
  const at = Date.now();
  const iso = hours => new Date(at - hours * HOUR).toISOString();
  const s1 = source('新华社', 'T1');
  const s2 = source('财联社');
  const s3 = source('证券时报');
  const summary = '星河动力智神星一号运载火箭在酒泉卫星发射中心首飞成功，将卫星顺利送入预定轨道。';
  const ids = [
    article(s1, { title: '智神星一号运载火箭首飞成功', summary, at: iso(2), publisher: '新华社' }),
    article(s2, { title: '智神星一号首飞成功 星河动力', summary, at: iso(1), publisher: '财联社' }),
    article(s3, { title: '星河动力智神星一号首飞成功', summary, at: iso(1), publisher: '证券时报' })
  ];
  for (const id of ids) db.prepare("UPDATE articles SET participant_key = 'pub:' || lower(publisher_id) WHERE id = ?").run(id);
  article(s2, { title: '某公司发布季度财报与低空业务展望', summary: '单一来源。', domain: 'lowaltitude', at: iso(1) });
  await stories.groupPending({});
  const entries = hot.computeHotEntries({ atMs: at });
  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.equal(entry.participantCount, 3);
  assert.equal(entry.reportCount, 3);
  assert.ok(entry.badges.includes('new'));
  assert.ok(entry.badges.includes('surge'));
  assert.equal(entry.representative.source, '新华社');
  assert.deepEqual(entry.sourceNames.slice(0, 1), ['新华社']);
  assert.equal(hot.computeHotEntries({ atMs: at, domain: 'lowaltitude' }).length, 0);
  const ranking = hot.latestHot({ atMs: at, maxAgeMs: 0 });
  assert.equal(ranking.entries.length, 1);
  // 小时快照覆盖所有活跃事件（包括只有一个信源、还没上榜的），走势图才连续
  assert.equal(hot.snapshotHeat(at).stories, 2);
  assert.equal(hot.storyDetail(entry.storyId).participants.length, 3);
});

// ---------- 刊期 ----------

test('weekly and monthly windows follow ISO weeks and calendar months in local time', () => {
  const week = reports.resolvePeriod('weekly', '2026-W40');
  const monday = new Date(week.start);
  assert.equal(monday.getDay(), 1);
  assert.equal(Date.parse(week.end) - Date.parse(week.start), 7 * 86400e3);
  assert.equal(reports.periodKeyOf('weekly', new Date(2026, 8, 29)), '2026-W40');
  assert.equal(reports.periodKeyOf('weekly', new Date(2027, 0, 1)), '2026-W53');
  const month = reports.resolvePeriod('monthly', '2026-02');
  assert.equal(new Date(month.start).getDate(), 1);
  assert.equal(new Date(month.end).getMonth(), 2);
  assert.throws(() => reports.resolvePeriod('weekly', '2026-40'), error => error.status === 400);
  assert.throws(() => reports.resolvePeriod('monthly', '2026-13'), error => error.status === 400);
});

test('a period issue folds each event once and carries deals, portfolio and a factual lead', async () => {
  reset();
  const src = source('新华社', 'T1');
  const at = new Date(Date.now() - HOUR).toISOString();
  const a1 = article(src, { title: '天兵科技天龙三号首飞成功', summary: '天兵科技天龙三号运载火箭首飞成功入轨。', featured: true, score: 80, at,
    subjects: [{ id: 'space-pioneer', name: '天兵科技', role: 'primary' }] });
  article(source('媒体'), { title: '天兵科技天龙三号运载火箭首飞成功入轨', summary: '天兵科技天龙三号运载火箭首飞成功入轨。', featured: true, score: 70, at });
  companies.writeArticleCompanies(a1, [{ id: 'space-pioneer', role: 'primary' }]);
  companies.setWatch('space-pioneer', 2);
  deals.recordDeal({ id: a1 }, deals.normalizeDeal({ company: '天兵科技', round: 'C轮', amount: '数亿元', status: 'completed' }), { domain: 'aerospace' });
  await stories.groupPending({});
  const start = new Date(Date.now() - 24 * HOUR).toISOString();
  const issue = reports.composeIssue({ start, end: new Date().toISOString(), label: '测试刊', periodLabel: '日报' });
  const featured = issue.sections.flatMap(s => s.items);
  assert.equal(featured.length, 1, '同一事件在一期里只出现一次');
  assert.equal(featured[0].id, a1);
  assert.equal(issue.deals.length, 1);
  assert.equal(issue.portfolio[0].id, 'space-pioneer');
  assert.equal(issue.leadSource, 'factual');
  assert.match(issue.lead, /测试刊共收录两行业相关情报 2 条/);
  assert.match(issue.lead, /天兵科技C轮/);
});

// ---------- 启发式与落库 ----------

test('the heuristic path still produces a complete v0.2 record without a key', () => {
  reset();
  const src = source('官方试验平台', 'T1');
  const id = article(src, { title: '蓝箭航天朱雀三号运载火箭完成首飞', summary: '火箭发射入轨并完成一子级回收。' });
  const row = db.prepare('SELECT a.*, s.tier, s.name AS source_name FROM articles a JOIN sources s ON s.id = a.source_id WHERE a.id = ?').get(id);
  const h = heuristicAnalyze(row);
  assert.equal(h.relevant, true);
  assert.equal(h.understanding.category, '发射与任务');
  persistAnalysis(row, h.domain, h, { selection: industry.loadSelection(), breakthroughs: require('../server/config').loadBreakthroughs(), analyzedFlag: 3 });
  const saved = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
  assert.equal(saved.analysis_version, 3);
  assert.equal(saved.item_type, 'launch_flight');
  assert.equal(saved.score_a, saved.score_b);
  assert.ok(saved.selection_threshold < industry.loadSelection().thresholds.T1);
  assert.deepEqual(JSON.parse(saved.subjects_json).map(s => s.id), ['landspace']);
  assert.equal(db.prepare('SELECT company_id FROM article_companies WHERE article_id = ?').get(id).company_id, 'landspace');
});

// ---------- 回执与预算 ----------

test('receipts replay paid results and the budget fuse stops new calls', async () => {
  reset();
  let calls = 0;
  const run = () => receipts.withReceipt({ task: 't', keyParts: ['v1', 'input'], call: async () => { calls++; return { ok: true }; } });
  assert.deepEqual((await run()).value, { ok: true });
  assert.equal((await run()).cached, true);
  assert.equal(calls, 1);
  // 校验不过的结果不落回执：下次照常重试
  let bad = 0;
  await receipts.withReceipt({ task: 't', keyParts: ['v1', 'bad'], validate: () => false, call: async () => { bad++; return {}; } });
  await receipts.withReceipt({ task: 't', keyParts: ['v1', 'bad'], validate: () => false, call: async () => { bad++; return {}; } });
  assert.equal(bad, 2);
  const nowMs = Date.parse('2026-09-29T10:15:00Z');
  receipts.reserveCall(nowMs, { maxCallsPerHour: 2, maxCallsPerDay: 10 });
  receipts.reserveCall(nowMs, { maxCallsPerHour: 2, maxCallsPerDay: 10 });
  assert.throws(() => receipts.reserveCall(nowMs, { maxCallsPerHour: 2, maxCallsPerDay: 10 }), error => error.budgetExceeded && error.scope === 'hour');
  assert.doesNotThrow(() => receipts.reserveCall(nowMs + HOUR, { maxCallsPerHour: 2, maxCallsPerDay: 10 }));
});

// ---------- 校准工具 ----------

test('selection calibration reads gold samples and computes precision and recall', () => {
  const { readGold, metrics } = require('../scripts/eval-selection');
  const cases = readGold(path.join(__dirname, '..', 'config', 'industry', 'gold.example.jsonl'));
  assert.deepEqual(cases.map(c => c.gold.decision), ['select', 'reject']);
  const result = metrics([
    { gold: 'select', selected: true }, { gold: 'select', selected: false },
    { gold: 'reject', selected: true }, { gold: 'reject', selected: false }, { gold: 'either', selected: true }
  ], r => r.selected);
  assert.deepEqual(result, { total: 4, tp: 1, fp: 1, fn: 1, tn: 1, accuracy: 50, precision: 50, recall: 50 });
  const bad = path.join(dataDir, 'bad.jsonl');
  fs.writeFileSync(bad, '{"caseId":"x","material":{"title":"t"},"gold":{"decision":"maybe"}}\n');
  assert.throws(() => readGold(bad), /gold\.decision/);
});

test('an undisclosed-round report joins the same company\'s recent named deal in either order', () => {
  reset();
  const src = source();
  const [a, b, c, d] = [1, 2, 3, 4].map(n => article(src, { title: `报道 ${n}` }));
  deals.recordDeal({ id: a }, deals.normalizeDeal({ company: '箭元科技', round: 'B轮', amount: '超23亿元', status: 'completed' }));
  deals.recordDeal({ id: b }, deals.normalizeDeal({ company: '箭元科技', round: '新一轮', amount: '超23亿元', status: 'completed' }));
  assert.equal(deals.listDeals({ days: 30 }).length, 1);
  assert.equal(deals.listDeals({ days: 30 })[0].sourceCount, 2);
  // 先到“未披露”，后到写明轮次：同一条记录补上轮次
  deals.recordDeal({ id: c }, deals.normalizeDeal({ company: '天兵科技', round: '', status: 'announced' }));
  deals.recordDeal({ id: d }, deals.normalizeDeal({ company: '天兵科技', round: 'C轮', investors: ['甲'], status: 'completed' }));
  const tianbing = deals.listDeals({ days: 30 }).filter(x => x.companyId === 'space-pioneer');
  assert.equal(tianbing.length, 1);
  assert.equal(tianbing[0].round, 'C轮');
  assert.equal(tianbing[0].status, 'completed');
  assert.equal(tianbing[0].sourceCount, 2);
});
