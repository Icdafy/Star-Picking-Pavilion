'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Schema = require('../renderer/ui-preference-schema');
const Bootstrap = require('../renderer/bootstrap');
const CommonLinks = require('../renderer/common-links');
const { createUiPreferencesStore } = require('../electron/ui-preferences');

const baseline = {
  pointerEnabled: true, pointerStyle: 'glow', pointerSize: 320,
  pointerCometSize: 240, pointerStarsSize: 6, pointerRingSize: 40, pointerColor: '#8b5cf6', pointerOpacity: 100,
  theme: 'light', textScale: 'md', aquaMode: 'mica', aquaEnabled: false,
  aquaBlur: 2, aquaFrost: 20, aquaHue: 40, aquaBrightness: 42,
  aquaBackground: 'fluid', aquaWallpaperBlur: 0, aquaWallpaperFrost: 0,
  aquaWhale: false, aquaCritters: false, view: 'featured', domain: '', category: '',
  dailyDate: null, linksCategory: '督办计划', commonLinksFavorites: [],
  realtime: true, closeToTray: false
};

function storage(values = {}) {
  const data = new Map(Object.entries(values));
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

test('new profiles use the approved local baseline, saved profiles retain every choice and file bytes', async t => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-v028-preferences-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const fresh = createUiPreferencesStore({ directory });
  assert.deepEqual(await fresh.load(), { version: 2, ...baseline });
  assert.equal(fresh.hasStoredPreferences(), false);
  const old = {
    version: 2, ...Schema.getLegacyUiPreferences(CommonLinks), theme: 'dark', textScale: 'xl',
    aquaMode: 'compat', aquaHue: 260, aquaBrightness: 38, aquaBlur: 12,
    aquaFrost: 60, aquaWallpaperBlur: 7, aquaWallpaperFrost: 30, aquaBackground: 'wallpaper',
    aquaEnabled: true, aquaWhale: false, aquaCritters: true, view: 'links', domain: 'aerospace',
    linksCategory: 'AI', commonLinksFavorites: [], realtime: false, closeToTray: true
  };
  const serialized = JSON.stringify(old, null, 4);
  await fs.promises.writeFile(fresh.file, serialized);
  const upgraded = createUiPreferencesStore({ directory });
  assert.deepEqual(await upgraded.load(), old);
  assert.equal(upgraded.hasStoredPreferences(), true);
  assert.equal(await fs.promises.readFile(fresh.file, 'utf8'), serialized);
  assert.deepEqual(Bootstrap.resolveInitialUiPreferences({
    desktop: { hasStoredPreferences: true, preferences: upgraded.getSnapshot() },
    storage: storage({ [Bootstrap.STORAGE_KEYS.uiPreferences]: JSON.stringify(baseline) }),
    commonLinks: CommonLinks
  }), { preferences: Object.fromEntries(Object.entries(old).filter(([key]) => key !== 'version')), migrationPatch: null });
});

test('old partial snapshots keep the previous implicit defaults instead of applying the new baseline', async t => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-v028-legacy-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const store = createUiPreferencesStore({ directory });
  await fs.promises.writeFile(store.file, JSON.stringify({ version: 1, theme: 'dark', realtime: false }));
  assert.deepEqual(await store.load(), {
    version: 2, ...Schema.getLegacyUiPreferences(CommonLinks), realtime: false
  });
});

test('desktop migration retains modern browser preferences including false, zero and empty favorites', () => {
  const choices = { version: 2, theme: 'dark', textScale: 'xl', aquaEnabled: false,
    aquaHue: 0, aquaBrightness: 0, aquaBlur: 0, aquaWhale: false, commonLinksFavorites: [], realtime: false };
  const result = Bootstrap.resolveInitialUiPreferences({
    desktop: { hasStoredPreferences: false, preferences: baseline },
    storage: storage({ [Bootstrap.STORAGE_KEYS.uiPreferences]: JSON.stringify(choices), 'wc-theme': 'light' }),
    commonLinks: CommonLinks
  });
  const { version, ...explicit } = choices;
  assert.deepEqual(result.preferences, { ...Schema.getLegacyUiPreferences(CommonLinks), ...explicit });
  assert.deepEqual(result.migrationPatch, result.preferences);
  assert.notStrictEqual(result.migrationPatch.commonLinksFavorites, result.preferences.commonLinksFavorites);
  const fresh = Bootstrap.resolveInitialUiPreferences({
    desktop: { hasStoredPreferences: false, preferences: baseline }, storage: storage(), commonLinks: CommonLinks
  });
  assert.deepEqual(fresh.preferences, baseline);
});

test('head bootstrap restores a legacy dark theme before paint when the native file does not exist', () => {
  const context = vm.createContext({
    localStorage: storage({ 'wc-theme': 'dark' }),
    document: { documentElement: { dataset: {}, style: {} } },
    starPickingPavilion: { hasStoredPreferences: false, preferences: baseline }
  });
  for (const file of ['ui-preference-schema.js', 'bootstrap.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer', file), 'utf8'), context);
  }
  assert.equal(context.document.documentElement.dataset.theme, 'dark');
  assert.equal(context.document.documentElement.style.colorScheme, 'dark');
});
