'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const brandedFiles = [
  'package.json',
  'renderer/index.html',
  'renderer/app.js',
  'renderer/styles.css',
  'electron/main.js',
  'server/index.js',
  'server/ai/pipeline.js',
  'build/make-icon.py',
  'README.md'
];

test('所有用户可见和内容身份统一为摘星阁', () => {
  for (const file of brandedFiles) {
    assert.doesNotMatch(read(file), /捕风司/, `${file} 仍含旧品牌`);
  }
  assert.match(read('renderer/index.html'), /<h1>摘星阁<\/h1>/);
  assert.equal(pkg.productName, '摘星阁');
  assert.equal(pkg.build.productName, '摘星阁');
  assert.equal(pkg.build.nsis.shortcutName, '摘星阁');
  assert.match(pkg.description, /^摘星阁/);
  assert.equal(pkg.author, '摘星阁');
});

test('内部兼容标识保持不变', () => {
  assert.equal(pkg.name, 'windcatcher');
  assert.equal(pkg.build.appId, 'com.windcatcher.app');
  assert.equal(pkg.build.win.artifactName, 'Windcatcher-Setup-${version}.${ext}');
  assert.match(read('server/db.js'), /windcatcher\.db/);
  assert.match(read('electron/preload.js'), /windcatcher/);
});

test('云幄名称在常用网址功能中保持不变', () => {
  assert.match(read('renderer/index.html'), /云幄\s*·\s*常用网址/);
});
