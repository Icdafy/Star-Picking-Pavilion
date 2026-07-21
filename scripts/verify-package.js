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
const ALLOWED_RESOURCE_ENTRIES = new Set([
  'app.asar',
  'app-update.yml',
  'elevate.exe',
  'LICENSE.txt',
  'THIRD_PARTY_NOTICES.txt'
]);
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/
];

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

function assertAllowedResourceEntries(entries) {
  for (const entry of entries) {
    if (!ALLOWED_RESOURCE_ENTRIES.has(entry)) throw new Error(`Forbidden resource entry: ${entry}`);
  }
}

function assertNoEmbeddedSecrets(files) {
  for (const file of files) {
    const content = String(file.content);
    if (SECRET_PATTERNS.some(pattern => pattern.test(content))) {
      throw new Error(`Embedded credential found in package entry: ${file.path}`);
    }
  }
}

function assertProductionDependencyEntries(entries, lockPackages) {
  const manifestPattern = /^node_modules\/(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*\/package\.json$/;
  for (const rawEntry of entries) {
    const entry = normalizeEntry(rawEntry).slice(1);
    if (!manifestPattern.test(entry)) continue;
    const packagePath = entry.slice(0, -'/package.json'.length);
    const lockEntry = lockPackages[packagePath];
    if (!lockEntry) throw new Error(`Packaged dependency is absent from lockfile: ${packagePath}`);
    if (lockEntry.dev === true) throw new Error(`Packaged dependency is development-only: ${packagePath}`);
  }
}

function assertRequiredLegalResources(readResource) {
  const license = readResource('LICENSE.txt');
  if (!license || !/MIT License[\s\S]*THE SOFTWARE IS PROVIDED "AS IS"/.test(String(license))) {
    throw new Error('LICENSE.txt is missing or invalid');
  }
  const notices = readResource('THIRD_PARTY_NOTICES.txt');
  if (!notices || !/THIRD-PARTY SOFTWARE NOTICES[\s\S]+@\d/.test(String(notices))) {
    throw new Error('THIRD_PARTY_NOTICES.txt is missing or invalid');
  }
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
  const resourcesDir = path.dirname(archive);
  const installer = path.join(distDir, expectedInstallerName(packageJson.version));

  if (!fs.existsSync(archive)) throw new Error(`Missing ASAR: ${archive}`);
  if (!fs.existsSync(installer)) throw new Error(`Missing installer: ${installer}`);

  const entries = asar.listPackage(archive);
  assertAllowedEntries(entries);
  const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'));
  assertProductionDependencyEntries(entries, lock.packages || {});
  const textEntries = entries
    .map(normalizeEntry)
    .filter(entry => !entry.startsWith('/node_modules/')
      && (/\.(?:css|html|js|json|svg|txt)$/i.test(entry) || entry === '/package.json'))
    .map(entry => ({
      path: entry,
      content: asar.extractFile(archive, entry.slice(1).replace(/\\/g, '/')).toString('utf8')
    }));
  assertNoEmbeddedSecrets(textEntries);
  assertAllowedResourceEntries(fs.readdirSync(resourcesDir));
  assertRequiredLegalResources(name => {
    const file = path.join(resourcesDir, name);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  });
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
  ALLOWED_RESOURCE_ENTRIES,
  MAX_ASAR_BYTES,
  MAX_INSTALLER_BYTES,
  assertAllowedEntries,
  assertAllowedResourceEntries,
  assertNoEmbeddedSecrets,
  assertProductionDependencyEntries,
  assertRequiredLegalResources,
  expectedInstallerName,
  verifyPackage
};
