'use strict';

// 阶段 3 批 2：sources-controller 自 app.js 抽离后的 Node 单测。
// 覆盖：依赖护栏、信源卡片渲染（含退避暂停/连续失败）、错误重试态、
// 启停/重试/移出监控动作与确认取消路径。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createSourcesController } = require('../renderer/sources-controller');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'sources-controller.js'), 'utf8');

test('sources-controller 工厂不直读 window，UMD 不泄漏全局且导出冻结', () => {
  assert.doesNotMatch(source, /\bwindow\./, '模块内不得出现裸 window. 直读');
  const modulePath = require.resolve('../renderer/sources-controller');
  const result = spawnSync(process.execPath, ['-e', `
    delete globalThis.SourcesController;
    const api = require(${JSON.stringify(modulePath)});
    process.stdout.write(JSON.stringify({
      exported: typeof api.createSourcesController === 'function',
      frozen: Object.isFrozen(api),
      globalCreated: Object.prototype.hasOwnProperty.call(globalThis, 'SourcesController')
    }));
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { exported: true, frozen: true, globalCreated: false });
});

test('缺少必需依赖时工厂抛 TypeError', () => {
  assert.throws(() => createSourcesController({}), TypeError);
});

const format = require('../renderer/format-utils');

function createController({ sources = [], confirm = true, patchImpl } = {}) {
  const clickListeners = [];
  const list = {
    innerHTML: '',
    addEventListener: (t, fn) => { if (t === 'click') clickListeners.push(fn); }
  };
  const toasts = [];
  const requests = [];
  const ctrl = createSourcesController({
    api: async (url, opts) => {
      requests.push([url, opts]);
      if (url === '/api/sources' && !opts) {
        if (sources === 'fail') throw new Error('sources down');
        return sources;
      }
      if (patchImpl) return patchImpl(url, opts);
      return {};
    },
    state: {},
    esc: s => String(s),
    DomUtils: { findFocusKey: () => null, restoreFocusByKey: () => {} },
    format,
    skeletons: n => `<div class="sk">${n}</div>`,
    toast: (m, e) => toasts.push([m, !!e]),
    confirmGlass: async () => confirm,
    elements: { list }
  });
  // 模拟事件委托：构造 closest 链
  const dispatchClick = button => {
    const event = { target: { closest: sel => (sel === 'button[data-act]' ? button : null) } };
    return Promise.all(clickListeners.map(fn => fn(event)));
  };
  return { ctrl, list, toasts, requests, dispatchClick };
}

const SAMPLE = [{
  id: 7, name: '某站', url: 'https://x', tier: 'T1', type: 'rss',
  domain: 'lowaltitude', enabled: true, item_count: 120, error_count: 0,
  last_status: 'ok', last_fetch_at: new Date().toISOString(),
  health: { pausedUntil: new Date(Date.now() + 600000).toISOString(), consecutiveErrors: 3, state: 'failing' }
}];

test('渲染信源卡片：退避暂停、连续失败与操作按钮齐备', async () => {
  const { ctrl, list } = createController({ sources: SAMPLE });
  await ctrl.loadSources();
  assert.match(list.innerHTML, /src-card glass is-failing/);
  assert.match(list.innerHTML, /暂停至/);
  assert.match(list.innerHTML, /连续失败 3 次/);
  assert.match(list.innerHTML, /data-act="retry"/);
  assert.match(list.innerHTML, /移出监控/);
});

test('加载失败给出带重试按钮的错误态', async () => {
  const { ctrl, list } = createController({ sources: 'fail' });
  await ctrl.loadSources();
  assert.match(list.innerHTML, /信 号 中 断/);
  assert.match(list.innerHTML, /data-act="retry-sources"/);
});

test('停用一个启用中的信源走 PATCH 并 toast', async () => {
  const { ctrl, toasts, requests, dispatchClick } = createController({ sources: SAMPLE });
  await ctrl.loadSources();
  const btn = { dataset: { act: 'toggle' }, textContent: '停用', disabled: false,
    closest: sel => (sel === '.src-card' ? { dataset: { id: '7' } } : null) };
  await dispatchClick(btn);
  const patch = requests.find(([url]) => url === '/api/sources/7');
  assert.deepEqual(patch[1].body, { enabled: false });
  assert.ok(toasts.some(([m]) => m === '信源已停用'));
});

test('移出监控在确认取消时不发 DELETE', async () => {
  const { ctrl, requests, dispatchClick } = createController({ sources: SAMPLE, confirm: false });
  await ctrl.loadSources();
  const btn = { dataset: { act: 'remove' }, textContent: '移出监控', disabled: false,
    closest: sel => (sel === '.src-card' ? { dataset: { id: '7' } } : null) };
  await dispatchClick(btn);
  assert.ok(!requests.some(([url, opts]) => url === '/api/sources/7' && opts?.method === 'DELETE'));
});

test('立即重试清除退避', async () => {
  const { ctrl, toasts, requests, dispatchClick } = createController({ sources: SAMPLE });
  await ctrl.loadSources();
  const btn = { dataset: { act: 'retry' }, disabled: false,
    closest: sel => (sel === '.src-card' ? { dataset: { id: '7' } } : null) };
  await dispatchClick(btn);
  assert.ok(requests.some(([url]) => url === '/api/sources/7/retry'));
  assert.ok(toasts.some(([m]) => m === '已清除退避，下轮采集会重新尝试'));
});

test('动作失败时 toast 统一错误文案', async () => {
  const { ctrl, toasts, dispatchClick } = createController({
    sources: SAMPLE,
    patchImpl: () => { throw new Error('拒绝'); }
  });
  await ctrl.loadSources();
  const btn = { dataset: { act: 'toggle' }, textContent: '停用', disabled: false,
    closest: sel => (sel === '.src-card' ? { dataset: { id: '7' } } : null) };
  await dispatchClick(btn);
  assert.deepEqual(toasts.at(-1), ['信源操作失败：拒绝', true]);
});
