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

test('release build verifies static PNG derivatives before packaging desktop and installer icons', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.scripts.icon, 'node scripts/generate-icons.js');
  assert.match(pkg.scripts.dist, /npm run icon -- --check && electron-builder/);
  assert.equal(pkg.build.win.icon, 'build/icon.ico');
  assert.equal(pkg.build.nsis.installerIcon, 'build/icon.ico');
  assert.equal(pkg.build.nsis.uninstallerIcon, 'build/icon.ico');
});

test('static PNG icon generation preserves the source independently of animated SVGs and rejects stale derivatives',
  { timeout: 45000 }, t => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-icon-png-'));
    t.after(() => {
      const target = path.resolve(profile);
      assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep)
        && path.basename(target).startsWith('spp-icon-png-'));
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });
    for (const directory of ['renderer', 'build', 'scripts']) fs.mkdirSync(path.join(profile, directory));
    const source = fs.readFileSync(path.join(root, 'renderer/logo.png'));
    const generator = path.join(profile, 'scripts/generate-icons.js');
    fs.writeFileSync(path.join(profile, 'renderer/logo.png'), source);
    fs.copyFileSync(path.join(root, 'scripts/generate-icons.js'), generator);
    // These deliberately invalid animation assets must never be read by the
    // static icon pipeline, even when present alongside the uploaded PNG.
    for (const name of ['logo.svg', 'logo-still.svg']) {
      fs.writeFileSync(path.join(profile, 'renderer', name), 'independent animation asset');
    }
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    function run(script, ...args) {
      return spawnSync(require('electron'), [script, `--user-data-dir=${path.join(profile, 'electron-profile')}`, ...args], {
        env, cwd: root, windowsHide: true, encoding: 'utf8', timeout: 10000
      });
    }
    function succeeds(result) {
      assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
    }
    succeeds(run(generator));
    assert.deepEqual(fs.readFileSync(path.join(profile, 'renderer/logo.png')), source,
      'Generation must preserve the uploaded PNG bytes');
    for (const name of ['logo.svg', 'logo-still.svg']) {
      assert.equal(fs.readFileSync(path.join(profile, 'renderer', name), 'utf8'), 'independent animation asset');
    }
    assert.deepEqual(fs.readdirSync(path.join(profile, 'build')).sort(), ['icon.ico', 'icon.png']);

    const wrapper = path.join(profile, 'inspect.cjs');
    fs.writeFileSync(wrapper, `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const { app, nativeImage } = require('electron');
      process.on('uncaughtException', error => { console.error(error); app.exit(1); });
      const { ICON_SIZES, createIconOutputs } = require(${JSON.stringify(generator)});
      const resedit = require(${JSON.stringify(require.resolve('resedit'))});
      app.on('window-all-closed', () => {});
      app.whenReady().then(() => {
        const source = fs.readFileSync(${JSON.stringify(path.join(profile, 'renderer/logo.png'))});
        assert.throws(() => createIconOutputs(Buffer.from('<svg/>')), /must contain a PNG/);
        assert.throws(() => createIconOutputs(source.subarray(0, 8)), /decodable square PNG/);
        const rectangle = nativeImage.createFromBitmap(Buffer.alloc(2 * 4, 255), { width: 2, height: 1 });
        assert.throws(() => createIconOutputs(rectangle.toPNG()), /decodable square PNG/);
        const original = nativeImage.createFromBuffer(source);
        assert.equal(original.isEmpty(), false);
        const png = fs.readFileSync(${JSON.stringify(path.join(profile, 'build/icon.png'))});
        const image = nativeImage.createFromBuffer(png);
        assert.deepEqual(image.getSize(), { width: 512, height: 512 });
        assert.deepEqual(image.toBitmap(), original.resize({ width: 512, height: 512, quality: 'best' }).toBitmap(),
          'Static icon pixels must retain the uploaded PNG colors and alpha');
        const frames = resedit.Data.IconFile.from(fs.readFileSync(${JSON.stringify(path.join(profile, 'build/icon.ico'))})).icons;
        assert.deepEqual(frames.map(frame => frame.data.width), ICON_SIZES);
        for (const frame of frames) {
          const size = frame.data.width;
          const image = nativeImage.createFromBuffer(Buffer.from(frame.data.bin));
          assert.deepEqual(image.getSize(), { width: size, height: size });
          assert.deepEqual(image.toBitmap(), original.resize({ width: size, height: size, quality: 'best' }).toBitmap(),
            'Each ICO size must retain the uploaded PNG colors and alpha');
        }
        app.quit();
      }).catch(error => { console.error(error); app.exit(1); });
    `);
    succeeds(run(wrapper));
    succeeds(run(generator, '--check'));
    const iconPath = path.join(profile, 'build/icon.ico');
    const before = fs.readFileSync(iconPath);
    fs.appendFileSync(iconPath, Buffer.from([0]));
    const stale = run(generator, '--check');
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /build\/icon\.ico is stale/);
    assert.deepEqual(fs.readFileSync(iconPath), Buffer.concat([before, Buffer.from([0])]),
      'Check mode must report stale files without rewriting them');
    assert.deepEqual(fs.readFileSync(path.join(profile, 'renderer/logo.png')), source);
  });
