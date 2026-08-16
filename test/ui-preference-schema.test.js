'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const CommonLinks = require('../renderer/common-links');
const Bootstrap = require('../renderer/bootstrap');
const ElectronPreferences = require('../electron/ui-preferences');
const TODAY = '2026-07-23';
const AQUA_FIELDS = Object.freeze([
  'aquaMode',
  'aquaBlur',
  'aquaFrost',
  'aquaHue',
  'aquaBrightness',
  'aquaBackground',
  'aquaWallpaperBlur',
  'aquaWallpaperFrost',
  'aquaWhale',
  'aquaCritters'
]);

function withoutVersion(preferences) {
  const { version, ...values } = preferences;
  return values;
}

test('shared UI preference schema is browser/CommonJS compatible and used by both layers', () => {
  const schema = require('../renderer/ui-preference-schema');
  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  const electronSource = fs.readFileSync(
    path.join(root, 'electron', 'ui-preferences.js'),
    'utf8'
  );

  assert.equal(Object.isFrozen(schema), true);
  assert.deepEqual(
    schema.UI_PREFERENCE_FIELDS.filter(field => field.startsWith('aqua')),
    AQUA_FIELDS,
    'the shared allowlist must carry every persisted Aqua field in a stable order'
  );
  assert.match(html, /<script src="ui-preference-schema\.js"><\/script>/);
  assert.match(electronSource, /require\(['"]\.\.\/renderer\/ui-preference-schema['"]\)/);
});

test('renderer and Electron normalize normal and damaged snapshots identically', () => {
  const [first, second] = CommonLinks.LINKS;
  const inputs = [
    {
      theme: 'light',
      aquaMode: 'compat',
      aquaBlur: 0,
      aquaFrost: 100,
      aquaHue: 360,
      aquaBrightness: 0,
      aquaBackground: 'wallpaper',
      aquaWallpaperBlur: 40,
      aquaWallpaperFrost: 100,
      aquaWhale: false,
      aquaCritters: false,
      view: 'daily',
      domain: 'aerospace',
      category: '产业',
      dailyDate: '2026-07-22',
      linksCategory: 'AI',
      commonLinksFavorites: [second.id, 'missing', second.id, first.id],
      realtime: false,
      closeToTray: true
    },
    {
      theme: 'sepia',
      aquaMode: 'glass',
      aquaBlur: -1,
      aquaFrost: 101,
      aquaHue: Number.POSITIVE_INFINITY,
      aquaBrightness: '50',
      aquaBackground: 'video',
      aquaWallpaperBlur: Number.NaN,
      aquaWallpaperFrost: -0.01,
      aquaWhale: 'yes',
      aquaCritters: null,
      view: 'missing',
      domain: 'invalid',
      category: `bad\u0000category`,
      dailyDate: '2026-07-24',
      linksCategory: 'missing',
      commonLinksFavorites: 'broken',
      realtime: 'yes',
      closeToTray: 'yes'
    }
  ];

  for (const input of inputs) {
    assert.deepEqual(
      Bootstrap.normalizeUiPreferences(input, CommonLinks, { today: TODAY }),
      withoutVersion(ElectronPreferences.normalizeUiPreferences(input, { today: TODAY }))
    );
  }
});

test('every Aqua field produces one minimal patch and rejects invalid enum, type, and numeric edges', () => {
  const schema = require('../renderer/ui-preference-schema');
  const validCases = [
    ['aquaMode', 'compat'],
    ['aquaBlur', 0],
    ['aquaFrost', 100],
    ['aquaHue', 360],
    ['aquaBrightness', 0],
    ['aquaBackground', 'wallpaper'],
    ['aquaWallpaperBlur', 40],
    ['aquaWallpaperFrost', 100],
    ['aquaWhale', false],
    ['aquaCritters', false]
  ];

  for (const [field, value] of validCases) {
    assert.equal(schema.isValidUiPreferenceValue(field, value, CommonLinks), true, field);
    assert.deepEqual(
      schema.createUiPreferencePatch(field, value, CommonLinks),
      { [field]: value },
      `${field} must not drag unrelated appearance settings into its write`
    );
  }

  const invalidCases = [
    ['aquaMode', 'glass'],
    ['aquaBlur', -Number.EPSILON],
    ['aquaFrost', 100.000001],
    ['aquaHue', 361],
    ['aquaBrightness', Number.NaN],
    ['aquaBackground', 'video'],
    ['aquaWallpaperBlur', Number.POSITIVE_INFINITY],
    ['aquaWallpaperFrost', -1],
    ['aquaWhale', 0],
    ['aquaCritters', 'false']
  ];
  for (const [field, value] of invalidCases) {
    assert.equal(schema.isValidUiPreferenceValue(field, value, CommonLinks), false, field);
    assert.deepEqual(schema.createUiPreferencePatch(field, value, CommonLinks), {}, field);
  }

  assert.deepEqual(
    schema.sanitizeUiPreferencesPatch({
      aquaBlur: 12,
      aquaHue: 999,
      aquaWhale: false,
      unknownAquaField: true
    }, CommonLinks),
    { aquaBlur: 12, aquaWhale: false },
    'batch sanitization keeps valid fields without replacing invalid siblings with defaults'
  );
});

test('oversized sparse favorites have identical safe semantics without custom iteration', () => {
  const oversized = [];
  oversized.length = CommonLinks.LINKS.length + 1;
  oversized[0] = CommonLinks.LINKS[0].id;
  let iterations = 0;
  Object.defineProperty(oversized, Symbol.iterator, {
    value() {
      iterations += 1;
      throw new Error('oversized favorite array was iterated');
    }
  });

  const renderer = Bootstrap.normalizeUiPreferences(
    { commonLinksFavorites: oversized },
    CommonLinks,
    { today: TODAY }
  );
  const electron = ElectronPreferences.normalizeUiPreferences(
    { commonLinksFavorites: oversized },
    { today: TODAY }
  );

  assert.deepEqual(renderer, withoutVersion(electron));
  assert.deepEqual(renderer.commonLinksFavorites, [...CommonLinks.getDefaultFavoriteIds()]);
  assert.deepEqual(
    Bootstrap.createUiPreferencePatch(
      'commonLinksFavorites',
      oversized,
      CommonLinks,
      { today: TODAY }
    ),
    {}
  );
  assert.equal(iterations, 0);
});
