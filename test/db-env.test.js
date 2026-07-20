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
