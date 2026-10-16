'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');

test('database uses canonical env first, canonical filename, foreign keys, quick_check, and idempotent close', async t => {
  const sandbox = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-db-env-'));
  t.after(async () => fs.promises.rm(sandbox, { recursive: true, force: true }));
  const canonicalDir = path.join(sandbox, 'canonical');
  const legacyDir = path.join(sandbox, 'legacy');
  const program = `
    const path = require('node:path');
    const mod = require(${JSON.stringify(path.join(root, 'server', 'db.js'))});
    if (mod.DATA_DIR !== process.env.STAR_PICKING_PAVILION_DATA_DIR) throw new Error('wrong env precedence');
    if (mod.db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) throw new Error('foreign keys disabled');
    if (mod.db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('quick_check failed');
    mod.closeDatabase();
    mod.closeDatabase();
  `;

  const child = spawnSync(process.execPath, ['-e', program], {
    cwd: root,
    env: {
      ...process.env,
      STAR_PICKING_PAVILION_DATA_DIR: canonicalDir,
      WINDCATCHER_DATA_DIR: legacyDir
    },
    encoding: 'utf8'
  });

  assert.equal(child.status, 0, child.stderr);
  assert.equal(fs.existsSync(path.join(canonicalDir, 'star-picking-pavilion.db')), true);
  assert.equal(fs.existsSync(path.join(legacyDir, 'star-picking-pavilion.db')), false);
  assert.equal(fs.existsSync(path.join(canonicalDir, 'windcatcher.db')), false);
});

test('database retains WINDCATCHER_DATA_DIR as a legacy fallback', async t => {
  const sandbox = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-db-fallback-'));
  t.after(async () => fs.promises.rm(sandbox, { recursive: true, force: true }));
  const program = `
    const mod = require(${JSON.stringify(path.join(root, 'server', 'db.js'))});
    if (mod.DATA_DIR !== process.env.WINDCATCHER_DATA_DIR) throw new Error('legacy fallback missing');
    mod.closeDatabase();
  `;
  const child = spawnSync(process.execPath, ['-e', program], {
    cwd: root,
    env: { ...process.env, STAR_PICKING_PAVILION_DATA_DIR: '', WINDCATCHER_DATA_DIR: sandbox },
    encoding: 'utf8'
  });

  assert.equal(child.status, 0, child.stderr);
  assert.equal(fs.existsSync(path.join(sandbox, 'star-picking-pavilion.db')), true);
});

test('Electron main fixes packaged userData before readiness, migrates before starting, and passes canonical env', () => {
  const source = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  const setPath = source.indexOf("app.setPath('userData'");
  const ready = source.indexOf('app.whenReady()');
  const migration = source.indexOf('migrateUserData(');
  const start = source.indexOf('startServer(', ready);

  assert.ok(setPath >= 0 && setPath < ready, 'stable userData must be set before whenReady');
  assert.ok(migration >= 0 && migration < start, 'migration must finish before server start');
  assert.match(source, /STAR_PICKING_PAVILION_DATA_DIR\s*:/);
  assert.match(source, /dialog\.showMessageBox/);
  assert.match(source, /使用当前.*摘星阁.*推荐/);
  assert.match(source, /使用.*捕风司/);
  assert.match(source, /取消启动/);
});

test('schema initialization failure rolls back every new table and permits a clean retry', async t => {
  const sandbox = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-schema-atomic-'));
  t.after(async () => fs.promises.rm(sandbox, { recursive: true, force: true }));
  const program = `
    const assert = require('node:assert/strict');
    const { DatabaseSync } = require('node:sqlite');
    const entry = ${JSON.stringify(path.join(root, 'server/db.js'))};
    const original = DatabaseSync.prototype.exec;
    let failedDatabase, injected = false;
    DatabaseSync.prototype.exec = function (sql) {
      if (sql.includes('ALTER TABLE articles ADD COLUMN title_zh')) {
        failedDatabase = this; injected = true; throw new Error('injected schema failure');
      }
      return original.call(this, sql);
    };
    assert.throws(() => require(entry), /injected schema failure/);
    DatabaseSync.prototype.exec = original;
    assert.equal(injected, true);
    assert.equal(failedDatabase.isTransaction, false);
    assert.equal(failedDatabase.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get().c, 0);
    failedDatabase.close();
    const { db, closeDatabase } = require(entry);
    assert.ok(db.prepare('PRAGMA table_info(articles)').all().some(column => column.name === 'title_zh'));
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    closeDatabase();
  `;
  const child = spawnSync(process.execPath, ['-e', program], {
    cwd: root, env: { ...process.env, STAR_PICKING_PAVILION_DATA_DIR: sandbox }, encoding: 'utf8'
  });
  assert.equal(child.status, 0, child.stderr);
});

