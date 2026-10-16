'use strict';

// 阶段 3 批 2：settings-view-controller 自 app.js 抽离后的 Node 单测。
// 覆盖：依赖护栏、非安装版降级提示、模型设置装配（v0.2.3）、情报备忘回看与删除。
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

function createController({ feedback = [], feedbackDelete = 'ok', push = false, rejectSave = false } = {}) {
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
  const modelsOptions = [];
  const pushOptions = [];
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
      ...require('../renderer/settings-form-controller'),
      createSettingsFormController: () => ({
        load: async () => formCalls.push('load'),
        saveCollect: async names => {
          formCalls.push(['saveCollect', names]);
          if (rejectSave) throw new Error('采集间隔请输入 1 至 720 的整数分钟');
        },
        saveRetention: async names => {
          formCalls.push(['saveRetention', names]);
          if (rejectSave) throw new Error('情报保留天数请输入 7 至 3650 的整数天');
        },
        discard: async names => formCalls.push(['discard', names])
      }),
      createModelsSettings: options => {
        modelsOptions.push(options);
        return { load: async () => formCalls.push('models-load') };
      },
      ...(push ? {
        createPushSettings: options => {
          pushOptions.push(options);
          return { load: async () => formCalls.push('push-load') };
        }
      } : { createPushSettings: undefined })
    },
    focusTools: { findFocusKey: () => 'focus-key', restoreFocusByKey: () => true },
    motion: { fadeSlideIn() {}, staggerIn() {} },
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
  return { ctrl, $, toasts, requests, formCalls, statsCalls, fire, els, modelsOptions, pushOptions };
}

test('非安装版降级：桌面设置与每日归档控件禁用并给出说明', () => {
  const { $ } = createController();
  assert.equal($('#setCloseToTray').disabled, true);
  assert.equal($('#setLaunchAtLogin').disabled, true);
  assert.match($('#desktopSettingsResult').textContent, /仅在安装版中可用/);
  assert.equal($('#dailyArchiveEnabled').disabled, true);
  assert.match($('#dailyArchiveStatus').textContent, /每日新闻简报自动归档仅在安装版中可用/);
});

