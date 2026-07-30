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

test('热点区在窄容器中降栏但不被隐藏', () => {
  assert.doesNotMatch(css, /@(?:media|container)[^{]+\{[^{}]*\.hot-rail\s*\{\s*display:\s*none;/s);
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
