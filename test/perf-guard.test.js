'use strict';

// 静态性能预算护栏 —— 只读源码文本做预算断言，防止后续重构悄悄引入
// 体积膨胀或全量重渲染回退。阈值取「当前值 + 小幅余量」，基线见
// docs/frontend-contracts.md 第 8 节；数字要上调必须同步更新契约文档。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
const stylesheetFiles = [...html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi)]
  .map(([tag]) => tag.match(/\bhref=["']([^"']+)["']/i)?.[1])
  .filter(href => href && !/^(?:[a-z]+:|\/\/)/i.test(href))
  .map(href => path.join(root, 'renderer', ...href.split('/')));
const stylesheetSources = stylesheetFiles.map(file => fs.readFileSync(file, 'utf8'));
const css = stylesheetSources.join('\n');
const app = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
// 阶段 3 批 2：loadFeed 随信息流控制器迁出 app.js，切片落点同步改为新模块源码
const feedController = fs.readFileSync(path.join(root, 'renderer', 'feed-controller.js'), 'utf8');

test('样式表体积不超过预算，膨胀必须先被护栏拦下', () => {
  // Aqua 外壳拆分后必须统计页面真实加载的全部本地 CSS，不能只守 styles.css
  // 而让新增文件绕过预算。当前字体分片声明 + 组件样式 + 外壳约 235.5 KiB，
  // 预留约 14.5 KiB 给后续必要修补；超过时应先清理重复覆盖和死规则。
  const bytes = stylesheetFiles.reduce((total, file) => total + fs.statSync(file).size, 0);
  assert.ok(
    bytes <= 250 * 1024,
    `页面样式已达 ${(bytes / 1024).toFixed(1)} KB，超过 250 KB 总预算`
  );
});

test('index.html 脚本标签总数受控，Aqua 官方引擎保持单一独立边界', () => {
  // 脚本全部外置（src 属性）已由 renderer-integration 测试锁定，这里只管数量。
  // 阶段 3 模块化拆分（app.js 绞杀者式重构）把单一巨文件拆为职责单一的
  // UMD 模块，每个模块对应一个 <script src>，这是拆分的必然成本：本地静态文件
  // 加载开销可忽略（无网络、无 CDN），后续可加 defer 进一步优化。批 2 抽出
  // 11 个功能控制器后基线为 22 个，上限上调为 25；批 3 新增 store/view-registry、
  // 批 4 新增 common-links-controller 后为 24 个；Aqua 外壳为第 25 个；v0.1.0.1
  // 将 DSH 1.1.0 的 WebGL/鲸鱼引擎从状态控制器中独立为第 26 个脚本，便于逐字审计
  // 上游实现且不把 29 KiB 图形代码重新塞回控制器。基线到达 26 个，预算已用尽，
  // 后续任何批次都不得再新增脚本标签（只准在既有模块内迁移或合并）。
  // 再超说明模块又在碎片化，应合并职责相近的模块。
  const scriptCount = [...html.matchAll(/<script\b/gi)].length;
  assert.ok(scriptCount <= 26, `脚本标签已有 ${scriptCount} 个，上限 26 个`);
});

test('样式表动画关键帧数量受控，动效不无限堆叠', () => {
  // 页面全部样式当前共 20 组 @keyframes；动画是合成层开销的大头，
  // 新增动效前先考虑复用 WAAPI 或既有关键帧。
  const keyframesCount = [...css.matchAll(/@keyframes\b/g)].length;
  assert.ok(keyframesCount <= 20, `@keyframes 已有 ${keyframesCount} 组，上限 20 组`);
});

test('信息流整表 innerHTML 赋值点不回退为更多全量重渲染路径', () => {
  // loadFeed 段内对 #feedList（变量名 list）的整表赋值基线是 3 处：
  // 骨架屏、空态、失败态。阶段 4 起正常数据整表重载改走 keyed diff
  // 调和（diff.reconcile），分页追加走 diff.appendPage，两者都不产生
  // 整表 innerHTML 赋值；上限由 4 下调为 3，成为新护栏。
  // 此处不留余量：多出一个整表赋值就是性能回退，必须显式论证并更新契约。
  // 批 2：loadFeed 迁到 renderer/feed-controller.js，切片边界同步迁移
  // （loadFeed 与 loadNextFeedPage 之间只有工具条同步，不含其它赋值点）。
  const start = feedController.indexOf('async function loadFeed');
  const end = feedController.indexOf('async function loadNextFeedPage');
  assert.ok(start >= 0 && end > start, 'loadFeed 区段边界缺失');
  const fullRenders = [...feedController.slice(start, end).matchAll(/\blist\.innerHTML\s*=/g)].length;
  assert.ok(
    fullRenders <= 3,
    `#feedList 整表 innerHTML 赋值已有 ${fullRenders} 处，上限 3 处`
  );
});

