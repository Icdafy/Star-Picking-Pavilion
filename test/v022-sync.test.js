'use strict';
// v0.2.2：AIHOT 上游修复同步（Atom XHTML、无时区日期、刊期漏计）与交易所 IPO 审核信源、资本守卫、关系评测
const test = require('node:test');
const assert = require('node:assert/strict');
const Parser = require('rss-parser');
const { flattenAtomXhtml, sanitizeXml, cleanText } = require('../server/collectors/rss');
const { parseLooseDate, looseDateIso } = require('../server/collectors/loose-date');
const api = require('../server/collectors/api');
const evalRelations = require('../scripts/eval-relations');

test('Atom type="xhtml" 标题与摘要保持文字与语序，不再变成 [object Object]', async () => {
  const xml = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>t</title><entry>'
    + '<title type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">Rocket <b>Lab</b> raises R&amp;D funds</div></title>'
    + '<link href="https://example.com/a"/><updated>2026-09-29T10:00:00Z</updated>'
    + '<summary type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>First <em>para</em> &lt;ok&gt;</p></div></summary></entry></feed>';
  const feed = await new Parser().parseString(flattenAtomXhtml(sanitizeXml(xml)));
  assert.equal(typeof feed.items[0].title, 'string');
  assert.equal(cleanText(feed.items[0].title), 'Rocket Lab raises R&D funds');
  assert.match(cleanText(feed.items[0].summary || feed.items[0].contentSnippet), /First para/);
  // 非 xhtml 的文本结构不受影响
  assert.equal(flattenAtomXhtml('<title type="html">&lt;b&gt;x&lt;/b&gt;</title>'), '<title type="html">&lt;b&gt;x&lt;/b&gt;</title>');
});

test('无时区的列表页日期按信源时区读，与本机时区无关', () => {
  assert.equal(looseDateIso('2026-09-26 10:00'), '2026-09-26T02:00:00.000Z');
  assert.equal(looseDateIso('2026/9/6'), '2026-09-05T16:00:00.000Z');
  assert.equal(looseDateIso('2026年9月26日 08:30'), '2026-09-26T00:30:00.000Z');
  assert.equal(looseDateIso('2026-09-26T10:00'), '2026-09-26T02:00:00.000Z');
  assert.equal(looseDateIso('2026-09-26 10:00', '+00:00'), '2026-09-26T10:00:00.000Z');
  // 带时区与单独 ISO 日期保持 Date.parse 读法
  assert.equal(looseDateIso('2026-09-26T10:00:00Z'), '2026-09-26T10:00:00.000Z');
  assert.equal(looseDateIso('2026-09-26 10:00:00 +0000'), '2026-09-26T10:00:00.000Z');
  assert.equal(looseDateIso('2026-09-26'), '2026-09-26T00:00:00.000Z');
  // 非法日期不被 Date 顺延
  assert.equal(parseLooseDate('2026-02-30 10:00'), null);
  assert.equal(parseLooseDate('2026-13-01'), null);
  assert.equal(parseLooseDate(''), null);
  assert.equal(parseLooseDate('没有日期'), null);
});

test('交易所 IPO 审核项目映射为“项目 × 状态”资料，状态变化产生新地址', () => {
  const now = Date.parse('2026-09-30T00:00:00Z');
  const sse = JSON.stringify({ result: [
    { stockAuditName: '蓝箭航天空间科技股份有限公司', currStatus: 2, registeResult: '', updateDate: '20260629173209', stockAuditNum: '2174', planIssueCapital: 75,
      intermediary: [{ i_intermediaryType: 1, i_intermediaryAbbrName: '中金公司' }] },
    { stockAuditName: '示例卫星股份有限公司', currStatus: 5, registeResult: '1', updateDate: '20260106100000', stockAuditNum: '2096' },
    { stockAuditName: '中国铁路通信信号股份有限公司', currStatus: 5, registeResult: '1', updateDate: '20260601000000', stockAuditNum: '1' },
    { stockAuditName: '示例老项目股份有限公司', currStatus: 5, registeResult: '1', updateDate: '20190705000000', stockAuditNum: '3' },
    { stockAuditName: '坏数据', currStatus: 99, updateDate: '20260601000000', stockAuditNum: '4' }
  ] });
  const items = api.mapSseIpoResponse(sse, { days: 540 }, now);
  assert.deepEqual(items.map(i => i.title), ['蓝箭航天空间科技股份有限公司科创板IPO审核状态：已问询', '示例卫星股份有限公司科创板IPO审核状态：注册生效']);
  assert.equal(items[0].publishedAt, '2026-06-29T09:32:09.000Z');
  assert.equal(items[0].url, 'https://kcb.sse.com.cn/renewal/xmxq/index.shtml?auditId=2174&st=2');
  assert.match(items[0].summary, /拟募资 75 亿元；保荐机构 中金公司/);
  assert.equal(items[0].publisherId, '上交所');
  assert.notEqual(items[1].url, items[0].url.replace('2174', '2096'));

  const szse = JSON.stringify({ data: [
    { prjid: 1004408, cmpnm: '四川腾盾科创股份有限公司', cmpsnm: '腾盾科创', prjst: '已问询', prjstatus: 30, boardName: '创业板',
      csrcind: '铁路、船舶、航空航天和其他运输设备制造业', updtdt: '2026-09-29', maramt: '30.2121', sprinsts: '中金公司', acptdt: '2026-06-01' },
    { prjid: 1, cmpnm: '安徽某汽车零部件股份有限公司', prjst: '已问询', prjstatus: 30, csrcind: '汽车制造业', updtdt: '2026-09-29' }
  ] });
  const deep = api.mapSzseIpoResponse(szse, { industry: '航空航天', days: 540 }, now);
  assert.equal(deep.length, 1);
  assert.equal(deep[0].title, '四川腾盾科创股份有限公司创业板IPO审核状态：已问询');
  assert.equal(deep[0].url, 'https://listing.szse.cn/projectdynamic/ipo/detail/index.html?id=1004408&st=30');
  assert.equal(deep[0].publishedAt, '2026-09-28T16:00:00.000Z');
  assert.throws(() => api.mapSzseIpoResponse('{}', { days: 1 }), /缺少 data/);
  assert.throws(() => api.mapSseIpoResponse('{}', { days: 1 }), /缺少 result/);
});

