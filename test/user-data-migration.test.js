'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { migrateUserData, MigrationCancelledError } = require('../electron/user-data-migration');

const CANONICAL_NAME = 'star-picking-pavilion.db';
const LEGACY_NAME = 'windcatcher.db';

async function makeSandbox(t) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-migration-'));
  t.after(async () => fs.promises.rm(root, { recursive: true, force: true }));
  return {
    root,
    appDataDir: path.join(root, 'AppData', 'Roaming'),
    repoDataDir: path.join(root, 'repo', 'data')
  };
}

async function createDatabase(file, rows = ['seed']) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const database = new DatabaseSync(file);
  database.exec('CREATE TABLE entries (value TEXT NOT NULL)');
  const insert = database.prepare('INSERT INTO entries(value) VALUES (?)');
  for (const row of rows) insert.run(row);
  database.close();
}

function readRows(file) {
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    return database.prepare('SELECT value FROM entries ORDER BY rowid').all().map(row => row.value);
  } finally {
    database.close();
  }
}

async function hashFile(file) {
  return crypto.createHash('sha256').update(await fs.promises.readFile(file)).digest('hex');
}

function migrationOptions(sandbox, overrides = {}) {
  return {
    isPackaged: true,
    appDataDir: sandbox.appDataDir,
    repoDataDir: sandbox.repoDataDir,
    now: () => new Date('2026-07-21T08:00:00.000Z'),
    ...overrides
  };
}

test('migrates current 摘星阁 legacy database without changing its bytes', async t => {
  const sandbox = await makeSandbox(t);
  const canonicalDir = path.join(sandbox.appDataDir, '摘星阁');
  const source = path.join(canonicalDir, LEGACY_NAME);
  const destination = path.join(canonicalDir, CANONICAL_NAME);
  await createDatabase(source, ['current']);
  const beforeBytes = (await fs.promises.stat(source)).size;
  const beforeHash = await hashFile(source);

  const result = await migrateUserData(migrationOptions(sandbox));

  assert.equal(result.status, 'migrated');
  assert.equal(result.source, source);
  assert.equal(result.destination, destination);
  assert.deepEqual(readRows(destination), ['current']);
  assert.equal((await fs.promises.stat(source)).size, beforeBytes);
  assert.equal(await hashFile(source), beforeHash);
  const manifest = JSON.parse(await fs.promises.readFile(path.join(canonicalDir, 'migration-v0.0.1.json'), 'utf8'));
  assert.deepEqual(manifest, {
    source,
    destination,
    timestamp: '2026-07-21T08:00:00.000Z',
    status: 'migrated'
  });
});

test('migrates 捕风司 database when it is the only packaged candidate', async t => {
  const sandbox = await makeSandbox(t);
  const source = path.join(sandbox.appDataDir, '捕风司', LEGACY_NAME);
  await createDatabase(source, ['old']);

  const result = await migrateUserData(migrationOptions(sandbox));

  assert.equal(result.source, source);
  assert.deepEqual(readRows(result.destination), ['old']);
  assert.equal(fs.existsSync(source), true);
});

test('asks before choosing between both packaged candidates and respects current selection', async t => {
  const sandbox = await makeSandbox(t);
  const current = path.join(sandbox.appDataDir, '摘星阁', LEGACY_NAME);
  const old = path.join(sandbox.appDataDir, '捕风司', LEGACY_NAME);
  await createDatabase(current, ['current']);
  await createDatabase(old, ['old']);
  let received;

  const result = await migrateUserData(migrationOptions(sandbox, {
    chooseSource: async candidates => { received = candidates; return 'current'; }
  }));

  assert.deepEqual(received, { current, legacy: old });
  assert.equal(result.source, current);
  assert.deepEqual(readRows(result.destination), ['current']);
});

