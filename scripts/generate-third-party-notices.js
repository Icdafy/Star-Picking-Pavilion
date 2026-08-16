'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VENDORED_PACKAGES = Object.freeze([
  Object.freeze({
    key: '@deepseek-ai/dsh-client-ui-aqua@1.1.0',
    license: 'MIT',
    source: 'https://github.com/WYH66666666/DSH',
    notice: [
      'MIT License',
      '',
      'Copyright (c) 2026 John Wu',
      '',
      'Permission is hereby granted, free of charge, to any person obtaining a copy',
      'of this software and associated documentation files (the "Software"), to deal',
      'in the Software without restriction, including without limitation the rights',
      'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
      'copies of the Software, and to permit persons to whom the Software is',
      'furnished to do so, subject to the following conditions:',
      '',
      'The above copyright notice and this permission notice shall be included in all',
      'copies or substantial portions of the Software.',
      '',
      'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
      'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
      'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
      'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
      'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
      'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
      'SOFTWARE.'
    ].join('\n')
  })
]);

function licenseName(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) return value.map(licenseName).filter(Boolean).join(' OR ');
  if (value && typeof value.type === 'string') return value.type;
  return '';
}

function sourceUrl(pkg) {
  if (typeof pkg.repository === 'string') return pkg.repository;
  if (pkg.repository?.url) return pkg.repository.url;
  return pkg.homepage || '';
}

function collectProductionPackages(projectRoot) {
  const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'));
  const packages = new Map();
  for (const [relativePath, lockEntry] of Object.entries(lock.packages || {})) {
    if (!relativePath || !relativePath.includes('node_modules/') || lockEntry.dev === true) continue;
    const manifestPath = path.join(projectRoot, relativePath, 'package.json');
    if (!fs.existsSync(manifestPath)) throw new Error(`installed package metadata missing: ${relativePath}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const name = manifest.name || lockEntry.name;
    const version = manifest.version || lockEntry.version;
    const license = licenseName(manifest.license || manifest.licenses || lockEntry.license);
    if (!name || !version || !license) throw new Error(`incomplete license metadata: ${relativePath}`);
    const key = `${name}@${version}`;
    if (!packages.has(key)) packages.set(key, {
      key,
      license,
      source: sourceUrl(manifest)
    });
  }
  for (const item of VENDORED_PACKAGES) packages.set(item.key, { ...item });
  return [...packages.values()].sort((a, b) => a.key.localeCompare(b.key, 'en'));
}

function renderNotices(packageJson, packages) {
  const lines = [
    'THIRD-PARTY SOFTWARE NOTICES',
    `摘星阁 (Star-Picking-Pavilion) ${packageJson.build?.buildVersion || packageJson.version}`,
    '',
    'This distribution includes the following production dependencies.',
    'Each package remains subject to its own license terms.',
    ''
  ];
  for (const item of packages) {
    lines.push(item.key, `License: ${item.license}`);
    if (item.source) lines.push(`Source: ${item.source}`);
    if (item.notice) lines.push('', item.notice);
    lines.push('');
  }
  return `${lines.join(os.EOL).trimEnd()}${os.EOL}`;
}

function generateNotices(projectRoot = path.join(__dirname, '..')) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const packages = collectProductionPackages(projectRoot);
  if (!packages.length) throw new Error('no installed production dependencies found');
  const output = renderNotices(packageJson, packages);
  const outputPath = path.join(projectRoot, 'THIRD_PARTY_NOTICES.txt');
  fs.writeFileSync(outputPath, output, 'utf8');
  return { outputPath, count: packages.length };
}

if (require.main === module) {
  try {
    const result = generateNotices();
    console.log(`Wrote ${result.count} dependency notices to ${result.outputPath}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { collectProductionPackages, renderNotices, generateNotices };
