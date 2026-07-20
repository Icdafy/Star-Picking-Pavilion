'use strict';

(function exposeBootstrap(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else if (root) {
    root.StarPickingPavilionBootstrap = api;
    api.initializeTheme(root.localStorage, root.document);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBootstrap() {
  const STORAGE_KEYS = Object.freeze({
    theme: 'star-picking-pavilion.theme',
    realtime: 'star-picking-pavilion.realtime',
    commonLinksFavorites: 'star-picking-pavilion.common-links.favorites'
  });
  const LEGACY_STORAGE_KEYS = Object.freeze({
    theme: Object.freeze(['wc-theme']),
    realtime: Object.freeze(['wc-realtime']),
    commonLinksFavorites: Object.freeze(['zxg-common-links-favorites'])
  });

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

  function initializeTheme(storage, document) {
    let theme = null;
    try {
      theme = migrateStorage(
        storage,
        STORAGE_KEYS.theme,
        LEGACY_STORAGE_KEYS.theme,
        value => value === 'dark' || value === 'light'
      );
    } catch { /* localStorage may be unavailable; retain the safe default */ }
    if (theme !== 'light' && theme !== 'dark') theme = 'dark';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    return theme;
  }

  return Object.freeze({
    STORAGE_KEYS,
    LEGACY_STORAGE_KEYS,
    migrateStorage,
    initializeTheme
  });
});
