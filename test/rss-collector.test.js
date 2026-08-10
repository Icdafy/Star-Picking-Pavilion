'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Parser = require('rss-parser');
const { sanitizeXml } = require('../server/collectors/rss');

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
