'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CommonLinks = require('../renderer/common-links');
const {
  DEFAULT_UI_PREFERENCES,
  getDefaultUiPreferences,
  normalizeUiPreferences,
  createUiPreferencesStore
} = require('../electron/ui-preferences');

const TODAY = '2026-07-23';
const defaultFavoriteIds = [...CommonLinks.getDefaultFavoriteIds()];

async function makeDirectory(t) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-ui-preferences-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  return directory;
}

function createStore(directory, overrides = {}) {
  return createUiPreferencesStore({
    directory,
    now: () => new Date('2026-07-23T08:00:00.000Z'),
    ...overrides
  });
}

test('default preferences have the complete version 1 shape and are deeply isolated', () => {
  assert.deepEqual(DEFAULT_UI_PREFERENCES, {
    version: 1,
    theme: 'dark',
    view: 'featured',
    domain: '',
    category: '',
    dailyDate: null,
    linksCategory: CommonLinks.ALL_CATEGORY,
    commonLinksFavorites: defaultFavoriteIds,
    realtime: true,
    closeToTray: false
  });

  const first = getDefaultUiPreferences();
  const second = getDefaultUiPreferences();
  first.theme = 'light';
  first.commonLinksFavorites.push('mutated');

  assert.deepEqual(second, DEFAULT_UI_PREFERENCES);
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.commonLinksFavorites, second.commonLinksFavorites);
});

test('normalizes every supported field and discards unknown fields', () => {
  const knownIds = CommonLinks.LINKS.slice(0, 2).map(link => link.id);
  const normalized = normalizeUiPreferences({
    version: 999,
    theme: 'light',
    view: 'daily',
    domain: 'aerospace',
    category: '商业航天',
    dailyDate: TODAY,
    linksCategory: CommonLinks.getCategories()[1],
    commonLinksFavorites: knownIds,
    realtime: false,
    closeToTray: true,
    apiKey: 'must-not-survive',
    unknown: true
  }, { today: TODAY });

  assert.deepEqual(normalized, {
    version: 1,
    theme: 'light',
    view: 'daily',
    domain: 'aerospace',
    category: '商业航天',
    dailyDate: TODAY,
    linksCategory: CommonLinks.getCategories()[1],
    commonLinksFavorites: knownIds,
    realtime: false,
    closeToTray: true
  });
  assert.equal(Object.hasOwn(normalized, 'apiKey'), false);
  assert.equal(Object.hasOwn(normalized, 'unknown'), false);
});

test('invalid scalar values fall back to defaults', () => {
  const normalized = normalizeUiPreferences({
    theme: 'system',
    view: 'archive',
    domain: 'other',
    category: `bad\u0000text`,
    dailyDate: 123,
    linksCategory: 'unknown category',
    realtime: 'yes',
    closeToTray: 'yes'
  }, { today: TODAY });

  assert.deepEqual(normalized, getDefaultUiPreferences());
  assert.equal(normalizeUiPreferences({ category: 'x'.repeat(121) }, { today: TODAY }).category, '');
  assert.equal(normalizeUiPreferences({ category: 'x'.repeat(120) }, { today: TODAY }).category.length, 120);
});

test('closeToTray accepts only booleans and persists atomically', async t => {
  const directory = await makeDirectory(t);
  const store = createStore(directory);
  await store.load();

  assert.equal((await store.update({ closeToTray: true })).closeToTray, true);
  assert.equal(JSON.parse(await fs.promises.readFile(store.file, 'utf8')).closeToTray, true);
  assert.throws(() => store.update({ closeToTray: 'yes' }), /closeToTray.*boolean/i);
});

test('accepts only real non-future YYYY-MM-DD daily dates', () => {
  for (const invalid of [
    '2026-07-24',
    '2026-02-29',
    '2026-02-30',
    '2026-13-01',
    '2026-00-10',
    '2026-7-03',
    'not-a-date'
  ]) {
    assert.equal(
      normalizeUiPreferences({ dailyDate: invalid }, { today: TODAY }).dailyDate,
      null,
      invalid
    );
  }

  assert.equal(
    normalizeUiPreferences({ dailyDate: '2024-02-29' }, { today: TODAY }).dailyDate,
    '2024-02-29'
  );
  assert.equal(
    normalizeUiPreferences({ dailyDate: TODAY }, { today: TODAY }).dailyDate,
    TODAY
  );
});

