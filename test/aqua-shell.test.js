'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULTS,
  FLUID_PALETTES,
  DSH_FLUID_BASE_HUE,
  fluidHueRotation
} = require('../renderer/aqua-shell');

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
