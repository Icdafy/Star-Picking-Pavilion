'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHtml } = require('../server/collectors/html');

test('真实卡片结构分离标题、摘要、日期，封面空链接和导航不会入库', () => {
  const source = { url: 'https://news.example.test/', selector_json: JSON.stringify({ list: '.article-item',
    title: 'h3', summary: '.summary', date: 'time', linkPattern: '/news/\\d+\\.html', datePattern: '\\d{4}-\\d{2}-\\d{2}' }) };
  const items = parseHtml(`<div class="article-item"><a href="/news/123.html"><img src="cover.jpg"></a>
    <h3><a href="/news/123.html">低空经济无人机物流航线正式开通</a></h3><p class="summary">完成验证后投入运营。</p>
    <p>方案讨论中的其他日期 2027-01-01</p><time datetime="2026-10-01">10月1日</time></div>
    <div class="article-item"><a href="/about.html">低空经济产业资源平台导航</a><h3>低空经济产业资源平台导航</h3></div>`, source);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '低空经济无人机物流航线正式开通');
  assert.equal(items[0].summary, '完成验证后投入运营。');
  assert.equal(items[0].publishedAt, '2026-10-01T00:00:00.000Z');
});

test('新闻日期从年/月/日地址补齐，栏目和无效协议被过滤', () => {
  const source = { url: 'https://example.test/lowaltitude/', selector_json: JSON.stringify({ list: 'a', linkPattern: '/20\\d{2}/\\d{2}-\\d{2}/' }) };
  const items = parseHtml(`<a href="/lowaltitude/2026/09-30/flight.html">无人机物流正式进入试运行阶段</a>
    <a href="javascript:alert(1)">无人机物流正式进入试运行阶段</a><a href="/lowaltitude/">低空经济与商业航天新闻栏目</a>`, source);
  assert.equal(items.length, 1);
  assert.equal(items[0].publishedAt, '2026-09-30T00:00:00.000Z');
});

test('同址封面与列表合并缺失日期，不把相邻卡片日期串入', () => {
  const source = { url: 'https://example.test/', selector_json: JSON.stringify({ list: 'a.news', row: '.item',
    title: 'h3', date: '.date' }) };
  const items = parseHtml(`<div class="item"><a class="news" href="/a.html"><h3>商业航天火箭完成发动机试验</h3></a></div>
    <div class="item"><a class="news" href="/a.html"><h3>商业航天火箭完成发动机试验</h3></a><span class="date">2026-09-30</span></div>
    <div class="item"><a class="news" href="/b.html"><h3>低空经济无人机物流航线开通</h3></a><span class="date">2026-09-29</span></div>`, source);
  assert.deepEqual(items.map(i => [i.url, i.publishedAt]), [
    ['https://example.test/a.html', '2026-09-30T00:00:00.000Z'],
    ['https://example.test/b.html', '2026-09-29T00:00:00.000Z']
  ]);
});

test('蓝箭结构中的拆分年月日与昨天时分按信源日期读取', () => {
  const source = { url: 'https://example.test/', selector_json: JSON.stringify({ list: '.item', title: 'h3',
    date: 'time', dateParts: { year: '.year', month: '.month', day: '.day' } }) };
  const items = parseHtml(`<div class="item"><a href="/a.html"><h3>商业航天运载火箭完成静态点火</h3></a>
    <span class="day">29</span><span class="month">06月</span><span class="year">2026</span></div>
    <div class="item"><a href="/b.html"><h3>低空经济无人机物流航线开通</h3></a><time>昨天16:33</time></div>`, source,
  { nowMs: Date.parse('2026-10-07T02:00:00Z') });
  assert.equal(items[0].publishedAt, '2026-06-29T00:00:00.000Z');
  assert.equal(items[1].publishedAt, '2026-10-06T08:33:00.000Z');
});

test('年末日期按信源当前年份回溯，无效日期和只有月份的路径保留未知', () => {
  const { listDateIso, dateFromUrl, looseDateIso } = require('../server/collectors/loose-date');
  assert.equal(listDateIso('12/31 18:20', '+08:00', Date.parse('2026-12-31T17:00:00Z')), '2026-12-31T10:20:00.000Z');
  assert.equal(looseDateIso('2026-02-30'), null);
  assert.equal(dateFromUrl('https://example.test/2026/10/123456.shtm'), null);
  assert.equal(dateFromUrl('https://example.test/article?id=20260930'), null);
  assert.equal(dateFromUrl('https://example.test/news/2026-02/30/a.htm'), null);
  assert.equal(dateFromUrl('https://example.test/news/2022-10/19/a.htm'), '2022-10-19T00:00:00.000Z');
});

test('钛媒体侧栏日期与慧博斜线日期读取各自日期元素，标题年月不混入', () => {
  const source = { url: 'https://example.test/', selector_json: JSON.stringify({ list: 'a._tit', row: '._right',
    title: '._tit', summary: '._des', date: '._time' }) };
  const items = parseHtml(`<div class="_right"><div class="r_top"><a class="_tit" href="/1.html">商业航天企业公布2027年发射计划</a>
    <a class="_des">计划等待后续验证。</a></div><div class="r_bottom"><a class="_time">· 12月31日</a></div></div>
    <div class="_right"><a class="_tit" href="/2.html">低空经济无人机物流试运行正式开通</a><a class="_time">· 2月30日</a></div>
    <div class="_right"><a class="_tit" href="/3.html">商业航天企业公布2027-01-08发射计划</a><p>计划在2027-02-05试验。</p></div>`, source,
  { nowMs: Date.parse('2026-12-31T17:00:00Z') });
  assert.equal(items[0].publishedAt, '2026-12-31T00:00:00.000Z');
  assert.equal(items[0].summary, '计划等待后续验证。');
  assert.equal(items[1].publishedAt, null);
  assert.equal(items[2].publishedAt, null, '缺失日期元素不能改读标题或正文计划');
  const reports = parseHtml('<li><a href="/report.html">商业航天产业链研究报告2027年度展望</a><span>2026/10/04</span></li>',
    { url: 'https://example.test/', selector_json: JSON.stringify({ list: 'li a', date: 'span' }) });
  assert.equal(reports[0].publishedAt, '2026-10-03T16:00:00.000Z');
});
