'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Read the HWND that Electron actually created, then ask USER32 and the Shell
// for their native state. PE resources and BrowserWindow constructor options do
// not prove which icon Explorer receives for an already running window.
async function readWindowsWindowIcons(application, { windowId } = {}) {
  assert.equal(process.platform, 'win32', 'Native window icon verification requires Windows');
  const handle = await application.evaluate(({ BrowserWindow }, id) => {
    const window = id ? BrowserWindow.fromId(id) : BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error('No native window to inspect');
    const buffer = window.getNativeWindowHandle();
    return (buffer.length === 8 ? buffer.readBigUInt64LE() : BigInt(buffer.readUInt32LE())).toString();
  }, windowId);
  const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, 'windows-window-icons.ps1'), '-WindowHandle', handle], {
    encoding: 'utf8', timeout: 20000, windowsHide: true, maxBuffer: 8 * 1024 * 1024
  });
  return JSON.parse(result.trim());
}

async function assertWindowsWindowIcons(application, sourcePng, { directory, windowId, shell } = {}) {
  const state = await readWindowsWindowIcons(application, { windowId });
  if (directory) {
    fs.mkdirSync(directory, { recursive: true });
    for (const frame of state.frames) {
      if (frame.png) fs.writeFileSync(path.join(directory, `wm-geticon-${frame.type}.png`), Buffer.from(frame.png, 'base64'));
    }
  }
  for (const type of [0, 1, 2]) {
    assert.ok(state.frames.find(frame => frame.type === type)?.png,
      `WM_GETICON ${['ICON_SMALL', 'ICON_BIG', 'ICON_SMALL2'][type]} must return the application icon, not fall back to Electron's window class`);
  }
  const comparisons = await application.evaluate(({ nativeImage }, data) => {
    const original = nativeImage.createFromBuffer(Buffer.from(data.sourcePng, 'base64'));
    if (original.isEmpty()) throw new Error('Expected logo PNG is empty');
    return data.frames.map(frame => {
      const actual = nativeImage.createFromBuffer(Buffer.from(frame.png, 'base64'));
      const size = actual.getSize();
      const expected = original.resize({ ...size, quality: 'best' });
      // Electron bitmaps use premultiplied color. Comparing their alpha as well
      // as all color channels tolerates small GDI/Skia rounding differences
      // without letting transparent pixels disguise a different logo.
      const left = actual.toBitmap(), right = expected.toBitmap();
      let totalError = 0, largeErrors = 0;
      for (let index = 0; index < left.length; index++) {
        const error = Math.abs(left[index] - right[index]);
        totalError += error;
        if (error > 32) largeErrors++;
      }
      return { type: frame.type, ...size, meanError: totalError / left.length,
        largeErrorFraction: largeErrors / left.length };
    });
  }, { sourcePng: sourcePng.toString('base64'), frames: state.frames });
  const report = { ...state, frames: state.frames.map(({ png, ...frame }) => frame), comparisons };
  if (directory) fs.writeFileSync(path.join(directory, 'native-window-icons.json'), JSON.stringify(report, null, 2) + '\n');
  for (const comparison of comparisons) {
    assert.ok(comparison.meanError <= 8 && comparison.largeErrorFraction <= 0.08,
      `WM_GETICON ${comparison.type} differs from the uploaded logo: ${JSON.stringify(comparison)}`);
  }
  if (shell) {
    assert.equal(state.shell.appId, shell.appId, 'The window must have the product AppUserModelID');
    assert.equal(state.shell.relaunchDisplayName, shell.displayName, 'Taskbar relaunch must use the product name');
    assert.equal(state.shell.relaunchIconResource?.toLowerCase(), `${shell.iconPath},0`.toLowerCase(),
      'Taskbar grouping/pinning must use the explicit current icon resource');
    assert.equal(state.shell.relaunchCommand, shell.relaunchCommand,
      'Taskbar relaunch must start this application instead of the generic Electron executable');
    assert.ok(fs.existsSync(shell.iconPath), 'Taskbar relaunch icon resource must exist on disk');
  }
  return report;
}

module.exports = { readWindowsWindowIcons, assertWindowsWindowIcons };
