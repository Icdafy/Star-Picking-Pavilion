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
  assert.match(html, /<script src="ui-preference-schema\.js"><\/script>/);
  assert.match(electronSource, /require\(['"]\.\.\/renderer\/ui-preference-schema['"]\)/);
});

test('renderer and Electron normalize normal and damaged snapshots identically', () => {
  const [first, second] = CommonLinks.LINKS;
  const inputs = [
    {
      theme: 'light',
      view: 'daily',
      domain: 'aerospace',
      category: '产业',
      dailyDate: '2026-07-22',
      linksCategory: 'AI',
      commonLinksFavorites: [second.id, 'missing', second.id, first.id],
      realtime: false
    },
    {
      theme: 'sepia',
      view: 'missing',
      domain: 'invalid',
      category: `bad\u0000category`,
      dailyDate: '2026-07-24',
      linksCategory: 'missing',
      commonLinksFavorites: 'broken',
      realtime: 'yes'
    }
  ];

  for (const input of inputs) {
    assert.deepEqual(
      Bootstrap.normalizeUiPreferences(input, CommonLinks, { today: TODAY }),
      withoutVersion(ElectronPreferences.normalizeUiPreferences(input, { today: TODAY }))
    );
  }
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
