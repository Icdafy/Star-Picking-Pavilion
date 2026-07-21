'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { resolveStaticFile } = require('../server/static-files');

const root = path.resolve(__dirname, '..', 'renderer');

test('static path resolution stays inside the renderer directory', () => {
  assert.equal(resolveStaticFile(root, '/'), path.join(root, 'index.html'));
  assert.equal(resolveStaticFile(root, '/styles.css'), path.join(root, 'styles.css'));
  assert.equal(resolveStaticFile(root, '/../package.json'), null);
  assert.equal(resolveStaticFile(root, '/%2e%2e%2fpackage.json'), null);
  assert.equal(resolveStaticFile(root, '/..%5cpackage.json'), null);
  assert.equal(resolveStaticFile(root, '/%E0%A4%A'), null);
  assert.equal(resolveStaticFile(root, '/file%00.txt'), null);
});
