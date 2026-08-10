'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  escapeHTML,
  safeHttpUrl,
  findFocusKey,
  restoreFocusByKey,
  createMotion
} = require('../renderer/dom-utils');

test('CommonJS loading exports the API without creating a global DomUtils property', () => {
  const modulePath = require.resolve('../renderer/dom-utils');
  const result = spawnSync(process.execPath, ['-e', `
    delete globalThis.DomUtils;
    const api = require(${JSON.stringify(modulePath)});
    process.stdout.write(JSON.stringify({
      exported: typeof api.safeHttpUrl === 'function',
      globalCreated: Object.prototype.hasOwnProperty.call(globalThis, 'DomUtils')
    }));
  `], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    exported: true,
    globalCreated: false
  });
});

test('escapeHTML escapes text used in rendered markup', () => {
  assert.equal(
    escapeHTML(`<a href="x">Tom & Jerry's</a>`),
    '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;'
  );
  assert.equal(escapeHTML(null), '');
});

test('safeHttpUrl permits only absolute HTTP and HTTPS URLs', () => {
  assert.equal(safeHttpUrl(' HTTP://Example.COM:80/a/../b '), 'http://example.com/b');
  assert.equal(safeHttpUrl('http://127.0.0.1:8080/path'), 'http://127.0.0.1:8080/path');
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,hello',
    'file:///tmp/example',
    'https://user:password@example.com/private',
    '/relative/path',
    'not a url',
    null
  ]) assert.equal(safeHttpUrl(value), '#');
});

test('findFocusKey returns the active descendant data-focus-key', () => {
  const keyedControl = {
    getAttribute(name) {
      return name === 'data-focus-key' ? 'favorite:work-plan' : null;
    }
  };
  const activeElement = {
    closest(selector) {
      return selector === '[data-focus-key]' ? keyedControl : null;
    }
  };
  const root = {
    ownerDocument: { activeElement },
    contains(node) {
      return node === activeElement || node === keyedControl;
    }
  };

  assert.equal(findFocusKey(root), 'favorite:work-plan');
  root.contains = () => false;
  assert.equal(findFocusKey(root), null);
});

test('restoreFocusByKey focuses the matching replacement without scrolling', () => {
  let focusOptions;
  const controls = [
    { getAttribute: () => 'category:全部' },
    {
      getAttribute: () => 'favorite:work-plan',
      focus(options) { focusOptions = options; }
    }
  ];
  const root = { querySelectorAll: () => controls };

  assert.equal(restoreFocusByKey(root, 'favorite:work-plan'), true);
  assert.deepEqual(focusOptions, { preventScroll: true });
});

test('restoreFocusByKey focuses a stable fallback when the keyed control disappeared', () => {
  let fallbackOptions;
  const fallback = { focus(options) { fallbackOptions = options; } };
  const root = { querySelectorAll: () => [] };

  assert.equal(restoreFocusByKey(root, 'favorite:missing', fallback), true);
  assert.deepEqual(fallbackOptions, { preventScroll: true });
  assert.equal(restoreFocusByKey(root, null), false);
});

// ---------- 液态玻璃阶段 3：微型运动引擎（WAAPI） ----------
// 注入 mock 的 matchMedia/document/rAF 驱动：预烘焙帧与终态、
// reduced 偏好与 static 档跳过、错峰上限截断都在假 DOM 上断言

function makeAnimatableElement() {
  const element = {
    style: {},
    animations: [],
    animate(keyframes, options) {
      element.animations.push({ keyframes, options });
      return { cancel() {}, finished: Promise.resolve() };
    }
  };
  return element;
}
const noReduced = () => ({ matches: false });

test('createMotion 导出冻结且依赖全部经注入（缺失不抛、静默降级）', () => {
  const motion = createMotion({});
  assert.equal(Object.isFrozen(motion), true);
  assert.equal(typeof motion.spring, 'function');
  assert.equal(typeof motion.fadeSlideIn, 'function');
  assert.equal(typeof motion.staggerIn, 'function');
  // 无 el.animate 的元素直接落终态，不抛异常
  const bare = { style: {} };
  assert.equal(motion.fadeSlideIn(bare), null);
  assert.equal(bare.style.transform, 'translateY(0)');
  assert.equal(bare.style.opacity, '1');
});