test('模型设置装配到 #modelsSection 与勾选弹窗，并随设置页一起加载', async () => {
  const env = createController();
  assert.equal(env.modelsOptions.length, 1);
  const options = env.modelsOptions[0];
  assert.equal(options.root.selector, '#modelsSection');
  assert.equal(options.picker.selector, '#modelPickerDialog');
  assert.equal(typeof options.request, 'function');
  assert.equal(typeof options.confirm, 'function');
  assert.equal(options.findFocusKey(), 'focus-key');
  assert.equal(typeof options.motion.fadeSlideIn, 'function');
  await env.ctrl.loadSettings();
  assert.ok(env.formCalls.includes('models-load'));
  assert.equal(typeof env.ctrl.loadModels, 'function');
  assert.equal(env.listeners?.['#btnSaveAi'], undefined);
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

test('新闻推送一节装配到 #pushChannels 等控件，注入 api / confirm，并随设置页一起加载', async () => {
  const { ctrl, $, formCalls, pushOptions } = createController({ push: true });
  assert.equal(pushOptions.length, 1);
  const [options] = pushOptions;
  assert.equal(options.elements.channels, $('#pushChannels'));
  assert.equal(options.elements.bindPanel, $('#pushBindPanel'));
  assert.equal(options.elements.enabled, $('#pushEnabled'));
  assert.equal(typeof options.request, 'function');
  assert.equal(typeof options.confirm, 'function');
  assert.equal(typeof options.escapeHTML, 'function');
  await ctrl.loadSettings();
  assert.ok(formCalls.includes('push-load'));
});

const tick = () => new Promise(resolve => setImmediate(resolve));

test('v0.2.37 自动采集改动即保存：开关、胶囊、回车各自只提交自己的字段，并刷新状态标题', async () => {
  const env = createController();
  await env.ctrl.loadSettings();
  env.$('#setInterval').value = '60';
  env.$('#setAutomaticCollect').checked = true;
  await env.fire('#setAutomaticCollect', 'change');
  assert.deepEqual(env.formCalls.at(-1), ['saveCollect', ['automatic']]);
  assert.match(env.toasts.at(-1)[0], /自动采集已开启：每 1 小时采集一次/);
  assert.equal(env.$('#collectHeroTitle').textContent, '每 1 小时采集一次');
  assert.match(env.$('#collectIntervalChips').innerHTML, /data-value="60"[^>]*>1 小时/);
  assert.match(env.$('#collectIntervalChips').innerHTML, /aria-pressed="true" data-preset="interval" data-value="60"/);

  const chip = { dataset: { value: '30' }, getAttribute: () => 'false' };
  env.fire('#collectIntervalChips', 'click', { target: { closest: selector => (selector === '[data-preset="interval"]' ? chip : null) } });
  await tick(); await tick();
  assert.equal(env.$('#setInterval').value, '30');
  assert.deepEqual(env.formCalls.at(-1), ['saveCollect', ['intervalMinutes']]);
  assert.equal(env.$('#collectHeroTitle').textContent, '每 30 分钟采集一次');

  env.$('#setRsshub').value = '';
  await env.fire('#setRsshub', 'change');
  assert.deepEqual(env.formCalls.at(-1), ['saveCollect', ['rsshubBase']]);
  assert.equal(env.toasts.at(-1)[0], '已清除 RSSHub 地址');
  assert.ok(!env.formCalls.some(call => Array.isArray(call) && call[1] === undefined), '不得再整组提交');
});

test('v0.2.37 保存被拒时提示原因并读回服务器值（discard），保留期限胶囊同样即点即存', async () => {
  const env = createController({ rejectSave: true });
  env.$('#setInterval').value = '0';
  await env.fire('#setInterval', 'change');
  assert.deepEqual(env.toasts.at(-1), ['自动采集设置保存失败：采集间隔请输入 1 至 720 的整数分钟', true]);
  assert.deepEqual(env.formCalls.at(-1), ['discard', ['intervalMinutes']]);

  const ok = createController();
  const chip = { dataset: { value: '365' }, getAttribute: () => 'false' };
  ok.fire('#retentionChips', 'click', { target: { closest: selector => (selector === '[data-preset="retention"]' ? chip : null) } });
  await tick(); await tick();
  assert.equal(ok.$('#setRetentionDays').value, '365');
  assert.deepEqual(ok.formCalls.find(call => call[0] === 'saveRetention'), ['saveRetention', ['retentionDays']]);
  assert.ok(ok.toasts.some(([message]) => message === '相关情报改为保留 365 天'));
  assert.match(ok.$('#retentionChips').innerHTML, /aria-pressed="true" data-preset="retention" data-value="365">1 年/);

  await env.fire('#setIrrelevantRetentionDays', 'change');
  assert.deepEqual(env.formCalls.at(-1), ['discard', ['irrelevantRetentionDays']]);
  assert.match(env.toasts.at(-1)[0], /^保留期限保存失败：/);
});

test('情报备忘：空列表给出提示，Ctrl+Enter 与按钮同样记下', async () => {
  const env = createController();
  await env.ctrl.loadSettings();
  await tick();
  assert.match(env.$('#feedbackList').innerHTML, /还没有备忘/);
  env.$('#feedbackText').value = '待核实：某型号取证时间';
  let prevented = false;
  env.fire('#feedbackText', 'keydown', { key: 'Enter', ctrlKey: true, preventDefault: () => { prevented = true; } });
  await tick();
  assert.equal(prevented, true);
  assert.ok(env.requests.some(([url, opts]) => url === '/api/feedback' && opts?.body?.content === '待核实：某型号取证时间'));
  env.$('#feedbackText').value = '普通回车换行';
  env.fire('#feedbackText', 'keydown', { key: 'Enter', preventDefault: () => assert.fail('plain Enter must insert a newline') });
});
