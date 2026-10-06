'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { startServer } = require('./helpers/server-child');
const { API_TOKEN_HEADER } = require('../server/http-security');
const { renderDaily, exportFilename } = require('../server/export/markdown');
const { encodeWordDocument } = require('../server/export/word');
const { readWord } = require('./helpers/read-word.cjs');

const issue = {
  kind: 'weekly', key: '2025-W03', label: '2025 年第 3 周', total: 1,
  byDomain: { lowaltitude: 1, aerospace: 0 }, lead: '主编导语样本 🚀', leadSource: 'model',
  hot: [{ title: '热点样本', representative: { url: 'https://example.com/hot' }, participants: 2, reports: 3, sources: ['官方一手'], digest: '热点综述' }],
  sections: [{ category: '技术研发', items: [{ title: '原标题', titleZh: '中文标题', summary: '中文摘要', reason: '投资研判', url: 'https://example.com/news', score: 92, source: '官方信源' }] }],
  deals: [{ companyName: '融资样本公司', round: 'A轮', amountText: '数亿元', date: '2025-01-15', investors: ['投资方甲'], leadInvestors: ['投资方甲'], article: { url: 'https://example.com/deal', source: '融资信源' } }],
  investors: [{ name: '投资方甲', deals: 2, leads: 1 }],
  portfolio: [{ name: '被投样本', watch: 2, items: [{ title: '被投动态', summary: '被投摘要' }] }],
  companies: [{ name: '公司声量样本', participants: 3, reports: 4, featured: 2 }],
  breakthroughs: [{ title: '技术突破样本', summary: '突破摘要', breakthroughScore: 0.8 }]
};

test('three report formats retain every displayed report section, evidence and Chinese title', () => {
  for (const kind of ['daily', 'weekly', 'monthly']) for (const format of ['markdown', 'text', 'doc']) {
    const report = { ...issue, kind, date: '2025-01-16', label: `${kind}期号` };
    const rendered = renderDaily(report, { format });
    for (const content of ['主编导语样本 🚀', '热点样本', '热点综述', '中文标题', '中文摘要', '投资研判',
      '融资样本公司', '数亿元', 'https://example.com/deal', '投资方甲', '被投动态', '公司声量样本', '技术突破样本']) assert.ok(rendered.includes(content), `${kind}/${format} lost ${content}`);
    if (format === 'doc') {
      const decoded = readWord(encodeWordDocument(rendered));
      assert.equal(decoded.content, rendered.replace(/\n/g, '\r').replace(/\r*$/, '\r'));
      assert.deepEqual(Object.keys(decoded.streams).sort(), ['1Table', 'WordDocument']);
      assert.match(exportFilename('摘星阁-周报', '2025-W03', 'doc'), /\.doc$/);
    }
  }
});

test('native .doc round-trips Unicode, untrusted control text and multiple FAT sectors', () => {
  for (const text of ['', '括号 {x} \\u1234 与 <script> 并非控制指令\n中文 🚀\n', '中文 🚀 abc\n'.repeat(14000)]) {
    const decoded = readWord(encodeWordDocument(text));
    assert.equal(decoded.content, text.replace(/\n/g, '\r').replace(/\r*$/, '\r'));
  }
  assert.equal(readWord(encodeWordDocument('甲\u0000乙\u0001\n')).content, '甲乙\r');
});

for (const [kind, key] of [['weekly', '2025-W03'], ['monthly', '2025-01']]) {
  test(`${kind} exports the chosen issue and explicit regeneration refreshes its frozen cache`, async t => {
    let db;
    t.after(() => db?.close());
    const server = await startServer(t);
    const headers = { [API_TOKEN_HEADER]: server.token, 'content-type': 'application/json' };
    db = new DatabaseSync(path.join(server.dataDir, 'star-picking-pavilion.db'));
    const source = db.prepare('SELECT id FROM sources ORDER BY id LIMIT 1').get();
    const insert = db.prepare(`INSERT INTO articles (source_id, title, url, ai_summary, published_at, fetched_at, grouped_at, domain, category, relevant, analyzed, quality_score, featured)
      VALUES (?, ?, ?, '可核验摘要', ?, ?, ?, 'lowaltitude', '技术研发', 1, 1, 92, 1)`);
    const stamp = new Date(2025, 0, 15, 12).toISOString();
    insert.run(source.id, '本期第一条', `https://example.com/${kind}-1`, stamp, stamp, stamp);
    const get = async pathname => {
      const response = await server.request({ pathname, headers });
      assert.equal(response.status, 200, response.body);
      return JSON.parse(response.body);
    };
    const first = await get(`/api/reports?kind=${kind}&key=${key}`);
    assert.equal(first.report.totals.featured, 1);
    for (const format of ['markdown', 'text', 'doc']) {
      const result = await get(`/api/export?kind=${kind}&key=${key}&format=${format}`);
      assert.equal(result.count, 1);
      assert.equal(result.filename, `摘星阁-情报${kind === 'weekly' ? '周报' : '月报'}-${key}.${format === 'markdown' ? 'md' : format === 'doc' ? 'doc' : 'txt'}`);
      const text = format === 'doc' ? readWord(Buffer.from(result.content, 'base64')).content : result.content;
      assert.match(text, /本期第一条/);
      assert.match(text, new RegExp(kind === 'weekly' ? '情报周报' : '情报月报'));
      if (format === 'doc') assert.equal(result.mimeType, 'application/msword');
    }
    insert.run(source.id, '本期新增条目', `https://example.com/${kind}-2`, stamp, stamp, stamp);
    assert.equal((await get(`/api/reports?kind=${kind}&key=${key}`)).report.totals.featured, 1);
    const regenerated = await server.request({ pathname: '/api/reports/regenerate', method: 'POST', headers, body: JSON.stringify({ kind, key }) });
    assert.equal(regenerated.status, 200, regenerated.body);
    assert.equal(JSON.parse(regenerated.body).report.key, key);
    assert.equal(JSON.parse(regenerated.body).report.totals.featured, 2);
    assert.equal((await get(`/api/export?kind=${kind}&key=${key}&format=markdown`)).count, 2);
    assert.equal((await get('/api/industry')).budget.dayCalls, 0);
  });
}

test('report exports and regeneration reject invalid periods, formats and unauthorized writes', async t => {
  const server = await startServer(t);
  const headers = { [API_TOKEN_HEADER]: server.token, 'content-type': 'application/json' };
  for (const query of ['kind=weekly&key=2025-W99', 'kind=monthly&key=2025-13', 'kind=weekly&key=../../../',
    'kind=monthly&key=2999-01', 'kind=feed&format=doc', 'kind=weekly&format=pdf']) {
    const response = await server.request({ pathname: `/api/export?${query}`, headers });
    assert.equal(response.status, 400, query);
  }
  for (const body of [null, {}, { kind: 'daily', key: '2025-01-16' }, { kind: 'weekly', key: '' }, { kind: 'weekly', key: '2025-W99' }, { kind: 'monthly', key: 5 }]) {
    const response = await server.request({ pathname: '/api/reports/regenerate', method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  const unauthorized = await server.request({ pathname: '/api/reports/regenerate', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'weekly', key: '2025-W03' }) });
  assert.equal(unauthorized.status, 403);
  const daily = await server.request({ pathname: '/api/export?kind=daily&date=2025-01-16&format=doc', headers });
  assert.equal(daily.status, 200);
  assert.match(readWord(Buffer.from(JSON.parse(daily.body).content, 'base64')).content, /情报日报 2025-01-16/);
});
