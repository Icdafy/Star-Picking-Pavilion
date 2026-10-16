'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { enrichArticle } = require('../server/collectors/article-content');

test('日期修复与 AI 同时补抓同篇正文共享在途请求，完成后不常驻缓存', async () => {
  const network = {};
  let requests = 0;
  const fetchPageImpl = async url => {
    requests++;
    await new Promise(resolve => setImmediate(resolve));
    return { url, html: '<article><h1>商业航天火箭试飞</h1><p>火箭完成试飞。</p></article>' };
  };
  const row = { intl: 0, fetched_at: '2026-10-15T00:00:00Z', url: 'https://news.example/flight?utm_source=a' };
  const [a, b] = await Promise.all([enrichArticle(row, { network, fetchPageImpl }), enrichArticle({ ...row, url: 'https://news.example/flight?utm_source=b' }, { network, fetchPageImpl })]);
  assert.equal(requests, 1);
  assert.equal(a.status, 'ok');
  assert.deepEqual(a, b);
  await enrichArticle(row, { network, fetchPageImpl });
  assert.equal(requests, 2);
});

test('在途正文失败后能立即重试，不跨历史时间推定或网络上下文共享', async () => {
  const network = {};
  let requests = 0;
  const fetchPageImpl = async url => {
    requests++;
    await new Promise(resolve => setImmediate(resolve));
    if (requests === 1) throw new Error('temporary unavailable');
    return { url, html: '<article>商业航天火箭完成试飞。</article>' };
  };
  const row = { intl: 0, url: 'https://retry.example/flight' };
  const options = { network, fetchPageImpl };
  const failed = await Promise.all([enrichArticle(row, options), enrichArticle(row, options)]);
  assert.equal(requests, 1);
  assert.ok(failed.every(content => /temporary/.test(content.status)));
  assert.equal((await enrichArticle(row, options)).status, 'ok');
  await Promise.all([enrichArticle(row, options), enrichArticle({ ...row, fetched_at: '2025-01-01' }, options), enrichArticle(row, { ...options, network: {} })]);
  assert.equal(requests, 5);
});
