'use strict';

(function exposeBootstrap(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else if (root) {
    root.StarPickingPavilionBootstrap = api;
    api.initializeTheme(
      root.localStorage,
      root.document,
      root.starPickingPavilion?.preferences
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBootstrap() {
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
  const THEMES = new Set(['light', 'dark']);
  const VIEWS = new Set(['featured', 'hot', 'all', 'daily', 'links', 'sources', 'settings']);
  const DOMAINS = new Set(['', 'lowaltitude', 'aerospace']);
  const UI_PREFERENCE_FIELDS = Object.freeze([
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

  function migrateStorage(storage, currentKey, legacyKeys, validate = value => value != null) {
    const current = storage.getItem(currentKey);
    if (current != null) return current;
    for (const key of legacyKeys) {
      const value = storage.getItem(key);
      if (validate(value)) {
        storage.setItem(currentKey, value);
        return value;
      }
    }
    return null;
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

  function localDateString(date = new Date()) {
    const year = String(date.getFullYear()).padStart(4, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function resolveToday(today) {
    return isRealDateString(today) ? today : localDateString();
  }

  function readBrowserUiPreferences(storage) {
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_KEYS.uiPreferences));
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function getDefaultUiPreferences(commonLinks) {
    return {
      theme: 'dark',
      view: 'featured',
      domain: '',
      category: '',
      dailyDate: null,
      linksCategory: commonLinks.ALL_CATEGORY,
      commonLinksFavorites: [...commonLinks.getDefaultFavoriteIds()],
      realtime: true
    };
  }

  function getValidFavoriteIds(value, commonLinks) {
    if (!Array.isArray(value)) return null;
    try {
      return [...commonLinks.parseFavoriteIds(JSON.stringify(value))];
    } catch {
      return null;
    }
  }

  function chooseValue(primary, fallback, validate, defaultValue) {
    if (validate(primary)) return primary;
    if (validate(fallback)) return fallback;
    return defaultValue;
  }

  function normalizeUiPreferences(raw, commonLinks, { today, fallback } = {}) {
    const source = isPlainObject(raw) ? raw : {};
    const secondary = isPlainObject(fallback) ? fallback : {};
    const defaults = getDefaultUiPreferences(commonLinks);
    const cutoff = resolveToday(today);
    const linkCategories = new Set(commonLinks.getCategories());
    const primaryFavorites = getValidFavoriteIds(source.commonLinksFavorites, commonLinks);
    const fallbackFavorites = getValidFavoriteIds(secondary.commonLinksFavorites, commonLinks);

    return {
      theme: chooseValue(source.theme, secondary.theme, value => THEMES.has(value), defaults.theme),
      view: chooseValue(source.view, secondary.view, value => VIEWS.has(value), defaults.view),
      domain: chooseValue(source.domain, secondary.domain, value => DOMAINS.has(value), defaults.domain),
      category: chooseValue(
        source.category,
        secondary.category,
        isValidCategory,
        defaults.category
      ),
      dailyDate: chooseValue(
        source.dailyDate,
        secondary.dailyDate,
        value => value === null || (isRealDateString(value) && value <= cutoff),
        defaults.dailyDate
      ),
      linksCategory: chooseValue(
        source.linksCategory,
        secondary.linksCategory,
        value => linkCategories.has(value),
        defaults.linksCategory
      ),
      commonLinksFavorites: primaryFavorites || fallbackFavorites || defaults.commonLinksFavorites,
      realtime: chooseValue(
        source.realtime,
        secondary.realtime,
        value => typeof value === 'boolean',
        defaults.realtime
      )
    };
  }

  function readLegacyUiPreferences(storage, commonLinks) {
    const legacy = {};
    try {
      const theme = migrateStorage(
        storage,
        STORAGE_KEYS.theme,
        LEGACY_STORAGE_KEYS.theme,
        value => THEMES.has(value)
      );
      if (THEMES.has(theme)) legacy.theme = theme;
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
        legacy.commonLinksFavorites = [...commonLinks.parseFavoriteIds(serialized)];
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
        preferences: normalizeUiPreferences(desktop.preferences, commonLinks, { today }),
        migrationPatch: null
      };
    }

    const legacy = readLegacyUiPreferences(storage, commonLinks);
    if (desktop) {
      const preferences = normalizeUiPreferences({}, commonLinks, { today, fallback: legacy });
      return {
        preferences,
        migrationPatch: cloneUiPreferences(preferences)
      };
    }

    return {
      preferences: normalizeUiPreferences(
        readBrowserUiPreferences(storage),
        commonLinks,
        { today, fallback: legacy }
      ),
      migrationPatch: null
    };
  }

  function createUiPreferencePatch(field, value, commonLinks, { today } = {}) {
    if (!UI_PREFERENCE_FIELDS.includes(field) || !commonLinks) return {};
    const cutoff = resolveToday(today);
    if (field === 'theme' && THEMES.has(value)) return { theme: value };
    if (field === 'view' && VIEWS.has(value)) return { view: value };
    if (field === 'domain' && DOMAINS.has(value)) return { domain: value };
    if (field === 'category' && isValidCategory(value)) return { category: value };
    if (
      field === 'dailyDate'
      && (value === null || (isRealDateString(value) && value <= cutoff))
    ) return { dailyDate: value };
    if (field === 'linksCategory' && commonLinks.getCategories().includes(value)) {
      return { linksCategory: value };
    }
    if (field === 'commonLinksFavorites') {
      const favoriteIds = getValidFavoriteIds(value, commonLinks);
      return favoriteIds ? { commonLinksFavorites: favoriteIds } : {};
    }
    if (field === 'realtime' && typeof value === 'boolean') return { realtime: value };
    return {};
  }

  function sanitizeUiPreferencesPatch(patch, commonLinks, options) {
    if (!isPlainObject(patch)) return {};
    const sanitized = {};
    for (const field of UI_PREFERENCE_FIELDS) {
      if (!Object.hasOwn(patch, field)) continue;
      Object.assign(
        sanitized,
        createUiPreferencePatch(field, patch[field], commonLinks, options)
      );
    }
    return sanitized;
  }

  function createUiPreferenceActions({ commonLinks, persist, today } = {}) {
    if (!commonLinks) throw new TypeError('commonLinks is required');
    if (typeof persist !== 'function') throw new TypeError('persist must be a function');

    function remember(field, value) {
      const patch = createUiPreferencePatch(field, value, commonLinks, {
        today: typeof today === 'function' ? today() : today
      });
      if (Object.keys(patch).length === 0) return null;
      persist(patch);
      return patch;
    }

    return Object.freeze({ remember });
  }

  function writeBrowserUiPreferences(storage, patch, commonLinks, options) {
    const current = sanitizeUiPreferencesPatch(
      readBrowserUiPreferences(storage),
      commonLinks,
      options
    );
    const sanitized = sanitizeUiPreferencesPatch(patch, commonLinks, options);
    const next = { ...current, ...sanitized };
    storage.setItem(STORAGE_KEYS.uiPreferences, JSON.stringify(next));
    return next;
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
    if (desktopPreferences && THEMES.has(desktopPreferences.theme)) {
      theme = desktopPreferences.theme;
    } else {
      try {
        const browserTheme = readBrowserUiPreferences(storage).theme;
        theme = THEMES.has(browserTheme)
          ? browserTheme
          : migrateStorage(
            storage,
            STORAGE_KEYS.theme,
            LEGACY_STORAGE_KEYS.theme,
            value => THEMES.has(value)
          );
      } catch { /* localStorage may be unavailable; retain the safe default */ }
    }
    if (!THEMES.has(theme)) theme = 'dark';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    return theme;
  }

  return Object.freeze({
    STORAGE_KEYS,
    LEGACY_STORAGE_KEYS,
    migrateStorage,
    initializeTheme,
    readBrowserUiPreferences,
    normalizeUiPreferences,
    resolveInitialUiPreferences,
    createUiPreferencePatch,
    sanitizeUiPreferencesPatch,
    createUiPreferenceActions,
    writeBrowserUiPreferences,
    resolveDynamicCategory
  });
});
