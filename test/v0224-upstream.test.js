'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const normalize = require('../server/ai/normalize');
const { extractContent, enrichArticle } = require('../server/collectors/article-content');
const { parseLooseDate } = require('../server/collectors/loose-date');
const { mapEastmoneyResponse } = require('../server/collectors/api');
const { acceptsImageInput } = require('../server/ai/model-policy');
const { acceptsImages } = require('../server/ai/model-catalog');
const metrics = require('../scripts/eval-relations');

test('HTML 属性中的大小于号、引号与长标签不进入标题和摘要', () => {
  for (const markup of [
    '<a title="型号 > 参数" href="/a">商业航天完成首飞</a>',
    "<a title='型号 > 参数' href='/a'>商业航天完成首飞</a>",
    '<a title=don\'t data-note="型号 > 参数">商业航天完成首飞</a>',
    `<a title="${'长属性'.repeat(300)} > 参数">商业航天完成首飞</a>`
  ]) {
    assert.equal(normalize.cleanTitle(markup), '商业航天完成首飞');
    assert.equal(normalize.cleanSummary(`${markup}<p>第二段</p>`), '商业航天完成首飞 第二段');
  }
  assert.equal(normalize.cleanTitle('研发 &lt;型号&gt; 完成试验'), '研发 <型号> 完成试验');
});

test('已清洗纯文本在入库及启发式摘要中保留尖括号与实体字面值', () => {
  const item = normalize.structureItem({ title: '<型号>', summary: '支持 <model> 与 &amp; 字面值',
    textFormat: 'plain', url: 'https://example.com/plain' });
  assert.ok(item);
  assert.equal(item.title, '<型号>');
  assert.equal(item.summaryRaw, '支持 <model> 与 &amp; 字面值');
  assert.equal(normalize.cleanSummary(item.summaryRaw, { plainText: true }), item.summaryRaw);
});

test('Atom 默认及 text 构造保留原文，HTML/XHTML 清洗，纯文本不生成伪图片', async t => {
  const feed = `<feed xmlns="http://www.w3.org/2005/Atom"><title>核验</title>
    <entry><title type="text">&lt;型号&gt;</title><link href="https://example.com/text"/>
      <summary>支持 &lt;model&gt; 与 &amp;amp; 字面值</summary>
      <content type="text">&lt;img src="https://example.com/fake.png"&gt;纯文本</content></entry>
    <entry><title>商业航天 &lt;dialog&gt;</title><link href="https://example.com/default"/>
      <content>正文保留 &lt;型号&gt;</content></entry>
    <entry><title type="html">&lt;a title="型号 &gt; 参数"&gt;商业航天首飞&lt;/a&gt;</title>
      <link href="https://example.com/html"/><summary type="html">&lt;b&gt;HTML 摘要&lt;/b&gt;</summary>
      <content type="html">&lt;p&gt;HTML 正文&lt;/p&gt;&lt;img src="https://example.com/real.png"&gt;</content></entry>
    <entry><title type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">商业航天<b>入轨</b></div></title>
      <link href="https://example.com/xhtml"/><summary type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">保留<b>语序</b></div></summary></entry>
  </feed>`;
  const server = http.createServer((req, res) => res.end(feed));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const items = await require('../server/collectors/rss').fetch({ url: `http://127.0.0.1:${server.address().port}/` }, { collect: {} });
  assert.equal(items[0].title, '<型号>');
  assert.equal(items[0].summary, '支持 <model> 与 &amp; 字面值');
  assert.equal(items[0].image, null);
  assert.deepEqual(items[0].images, []);
  assert.equal(items[1].summary, '正文保留 <型号>');
  assert.equal(items[2].title, '商业航天首飞');
  assert.equal(items[2].summary, 'HTML 摘要');
  assert.equal(items[2].image, 'https://example.com/real.png');
  assert.equal(items[3].title, '商业航天 入轨');
  assert.equal(items[3].summary, '保留 语序');
  assert.deepEqual(items.map(item => normalize.structureItem(item).title), items.map(item => item.title));
});

