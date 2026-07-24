'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));

test('canonical brand config is the single explicit identity map', () => {
  const brand = JSON.parse(read('config/brand.json'));

  assert.deepEqual({
    displayName: brand.displayName,
    englishName: brand.englishName,
    packageName: brand.packageName,
    appId: brand.appId,
    executableName: brand.executableName,
    databaseName: brand.databaseName,
    envPrefix: brand.envPrefix
  }, {
    displayName: '摘星阁',
    englishName: 'Star-Picking-Pavilion',
    packageName: 'star-picking-pavilion',
    appId: 'com.icdafy.star-picking-pavilion',
    executableName: 'Star-Picking-Pavilion',
    databaseName: 'star-picking-pavilion.db',
    envPrefix: 'STAR_PICKING_PAVILION_'
  });
  assert.deepEqual(brand.storage, {
    theme: 'star-picking-pavilion.theme',
    realtime: 'star-picking-pavilion.realtime',
    commonLinks: 'star-picking-pavilion.common-links.favorites'
  });
  assert.deepEqual(brand.legacyCompatibility.storage, {
    theme: ['wc-theme'],
    realtime: ['wc-realtime'],
    commonLinks: ['zxg-common-links-favorites']
  });
});

test('package and installer metadata use the v0.0.4 canonical identity', () => {
  assert.equal(pkg.name, 'star-picking-pavilion');
  assert.equal(pkg.version, '0.0.4');
  assert.match(pkg.description, /摘星阁/);
  assert.match(pkg.description, /Star-Picking-Pavilion/);
  assert.equal(pkg.homepage, 'https://github.com/Icdafy/Star-Picking-Pavilion');
  assert.equal(pkg.repository.url, 'https://github.com/Icdafy/Star-Picking-Pavilion.git');
  assert.equal(pkg.build.appId, 'com.icdafy.star-picking-pavilion');
  assert.equal(pkg.build.productName, '摘星阁');
  assert.equal(pkg.build.executableName, 'Star-Picking-Pavilion');
  assert.equal(pkg.build.win.artifactName, 'Star-Picking-Pavilion-Setup-${version}.${ext}');
  assert.equal(pkg.build.nsis.guid, '5fea1cfe-e72e-5af6-9770-01a551e1f773');
  assert.equal(pkg.build.nsis.shortcutName, '摘星阁');
  assert.equal(pkg.build.nsis.uninstallDisplayName, '摘星阁');
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);
  assert.deepEqual(pkg.build.publish, [{
    provider: 'github',
    owner: 'Icdafy',
    repo: 'Star-Picking-Pavilion'
  }]);
});

test('云幄名称在常用网址功能中保持不变', () => {
  assert.match(read('renderer/index.html'), /云幄\s*·\s*常用网址/);
});

test('release documentation points only to the canonical repository and installer', () => {
  const readme = read('README.md');
  const releasing = read('RELEASING.md');

  assert.match(readme, /https:\/\/github\.com\/Icdafy\/Star-Picking-Pavilion\/releases/);
  assert.match(releasing, /Icdafy\/Star-Picking-Pavilion/);
  assert.match(readme, /Star-Picking-Pavilion-Setup-0\.0\.4\.exe/);
  assert.match(releasing, /Star-Picking-Pavilion-Setup-0\.0\.4\.exe/);
  assert.doesNotMatch(readme, /Icdafy\/Windcather|Windcatcher-Setup-/i);
  assert.doesNotMatch(releasing, /Icdafy\/Windcather|Windcatcher-Setup-/i);
});
