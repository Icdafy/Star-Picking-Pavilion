'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseFeedQuery,
  sanitizeFeedback,
  sanitizeDate,
  sanitizeSourceInput
} = require('../server/input-validation');

test('source validation accepts supported adapters and rejects unsafe or mismatched URLs', () => {
  assert.equal(sanitizeSourceInput({
    name: '示例 RSS', type: 'rss', url: 'https://example.com/feed.xml', tier: 'T2', domain: 'both'
  }).url, 'https://example.com/feed.xml');
  assert.equal(sanitizeSourceInput({
    name: 'RSSHub', type: 'rss', url: 'rsshub://spacenews/home', tier: 'T1.5', domain: 'aerospace'
  }).url, 'rsshub://spacenews/home');
  assert.equal(sanitizeSourceInput({
    name: '东财', type: 'api', url: 'eastmoney://商业航天', tier: 'T2', domain: 'aerospace'
  }).url, 'eastmoney://商业航天');

  assert.throws(() => sanitizeSourceInput({
    name: '脚本', type: 'rss', url: 'javascript:alert(1)', tier: 'T2', domain: 'both'
  }), /地址|URL/);
  assert.throws(() => sanitizeSourceInput({
    name: '错配', type: 'api', url: 'https://example.com/api', tier: 'T2', domain: 'both'
  }), /eastmoney/);
  assert.throws(() => sanitizeSourceInput({
    name: '未知', type: 'shell', url: 'https://example.com', tier: 'T2', domain: 'both'
  }), /类型/);
});

test('source validation bounds metadata and validates enum fields on patches', () => {
  const current = {
    name: '原信源', type: 'rss', url: 'https://example.com/feed', tier: 'T2', domain: 'both', note: null
  };
  assert.equal(sanitizeSourceInput({ enabled: false }, current).enabled, false);
  assert.throws(() => sanitizeSourceInput({ tier: 'admin' }, current), /等级/);
  assert.throws(() => sanitizeSourceInput({ domain: 'internal' }, current), /领域/);
  assert.throws(() => sanitizeSourceInput({ name: 'x'.repeat(121) }, current), /名称/);
  assert.throws(() => sanitizeSourceInput({ note: 'x'.repeat(1001) }, current), /备注/);
  assert.throws(() => sanitizeSourceInput({ selector: { unexpected: 'value' } }, current), /选择器/);
  assert.throws(() => sanitizeSourceInput({ selector: { list: 'a', datePattern: '('.repeat(201) } }, current), /日期正则/);
  assert.doesNotThrow(() => sanitizeSourceInput({
    type: 'html', selector: { list: 'ul li a', datePattern: '\\d{4}-\\d{2}-\\d{2}' }
  }, current));
});

test('feed query validation rejects invalid views, filters and pagination', () => {
  const categories = ['政策法规', '企业动态'];
  assert.deepEqual(parseFeedQuery(new URLSearchParams('view=hot&page=2&domain=aerospace'), categories), {
    view: 'hot', domain: 'aerospace', category: '', search: '', page: 2
  });
  assert.throws(() => parseFeedQuery(new URLSearchParams('view=everything'), categories), /视图/);
  assert.throws(() => parseFeedQuery(new URLSearchParams('page=NaN'), categories), /页码/);
  assert.throws(() => parseFeedQuery(new URLSearchParams('page=10001'), categories), /页码/);
  assert.throws(() => parseFeedQuery(new URLSearchParams('domain=private'), categories), /领域/);
  assert.throws(() => parseFeedQuery(new URLSearchParams('category=不存在'), categories), /分类/);
  assert.throws(() => parseFeedQuery(new URLSearchParams(`q=${'x'.repeat(201)}`), categories), /关键词/);
});

test('daily date validation accepts only real ISO calendar dates', () => {
  assert.equal(sanitizeDate('2026-07-21'), '2026-07-21');
  assert.equal(sanitizeDate(null), null);
  assert.throws(() => sanitizeDate('2026-02-30'), /日期/);
  assert.throws(() => sanitizeDate('tomorrow'), /日期/);
});

test('feedback validation requires a supported kind and bounded non-empty content', () => {
  assert.deepEqual(sanitizeFeedback({ kind: 'feedback', content: '  建议增加筛选  ' }), {
    kind: 'feedback', content: '建议增加筛选'
  });
  assert.throws(() => sanitizeFeedback({ kind: 'admin', content: 'x' }), /反馈类型/);
  assert.throws(() => sanitizeFeedback({ kind: 'feedback', content: '   ' }), /反馈内容/);
  assert.throws(() => sanitizeFeedback({ kind: 'feedback', content: 'x'.repeat(2001) }), /反馈内容/);
});
