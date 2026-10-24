'use strict';

// v0.2.39 黄金分割排版与流体设计 2.0：φ 令牌、节奏系数、液态指示块、流体云、系统更新与星鲸删除。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createMotion } = require('../renderer/dom-utils');
const FluidCloud = require('../renderer/fluid-cloud');
const UpdatePill = require('../renderer/update-pill');
const Schema = require('../renderer/ui-preference-schema');
const Aurora = require('../renderer/aurora-engine');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const PHI = (1 + Math.sqrt(5)) / 2;
const golden = read('renderer/golden.css');
const token = name => {
  const match = golden.match(new RegExp(`\\n\\s*${name.replace(/-/g, '\\-')}:\\s*([^;]+);`));
  assert.ok(match, `缺少令牌 ${name}`);
  return match[1].trim();
};
const rem = name => Number.parseFloat(token(name));
const near = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}：实际 ${actual}，期望 ${expected}`);

test('字号以正文为基准按 φ^(n/4) 递进，每四级恰好 ×φ，辅助字不低于 12px', () => {
  assert.equal(rem('--t-base'), 1);
  const steps = { '--t-xs': -2, '--t-sm': -1, '--t-md': 1, '--t-lg': 2, '--t-xl': 3, '--t-2xl': 5, '--t-3xl': 7 };
  for (const [name, n] of Object.entries(steps)) near(rem(name), PHI ** (n / 4), .0006, name);
  near(rem('--t-xl') / rem('--t-sm'), PHI, .001, '四级跨度');
  assert.ok(rem('--t-2xs') * 16 >= 12, '最小字号保证可读');
});

test('行高、字重与间距都由 φ 推导，控件高度构成黄金关系', () => {
  near(Number(token('--lh-ui')), PHI, .001, '界面行高');
  near(Number(token('--lh-read')), PHI ** 1.25, .001, '阅读行高');
  near(Number(token('--lh-title')), 1 + PHI ** -2, .001, '标题行高');
  near(Number(token('--lh-display')), 1 + PHI ** -3, .001, '展示行高');
  near(Number(token('--w-strong')) / Number(token('--w-body')), PHI, .01, '标题字重');
  near(Number(token('--w-medium')) / Number(token('--w-body')), Math.sqrt(PHI), .01, '中等字重');
  const ladder = { '--sp-0': -4, '--sp-1': -3, '--sp-2': -1.5, '--sp-3': -.5, '--sp-4': 0, '--sp-5': .5, '--sp-6': 1, '--sp-7': 1.5, '--sp-8': 2 };
  for (const [name, n] of Object.entries(ladder)) near(rem(name), PHI ** n, .0006, name);
  // 控件高度 = 字号 × φ + 2 × 字号 × φ⁻²；最小宽度 = 高度 × φ；左右留白 = 高度 × φ⁻²
  near(rem('--ctl-h'), PHI + 2 * PHI ** -2, .001, '控件高度');
  near(rem('--ctl-min') / rem('--ctl-h'), PHI, .002, '黄金矩形按钮');
  near(rem('--ctl-pad') / rem('--ctl-h'), PHI ** -2, .002, '按钮左右留白');
});

test('版式比例：导航 : 内容 = 1 : φ³，页头与卡片 φ:1，弹窗落在纵向黄金分割点', () => {
  assert.match(token('--aqua-rail-width'), /\/ 5\.236\)/, '侧栏宽度 = 可用宽度 / (1 + φ³)');
  assert.match(golden, /\.settings-layout \{ grid-template-columns: minmax\(9\.5rem, 1fr\) minmax\(0, 4\.236fr\);/);
  assert.match(golden, /\.banner-copy \{ flex: 1\.618 1 26rem; \}/);
  assert.match(golden, /@container app \(min-width: 53\.76rem\) \{\s*\.daily-head \{ grid-template-columns: minmax\(0, 1\.618fr\) minmax\(0, 1fr\); \}/);
  assert.match(golden, /\.card-thumb \{[^}]*aspect-ratio: 1\.618 \/ 1;/);
  assert.match(golden, /\.glass-dialog:modal \{[^}]*top: 38\.2%; left: 50%; translate: -50% -38\.2%;/);
  assert.match(golden, /\.card-pad \{ padding: var\(--sp-5\) var\(--sp-7\); \}/, '上下 : 左右 = 1 : φ');
});

test('节奏：CSS 时长 × 1.382，曲线更柔；动效内核按同一系数放慢且默认值不变', () => {
  near(Number(token('--tempo')), 1 + PHI ** -2, .001, '节奏系数');
  const ms = name => Number.parseFloat(token(name));
  near(ms('--dur-fast'), 130 * 1.382, 1, '--dur-fast');
  near(ms('--dur'), 220 * 1.382, 1, '--dur');
  near(ms('--dur-slow'), 280 * 1.382, 1, '--dur-slow');
  near(ms('--dur-snap'), 160 * 1.382, 1, '--dur-snap');
  const calls = [];
  const el = { style: {}, animate(keyframes, options) { calls.push(options); return { cancel() {}, finished: Promise.resolve() }; } };
  const slow = createMotion({ matchMedia: () => ({ matches: false }), tempo: 1.382 });
  slow.spring(el, { from: { opacity: '0' }, to: { opacity: '1' }, duration: 300, delay: 100 });
  near(calls[0].duration, 414.6, .01, '时长按节奏放大');
  near(calls[0].delay, 138.2, .01, '延迟同比放大');
  assert.equal(slow.tempo, 1.382);
  const plain = createMotion({ matchMedia: () => ({ matches: false }) });
  plain.spring(el, { from: { opacity: '0' }, to: { opacity: '1' }, duration: 300 });
  assert.equal(calls[1].duration, 300, '不传节奏时保持原交互时限');
  assert.equal(plain.tempo, 1);
  const app = read('renderer/app.js');
  assert.match(app, /const MOTION_TEMPO = 1\.382;/);
  assert.match(app, /tempo: MOTION_TEMPO,\r?\n  liquidIndicator: true,/);
  assert.match(read('renderer/fluid.css'), /transform 719ms var\(--fluid-spring\) 97ms/, 'fluid.css 的硬编码时长同步放慢');
});

test('液态指示块：前缘先到、后缘跟上，途中被拉长，终点精确落定', () => {
  let call = 0;
  const frames = [];
  const doc = { documentElement: { dataset: { fxTier: 'full' } }, hidden: false, addEventListener() {}, removeEventListener() {} };
  const el = {
    dataset: {}, style: { setProperty() {} },
    getBoundingClientRect: () => (call++ % 2 === 0 ? { left: 0, top: 0, width: 200, height: 40 } : { left: 0, top: 300, width: 200, height: 40 }),
    animate(keyframes, options) { frames.push({ keyframes, options }); return { cancel() {}, finished: new Promise(() => {}) }; }
  };
  const motion = createMotion({ document: doc, tempo: 1.382, liquidIndicator: true, setTimeout() { return 1; }, clearTimeout() {} });
  motion.retargetIndicator(el, { x: 0, y: 300, width: 200, height: 40 });
  const keyframes = frames[0].keyframes;
  const scaleY = frame => Number(frame.transform.match(/scale\([^,]+, ([^)]+)\)/)[1]);
  const peak = Math.max(...keyframes.map(scaleY));
  assert.ok(peak > 1.6, `移动途中应被拉长，实际峰值 ${peak}`);
  assert.equal(keyframes.at(-1).transform, 'translate(0px, 300px) scale(1, 1)');
  near(frames[0].options.duration, 300 * 1.382, .01, '指示块时长按节奏放大');
});

test('流体云：活动按错误 > 进行中 > 就绪 > 普通排序，输入被规范化', () => {
  const activities = new Map([
    ['a', FluidCloud.normalizeActivity('a', { tone: 'info' }, 3)],
    ['b', FluidCloud.normalizeActivity('b', { tone: 'busy' }, 1)],
    ['c', FluidCloud.normalizeActivity('c', { tone: 'ready' }, 2)]
  ]);
  assert.equal(FluidCloud.pickActivity(activities).key, 'b');
  activities.set('d', FluidCloud.normalizeActivity('d', { tone: 'error' }, 0));
  assert.equal(FluidCloud.pickActivity(activities).key, 'd');
  const item = FluidCloud.normalizeActivity('x', { tone: 'weird', progress: 7, facts: [[1, 2], [3, 4], [5, 6], [7, 8], [9, 0]], actions: [{ label: 'a' }, { label: 'b', run() {} }] });
  assert.equal(item.tone, 'info');
  assert.equal(item.progress, 1);
  assert.equal(item.facts.length, 4);
  assert.deepEqual(item.facts[0], ['1', '2']);
  assert.equal(item.actions.length, 1, '没有 run 的动作被丢弃');
  assert.equal(FluidCloud.normalizeActivity('y', { progress: 'n/a' }).progress, null);
  const inert = FluidCloud.createFluidCloud({});
  assert.doesNotThrow(() => { inert.setActivity('a', {}); inert.clearActivity('a'); inert.dispose(); });
  assert.equal(inert.getState(), 'hidden');
});

test('流体云接线：提示并入胶囊，采集与更新状态驱动同一朵云', () => {
  const html = read('renderer/index.html');
  const cloud = html.indexOf('id="fluidCloud"');
  assert.ok(cloud > 0);
  assert.ok(html.indexOf('id="toast"') > cloud, '提示节点位于流体云内');
  assert.match(html, /<button class="fluid-cloud-capsule" id="fluidCloudCapsule" type="button" aria-expanded="false" aria-controls="fluidCloudPanel"/);
  assert.ok(html.indexOf('<script src="fluid-cloud.js"></script>') < html.indexOf('<script src="app.js"></script>'));
  const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(match => match[1]);
  assert.equal(links.at(-1), 'golden.css', '黄金分割样式最后加载');
  const app = read('renderer/app.js');
  assert.match(app, /FluidCloud\.createFluidCloud\(\{ document, window, tempo: MOTION_TEMPO \}\)/);
  assert.match(app, /fluidCloud\?\.setActivity\('pipeline'/);
  assert.match(app, /fluidCloud\?\.setActivity\('update'/);
  assert.doesNotMatch(app, /translate\(-50%, 6px\)/, '提示不再自带位移动画');
  assert.match(read('renderer/stats-controller.js'), /onActivity\(presentation\)/);
  assert.doesNotMatch(golden, /@keyframes/, '流体云与系统更新不新增关键帧');
});

test('系统更新章节：状态同步、按钮复用同一更新逻辑，章节位于“系统”分组首位', async () => {
  const html = read('renderer/index.html');
  const nav = [...html.matchAll(/data-settings-target="([^"]+)"/g)].map(match => match[1]);
  const sections = [...html.matchAll(/data-settings-section="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(sections, nav, '目录顺序与章节 DOM 顺序一致');
  assert.equal(nav.length, 12);
  assert.equal(nav[nav.indexOf('settingsDesktop') - 1], 'settingsUpdate');
  for (const id of ['updateCenterBadge', 'updateCenterHero', 'updateCenterStatus', 'btnUpdateCenter', 'btnUpdateCenterLog']) assert.match(html, new RegExp(`id="${id}"`));
  const listeners = {};
  let listener = null, checks = 0, installs = 0;
  const pill = {
    hidden: true, dataset: {}, classList: { toggle() {} }, disabled: false, title: '',
    querySelector: () => null, setAttribute() {},
    addEventListener(type, fn) { listeners[type] = fn; }
  };
  const changes = [];
  const desktop = {
    onUpdateStatus(fn) { listener = fn; },
    async checkForUpdates() { checks += 1; return { started: true }; },
    installUpdate() { installs += 1; }
  };
  const control = UpdatePill.createUpdatePill({ desktop, pill, onChange: state => changes.push(state) });
  assert.equal(changes[0].status, 'idle');
  listener({ status: 'downloading', version: '0.2.40', percent: 41.6 });
  assert.deepEqual({ status: changes.at(-1).status, version: changes.at(-1).version, percent: changes.at(-1).percent, pending: changes.at(-1).pending },
    { status: 'downloading', version: '0.2.40', percent: 42, pending: true });
  listener({ status: 'downloaded', version: '0.2.40' });
  await control.trigger();
  assert.equal(installs, 1, '设置页与流体云的按钮和侧栏按钮走同一安装逻辑');
  assert.equal(changes.at(-1).status, 'installing');
  listener({ status: 'current', version: '0.2.40' });
  await listeners.click();
  assert.equal(checks, 1);
});

test('星鲸粒子已删除：设置、偏好、渲染与引擎中都不再存在', () => {
  assert.ok(!Schema.UI_PREFERENCE_FIELDS.includes('aquaWhale'));
  assert.ok(!('aquaWhale' in Schema.DEFAULT_APPEARANCE));
  const CommonLinks = require('../renderer/common-links');
  const normalized = Schema.normalizeUiPreferences({ aquaWhale: true, aquaCritters: true }, CommonLinks, { today: '2026-10-17' });
  assert.ok(!('aquaWhale' in normalized), '旧版本保存的星鲸开关读取时被丢弃');
  for (const file of ['renderer/index.html', 'renderer/aqua-shell.js', 'renderer/aqua-shell.css', 'renderer/app.js', 'electron/ui-preferences.js']) {
    assert.doesNotMatch(read(file), /aquaWhale|setAquaWhale|particle-whale|dsh-aqua-whale|星鲸粒子/, file);
  }
  assert.doesNotMatch(read('renderer/dsh-aqua-engine.js'), /function mountWhale|WHALE_SVG/);
});

test('极光引擎接受节奏系数；缺少环境时仍退化为惰性对象', () => {
  const engine = Aurora.createAuroraEngine({ tempo: 1.382 });
  assert.equal(engine.getStatus().level, 'off');
  const source = read('renderer/aurora-engine.js');
  assert.match(source, /const soft = 1 \/ \(tempo \* tempo\);/);
  assert.match(source, /body\.ks = 1300 \* soft;/);
  assert.match(source, /function stepGaze\(dt\)/);
  assert.match(source, /const gazeAllowed = \(\) => full\(\) && tempo > 1 && !pointerGlow\(\);/, '开启追光时凝光轮廓让位');
  assert.match(source, /受力挤压/);
});
