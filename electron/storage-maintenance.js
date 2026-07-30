'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  CANONICAL_DATABASE,
  LEGACY_DATABASE,
  MANIFEST,
  quickCheck
} = require('./user-data-migration');

const MANAGED_CACHE_NAMES = Object.freeze([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnWebGPUCache',
  'DawnGraphiteCache'
]);
const CACHE_SOFT_LIMIT_BYTES = 256 * 1024 * 1024;
const CACHE_AUTO_INTERVAL_MS = 7 * 86_400_000;
const LEGACY_GRACE_MS = 30 * 86_400_000;
const MIGRATION_TEMP_MAX_AGE_MS = 7 * 86_400_000;
const STATE_FILE = 'storage-maintenance.json';
const TEMPORARY_PATTERN =
  /^star-picking-pavilion\.db\.backup-\d+-[0-9a-f]{12}\.tmp(?:-(?:wal|shm))?$/;

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function sameOrInside(directory, target) {
  const root = path.resolve(directory);
  const resolved = path.resolve(target);
  const relative = path.relative(root, resolved);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isDirectManagedPath(userDataDir, target) {
  const resolved = path.resolve(target);
  return samePath(path.dirname(resolved), userDataDir)
    && MANAGED_CACHE_NAMES.includes(path.basename(resolved));
}

function safeLstat(target) {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

function safeRealpath(target) {
  try {
    return fs.realpathSync.native(target);
  } catch {
    return null;
  }
}

function errorReason(error) {
  return String(error?.code || error?.message || error || 'unknown');
}

function physicalPathSafety({ trustedRoot, target, excludedRoot = null }) {
  const root = path.resolve(trustedRoot);
  const resolved = path.resolve(target);
  if (!sameOrInside(root, resolved)) {
    return { safe: false, reason: 'outside-trusted-root' };
  }

  const relative = path.relative(root, resolved);
  let cursor = root;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    const stat = safeLstat(cursor);
    if (!stat) return { safe: false, reason: 'missing-path-component' };
    if (stat.isSymbolicLink()) return { safe: false, reason: 'reparse-point' };
  }

  const physicalRoot = safeRealpath(root);
  const physicalTarget = safeRealpath(resolved);
  if (!physicalRoot || !physicalTarget || !sameOrInside(physicalRoot, physicalTarget)) {
    return { safe: false, reason: 'physical-boundary' };
  }

  if (excludedRoot) {
    const physicalExcluded = safeRealpath(excludedRoot);
    if (physicalExcluded && sameOrInside(physicalExcluded, physicalTarget)) {
      return { safe: false, reason: 'development-data' };
    }
  }
  return { safe: true, physicalPath: physicalTarget };
}

function scanEntry(target) {
  const stat = safeLstat(target);
  if (!stat) return { bytes: 0, failures: [{ path: target, reason: 'missing' }] };
  if (stat.isSymbolicLink()) {
    return { bytes: 0, failures: [{ path: target, reason: 'reparse-point' }] };
  }
  if (stat.isFile()) return { bytes: Number(stat.size) || 0, failures: [] };
  if (!stat.isDirectory()) {
    return { bytes: 0, failures: [{ path: target, reason: 'unsupported-entry' }] };
  }
  let names;
  try {
    names = fs.readdirSync(target);
  } catch (error) {
    return { bytes: 0, failures: [{ path: target, reason: errorReason(error) }] };
  }
  let total = 0;
  const failures = [];
  for (const child of names) {
    const result = scanEntry(path.join(target, child));
    total += result.bytes;
    failures.push(...result.failures);
  }
  return { bytes: total, failures };
}

function fileSetBytes(databasePath) {
  return ['', '-wal', '-shm'].reduce((total, suffix) => {
    const file = `${databasePath}${suffix}`;
    const stat = safeLstat(file);
    return total + (stat?.isFile() && !stat.isSymbolicLink() ? Number(stat.size) || 0 : 0);
  }, 0);
}

function databaseFiles(databasePath) {
  const files = [];
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${databasePath}${suffix}`;
    const stat = safeLstat(file);
    if (stat?.isFile() && !stat.isSymbolicLink()) files.push(file);
  }
  return files;
}

function defaultState() {
  return {
    version: 1,
    lastCacheClearAt: null,
    lastAutoCacheClearAt: null,
    pendingStartupCacheClear: false
  };
}

function normalizeState(value) {
  const defaults = defaultState();
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) return defaults;
  return {
    version: 1,
    lastCacheClearAt: typeof value.lastCacheClearAt === 'string' ? value.lastCacheClearAt : null,
    lastAutoCacheClearAt: typeof value.lastAutoCacheClearAt === 'string'
      ? value.lastAutoCacheClearAt
      : null,
    pendingStartupCacheClear: value.pendingStartupCacheClear === true
  };
}

async function readState(userDataDir) {
  try {
    return normalizeState(JSON.parse(
      await fs.promises.readFile(path.join(userDataDir, STATE_FILE), 'utf8')
    ));
  } catch {
    return defaultState();
  }
}

async function writeState(userDataDir, state) {
  await fs.promises.mkdir(userDataDir, { recursive: true });
  const destination = path.join(userDataDir, STATE_FILE);
  const temporary = `${destination}.write-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.promises.writeFile(temporary, JSON.stringify(normalizeState(state), null, 2), 'utf8');
    await fs.promises.rename(temporary, destination);
  } catch (error) {
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function cacheSnapshot(
  userDataDir,
  softLimitBytes,
  repoDataDir = null,
  trustedRoot = userDataDir
) {
  const entries = [];
  const failures = [];
  for (const name of MANAGED_CACHE_NAMES) {
    const target = path.join(userDataDir, name);
    const stat = safeLstat(target);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      failures.push({ name, reason: 'reparse-point' });
      continue;
    }
    const safety = physicalPathSafety({
      trustedRoot,
      target,
      excludedRoot: repoDataDir
    });
    if (!safety.safe) {
      failures.push({ name, reason: safety.reason });
      continue;
    }
    const scanned = scanEntry(target);
    entries.push({ name, bytes: scanned.bytes });
    failures.push(...scanned.failures.map(failure => ({ name, reason: failure.reason })));
  }
  entries.sort((left, right) => MANAGED_CACHE_NAMES.indexOf(left.name) - MANAGED_CACHE_NAMES.indexOf(right.name));
  return {
    bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    entries,
    failures,
    softLimitBytes
  };
}

async function removeManagedCaches(
  userDataDir,
  repoDataDir = null,
  trustedRoot = userDataDir
) {
  let bytes = 0;
  let removed = 0;
  let failedBytes = 0;
  const failures = [];
  for (const name of MANAGED_CACHE_NAMES) {
    const target = path.join(userDataDir, name);
    if (!isDirectManagedPath(userDataDir, target)) continue;
    const stat = safeLstat(target);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      failures.push({ name, reason: 'symbolic-link' });
      continue;
    }
    const safety = physicalPathSafety({
      trustedRoot,
      target,
      excludedRoot: repoDataDir
    });
    if (!safety.safe) {
      failures.push({ name, reason: safety.reason });
      continue;
    }
    const scanned = scanEntry(target);
    const size = scanned.bytes;
    if (scanned.failures.length) {
      failedBytes += size;
      failures.push(...scanned.failures.map(failure => ({ name, reason: failure.reason })));
      continue;
    }
    try {
      await fs.promises.rm(target, { recursive: stat.isDirectory(), force: true });
      bytes += size;
      removed++;
    } catch (error) {
      failedBytes += size;
      failures.push({ name, reason: errorReason(error) });
    }
  }
  return { bytes, removed, failedBytes, failures };
}

