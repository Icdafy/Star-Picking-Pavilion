'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');

test('常用网址作为摘星阁顶部主导航的原生视图接入', () => {
  assert.match(html, /data-view="links"[^>]*>常用网址<\/button>/);
  assert.match(html, /id="viewLinks"[^>]*class="view"[^>]*hidden/);
  assert.match(html, /云幄\s*·\s*常用网址/);
  assert.match(html, /id="commonLinksCategories"/);
  assert.match(html, /id="commonLinksGrid"/);
});

test('领域模块在应用脚本之前加载', () => {
  const moduleIndex = html.indexOf('<script src="common-links.js"></script>');
  const appIndex = html.indexOf('<script src="app.js"></script>');
  assert.ok(moduleIndex >= 0);
  assert.ok(appIndex > moduleIndex);
});

test('页面声明可由现有静态路由提供的摘星阁图标', () => {
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/);
  const favicon = fs.readFileSync(path.join(root, 'renderer', 'favicon.svg'), 'utf8');
  assert.match(favicon, /^<svg[^>]*aria-label="摘星阁"/);
});

test('视图切换、分类、星标和持久化均接入 app.js', () => {
  assert.match(app, /view:\s*'featured'.*links/s);
  assert.match(app, /#viewLinks/);
  assert.match(app, /renderCommonLinks/);
  assert.match(app, /commonLinksCategories/);
  assert.match(app, /commonLinksGrid/);
  assert.match(app, /CommonLinks\.STORAGE_KEY/);
  assert.match(app, /localStorage\.setItem/);
  assert.match(app, /class="common-links-open"[^>]*target="_blank"[^>]*rel="noopener"/);
});

test('常用网址沿用 Electron 的安全外链策略', () => {
  const electronMain = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  assert.match(electronMain, /setWindowOpenHandler/);
  assert.match(electronMain, /\^https\?:/);
  assert.match(electronMain, /shell\.openExternal\(url\)/);
  assert.match(electronMain, /return \{ action: 'deny' \}/);
});

test('常用网址沿用摘星阁主题并具备响应式和交互状态', () => {
  for (const selector of [
    '.common-links-head',
    '.common-links-categories',
    '.common-links-grid',
    '.common-links-card',
    '.common-links-favorite.is-active',
    '.common-links-open',
    '@media (max-width: 720px)'
  ]) assert.ok(css.includes(selector), `缺少 ${selector}`);
  assert.match(css, /\.common-links-card[\s\S]*var\(--glass-border\)/);
  assert.match(css, /\.common-links-favorite\.is-active[\s\S]*var\(--c-teal\)/);
});