test('spring 经注入的 el.animate 播预烘焙采样帧，只涉及 transform/opacity', () => {
  const motion = createMotion({ matchMedia: noReduced });
  const el = makeAnimatableElement();
  motion.fadeSlideIn(el, { duration: 260 });
  assert.equal(el.animations.length, 1);
  const { keyframes, options } = el.animations[0];
  assert.ok(keyframes.length >= 8 && keyframes.length <= 12, '采样帧数落在 8-12');
  for (const frame of keyframes) {
    assert.ok('transform' in frame && 'opacity' in frame);
    assert.match(frame.transform, /^translateY\(/);
  }
  assert.equal(keyframes[0].opacity, '0');
  assert.equal(keyframes[keyframes.length - 1].opacity, '1');
  assert.equal(options.duration, 260);
  assert.equal(options.easing, 'linear', '预烘焙帧走 linear，弹性在采样里');
  // 评审修复：fill 只取 backwards——delay 期内应用首帧，避免错峰延迟期
  // 以 inline 终态闪现；终态仍由 inline 保证，不用 forwards/both
  assert.equal(options.fill, 'backwards');
  // 终态先落 inline，动画结束后自然落定
  assert.equal(el.style.transform, 'translateY(0)');
  assert.equal(el.style.opacity, '1');
});

test('spring 双帧模式（from/to）走弹簧 bezier，stiffness 预设决定时长', () => {
  const motion = createMotion({ matchMedia: noReduced });
  const el = makeAnimatableElement();
  motion.spring(el, { from: { opacity: '0' }, to: { opacity: '1' }, stiffness: 'heavy' });
  const { keyframes, options } = el.animations[0];
  assert.equal(keyframes.length, 2);
  assert.match(options.easing, /cubic-bezier/);
  assert.equal(options.duration, motion.MOTION_STIFFNESS.heavy.duration);
});

test('reduced-motion 偏好下跳动画直接落终态，不调 el.animate', () => {
  const motion = createMotion({ matchMedia: query => ({ matches: query.includes('reduce') }) });
  const el = makeAnimatableElement();
  assert.equal(motion.fadeSlideIn(el), null);
  assert.equal(el.animations.length, 0);
  assert.equal(el.style.transform, 'translateY(0)');
  assert.equal(el.style.opacity, '1');
});

test('fx-tier 为 static 时同样跳动画（经注入的 document 读档位）', () => {
  const motion = createMotion({
    matchMedia: noReduced,
    document: { documentElement: { dataset: { fxTier: 'static' } } }
  });
  const el = makeAnimatableElement();
  assert.equal(motion.spring(el, { from: {}, to: { opacity: '1' } }), null);
  assert.equal(el.animations.length, 0);
  // lite/full 档照常播
  const fullMotion = createMotion({
    matchMedia: noReduced,
    document: { documentElement: { dataset: { fxTier: 'full' } } }
  });
  const fullEl = makeAnimatableElement();
  fullMotion.fadeSlideIn(fullEl);
  assert.equal(fullEl.animations.length, 1);
});

test('staggerIn 超过上限的节点被截断，delay 逐个递增', () => {
  const motion = createMotion({ matchMedia: noReduced });
  const elements = Array.from({ length: 12 }, makeAnimatableElement);
  const animated = motion.staggerIn(elements, { step: 40 });
  assert.equal(animated, motion.STAGGER_LIMIT);
  assert.equal(motion.STAGGER_LIMIT, 8);
  elements.slice(0, 8).forEach(el => assert.equal(el.animations.length, 1));
  elements.slice(8).forEach(el => assert.equal(el.animations.length, 0));
  const delays = elements.slice(0, 8).map(el => el.animations[0].options.delay);
  assert.deepEqual(delays, [0, 40, 80, 120, 160, 200, 240, 280]);
});

test('spring 清理链：未注入 rAF 时动画对象仍在结束后被取消', async () => {
  // 评审修复：rAF 只是「再等一帧」的可选优化，缺失时不得让 Animation
  // 对象永不 cancel
  const motion = createMotion({ matchMedia: noReduced });
  let cancelled = false;
  const el = {
    style: {},
    animate() {
      return { cancel() { cancelled = true; }, finished: Promise.resolve() };
    }
  };
  motion.fadeSlideIn(el);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(cancelled, true);
});

test('spring 清理链：注入 rAF 时经其延迟一帧再取消', async () => {
  const rafCallbacks = [];
  const motion = createMotion({ matchMedia: noReduced, raf: cb => rafCallbacks.push(cb) });
  let cancelled = false;
  const el = {
    style: {},
    animate() {
      return { cancel() { cancelled = true; }, finished: Promise.resolve() };
    }
  };
  motion.fadeSlideIn(el);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(cancelled, false, 'rAF 回调执行前不取消');
  assert.equal(rafCallbacks.length, 1);
  rafCallbacks[0]();
  assert.equal(cancelled, true);
});

test('动画结束后经注入的 rAF 清理动画对象，失败不影响终态', async () => {
  const rafQueue = [];
  const motion = createMotion({ matchMedia: noReduced, raf: fn => rafQueue.push(fn) });
  const el = makeAnimatableElement();
  motion.fadeSlideIn(el);
  await Promise.resolve();           // 等 finished promise 微任务
  assert.equal(rafQueue.length, 1);
  rafQueue[0]();                     // 清理不抛异常即通过
  assert.equal(el.style.transform, 'translateY(0)', '终态在 inline 不受取消影响');
});
