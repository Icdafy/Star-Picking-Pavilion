'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const expectedLinks = require('./fixtures/yunwo-common-links.json');
const {
  ALL_CATEGORY,
  LINKS,
  STORAGE_KEY,
  LEGACY_STORAGE_KEYS,
  getCategories,
  getDefaultFavoriteIds,
  isValidFavoriteStorage,
  parseFavoriteIds,
  filterAndSortLinks
} = require('../renderer/common-links');

test('迁入云幄源码中的全部 14 个合法网址', () => {
  assert.deepEqual(LINKS, expectedLinks);
  assert.equal(LINKS.length, 14);
  assert.equal(new Set(LINKS.map(item => item.id)).size, 14);
  for (const item of LINKS) {
    assert.equal(typeof item.name, 'string');
    assert.ok(item.name.length > 0);
    assert.match(item.url, /^https?:\/\//);
    assert.equal(typeof item.category, 'string');
    assert.equal(typeof item.description, 'string');
    assert.ok(Array.isArray(item.tags));
    assert.equal(typeof item.pinned, 'boolean');
  }
});

test('分类保持云幄源码顺序并在最前提供全部', () => {
  assert.deepEqual(getCategories(), [
    '全部', '督办计划', '项目投资', '财税办公', '综合办公', '合同印鉴', 'AI'
  ]);
  assert.equal(ALL_CATEGORY, '全部');
});

test('默认星标完整保留云幄 pinned 配置', () => {
  assert.deepEqual([...getDefaultFavoriteIds()], [
    'key-work-progress',
    'work-plan',
    'industrial-investment-project-library',
    'industrial-investment-project-excel',
    'invoice-verification',
    'qichacha',
    'chengjian-oa',
    'seal-use-records',
    'contract-filing-records',
    'kimi-ai',
    'doubao-ai',
    'yuanbao-ai'
  ]);
});

test('缺失、损坏和非数组存储回退默认星标', () => {
  const expected = [...getDefaultFavoriteIds()];
  assert.deepEqual([...parseFavoriteIds(null)], expected);
  assert.deepEqual([...parseFavoriteIds('{bad json')], expected);
  assert.deepEqual([...parseFavoriteIds(JSON.stringify({ id: 'work-plan' }))], expected);
});

test('空数组有效且未知或重复 ID 被清洗', () => {
  assert.deepEqual([...parseFavoriteIds('[]')], []);
  assert.deepEqual(
    [...parseFavoriteIds(JSON.stringify(['travel-memo', 'missing', 'travel-memo']))],
    ['travel-memo']
  );
  assert.equal(STORAGE_KEY, 'star-picking-pavilion.common-links.favorites');
  assert.deepEqual(LEGACY_STORAGE_KEYS, ['zxg-common-links-favorites']);
});

test('仅 JSON 数组可作为旧星标存储迁移源', () => {
  assert.equal(isValidFavoriteStorage('[]'), true);
  assert.equal(isValidFavoriteStorage('["work-plan"]'), true);
  assert.equal(isValidFavoriteStorage('{"id":"work-plan"}'), false);
  assert.equal(isValidFavoriteStorage('{bad json'), false);
  assert.equal(isValidFavoriteStorage(null), false);
});

test('按分类筛选后星标优先且每组保持原始顺序', () => {
  const result = filterAndSortLinks({
    category: '项目投资',
    favoriteIds: new Set(['fund-project-excel'])
  });
  assert.deepEqual(result.map(item => item.id), [
    'fund-project-excel',
    'industrial-investment-project-library',
    'industrial-investment-project-excel'
  ]);
  assert.equal(result[0].isFavorite, true);
  assert.equal(result[1].isFavorite, false);
});

test('全部分类返回全部条目', () => {
  assert.equal(filterAndSortLinks({ category: ALL_CATEGORY, favoriteIds: new Set() }).length, 14);
});
