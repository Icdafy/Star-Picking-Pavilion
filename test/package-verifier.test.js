'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const packageJson = require('../package.json');
const {
  assertAllowedEntries,
  assertAllowedResourceEntries,
  assertRequiredLegalResources,
  assertNoEmbeddedSecrets,
  assertProductionDependencyEntries,
  collectTextEntries,
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
  assert.deepEqual(packageJson.build.extraResources, [
    { from: 'LICENSE', to: 'LICENSE.txt' },
    { from: 'THIRD_PARTY_NOTICES.txt', to: 'THIRD_PARTY_NOTICES.txt' }
  ]);
  assert.equal(packageJson.build.nsis.license, 'LICENSE');
  assert.equal(packageJson.scripts['verify:package'], 'node scripts/verify-package.js');
  assert.equal(packageJson.scripts['audit:runtime'], 'npm audit --omit=dev --audit-level=high');
});

test('package verifier rejects embedded credentials and development-only dependencies', () => {
  assert.doesNotThrow(() => assertNoEmbeddedSecrets([
    { path: '/renderer/app.js', content: "const apiKey = '';" },
    { path: '/renderer/index.html', content: 'placeholder="sk-…"' }
  ]));
  for (const secret of [
    'ghp_1234567890abcdefghijklmnop',
    'AKIA1234567890ABCDEF',
    'sk-1234567890abcdefghijklmnop',
    '-----BEGIN PRIVATE KEY-----'
  ]) {
    assert.throws(() => assertNoEmbeddedSecrets([{ path: '/config/leak.json', content: secret }]), /leak\.json/);
  }

  const lockPackages = {
    'node_modules/runtime': { dev: false },
    'node_modules/dev-only': { dev: true }
  };
  assert.doesNotThrow(() => assertProductionDependencyEntries([
    '/node_modules/runtime/package.json'
  ], lockPackages));
  assert.throws(() => assertProductionDependencyEntries([
    '/node_modules/dev-only/package.json'
  ], lockPackages), /development-only/);
  assert.throws(() => assertProductionDependencyEntries([
    '/node_modules/unlocked/package.json'
  ], lockPackages), /lockfile/);
});

test('package verifier preserves Windows ASAR separators while extracting files', () => {
  const requested = [];
  const files = collectTextEntries('app.asar', ['\\server\\ai\\cluster.js'], {
    extractFile: (_archive, entry) => {
      requested.push(entry);
      if (entry !== 'server\\ai\\cluster.js') throw new Error('wrong separator');
      return Buffer.from('module.exports = {};');
    }
  });
  assert.deepEqual(requested, ['server\\ai\\cluster.js']);
  assert.deepEqual(files, [{ path: '/server/ai/cluster.js', content: 'module.exports = {};' }]);
});

test('package verifier requires the application license and third-party notices beside the ASAR', () => {
  const files = new Map([
    ['LICENSE.txt', 'MIT License\n\nTHE SOFTWARE IS PROVIDED "AS IS"'],
    ['THIRD_PARTY_NOTICES.txt', 'THIRD-PARTY SOFTWARE NOTICES\ncheerio@1.2.0']
  ]);
  assert.doesNotThrow(() => assertRequiredLegalResources(name => files.get(name)));
  assert.throws(() => assertRequiredLegalResources(name => name === 'LICENSE.txt' ? files.get(name) : null), /THIRD_PARTY_NOTICES/);
  assert.throws(() => assertRequiredLegalResources(() => 'wrong content'), /LICENSE/);

  assert.doesNotThrow(() => assertAllowedResourceEntries([
    'app.asar', 'app-update.yml', 'elevate.exe', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.txt'
  ]));
  assert.throws(() => assertAllowedResourceEntries(['app.asar', 'copied-user-data.db']), /copied-user-data/);
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
