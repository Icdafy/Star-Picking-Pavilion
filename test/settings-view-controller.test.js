'use strict';

// 阶段 3 批 2：settings-view-controller 自 app.js 抽离后的 Node 单测。
// 覆盖：依赖护栏、非安装版降级提示、AI 配置保存成败两路、情报备忘回看与删除。
// 用假 $（选择器→桩元素表）与假子控制器工厂驱动，不触碰真实 DOM。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createSettingsViewController } = require('../renderer/settings-view-controller');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'settings-view-controller.js'), 'utf8');

test('settings-view-controller 工厂不直读 window，UMD 不泄漏全局且导出冻结', () => {
  assert.doesNotMatch(source, /\bwindow\./, '模块内不得出现裸 window. 直读');
  const modulePath = require.resolve('../renderer/settings-view-controller');
  const result = spawnSync(process.execPath, ['-e', `
    delete globalThis.SettingsViewController;
    const api = require(${JSON.stringify(modulePath)});
    process.stdout.write(JSON.stringify({
      exported: typeof api.createSettingsViewController === 'function',
      frozen: Object.isFrozen(api),
      globalCreated: Object.prototype.hasOwnProperty.call(globalThis, 'SettingsViewController')
    }));
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { exported: true, frozen: true, globalCreated: false });
});

test('缺少必需依赖时工厂抛 TypeError', () => {
  assert.throws(() => createSettingsViewController({}), TypeError);
});

function makeEl(selector, registry) {
  return {
    selector,
    disabled: false, hidden: false, checked: false,
    textContent: '', innerHTML: '', className: '', value: '',
    attrs: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { (registry[selector] ||= {})[type] = fn; },
    closest() { return null; },
    focus() { this.focused = true; }
  };
}

function createController({ saveAi = 'ok', feedback = [], feedbackDelete = 'ok' } = {}) {
  const listeners = {};
  const els = new Map();
  const $ = selector => {
    if (!els.has(selector)) els.set(selector, makeEl(selector, listeners));
    return els.get(selector);
  };
  const toasts = [];
  const requests = [];
  const formCalls = [];
  const statsCalls = [];
  const ctrl = createSettingsViewController({
    $,
    api: async (url, opts) => {
      requests.push([url, opts]);
      if (url === '/api/settings/test') return { ok: true };
      if (url === '/api/feedback' && !opts) {
        if (feedback === 'fail') throw new Error('feedback down');
        return feedback;
      }
      if (opts?.method === 'DELETE') {
        if (feedbackDelete === 'fail') throw new Error('删除被拒');
        return {};
      }
      return {};
    },
    esc: s => String(s),
    timeAgo: () => '5 分钟前',
    formatBytes: n => `${n}B`,
    toast: (m, e) => toasts.push([m, !!e]),
    confirmGlass: async () => true,
    refreshStats: () => statsCalls.push('refresh'),
    Desktop: null,   // 非安装版：桌面设置/每日归档走降级分支
    SettingsFormController: {
      createSettingsFormController: () => ({
        load: async () => formCalls.push('load'),
        saveAi: async () => {
          formCalls.push('saveAi');
          if (saveAi === 'fail') throw new Error('AI 保存失败');
        },
        saveCollect: async () => formCalls.push('saveCollect'),
        saveRetention: async () => formCalls.push('saveRetention'),
        clearApiKey: async () => formCalls.push('clearApiKey')
      })
    },
    DesktopSettingsController: null,
    StorageMaintenanceController: {
      createStorageMaintenanceController: () => ({
        load: async () => formCalls.push('maintenance-load'),
        prune: async () => {}, compact: async () => {},
        clearCache: async () => {}, deleteLegacy: async () => {}
      })
    },
    DailyArchiveController: null
  });
  const fire = (selector, type, event = {}) => listeners[selector]?.[type]?.(event);
  return { ctrl, $, toasts, requests, formCalls, statsCalls, fire, els };
}

test('非安装版降级：桌面设置与每日归档控件禁用并给出说明', () => {
  const { $ } = createController();
  assert.equal($('#setCloseToTray').disabled, true);
  assert.equal($('#setLaunchAtLogin').disabled, true);
  assert.match($('#desktopSettingsResult').textContent, /仅在安装版中可用/);
  assert.equal($('#dailyArchiveEnabled').disabled, true);
  assert.match($('#dailyArchiveStatus').textContent, /每日新闻简报自动归档仅在安装版中可用/);
});

test('保存 AI 配置成功 toast 并刷新塔台，失败 toast 错误文案', async () => {
  const ok = createController();
  await ok.fire('#btnSaveAi', 'click');
  assert.deepEqual(ok.toasts, [['AI 配置已保存，下轮分析生效', false]]);
  assert.deepEqual(ok.statsCalls, ['refresh']);

  const bad = createController({ saveAi: 'fail' });
  await bad.fire('#btnSaveAi', 'click');
  assert.deepEqual(bad.toasts, [['AI 配置保存失败：AI 保存失败', true]]);
});

test('loadSettings 载入表单并回看情报备忘', async () => {
  const env = createController({
    feedback: [{ id: 1, content: '备忘内容', createdAt: '2026-08-09T00:00:00Z' }]
  });
  await env.ctrl.loadSettings();
  await new Promise(resolve => setImmediate(resolve));   // loadFeedback 为 fire-and-forget
  assert.ok(env.formCalls.includes('load'));
  assert.match(env.$('#feedbackList').innerHTML, /data-id="1"/);
  assert.match(env.$('#feedbackList').innerHTML, /备忘内容/);
  assert.match(env.$('#feedbackList').innerHTML, /data-act="remove-note"/);
});

test('备忘列表失败时清空而不是抛错', async () => {
  const env = createController({ feedback: 'fail' });
  await env.ctrl.loadSettings();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.$('#feedbackList').innerHTML, '');
});

test('删除备忘走 DELETE，失败时 toast 备忘删除失败文案', async () => {
  const env = createController({ feedback: [], feedbackDelete: 'fail' });
  const button = { closest: sel => (sel === '.note-item' ? { dataset: { id: '9' } } : null) };
  env.fire('#feedbackList', 'click', { target: { closest: sel => (sel === 'button[data-act="remove-note"]' ? button : null) } });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(env.requests.some(([url, opts]) => url === '/api/feedback/9' && opts?.method === 'DELETE'));
  assert.deepEqual(env.toasts.at(-1), ['备忘删除失败：删除被拒', true]);
});

test('提交空备忘被拦下，有内容则写入并清空输入框', async () => {
  const env = createController();
  env.$('#feedbackText').value = '   ';
  await env.fire('#btnFeedback', 'click');
  assert.deepEqual(env.toasts, [['请先写点什么', true]]);
  env.$('#feedbackText').value = '一条备忘';
  await env.fire('#btnFeedback', 'click');
  assert.ok(env.requests.some(([url, opts]) => url === '/api/feedback' && opts?.body?.content === '一条备忘'));
  assert.equal(env.$('#feedbackText').value, '');
  assert.ok(env.toasts.some(([m]) => m === '已记入情报备忘'));
});
