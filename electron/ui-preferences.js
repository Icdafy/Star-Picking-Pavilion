'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const CommonLinks = require('../renderer/common-links');
const UiPreferenceSchema = require('../renderer/ui-preference-schema');

const ALLOWED_FIELDS = new Set([
  'version',
  ...UiPreferenceSchema.UI_PREFERENCE_FIELDS
]);
const schemaDefaults = UiPreferenceSchema.getDefaultUiPreferences(CommonLinks);
const DEFAULT_UI_PREFERENCES = Object.freeze({
  version: 1,
  ...schemaDefaults,
  commonLinksFavorites: Object.freeze([...schemaDefaults.commonLinksFavorites])
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

function formatLocalDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError('now must return a valid Date');
  }
  return UiPreferenceSchema.formatLocalDate(value);
}

function normalizeUiPreferences(raw, { today } = {}) {
  return {
    version: 1,
    ...UiPreferenceSchema.normalizeUiPreferences(raw, CommonLinks, { today })
  };
}

function validatePatch(patch, today) {
  if (!UiPreferenceSchema.isPlainObject(patch)) {
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
  if (
    Object.hasOwn(patch, 'theme')
    && !UiPreferenceSchema.isValidUiPreferenceValue('theme', patch.theme, CommonLinks, { today })
  ) {
    throw new TypeError('theme must be light or dark');
  }
  if (
    Object.hasOwn(patch, 'view')
    && !UiPreferenceSchema.isValidUiPreferenceValue('view', patch.view, CommonLinks, { today })
  ) {
    throw new TypeError('view is not supported');
  }
  if (
    Object.hasOwn(patch, 'domain')
    && !UiPreferenceSchema.isValidUiPreferenceValue('domain', patch.domain, CommonLinks, { today })
  ) {
    throw new TypeError('domain is not supported');
  }
  if (
    Object.hasOwn(patch, 'category')
    && !UiPreferenceSchema.isValidUiPreferenceValue('category', patch.category, CommonLinks, { today })
  ) {
    throw new TypeError('category must be control-free text of at most 120 characters');
  }
  if (
    Object.hasOwn(patch, 'dailyDate')
    && !UiPreferenceSchema.isValidUiPreferenceValue(
      'dailyDate',
      patch.dailyDate,
      CommonLinks,
      { today }
    )
  ) {
    throw new TypeError('dailyDate must be a real, non-future YYYY-MM-DD date or null');
  }
  if (
    Object.hasOwn(patch, 'linksCategory')
    && !UiPreferenceSchema.isValidUiPreferenceValue(
      'linksCategory',
      patch.linksCategory,
      CommonLinks,
      { today }
    )
  ) {
    throw new TypeError('linksCategory is not supported');
  }
  if (Object.hasOwn(patch, 'commonLinksFavorites')) {
    if (!Array.isArray(patch.commonLinksFavorites)) {
      throw new TypeError('commonLinksFavorites must be an array');
    }
    if (!UiPreferenceSchema.isValidUiPreferenceValue(
      'commonLinksFavorites',
      patch.commonLinksFavorites,
      CommonLinks,
      { today }
    )) {
      throw new TypeError(
        `commonLinksFavorites must contain at most ${CommonLinks.LINKS.length} items`
      );
    }
  }
  if (
    Object.hasOwn(patch, 'realtime')
    && !UiPreferenceSchema.isValidUiPreferenceValue('realtime', patch.realtime, CommonLinks, { today })
  ) {
    throw new TypeError('realtime must be a boolean');
  }
}

function createUiPreferencesStore({
  directory,
  now = () => new Date(),
  writeFile = fs.promises.writeFile,
  rename = fs.promises.rename
} = {}) {
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new TypeError('directory is required');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (typeof writeFile !== 'function') throw new TypeError('writeFile must be a function');
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
      await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
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
