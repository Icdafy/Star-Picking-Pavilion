'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const {
  CACHE_AUTO_INTERVAL_MS,
  MANAGED_CACHE_NAMES,
  MIGRATION_TEMP_MAX_AGE_MS,
  createStorageMaintenanceController,
  isDirectManagedPath
} = require('../electron/storage-maintenance');

function createDatabase(file, value = 'ok') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const database = new DatabaseSync(file);
  database.exec('CREATE TABLE entries (value TEXT NOT NULL)');
  database.prepare('INSERT INTO entries (value) VALUES (?)').run(value);
  database.close();
}

function writeSizedFile(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes, 1));
}

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-storage-maintenance-'));
  const appDataDir = path.join(root, 'Roaming');
  const userDataDir = path.join(appDataDir, '摘星阁');
  const repoDataDir = path.join(root, 'repo-data');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(repoDataDir, { recursive: true });
  return { root, appDataDir, userDataDir, repoDataDir };
}

test('managed cache accounting uses a fixed direct-child whitelist', async t => {
  const box = sandbox();
  t.after(() => fs.rmSync(box.root, { recursive: true, force: true }));
  writeSizedFile(path.join(box.userDataDir, 'Cache', 'http.bin'), 20);
  writeSizedFile(path.join(box.userDataDir, 'GPUCache', 'gpu.bin'), 30);
  writeSizedFile(path.join(box.userDataDir, 'Local Storage', 'keep.bin'), 40);
  writeSizedFile(path.join(box.userDataDir, 'Cache-copy', 'keep.bin'), 50);

  const controller = createStorageMaintenanceController({
    ...box,
    isPackaged: true,
    cacheLimitBytes: 1024
  });
  const snapshot = await controller.getSnapshot();

  assert.deepEqual(snapshot.cache.entries, [
    { name: 'Cache', bytes: 20 },
    { name: 'GPUCache', bytes: 30 }
  ]);
  assert.equal(snapshot.cache.bytes, 50);
  assert.equal(snapshot.cache.softLimitBytes, 1024);
  assert.equal(snapshot.cache.pendingRestart, false);
  assert.equal(isDirectManagedPath(box.userDataDir, path.join(box.userDataDir, 'Cache')), true);
  assert.equal(isDirectManagedPath(box.userDataDir, path.join(box.userDataDir, 'Cache', 'nested')), false);
  assert.equal(isDirectManagedPath(box.userDataDir, path.join(box.userDataDir, 'Local Storage')), false);
  assert.equal(MANAGED_CACHE_NAMES.includes('Local Storage'), false);
});

test('automatic cache cleanup observes both the size threshold and seven-day interval', async t => {
  const box = sandbox();
  t.after(() => fs.rmSync(box.root, { recursive: true, force: true }));
  const nowMs = Date.parse('2026-07-30T00:00:00.000Z');
  writeSizedFile(path.join(box.userDataDir, 'Cache', 'large.bin'), 20);
  writeSizedFile(path.join(box.userDataDir, 'Local Storage', 'keep.bin'), 20);

  const controller = createStorageMaintenanceController({
    ...box,
    isPackaged: true,
    cacheLimitBytes: 10,
    now: () => new Date(nowMs)
  });
  const first = await controller.prepareBeforeReady();
  assert.equal(first.cleared, true);
  assert.equal(first.reason, 'automatic');
  assert.equal(fs.existsSync(path.join(box.userDataDir, 'Cache')), false);
  assert.equal(fs.existsSync(path.join(box.userDataDir, 'Local Storage', 'keep.bin')), true);

  writeSizedFile(path.join(box.userDataDir, 'Cache', 'large-again.bin'), 20);
  const withinInterval = await controller.prepareBeforeReady();
  assert.equal(withinInterval.cleared, false);
  assert.equal(withinInterval.reason, 'interval');
  assert.equal(fs.existsSync(path.join(box.userDataDir, 'Cache', 'large-again.bin')), true);

  const later = createStorageMaintenanceController({
    ...box,
    isPackaged: true,
    cacheLimitBytes: 10,
    now: () => new Date(nowMs + CACHE_AUTO_INTERVAL_MS)
  });
  const afterInterval = await later.prepareBeforeReady();
  assert.equal(afterInterval.cleared, true);
  assert.equal(fs.existsSync(path.join(box.userDataDir, 'Cache')), false);
});

