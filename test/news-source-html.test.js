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
