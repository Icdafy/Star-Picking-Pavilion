'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_ASAR_BYTES = 12 * 1024 * 1024;
const MAX_INSTALLER_BYTES = 110 * 1024 * 1024;
const ALLOWED_ROOTS = new Set([
  'electron',
  'server',
  'renderer',
  'config',
  'node_modules',
  'package.json'
]);
const FORBIDDEN_APPLICATION_ARTIFACT = /(?:^|\/)(?:\.git|\.worktrees|\.playwright-cli|data|dist|docs?|tests?|logs?|screenshots?)(?:\/|$)|(?:^|\/)(?:settings\.json|[^/]+\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm))?|[^/]+\.log|[^/]+\.(?:tmp|temp|bak))(?:$|\/)/i;

function normalizeEntry(entry) {
  return `/${String(entry).replace(/\\/g, '/').replace(/^\/+/, '')}`;
}

function assertAllowedEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('ASAR entry list is empty');
  }

  for (const rawEntry of entries) {
    const entry = normalizeEntry(rawEntry);
    const root = entry.slice(1).split('/')[0];
    if (!ALLOWED_ROOTS.has(root)) {
      throw new Error(`Forbidden package entry: ${entry}`);
    }
    if (root !== 'node_modules' && FORBIDDEN_APPLICATION_ARTIFACT.test(entry)) {
      throw new Error(`Forbidden package entry: ${entry}`);
    }
  }
}

function expectedInstallerName(version) {
  return `Star-Picking-Pavilion-Setup-${version}.exe`;
}

function verifyFileSize(file, maximumBytes, label) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error(`${label} is not a file: ${file}`);
  if (stat.size > maximumBytes) {
    throw new Error(`${label} is ${(stat.size / 1024 / 1024).toFixed(2)} MiB; maximum is ${(maximumBytes / 1024 / 1024).toFixed(2)} MiB`);
  }
  return stat.size;
}

function verifyPackage(options = {}) {
  const projectRoot = options.projectRoot || path.join(__dirname, '..');
  const packageJson = options.packageJson || require(path.join(projectRoot, 'package.json'));
  const distDir = options.distDir || path.join(projectRoot, 'dist');
  const asar = options.asar || require('@electron/asar');
  const archive = path.join(distDir, 'win-unpacked', 'resources', 'app.asar');
  const installer = path.join(distDir, expectedInstallerName(packageJson.version));

  if (!fs.existsSync(archive)) throw new Error(`Missing ASAR: ${archive}`);
  if (!fs.existsSync(installer)) throw new Error(`Missing installer: ${installer}`);

  const entries = asar.listPackage(archive);
  assertAllowedEntries(entries);
  const asarBytes = verifyFileSize(archive, MAX_ASAR_BYTES, 'app.asar');
  const installerBytes = verifyFileSize(installer, MAX_INSTALLER_BYTES, 'installer');

  return {
    archive,
    installer,
    entryCount: entries.length,
    asarBytes,
    installerBytes
  };
}

if (require.main === module) {
  try {
    const result = verifyPackage();
    console.log(`Verified ${result.entryCount} ASAR entries`);
    console.log(`app.asar: ${(result.asarBytes / 1024 / 1024).toFixed(2)} MiB`);
    console.log(`installer: ${(result.installerBytes / 1024 / 1024).toFixed(2)} MiB`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  ALLOWED_ROOTS,
  MAX_ASAR_BYTES,
  MAX_INSTALLER_BYTES,
  assertAllowedEntries,
  expectedInstallerName,
  verifyPackage
};
