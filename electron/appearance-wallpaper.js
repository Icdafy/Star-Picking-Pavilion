'use strict';

// 外观壁纸独立保存在 userData，不进入 UI 偏好 JSON，也不占用 Chromium
// localStorage 配额。渲染层只可经受限 IPC 读写一张已压缩图片。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function hasExpectedSignature(mime, payload) {
  if (mime === 'image/jpeg') {
    return payload.length >= 3 && payload[0] === 0xff && payload[1] === 0xd8 && payload[2] === 0xff;
  }
  if (mime === 'image/png') {
    return payload.length >= 8
      && payload.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return payload.length >= 12
    && payload.subarray(0, 4).toString('ascii') === 'RIFF'
    && payload.subarray(8, 12).toString('ascii') === 'WEBP';
}

function parseWallpaperDataUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_BYTES * 2) {
    throw new TypeError('wallpaper must be a supported image data URL');
  }
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/u);
  if (!match || !ALLOWED_MIMES.has(match[1])) {
    throw new TypeError('wallpaper must be JPEG, PNG or WebP');
  }
  const payload = Buffer.from(match[2], 'base64');
  if (!payload.length || payload.length > MAX_BYTES) {
    throw new RangeError('wallpaper must be no larger than 3 MB');
  }
  if (!hasExpectedSignature(match[1], payload)) {
    throw new TypeError('wallpaper image signature is invalid');
  }
  return { mime: match[1], payload };
}

function createAppearanceWallpaperStore({
  directory,
  readFile = fs.promises.readFile,
  writeFile = fs.promises.writeFile,
  rename = fs.promises.rename,
  mkdir = fs.promises.mkdir,
  rm = fs.promises.rm
} = {}) {
  if (typeof directory !== 'string' || !directory) throw new TypeError('directory is required');
  for (const [name, operation] of Object.entries({ readFile, writeFile, rename, mkdir, rm })) {
    if (typeof operation !== 'function') throw new TypeError(`${name} must be a function`);
  }

  const assetDirectory = path.join(directory, 'appearance');
  const file = path.join(assetDirectory, 'wallpaper.asset');
  let queue = Promise.resolve();

  function serialize(operation) {
    const result = queue.catch(() => {}).then(operation);
    queue = result;
    return result;
  }

  async function load() {
    let stored;
    try {
      stored = await readFile(file);
    } catch (error) {
      if (error?.code === 'ENOENT') return '';
      throw error;
    }
    if (!Buffer.isBuffer(stored) || stored.length > MAX_BYTES + 64) return '';
    const separator = stored.indexOf(0x0a);
    if (separator < 1 || separator > 32) return '';
    const mime = stored.subarray(0, separator).toString('ascii');
    const payload = stored.subarray(separator + 1);
    if (!ALLOWED_MIMES.has(mime) || !payload.length || payload.length > MAX_BYTES) return '';
    if (!hasExpectedSignature(mime, payload)) return '';
    return `data:${mime};base64,${payload.toString('base64')}`;
  }

  function save(dataUrl) {
    const { mime, payload } = parseWallpaperDataUrl(dataUrl);
    return serialize(async () => {
      await mkdir(assetDirectory, { recursive: true });
      const temporary = path.join(
        assetDirectory,
        `.wallpaper.${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`
      );
      try {
        await writeFile(temporary, Buffer.concat([Buffer.from(`${mime}\n`, 'ascii'), payload]), {
          mode: 0o600
        });
        await rename(temporary, file);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
      return Object.freeze({ stored: true, mime, bytes: payload.length });
    });
  }

  function clear() {
    return serialize(async () => {
      await rm(file, { force: true });
      return Object.freeze({ stored: false });
    });
  }

  return Object.freeze({ file, load, save, clear });
}

function registerAppearanceWallpaperIpc({ ipcMain, getStore } = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new TypeError('ipcMain is required');
  if (typeof getStore !== 'function') throw new TypeError('getStore is required');

  ipcMain.handle('appearance-wallpaper:get', async () => {
    const store = getStore();
    return store ? store.load() : '';
  });
  ipcMain.handle('appearance-wallpaper:save', async (_event, payload) => {
    const store = getStore();
    if (!store) throw new Error('appearance wallpaper store is unavailable');
    const prototype = payload && typeof payload === 'object' ? Object.getPrototypeOf(payload) : null;
    if (!payload || (prototype !== Object.prototype && prototype !== null)) {
      throw new TypeError('wallpaper payload must be a plain object');
    }
    return store.save(payload.dataUrl);
  });
  ipcMain.handle('appearance-wallpaper:clear', async () => {
    const store = getStore();
    if (!store) throw new Error('appearance wallpaper store is unavailable');
    return store.clear();
  });
}

module.exports = {
  MAX_BYTES,
  parseWallpaperDataUrl,
  createAppearanceWallpaperStore,
  registerAppearanceWallpaperIpc
};
