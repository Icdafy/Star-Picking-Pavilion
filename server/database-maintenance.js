'use strict';

const fs = require('node:fs');
const path = require('node:path');

const AUTO_COMPACT_MIN_BYTES = 64 * 1024 * 1024;
const AUTO_COMPACT_MIN_RATIO = 0.25;
const AUTO_COMPACT_INTERVAL_MS = 30 * 86_400_000;
const COMPACT_FREE_SPACE_RESERVE_BYTES = 64 * 1024 * 1024;

class DatabaseIntegrityError extends Error {
  constructor(detail = 'unknown') {
    super(`数据库完整性检查失败：${detail}`);
    this.name = 'DatabaseIntegrityError';
    this.code = 'database-integrity';
  }
}

function describeDatabaseMaintenanceError(error) {
  if (error instanceof DatabaseIntegrityError || error?.code === 'database-integrity') {
    return {
      statusCode: 409,
      body: {
        ok: false,
        code: 'database-integrity',
        error: '数据库完整性检查未通过，已停止压缩。请先备份数据并查看运行日志。'
      }
    };
  }
  return {
    statusCode: 500,
    body: {
      ok: false,
      code: 'database-maintenance-failed',
      error: '数据库压缩未完成，请稍后重试；若持续失败，请先备份数据并查看运行日志。'
    }
  };
}

function pragmaNumber(database, name) {
  const row = database.prepare(`PRAGMA ${name}`).get();
  const value = Number(row?.[name]);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function statBytes(file, statSync = fs.statSync) {
  try {
    const stat = statSync(file);
    return stat.isFile() ? Number(stat.size) || 0 : 0;
  } catch {
    return 0;
  }
}

function databaseStorageSnapshot({ database, databasePath, statSync = fs.statSync } = {}) {
  if (!database || !databasePath) throw new TypeError('database and databasePath are required');
  const pageCount = pragmaNumber(database, 'page_count');
  const pageSize = pragmaNumber(database, 'page_size');
  const freelistCount = pragmaNumber(database, 'freelist_count');
  const allocatedBytes = pageCount * pageSize;
  const reclaimableBytes = freelistCount * pageSize;
  const mainFileBytes = statBytes(databasePath, statSync);
  const walBytes = statBytes(`${databasePath}-wal`, statSync);
  const shmBytes = statBytes(`${databasePath}-shm`, statSync);
  return {
    fileBytes: mainFileBytes + walBytes + shmBytes,
    mainFileBytes,
    walBytes,
    shmBytes,
    allocatedBytes,
    reclaimableBytes,
    reclaimableRatio: allocatedBytes > 0 ? reclaimableBytes / allocatedBytes : 0
  };
}

function readMeta(database, key) {
  return database.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value || null;
}

function writeMeta(database, key, value) {
  database.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

function assertHealthy(database) {
  const result = database.prepare('PRAGMA quick_check').get();
  if (result?.quick_check !== 'ok') {
    throw new DatabaseIntegrityError(result?.quick_check || 'unknown');
  }
}

function checkpointWal(database) {
  const row = database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() || {};
  return {
    busy: Number(row.busy) || 0,
    log: Number(row.log) || 0,
    checkpointed: Number(row.checkpointed) || 0
  };
}

function shouldAutoCompact({
  reclaimableBytes,
  reclaimableRatio,
  lastCompactionAt,
  nowMs = Date.now()
} = {}) {
  const previous = Date.parse(lastCompactionAt || '');
  return Number(reclaimableBytes) >= AUTO_COMPACT_MIN_BYTES
    && Number(reclaimableRatio) >= AUTO_COMPACT_MIN_RATIO
    && (!Number.isFinite(previous) || nowMs - previous >= AUTO_COMPACT_INTERVAL_MS);
}

function availableBytesForPath(databasePath, statfsSync = fs.statfsSync) {
  const volume = statfsSync(path.dirname(databasePath));
  const blocks = Number(volume.bavail ?? volume.bfree);
  const blockSize = Number(volume.bsize);
  const bytes = blocks * blockSize;
  return Number.isFinite(bytes) && bytes >= 0 ? bytes : 0;
}

function compactDatabase({
  database,
  databasePath,
  mode = 'manual',
  availableBytes,
  nowMs = Date.now(),
  statSync = fs.statSync,
  statfsSync = fs.statfsSync
} = {}) {
  if (!['manual', 'auto'].includes(mode)) throw new TypeError('mode must be manual or auto');
  const before = databaseStorageSnapshot({ database, databasePath, statSync });
  const lastCompactionAt = readMeta(database, 'lastCompactionAt');
  if (mode === 'auto' && !shouldAutoCompact({ ...before, lastCompactionAt, nowMs })) {
    return { skipped: true, reason: 'threshold', before, after: before };
  }

  assertHealthy(database);
  const checkpoint = checkpointWal(database);
  const afterCheckpoint = databaseStorageSnapshot({ database, databasePath, statSync });
  if (checkpoint.busy !== 0) {
    return {
      skipped: true,
      reason: 'checkpoint-busy',
      checkpoint,
      before,
      after: afterCheckpoint
    };
  }
  const freeBytes = availableBytes == null
    ? availableBytesForPath(databasePath, statfsSync)
    : Number(availableBytes);
  const requiredBytes = afterCheckpoint.mainFileBytes * 2 + COMPACT_FREE_SPACE_RESERVE_BYTES;
  if (!Number.isFinite(freeBytes) || freeBytes < requiredBytes) {
    return {
      skipped: true,
      reason: 'space',
      requiredBytes,
      availableBytes: Number.isFinite(freeBytes) ? freeBytes : 0,
      before,
      after: afterCheckpoint
    };
  }

  const started = Date.now();
  database.exec('VACUUM');
  assertHealthy(database);
  const completedAt = new Date(nowMs).toISOString();
  writeMeta(database, 'lastCompactionAt', completedAt);
  const after = databaseStorageSnapshot({ database, databasePath, statSync });
  return {
    skipped: false,
    completedAt,
    durationMs: Math.max(0, Date.now() - started),
    reclaimedBytes: Math.max(0, before.fileBytes - after.fileBytes),
    before,
    after
  };
}

function optimizeDatabase({ database, nowMs = Date.now() } = {}) {
  database.exec('PRAGMA optimize');
  const at = new Date(nowMs).toISOString();
  writeMeta(database, 'lastOptimizeAt', at);
  return { optimized: true, at };
}

module.exports = {
  AUTO_COMPACT_INTERVAL_MS,
  AUTO_COMPACT_MIN_BYTES,
  AUTO_COMPACT_MIN_RATIO,
  COMPACT_FREE_SPACE_RESERVE_BYTES,
  DatabaseIntegrityError,
  assertHealthy,
  availableBytesForPath,
  checkpointWal,
  compactDatabase,
  databaseStorageSnapshot,
  describeDatabaseMaintenanceError,
  optimizeDatabase,
  readMeta,
  shouldAutoCompact,
  writeMeta
};
