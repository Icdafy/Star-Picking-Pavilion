'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');

test('桌面窗口允许缩小到 800×600', () => {
  assert.match(main, /minWidth:\s*800,/);
  assert.match(main, /minHeight:\s*600,/);
  assert.doesNotMatch(main, /minWidth:\s*1080,/);
});

test('应用建立按实际内容宽度计算的内联尺寸容器', () => {
  assert.match(css, /body\s*\{[^}]*container-type:\s*inline-size;/s);
  assert.match(css, /body\s*\{[^}]*container-name:\s*app;/s);
  assert.match(css, /@container\s+app\s*\(max-width:/);
});

test('核心网格可在自身最小宽度不足时自动降为单栏', () => {
  for (const selector of ['common-links-grid', 'src-list']) {
    assert.match(
      css,
      new RegExp(`\\.${selector}[^}]*grid-template-columns:\\s*repeat\\(auto-fit,\\s*minmax\\(min\\(100%,`),
      `${selector} 必须使用不会撑破容器的内在尺寸网格`
    );
  }
  assert.match(css, /\.settings-grid[^}]*grid-template-columns:\s*repeat\(auto-fit,/);
  assert.match(css, /\.storage-breakdown[^}]*grid-template-columns:\s*repeat\(auto-fit,/);
  assert.match(css, /\.maintenance-action-grid[^}]*grid-template-columns:\s*repeat\(auto-fit,/);
});

test('信息流栅格保持单列并保留容器查询降列规则', () => {
  assert.match(css, /@container\s+app[^{]+\{[\s\S]*?\.feed-layout\s*\{\s*grid-template-columns:\s*1fr;/);
});

test('顶栏、导航、筛选和动作组均允许受控换行', () => {
  for (const selector of [
    'tower',
    'tower-actions',
    'nav',
    'nav-tabs',
    'nav-filters',
    'feed-toolbar',
    'daily-actions',
    'btn-row'
  ]) {
    assert.match(
      css,
      new RegExp(`\\.${selector}\\s*\\{[^}]*flex-wrap:\\s*wrap;`, 's'),
      `${selector} 缺少 flex-wrap`
    );
  }
});

test('表单、长文本和浮层不会撑破可用空间', () => {
  assert.match(css, /\.field input,\s*\.field select,\s*\.field textarea\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%;/s);
  assert.match(css, /\.glass-dialog\s*\{[^}]*max-height:\s*min\(92vh,\s*45rem\);[^}]*overflow:\s*auto;/s);
  assert.match(css, /\.hint,[\s\S]*?overflow-wrap:\s*anywhere;/);
});

test('daily archive status and long native paths adapt without horizontal overflow', () => {
  assert.match(css, /\.daily-archive-path[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(
    css,
    /@container\s+app\s*\(max-width:\s*45rem\)[^{]*\{[\s\S]*?\.daily-archive-status-grid\s*\{[^}]*grid-template-columns:\s*1fr;/s
  );
  assert.match(css, /\.daily-archive-actions\s*\{[^}]*flex-wrap:\s*wrap;/s);
});

// 阶段 2 响应式补全：词库面板、弹窗层、日报头部、存储治理在窄容器下的适配，
// 均为新增 @container app 规则，不改动上方锁定行
test('阶段 2：词库面板、弹窗层、日报头部与存储治理在窄容器下收敛', () => {
  assert.ok(css.includes('.feed-sentinel'), '缺少哨兵元素样式');
  // 词库面板收窄内边距并压低可视高度，内部滚动仍由 .lexicon-body 接管
  assert.match(
    css,
    /@container\s+app\s*\(max-width:\s*53\.75rem\)[^{]*\{[\s\S]*?\.lexicon-panel\s*\{[^}]*max-height:/s
  );
  // 存储治理统计在中间宽度先一步降栏，不等 45rem
  assert.match(
    css,
    /@container\s+app\s*\(max-width:\s*53\.75rem\)[^{]*\{[\s\S]*?\.maintenance-stats\s*\{[^}]*grid-template-columns:\s*1fr 1fr;/s
  );
  // 800×600 与 xl 档：弹窗层内边距与字号层次收敛（rem-only，不引入 px 字号）
  assert.match(
    css,
    /@container\s+app\s*\(max-width:\s*45rem\)[^{]*\{[\s\S]*?\.glass-dialog\s*\{[^}]*padding:\s*var\(--sp-5\);/s
  );
  assert.match(
    css,
    /@container\s+app\s*\(max-width:\s*45rem\)[^{]*\{[\s\S]*?\.glass-dialog h3\s*\{[^}]*font-size:\s*var\(--t-lg\);/s
  );
  // 日报头部：标题独占一行，动作组整行居中
  assert.match(
    css,
    /@container\s+app\s*\(max-width:\s*45rem\)[^{]*\{[\s\S]*?\.daily-title\s*\{[^}]*flex-basis:\s*100%;/s
  );
  assert.match(
    css,
    /@container\s+app\s*\(max-width:\s*45rem\)[^{]*\{[\s\S]*?\.daily-actions\s*\{[^}]*width:\s*100%;/s
  );
});
