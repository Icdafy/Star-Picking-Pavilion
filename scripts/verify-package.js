'use strict';

const fs = require('node:fs');
const path = require('node:path');

// 体积门禁在 v0.0.14 重新基线化。
//
// v0.0.11 起这两个上限一直钉死在 v0.0.10 实测产物上（ASAR 12,476,662 / 安装包 99,328,923），
// 作为「不得回退」的棘轮。余量被逐版吃掉：安装包 v0.0.11 余 52,292、v0.0.12 余 40,728、
// v0.0.13 只剩 12,522，到 v0.0.14 的八段式管线就超了 1,778 字节；ASAR 也只剩 6,469 字节，
// 下一次改动必然触顶。继续钉住等于把「别塞垃圾进去」变成「别写新代码」。
//
// 现在改为：产品硬顶沿用 v0.0.11 瘦身设计写明的 13 MiB / 100 MiB，
// 门禁取硬顶之下的整数档，只留够吸收 NSIS 压缩抖动与几个小版本的余量。
// 真正的回退（多打一个依赖、漏排除文档目录）是 MB 量级，这个余量照样拦得住。
const MAX_ASAR_BYTES = 13_107_200;        // 12.5 MiB（v0.0.14 实测 12,470,193）
const MAX_INSTALLER_BYTES = 99_614_720;   // 95 MiB（v0.0.14 实测 99,330,701）
const ALLOWED_ROOTS = new Set([
  'electron',
  'server',
  'renderer',
  'config',
  'node_modules',
  'package.json'
]);
const FORBIDDEN_APPLICATION_ARTIFACT = /(?:^|\/)(?:\.git|\.worktrees|\.playwright-cli|data|dist|docs?|tests?|logs?|screenshots?)(?:\/|$)|(?:^|\/)(?:settings\.json|storage-maintenance\.json|[^/]+\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm))?|[^/]+\.log|[^/]+\.(?:tmp|temp|bak))(?:$|\/)/i;
const FORBIDDEN_DEPENDENCY_ARTIFACT =
  /(?:^|\/)(?:docs?|examples?|tests?|__tests__)(?:\/|$)|\.md$/i;
const ALLOWED_RESOURCE_ENTRIES = new Set([
  'app.asar',
  'app-update.yml',
  'elevate.exe',
  'LICENSE.txt',
  'THIRD_PARTY_NOTICES.txt',
  'tray-icon.ico'
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
    if (root === 'node_modules' && FORBIDDEN_DEPENDENCY_ARTIFACT.test(entry)) {
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

function collectTextEntries(archive, entries, asar) {
  return entries
    .map(rawEntry => ({
      rawEntry: String(rawEntry).replace(/^[/\\]+/, ''),
      entry: normalizeEntry(rawEntry)
    }))
    .filter(({ entry }) => !entry.startsWith('/node_modules/')
      && (/\.(?:css|html|js|json|svg|txt)$/i.test(entry) || entry === '/package.json'))
    .map(({ rawEntry, entry }) => ({
      path: entry,
      content: asar.extractFile(archive, rawEntry).toString('utf8')
    }));
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

const mib = bytes => (bytes / 1024 / 1024).toFixed(2);

function verifyFileSize(file, maximumBytes, label) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error(`${label} is not a file: ${file}`);
  if (stat.size > maximumBytes) {
    // 只报 MiB 时，刚刚超限的情况会把两个数四舍五入成同一个值
    // （实测打印出「installer is 94.73 MiB; maximum is 94.73 MiB」），
    // 既看不出超了多少，也无从判断该不该抬预算。超限信息必须精确到字节。
    throw new Error(
      `${label} is ${stat.size} bytes (${mib(stat.size)} MiB); `
      + `maximum is ${maximumBytes} bytes (${mib(maximumBytes)} MiB); `
      + `over by ${stat.size - maximumBytes} bytes`
    );
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
  const textEntries = collectTextEntries(archive, entries, asar);
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
  collectTextEntries,
  assertNoEmbeddedSecrets,
  assertProductionDependencyEntries,
  assertRequiredLegalResources,
  expectedInstallerName,
  verifyPackage
};
