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
  assert.throws(() => normalizeModelResult({ scores: [1, 2, 3] }, categories), /评分/);
  assert.throws(() => normalizeModelResult({}, categories), /评分/);
});

test('dirty-shaped entity and event elements are dropped before downstream normalization', () => {
  // L7：进 entities/events 归一之前做最小形状校验，脏形状直接丢弃
  const normalized = normalizeModelResult({
    scores: { importance: 50, novelty: 50, credibility: 50, impact: 50, timeliness: 50 },
    category: '企业动态',
    entities: [
      { n: '蓝箭航天', t: 'org' },
      { n: {} },            // 对象名丢弃
      { n: null },          // null 名丢弃
      { t: 'org' },         // 缺名丢弃
      null,                 // null 元素丢弃
      42,                   // 裸数字不是可用实体形状：丢弃
      '星际荣耀',           // 字符串形态可用
      { name: '沃飞长空' }   // name 别名也认
    ],
    events: [
      { a: '蓝箭航天', v: '发射入轨' },
      { a: {}, v: [1] },    // 主体不可得：丢弃
      { a: null },          // 丢弃
      42,                   // 裸数字不是可用事件形状：丢弃
      '蓝箭航天完成首飞',    // 字符串形态可用
      { v: '完成首飞' },    // 缺主体丢弃
      {}
    ]
  }, categories);

  // 现状锁定：裸数字在形状校验层即被丢弃（只认字符串与含名字段的对象），
  // 数字名仅支持 { n: 42 } 这种带字段的形式
  assert.deepEqual(
    normalized.entities.map(entity => entity.n ?? entity.name ?? entity),
    ['蓝箭航天', '星际荣耀', '沃飞长空']
  );
  assert.deepEqual(
    normalized.events.map(event => event.a ?? event.actor ?? event),
    ['蓝箭航天', '蓝箭航天完成首飞']
  );
  const numericName = normalizeModelResult({
    scores: { importance: 1 }, entities: [{ n: 42 }], events: [{ a: 7, v: '完成首飞' }]
  }, categories);
  assert.equal(numericName.entities.length, 1, '有限数字名字段保留');
  assert.equal(numericName.events.length, 1, '有限数字主体字段保留');
  // 缺失或非法的数组一律归为空数组，下游不用重复做类型防御
  const empty = normalizeModelResult({
    scores: { importance: 1 }, entities: 'not-an-array', events: { weird: true }
  }, categories);
  assert.deepEqual(empty.entities, []);
  assert.deepEqual(empty.events, []);
});

test('entity and event arrays are bounded before handoff', () => {
  const manyEntities = Array.from({ length: 100 }, (unused, index) => ({ n: `实体${index}`, t: 'org' }));
  const manyEvents = Array.from({ length: 100 }, (unused, index) => ({ a: `主体${index}`, v: '完成首飞' }));
  const normalized = normalizeModelResult({
    scores: { importance: 1 }, entities: manyEntities, events: manyEvents
  }, categories);
  assert.equal(normalized.entities.length, 16, '实体最多带出 16 个');
  assert.equal(normalized.events.length, 8, '事件最多带出 8 个（后续还会被 MAX_EVENTS 再截）');
});
