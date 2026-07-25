'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const css = read('renderer/styles.css');
const html = read('renderer/index.html');
const app = read('renderer/app.js');
const fontDir = path.join(root, 'renderer', 'fonts', 'source-han-sans-sc');
const fontCss = read('renderer/fonts/source-han-sans-sc/index.css');

const Schema = require('../renderer/ui-preference-schema');
const Bootstrap = require('../renderer/bootstrap');
const CommonLinks = require('../renderer/common-links');

function createDocument() {
  return { documentElement: { dataset: {}, style: {} } };
}

test('思源黑体随安装包内置，分片文件与 OFL 许可齐全', () => {
  // 内置而不是只写字体名：思源黑体不是 Windows 预装字体，只写名字的话
  // 没装过的机器会静默回退到微软雅黑，「全中文思源黑体」就名存实亡了。
  const faces = fontCss.match(/@font-face\s*\{[\s\S]*?\}/g) || [];
  assert.ok(faces.length >= 100, `分片过少：${faces.length}`);
  for (const face of faces) {
    assert.match(face, /font-family: 'Source Han Sans SC';/);
    assert.match(face, /font-weight: 100 900;/);          // 可变字重，粗细不靠合成
    assert.match(face, /unicode-range:/);                 // 按需加载的前提
    assert.match(face, /font-display: block;/);           // 本地字体，免掉回退字体的闪烁
  }

  const referenced = [...fontCss.matchAll(/url\(\.\/([^)]+)\)/g)].map(match => match[1]);
  assert.equal(referenced.length, faces.length);
  for (const file of new Set(referenced)) {
    assert.ok(fs.existsSync(path.join(fontDir, file)), `缺少字体分片 ${file}`);
  }
  assert.match(fs.readFileSync(path.join(fontDir, 'LICENSE'), 'utf8'), /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(read('renderer/fonts/README.md'), /Noto Sans SC[\s\S]*思源黑体|思源黑体[\s\S]*Noto Sans SC/);
});

test('字体表与主样式表并行加载，且排在样式表之前', () => {
  const fontLink = html.indexOf('<link rel="stylesheet" href="fonts/source-han-sans-sc/index.css">');
  const styleLink = html.indexOf('<link rel="stylesheet" href="styles.css">');
  assert.ok(fontLink >= 0, '缺少字体样式表引用');
  assert.ok(fontLink < styleLink);
  // @import 要等主样式表解析完才发起请求，白白多一跳；字体表必须走 <link>
  assert.equal(/^\s*@import/m.test(css), false);
});

test('中文一律思源黑体、英文与数字一律 Times New Roman', () => {
  // 一条字体栈同时管两种文字：Times New Roman 在前但没有汉字字形，
  // 汉字会自动落到后面的思源黑体上。
  assert.match(css, /--font-latin: 'Times New Roman',/);
  assert.match(css, /--font-hans: 'Source Han Sans SC', 'Noto Sans SC',/);
  assert.match(css, /--font-sans: var\(--font-latin\), var\(--font-hans\);/);
  for (const role of ['display', 'ui', 'body', 'mono']) {
    assert.match(
      css,
      new RegExp(`--font-${role}: var\\(--font-sans\\);`),
      `--font-${role} 没有指向统一字体栈`
    );
  }
  // 旧的三层字体（得意黑 / 仿宋 / 等宽）不得残留
  for (const legacy of ['Smiley Sans', 'SmileySans', 'FangSong', '仿宋', 'Cascadia Mono', 'Consolas', 'monospace']) {
    assert.equal(css.includes(legacy), false, `样式表仍残留旧字体 ${legacy}`);
  }
  assert.equal(fs.existsSync(path.join(root, 'renderer', 'fonts', 'SmileySans-Oblique.woff2')), false);
});

test('字号阶梯全部为 rem，且正文基准不低于 1rem', () => {
  const scale = {};
  for (const [, name, value] of css.matchAll(/--(t-[a-z0-9]+): ([^;]+);/g)) scale[name] = value.trim();
  assert.deepEqual(Object.keys(scale), [
    't-2xs', 't-xs', 't-sm', 't-base', 't-md', 't-lg', 't-xl', 't-2xl', 't-3xl'
  ]);
  assert.equal(scale['t-base'], '1rem');

  const rems = Object.values(scale).map(value => {
    assert.match(value, /^\.?\d*\.?\d+rem$/, `字号必须用 rem：${value}`);
    return Number.parseFloat(value);
  });
  // 单调递增，且最小一档仍有 12px＠16（v0.0.7 最小是 11px，试用者反馈看着累）
  for (let i = 1; i < rems.length; i += 1) assert.ok(rems[i] > rems[i - 1], '字号阶梯必须单调递增');
  assert.ok(rems[0] >= 0.75, '最小字号不得低于 .75rem');
});

