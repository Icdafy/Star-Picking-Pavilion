'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULTS,
  FLUID_PALETTES,
  DSH_FLUID_BASE_HUE,
  fluidHueRotation
} = require('../renderer/aqua-shell');

const styles = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');

test('流体配色为浅色与深色主题分别提供六组安全预设', () => {
  assert.deepEqual(Object.keys(FLUID_PALETTES), ['light', 'dark']);
  for (const theme of ['light', 'dark']) {
    const palettes = FLUID_PALETTES[theme];
    assert.equal(palettes.length, 6, `${theme} theme palette count`);
    assert.equal(new Set(palettes.map(preset => preset.id)).size, palettes.length);
    for (const preset of palettes) {
      assert.match(preset.id, /^[a-z][a-z-]+$/);
      assert.ok(preset.name.length >= 3);
      assert.ok(Number.isFinite(preset.hue) && preset.hue >= 0 && preset.hue <= 360);
      assert.ok(Number.isFinite(preset.brightness)
        && preset.brightness >= 0
        && preset.brightness <= 100);
      assert.match(preset.swatch, /^linear-gradient\(/);
      assert.ok(Object.isFrozen(preset));
    }
  }
  assert.ok(FLUID_PALETTES.light.some(preset => (
    preset.hue === DEFAULTS.aquaHue && preset.brightness === DEFAULTS.aquaBrightness
  )));
  assert.ok(FLUID_PALETTES.dark.some(preset => (
    preset.hue === DEFAULTS.aquaHue && preset.brightness === DEFAULTS.aquaBrightness
  )));
  assert.ok(FLUID_PALETTES.dark.every(preset => preset.brightness <= 50));
});

test('命名预设以目标色相驱动 DSH 基础蓝色，不把目标值误作旋转量', () => {
  assert.equal(DSH_FLUID_BASE_HUE, 220);
  assert.deepEqual(
    Object.fromEntries(FLUID_PALETTES.dark.map(preset => [preset.name, preset.hue])),
    {
      星海蓝: 220,
      墨玉青: 170,
      深空紫: 260,
      熔星红: 0,
      琥珀夜: 40,
      极夜冰蓝: 200
    }
  );
  assert.deepEqual(
    Object.fromEntries(FLUID_PALETTES.dark.map(preset => [preset.name, fluidHueRotation(preset.hue)])),
    {
      星海蓝: 0,
      墨玉青: 310,
      深空紫: 40,
      熔星红: 140,
      琥珀夜: 180,
      极夜冰蓝: 340
    }
  );
});

test('窗口与内嵌区域的滚动条跟随 Aqua 深浅主题', () => {
  assert.match(styles, /\[data-theme="dark"\][\s\S]*--scrollbar-thumb:\s*rgba\(125,138,176,\.38\)/);
  assert.match(styles, /\[data-theme="light"\][\s\S]*--scrollbar-thumb:\s*rgba\(81,92,116,\.3\)/);
  assert.match(styles, /html\s*\{\s*scrollbar-color:\s*var\(--scrollbar-thumb\) transparent;/);
  assert.match(styles, /::-webkit-scrollbar\s*\{\s*width:\s*8px;\s*height:\s*8px;/);
  assert.match(styles, /::-webkit-scrollbar-thumb[\s\S]*border-radius:\s*999px;[\s\S]*background:\s*var\(--scrollbar-thumb\)/);
  assert.match(styles, /::-webkit-scrollbar-thumb:hover\s*\{\s*background:\s*var\(--scrollbar-thumb-hover\)/);
});
