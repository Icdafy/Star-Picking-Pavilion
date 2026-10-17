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

async function generateIcons({ check = false } = {}) {
  const { app, BrowserWindow } = require('electron');
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.commandLine.appendSwitch('force-color-profile', 'srgb');
  await app.whenReady();
  const source = fs.readFileSync(path.join(projectRoot, 'renderer', 'logo-still.svg'), 'utf8');
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false }
  });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(
      `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>html,body{margin:0;width:1024px;height:1024px;background:transparent}svg{display:block;width:1024px;height:1024px}</style></head><body>${source}</body></html>`
    )}`);
    const raster = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 }, {
      stayHidden: true,
      stayAwake: true
    });
    if (raster.isEmpty() || raster.getSize().width !== 1024 || raster.getSize().height !== 1024) {
      throw new Error('Canonical SVG did not render at 1024 × 1024');
    }
    const resize = size => raster.resize({ width: size, height: size, quality: 'best' }).toPNG();
    const outputs = new Map([
      ['renderer/logo.png', raster.toPNG()],
      ['build/icon.png', resize(512)],
      ['build/icon.ico', createIcon(ICON_SIZES.map(size => ({ size, png: resize(size) })))]
    ]);
    for (const [relativeFile, content] of outputs) {
      const file = path.join(projectRoot, relativeFile);
      if (check) {
        if (!fs.existsSync(file) || !fs.readFileSync(file).equals(content)) {
          throw new Error(`${relativeFile} is stale; run npm run icon to regenerate from renderer/logo-still.svg`);
        }
      } else {
        fs.writeFileSync(file, content);
      }
    }
    console.log(`${check ? 'Verified' : 'Generated'} application, tray and installer icons from renderer/logo-still.svg`);
  } finally {
    win.destroy();
    app.quit();
  }
}

if (process.versions.electron || require.main === module) {
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

module.exports = { ICON_SIZES, createIcon };
