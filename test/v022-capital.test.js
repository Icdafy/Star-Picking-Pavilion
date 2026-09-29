'use strict';
// v0.2.2：一级市场升级——事件性质、阶段与量级、名称变体去重、概览、导出；刊期归属与事件合并
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v022-'));
process.env.STAR_PICKING_PAVILION_DATA_DIR = dir;
const { db, insertArticle, closeDatabase } = require('../server/db');
const companies = require('../server/ai/companies');
const deals = require('../server/ai/deals');
const reports = require('../server/ai/reports');
const stories = require('../server/ai/stories');
const { migrateCapital, mergeDealVariants } = require('../server/ai/capital-migration');
test.after(() => { closeDatabase(); fs.rmSync(dir, { recursive: true, force: true }); });

let seq = 0;
function article(title, { publishedAt = new Date().toISOString(), summary = '', domain = 'lowaltitude' } = {}) {
  const n = ++seq;
  const url = `https://example.org/v022/${n}`;
  const source = Number(db.prepare("INSERT INTO sources(name,type,url,tier,domain) VALUES(?,'html',?,'T2',?)").run('媒体' + n, url, domain).lastInsertRowid);
  insertArticle({ sourceId: source, title, url, canonicalUrl: url, summaryRaw: summary });
  const id = db.prepare('SELECT id FROM articles WHERE url=?').get(url).id;
  db.prepare('UPDATE articles SET relevant=1, analyzed=1, published_at=?, domain=?, ai_summary=? WHERE id=?').run(publishedAt, domain, summary, id);
  return { id };
}

test('事件性质、阶段与金额量级：只做分档，不冒充精确金额', () => {
  assert.equal(deals.classifyKind({ round: 'A轮', text: '完成A轮融资' }), 'equity');
  assert.equal(deals.classifyKind({ round: '未披露', text: '金银河拟定增募资不超过15亿元' }), 'secondary');
  assert.equal(deals.classifyKind({ round: '未披露', text: '上市公司发行募资', companyStatus: 'listed' }), 'secondary');
  assert.equal(deals.classifyKind({ round: '未披露', text: '皖江金租与某公司签订融资租赁合同' }), 'debt');
  assert.equal(deals.classifyKind({ round: '未披露', text: '华力创通拟设3亿元合资公司空驭智航' }), 'jv');
  assert.equal(deals.classifyKind({ round: 'IPO' }), 'ipo');
  assert.equal(deals.classifyKind({ round: '股权转让' }), 'ma');
  assert.deepEqual(['天使+轮', 'Pre-A++轮', 'A+轮', 'B1轮', 'C轮', 'D轮', 'Pre-IPO', 'IPO', '战略融资', '未披露'].map(deals.stageOf),
    ['early', 'early', 'early', 'growth', 'growth', 'late', 'late', 'ipo', 'strategic', 'unknown']);
  assert.equal(deals.tierOf({ amountText: '数千万元' }), 'm10');
  assert.equal(deals.tierOf({ amountText: '近亿元' }), 'm10');
  assert.equal(deals.tierOf({ amountText: '超亿元' }), 'b1');
  assert.equal(deals.tierOf({ amountText: '约10亿美元' }), 'b10');
  assert.equal(deals.tierOf({ amountText: '5000万美元' }), 'b1');
  assert.equal(deals.tierOf({ amountText: '', amountCny: 3e8 }), 'b1');
  assert.equal(deals.tierOf({ amountText: '未披露' }), null);
});

test('库外公司名称变体：地名、括号、法律形式与母品牌前缀视为同一家；通用字号不猜', () => {
  const id = deals.dealIdentity;
  assert.equal(id('广东高域科技有限公司'), '高域');
  assert.equal(id('高域科技'), '高域');
  assert.equal(id('云途航空科技（上海）有限公司'), '云途');
  assert.equal(id('深圳市庆为航空科技有限公司'), '庆为');
  assert.ok(deals.sameIdentity('高域', id('广汽高域')));
  assert.ok(!deals.sameIdentity('中科', '中科宇航'));
  assert.ok(!deals.sameIdentity('星河', '星河动力卫星发射服务'));
  assert.ok(deals.roundsCompatible('未披露', 'A轮'));
  assert.ok(!deals.roundsCompatible('未披露', '并购'));
  assert.ok(!deals.roundsCompatible('A轮', 'B轮'));
});

