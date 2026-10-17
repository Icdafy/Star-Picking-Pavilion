'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const resedit = require('resedit');
const { ICON_SIZES, createIcon } = require('../scripts/generate-icons');
const { assertWindowsIconResources } = require('../scripts/verify-package');

const root = path.join(__dirname, '..');
const icon = fs.readFileSync(path.join(root, 'build', 'icon.ico'));

function executableWithIcons(frames) {
  const exe = resedit.NtExecutable.createEmpty(false);
  const resources = resedit.NtExecutableResource.from(exe);
  resedit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, 1, 1033, frames);
  resources.outputResource(exe);
  return Buffer.from(exe.generate());
}

test('Windows icon includes all seven transparent PNG sizes used by installer and desktop', () => {
  assert.equal(icon.readUInt16LE(0), 0);
  assert.equal(icon.readUInt16LE(2), 1);
  assert.equal(icon.readUInt16LE(4), ICON_SIZES.length);
  const frames = resedit.Data.IconFile.from(icon).icons;
  assert.deepEqual(frames.map(frame => frame.data.width), ICON_SIZES);
  assert.deepEqual(frames.map(frame => frame.data.height), ICON_SIZES);
  for (const frame of frames) {
    assert.equal(frame.data.isRaw(), true);
    const png = Buffer.from(frame.data.bin);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png[25], 6, 'Every size must retain RGBA transparency');
  }
  assert.deepEqual(createIcon(frames.map(frame => ({ size: frame.data.width, png: Buffer.from(frame.data.bin) }))), icon);
});

test('package verifier compares the embedded PE frames, including a stale small taskbar icon', () => {
  const frames = resedit.Data.IconFile.from(icon).icons.map(frame => frame.data);
  assert.equal(assertWindowsIconResources(executableWithIcons(frames), icon, 'Update installer'), 7);
  const changed = resedit.Data.IconFile.from(icon).icons.map(frame => frame.data);
  new Uint8Array(changed[0].bin)[40] ^= 1;
  assert.throws(() => assertWindowsIconResources(executableWithIcons(changed), icon, 'Update installer'), /Update installer has a stale 16 × 16/);
  assert.throws(() => assertWindowsIconResources(executableWithIcons(frames.slice(1)), icon), /missing canonical Windows icon sizes/);
  assert.throws(() => assertWindowsIconResources(Buffer.from(resedit.NtExecutable.createEmpty(false).generate()), icon), /no Windows icon resources/);
});

test('release build verifies rendered canonical SVG against committed desktop and installer icons', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.scripts.icon, 'node scripts/generate-icons.js');
  assert.match(pkg.scripts.dist, /npm run icon -- --check && electron-builder/);
  assert.equal(pkg.build.win.icon, 'build/icon.ico');
  assert.equal(pkg.build.nsis.installerIcon, 'build/icon.ico');
  assert.equal(pkg.build.nsis.uninstallerIcon, 'build/icon.ico');
});