test('respects 捕风司 selection when both packaged candidates exist', async t => {
  const sandbox = await makeSandbox(t);
  const current = path.join(sandbox.appDataDir, '摘星阁', LEGACY_NAME);
  const old = path.join(sandbox.appDataDir, '捕风司', LEGACY_NAME);
  await createDatabase(current, ['current']);
  await createDatabase(old, ['old']);

  const result = await migrateUserData(migrationOptions(sandbox, {
    chooseSource: async () => 'legacy'
  }));

  assert.equal(result.source, old);
  assert.deepEqual(readRows(result.destination), ['old']);
});

test('chooser cancellation touches neither candidate and creates no canonical files', async t => {
  const sandbox = await makeSandbox(t);
  const canonicalDir = path.join(sandbox.appDataDir, '摘星阁');
  const current = path.join(canonicalDir, LEGACY_NAME);
  const old = path.join(sandbox.appDataDir, '捕风司', LEGACY_NAME);
  await createDatabase(current, ['current']);
  await createDatabase(old, ['old']);
  const currentHash = await hashFile(current);
  const oldHash = await hashFile(old);

  await assert.rejects(
    migrateUserData(migrationOptions(sandbox, { chooseSource: async () => 'cancel' })),
    error => error instanceof MigrationCancelledError && /取消/.test(error.message)
  );

  assert.equal(await hashFile(current), currentHash);
  assert.equal(await hashFile(old), oldHash);
  assert.equal(fs.existsSync(path.join(canonicalDir, CANONICAL_NAME)), false);
  assert.equal(fs.existsSync(path.join(canonicalDir, 'migration-v0.0.1.json')), false);
});

test('existing canonical database is quick-checked, untouched, and makes migration idempotent', async t => {
  const sandbox = await makeSandbox(t);
  const canonicalDir = path.join(sandbox.appDataDir, '摘星阁');
  const destination = path.join(canonicalDir, CANONICAL_NAME);
  const legacy = path.join(canonicalDir, LEGACY_NAME);
  await createDatabase(destination, ['canonical']);
  await createDatabase(legacy, ['legacy']);
  const beforeHash = await hashFile(destination);
  let backupCalls = 0;

  const options = migrationOptions(sandbox, {
    backupDatabase: async () => { backupCalls += 1; }
  });
  const first = await migrateUserData(options);
  const second = await migrateUserData(options);

  assert.equal(first.status, 'existing');
  assert.equal(second.status, 'existing');
  assert.equal(backupCalls, 0);
  assert.equal(await hashFile(destination), beforeHash);
  assert.deepEqual(readRows(destination), ['canonical']);
});

test('rejects a corrupt existing canonical database instead of overwriting it', async t => {
  const sandbox = await makeSandbox(t);
  const canonicalDir = path.join(sandbox.appDataDir, '摘星阁');
  const destination = path.join(canonicalDir, CANONICAL_NAME);
  await fs.promises.mkdir(canonicalDir, { recursive: true });
  await fs.promises.writeFile(destination, 'not a sqlite database');
  const beforeHash = await hashFile(destination);

  await assert.rejects(migrateUserData(migrationOptions(sandbox)), /quick_check|SQLite|database/i);

  assert.equal(await hashFile(destination), beforeHash);
});

