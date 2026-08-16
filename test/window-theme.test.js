'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  THEME_BACKGROUNDS,
  TITLE_BAR_OVERLAY_COLOR,
  TITLE_BAR_SYMBOL_COLORS,
  getWindowTheme
} = require('../electron/window-theme');

const projectRoot = path.join(__dirname, '..');

test('window theme matches the official Harness desktop palette and transparent overlay', () => {
  assert.deepEqual(THEME_BACKGROUNDS, { light: '#ffffff', dark: '#151517' });
  assert.equal(TITLE_BAR_OVERLAY_COLOR, 'rgba(0, 0, 0, 0)');
  assert.deepEqual(getWindowTheme('light'), {
    backgroundColor: '#ffffff',
    titleBarOverlay: {
      color: TITLE_BAR_OVERLAY_COLOR,
      symbolColor: TITLE_BAR_SYMBOL_COLORS.light
    }
  });
  assert.deepEqual(getWindowTheme('dark'), {
    backgroundColor: '#151517',
    titleBarOverlay: {
      color: TITLE_BAR_OVERLAY_COLOR,
      symbolColor: TITLE_BAR_SYMBOL_COLORS.dark
    }
  });
});

test('desktop window and every renderer path reserve a draggable overlay title bar', () => {
  const main = fs.readFileSync(path.join(projectRoot, 'electron', 'main.js'), 'utf8');
  const aqua = fs.readFileSync(path.join(projectRoot, 'renderer', 'aqua-shell.css'), 'utf8');
  const failure = fs.readFileSync(path.join(projectRoot, 'renderer', 'failure.css'), 'utf8');
  const index = fs.readFileSync(path.join(projectRoot, 'renderer', 'index.html'), 'utf8');
  const startupFailure = fs.readFileSync(
    path.join(projectRoot, 'renderer', 'startup-failure.html'),
    'utf8'
  );
  assert.match(main, /titleBarStyle:\s*'hidden'/);
  assert.match(main, /titleBarOverlay:\s*windowTheme\.titleBarOverlay/);
  assert.match(main, /onUpdated:\s*\(snapshot,\s*patch\)[\s\S]*Object\.hasOwn\(patch,\s*'theme'\)[\s\S]*applyWindowTheme\(snapshot\.theme\)/);
  for (const css of [aqua, failure]) {
    assert.match(css, /env\(titlebar-area-height,\s*32px\)/);
    assert.match(css, /#desktop-titlebar-drag-region\s*\{/);
    assert.match(css, /-webkit-app-region:\s*drag/);
    assert.match(css, /\.desktop-titlebar-liquid-glass\s*\{/);
    assert.match(css, /backdrop-filter:\s*blur\(18px\) saturate\(17[05]%\)/);
  }
  for (const html of [index, startupFailure]) {
    assert.match(html, /id="desktop-titlebar-drag-region"/);
    assert.match(html, /class="desktop-titlebar-liquid-glass"/);
  }
  assert.match(aqua, /\.desktop-titlebar-liquid-glass::before[\s\S]*animation:\s*blob-drift/);
});

test('standalone Aqua engine retains the exact DSH 1.1.0 fluid and whale contracts', () => {
  const engine = fs.readFileSync(
    path.join(projectRoot, 'renderer', 'dsh-aqua-engine.js'),
    'utf8'
  );
  assert.match(engine, /@deepseek-ai\/dsh-client-ui-aqua 1\.1\.0/);
  assert.match(engine, /mouseRadius:\s*\.22/);
  assert.match(engine, /color1:\s*"#8AA3D6"/);
  assert.match(engine, /const GRID = 60/);
  assert.match(engine, /const FPS = 30/);
  assert.match(engine, /function attachFluidShader\(canvas, params\)/);
  assert.match(engine, /function mountWhale\(host, dark\)/);
});