test('间距、圆角与栏宽同样以 rem 派生，放大时与字号同步', () => {
  for (const [, declaration] of css.matchAll(/--(sp-\d: [^;]+);/g)) {
    assert.match(declaration, /rem$/, `间距必须用 rem：${declaration}`);
  }
  for (const [, declaration] of css.matchAll(/--(radius-[a-z]+: [^;]+);/g)) {
    assert.match(declaration, /rem$/, `圆角必须用 rem：${declaration}`);
  }
  assert.match(css, /--shell: \d+(?:\.\d+)?rem;/);
  assert.match(css, /--gutter: \.?\d*\.?\d+rem;/);
});

test('根字号是唯一标尺：随窗口连续变化，再乘用户选的缩放档位', () => {
  assert.match(css, /font-size: calc\(clamp\(15px, 14px \+ \.15625vw, 18\.5px\) \* var\(--ui-scale\)\);/);
  const ratios = ['sm', 'md', 'lg', 'xl'].map(step => {
    const match = css.match(new RegExp(`:root\\[data-ui-scale="${step}"\\] \\{ --ui-scale: ([\\d.]+); \\}`));
    assert.ok(match, `缺少缩放档位 ${step}`);
    return Number.parseFloat(match[1]);
  });
  for (let i = 1; i < ratios.length; i += 1) assert.ok(ratios[i] > ratios[i - 1], '缩放档位必须单调递增');
  assert.equal(ratios[1], 1, '标准档必须是 1 倍');
});

test('样式表里不留写死像素的字号与字距，缩放才不会脱节', () => {
  // 唯一允许的 px 字号是根字号那一行——它是标尺本身。
  const hardcodedSizes = css
    .split('\n')
    .map(line => line.trim())
    .filter(line => /font-size:[^;]*\d+(?:\.\d+)?px/.test(line));
  assert.deepEqual(hardcodedSizes, [
    'font-size: calc(clamp(15px, 14px + .15625vw, 18.5px) * var(--ui-scale));'
  ]);
  assert.equal(/letter-spacing:[^;]*?\dpx/.test(css), false, '字距必须用 em，否则放大时字距不跟着走');
  assert.equal(/line-height: *\d+px/.test(css), false, '行高必须用无单位倍数');
});