test('real SQLite backup includes committed rows that remain in the WAL', async t => {
  const sandbox = await makeSandbox(t);
  const source = path.join(sandbox.appDataDir, '捕风司', LEGACY_NAME);
  await fs.promises.mkdir(path.dirname(source), { recursive: true });
  const live = new DatabaseSync(source);
  try {
    live.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE entries (value TEXT NOT NULL)');
    live.prepare('INSERT INTO entries(value) VALUES (?)').run('in-wal');
    assert.equal(fs.existsSync(`${source}-wal`), true);

    const result = await migrateUserData(migrationOptions(sandbox));

    assert.deepEqual(readRows(result.destination), ['in-wal']);
    const migrated = new DatabaseSync(result.destination, { readOnly: true });
    try {
      assert.equal(migrated.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    } finally {
      migrated.close();
    }
  } finally {
    live.close();
  }
});

test('copies settings atomically only from a different selected source directory', async t => {
  const sandbox = await makeSandbox(t);
  const oldDir = path.join(sandbox.appDataDir, '捕风司');
  await createDatabase(path.join(oldDir, LEGACY_NAME), ['old']);
  await fs.promises.writeFile(path.join(oldDir, 'settings.json'), '{"theme":"legacy"}');

  await migrateUserData(migrationOptions(sandbox));

  assert.equal(
    await fs.promises.readFile(path.join(sandbox.appDataDir, '摘星阁', 'settings.json'), 'utf8'),
    '{"theme":"legacy"}'
  );
});

test('settings migration completes before the canonical database becomes committed', async t => {
  const sandbox = await makeSandbox(t);
  const oldDir = path.join(sandbox.appDataDir, '捕风司');
  const destination = path.join(sandbox.appDataDir, '摘星阁', CANONICAL_NAME);
  await createDatabase(path.join(oldDir, LEGACY_NAME), ['old']);
  await fs.promises.writeFile(path.join(oldDir, 'settings.json'), '{"theme":"legacy"}');

  await assert.rejects(migrateUserData(migrationOptions(sandbox, {
    migrateSettingsFile: async () => {
      assert.equal(fs.existsSync(destination), false);
      throw new Error('injected settings migration failure');
    }
  })), /injected settings migration failure/);

  assert.equal(fs.existsSync(destination), false);
});

test('never overwrites existing canonical settings', async t => {
  const sandbox = await makeSandbox(t);
  const currentDir = path.join(sandbox.appDataDir, '摘星阁');
  const oldDir = path.join(sandbox.appDataDir, '捕风司');
  await fs.promises.mkdir(currentDir, { recursive: true });
  await createDatabase(path.join(oldDir, LEGACY_NAME), ['old']);
  await fs.promises.writeFile(path.join(oldDir, 'settings.json'), '{"theme":"legacy"}');
  await fs.promises.writeFile(path.join(currentDir, 'settings.json'), '{"theme":"current"}');

  await migrateUserData(migrationOptions(sandbox));

  assert.equal(await fs.promises.readFile(path.join(currentDir, 'settings.json'), 'utf8'), '{"theme":"current"}');
});

test('cleans a partial temporary destination after injected backup failure', async t => {
  const sandbox = await makeSandbox(t);
  const canonicalDir = path.join(sandbox.appDataDir, '摘星阁');
  const source = path.join(canonicalDir, LEGACY_NAME);
  const destination = path.join(canonicalDir, CANONICAL_NAME);
  await createDatabase(source, ['current']);
  const sourceHash = await hashFile(source);

  await assert.rejects(migrateUserData(migrationOptions(sandbox, {
    backupDatabase: async (_database, temporaryDestination) => {
      await fs.promises.writeFile(temporaryDestination, 'partial');
      throw new Error('injected backup failure');
    }
  })), /injected backup failure/);

  assert.equal(await hashFile(source), sourceHash);
  assert.equal(fs.existsSync(destination), false);
  assert.equal(fs.existsSync(path.join(canonicalDir, 'migration-v0.0.1.json')), false);
  assert.deepEqual((await fs.promises.readdir(canonicalDir)).sort(), [LEGACY_NAME]);
});

test('development migrates only the repository data directory to the canonical filename', async t => {
  const sandbox = await makeSandbox(t);
  const source = path.join(sandbox.repoDataDir, LEGACY_NAME);
  await createDatabase(source, ['dev']);

  const result = await migrateUserData(migrationOptions(sandbox, { isPackaged: false }));

  assert.equal(result.destination, path.join(sandbox.repoDataDir, CANONICAL_NAME));
  assert.deepEqual(readRows(result.destination), ['dev']);
  assert.equal(fs.existsSync(path.join(sandbox.appDataDir, '摘星阁')), false);
});
