'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const CommonLinks = require('../renderer/common-links');

const THEMES = new Set(['light', 'dark']);
const VIEWS = new Set(['featured', 'hot', 'all', 'daily', 'links', 'sources', 'settings']);
const DOMAINS = new Set(['', 'lowaltitude', 'aerospace']);
const LINK_CATEGORIES = new Set(CommonLinks.getCategories());
const LINK_IDS = new Set(CommonLinks.LINKS.map(link => link.id));
const ALLOWED_FIELDS = new Set([
  'version',
  'theme',
  'view',
  'domain',
  'category',
  'dailyDate',
  'linksCategory',
  'commonLinksFavorites',
  'realtime'
]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

const DEFAULT_UI_PREFERENCES = Object.freeze({
  version: 1,
  theme: 'dark',
  view: 'featured',
  domain: '',
  category: '',
  dailyDate: null,
  linksCategory: CommonLinks.ALL_CATEGORY,
  commonLinksFavorites: Object.freeze([...CommonLinks.getDefaultFavoriteIds()]),
  realtime: true
});

function clonePreferences(preferences) {
  return {
    ...preferences,
    commonLinksFavorites: [...preferences.commonLinksFavorites]
  };
}

function getDefaultUiPreferences() {
  return clonePreferences(DEFAULT_UI_PREFERENCES);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isValidCategory(value) {
  return typeof value === 'string'
    && Array.from(value).length <= 120
    && !CONTROL_CHARACTERS.test(value);
}

function isRealDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1) return false;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function formatLocalDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError('now must return a valid Date');
  }
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveToday(today) {
  return isRealDateString(today) ? today : formatLocalDate(new Date());
}

function normalizeFavoriteIds(value) {
  if (!Array.isArray(value)) return [...CommonLinks.getDefaultFavoriteIds()];
  const seen = new Set();
  const normalized = [];
  for (const id of value) {
    if (typeof id !== 'string' || !LINK_IDS.has(id) || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

function normalizeUiPreferences(raw, { today } = {}) {
  const source = isPlainObject(raw) ? raw : {};
  const cutoff = resolveToday(today);
  return {
    version: 1,
    theme: THEMES.has(source.theme) ? source.theme : DEFAULT_UI_PREFERENCES.theme,
    view: VIEWS.has(source.view) ? source.view : DEFAULT_UI_PREFERENCES.view,
    domain: DOMAINS.has(source.domain) ? source.domain : DEFAULT_UI_PREFERENCES.domain,
    category: isValidCategory(source.category) ? source.category : DEFAULT_UI_PREFERENCES.category,
    dailyDate: isRealDateString(source.dailyDate) && source.dailyDate <= cutoff
      ? source.dailyDate
      : DEFAULT_UI_PREFERENCES.dailyDate,
    linksCategory: LINK_CATEGORIES.has(source.linksCategory)
      ? source.linksCategory
      : DEFAULT_UI_PREFERENCES.linksCategory,
    commonLinksFavorites: normalizeFavoriteIds(source.commonLinksFavorites),
    realtime: typeof source.realtime === 'boolean'
      ? source.realtime
      : DEFAULT_UI_PREFERENCES.realtime
  };
}

function validatePatch(patch, today) {
  if (!isPlainObject(patch)) {
    throw new TypeError('UI preferences patch must be a plain object');
  }

  for (const field of Reflect.ownKeys(patch)) {
    if (!ALLOWED_FIELDS.has(field)) {
      throw new TypeError(`Unknown UI preference field: ${String(field)}`);
    }
  }

  if (Object.hasOwn(patch, 'version') && patch.version !== 1) {
    throw new TypeError('version must be 1');
  }
  if (Object.hasOwn(patch, 'theme') && !THEMES.has(patch.theme)) {
    throw new TypeError('theme must be light or dark');
  }
  if (Object.hasOwn(patch, 'view') && !VIEWS.has(patch.view)) {
    throw new TypeError('view is not supported');
  }
  if (Object.hasOwn(patch, 'domain') && !DOMAINS.has(patch.domain)) {
    throw new TypeError('domain is not supported');
  }
  if (Object.hasOwn(patch, 'category') && !isValidCategory(patch.category)) {
    throw new TypeError('category must be control-free text of at most 120 characters');
  }
  if (
    Object.hasOwn(patch, 'dailyDate')
    && patch.dailyDate !== null
    && (!isRealDateString(patch.dailyDate) || patch.dailyDate > today)
  ) {
    throw new TypeError('dailyDate must be a real, non-future YYYY-MM-DD date or null');
  }
  if (Object.hasOwn(patch, 'linksCategory') && !LINK_CATEGORIES.has(patch.linksCategory)) {
    throw new TypeError('linksCategory is not supported');
  }
  if (Object.hasOwn(patch, 'commonLinksFavorites') && !Array.isArray(patch.commonLinksFavorites)) {
    throw new TypeError('commonLinksFavorites must be an array');
  }
  if (Object.hasOwn(patch, 'realtime') && typeof patch.realtime !== 'boolean') {
    throw new TypeError('realtime must be a boolean');
  }
}

function createUiPreferencesStore({
  directory,
  now = () => new Date(),
  rename = fs.promises.rename
} = {}) {
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new TypeError('directory is required');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (typeof rename !== 'function') throw new TypeError('rename must be a function');

  const file = path.join(directory, 'ui-preferences.json');
  let preferences = getDefaultUiPreferences();
  let storedPreferences = false;
  let writeQueue = Promise.resolve();

  function today() {
    return formatLocalDate(now());
  }

  async function load() {
    let serialized;
    try {
      serialized = await fs.promises.readFile(file, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      preferences = getDefaultUiPreferences();
      storedPreferences = false;
      return clonePreferences(preferences);
    }

    let parsed;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      preferences = getDefaultUiPreferences();
      storedPreferences = false;
      return clonePreferences(preferences);
    }

    preferences = normalizeUiPreferences(parsed, { today: today() });
    storedPreferences = true;
    return clonePreferences(preferences);
  }

  function getSnapshot() {
    return clonePreferences(preferences);
  }

  function hasStoredPreferences() {
    return storedPreferences;
  }

  async function writeSnapshot(snapshot) {
    await fs.promises.mkdir(directory, { recursive: true });
    const temporary = path.join(
      directory,
      `.ui-preferences.${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`
    );
    try {
      await fs.promises.writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, file);
    } catch (error) {
      await fs.promises.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  function update(patch) {
    const cutoff = today();
    validatePatch(patch, cutoff);
    preferences = normalizeUiPreferences({ ...preferences, ...patch }, { today: cutoff });
    const snapshot = clonePreferences(preferences);
    const operation = writeQueue
      .catch(() => {})
      .then(() => writeSnapshot(snapshot));
    writeQueue = operation;
    return operation.then(() => {
      storedPreferences = true;
      return clonePreferences(snapshot);
    });
  }

  return Object.freeze({
    file,
    load,
    getSnapshot,
    hasStoredPreferences,
    update
  });
}

module.exports = {
  DEFAULT_UI_PREFERENCES,
  getDefaultUiPreferences,
  normalizeUiPreferences,
  createUiPreferencesStore
};