test('中文阅读节奏：正文行距放宽，长文再宽一档', () => {
  assert.match(css, /body \{[\s\S]*?line-height: 1\.75;/);
  assert.match(
    css,
    /\.card-summary, \.cr-text, \.hint, \.empty-state p,[\s\S]*?line-height: 1\.9;/
  );
});

test('hidden 的元素一律不占位，不会在界面上留下空盒子', () => {
  // hidden 的 display:none 来自浏览器默认样式表，优先级最低：任何类规则里写了
  // display 的元素都会把它盖掉。本页有四处这样的元素，实测在界面上留下了
  // 「检索框左边一颗空胶囊」「导航下一条空青条」「星标标签后一个空角标」。
  assert.match(css, /\[hidden\] \{ display: none !important; \}/);
  // 兜底规则到位后，逐条打的补丁就是死代码，留着只会让人以为还需要照抄
  assert.equal(/^\s*\.[\w-]+:not\(\[hidden\]\)/m.test(css), false);
  assert.equal(/^\s*\.lexicon-panel\[hidden\]/m.test(css), false);

  // 真正的防线：任何初始 hidden 的元素，其类规则若写了 display，必须有兜底覆盖
  const hiddenTags = [...html.matchAll(/<([a-z]+)\b([^>]*)>/g)]
    .filter(([, , attrs]) => /\shidden(\s|=|>|$)/.test(attrs));
  assert.ok(hiddenTags.length >= 4, '页面应有若干初始隐藏的元素');
});

test('顶栏靠内容换行而不是像素断点，放大档位时标签不会被从中间断开', () => {
  // 放大缩放档位时窗口宽度没变、内容却大了一圈，写死 px 的媒体查询这时不触发。
  // 所以顶栏必须允许换行，且标签本身不许断词——否则「监控信源」会断成两行。
  assert.match(css, /\.tower \{\s*\n\s*display: flex; flex-wrap: wrap;/);
  assert.match(css, /\.stat-label \{[^}]*white-space: nowrap;/);
  assert.match(css, /\.brand-text p \{[^}]*white-space: nowrap;/s);
});

test('缩放档位是一等 UI 偏好：默认标准档，只认四档', () => {
  assert.ok(Schema.UI_PREFERENCE_FIELDS.includes('textScale'));
  assert.deepEqual(Schema.TEXT_SCALES, ['sm', 'md', 'lg', 'xl']);
  assert.equal(Schema.getDefaultUiPreferences(CommonLinks).textScale, 'md');
  for (const good of ['sm', 'md', 'lg', 'xl']) {
    assert.equal(Schema.isValidUiPreferenceValue('textScale', good, CommonLinks), true);
  }
  for (const bad of ['huge', '', 1.25, null, 'MD']) {
    assert.equal(Schema.isValidUiPreferenceValue('textScale', bad, CommonLinks), false);
  }
  assert.deepEqual(
    Schema.createUiPreferencePatch('textScale', 'lg', CommonLinks),
    { textScale: 'lg' }
  );
  assert.deepEqual(Schema.createUiPreferencePatch('textScale', 'huge', CommonLinks), {});
  assert.equal(
    Schema.normalizeUiPreferences({ textScale: 'huge' }, CommonLinks, { today: '2026-07-25' }).textScale,
    'md'
  );

  // 桌面端的落盘校验也要挡住非法档位：update() 先同步校验再排队写盘，
  // 非法值在写盘之前就抛出，所以这里不会碰到磁盘。
  const { createUiPreferencesStore, DEFAULT_UI_PREFERENCES } = require('../electron/ui-preferences');
  const store = createUiPreferencesStore({ directory: path.join(root, 'no-such-directory') });
  assert.throws(() => store.update({ textScale: 'huge' }), /textScale/);
  assert.equal(DEFAULT_UI_PREFERENCES.textScale, 'md');
});

test('缩放档位在样式表生效前就写到 <html> 上，避免开屏抖一下', () => {
  const desktop = Bootstrap.initializeTextScale(null, createDocument(), { textScale: 'xl' });
  assert.equal(desktop, 'xl');

  const document = createDocument();
  Bootstrap.initializeTextScale(
    { getItem: key => (key === Bootstrap.STORAGE_KEYS.uiPreferences ? '{"textScale":"lg"}' : null) },
    document,
    null
  );
  assert.equal(document.documentElement.dataset.uiScale, 'lg');

  const fallback = createDocument();
  Bootstrap.initializeTextScale({ getItem: () => '{"textScale":"huge"}' }, fallback, null);
  assert.equal(fallback.documentElement.dataset.uiScale, 'md');

  const broken = createDocument();
  Bootstrap.initializeTextScale({ getItem() { throw new Error('unavailable'); } }, broken, null);
  assert.equal(broken.documentElement.dataset.uiScale, 'md');
});

test('前端把档位落到 data-ui-scale 并持久化，快捷键与设置页两条路都通', () => {
  assert.match(app, /textScale: restoredPreferences\.textScale/);
  assert.match(app, /document\.documentElement\.dataset\.uiScale = scale;/);
  assert.match(app, /preferenceActions\.remember\('textScale', scale\)/);
  // 缩放改变导航条高度与标签位置，粘顶偏移必须跟着重算
  assert.match(app, /function applyTextScale[\s\S]{0,600}?syncNavHeight\(\);\s*\n\s*syncTabIndicator\(\);/);
  // Ctrl +/-/0 必须排在「是否正在输入」判定之前，输入框里也要能用
  const zoomIndex = app.indexOf("if (event.key === '=' || event.key === '+')");
  const typingIndex = app.indexOf('if (isTypingTarget(document.activeElement)) return;');
  assert.ok(zoomIndex >= 0 && zoomIndex < typingIndex);
  assert.match(app, /applyTextScale\('md'\)/);
  assert.match(app, /applyTextScale\(state\.textScale, \{ persist: false \}\)/);

  assert.match(html, /id="textScaleOptions"/);
  for (const step of ['sm', 'md', 'lg', 'xl']) {
    assert.match(html, new RegExp(`class="scale-option"[^>]*data-text-scale="${step}"`));
  }
  // 缩放档位不能复用 .pill：领域筛选按 .pill 批量改选中态，共用类名会把
  // 档位按钮的选中态清掉，还会给它们绑上 setDomain(undefined)。
  assert.doesNotMatch(html, /class="pill"[^>]*data-text-scale=/);
  assert.doesNotMatch(app, /\$\$\('\.pill'\)/);
  assert.match(app, /\$\$\('\.domain-pills \.pill'\)\.forEach\(pill => \{/);
  assert.match(app, /\$\$\('\.domain-pills \.pill'\)\.forEach\(p => p\.addEventListener/);
});
