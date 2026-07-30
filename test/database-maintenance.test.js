'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const {
  AUTO_COMPACT_INTERVAL_MS,
  AUTO_COMPACT_MIN_BYTES,
  AUTO_COMPACT_MIN_RATIO,
  COMPACT_FREE_SPACE_RESERVE_BYTES,
  compactDatabase,
  databaseStorageSnapshot,
  optimizeDatabase,
  shouldAutoCompact
} = require('../server/database-maintenance');

function createFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-database-maintenance-'));
  const databasePath = path.join(directory, 'fixture.db');
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE keepers (id INTEGER PRIMARY KEY, content TEXT NOT NULL);
  `);
  const insert = database.prepare('INSERT INTO keepers (content) VALUES (?)');
  database.exec('BEGIN');
  try {
    for (let index = 0; index < 160; index++) {
      insert.run(`${String(index).padStart(4, '0')}:${'摘星阁'.repeat(4096)}`);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  database.prepare('DELETE FROM keepers WHERE id > 1').run();
  database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  return { database, databasePath, directory };
}

test('database storage snapshot separates allocated, reclaimable and physical bytes', t => {
  const fixture = createFixture();
  t.after(() => {
    fixture.database.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });

  const snapshot = databaseStorageSnapshot({
    database: fixture.database,
    databasePath: fixture.databasePath
  });

  assert.ok(snapshot.mainFileBytes > 0);
  assert.ok(snapshot.fileBytes >= snapshot.mainFileBytes);
  assert.ok(snapshot.allocatedBytes >= snapshot.reclaimableBytes);
  assert.ok(snapshot.reclaimableBytes > 0);
  assert.equal(snapshot.reclaimableRatio, snapshot.reclaimableBytes / snapshot.allocatedBytes);
});

test('automatic compaction requires size, ratio and thirty-day interval together', () => {
  const nowMs = Date.parse('2026-07-30T00:00:00.000Z');
  const eligible = {
    reclaimableBytes: AUTO_COMPACT_MIN_BYTES,
    reclaimableRatio: AUTO_COMPACT_MIN_RATIO,
    lastCompactionAt: new Date(nowMs - AUTO_COMPACT_INTERVAL_MS).toISOString(),
    nowMs
  };

  assert.equal(shouldAutoCompact(eligible), true);
  assert.equal(shouldAutoCompact({ ...eligible, reclaimableBytes: AUTO_COMPACT_MIN_BYTES - 1 }), false);
  assert.equal(shouldAutoCompact({ ...eligible, reclaimableRatio: AUTO_COMPACT_MIN_RATIO - 0.001 }), false);
  assert.equal(shouldAutoCompact({
    ...eligible,
    lastCompactionAt: new Date(nowMs - AUTO_COMPACT_INTERVAL_MS + 1).toISOString()
  }), false);
  assert.equal(shouldAutoCompact({ ...eligible, lastCompactionAt: null }), true);
});

test('manual compaction preserves live rows, verifies integrity and shrinks allocated pages', t => {
  const fixture = createFixture();
  t.after(() => {
    fixture.database.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });
  const before = databaseStorageSnapshot({
    database: fixture.database,
    databasePath: fixture.databasePath
  });

  const result = compactDatabase({
    database: fixture.database,
    databasePath: fixture.databasePath,
    mode: 'manual',
    availableBytes: before.mainFileBytes * 2 + COMPACT_FREE_SPACE_RESERVE_BYTES,
    nowMs: Date.parse('2026-07-30T01:02:03.000Z')
  });

  assert.equal(result.skipped, false);
  assert.equal(fixture.database.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  assert.equal(fixture.database.prepare('SELECT COUNT(*) c FROM keepers').get().c, 1);
  assert.ok(result.after.allocatedBytes < result.before.allocatedBytes);
  assert.equal(
    fixture.database.prepare("SELECT value FROM meta WHERE key='lastCompactionAt'").get().value,
    '2026-07-30T01:02:03.000Z'
  );
});

test('compaction skips safely when the volume lacks the required temporary space', t => {
  const fixture = createFixture();
  t.after(() => {
    fixture.database.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });
  const before = databaseStorageSnapshot({
    database: fixture.database,
    databasePath: fixture.databasePath
  });

  const result = compactDatabase({
    database: fixture.database,
    databasePath: fixture.databasePath,
    mode: 'manual',
    availableBytes: before.mainFileBytes * 2 + COMPACT_FREE_SPACE_RESERVE_BYTES - 1
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'space');
  assert.equal(fixture.database.prepare('SELECT COUNT(*) c FROM keepers').get().c, 1);
});

test('optimize records its own successful maintenance timestamp', t => {
  const fixture = createFixture();
  t.after(() => {
    fixture.database.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });

  const result = optimizeDatabase({
    database: fixture.database,
    nowMs: Date.parse('2026-07-30T04:05:06.000Z')
  });

  assert.deepEqual(result, {
    optimized: true,
    at: '2026-07-30T04:05:06.000Z'
  });
  assert.equal(
    fixture.database.prepare("SELECT value FROM meta WHERE key='lastOptimizeAt'").get().value,
    result.at
  );
});