test('IPO 信源地址校验与采集层同源', () => {
  assert.deepEqual(api.parseIpoSpec('sseipo://?csrc=C37', 'sseipo://'), { keyword: '', csrc: 'C37', industry: '', days: 540, pages: 1 });
  assert.equal(api.parseApiSpec('szseipo://卫星?days=90').keyword, '卫星');
  assert.throws(() => api.parseApiSpec('sseipo://'), /关键词或行业/);
  assert.throws(() => api.parseApiSpec('sseipo://?csrc=37'), /行业代码/);
  assert.throws(() => api.parseApiSpec('szseipo://航天?pages=9'), /pages/);
  const { validateSourceInput } = require('../server/input-validation');
  if (typeof validateSourceInput === 'function') {
    assert.doesNotThrow(() => validateSourceInput({ name: '上交所', type: 'api', url: 'sseipo://?csrc=C37', tier: 'T1', domain: 'both' }));
  }
});

test('资本守卫：领域相关且标题带资本信号；融资租赁、两融等非股权融资剔除', () => {
  const g = api.capitalGuard;
  assert.equal(g({ title: '执宇航天完成亿元级天使+轮融资 可复用小火箭即将投产', summary: '' }), true);
  assert.equal(g({ title: '览翌航空完成超亿元Pre-A++轮融资，加速eVTOL研发', summary: '' }), true);
  assert.equal(g({ title: '全国首单吨级eVTOL融资租赁完成', summary: '' }), false);
  assert.equal(g({ title: '星舰首次入轨！商业航天组网提速 多股获融资客抢筹', summary: '' }), false);
  assert.equal(g({ title: '某创新药企业完成5亿元C轮融资', summary: '' }), false);
  assert.equal(g({ title: '海南商业航天发射场二期项目开展合练', summary: '' }), false);
  assert.deepEqual(api.parseEastmoneySpec('eastmoney://商业航天 完成融资?pages=2&guard=capital').guard, 'capital');
});

test('新增默认信源均可被采集层解析，且地址唯一', () => {
  const seed = require('../config/sources.default.json');
  assert.ok(seed._version >= 11);
  const urls = new Set();
  for (const source of seed.sources) {
    assert.ok(!urls.has(source.url), `重复信源 ${source.url}`);
    urls.add(source.url);
    if (source.type === 'api') assert.doesNotThrow(() => api.parseApiSpec(source.url), source.url);
  }
  for (const url of ['sseipo://?csrc=C37&days=540', 'szseipo://?industry=航空航天&pages=3&days=540', 'eastmoney://商业航天 完成融资?pages=2&mode=both&guard=capital',
    'https://www.chinaventure.com.cn/news/111.html', 'https://evtolinsights.com/feed/']) assert.ok(urls.has(url), url);
});

test('关系评测：解析 AIHOT 四分类、确定性抽样、混淆矩阵与合并门槛', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const rows = evalRelations.parseGold(fs.readFileSync(path.join(__dirname, '../config/industry/relation-gold.example.jsonl'), 'utf8'));
  assert.deepEqual(rows.map(r => r.gold), ['same', 'development', 'different', 'different']);
  assert.throws(() => evalRelations.parseGold('{"caseId":"x","a":{"title":"a"},"b":{"title":"b"},"gold":{"relation":"MAYBE"}}'), /gold.relation/);
  assert.throws(() => evalRelations.parseGold(['{"caseId":"x","a":{"title":"a"},"b":{"title":"b"},"gold":{"relation":"same"}}',
    '{"caseId":"x","a":{"title":"a"},"b":{"title":"b"},"gold":{"relation":"same"}}'].join('\n')), /重复/);
  assert.deepEqual(evalRelations.sample(rows, { seed: 3 }).map(r => r.caseId), evalRelations.sample(rows, { seed: 3 }).map(r => r.caseId));
  assert.equal(evalRelations.sample(rows, { split: 'holdout' }).length, 2);

  const verdicts = { 'example-same-round': ['same', 0.9], 'example-follow-up': ['same', 0.7], 'example-different-round': ['different', 0.8] };
  const { predictions, failures } = await evalRelations.evaluate(rows, {
    judgePair: async doc => {
      const row = rows.find(r => r.b.title === doc.title && verdicts[r.caseId]);
      if (!row) throw new Error('模型响应不可用');
      const [relation, confidence] = verdicts[row.caseId];
      return { relation, confidence };
    }
  });
  assert.equal(failures.length, 1);
  const metrics = evalRelations.relationMetrics(predictions, rows.length);
  assert.equal(metrics.errors, 1);
  assert.equal(metrics.confusionMatrix.development.same, 1);
  assert.equal(metrics.perClass.same.precision, 0.5);
  const merge = evalRelations.mergeMetrics(predictions, 0.75);
  assert.deepEqual([merge.tp, merge.fp, merge.fn, merge.tn], [1, 0, 1, 1]);
});