test('正文排除隐藏内容，遵循大小写、important 与后写声明优先，恢复 noscript 配图', () => {
  const content = extractContent(`<article><h1>商业航天消息</h1>
    <p style="DISPLAY:NONE !important;display:block">隐藏广告</p>
    <p style="visibility:HiDdEn">隐藏谣言</p>
    <div hidden><img src="https://example.com/hidden.png">隐藏段落</div>
    <p style="display:none;DISPLAY:block">可见进展</p>
    <p style="display:block!important;display:none">重要可见</p>
    <p style='background:url("data:text/plain;display:none;")'>样式字符串可见</p>
    <p style="display:none;display:invalid">无效声明不能显示</p>
    <img style="display:none" src="https://example.com/placeholder.png">
    <noscript><img src="https://example.com/real.png" alt="火箭试验"></noscript>
    <noscript>备用导航广告</noscript></article>`, 'https://example.com/news');
  assert.doesNotMatch(content.text, /隐藏|广告|谣言|无效声明/);
  assert.match(content.text, /可见进展/);
  assert.match(content.text, /重要可见/);
  assert.match(content.text, /样式字符串可见/);
  assert.deepEqual(content.images.map(image => image.url), ['https://example.com/real.png']);
});

test('Atom CDATA、空摘要回退、XHTML 引号与 XML Base 按原文解析，坏日期不阻断后续', async t => {
  const feed = `<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://example.com/news/">
    <entry><title type="text"><![CDATA[AT&T <model>]]></title><link href="a"/>
      <summary type="text"><![CDATA[R&D &literal;]]></summary></entry>
    <entry xml:base="archive/"><title>商业航天消息</title><link href="b"/>
      <summary></summary><content type="text">火箭完成首飞，数据已公布。</content><published>invalid-date</published></entry>
    <entry><title type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml" title="A > B">蓝箭航天</div></title>
      <link xml:base="https://example.com/wrong/" href="unused"/><link rel="alternate" xml:base="https://example.com/official/" href="c"/><published>2026-10-07T02:00:00Z</published></entry>
    <entry><title>无地址原文</title><id>local-entry-id</id></entry></feed>`;
  let xml = feed;
  const server = http.createServer((req, res) => res.end(xml));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const source = { url: `http://127.0.0.1:${server.address().port}/` };
  const items = await require('../server/collectors/rss').fetch(source, { collect: {} });
  assert.deepEqual(items.map(item => item.title), ['AT&T <model>', '商业航天消息', '蓝箭航天', '无地址原文']);
  assert.equal(items[0].summary, 'R&D &literal;');
  assert.equal(items[1].summary, '火箭完成首飞，数据已公布。');
  assert.deepEqual(items.map(item => item.url), ['https://example.com/news/a', 'https://example.com/news/archive/b', 'https://example.com/official/c', null]);
  assert.deepEqual(items.map(item => item.publishedAt), [null, null, '2026-10-07T02:00:00.000Z', null]);
  xml = '<rss version="2.0"><channel><title>RSS</title><item><title><![CDATA[<b>航天消息</b>]]></title><link>https://example.com/rss</link><description><![CDATA[普通摘要 <feed>不是 Atom 根</feed>]]></description></item></channel></rss>';
  const [rssItem] = await require('../server/collectors/rss').fetch(source, { collect: {} });
  assert.equal(rssItem.title, '航天消息');
});