test('同一笔融资的全称、简称与母品牌写法合并为一条，证据与投资方取并集；公司库按字号精确归属', () => {
  companies.syncCompanySeed();
  const a = article('广汽某翼完成超8亿元融资', { publishedAt: '2026-09-20T02:00:00Z' });
  const b = article('某翼科技完成8亿元A轮融资', { publishedAt: '2026-09-22T02:00:00Z' });
  const c = article('广东某翼科技有限公司完成A轮融资', { publishedAt: '2026-09-23T02:00:00Z' });
  db.exec('BEGIN');
  const zero = deals.recordDeal(a, deals.normalizeDeal({ company: '广汽某翼', round: '未披露', amount: '超8亿元', investors: ['晨熹资本'], status: 'completed' }), { domain: 'lowaltitude' });
  const first = deals.recordDeal(b, deals.normalizeDeal({ company: '某翼科技', round: 'A轮', amount: '8亿元', investors: ['复星锐正'], status: 'completed' }), { domain: 'lowaltitude' });
  const second = deals.recordDeal(c, deals.normalizeDeal({ company: '广东某翼科技有限公司', round: 'A轮', amount: '', investors: ['盛宇投资'], status: 'completed' }), { domain: 'lowaltitude' });
  db.exec('COMMIT');
  assert.equal(zero, first);
  assert.equal(first, second);
  const row = db.prepare('SELECT * FROM deals WHERE id=?').get(first);
  assert.equal(row.round, 'A轮', '未披露轮次由写明轮次的报道补全');
  assert.equal(row.source_count, 3);
  assert.deepEqual(JSON.parse(row.investors_json).sort(), ['复星锐正', '晨熹资本', '盛宇投资'].sort());
  // 公司库内公司：地名 + 字号 + 行业后缀 的全称按字号唯一命中
  assert.equal(deals.resolveDealCompany('深圳市庆为航空科技有限公司')?.id, 'qingwei-aviation');
  assert.equal(deals.resolveDealCompany('广东高域科技有限公司')?.id, 'govy');
  assert.equal(deals.resolveDealCompany('某某科技有限公司'), null);
});

test('迁移把旧版重复记录合并、按性质分类；一级市场列表、机构榜与概览默认排除再融资与债权', () => {
  const x = article('金银河：拟定增募资不超过15亿元', { publishedAt: '2026-09-25T02:00:00Z' });
  const y = article('云途航空完成数千万元Pre-A轮融资，浦东创投领投', { publishedAt: '2026-09-21T02:00:00Z' });
  const z = article('云途航空科技（上海）有限公司完成新一轮融资', { publishedAt: '2026-09-24T02:00:00Z' });
  const stamp = new Date().toISOString();
  const insert = db.prepare(`INSERT INTO deals (deal_key, company_id, company_name, domain, round, amount_text, investors_json, lead_investors_json,
      status, first_article_id, article_ids_json, source_count, origin, first_seen_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,'model',?,?)`);
  insert.run('name:金银河|未披露|2026-09', null, '金银河', 'lowaltitude', '未披露', '不超过15亿元', '[]', '[]', 'announced', x.id, JSON.stringify([x.id]), stamp, stamp);
  insert.run('name:云途航空|Pre-A轮', null, '云途航空', 'lowaltitude', 'Pre-A轮', '数千万元', '["浦东创投"]', '["浦东创投"]', 'completed', y.id, JSON.stringify([y.id]), stamp, stamp);
  insert.run('name:云途航空科技（上海）|未披露|2026-09', null, '云途航空科技（上海）有限公司', 'lowaltitude', '未披露', null, '["德清莫干山基金"]', '[]', 'completed', z.id, JSON.stringify([z.id]), stamp, stamp);
  db.prepare("DELETE FROM meta WHERE key='capitalV022'").run();
  assert.equal(migrateCapital(), true);
  assert.equal(migrateCapital(), false, '迁移幂等');
  const yuntu = db.prepare("SELECT * FROM deals WHERE company_id='yuntu-aviation'").all();
  assert.equal(yuntu.length, 1);
  assert.equal(yuntu[0].round, 'Pre-A轮');
  assert.equal(yuntu[0].source_count, 2);
  assert.equal(db.prepare("SELECT deal_kind FROM deals WHERE company_name='金银河'").get().deal_kind, 'secondary');
  assert.equal(mergeDealVariants(), 0, '再次合并无变化');

  const listed = deals.listDeals({ days: 3650, limit: 100 });
  assert.ok(!listed.some(d => d.companyName === '金银河'));
  assert.ok(deals.listDeals({ days: 3650, kind: 'all' }).some(d => d.companyName === '金银河'));
  assert.ok(deals.listDeals({ days: 3650, kind: 'secondary' }).every(d => d.kind === 'secondary'));
  assert.ok(deals.listDeals({ days: 3650, stage: 'early' }).every(d => d.stage === 'early'));
  assert.ok(deals.listDeals({ days: 3650, q: '浦东创投' }).some(d => d.companyId === 'yuntu-aviation'), '检索覆盖投资方');

  const board = deals.investorBoard({ days: 3650 });
  const pudong = board.find(i => i.name === '浦东创投');
  assert.equal(pudong.deals, 1);
  assert.equal(pudong.leads, 1);
  assert.equal(pudong.stages[0].id, 'early');

  const o = deals.overview({ days: 3650 });
  assert.equal(o.totals.deals, deals.listDeals({ days: 3650, limit: 500 }).length);
  assert.ok(o.totals.excluded >= 1);
  assert.ok(o.excludedKinds.some(k => k.id === 'secondary'));
  assert.equal(o.stages.reduce((s, x) => s + x.count, 0), o.totals.deals);
  assert.equal(o.tiers.reduce((s, x) => s + x.count, 0), o.totals.deals);
  assert.ok(o.monthly.length >= 1 && o.monthly.length <= 12);
});