test('nested atomic batches roll back only their own writes and never commit the caller', async t => {
  const sandbox = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-nested-atomic-'));
  t.after(async () => fs.promises.rm(sandbox, { recursive: true, force: true }));
  const program = `
    const assert = require('node:assert/strict');
    const { db, withTransaction, closeDatabase } = require(${JSON.stringify(path.join(root, 'server/db.js'))});
    db.exec('BEGIN IMMEDIATE');
    db.prepare("INSERT INTO meta(key,value) VALUES('outer','keep')").run();
    assert.throws(() => withTransaction(() => {
      db.prepare("INSERT INTO meta(key,value) VALUES('inner','rollback')").run();
      withTransaction(() => db.prepare("INSERT INTO meta(key,value) VALUES('deeper','rollback')").run());
      throw new Error('injected inner failure');
    }), /injected inner failure/);
    assert.equal(db.isTransaction, true);
    assert.equal(db.prepare("SELECT value FROM meta WHERE key='outer'").get().value, 'keep');
    assert.equal(db.prepare("SELECT COUNT(*) c FROM meta WHERE key IN ('inner','deeper')").get().c, 0);
    withTransaction(() => db.prepare("INSERT INTO meta(key,value) VALUES('success','pending')").run());
    assert.equal(db.isTransaction, true);
    db.exec('ROLLBACK');
    assert.equal(db.prepare("SELECT COUNT(*) c FROM meta WHERE key IN ('outer','success')").get().c, 0);
    closeDatabase();
  `;
  const child = spawnSync(process.execPath, ['-e', program], {
    cwd: root, env: { ...process.env, STAR_PICKING_PAVILION_DATA_DIR: sandbox }, encoding: 'utf8'
  });
  assert.equal(child.status, 0, child.stderr);
});

for (const failure of ['SQLITE_BUSY: database is locked', 'SQLITE_IOERR: disk I/O error']) {
  test(`an operational integrity-check failure preserves the database (${failure})`, async t => {
    const sandbox = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-integrity-operation-'));
    t.after(async () => fs.promises.rm(sandbox, { recursive: true, force: true }));
    const program = `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const path = require('node:path');
      const { DatabaseSync } = require('node:sqlite');
      const file = path.join(process.env.STAR_PICKING_PAVILION_DATA_DIR, 'star-picking-pavilion.db');
      const fixture = new DatabaseSync(file);
      fixture.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT); INSERT INTO meta VALUES('keeper','user data')");
      fixture.close();
      const entry = ${JSON.stringify(path.join(root, 'server/db.js'))};
      const original = DatabaseSync.prototype.prepare;
      let failedDatabase;
      const failure = new Error(${JSON.stringify(failure)});
      DatabaseSync.prototype.prepare = function (sql) {
        if (sql === 'PRAGMA quick_check') { failedDatabase = this; throw failure; }
        return original.call(this, sql);
      };
      assert.throws(() => require(entry), error => error === failure);
      DatabaseSync.prototype.prepare = original;
      assert.throws(() => failedDatabase.prepare('SELECT 1'), /not open/i);
      assert.equal(fs.readdirSync(process.env.STAR_PICKING_PAVILION_DATA_DIR).some(name => name.includes('.corrupt-')), false);
      const { db, closeDatabase } = require(entry);
      assert.equal(db.prepare("SELECT value FROM meta WHERE key='keeper'").get().value, 'user data');
      assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
      closeDatabase();
    `;
    const child = spawnSync(process.execPath, ['-e', program], {
      cwd: root, env: { ...process.env, STAR_PICKING_PAVILION_DATA_DIR: sandbox }, encoding: 'utf8'
    });
    assert.equal(child.status, 0, child.stderr);
  });
}

for (const reportedAs of ['row', 'error']) {
  test(`a confirmed integrity failure still quarantines the original before recovery (${reportedAs})`, async t => {
    const sandbox = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-integrity-confirmed-'));
    t.after(async () => fs.promises.rm(sandbox, { recursive: true, force: true }));
    const program = `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const path = require('node:path');
      const { DatabaseSync } = require('node:sqlite');
      const directory = process.env.STAR_PICKING_PAVILION_DATA_DIR;
      const file = path.join(directory, 'star-picking-pavilion.db');
      const fixture = new DatabaseSync(file);
      fixture.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT); INSERT INTO meta VALUES('keeper','original data')");
      fixture.close();
      const original = DatabaseSync.prototype.prepare;
      let injected = false;
      DatabaseSync.prototype.prepare = function (sql) {
        if (sql === 'PRAGMA quick_check' && !injected) {
          injected = true;
          if (${JSON.stringify(reportedAs)} === 'error') throw new Error('SQLITE_CORRUPT: database disk image is malformed');
          return { get: () => ({ quick_check: 'database disk image is malformed' }) };
        }
        return original.call(this, sql);
      };
      const { db, closeDatabase } = require(${JSON.stringify(path.join(root, 'server/db.js'))});
      DatabaseSync.prototype.prepare = original;
      assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
      assert.equal(db.prepare("SELECT value FROM meta WHERE key='keeper'").get(), undefined);
      const saved = fs.readdirSync(directory).find(name => /^star-picking-pavilion\\.db\\.corrupt-/.test(name));
      assert.ok(saved, 'original database must remain available for recovery');
      const preserved = new DatabaseSync(path.join(directory, saved));
      assert.equal(preserved.prepare("SELECT value FROM meta WHERE key='keeper'").get().value, 'original data');
      preserved.close();
      closeDatabase();
    `;
    const child = spawnSync(process.execPath, ['-e', program], {
      cwd: root, env: { ...process.env, STAR_PICKING_PAVILION_DATA_DIR: sandbox }, encoding: 'utf8'
    });
    assert.equal(child.status, 0, child.stderr);
  });
}
