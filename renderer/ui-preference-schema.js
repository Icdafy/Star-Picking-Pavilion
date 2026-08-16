'use strict';

(function exposeUiPreferenceSchema(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.StarPickingPavilionUiPreferenceSchema = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createUiPreferenceSchema() {
  const THEMES = new Set(['light', 'dark']);
  const VIEWS = new Set([
    'featured', 'all', 'starred', 'daily', 'links', 'sources', 'settings'
  ]);
  const DOMAINS = new Set(['', 'lowaltitude', 'aerospace']);
  // 界面缩放档位。存的是档位名而不是倍率数字：倍率写死在 CSS 的
  // :root[data-ui-scale=…] 里，将来调比例只改样式表，不必迁移用户已存的偏好。
  const TEXT_SCALES = new Set(['sm', 'md', 'lg', 'xl']);
  const AQUA_MODES = new Set(['mica', 'compat']);
  const AQUA_BACKGROUNDS = new Set(['fluid', 'wallpaper']);
  const UI_PREFERENCE_FIELDS = Object.freeze([
    'theme',
    'textScale',
    'aquaMode',
    'aquaBlur',
    'aquaFrost',
    'aquaHue',
    'aquaBrightness',
    'aquaBackground',
    'aquaWallpaperBlur',
    'aquaWallpaperFrost',
    'aquaWhale',
    'aquaCritters',
    'view',
    'domain',
    'category',
    'dailyDate',
    'linksCategory',
    'commonLinksFavorites',
    'realtime',
    'closeToTray'
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
      textScale: 'md',
      aquaMode: 'mica',
      aquaBlur: 24,
      aquaFrost: 42,
      aquaHue: 172,
      aquaBrightness: 50,
      aquaBackground: 'fluid',
      aquaWallpaperBlur: 4,
      aquaWallpaperFrost: 18,
      aquaWhale: true,
      aquaCritters: true,
      view: 'featured',
      domain: '',
      category: '',
      dailyDate: null,
      linksCategory: commonLinks.ALL_CATEGORY,
      commonLinksFavorites: [...commonLinks.getDefaultFavoriteIds()],
      realtime: true,
      closeToTray: false
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

  function isFiniteNumberInRange(value, min, max) {
    return typeof value === 'number'
      && Number.isFinite(value)
      && value >= min
      && value <= max;
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
      textScale: chooseValue(
        source.textScale,
        secondary.textScale,
        value => TEXT_SCALES.has(value),
        defaults.textScale
      ),
      aquaMode: chooseValue(
        source.aquaMode,
        secondary.aquaMode,
        value => AQUA_MODES.has(value),
        defaults.aquaMode
      ),
      aquaBlur: chooseValue(
        source.aquaBlur,
        secondary.aquaBlur,
        value => isFiniteNumberInRange(value, 0, 40),
        defaults.aquaBlur
      ),
      aquaFrost: chooseValue(
        source.aquaFrost,
        secondary.aquaFrost,
        value => isFiniteNumberInRange(value, 0, 100),
        defaults.aquaFrost
      ),
      aquaHue: chooseValue(
        source.aquaHue,
        secondary.aquaHue,
        value => isFiniteNumberInRange(value, 0, 360),
        defaults.aquaHue
      ),
      aquaBrightness: chooseValue(
        source.aquaBrightness,
        secondary.aquaBrightness,
        value => isFiniteNumberInRange(value, 0, 100),
        defaults.aquaBrightness
      ),
      aquaBackground: chooseValue(
        source.aquaBackground,
        secondary.aquaBackground,
        value => AQUA_BACKGROUNDS.has(value),
        defaults.aquaBackground
      ),
      aquaWallpaperBlur: chooseValue(
        source.aquaWallpaperBlur,
        secondary.aquaWallpaperBlur,
        value => isFiniteNumberInRange(value, 0, 40),
        defaults.aquaWallpaperBlur
      ),
      aquaWallpaperFrost: chooseValue(
        source.aquaWallpaperFrost,
        secondary.aquaWallpaperFrost,
        value => isFiniteNumberInRange(value, 0, 100),
        defaults.aquaWallpaperFrost
      ),
      aquaWhale: chooseValue(
        source.aquaWhale,
        secondary.aquaWhale,
        value => typeof value === 'boolean',
        defaults.aquaWhale
      ),
      aquaCritters: chooseValue(
        source.aquaCritters,
        secondary.aquaCritters,
        value => typeof value === 'boolean',
        defaults.aquaCritters
      ),
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
      ),
      closeToTray: chooseValue(
        source.closeToTray,
        secondary.closeToTray,
        value => typeof value === 'boolean',
        defaults.closeToTray
      )
    };
  }

  function isValidUiPreferenceValue(field, value, commonLinks, { today } = {}) {
    if (field === 'theme') return THEMES.has(value);
    if (field === 'textScale') return TEXT_SCALES.has(value);
    if (field === 'aquaMode') return AQUA_MODES.has(value);
    if (field === 'aquaBlur') return isFiniteNumberInRange(value, 0, 40);
    if (field === 'aquaFrost') return isFiniteNumberInRange(value, 0, 100);
    if (field === 'aquaHue') return isFiniteNumberInRange(value, 0, 360);
    if (field === 'aquaBrightness') return isFiniteNumberInRange(value, 0, 100);
    if (field === 'aquaBackground') return AQUA_BACKGROUNDS.has(value);
    if (field === 'aquaWallpaperBlur') return isFiniteNumberInRange(value, 0, 40);
    if (field === 'aquaWallpaperFrost') return isFiniteNumberInRange(value, 0, 100);
    if (field === 'aquaWhale') return typeof value === 'boolean';
    if (field === 'aquaCritters') return typeof value === 'boolean';
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
    if (field === 'closeToTray') return typeof value === 'boolean';
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
    TEXT_SCALES: Object.freeze([...TEXT_SCALES]),
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
