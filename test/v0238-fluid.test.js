'use strict';

// v0.2.38 流体设计：极光引擎的纯函数内核、档位决策、偏好字段与页面接线。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Aurora = require('../renderer/aurora-engine');
const Schema = require('../renderer/ui-preference-schema');
const CommonLinks = require('../renderer/common-links');
const { createUiPreferencesStore } = require('../electron/ui-preferences');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('橡皮筋位移单调、对称且有上限，越拉越重', () => {
  assert.equal(Aurora.rubberBand(0), 0);
  let previous = 0;
  for (const offset of [10, 40, 120, 400, 2000]) {
    const value = Aurora.rubberBand(offset, 300);
    assert.ok(value > previous, `${offset} 处应继续增大`);
    assert.ok(value < offset, '位移必须小于手指移动量');
    assert.ok(value < 300, '位移不能超过尺度');
    assert.equal(Aurora.rubberBand(-offset, 300), -value);
    previous = value;
  }
  // 越往后每 100px 换来的位移越少
  const gain = from => Aurora.rubberBand(from + 100, 300) - Aurora.rubberBand(from, 300);
  assert.ok(gain(0) > gain(200) && gain(200) > gain(600));
});

test('弹簧在长帧下依旧稳定，回弹有过冲并最终静止', () => {
  const axis = { p: .92, v: 0, t: 1 };
  let peak = axis.p, settled = false;
  for (let frame = 0; frame < 240 && !settled; frame += 1) {
    settled = Aurora.stepSpring(axis, frame % 7 === 0 ? .1 : 1 / 144, 560, .3, .0006);
    peak = Math.max(peak, axis.p);
  }
  assert.ok(settled, '应在 240 帧内静止');
  assert.equal(axis.p, 1);
  assert.ok(peak > 1.01, `低阻尼松手应当 Q 弹过冲，实际峰值 ${peak}`);
  const stiff = { p: 0, v: 0, t: 30 };
  for (let i = 0; i < 400; i += 1) Aurora.stepSpring(stiff, 1, 1500, .92, .08);
  assert.equal(stiff.p, 30, '超长帧被截断到子步，不会数值发散');
});

test('档位：用户选择优先，自动档按硬件、电量与掉帧降级，系统减少动态效果一律静止', () => {
  const level = Aurora.resolveFluidLevel;
  assert.equal(level({}), 'full');
  assert.equal(level({ mode: 'auto', fxTier: 'lite' }), 'lite');
  assert.equal(level({ mode: 'auto', saver: true }), 'lite');
  assert.equal(level({ mode: 'auto', strained: true }), 'lite');
  assert.equal(level({ mode: 'full', fxTier: 'lite', saver: true }), 'full');
  assert.equal(level({ mode: 'lite' }), 'lite');
  assert.equal(level({ mode: 'off' }), 'off');
  assert.equal(level({ mode: 'full', reduced: true }), 'off');
  assert.equal(level({ mode: 'auto', fxTier: 'static' }), 'off');
});

test('水滴连桥只在足够近时出现，几何可解析', () => {
  const near = Aurora.metaballPath({ x: 0, y: 0 }, 18, { x: 46, y: 0 }, 18);
  assert.match(near, /^M [-\d.]+ [-\d.]+ C .+ A 18\.00 18\.00 0 [01] 0 .+ Z$/);
  assert.ok(!/NaN|Infinity/.test(near));
  const overlap = Aurora.metaballPath({ x: 0, y: 0 }, 18, { x: 20, y: 4 }, 16);
  assert.ok(overlap && !/NaN/.test(overlap));
  assert.equal(Aurora.metaballPath({ x: 0, y: 0 }, 18, { x: 400, y: 0 }, 18), '');
  assert.equal(Aurora.metaballPath({ x: 0, y: 0 }, 18, { x: 1, y: 0 }, 4), '', '完全包含时不画连桥');
  const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
  assert.equal(Aurora.rectGap(rect(0, 0, 40, 30), rect(52, 0, 40, 30)), 12);
  assert.equal(Aurora.rectGap(rect(0, 0, 40, 30), rect(30, 0, 40, 30)), -10);
  const circle = Aurora.capsuleCircle(rect(100, 10, 80, 30), { x: 400, y: 25 });
  assert.deepEqual(circle, { c: { x: 165, y: 25 }, r: 15 });
});

