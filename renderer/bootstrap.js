'use strict';

(function exposeBootstrap(root, factory) {
  const schema = typeof module === 'object' && module.exports
    ? require('./ui-preference-schema')
    : root?.StarPickingPavilionUiPreferenceSchema;
  const api = factory(schema);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else if (root) {
    root.StarPickingPavilionBootstrap = api;
    api.initializeTheme(
      api.getSafeStorage(root),
      root.document,
      root.starPickingPavilion?.preferences
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBootstrap(Schema) {
  if (!Schema) throw new Error('UI preference schema is required');
  const STORAGE_KEYS = Object.freeze({
    theme: 'star-picking-pavilion.theme',
    realtime: 'star-picking-pavilion.realtime',
    commonLinksFavorites: 'star-picking-pavilion.common-links.favorites',
    uiPreferences: 'star-picking-pavilion.ui-preferences'
  });
  const LEGACY_STORAGE_KEYS = Object.freeze({
    theme: Object.freeze(['wc-theme']),
    realtime: Object.freeze(['wc-realtime']),
    commonLinksFavorites: Object.freeze(['zxg-common-links-favorites'])
  });

  function getSafeStorage(root) {
    if (!root) return null;
    try {
      return root.localStorage || null;
    } catch {
      return null;
    }
  }

  function migrateStorage(storage, currentKey, legacyKeys, validate = value => value != null) {
    if (!storage || typeof storage.getItem !== 'function') return null;
    const current = storage.getItem(currentKey);
    if (current != null) return current;
    for (const key of legacyKeys) {
      const value = storage.getItem(key);
      if (validate(value)) {
        if (typeof storage.setItem === 'function') storage.setItem(currentKey, value);
        return value;
      }
    }
    return null;
  }

  function readBrowserUiPreferences(storage) {
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_KEYS.uiPreferences));
      return Schema.isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function readLegacyUiPreferences(storage, commonLinks) {
    const legacy = {};
    try {
      const theme = migrateStorage(
        storage,
        STORAGE_KEYS.theme,
        LEGACY_STORAGE_KEYS.theme,
        value => Schema.isValidUiPreferenceValue('theme', value, commonLinks)
      );
      if (Schema.isValidUiPreferenceValue('theme', theme, commonLinks)) {
        legacy.theme = theme;
      }
    } catch { /* localStorage may be unavailable */ }
    try {
      const realtime = migrateStorage(
        storage,
        STORAGE_KEYS.realtime,
        LEGACY_STORAGE_KEYS.realtime,
        value => value === 'on' || value === 'off'
      );
      if (realtime === 'on' || realtime === 'off') legacy.realtime = realtime === 'on';
    } catch { /* localStorage may be unavailable */ }
    try {
      const serialized = migrateStorage(
        storage,
        commonLinks.STORAGE_KEY,
        commonLinks.LEGACY_STORAGE_KEYS,
        commonLinks.isValidFavoriteStorage
      );
      if (commonLinks.isValidFavoriteStorage(serialized)) {
        const candidate = Schema.normalizeFavoriteCandidate(JSON.parse(serialized), commonLinks);
        if (candidate) legacy.commonLinksFavorites = candidate;
      }
    } catch { /* localStorage may be unavailable */ }
    return legacy;
  }

  function cloneUiPreferences(preferences) {
    return {
      ...preferences,
      commonLinksFavorites: [...preferences.commonLinksFavorites]
    };
  }

  function resolveInitialUiPreferences({ desktop, storage, commonLinks, today } = {}) {
    if (!commonLinks) throw new TypeError('commonLinks is required');
    if (desktop && desktop.hasStoredPreferences === true) {
      return {
        preferences: Schema.normalizeUiPreferences(desktop.preferences, commonLinks, { today }),
        migrationPatch: null
      };
    }

    const legacy = readLegacyUiPreferences(storage, commonLinks);
    if (desktop) {
      const preferences = Schema.normalizeUiPreferences(
        {},
        commonLinks,
        { today, fallback: legacy }
      );
      return {
        preferences,
        migrationPatch: cloneUiPreferences(preferences)
      };
    }

    return {
      preferences: Schema.normalizeUiPreferences(
        readBrowserUiPreferences(storage),
        commonLinks,
        { today, fallback: legacy }
      ),
      migrationPatch: null
    };
  }

  function createUiPreferenceActions({ commonLinks, persist, today } = {}) {
    if (!commonLinks) throw new TypeError('commonLinks is required');
    if (typeof persist !== 'function') throw new TypeError('persist must be a function');

    function remember(field, value) {
      const patch = Schema.createUiPreferencePatch(field, value, commonLinks, {
        today: typeof today === 'function' ? today() : today
      });
      if (Object.keys(patch).length === 0) return null;
      return persist(patch);
    }

    return Object.freeze({ remember });
  }

  function writeBrowserUiPreferences(storage, patch, commonLinks, options) {
    const current = Schema.sanitizeUiPreferencesPatch(
      readBrowserUiPreferences(storage),
      commonLinks,
      options
    );
    const sanitized = Schema.sanitizeUiPreferencesPatch(patch, commonLinks, options);
    const next = { ...current, ...sanitized };
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(STORAGE_KEYS.uiPreferences, JSON.stringify(next));
    }
    return next;
  }

  function createLatestRequestGuard() {
    let latest = 0;
    return Object.freeze({
      begin() {
        const token = ++latest;
        return Object.freeze({
          isCurrent: () => token === latest,
          commit(action) {
            if (token !== latest) return false;
            action();
            return true;
          }
        });
      }
    });
  }

  function resolveDynamicCategory(category, availableCategories) {
    if (
      category
      && Array.isArray(availableCategories)
      && !availableCategories.includes(category)
    ) {
      return { category: '', patch: { category: '' } };
    }
    return { category, patch: null };
  }

  function initializeTheme(storage, document, desktopPreferences) {
    let theme = null;
    if (
      desktopPreferences
      && Schema.isValidUiPreferenceValue('theme', desktopPreferences.theme)
    ) {
      theme = desktopPreferences.theme;
    } else {
      try {
        const browserTheme = readBrowserUiPreferences(storage).theme;
        const validTheme = value => Schema.isValidUiPreferenceValue('theme', value);
        theme = validTheme(browserTheme)
          ? browserTheme
          : migrateStorage(
            storage,
            STORAGE_KEYS.theme,
            LEGACY_STORAGE_KEYS.theme,
            validTheme
          );
      } catch { /* localStorage may be unavailable; retain the safe default */ }
    }
    if (theme !== 'light' && theme !== 'dark') theme = 'dark';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    return theme;
  }

  return Object.freeze({
    STORAGE_KEYS,
    LEGACY_STORAGE_KEYS,
    getSafeStorage,
    migrateStorage,
    initializeTheme,
    readBrowserUiPreferences,
    normalizeUiPreferences: Schema.normalizeUiPreferences,
    resolveInitialUiPreferences,
    createUiPreferencePatch: Schema.createUiPreferencePatch,
    sanitizeUiPreferencesPatch: Schema.sanitizeUiPreferencesPatch,
    createUiPreferenceActions,
    writeBrowserUiPreferences,
    resolveDynamicCategory,
    createLatestRequestGuard
  });
});
