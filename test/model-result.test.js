'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeModelResult } = require('../server/ai/model-result');

const categories = ['企业动态', '技术研发'];

test('model results are clamped and bounded before entering SQLite', () => {
  const normalized = normalizeModelResult({
    scores: {
      importance: 120,
      novelty: -5,
      credibility: '88',
      impact: 'invalid',
      timeliness: 55
    },
    category: '不存在',
    summary: '摘'.repeat(200),
    reason: '星'.repeat(200),
    tags: [' 火箭 ', '火箭', 'x'.repeat(80), {}, '卫星', '商业航天']
  }, categories);

  assert.deepEqual(normalized.scores, {
    importance: 100,
    novelty: 0,
    credibility: 88,
    impact: 0,
    timeliness: 55
  });
  assert.equal(normalized.category, '企业动态');
  assert.equal([...normalized.summary].length, 80);
  assert.equal([...normalized.reason].length, 60);
  assert.deepEqual(normalized.tags, ['火箭', 'x'.repeat(24), '卫星', '商业航天']);
});

test('model results require a score object', () => {
  assert.throws(() => normalizeModelResult({ scores: null }, categories), /评分/);
});