test('英文日期在夏令时缺口与不同系统时区下读成同一信源时间', () => {
  const root = path.join(__dirname, '..');
  const code = "const {looseDateIso}=require('./server/collectors/loose-date'); process.stdout.write(looseDateIso('March 8, 2026 02:30 AM'));";
  for (const TZ of ['UTC', 'Asia/Shanghai', 'America/New_York', 'Europe/Berlin']) {
    const result = spawnSync(process.execPath, ['-e', code], { cwd: root, env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '2026-03-07T18:30:00.000Z', TZ);
  }
  assert.equal(parseLooseDate('September 26th, 2026 10:00 PM PDT').toISOString(), '2026-09-27T05:00:00.000Z');
  assert.equal(parseLooseDate('September 26, 2026 10:00 CST').toISOString(), '2026-09-26T02:00:00.000Z');
  assert.equal(parseLooseDate('February 30, 2026'), null);
});

test('坏 JSON 日期不终止整批新闻，明确时区与 HTML 属性照常读取', () => {
  const rows = [
    { title: '商业航天坏日期', url: 'https://example.com/bad', date: { toString: null } },
    { title: '商业航天无效日期', url: 'https://example.com/invalid', date: '2026-02-30 10:00:00' },
    { title: '<a title="型号 > 参数">商业航天进展</a>', url: 'https://example.com/good', date: '2026-10-07 10:30:00' },
    { title: '商业航天海外报道', url: 'https://example.com/zone', date: '2026-10-07T10:30:00Z' }
  ];
  const items = mapEastmoneyResponse(JSON.stringify({ result: { cmsArticleWebOld: rows } }));
  assert.equal(items.length, 4);
  assert.deepEqual(items.map(item => item.publishedAt), [null, null, '2026-10-07T02:30:00.000Z', '2026-10-07T10:30:00.000Z']);
  assert.equal(items[2].title, '商业航天进展');
});

test('只有明确声明图片输入的模型做图片理解，未知模型继续正常文本分析', () => {
  for (const input of [undefined, null, [], ['text']]) {
    assert.equal(acceptsImageInput({ ai: { modelInput: input } }), false);
    assert.equal(acceptsImages({ input }), false);
  }
  assert.equal(acceptsImageInput({ ai: { modelInput: ['text', 'image'] } }), true);
  assert.equal(acceptsImages({ input: ['text', 'image'] }), true);
});

test('视频播放页不会被抓成正文，也不会成为待分析配图', async () => {
  let calls = 0;
  const result = await enrichArticle({ url: 'https://www.youtube.com/embed/example', intl: false }, {
    fetchPageImpl: async () => { calls++; return { url: 'https://www.youtube.com/embed/example', html: '<article>推荐视频和评论</article>' }; }
  });
  assert.equal(calls, 0);
  assert.equal(result.status, 'video-page');
  const content = extractContent('<article>原文<img src="https://youtu.be/example"><img src="https://example.com/real.png"></article>', 'https://example.com/article');
  assert.deepEqual(content.images.map(image => image.url), ['https://example.com/real.png']);
});

test('关系与合并评测同时报告覆盖率和计入失败的完整准确率', async () => {
  const rows = [{ caseId: 'ok', gold: 'same', a: { title: 'a' }, b: { title: 'ok' } },
    { caseId: 'fail', gold: 'different', a: { title: 'a' }, b: { title: 'fail' } }];
  const { predictions, failures } = await metrics.evaluate(rows, { judgePair: async doc => {
    if (doc.title === 'fail') throw new Error('解析失败');
    return { relation: 'same', confidence: 0.9 };
  } });
  assert.equal(failures.length, 1);
  for (const result of [metrics.relationMetrics(predictions, rows.length), metrics.mergeMetrics(predictions, 0.75, rows.length)]) {
    assert.equal(result.accuracy, 1);
    assert.equal(result.coverage, 0.5);
    assert.equal(result.completeAccuracy, 0.5);
    assert.equal(result.errors, 1);
  }
  const allFailed = metrics.mergeMetrics([], 0.75, 3);
  assert.equal(allFailed.completeAccuracy, 0);
  assert.equal(allFailed.coverage, 0);
  assert.equal(allFailed.errors, 3);
});
