'use strict';

(function exposeUiPreferenceSchema(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.StarPickingPavilionUiPreferenceSchema = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createUiPreferenceSchema() {
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
      throw new TypeError('date must be valid');
    }
    const year = String(value.getFullYear()).padStart(4, '0');
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function resolveToday(today) {
    return isRealDateString(today) ? today : formatLocalDate(new Date());
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

  function normalizeFavoriteCandidate(value, commonLinks) {
    if (!Array.isArray(value) || value.length > commonLinks.LINKS.length) return null;
    const validIds = new Set(commonLinks.LINKS.map(link => link.id));
    const seen = new Set();
    const normalized = [];
    for (let index = 0; index < value.length; index += 1) {
      const id = value[index];
      if (typeof id !== 'string' || !validIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      normalized.push(id);
    }
    return normalized;
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
    const primaryFavorites = normalizeFavoriteCandidate(
      source.commonLinksFavorites,
      commonLinks
    );
    const fallbackFavorites = normalizeFavoriteCandidate(
      secondary.commonLinksFavorites,
      commonLinks
    );

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

  function isValidUiPreferenceValue(field, value, commonLinks, { today } = {}) {
    if (field === 'theme') return THEMES.has(value);
    if (field === 'view') return VIEWS.has(value);
    if (field === 'domain') return DOMAINS.has(value);
    if (field === 'category') return isValidCategory(value);
    if (field === 'dailyDate') {
      const cutoff = resolveToday(today);
      return value === null || (isRealDateString(value) && value <= cutoff);
    }
    if (field === 'linksCategory') return commonLinks.getCategories().includes(value);
    if (field === 'commonLinksFavorites') {
      return Array.isArray(value) && value.length <= commonLinks.LINKS.length;
    }
    if (field === 'realtime') return typeof value === 'boolean';
    return false;
  }

  function createUiPreferencePatch(field, value, commonLinks, options) {
    if (!UI_PREFERENCE_FIELDS.includes(field) || !commonLinks) return {};
    if (!isValidUiPreferenceValue(field, value, commonLinks, options)) return {};
    if (field === 'commonLinksFavorites') {
      return {
        commonLinksFavorites: normalizeFavoriteCandidate(value, commonLinks)
      };
    }
    return { [field]: value };
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

  return Object.freeze({
    UI_PREFERENCE_FIELDS,
    isPlainObject,
    isRealDateString,
    formatLocalDate,
    getDefaultUiPreferences,
    normalizeFavoriteCandidate,
    normalizeUiPreferences,
    isValidUiPreferenceValue,
    createUiPreferencePatch,
    sanitizeUiPreferencesPatch
  });
});