test('导出 CSV 防公式注入、Markdown 表格转义竖线', () => {
  const t = article('=HYPERLINK("x")示例公司完成A轮融资', { publishedAt: '2026-09-26T02:00:00Z' });
  db.exec('BEGIN');
  deals.recordDeal(t, deals.normalizeDeal({ company: '=示例|公司', round: 'A轮', amount: '1亿元', investors: ['+机构'], status: 'completed' }), { domain: 'aerospace' });
  db.exec('COMMIT');
  const csv = deals.exportDeals({ days: 3650 }, 'csv');
  assert.match(csv.filename, /\.csv$/);
  assert.match(csv.content, /'=示例\|公司/);
  assert.match(csv.content, /'\+机构/);
  assert.doesNotMatch(csv.content, /(^|,)=/m);
  const md = deals.exportDeals({ days: 3650 }, 'markdown');
  assert.match(md.content, /=示例\\\|公司/);
  assert.equal(md.count, csv.count);
});

test('周报按“采集与归组较晚者”归属：上期末采到、本期才归组的资料进入本期，不重复不漏计', () => {
  const late = article('示例事件跨越刊期边界', { publishedAt: '2026-09-27T15:00:00Z' });
  db.prepare("UPDATE articles SET fetched_at='2026-09-27T15:59:00.000Z', grouped_at='2026-09-27T16:05:00.000Z', featured=1, category='企业动态' WHERE id=?").run(late.id);
  const pending = article('尚未归组的资料', { publishedAt: '2026-09-27T15:00:00Z' });
  db.prepare("UPDATE articles SET fetched_at='2026-09-27T15:00:00.000Z', grouped_at=NULL WHERE id=?").run(pending.id);
  const previous = reports.composeIssue({ start: '2026-09-20T16:00:00.000Z', end: '2026-09-27T16:00:00.000Z', label: '上周', periodLabel: '周报', basis: 'released' });
  const current = reports.composeIssue({ start: '2026-09-27T16:00:00.000Z', end: '2026-10-04T16:00:00.000Z', label: '本周', periodLabel: '周报', basis: 'released' });
  const inPrevious = previous.sections.flatMap(s => s.items).some(i => i.id === late.id);
  const inCurrent = current.sections.flatMap(s => s.items).some(i => i.id === late.id);
  assert.equal(inPrevious, false);
  assert.equal(inCurrent, true);
  assert.equal(current.window.basis, 'released_at');
  const fetchedBasis = reports.composeIssue({ start: '2026-09-20T16:00:00.000Z', end: '2026-09-27T16:00:00.000Z', label: '日报口径', periodLabel: '日报' });
  assert.equal(fetchedBasis.window.basis, 'fetched_at');
  assert.ok(fetchedBasis.sections.flatMap(s => s.items).some(i => i.id === late.id));
});

test('刊期融资按入库时间归属：报道日期更早、本期才抽出的融资计入本期', () => {
  const old = article('旧报道里补抽出的融资', { publishedAt: '2026-08-01T02:00:00Z' });
  db.exec('BEGIN');
  const id = deals.recordDeal(old, deals.normalizeDeal({ company: '补抽示例航天', round: 'B轮', amount: '数亿元', status: 'completed' }), { domain: 'aerospace' });
  db.exec('COMMIT');
  db.prepare("UPDATE deals SET first_seen_at='2026-09-29T01:00:00.000Z' WHERE id=?").run(id);
  const issue = reports.composeIssue({ start: '2026-09-28T16:00:00.000Z', end: '2026-09-29T16:00:00.000Z', label: '日报', periodLabel: '日报' });
  assert.ok(issue.deals.some(d => d.id === id));
});

test('事件合并：标题几乎相同的并行事件合并为一条，不同事件保持独立；无 Key 不调模型', async () => {
  const mk = (title, summary) => {
    const a = article(title, { summary, domain: 'aerospace', publishedAt: new Date(Date.now() - 3600e3).toISOString() });
    const storyId = Number(db.prepare("INSERT INTO clusters (main_article_id, size, updated_at, title, domain, latest_at, first_report_at) VALUES (?,1,?,?, 'aerospace', ?, ?)")
      .run(a.id, new Date().toISOString(), title, new Date().toISOString(), new Date().toISOString()).lastInsertRowid);
    db.prepare("UPDATE articles SET cluster_id=?, story_relation='primary', grouped_at=? WHERE id=?").run(storyId, new Date().toISOString(), a.id);
    return storyId;
  };
  const s1 = mk('示例星舰第十四次试飞首次入轨部署二十六颗卫星', '示例星舰首次入轨并部署卫星。');
  const s2 = mk('示例星舰第十四次试飞首次入轨部署二十六颗卫星', '同一次试飞的另一组报道。');
  const s3 = mk('示例火箭公司完成数亿元B轮融资', '与试飞无关的融资。');
  const result = await stories.consolidateStories({ settings: null });
  assert.equal(result.judged, 0);
  assert.equal(result.merged, 1);
  const merged = db.prepare('SELECT id, merged_into FROM clusters WHERE id IN (?, ?)').all(s1, s2);
  assert.equal(merged.filter(r => r.merged_into).length, 1);
  assert.equal(db.prepare('SELECT merged_into FROM clusters WHERE id=?').get(s3).merged_into, null);
  const again = await stories.consolidateStories({ settings: null });
  assert.equal(again.merged, 0);
});

test('转载文章按“文章来源”补出版方，同一出版方的不同写法计为一个独立信源', () => {
  const { reprintSource, extractContent } = require('../server/collectors/article-content');
  const { publisherKey } = require('../server/ai/pipeline');
  const { backfillPublishers } = require('../server/ai/publisher-backfill');
  assert.equal(reprintSource('正文……（文章来源：界面新闻）'), '界面新闻');
  assert.equal(reprintSource('没有来源'), '');
  assert.equal(extractContent('<html><body><div id="ContentBody"><p>正文</p><p class="em_media">（文章来源：证券时报网）</p></div></body></html>', 'https://finance.eastmoney.com/a/1.html').publisherId, '证券时报网');
  assert.equal(publisherKey('证券时报网'), publisherKey('证券时报'));
  assert.equal(publisherKey('上海证券报·中国证券网'), '上海证券报');
  const a = article('示例转载一', { domain: 'aerospace' });
  const b = article('示例转载二', { domain: 'aerospace' });
  db.prepare("UPDATE articles SET content_text='正文（文章来源：证券时报网）', publisher_id=NULL, participant_key='source:1' WHERE id=?").run(a.id);
  db.prepare("UPDATE articles SET content_text='正文（文章来源：证券时报）', publisher_id=NULL, participant_key='source:2' WHERE id=?").run(b.id);
  const story = Number(db.prepare("INSERT INTO clusters (main_article_id, size, updated_at, title, domain) VALUES (?, 2, ?, '示例', 'aerospace')").run(a.id, new Date().toISOString()).lastInsertRowid);
  for (const [id, key] of [[a.id, 'source:1'], [b.id, 'source:2']]) {
    db.prepare("INSERT INTO story_signals (article_id, story_id, participant_key, participant_name, tier, observed_at) VALUES (?, ?, ?, '东财检索', 'T2', ?)").run(id, story, key, new Date().toISOString());
  }
  const stats = backfillPublishers();
  assert.ok(stats.publishers >= 2);
  const participants = db.prepare('SELECT COUNT(DISTINCT participant_key) c FROM story_signals WHERE story_id = ?').get(story).c;
  assert.equal(participants, 1, '同一出版方的两篇转载只算一个独立信源');
  assert.deepEqual(backfillPublishers(), { skipped: true });
});