test('缺少文档或帧时钟时引擎退化为惰性对象，不抛错', () => {
  const engine = Aurora.createAuroraEngine({});
  assert.equal(engine.enterView({}), false);
  assert.equal(engine.getStatus().level, 'off');
  assert.doesNotThrow(() => { engine.refresh(); engine.dispose(); });
});

test('流体设计档位是持久化的外观偏好：默认自动、只接受四个值', () => {
  assert.deepEqual([...Schema.FLUID_MODES], ['auto', 'full', 'lite', 'off']);
  assert.ok(Schema.UI_PREFERENCE_FIELDS.includes('fluidMode'));
  assert.equal(Schema.DEFAULT_APPEARANCE.fluidMode, 'auto');
  assert.equal(Schema.getDefaultUiPreferences(CommonLinks).fluidMode, 'auto');
  for (const value of ['auto', 'full', 'lite', 'off']) assert.equal(Schema.isValidUiPreferenceValue('fluidMode', value, CommonLinks), true);
  for (const value of ['', 'on', 'max', 1, null]) assert.equal(Schema.isValidUiPreferenceValue('fluidMode', value, CommonLinks), false);
  const normalized = Schema.normalizeUiPreferences({ fluidMode: 'lite' }, CommonLinks, { today: '2026-10-17' });
  assert.equal(normalized.fluidMode, 'lite');
  assert.equal(Schema.normalizeUiPreferences({ fluidMode: 'turbo' }, CommonLinks, { today: '2026-10-17' }).fluidMode, 'auto');
});

test('主进程偏好存储拒绝非法的流体档位', async t => {
  const directory = await fs.promises.mkdtemp(path.join(require('node:os').tmpdir(), 'spp-fluid-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const store = createUiPreferencesStore({ directory, now: () => new Date(2026, 9, 17, 9) });
  await assert.rejects(() => Promise.resolve().then(() => store.update({ fluidMode: 'turbo' })), /fluidMode/);
  const saved = await Promise.resolve(store.update({ fluidMode: 'off' }));
  assert.equal(saved.fluidMode, 'off');
assert.equal(JSON.parse(await fs.promises.readFile(store.file, 'utf8')).fluidMode, 'off');
});

test('页面接线：极光引擎在组合根之前加载，流体样式最后覆盖，设置页有档位开关', () => {
  const html = read('renderer/index.html');
  const engine = html.indexOf('<script src="aurora-engine.js"></script>');
  assert.ok(engine > html.indexOf('<script src="dom-utils.js"></script>'));
  assert.ok(engine < html.indexOf('<script src="aqua-shell.js"></script>'));
  const fluid = html.indexOf('<link rel="stylesheet" href="fluid.css">');
  assert.ok(fluid > html.indexOf('<link rel="stylesheet" href="intel.css">'), '流体样式必须在最后覆盖令牌');
  for (const mode of ['auto', 'full', 'lite', 'off']) assert.match(html, new RegExp(`data-fluid-mode="${mode}"`));
  assert.match(html, /id="fluidModeHint" aria-live="polite"/);
  const app = read('renderer/app.js');
  assert.match(app, /AuroraEngine\.createAuroraEngine\(\{ document, window, motion, springEasing: DomUtils\.springEasing \}\)/);
  assert.match(app, /fluid: auroraEngine/);
  assert.match(read('renderer/aqua-shell.js'), /root\.dataset\.fluidMode = state\.fluidMode;/);
});

test('流体样式只用合成层友好的属性做运动，并为降低透明度、减少动画和强制配色降级', () => {
  const css = read('renderer/fluid.css');
  assert.doesNotMatch(css, /@keyframes/, '运动全部走 WAAPI 与过渡，不新增关键帧');
  assert.match(css, /\[data-fluid-material="solid"\]/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /@supports \(appearance: base-select\)/);
  assert.match(css, /:has\(select:open\) \.fluid-scrim/);
  assert.match(css, /--fluid-bar-radius: 1\.5rem;/);
  const engine = read('renderer/aurora-engine.js');
  assert.doesNotMatch(engine, /\.style\.(top|left|width|height|margin)\s*=(?!=)[^;]*(translate|scale)/);
  assert.match(engine, /style\.translate = /);
  assert.match(engine, /style\.scale = /);
});
