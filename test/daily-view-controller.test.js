'use strict';

// 阶段 3 批 2：daily-view-controller 自 app.js 抽离后的 Node 单测。
// 覆盖：依赖护栏、日报渲染、空日期态、错误重试态、竞态守卫过期、
// 日期前后翻（不许越过今天）与重新生成失败文案。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createDailyViewController } = require('../renderer/daily-view-controller');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'daily-view-controller.js'), 'utf8');

test('daily-view-controller 工厂不直读 window，UMD 不泄漏全局且导出冻结', () => {
  assert.doesNotMatch(source, /\bwindow\./, '模块内不得出现裸 window. 直读');
  const modulePath = require.resolve('../renderer/daily-view-controller');
  const result = spawnSync(process.execPath, ['-e', `
    delete globalThis.DailyViewController;
    const api = require(${JSON.stringify(modulePath)});
    process.stdout.write(JSON.stringify({
      exported: typeof api.createDailyViewController === 'function',
      frozen: Object.isFrozen(api),
      globalCreated: Object.prototype.hasOwnProperty.call(globalThis, 'DailyViewController')
    }));
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { exported: true, frozen: true, globalCreated: false });
});

test('缺少必需依赖时工厂抛 TypeError', () => {
  assert.throws(() => createDailyViewController({}), TypeError);
});

function makeGuard() {
  let current = 0;
  return {
    begin: () => { const id = ++current; return { isCurrent: () => id === current }; },
    invalidate: () => { current++; }
  };
}

// 与 format-utils 相同的本地日历工具（行为级等价，直接引用真模块）
const format = require('../renderer/format-utils');

function createController({ report = 'fail', regen = 'ok', guard = makeGuard() } = {}) {
  const listeners = {};
  const elements = {
    body: { innerHTML: '', addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); } },
    date: { textContent: '' },
    sub: { textContent: '' },
    prev: { addEventListener: (t, fn) => { elements.prevClick = fn; } },
    next: { addEventListener: (t, fn) => { elements.nextClick = fn; } },
    regen: { disabled: false, classes: new Set(),
      classList: { add(n) { this.__c?.add(n); }, remove() {} },
      addEventListener: (t, fn) => { elements.regenClick = fn; } }
  };
  const toasts = [];
  const remembers = [];
  const requests = [];
  const state = { dailyDate: '2026-08-08', dailyDates: [] };
  const ctrl = createDailyViewController({
    api: async (url, opts) => {
      requests.push([url, opts]);
      if (url.startsWith('/api/daily/regenerate')) {
        if (regen === 'fail') throw new Error('生成失败');
        return {};
      }
      if (report === 'fail') throw new Error('daily down');
      // 响应日期跟随请求参数，避免样例数据把 state.dailyDate 写回固定值
      const clone = JSON.parse(JSON.stringify(report));
      const m = url.match(/date=([0-9-]+)/);
      if (m) clone.report.date = m[1];
      return clone;
    },
    state,
    esc: s => String(s),
    safeUrl: s => `safe:${s}`,
    format,
    skeletons: n => `<div class="sk">${n}</div>`,
    toast: (m, e) => toasts.push([m, !!e]),
    preferenceActions: { remember: (k, v) => remembers.push([k, v]) },
    dailyRequestGuard: guard,
    elements
  });
  return { ctrl, state, elements, toasts, remembers, requests, guard };
}

const SAMPLE = {
  dates: ['2026-08-08'],
  report: {
    date: '2026-08-08', total: 2, generatedAt: '2026-08-08T09:00:00Z',
    byDomain: { lowaltitude: 1, aerospace: 1 },
    sections: [{ category: '低空经济', items: [{
      url: 'u', title: '标题', quality_score: 88, ai_summary: '摘要',
      source_name: '来源', tier: 'T1', domain: 'lowaltitude'
    }] }]
  }
};

test('加载日报渲染分区与条目，落 state 与日期栏', async () => {
  const { ctrl, state, elements } = createController({ report: SAMPLE });
  await ctrl.loadDaily('2026-08-08');
  assert.equal(state.dailyDate, '2026-08-08');
  assert.equal(elements.date.textContent, '2026 / 08 / 08');
  assert.match(elements.body.innerHTML, /daily-section glass/);
  assert.match(elements.body.innerHTML, /safe:u/);
  assert.match(elements.sub.textContent, /2 条精选/);
});

test('空分区给出「今日无风」空态', async () => {
  const empty = JSON.parse(JSON.stringify(SAMPLE));
  empty.report.sections = [];
  const { ctrl, elements } = createController({ report: empty });
  await ctrl.loadDaily('2026-08-08');
  assert.match(elements.body.innerHTML, /今 日 无 风/);
});

test('加载失败给出带重试按钮的错误态', async () => {
  const { ctrl, elements } = createController({ report: 'fail' });
  await ctrl.loadDaily('2026-08-08');
  assert.match(elements.body.innerHTML, /信 号 中 断/);
  assert.match(elements.body.innerHTML, /data-act="retry-daily"/);
});

test('启发式降级无 AI 分数时分数字段兜底为「—」而非 NaN', async () => {
  const noScore = JSON.parse(JSON.stringify(SAMPLE));
  noScore.report.sections[0].items[0].quality_score = null;
  const { ctrl, elements } = createController({ report: noScore });
  await ctrl.loadDaily('2026-08-08');
  assert.match(elements.body.innerHTML, /di-score">—</);
  assert.doesNotMatch(elements.body.innerHTML, /NaN/, '无分数时不得渲染 NaN');
});

test('竞态守卫过期时不写 DOM', async () => {
  const guard = makeGuard();
  const { ctrl, elements, guard: g } = createController({ report: SAMPLE, guard });
  const pending = ctrl.loadDaily('2026-08-08');
  guard.invalidate();
  await pending;
  assert.ok(!/daily-section/.test(elements.body.innerHTML));
});

test('shiftDaily 向前翻并持久化，向后越过今天则不动', async () => {
  const { ctrl, state, remembers } = createController({ report: SAMPLE });
  ctrl.shiftDaily(-1);
  assert.equal(state.dailyDate, '2026-08-07');
  assert.deepEqual(remembers, [['dailyDate', '2026-08-07']]);
  // 从一个很靠前的日期向后翻到未来应被拦
  state.dailyDate = format.localDateString();
  ctrl.shiftDaily(1);
  assert.equal(state.dailyDate, format.localDateString());   // 未越过今天
});

test('重新生成失败 toast 文案并复原按钮', async () => {
  const { ctrl, toasts, elements } = createController({ report: SAMPLE, regen: 'fail' });
  await elements.regenClick();
  assert.deepEqual(toasts, [['日报重新生成失败：生成失败', true]]);
  assert.equal(elements.regen.disabled, false);
});

test('重新生成成功后 toast 并重载当日日报', async () => {
  const env = createController({ report: SAMPLE });
  await env.elements.regenClick();
  assert.ok(env.toasts.some(([m]) => m === '日报已重新生成'));
  assert.ok(env.requests.some(([url]) => url === '/api/daily/regenerate'));
});
