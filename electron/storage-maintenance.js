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

function isInside(directory, target) {
  const root = path.resolve(directory);
  const resolved = path.resolve(target);
  const relative = path.relative(root, resolved);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
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

function entryBytes(target) {
  const stat = safeLstat(target);
  if (!stat || stat.isSymbolicLink()) return 0;
  if (stat.isFile()) return Number(stat.size) || 0;
  if (!stat.isDirectory()) return 0;
  let total = 0;
  for (const child of fs.readdirSync(target)) {
    total += entryBytes(path.join(target, child));
  }
  return total;
}

function fileSetBytes(databasePath) {
  return ['', '-wal', '-shm'].reduce((total, suffix) => {
    const file = `${databasePath}${suffix}`;
    const stat = safeLstat(file);
    return total + (stat?.isFile() && !stat.isSymbolicLink() ? Number(stat.size) || 0 : 0);
  }, 0);
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

function cacheSnapshot(userDataDir, softLimitBytes) {
  const entries = [];
  for (const name of MANAGED_CACHE_NAMES) {
    const target = path.join(userDataDir, name);
    const stat = safeLstat(target);
    if (!stat || stat.isSymbolicLink()) continue;
    entries.push({ name, bytes: entryBytes(target) });
  }
  entries.sort((left, right) => MANAGED_CACHE_NAMES.indexOf(left.name) - MANAGED_CACHE_NAMES.indexOf(right.name));
  return {
    bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    entries,
    softLimitBytes
  };
}

async function removeManagedCaches(userDataDir) {
  let bytes = 0;
  let removed = 0;
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
    const size = entryBytes(target);
    try {
      await fs.promises.rm(target, { recursive: stat.isDirectory(), force: true });
      bytes += size;
      removed++;
    } catch (error) {
      failures.push({ name, reason: String(error.code || error.message || error) });
    }
  }
  return { bytes, removed, failures };
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
    entries.push({ name, path: target, bytes: Number(stat.size) || 0, ageMs });
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

function candidateId(databasePath) {
  return `legacy-${crypto.createHash('sha256').update(path.resolve(databasePath)).digest('hex').slice(0, 12)}`;
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

  function nowMs() {
    return now().getTime();
  }

  function legacySnapshot() {
    if (!isPackaged || !appDataDir || !healthyDatabase(canonical)) {
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
      if (repoDataDir && (samePath(databasePath, repoDataDir) || isInside(repoDataDir, databasePath))) continue;
      let eligible = true;
      let reason = null;
      if (!manifestValid || !samePath(manifest.source, databasePath)) {
        eligible = false;
        reason = 'not-migrated-source';
      } else if (!Number.isFinite(migratedAt) || nowMs() - migratedAt < LEGACY_GRACE_MS) {
        eligible = false;
        reason = 'grace-period';
      } else if (!healthyDatabase(databasePath)) {
        eligible = false;
        reason = 'invalid-database';
      }
      candidates.push({
        id: candidateId(databasePath),
        path: databasePath,
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
    const cache = cacheSnapshot(userDataDir, cacheLimitBytes);
    cache.pendingRestart = state.pendingStartupCacheClear;
    return {
      cache,
      migrationResidue: migrationResidueSnapshot(userDataDir, nowMs()),
      legacy: legacySnapshot()
    };
  }

  async function prepareBeforeReady() {
    const state = await readState(userDataDir);
    const cache = cacheSnapshot(userDataDir, cacheLimitBytes);
    const previous = Date.parse(state.lastAutoCacheClearAt || '');
    let reason = 'below-limit';
    if (state.pendingStartupCacheClear) reason = 'pending';
    else if (cache.bytes > cacheLimitBytes
      && Number.isFinite(previous)
      && nowMs() - previous < CACHE_AUTO_INTERVAL_MS) reason = 'interval';
    else if (cache.bytes > cacheLimitBytes) reason = 'automatic';

    if (!['pending', 'automatic'].includes(reason)) {
      return { cleared: false, reason, removedBytes: 0, failures: [] };
    }
    const result = await removeManagedCaches(userDataDir);
    const at = new Date(nowMs()).toISOString();
    const updated = {
      ...state,
      lastCacheClearAt: at,
      lastAutoCacheClearAt: reason === 'automatic' ? at : state.lastAutoCacheClearAt,
      pendingStartupCacheClear: false
    };
    await writeState(userDataDir, updated);
    return {
      cleared: result.failures.length === 0,
      reason,
      removedBytes: result.bytes,
      failures: result.failures
    };
  }

  async function initializeAfterMigration() {
    if (!fs.existsSync(canonical)) return { removedMigrationResidue: { files: 0, bytes: 0 } };
    quickCheck(canonical);
    const stale = migrationResidueSnapshot(userDataDir, nowMs(), true);
    let files = 0;
    let bytes = 0;
    for (const entry of stale.entries) {
      if (!samePath(path.dirname(entry.path), userDataDir) || !TEMPORARY_PATTERN.test(entry.name)) continue;
      await fs.promises.rm(entry.path, { force: true });
      files++;
      bytes += entry.bytes;
    }
    return { removedMigrationResidue: { files, bytes } };
  }

  async function clearCache() {
    await session?.clearCache?.();
    await session?.clearCodeCaches?.({});
    const state = await readState(userDataDir);
    const at = new Date(nowMs()).toISOString();
    await writeState(userDataDir, {
      ...state,
      lastCacheClearAt: at,
      pendingStartupCacheClear: true
    });
    return { clearedSession: true, pendingRestart: true, at };
  }

  async function deleteLegacy(id) {
    const initial = legacySnapshot().candidates.find(candidate => candidate.id === id);
    if (!initial?.eligible) throw new Error('旧版数据库不存在或不可清理');
    if (!await confirm(initial)) return { cancelled: true, deleted: false };
    const candidate = legacySnapshot().candidates.find(value => value.id === id);
    if (!candidate?.eligible) throw new Error('旧版数据库状态已变化，无法清理');
    let deletedFiles = 0;
    let deletedBytes = 0;
    for (const suffix of ['-wal', '-shm', '']) {
      const target = `${candidate.path}${suffix}`;
      const stat = safeLstat(target);
      if (!stat) continue;
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error('旧版数据库包含不安全的文件类型，已停止清理');
      }
      await fs.promises.rm(target);
      deletedFiles++;
      deletedBytes += Number(stat.size) || 0;
    }
    return { cancelled: false, deleted: true, deletedFiles, deletedBytes };
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
