'use strict';

// 阶段 3 批 2：export-controller 自 app.js 抽离后的 Node 单测。
// 覆盖：依赖护栏、剪贴板主路径与 execCommand 回退、导出参数拼装、
// runExport 的复制/下载/失败三分支。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createExportController } = require('../renderer/export-controller');

// Node 没有 URL.createObjectURL（浏览器/Worker API），为下载路径补桩
if (typeof URL.createObjectURL !== 'function') URL.createObjectURL = () => 'blob:fake';
if (typeof URL.revokeObjectURL !== 'function') URL.revokeObjectURL = () => {};
// 模块内的 blob URL 回收定时器（10s）不应阻塞测试进程退出
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms) => { const t = realSetTimeout(fn, ms); if (t?.unref) t.unref(); return t; };

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'export-controller.js'), 'utf8');

test('export-controller 工厂不直读 window，UMD 不泄漏全局且导出冻结', () => {
  assert.doesNotMatch(source, /\bwindow\./, '模块内不得出现裸 window. 直读');
  const modulePath = require.resolve('../renderer/export-controller');
  const result = spawnSync(process.execPath, ['-e', `
    delete globalThis.ExportController;
    const api = require(${JSON.stringify(modulePath)});
    process.stdout.write(JSON.stringify({
      exported: typeof api.createExportController === 'function',
      frozen: Object.isFrozen(api),
      globalCreated: Object.prototype.hasOwnProperty.call(globalThis, 'ExportController')
    }));
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { exported: true, frozen: true, globalCreated: false });
});

test('缺少必需依赖时工厂抛 TypeError', () => {
  assert.throws(() => createExportController({}), TypeError);
});

function makeDocument(execCommandResult = true) {
  const created = [];
  return {
    created,
    execCommandCalls: 0,
    createElement(tag) {
      const el = {
        tag, value: '', className: '', href: '', download: '',
        attrs: {},
        setAttribute(name, value) { this.attrs[name] = value; },
        select() { this.selected = true; },
        click() { this.clicked = true; },
        remove() { this.removed = true; }
      };
      created.push(el);
      return el;
    },
    body: { appendChild(el) { this.lastChild = el; } },
    execCommand() { this.execCommandCalls++; return execCommandResult; }
  };
}

function createController({ clipboard = true, clipboardThrows = false, apiImpl, state = {} } = {}) {
  const toasts = [];
  const document = makeDocument();
  const ctrl = createExportController({
    api: apiImpl || (async () => ({ content: '内容', count: 2, filename: 'f.md' })),
    toast: (msg, isError) => toasts.push({ msg, isError: !!isError }),
    state: Object.assign({ view: 'all', dailyDate: '2026-08-09' }, state),
    navigator: clipboard ? { clipboard: { writeText: async () => { if (clipboardThrows) throw new Error('denied'); } } } : {},
    document
  });
  return { ctrl, toasts, document };
}

test('copyText 优先走 navigator.clipboard，剪贴板异常回退 execCommand', async () => {
  const ok = createController();
  assert.equal(await ok.ctrl.copyText('hi'), true);
  assert.equal(ok.document.execCommandCalls, 0);

  const fallback = createController({ clipboardThrows: true });
  assert.equal(await fallback.ctrl.copyText('hi'), true);
  assert.equal(fallback.document.execCommandCalls, 1);
  const scratch = fallback.document.created[0];
  assert.equal(scratch.className, 'copy-scratch');
  assert.equal(scratch.removed, true);

  const noClipboard = createController({ clipboard: false });
  assert.equal(await noClipboard.ctrl.copyText('hi'), true);
});

test('exportParams 按 kind 拼装：daily 带日期，feed 带视图与筛选', () => {
  const { ctrl } = createController({ state: { view: 'featured', domain: 'aerospace', q: '火箭' } });
  assert.equal(ctrl.exportParams('daily', 'markdown').toString(), 'kind=daily&format=markdown&date=2026-08-09');
  assert.equal(
    ctrl.exportParams('feed', 'text').toString(),
    'kind=feed&format=text&view=featured&domain=aerospace&q=' + encodeURIComponent('火箭')
  );
});

test('runExport 复制模式成功时 toast 条数', async () => {
  const { ctrl, toasts } = createController();
  await ctrl.runExport('feed', 'text', 'copy');
  assert.deepEqual(toasts, [{ msg: '已复制 2 条到剪贴板', isError: false }]);
});

test('runExport 下载模式调用 anchor.click 并 toast 文件名', async () => {
  const { ctrl, toasts, document } = createController();
  await ctrl.runExport('feed', 'markdown', 'download');
  const anchor = document.created.find(el => el.tag === 'a');
  assert.equal(anchor.clicked, true);
  assert.equal(anchor.download, 'f.md');
  assert.deepEqual(toasts, [{ msg: '已导出 2 条到 f.md', isError: false }]);
});

test('runExport 后端失败时 toast 导出失败文案，不抛出', async () => {
  const { ctrl, toasts } = createController({
    apiImpl: async () => { throw new Error('服务不可用'); }
  });
  await ctrl.runExport('feed', 'text', 'copy');
  assert.deepEqual(toasts, [{ msg: '导出失败：服务不可用', isError: true }]);
});

test('导出按钮接线在元素存在时挂上点击', () => {
  const listeners = {};
  const btn = { addEventListener: (type, fn) => { listeners[type] = fn; } };
  const { toasts } = (() => {
    const toasts = [];
    createExportController({
      api: async () => ({ content: 'x', count: 1, filename: 'a.md' }),
      toast: msg => toasts.push(msg),
      state: { view: 'all' },
      navigator: {},
      document: makeDocument(),
      elements: { btnCopyFeed: btn }
    });
    return { toasts };
  })();
  assert.equal(typeof listeners.click, 'function');
  return listeners.click().then(() => {
    assert.ok(toasts.some(msg => /已复制/.test(msg)));
  });
});