test('favorite IDs are filtered to known strings and deduplicated in original order', () => {
  const [first, second] = CommonLinks.LINKS;
  assert.deepEqual(
    normalizeUiPreferences({
      commonLinksFavorites: [second.id, 'unknown', second.id, 42, first.id]
    }, { today: TODAY }).commonLinksFavorites,
    [second.id, first.id]
  );
});

test('non-array favorite storage falls back to a fresh default list', () => {
  const one = normalizeUiPreferences({ commonLinksFavorites: 'broken' }, { today: TODAY });
  const two = normalizeUiPreferences({ commonLinksFavorites: null }, { today: TODAY });

  assert.deepEqual(one.commonLinksFavorites, defaultFavoriteIds);
  assert.deepEqual(two.commonLinksFavorites, defaultFavoriteIds);
  one.commonLinksFavorites.push('mutated');
  assert.deepEqual(two.commonLinksFavorites, defaultFavoriteIds);
});

test('oversized favorite arrays normalize to defaults without iteration', () => {
  const oversized = [];
  oversized.length = CommonLinks.LINKS.length + 1;
  oversized[0] = CommonLinks.LINKS[0].id;
  Object.defineProperty(oversized, Symbol.iterator, {
    get() {
      throw new Error('oversized favorite array was iterated');
    }
  });

  assert.deepEqual(
    normalizeUiPreferences({ commonLinksFavorites: oversized }, { today: TODAY }).commonLinksFavorites,
    defaultFavoriteIds
  );
});

test('load treats oversized favorite arrays as corrupt storage', async t => {
  const directory = await makeDirectory(t);
  const store = createStore(directory);
  const oversized = Array(CommonLinks.LINKS.length + 1).fill(null);
  oversized[0] = CommonLinks.LINKS[0].id;
  await fs.promises.writeFile(store.file, JSON.stringify({
    commonLinksFavorites: oversized
  }), 'utf8');

  const loaded = await store.load();

  assert.deepEqual(loaded.commonLinksFavorites, defaultFavoriteIds);
});

test('update synchronously rejects dense and sparse oversized favorite arrays', async t => {
  const directory = await makeDirectory(t);
  const store = createStore(directory, {
    rename: async temporary => fs.promises.rm(temporary, { force: true })
  });
  const dense = Array(CommonLinks.LINKS.length + 1).fill(CommonLinks.LINKS[0].id);
  const sparse = [];
  sparse.length = CommonLinks.LINKS.length + 5;

  async function captureSynchronousError(value) {
    let error;
    let pending;
    try {
      pending = store.update({ commonLinksFavorites: value });
    } catch (caught) {
      error = caught;
    }
    await pending?.catch(() => {});
    return error;
  }

  for (const value of [dense, sparse]) {
    const error = await captureSynchronousError(value);
    assert.match(
      error?.message || '',
      /commonLinksFavorites.*at most|commonLinksFavorites.*最多/i
    );
  }
});

test('missing and corrupt files load defaults without writing or deleting anything', async t => {
  const missingDirectory = await makeDirectory(t);
  const missingStore = createStore(missingDirectory);

  assert.deepEqual(await missingStore.load(), getDefaultUiPreferences());
  assert.equal(missingStore.hasStoredPreferences(), false);
  assert.equal(fs.existsSync(missingStore.file), false);

  const corruptDirectory = await makeDirectory(t);
  const corruptStore = createStore(corruptDirectory);
  await fs.promises.writeFile(corruptStore.file, '{not valid json', 'utf8');

  assert.deepEqual(await corruptStore.load(), getDefaultUiPreferences());
  assert.equal(corruptStore.hasStoredPreferences(), false);
  assert.equal(await fs.promises.readFile(corruptStore.file, 'utf8'), '{not valid json');
});

test('valid JSON files are normalized and marked as stored', async t => {
  const directory = await makeDirectory(t);
  const store = createStore(directory);
  await fs.promises.writeFile(store.file, JSON.stringify({
    theme: 'light',
    commonLinksFavorites: [],
    unknown: 'discard'
  }), 'utf8');

  const loaded = await store.load();

  assert.equal(store.hasStoredPreferences(), true);
  assert.equal(loaded.theme, 'light');
  assert.deepEqual(loaded.commonLinksFavorites, []);
  assert.equal(Object.hasOwn(loaded, 'unknown'), false);
});