function migrationResidueSnapshot(userDataDir, nowMs, staleOnly = false) {
  const entries = [];
  let names = [];
  try { names = fs.readdirSync(userDataDir); } catch {}
  for (const name of names) {
    if (!TEMPORARY_PATTERN.test(name)) continue;
    const target = path.join(userDataDir, name);
    const stat = safeLstat(target);
    if (!stat?.isFile() || stat.isSymbolicLink()) continue;
    const ageMs = nowMs - stat.mtimeMs;
    if (staleOnly && ageMs <= MIGRATION_TEMP_MAX_AGE_MS) continue;
    entries.push({
      name,
      path: target,
      bytes: Number(stat.size) || 0,
      ageMs,
      identity: fileIdentity(target)
    });
  }
  return {
    bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    files: entries.length,
    entries
  };
}

function readManifest(userDataDir) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(userDataDir, MANIFEST), 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function healthyDatabase(databasePath) {
  try {
    quickCheck(databasePath);
    return true;
  } catch {
    return false;
  }
}

function fileIdentity(file) {
  try {
    const stat = fs.lstatSync(file, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const physicalPath = safeRealpath(file);
    if (!physicalPath) return null;
    return {
      path: path.resolve(physicalPath).toLowerCase(),
      dev: String(stat.dev),
      ino: String(stat.ino),
      size: String(stat.size),
      mtimeNs: String(stat.mtimeNs),
      ctimeNs: String(stat.ctimeNs),
      birthtimeNs: String(stat.birthtimeNs)
    };
  } catch {
    return null;
  }
}

function fingerprintFiles(files) {
  const identities = [];
  for (const file of files) {
    const identity = fileIdentity(file);
    if (!identity) return null;
    identities.push(identity);
  }
  return identities;
}

function candidateId(files, identities) {
  const fingerprint = JSON.stringify({
    files: files.map(file => path.resolve(file).toLowerCase()),
    identities: identities.map((identity, index) => ({
      path: identity.path,
      dev: identity.dev,
      ino: identity.ino,
      size: identity.size,
      birthtimeNs: identity.birthtimeNs,
      ...(index === 0 ? { mtimeNs: identity.mtimeNs, ctimeNs: identity.ctimeNs } : {})
    }))
  });
  return `legacy-${crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 12)}`;
}

function sameFileObject(left, right) {
  if (!left || !right) return false;
  return ['dev', 'ino', 'size', 'mtimeNs', 'birthtimeNs']
    .every(key => left[key] === right[key]);
}

function sameConfirmedFile(left, right) {
  if (!left || !right) return false;
  return ['path', 'dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs']
    .every(key => left[key] === right[key]);
}

function sameConfirmedSet(leftFiles, leftIdentities, rightFiles, rightIdentities) {
  if (leftFiles.length !== rightFiles.length || leftIdentities.length !== rightIdentities.length) {
    return false;
  }
  return leftFiles.every((file, index) =>
    samePath(file, rightFiles[index])
    && sameConfirmedFile(leftIdentities[index], rightIdentities[index]));
}

async function rollbackStagedFiles(staged, { trustedRoot, excludedRoot = null } = {}) {
  const failures = [];
  for (const entry of staged.slice().reverse()) {
    if (!safeLstat(entry.stagedPath)) continue;
    if (safeLstat(entry.originalPath)) {
      failures.push({ name: path.basename(entry.originalPath), reason: 'rollback-target-exists' });
      continue;
    }
    const stagedSafety = physicalPathSafety({
      trustedRoot,
      target: entry.stagedPath,
      excludedRoot
    });
    const parentSafety = physicalPathSafety({
      trustedRoot,
      target: path.dirname(entry.originalPath),
      excludedRoot
    });
    if (!stagedSafety.safe || !parentSafety.safe
      || !sameFileObject(entry.expectedIdentity, fileIdentity(entry.stagedPath))) {
      failures.push({ name: path.basename(entry.originalPath), reason: 'unsafe-rollback-path' });
      continue;
    }
    try {
      await fs.promises.rename(entry.stagedPath, entry.originalPath);
    } catch (error) {
      failures.push({ name: path.basename(entry.originalPath), reason: errorReason(error) });
    }
  }
  return failures;
}

function createStorageMaintenanceController({
  userDataDir,
  appDataDir,
  repoDataDir,
  isPackaged,
  session,
  confirm = async () => false,
  cacheLimitBytes = CACHE_SOFT_LIMIT_BYTES,
  now = () => new Date()
} = {}) {
  if (!userDataDir) throw new TypeError('userDataDir is required');
  const canonical = path.join(userDataDir, CANONICAL_DATABASE);
  const cacheTrustedRoot = isPackaged && appDataDir ? appDataDir : userDataDir;

  function nowMs() {
    return now().getTime();
  }

  function legacySnapshot() {
    const canonicalSafety = appDataDir
      ? physicalPathSafety({
          trustedRoot: appDataDir,
          target: canonical,
          excludedRoot: repoDataDir
        })
      : { safe: false, reason: 'missing-app-data' };
    if (!isPackaged || !appDataDir || !canonicalSafety.safe || !healthyDatabase(canonical)) {
      return { bytes: 0, candidates: [] };
    }
    const manifest = readManifest(userDataDir);
    const manifestValid = manifest?.status === 'migrated'
      && typeof manifest.source === 'string'
      && typeof manifest.destination === 'string'
      && samePath(manifest.destination, canonical);
    const migratedAt = Date.parse(manifest?.timestamp || '');
    const known = [
      path.join(userDataDir, LEGACY_DATABASE),
      path.join(appDataDir, '捕风司', LEGACY_DATABASE)
    ];
    const candidates = [];
    for (const databasePath of known) {
      const stat = safeLstat(databasePath);
      if (!stat?.isFile() || stat.isSymbolicLink()) continue;
      const safety = physicalPathSafety({
        trustedRoot: appDataDir,
        target: databasePath,
        excludedRoot: repoDataDir
      });
      let eligible = true;
      let reason = null;
      if (!safety.safe) {
        eligible = false;
        reason = safety.reason;
      } else if (!manifestValid || !samePath(manifest.source, databasePath)) {
        eligible = false;
        reason = 'not-migrated-source';
      } else if (!Number.isFinite(migratedAt) || nowMs() - migratedAt < LEGACY_GRACE_MS) {
        eligible = false;
        reason = 'grace-period';
      } else if (!healthyDatabase(databasePath)) {
        eligible = false;
        reason = 'invalid-database';
      }
      const files = databaseFiles(databasePath);
      const identities = safety.safe ? fingerprintFiles(files) : null;
      if (!identities) {
        eligible = false;
        reason = 'identity-unavailable';
      }
      candidates.push({
        id: candidateId(files, identities || []),
        path: databasePath,
        files,
        identities,
        bytes: fileSetBytes(databasePath),
        migratedAt: Number.isFinite(migratedAt) ? new Date(migratedAt).toISOString() : null,
        eligible,
        reason
      });
    }
    return {
      bytes: candidates.reduce((total, candidate) => total + candidate.bytes, 0),
      candidates
    };
  }

  async function getSnapshot() {
    const state = await readState(userDataDir);
    const cache = cacheSnapshot(userDataDir, cacheLimitBytes, repoDataDir, cacheTrustedRoot);
    cache.pendingRestart = state.pendingStartupCacheClear;
    const legacy = legacySnapshot();
    const migrationResidue = migrationResidueSnapshot(userDataDir, nowMs());
    return {
      cache,
      migrationResidue: {
        ...migrationResidue,
        entries: migrationResidue.entries.map(({ identity, ...entry }) => entry)
      },
      legacy: {
        ...legacy,
        candidates: legacy.candidates.map(({ identities, ...candidate }) => candidate)
      }
    };
  }

  async function prepareBeforeReady() {
    try {
      const state = await readState(userDataDir);
      const cache = cacheSnapshot(userDataDir, cacheLimitBytes, repoDataDir, cacheTrustedRoot);
      const previous = Date.parse(state.lastAutoCacheClearAt || '');
      let reason = 'below-limit';
      if (state.pendingStartupCacheClear) reason = 'pending';
      else if (cache.bytes > cacheLimitBytes
        && Number.isFinite(previous)
        && nowMs() - previous < CACHE_AUTO_INTERVAL_MS) reason = 'interval';
      else if (cache.bytes > cacheLimitBytes) reason = 'automatic';

      if (!['pending', 'automatic'].includes(reason)) {
        return {
          cleared: false,
          reason,
          releasedBytes: 0,
          failedBytes: 0,
          pendingBytes: cache.bytes,
          failures: cache.failures
        };
      }
      const result = await removeManagedCaches(userDataDir, repoDataDir, cacheTrustedRoot);
      const after = cacheSnapshot(userDataDir, cacheLimitBytes, repoDataDir, cacheTrustedRoot);
      const succeeded = result.failures.length === 0;
      const at = new Date(nowMs()).toISOString();
      const updated = {
        ...state,
        lastCacheClearAt: succeeded || result.bytes > 0 ? at : state.lastCacheClearAt,
        lastAutoCacheClearAt: reason === 'automatic' && succeeded
          ? at
          : state.lastAutoCacheClearAt,
        pendingStartupCacheClear: reason === 'pending' && !succeeded
      };
      const failures = [...result.failures];
      try {
        await writeState(userDataDir, updated);
      } catch (error) {
        failures.push({ name: STATE_FILE, reason: errorReason(error) });
      }
      return {
        cleared: failures.length === 0,
        reason,
        releasedBytes: result.bytes,
        failedBytes: result.failedBytes,
        pendingBytes: after.bytes,
        failures
      };
    } catch (error) {
      return {
        cleared: false,
        reason: 'error',
        releasedBytes: 0,
        failedBytes: 0,
        pendingBytes: 0,
        failures: [{ name: 'cache-maintenance', reason: errorReason(error) }]
      };
    }
  }

  async function initializeAfterMigration() {
    if (!fs.existsSync(canonical)) {
      return { removedMigrationResidue: { files: 0, bytes: 0, failures: [] } };
    }
    const residueTrustedRoot = isPackaged && appDataDir ? appDataDir : userDataDir;
    const rootSafety = physicalPathSafety({
      trustedRoot: residueTrustedRoot,
      target: userDataDir,
      excludedRoot: repoDataDir
    });
    if (!rootSafety.safe) {
      return {
        removedMigrationResidue: {
          files: 0,
          bytes: 0,
          failures: [{ name: 'migration-residue', reason: rootSafety.reason }]
        }
      };
    }
    quickCheck(canonical);
    const stale = migrationResidueSnapshot(userDataDir, nowMs(), true);
    let files = 0;
    let bytes = 0;
    const failures = [];
    for (const entry of stale.entries) {
      if (!samePath(path.dirname(entry.path), userDataDir) || !TEMPORARY_PATTERN.test(entry.name)) continue;
      const safety = physicalPathSafety({
        trustedRoot: residueTrustedRoot,
        target: entry.path,
        excludedRoot: repoDataDir
      });
      const currentIdentity = safety.safe ? fileIdentity(entry.path) : null;
      if (!currentIdentity || !sameConfirmedFile(entry.identity, currentIdentity)) {
        failures.push({ name: entry.name, reason: safety.reason || 'identity-changed' });
        continue;
      }
      try {
        await fs.promises.rm(entry.path, { force: true });
        files++;
        bytes += entry.bytes;
      } catch (error) {
        failures.push({ name: entry.name, reason: errorReason(error) });
      }
    }
    return { removedMigrationResidue: { files, bytes, failures } };
  }

  async function clearCache() {
    const before = cacheSnapshot(userDataDir, cacheLimitBytes, repoDataDir, cacheTrustedRoot);
    const sessionOperations = [
      ['session-cache', () => session?.clearCache?.()],
      ['code-cache', () => session?.clearCodeCaches?.({})]
    ];
    const settled = await Promise.allSettled(
      sessionOperations.map(([, operation]) => Promise.resolve().then(operation))
    );
    const failures = settled.flatMap((result, index) => (
      result.status === 'rejected'
        ? [{ name: sessionOperations[index][0], reason: errorReason(result.reason) }]
        : []
    ));
    const after = cacheSnapshot(userDataDir, cacheLimitBytes, repoDataDir, cacheTrustedRoot);
    failures.push(...after.failures);
    const state = await readState(userDataDir);
    const at = new Date(nowMs()).toISOString();
    const shouldRetryAtStartup = after.bytes > 0 || after.failures.length > 0;
    let stateSaved = true;
    try {
      await writeState(userDataDir, {
        ...state,
        lastCacheClearAt: at,
        pendingStartupCacheClear: shouldRetryAtStartup
      });
    } catch (error) {
      stateSaved = false;
      failures.push({ name: STATE_FILE, reason: errorReason(error) });
    }
    return {
      clearedSession: settled.every(result => result.status === 'fulfilled'),
      pendingRestart: shouldRetryAtStartup && stateSaved,
      at,
      releasedBytes: Math.max(0, before.bytes - after.bytes),
      failedBytes: after.failures.length > 0 ? after.bytes : 0,
      pendingBytes: after.bytes,
      failures
    };
  }

  async function deleteLegacy(id) {
    const initial = legacySnapshot().candidates.find(candidate => candidate.id === id);
    if (!initial?.eligible) throw new Error('旧版数据库不存在或不可清理');
    if (!await confirm(initial)) return { cancelled: true, deleted: false };
    const postConfirmSafety = physicalPathSafety({
      trustedRoot: appDataDir,
      target: initial.path,
      excludedRoot: repoDataDir
    });
    const postConfirmFiles = postConfirmSafety.safe ? databaseFiles(initial.path) : [];
    const postConfirmIdentities = postConfirmSafety.safe
      ? fingerprintFiles(postConfirmFiles)
      : null;
    if (!postConfirmIdentities || !sameConfirmedSet(
      initial.files,
      initial.identities,
      postConfirmFiles,
      postConfirmIdentities
    )) {
      throw new Error('旧版数据库状态已变化，请重新确认后再清理');
    }
    const candidate = legacySnapshot().candidates.find(value => value.id === id);
    if (!candidate?.eligible || candidate.id !== initial.id) {
      throw new Error('旧版数据库状态已变化，请重新确认后再清理');
    }

    const finalSafety = physicalPathSafety({
      trustedRoot: appDataDir,
      target: candidate.path,
      excludedRoot: repoDataDir
    });
    const finalIdentities = finalSafety.safe ? fingerprintFiles(candidate.files) : null;
    if (!finalIdentities || candidateId(candidate.files, finalIdentities) !== candidate.id) {
      throw new Error('旧版数据库状态已变化，请重新确认后再清理');
    }

    const token = crypto.randomBytes(6).toString('hex');
    const staged = [];
    try {
      for (let index = 0; index < candidate.files.length; index++) {
        const originalPath = candidate.files[index];
        const expectedIdentity = candidate.identities[index];
        const stagedPath = `${originalPath}.delete-${token}.tmp`;
        const safety = physicalPathSafety({
          trustedRoot: appDataDir,
          target: originalPath,
          excludedRoot: repoDataDir
        });
        const currentIdentity = safety.safe ? fileIdentity(originalPath) : null;
        if (!currentIdentity || !sameFileObject(expectedIdentity, currentIdentity)) {
          throw new Error('旧版数据库在清理过程中发生变化');
        }
        if (safeLstat(stagedPath)) throw new Error('旧版数据库暂存路径已存在');
        await fs.promises.rename(originalPath, stagedPath);
        const stagedEntry = {
          originalPath,
          stagedPath,
          bytes: Number(expectedIdentity.size) || 0,
          isMain: samePath(originalPath, candidate.path),
          expectedIdentity
        };
        staged.push(stagedEntry);
        const stagedIdentity = fileIdentity(stagedPath);
        if (!sameFileObject(expectedIdentity, stagedIdentity)) {
          throw new Error('旧版数据库在清理过程中发生变化');
        }
      }
    } catch (error) {
      const rollbackFailures = await rollbackStagedFiles(staged, {
        trustedRoot: appDataDir,
        excludedRoot: repoDataDir
      });
      const detail = rollbackFailures.length ? `；${rollbackFailures.length} 个文件回滚失败` : '';
      throw new Error(`旧版数据库未删除：${error.message}${detail}`);
    }

    const deletedEntries = [];
    const failedEntries = [];
    const main = staged.find(entry => entry.isMain);
    const sidecars = staged.filter(entry => !entry.isMain);
    try {
      const safety = physicalPathSafety({
        trustedRoot: appDataDir,
        target: main.stagedPath,
        excludedRoot: repoDataDir
      });
      if (!safety.safe) throw new Error(`unsafe staged path: ${safety.reason}`);
      await fs.promises.rm(main.stagedPath);
      deletedEntries.push({ name: path.basename(main.originalPath), bytes: main.bytes });
    } catch (error) {
      failedEntries.push({
        name: path.basename(main.originalPath),
        bytes: main.bytes,
        reason: errorReason(error)
      });
      const rollbackFailures = await rollbackStagedFiles(staged, {
        trustedRoot: appDataDir,
        excludedRoot: repoDataDir
      });
      failedEntries.push(...rollbackFailures.map(failure => ({ ...failure, bytes: 0 })));
      return {
        cancelled: false,
        deleted: false,
        deletedFiles: 0,
        deletedBytes: 0,
        failedFiles: failedEntries,
        failedBytes: candidate.bytes,
        pendingBytes: candidate.bytes
      };
    }

    for (const entry of sidecars) {
      try {
        const safety = physicalPathSafety({
          trustedRoot: appDataDir,
          target: entry.stagedPath,
          excludedRoot: repoDataDir
        });
        if (!safety.safe) throw new Error(`unsafe staged path: ${safety.reason}`);
        await fs.promises.rm(entry.stagedPath);
        deletedEntries.push({ name: path.basename(entry.originalPath), bytes: entry.bytes });
      } catch (error) {
        failedEntries.push({
          name: path.basename(entry.originalPath),
          bytes: entry.bytes,
          reason: errorReason(error)
        });
      }
    }
    const deletedBytes = deletedEntries.reduce((total, entry) => total + entry.bytes, 0);
    const failedBytes = failedEntries.reduce((total, entry) => total + (entry.bytes || 0), 0);
    return {
      cancelled: false,
      deleted: true,
      deletedFiles: deletedEntries.length,
      deletedBytes,
      deletedEntries,
      failedFiles: failedEntries,
      failedBytes,
      pendingBytes: failedBytes
    };
  }

  return {
    clearCache,
    deleteLegacy,
    getSnapshot,
    initializeAfterMigration,
    prepareBeforeReady
  };
}

module.exports = {
  CACHE_AUTO_INTERVAL_MS,
  CACHE_SOFT_LIMIT_BYTES,
  LEGACY_GRACE_MS,
  MANAGED_CACHE_NAMES,
  MIGRATION_TEMP_MAX_AGE_MS,
  STATE_FILE,
  createStorageMaintenanceController,
  isDirectManagedPath
};
