'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  escapeHTML,
  safeHttpUrl,
  findFocusKey,
  restoreFocusByKey
} = require('../renderer/dom-utils');

test('CommonJS loading exports the API without creating a global DomUtils property', () => {
  const modulePath = require.resolve('../renderer/dom-utils');
  const result = spawnSync(process.execPath, ['-e', `
    delete globalThis.DomUtils;
    const api = require(${JSON.stringify(modulePath)});
    process.stdout.write(JSON.stringify({
      exported: typeof api.safeHttpUrl === 'function',
      globalCreated: Object.prototype.hasOwnProperty.call(globalThis, 'DomUtils')
    }));
  `], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    exported: true,
    globalCreated: false
  });
});

test('escapeHTML escapes text used in rendered markup', () => {
  assert.equal(
    escapeHTML(`<a href="x">Tom & Jerry's</a>`),
    '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;'
  );
  assert.equal(escapeHTML(null), '');
});

test('safeHttpUrl permits only absolute HTTP and HTTPS URLs', () => {
  assert.equal(safeHttpUrl(' HTTP://Example.COM:80/a/../b '), 'http://example.com/b');
  assert.equal(safeHttpUrl('http://127.0.0.1:8080/path'), 'http://127.0.0.1:8080/path');
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,hello',
    'file:///tmp/example',
    '/relative/path',
    'not a url',
    null
  ]) assert.equal(safeHttpUrl(value), '#');
});

test('findFocusKey returns the active descendant data-focus-key', () => {
  const keyedControl = {
    getAttribute(name) {
      return name === 'data-focus-key' ? 'favorite:work-plan' : null;
    }
  };
  const activeElement = {
    closest(selector) {
      return selector === '[data-focus-key]' ? keyedControl : null;
    }
  };
  const root = {
    ownerDocument: { activeElement },
    contains(node) {
      return node === activeElement || node === keyedControl;
    }
  };

  assert.equal(findFocusKey(root), 'favorite:work-plan');
  root.contains = () => false;
  assert.equal(findFocusKey(root), null);
});

test('restoreFocusByKey focuses the matching replacement without scrolling', () => {
  let focusOptions;
  const controls = [
    { getAttribute: () => 'category:全部' },
    {
      getAttribute: () => 'favorite:work-plan',
      focus(options) { focusOptions = options; }
    }
  ];
  const root = { querySelectorAll: () => controls };

  assert.equal(restoreFocusByKey(root, 'favorite:work-plan'), true);
  assert.deepEqual(focusOptions, { preventScroll: true });
});

test('restoreFocusByKey focuses a stable fallback when the keyed control disappeared', () => {
  let fallbackOptions;
  const fallback = { focus(options) { fallbackOptions = options; } };
  const root = { querySelectorAll: () => [] };

  assert.equal(restoreFocusByKey(root, 'favorite:missing', fallback), true);
  assert.deepEqual(fallbackOptions, { preventScroll: true });
  assert.equal(restoreFocusByKey(root, null), false);
});
