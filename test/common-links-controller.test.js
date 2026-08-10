'use strict';

// 阶段 3 批 4：common-links-controller 自 app.js 抽离后的 Node 单测。
// 覆盖：UMD/lint 护栏、依赖护栏、渲染计数、分类点击落盘并携带 focus key、
// 常用收藏的添加/移除与持久化。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createCommonLinksController } = require('../renderer/common-links-controller');
const CommonLinks = require('../renderer/common-links');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'common-links-controller.js'), 'utf8');

test('common-links-controller 工厂不直读 window，UMD 不泄漏全局且导出冻结', () => {
  assert.doesNotMatch(source, /\bwindow\./, '模块内不得出现裸 window. 直读');
  const modulePath = require.resolve('../renderer/common-links-controller');
  const result = spawnSync(process.execPath, ['-e', `
    delete globalThis.CommonLinksController;
    const api = require(${JSON.stringify(modulePath)});
    process.stdout.write(JSON.stringify({
      exported: typeof api.createCommonLinksController === 'function',
      frozen: Object.isFrozen(api),
      globalCreated: Object.prototype.hasOwnProperty.call(globalThis, 'CommonLinksController')
    }));
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { exported: true, frozen: true, globalCreated: false });
});

function makeWorld() {
  const listeners = {};
  const makeRegion = name => ({
    innerHTML: '',
    textContent: '',
    addEventListener(type, fn) { listeners[`${name}:${type}`] = fn; },
    focus() {}
  });
  const categories = makeRegion('categories');
  const grid = makeRegion('grid');
  const count = makeRegion('count');
  const restored = [];
  const fakeDocument = {
    querySelectorAll: () => []
  };
  const domUtils = {
    restoreFocusByKey: (doc, focusKey, fallbackTarget) => restored.push({ focusKey, fallbackTarget })
  };
  const state = {
    linksCategory: CommonLinks.ALL_CATEGORY,
    commonLinksFavorites: new Set(CommonLinks.getDefaultFavoriteIds())
  };
  const patches = [];
  const preferenceActions = { remember: (key, value) => patches.push({ [key]: value }) };
  const ctrl = createCommonLinksController({
    $: selector => ({ '#commonLinksCategories': categories, '#commonLinksGrid': grid, '#commonLinksCount': count }[selector]),
    document: fakeDocument,
    state,
    esc: value => String(value ?? ''),
    safeUrl: value => String(value ?? ''),
    commonLinks: CommonLinks,
    domUtils,   // 焦点恢复用桩记录，验证 focus key 与兜底区域的传递
    preferenceActions,
    elements: { categories, grid, count }
  });
  return { ctrl, listeners, categories, grid, count, restored, state, patches };
}

test('缺少必需依赖时工厂抛 TypeError', () => {
  assert.throws(() => createCommonLinksController({}), TypeError);
  assert.throws(() => createCommonLinksController({
    $: () => {}, state: {}, esc: v => v, safeUrl: v => v,
    commonLinks: CommonLinks, domUtils: {}, preferenceActions: { remember() {} }
  }), TypeError);
});

test('渲染输出分类按钮、卡片与条数，外链走 safeUrl', () => {
  const { ctrl, categories, grid, count } = makeWorld();
  ctrl.renderCommonLinks();
  assert.match(categories.innerHTML, /data-focus-key="category:全部"/);
  assert.match(grid.innerHTML, /class="common-links-card glass"/);
  assert.match(grid.innerHTML, /class="common-links-open" href="[^"]*" target="_blank" rel="noopener"/);
  const expected = CommonLinks.filterAndSortLinks({
    category: CommonLinks.ALL_CATEGORY,
    favoriteIds: new Set(CommonLinks.getDefaultFavoriteIds())
  }).length;
  assert.equal(count.textContent, String(expected));
});

test('分类点击落盘 linksCategory 并把 focus key 交回渲染', () => {
  const { listeners, categories, restored, patches, state } = makeWorld();
  listeners['categories:click']({
    target: { closest: () => ({ dataset: { linksCategory: '政策', focusKey: 'category:政策' } }) }
  });
  assert.equal(state.linksCategory, '政策');
  assert.deepEqual(patches[0], { linksCategory: '政策' });
  const last = restored[restored.length - 1];
  assert.equal(last.focusKey, 'category:政策');
  assert.equal(last.fallbackTarget, categories, '焦点恢复的兜底区域是分类条本身');
});

test('常用按钮在添加与移除之间切换并持久化整个收藏集合', () => {
  const { listeners, grid, restored, patches, state } = makeWorld();
  const clickFavorite = id => listeners['grid:click']({
    target: { closest: () => ({ dataset: { linkFavorite: id, focusKey: `favorite:${id}` } }) }
  });
  const before = state.commonLinksFavorites.size;
  clickFavorite('new-link');
  assert.equal(state.commonLinksFavorites.has('new-link'), true);
  assert.deepEqual(patches[0], { commonLinksFavorites: [...state.commonLinksFavorites] });
  let last = restored[restored.length - 1];
  assert.equal(last.focusKey, 'favorite:new-link');
  assert.equal(last.fallbackTarget, grid, '找不到原控件时焦点退回网格区域');

  clickFavorite('new-link');
  assert.equal(state.commonLinksFavorites.has('new-link'), false);
  assert.equal(state.commonLinksFavorites.size, before);
});

test('点击非分类/常用按钮时不重渲染也不落盘', () => {
  const { listeners, patches, restored } = makeWorld();
  listeners['categories:click']({ target: { closest: () => null } });
  listeners['grid:click']({ target: { closest: () => null } });
  assert.equal(patches.length, 0);
  assert.equal(restored.length, 0);
});