test('manual cache cleanup clears the live session and queues startup-only cache removal', async t => {
  const box = sandbox();
  t.after(() => fs.rmSync(box.root, { recursive: true, force: true }));
  const calls = [];
  writeSizedFile(path.join(box.userDataDir, 'DawnWebGPUCache', 'gpu.bin'), 15);
  const controller = createStorageMaintenanceController({
    ...box,
    isPackaged: true,
    session: {
      async clearCache() { calls.push('cache'); },
      async clearCodeCaches(options) { calls.push(['code', options]); }
    }
  });

  const result = await controller.clearCache();

  assert.deepEqual(calls, ['cache', ['code', {}]]);
  assert.equal(result.pendingRestart, true);
  assert.equal(fs.existsSync(path.join(box.userDataDir, 'DawnWebGPUCache', 'gpu.bin')), true);
  const state = JSON.parse(fs.readFileSync(path.join(box.userDataDir, 'storage-maintenance.json'), 'utf8'));
  assert.equal(state.pendingStartupCacheClear, true);

  const startup = await controller.prepareBeforeReady();
  assert.equal(startup.cleared, true);
  assert.equal(startup.reason, 'pending');
  assert.equal(fs.existsSync(path.join(box.userDataDir, 'DawnWebGPUCache')), false);
});

test('post-migration cleanup removes only exact stale migration temporary files', async t => {
  const box = sandbox();
  t.after(() => fs.rmSync(box.root, { recursive: true, force: true }));
  const canonical = path.join(box.userDataDir, 'star-picking-pavilion.db');
  createDatabase(canonical);
  const old = path.join(box.userDataDir, 'star-picking-pavilion.db.backup-123-abcdef123456.tmp-shm');
  const fresh = path.join(box.userDataDir, 'star-picking-pavilion.db.backup-456-fedcba654321.tmp-wal');
  const unknown = path.join(box.userDataDir, 'other.db.backup-123-abcdef123456.tmp-shm');
  writeSizedFile(old, 12);
  writeSizedFile(fresh, 13);
  writeSizedFile(unknown, 14);
  const nowMs = Date.parse('2026-07-30T00:00:00.000Z');
  const staleDate = new Date(nowMs - MIGRATION_TEMP_MAX_AGE_MS - 1);
  fs.utimesSync(old, staleDate, staleDate);
  fs.utimesSync(unknown, staleDate, staleDate);

  const controller = createStorageMaintenanceController({
    ...box,
    isPackaged: true,
    now: () => new Date(nowMs)
  });
  const result = await controller.initializeAfterMigration();

  assert.deepEqual(result.removedMigrationResidue, { files: 1, bytes: 12 });
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(fresh), true);
  assert.equal(fs.existsSync(unknown), true);
});

