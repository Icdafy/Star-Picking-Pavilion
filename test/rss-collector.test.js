'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Parser = require('rss-parser');
const { sanitizeXml, normalizeUrl } = require('../server/collectors/rss');

test('RSS 清洗只转义裸 ampersand 并保留合法 XML 实体', async () => {
  const malformed = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0"><channel><title>示例 &amp; 订阅</title>',
    '<item><title>R&D 与 &#x4F4E;&#31354;</title>',
    '<link>https://example.com/article?a=1&b=2</link></item>',
    '</channel></rss>'
  ].join('');

  const cleaned = sanitizeXml(malformed);
  assert.match(cleaned, /R&amp;D/);
  assert.match(cleaned, /a=1&amp;b=2/);
  assert.match(cleaned, /示例 &amp; 订阅/);
  assert.match(cleaned, /&#x4F4E;&#31354;/);

  const feed = await new Parser().parseString(cleaned);
  assert.equal(feed.title, '示例 & 订阅');
  assert.equal(feed.items[0].title, 'R&D 与 低空');
});

test('normalizeUrl 只放行无内嵌凭据的 HTTP(S)，bing 包装解开后同样校验', () => {
  // 非浏览协议与内嵌凭据一律出不了采集层
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('data:text/html,<script>1</script>'), null);
  assert.equal(normalizeUrl('file:///C:/secret.txt'), null);
  assert.equal(normalizeUrl('https://user:pass@example.com/x'), null);
  assert.equal(normalizeUrl('not a url'), null);
  // 正常绝对地址原样保留
  assert.equal(normalizeUrl('https://example.com/article?id=1'), 'https://example.com/article?id=1');
  // bing 跳转包装解开后同样过协议校验
  assert.equal(
    normalizeUrl('https://www.bing.com/news/apiclick.aspx?url=' + encodeURIComponent('https://example.com/target?x=1')),
    'https://example.com/target?x=1'
  );
  assert.equal(
    normalizeUrl('https://www.bing.com/news/apiclick.aspx?url=' + encodeURIComponent('javascript:alert(1)')),
    null
  );
});

test('旧 RSS 缺少 pubDate 时使用链接完整日期，明确 pubDate 优先', async () => {
  const http = require('node:http');
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/rss+xml');
    res.end(`<rss version="2.0"><channel><title>news</title>
      <item><title>历史火箭发射消息日期缺失</title><link>https://www.news.cn/tech/2022-10/19/a.htm</link></item>
      <item><title>官方发布日期优先于文章路径</title><link>https://example.test/20261001/a.htm</link><pubDate>Fri, 02 Oct 2026 08:00:00 GMT</pubDate></item>
      <item><title>只有月份目录的新闻不能伪造日期</title><link>https://example.test/2026/10/123456.shtm</link></item>
    </channel></rss>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const items = await require('../server/collectors/rss').fetch({ url: `http://127.0.0.1:${server.address().port}/` },
      { collect: { userAgent: 'source-date-test' } });
    assert.deepEqual(items.map(i => i.publishedAt), ['2022-10-19T00:00:00.000Z', '2026-10-02T08:00:00.000Z', null]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
