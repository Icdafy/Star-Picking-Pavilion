'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const packageJson = require('../package.json');
const {
  assertAllowedEntries,
  expectedInstallerName
} = require('../scripts/verify-package');

test('packaging config is a production allowlist with no broad glob or asar unpacking', () => {
  assert.deepEqual(packageJson.build.files, [
    'electron/**/*',
    'server/**/*',
    'renderer/**/*',
    'config/**/*',
    'package.json',
    '!**/*.map',
    '!**/*.test.js'
  ]);
  assert.equal(Object.hasOwn(packageJson.build, 'asarUnpack'), false);
  assert.deepEqual(packageJson.build.electronLanguages, ['zh-CN', 'en-US']);
  assert.equal(packageJson.scripts['verify:package'], 'node scripts/verify-package.js');
  assert.equal(packageJson.scripts['audit:runtime'], 'npm audit --omit=dev --audit-level=high');
});

test('package verifier accepts only application roots, production dependencies and metadata', () => {
  assert.doesNotThrow(() => assertAllowedEntries([
    '/electron/main.js',
    '/server/index.js',
    '/renderer/index.html',
    '/renderer/fonts/SmileySans-Oblique.woff2',
    '/config/scoring.json',
    '/node_modules/cheerio/package.json',
    '/package.json'
  ]));

  for (const forbidden of [
    '/.worktrees/x',
    '/data/app.db',
    '/test/a.test.js',
    '/dist/win-unpacked/x',
    '/logs/run.log'
  ]) {
    assert.throws(
      () => assertAllowedEntries(['/electron/main.js', forbidden]),
      error => error instanceof Error && error.message.includes(forbidden),
      `expected ${forbidden} to be rejected`
    );
  }
});

test('package verifier rejects database, WAL, secret and temporary artifacts at any application path', () => {
  for (const forbidden of [
    '/renderer/cache.sqlite',
    '/config/settings.json',
    '/server/runtime.db-wal',
    '/electron/debug.log',
    '/renderer/screenshot.png.tmp'
  ]) {
    assert.throws(() => assertAllowedEntries([forbidden]), new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('expected installer name is derived from the canonical package version', () => {
  assert.equal(expectedInstallerName(packageJson.version), 'Star-Picking-Pavilion-Setup-0.0.1.exe');
  assert.equal(path.extname(expectedInstallerName(packageJson.version)), '.exe');
});