test('信息流渲染路径已接入 keyed diff，不退回字符串模板整表拼接', () => {
  // 阶段 4 护栏：loadFeed 内正常数据渲染必须走 diff.reconcile/appendPage；
  // 实时轮询顶部直刷新必须优先 diff.prependFresh。出现 renderTimeline(
  // 返回值直接整表赋值的回退写法会被这里与上方赋值点计数双重拦下。
  assert.match(feedController, /diff\.reconcile\(/, 'loadFeed 重置必须走 diff.reconcile');
  assert.match(feedController, /diff\.appendPage\(/, '分页追加必须走 diff.appendPage');
  const poller = fs.readFileSync(path.join(root, 'renderer', 'realtime-poller.js'), 'utf8');
  assert.match(poller, /diff\.prependFresh\(/, '实时新条目必须优先走 diff.prependFresh');
});

test('backdrop-filter 使用处受控，毛玻璃不叠加成滤镜风暴', () => {
  // 页面全部样式当前 10 处；backdrop-filter 每处都是实时滤镜计算，
  // 卡片列表里尤其昂贵。拆出新 CSS 也不得绕过这条护栏。
  const backdropCount = [...css.matchAll(/backdrop-filter/g)].length;
  assert.ok(backdropCount <= 10, `backdrop-filter 已有 ${backdropCount} 处，上限 10 处`);
});

test('transition 只过渡合成层友好属性，布局类属性与 all 不参与过渡', () => {
  // 阶段 2 护栏，评审修复轮加固：过渡属性的白名单口径为 transform /
  // opacity / visibility 与颜色族（color、background*、border-color、
  // box-shadow、filter、outline、text-decoration-color 等）。布局类属性
  //（width/height/top/left/right/bottom/margin/padding/inset/gap）与排版、
  // 栅格类属性（font-size/letter-spacing/line-height/grid-template*/flex*）
  // 参与过渡会逐帧触发回流，必须改用 transform 等价实现；transition: all
  // 会隐式带上全部布局属性，同样禁止。
  // 解析口径加固：先按规则块再按 `;` 切声明取属性名，不再依赖逗号切段的
  // 巧合；先剥掉 bezier 括号段避免其内部逗号干扰；长写法
  // transition-property 一并纳入检查。先剥掉注释再解析，注释里的示例不计数。
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const layoutProp = /^(min-|max-|inline-|block-)?(width|height)$|^(top|right|bottom|left)$|^(margin|padding|inset|gap|font-size|letter-spacing|line-height|grid-template|flex)/;
  const offenders = [];
  const ruleRe = /([^{}]+)\{([^}]*)\}/g;
  let rule;
  while ((rule = ruleRe.exec(code))) {
    const selector = rule[1].trim();
    for (const decl of rule[2].split(';')) {
      const found = decl.match(/^\s*(transition(?:-property)?)\s*:\s*(.+)$/);
      if (!found) continue;
      const isPropertyList = found[1] === 'transition-property';
      // 先剥掉括号段（cubic-bezier 等），其内部逗号不得参与分段
      const value = found[2].replace(/\([^)]*\)/g, '');
      // transition 简写每段首词是属性名；transition-property 的值本身就是属性名
      const props = value.split(',').map(seg => (isPropertyList ? seg.trim() : seg.trim().split(/\s+/)[0])).filter(Boolean);
      // 豁免：.tab-indicator 的 width/height 跟随目标 tab 的实测尺寸（脚本写
      // --ti-w/--ti-h，换行与界面缩放都要重测），尺寸跟随没有 transform 等价物，
      // 属布局机制必需；styles.css 该块内已有同口径豁免注释。
      const exempt = p => selector.includes('.tab-indicator') && /^(width|height)$/.test(p);
      for (const p of props) {
        if (exempt(p)) continue;
        if (p === 'all' || layoutProp.test(p)) offenders.push(`${selector} → ${p}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `transition 出现布局类属性或 all：${offenders.join('；')}，请改为 transform 等价实现`
  );
});
