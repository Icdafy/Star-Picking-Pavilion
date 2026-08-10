'use strict';

// 阶段 3 批 2：hot-rail-controller 自 app.js 抽离后的 Node 单测。
// 覆盖：依赖护栏、首屏骨架→整段构建、轮询轮次逐行更新、空态「暂无热点」
// 与其后静默重建、竞态守卫过期跳过、错误路径。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHotRailController } = require('../renderer/hot-rail-controller');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'hot-rail-controller.js'), 'utf8');

test('hot-rail-controller 工厂不直读 window，UMD 不泄漏全局且导出冻结', () => {
  assert.doesNotMatch(source, /\bwindow\./, '模块内不得出现裸 window. 直读');
  const modulePath = require.resolve('../renderer/hot-rail-controller');
  const result = spawnSync(process.execPath, ['-e', `
    delete globalThis.HotRailController;
    const api = require(${JSON.stringify(modulePath)});
    process.stdout.write(JSON.stringify({
      exported: typeof api.createHotRailController === 'function',
      frozen: Object.isFrozen(api),
      globalCreated: Object.prototype.hasOwnProperty.call(globalThis, 'HotRailController')
    }));
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { exported: true, frozen: true, globalCreated: false });
});

test('缺少必需依赖时工厂抛 TypeError', () => {
  assert.throws(() => createHotRailController({}), TypeError);
});

// 极小的假行节点：只实现 syncHotRailRow 用到的表面
function makeRow() {
  const attrs = {};
  const spans = {
    '.hi-rank': { textContent: '' },
    '.hi-title': { textContent: '' }
  };
  const meta = { children: [{ textContent: '' }, { textContent: '' }, { textContent: '' }] };
  return {
    attrs, spans, meta,
    setAttribute(k, v) { attrs[k] = v; },
    querySelector(sel) { return sel === '.hi-meta' ? meta : spans[sel]; }
  };
}

function makeGuard() {
  let current = 0;
  return {
    begin: () => { const id = ++current; return { isCurrent: () => id === current }; },
    invalidate: () => { current++; }
  };
}

function createController({ items = [], domain = '', guard = makeGuard() } = {}) {
  const box = {
    innerHTML: '', dataset: {},
    inserted: [],
    insertAdjacentHTML(pos, html) { this.inserted.push(html); },
    querySelectorAll: () => box.rows || [],
    rows: []
  };
  const requests = [];
  const ctrl = createHotRailController({
    api: async url => {
      requests.push(url);
      if (items === 'fail') throw new Error('hot down');
      return { items };
    },
    state: { domain },
    esc: s => String(s),
    safeUrl: s => `safe:${s}`,
    safeHttpUrl: s => `http:${s}`,
    timeAgo: () => '1 分钟前',
    hotRailRequestGuard: guard,
    elements: { list: box }
  });
  return { ctrl, box, requests, guard };
}

test('syncHotRailRow 只改文本与链接属性，不重渲染', () => {
  const { ctrl } = createController();
  const row = makeRow();
  ctrl.syncHotRailRow(row, { url: 'u', title: '新标题', heat: 87.4, clusterSize: 3, source: 'src' }, 2);
  assert.equal(row.attrs.href, 'http:u');
  assert.equal(row.attrs.title, '新标题');
  assert.equal(row.spans['.hi-rank'].textContent, '3');
  assert.equal(row.spans['.hi-title'].textContent, '新标题');
  assert.equal(row.meta.children[0].textContent, '87°');
  assert.equal(row.meta.children[1].textContent, '3 篇关联报道');
});

test('首屏加载先骨架后整段构建，并记录 painted', async () => {
  const { ctrl, box } = createController({
    items: [{ url: 'a', title: '甲', heat: 10, clusterSize: 1, source: 's1' }]
  });
  await ctrl.loadHotRail();
  assert.equal(box.dataset.painted, '1');
  assert.match(box.innerHTML, /class="hot-item"/);
  assert.match(box.innerHTML, /hi-title">甲/);
});

test('空数据展示「暂无热点」', async () => {
  const { ctrl, box } = createController({ items: [] });
  await ctrl.loadHotRail();
  assert.match(box.innerHTML, /暂无热点/);
});

test('第二轮有行节点时逐行更新而非重渲染', async () => {
  const row = makeRow();
  const { ctrl, box } = createController({
    items: [{ url: 'b', title: '乙', heat: 5, clusterSize: 1, source: 's2' }]
  });
  box.dataset.painted = '1';
  box.rows = [row];
  await ctrl.loadHotRail();
  assert.equal(row.spans['.hi-title'].textContent, '乙');
  assert.equal(box.innerHTML, '');   // 未触发整段重渲染
});

test('上一轮是空态（无行节点）时静默重建且无入场动画', async () => {
  const { ctrl, box } = createController({
    items: [{ url: 'c', title: '丙', heat: 1, clusterSize: 1, source: 's3' }]
  });
  box.dataset.painted = '1';
  box.rows = [];
  await ctrl.loadHotRail();
  assert.match(box.innerHTML, /animation:none/);
});

test('竞态守卫过期：响应回来时已有更新的请求，丢弃本轮渲染', async () => {
  const guard = makeGuard();
  const { ctrl, box } = createController({
    items: [{ url: 'd', title: '丁', heat: 1, clusterSize: 1, source: 's4' }],
    guard
  });
  const pending = ctrl.loadHotRail();
  guard.invalidate();   // 模拟用户在途中又触发了一次加载
  await pending;
  assert.equal(box.dataset.painted, undefined);
  // 列表里只剩骨架占位，真正的内容行未被渲染
  assert.match(box.innerHTML, /skeleton/);
  assert.ok(!/<a class="hot-item"/.test(box.innerHTML));
});

test('请求失败且仍是最新请求时清空热栏', async () => {
  const { ctrl, box } = createController({ items: 'fail' });
  await ctrl.loadHotRail();
  assert.equal(box.innerHTML, '');
});

test('领域筛选进入请求参数', async () => {
  const { ctrl, requests } = createController({ items: [], domain: 'aerospace' });
  await ctrl.loadHotRail();
  assert.match(requests[0], /\/api\/feed\?view=hot&page=0&domain=aerospace/);
});
