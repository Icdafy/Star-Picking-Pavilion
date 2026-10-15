'use strict';

// v0.2.33：刷新率自适应运动内核。解析弹簧压缩为 CSS linear() 缓动、逐帧
// 采样密度跟随显示器、刷新率探测与根节点回弹曲线；不支持 linear() 的
// 环境保留原采样帧与 bezier 契约（见 dom-utils.test.js）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMotion, createFrameRateProbe, springEasing } = require('../renderer/dom-utils');

function parse(easing) {
  const body = easing.match(/^linear\((.*)\)$/)[1];
  return body.split(',').map(part => part.trim().split(/\s+/)).map(([value, at]) => ({ value: Number(value), at: at ? parseFloat(at) : null }));
}

test('v0233: springEasing 输出起止精确、拐点递增且有限的 linear() 曲线', () => {
  for (const bounce of [0, .08, .15, .3]) {
    const easing = springEasing({ bounce });
    const stops = parse(easing);
    assert.equal(stops[0].value, 0);
    assert.equal(stops.at(-1).value, 1);
    assert.ok(stops.length >= 8 && stops.length <= 40, `${bounce}: ${stops.length} stops`);
    const positions = stops.slice(1, -1).map(stop => stop.at);
    positions.forEach((at, index) => { assert.ok(at > 0 && at < 100); if (index) assert.ok(at > positions[index - 1]); });
    const peak = Math.max(...stops.map(stop => stop.value));
    if (bounce === 0) assert.ok(peak <= 1, '临界阻尼不越过终点');
    // 轻回弹低于简化容差时不留可见越界；较大回弹保留，且有上限。
    else if (bounce < .1) assert.ok(peak <= 1.002, `${bounce}: peak ${peak}`);
    else assert.ok(peak > 1 && peak < 1 + bounce * .2, `${bounce}: peak ${peak}`);
  }
  assert.equal(springEasing({ bounce: .15 }), springEasing({ bounce: .15 }), '同参数复用缓存');
});

test('v0233: 继承初速度的弹簧前段推进更快，仍在终点落定', () => {
  const at = (easing, x) => {
    const stops = parse(easing).map((stop, i, all) => ({ ...stop, at: stop.at ?? (i ? 100 : 0) }));
    const i = stops.findIndex(stop => stop.at >= x);
    const a = stops[i - 1], b = stops[i];
    return a.value + (b.value - a.value) * (x - a.at) / (b.at - a.at);
  };
  const rest = springEasing({ bounce: .1 }), moving = springEasing({ bounce: .1, velocity: 3 });
  assert.ok(at(moving, 5) > at(rest, 5) + .05);
  assert.equal(parse(moving).at(-1).value, 1);
});

function element() {
  const el = { style: { setProperty(name, value) { el.style[name] = value; } }, dataset: {}, calls: [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 40 }),
    animate(keyframes, options) { el.calls.push({ keyframes, options }); return { cancel() {}, finished: new Promise(() => {}) }; } };
  return el;
}

function curvedMotion({ hz = 144, tier = 'full' } = {}) {
  const properties = {};
  const root = { dataset: { fxTier: tier }, style: {
    setProperty(name, value) { properties[name] = value; }, removeProperty(name) { delete properties[name]; } } };
  const doc = new EventTarget(); doc.documentElement = root; doc.hidden = false;
  const win = new EventTarget();
  win.CSS = { supports: (property, value) => /^linear\(/.test(value) };
  win.setTimeout = () => 0; win.clearTimeout = () => {};
  return { properties, motion: createMotion({ document: doc, window: win, frameRate: { hz }, matchMedia: () => ({ matches: false }) }) };
}

test('v0233: 支持 linear() 时入场只给首尾两帧，弹簧交给合成器逐帧求值', () => {
  const { motion } = curvedMotion();
  const el = element();
  motion.fadeSlideIn(el, { distance: 6, duration: 260 });
  const [{ keyframes, options }] = el.calls;
  assert.equal(keyframes.length, 2);
  assert.deepEqual(keyframes[0], { transform: 'translateY(6px)', opacity: '0' });
  assert.match(options.easing, /^linear\(0, /);
  assert.equal(options.duration, 260);
  assert.equal(options.fill, 'backwards');
  const panel = element();
  motion.spring(panel, { from: { opacity: '0' }, to: { opacity: '1' } });
  assert.match(panel.calls[0].options.easing, /^linear\(/);
  motion.dispose();
});

test('v0233: 指示块采样密度跟随刷新率，一帧一个关键帧', () => {
  for (const [hz, expected] of [[60, 18], [144, 43], [240, 48]]) {
    const { motion } = curvedMotion({ hz });
    const el = element();
    let top = 0;
    el.getBoundingClientRect = () => ({ left: 0, top, width: 100, height: 40 });
    el.style.setProperty = (name, value) => { if (name === '--ti-y') top = parseFloat(value); };
    motion.retargetIndicator(el, { x: 0, y: 120, width: 100, height: 40 });
    assert.equal(el.calls[0].keyframes.length, expected + 1, `${hz}Hz`);
    assert.equal(el.calls[0].keyframes.at(-1).transform, 'translate(0px, 120px) scale(1, 1)');
    motion.dispose();
  }
});

test('v0233: 根节点回弹曲线随静态档移除，回到样式表定义', async () => {
  const { motion, properties } = curvedMotion();
  assert.match(properties['--spring-light'], /^linear\(0, /);
  motion.dispose();
  const staticEnv = curvedMotion({ tier: 'static' });
  assert.equal(staticEnv.properties['--spring-light'], undefined);
  staticEnv.motion.dispose();
});

test('v0233: 刷新率探测取中位数并吸附常见档位，前台聚焦时才测量', () => {
  for (const [interval, expected] of [[1000 / 144, '144'], [1000 / 60, '60'], [1000 / 165, '165'], [1000 / 240, '240']]) {
    const queue = [];
    const doc = new EventTarget(); doc.hidden = false; doc.hasFocus = () => true;
    doc.documentElement = { dataset: {} };
    const win = new EventTarget();
    win.requestAnimationFrame = fn => queue.push(fn);
    win.performance = { now: () => 0 };
    const probe = createFrameRateProbe({ document: doc, window: win });
    let time = 0, guard = 0;
    while (queue.length && guard++ < 100) {
      // 一次偶发长帧不得拉低结果
      time += guard === 7 ? 40 : interval;
      queue.shift()(time);
    }
    assert.equal(doc.documentElement.dataset.refreshRate, expected);
    assert.equal(probe.hz, Number(expected));
    probe.dispose();
  }
  const doc = new EventTarget(); doc.hidden = false; doc.hasFocus = () => false; doc.documentElement = { dataset: {} };
  const win = new EventTarget(); let requested = 0;
  win.requestAnimationFrame = () => { requested++; };
  createFrameRateProbe({ document: doc, window: win }).dispose();
  assert.equal(requested, 0, '失焦时不占用 rAF');
});
