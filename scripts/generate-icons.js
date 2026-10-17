'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.join(__dirname, '..');
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];

// PNG frames preserve transparency at every Windows display scale. The ICO
// directory uses zero for 256px, as required by the Windows icon format.
function createIcon(frames) {
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...frames.map(frame => frame.png)]);
}

function createIconOutputs(source) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!Buffer.isBuffer(source) || !source.subarray(0, signature.length).equals(signature)) {
    throw new Error('renderer/logo.png must contain a PNG image');
  }
  const { nativeImage } = require('electron');
  const raster = nativeImage.createFromBuffer(source);
  const { width, height } = raster.getSize();
  if (raster.isEmpty() || width < 1 || width !== height) {
    throw new Error('renderer/logo.png must be a decodable square PNG image');
  }
  // Resize the uploaded static image directly; keep its colors and alpha, and
  // leave the source PNG and the independent in-app SVG animation untouched.
  const resize = size => raster.resize({ width: size, height: size, quality: 'best' }).toPNG();
  return new Map([
    ['build/icon.png', resize(512)],
    ['build/icon.ico', createIcon(ICON_SIZES.map(size => ({ size, png: resize(size) })))]
  ]);
}

async function generateIcons({ check = false } = {}) {
  const { app } = require('electron');
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.commandLine.appendSwitch('force-color-profile', 'srgb');
  app.on('window-all-closed', () => {});
  await app.whenReady();
  try {
    const source = fs.readFileSync(path.join(projectRoot, 'renderer', 'logo.png'));
    const outputs = createIconOutputs(source);
    for (const [relativeFile, content] of outputs) {
      const file = path.join(projectRoot, relativeFile);
      if (check) {
        if (!fs.existsSync(file) || !fs.readFileSync(file).equals(content)) {
          throw new Error(`${relativeFile} is stale; run npm run icon to regenerate from renderer/logo.png`);
        }
      } else {
        fs.writeFileSync(file, content);
      }
    }
    console.log(`${check ? 'Verified' : 'Generated'} application, tray and installer icons from renderer/logo.png`);
  } finally {
    app.quit();
  }
}

if (require.main === module || (process.versions.electron && path.resolve(process.argv[1] || '') === __filename)) {
  if (process.versions.electron) {
    generateIcons({ check: process.argv.includes('--check') }).catch(error => {
      console.error(error.message);
      require('electron').app.exit(1);
    });
  } else {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-icons-'));
    try {
      const result = spawnSync(require('electron'), [__filename, `--user-data-dir=${profile}`, ...process.argv.slice(2)], {
        env,
        stdio: 'inherit',
        windowsHide: true,
        timeout: 30000
      });
      if (result.error) throw result.error;
      process.exitCode = result.status ?? 1;
    } finally {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
}

module.exports = { ICON_SIZES, createIcon, createIconOutputs };
