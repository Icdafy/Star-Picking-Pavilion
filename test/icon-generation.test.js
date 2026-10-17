'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
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

test('Windows icon rendering preserves a canvas larger than the desktop work area',
  { skip: process.platform !== 'win32', timeout: 45000 }, t => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-icon-size-'));
    t.after(() => {
      const target = path.resolve(profile);
      assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep)
        && path.basename(target).startsWith('spp-icon-size-'));
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });
    const resultFile = path.join(profile, 'result.json');
    const wrapper = path.join(profile, 'render.cjs');
    fs.writeFileSync(wrapper, `
      const fs = require('node:fs');
      const { app, screen } = require('electron');
      process.on('uncaughtException', error => { console.error(error); app.exit(1); });
      const { renderLogoSvg } = require(${JSON.stringify(path.join(root, 'scripts/generate-icons'))});
      app.disableHardwareAcceleration();
      app.commandLine.appendSwitch('force-device-scale-factor', '1');
      app.commandLine.appendSwitch('force-color-profile', 'srgb');
      app.on('window-all-closed', () => {});
      app.whenReady().then(async () => {
        const area = screen.getPrimaryDisplay().workAreaSize;
        const size = Math.max(area.width, area.height) + 64;
        const source = fs.readFileSync(${JSON.stringify(path.join(root, 'renderer/logo-still.svg'))}, 'utf8');
        const image = await renderLogoSvg(source, size);
        const pixels = image.toBitmap();
        let visible = 0;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) visible++;
        fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({
          area, requested: size, actual: image.getSize(), visible, cornerAlpha: pixels[3]
        }));
        app.quit();
      }).catch(error => { console.error(error); app.exit(1); });
    `);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [wrapper, `--user-data-dir=${profile}`], {
      env, cwd: root, windowsHide: true, encoding: 'utf8', timeout: 30000
    });
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
    const rendered = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    assert.ok(rendered.requested > rendered.area.width && rendered.requested > rendered.area.height);
    assert.deepEqual(rendered.actual, { width: rendered.requested, height: rendered.requested });
    assert.ok(rendered.visible > 0, 'the full-size frame must contain the logo');
    assert.equal(rendered.cornerAlpha, 0, 'the background must remain transparent');
  });
