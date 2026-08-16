'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseWallpaperDataUrl,
  createAppearanceWallpaperStore,
  registerAppearanceWallpaperIpc
} = require('../electron/appearance-wallpaper');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const JPEG_URL = `data:image/jpeg;base64,${JPEG.toString('base64')}`;

async function makeDirectory(t) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-wallpaper-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('wallpaper data URL parser accepts only bounded raster images with matching signatures', () => {
  const parsed = parseWallpaperDataUrl(JPEG_URL);
  assert.equal(parsed.mime, 'image/jpeg');
  assert.deepEqual(parsed.payload, JPEG);

  assert.throws(() => parseWallpaperDataUrl('data:image/svg+xml;base64,PHN2Zz4='), /JPEG, PNG or WebP/);
  assert.throws(() => parseWallpaperDataUrl('data:image/jpeg;base64,SGVsbG8='), /signature/);
  assert.throws(() => parseWallpaperDataUrl('https://example.com/wallpaper.jpg'), /JPEG, PNG or WebP/);
});

test('wallpaper store writes outside preferences, restores safely, and clears the asset', async t => {
  const directory = await makeDirectory(t);
  const store = createAppearanceWallpaperStore({ directory });

  assert.equal(await store.load(), '');
  const saved = await store.save(JPEG_URL);
  assert.deepEqual(saved, { stored: true, mime: 'image/jpeg', bytes: JPEG.length });
  assert.equal(await store.load(), JPEG_URL);
  assert.equal(path.dirname(store.file), path.join(directory, 'appearance'));
  assert.equal((await fs.promises.stat(store.file)).isFile(), true);

  assert.deepEqual(await store.clear(), { stored: false });
  assert.equal(await store.load(), '');
});

test('corrupt on-disk wallpaper is ignored instead of reaching the renderer', async t => {
  const directory = await makeDirectory(t);
  const store = createAppearanceWallpaperStore({ directory });
  await fs.promises.mkdir(path.dirname(store.file), { recursive: true });
  await fs.promises.writeFile(store.file, 'image/jpeg\nnot-a-jpeg');
  assert.equal(await store.load(), '');
});

test('appearance wallpaper IPC exposes only get/save/clear and validates availability', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
  const calls = [];
  let store = null;
  registerAppearanceWallpaperIpc({ ipcMain, getStore: () => store });

  assert.deepEqual([...handlers.keys()], [
    'appearance-wallpaper:get',
    'appearance-wallpaper:save',
    'appearance-wallpaper:clear'
  ]);
  assert.equal(await handlers.get('appearance-wallpaper:get')(), '');
  await assert.rejects(
    handlers.get('appearance-wallpaper:save')({}, { dataUrl: JPEG_URL }),
    /unavailable/
  );

  store = {
    load: async () => JPEG_URL,
    save: async value => { calls.push(['save', value]); return { stored: true }; },
    clear: async () => { calls.push(['clear']); return { stored: false }; }
  };
  assert.equal(await handlers.get('appearance-wallpaper:get')(), JPEG_URL);
  assert.deepEqual(
    await handlers.get('appearance-wallpaper:save')({}, { dataUrl: JPEG_URL }),
    { stored: true }
  );
  assert.deepEqual(await handlers.get('appearance-wallpaper:clear')(), { stored: false });
  assert.deepEqual(calls, [['save', JPEG_URL], ['clear']]);
  await assert.rejects(
    handlers.get('appearance-wallpaper:save')({}, []),
    /plain object/
  );
});

test('appearance wallpaper factories reject incomplete dependency injection', () => {
  assert.throws(() => createAppearanceWallpaperStore(), /directory/);
  assert.throws(() => registerAppearanceWallpaperIpc(), /ipcMain/);
  assert.throws(
    () => registerAppearanceWallpaperIpc({ ipcMain: { handle() {} } }),
    /getStore/
  );
});
