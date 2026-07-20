'use strict';

const fs = require('node:fs');
const path = require('node:path');

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
  return [...packages.values()].sort((a, b) => a.key.localeCompare(b.key, 'en'));
}

function renderNotices(packageJson, packages) {
  const lines = [
    'THIRD-PARTY SOFTWARE NOTICES',
    `摘星阁 (Star-Picking-Pavilion) ${packageJson.version}`,
    '',
    'This distribution includes the following production dependencies.',
    'Each package remains subject to its own license terms.',
    ''
  ];
  for (const item of packages) {
    lines.push(item.key, `License: ${item.license}`);
    if (item.source) lines.push(`Source: ${item.source}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
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
