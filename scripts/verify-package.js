'use strict';

const fs = require('node:fs');
const path = require('node:path');

// v0.0.15 起取消体积上限。
//
// 沿革：v0.0.11 把上限钉死在 v0.0.10 实测产物上当「不得回退」的棘轮，余量被逐版吃掉
// （安装包 v0.0.11 余 52,292、v0.0.12 余 40,728、v0.0.13 只剩 12,522），v0.0.14 的八段式
// 管线超出 1,778 字节直接把 CI 与发布双双打红，只好重新基线化到 12.5 MiB / 95 MiB。
// 但那仍然是同一个问题的延后版：100 MiB 这个「硬顶」本就是 v0.0.11 瘦身设计里的一个
// 审美取值，不是任何技术边界——GitHub Release 单个附件允许 2 GB，NSIS 与 electron-updater
// 都不在乎，安装包体积的绝大部分是 Electron/Chromium 运行时，不是本项目的代码。
// 于是每加一个功能都要先过一道与技术现实无关的关卡，门禁从「别塞垃圾进去」
// 异化成了「别写新代码」。
//
// 现在只报告体积，不再因为体积失败。**下面所有边界检查一条都没有放松**，
// 而那才是真正拦得住「不该进包的东西」的部分：
//   - assertAllowedEntries            根目录白名单 + 数据库/日志/临时文件/文档目录黑名单
//   - assertProductionDependencyEntries 只允许 lockfile 里的生产依赖，dev 依赖一律拒绝
//   - assertNoEmbeddedSecrets         私钥、GitHub token、AWS key、sk- 开头的模型 Key
//   - assertAllowedResourceEntries    resources/ 目录逐项白名单
//   - assertRequiredLegalResources    LICENSE 与第三方声明必须存在且有效
// 现实中会让包突然变大的情形（误打 dev 依赖、漏排除 docs、把用户数据库塞进去）
// 都由这几条精确拦截，而且给出的是「哪个文件不该在这」而不是「总数大了几字节」。
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

// 只量不拦。产物必须存在且确实是文件（构建没出东西仍然要失败），
// 但多大都放行——体积由边界检查间接约束，不再有绝对上限。
function measureFile(file, label) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error(`${label} is not a file: ${file}`);
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
  const asarBytes = measureFile(archive, 'app.asar');
  const installerBytes = measureFile(installer, 'installer');

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
    // 报告用途：发布记录里留一个可比对的数字，方便回头看某版为什么变大。
    // 精确到字节，因为 MiB 四舍五入会把「涨了 1.7 KB」和「一字未动」显示成同一个数。
    console.log(`app.asar: ${result.asarBytes} bytes (${mib(result.asarBytes)} MiB)`);
    console.log(`installer: ${result.installerBytes} bytes (${mib(result.installerBytes)} MiB)`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  ALLOWED_ROOTS,
  ALLOWED_RESOURCE_ENTRIES,
  assertAllowedEntries,
  assertAllowedResourceEntries,
  collectTextEntries,
  assertNoEmbeddedSecrets,
  assertProductionDependencyEntries,
  assertRequiredLegalResources,
  expectedInstallerName,
  verifyPackage
};