test('legacy deletion needs a migrated source, thirty-day grace and explicit confirmation', async t => {
  const box = sandbox();
  t.after(() => fs.rmSync(box.root, { recursive: true, force: true }));
  const canonical = path.join(box.userDataDir, 'star-picking-pavilion.db');
  const legacy = path.join(box.userDataDir, 'windcatcher.db');
  createDatabase(canonical, 'canonical');
  createDatabase(legacy, 'legacy');
  writeSizedFile(`${legacy}-wal`, 7);
  writeSizedFile(`${legacy}-shm`, 8);
  writeSizedFile(path.join(box.userDataDir, 'unknown.keep'), 9);
  const nowMs = Date.parse('2026-07-30T00:00:00.000Z');
  fs.writeFileSync(path.join(box.userDataDir, 'migration-v0.0.1.json'), JSON.stringify({
    source: legacy,
    destination: canonical,
    timestamp: new Date(nowMs - 31 * 86_400_000).toISOString(),
    status: 'migrated'
  }));

  const cancelled = createStorageMaintenanceController({
    ...box,
    isPackaged: true,
    now: () => new Date(nowMs),
    confirm: async () => false
  });
  const before = await cancelled.getSnapshot();
  assert.equal(before.legacy.candidates.length, 1);
  assert.equal(before.legacy.candidates[0].eligible, true);
  const actualLegacyBytes = ['', '-wal', '-shm'].reduce(
    (total, suffix) => total + (fs.existsSync(`${legacy}${suffix}`) ? fs.statSync(`${legacy}${suffix}`).size : 0),
    0
  );
  assert.equal(before.legacy.bytes, actualLegacyBytes);
  const cancelledResult = await cancelled.deleteLegacy(before.legacy.candidates[0].id);
  assert.equal(cancelledResult.cancelled, true);
  assert.equal(fs.existsSync(legacy), true);

  const confirmed = createStorageMaintenanceController({
    ...box,
    isPackaged: true,
    now: () => new Date(nowMs),
    confirm: async candidate => {
      assert.equal(candidate.path, legacy);
      return true;
    }
  });
  const result = await confirmed.deleteLegacy(before.legacy.candidates[0].id);
  assert.equal(result.deleted, true);
  assert.equal(result.deletedFiles, 3);
  assert.equal(fs.existsSync(legacy), false);
  assert.equal(fs.existsSync(`${legacy}-wal`), false);
  assert.equal(fs.existsSync(`${legacy}-shm`), false);
  assert.equal(fs.existsSync(path.join(box.userDataDir, 'unknown.keep')), true);
  assert.equal(fs.existsSync(box.userDataDir), true);
});

test('legacy candidates inside development data or still in grace are never eligible', async t => {
  const box = sandbox();
  t.after(() => fs.rmSync(box.root, { recursive: true, force: true }));
  const canonical = path.join(box.userDataDir, 'star-picking-pavilion.db');
  const developmentLegacy = path.join(box.repoDataDir, 'windcatcher.db');
  createDatabase(canonical);
  createDatabase(developmentLegacy);
  const nowMs = Date.parse('2026-07-30T00:00:00.000Z');
  fs.writeFileSync(path.join(box.userDataDir, 'migration-v0.0.1.json'), JSON.stringify({
    source: developmentLegacy,
    destination: canonical,
    timestamp: new Date(nowMs - 31 * 86_400_000).toISOString(),
    status: 'migrated'
  }));

  const controller = createStorageMaintenanceController({
    ...box,
    isPackaged: true,
    now: () => new Date(nowMs),
    confirm: async () => true
  });
  assert.equal((await controller.getSnapshot()).legacy.candidates.length, 0);
  await assert.rejects(controller.deleteLegacy('legacy-does-not-exist'), /不可清理|不存在/);
  assert.equal(fs.existsSync(developmentLegacy), true);

  const packagedLegacy = path.join(box.userDataDir, 'windcatcher.db');
  createDatabase(packagedLegacy);
  fs.writeFileSync(path.join(box.userDataDir, 'migration-v0.0.1.json'), JSON.stringify({
    source: packagedLegacy,
    destination: canonical,
    timestamp: new Date(nowMs - 29 * 86_400_000).toISOString(),
    status: 'migrated'
  }));
  const grace = await controller.getSnapshot();
  assert.equal(grace.legacy.candidates.length, 1);
  assert.equal(grace.legacy.candidates[0].eligible, false);
  assert.equal(grace.legacy.candidates[0].reason, 'grace-period');
});
