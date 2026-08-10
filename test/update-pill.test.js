'use strict';

// 阶段 3 批 2：update-pill 自 app.js 抽离后的 Node 单测。
// 覆盖：依赖注入护栏（无桌面桥返回 null）、逐态改写胶囊、下载完成点击安装。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createUpdatePill } = require('../renderer/update-pill');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'update-pill.js'), 'utf8');

test('update-pill 工厂不直读 window，UMD 不泄漏全局且导出冻结', () => {
  assert.doesNotMatch(source, /\bwindow\./, '模块内不得出现裸 window. 直读');
  const modulePath = require.resolve('../renderer/update-pill');
  const result = spawnSync(process.execPath, ['-e', `
    delete globalThis.UpdatePill;
    const api = require(${JSON.stringify(modulePath)});
    process.stdout.write(JSON.stringify({
      exported: typeof api.createUpdatePill === 'function',
      frozen: Object.isFrozen(api),
      globalCreated: Object.prototype.hasOwnProperty.call(globalThis, 'UpdatePill')
    }));
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { exported: true, frozen: true, globalCreated: false });
});

function makePill() {
  const classes = new Set();
  const listeners = {};
  return {
    hidden: true,
    textContent: '',
    title: '',
    classList: {
      toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); },
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      has: name => classes.has(name)
    },
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    dispatch: (type, event = {}) => (listeners[type] || []).forEach(fn => fn(event))
  };
}

test('浏览器环境（无桌面桥）直接返回 null，组合根无需再包判断', () => {
  assert.equal(createUpdatePill({}), null);
  assert.equal(createUpdatePill({ desktop: {}, pill: makePill() }), null);
  assert.equal(createUpdatePill({ desktop: { onUpdateStatus: () => {} } }), null);
});

test('更新状态逐态改写胶囊文案与类名', () => {
  const pill = makePill();
  let onStatus;
  const desktop = {
    onUpdateStatus: cb => { onStatus = cb; },
    installUpdate: () => { desktop.installed = true; }
  };
  const ctrl = createUpdatePill({ desktop, pill });
  assert.ok(ctrl);

  onStatus({ status: 'available', version: '0.6.0' });
  assert.equal(pill.hidden, false);
  assert.equal(pill.textContent, '发现新版本 0.6.0…');
  assert.equal(ctrl.status, 'available');

  onStatus({ status: 'downloading', percent: 42 });
  assert.equal(pill.textContent, '下载更新 42%');

  // 未下载完成时点击不触发安装
  pill.dispatch('click');
  assert.equal(desktop.installed, undefined);

  onStatus({ status: 'downloaded', version: '0.6.0' });
  assert.equal(pill.textContent, '▲ 重启安装 0.6.0');
  assert.equal(pill.classList.has('ready'), true);

  pill.dispatch('click');
  assert.equal(desktop.installed, true);
});

test('更新检查失败给出错误态与原因提示', () => {
  const pill = makePill();
  let onStatus;
  createUpdatePill({ desktop: { onUpdateStatus: cb => { onStatus = cb; } }, pill });
  onStatus({ status: 'error', message: '网络不可达' });
  assert.equal(pill.textContent, '更新检查失败');
  assert.equal(pill.title, '网络不可达');
  assert.equal(pill.classList.has('error'), true);
});