test('snapshots cannot mutate store state', async t => {
  const directory = await makeDirectory(t);
  const store = createStore(directory);
  await store.load();

  const snapshot = store.getSnapshot();
  snapshot.theme = 'light';
  snapshot.commonLinksFavorites.push('mutated');

  assert.deepEqual(store.getSnapshot(), getDefaultUiPreferences());
});

test('update rejects non-plain patches, unknown fields, and invalid explicit values', async t => {
  const directory = await makeDirectory(t);
  const store = createStore(directory);
  await store.load();

  for (const patch of [null, [], new Date(), 'theme']) {
    assert.throws(() => store.update(patch), /plain object|普通对象/i);
  }
  assert.throws(() => store.update({ apiKey: 'sk-secret' }), /unknown|不支持.*apiKey/i);
  assert.throws(() => store.update({ [Symbol('secret')]: true }), /unknown|不支持/i);
  assert.throws(() => store.update({ theme: 'system' }), /theme/i);
  assert.throws(() => store.update({ version: 2 }), /version/i);
  assert.throws(() => store.update({ dailyDate: '2026-07-24' }), /dailyDate/i);
  assert.throws(() => store.update({ commonLinksFavorites: 'broken' }), /commonLinksFavorites/i);
  assert.throws(() => store.update({ closeToTray: 'yes' }), /closeToTray.*boolean/i);
  assert.equal(fs.existsSync(store.file), false);
});

test('rapid updates merge immediately in memory and serialize complete snapshots', async t => {
  const directory = await makeDirectory(t);
  const originalWriteFile = fs.promises.writeFile;
  const observedModes = [];
  const store = createStore(directory, {
    writeFile: async (target, content, options) => {
      if (path.dirname(target) === directory && target.endsWith('.tmp')) {
        observedModes.push(options?.mode);
      }
      return originalWriteFile(target, content, options);
    }
  });
  await store.load();

  const firstWrite = store.update({ theme: 'light' });
  assert.equal(store.getSnapshot().theme, 'light');
  const secondWrite = store.update({ view: 'all' });
  assert.deepEqual(
    { theme: store.getSnapshot().theme, view: store.getSnapshot().view },
    { theme: 'light', view: 'all' }
  );

  await Promise.all([firstWrite, secondWrite]);

  const saved = JSON.parse(await fs.promises.readFile(store.file, 'utf8'));
  assert.equal(saved.theme, 'light');
  assert.equal(saved.view, 'all');
  assert.equal(saved.version, 1);
  assert.equal(store.hasStoredPreferences(), true);
  assert.deepEqual(await fs.promises.readdir(directory), ['ui-preferences.json']);
  assert.deepEqual(observedModes, [0o600, 0o600]);
});

test('atomic replacement failure preserves the prior file and cleans temporary files', async t => {
  const directory = await makeDirectory(t);
  const baseline = JSON.stringify({
    ...getDefaultUiPreferences(),
    theme: 'dark'
  }, null, 2);
  const file = path.join(directory, 'ui-preferences.json');
  await fs.promises.writeFile(file, baseline, 'utf8');
  const store = createStore(directory, {
    rename: async () => {
      throw new Error('injected atomic rename failure');
    }
  });
  await store.load();

  await assert.rejects(store.update({ theme: 'light' }), /injected atomic rename failure/);

  assert.equal(store.getSnapshot().theme, 'light');
  assert.equal(store.hasStoredPreferences(), true);
  assert.equal(await fs.promises.readFile(file, 'utf8'), baseline);
  assert.deepEqual(await fs.promises.readdir(directory), ['ui-preferences.json']);
});

test('write queue recovers after one rename failure and persists the latest complete snapshot', async t => {
  const directory = await makeDirectory(t);
  let renameCalls = 0;
  const store = createStore(directory, {
    rename: async (temporary, destination) => {
      renameCalls += 1;
      if (renameCalls === 1) throw new Error('injected first rename failure');
      await fs.promises.rename(temporary, destination);
    }
  });
  await store.load();

  const firstWrite = store.update({ theme: 'light' });
  const secondWrite = store.update({ view: 'all' });

  await assert.rejects(firstWrite, /injected first rename failure/);
  await secondWrite;

  assert.equal(renameCalls, 2);
  assert.deepEqual(
    JSON.parse(await fs.promises.readFile(store.file, 'utf8')),
    {
      ...getDefaultUiPreferences(),
      theme: 'light',
      view: 'all'
    }
  );
  assert.equal(store.hasStoredPreferences(), true);
  assert.deepEqual(await fs.promises.readdir(directory), ['ui-preferences.json']);
});
