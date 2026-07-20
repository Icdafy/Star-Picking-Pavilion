'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');

const CANONICAL_DATABASE = 'star-picking-pavilion.db';
const LEGACY_DATABASE = 'windcatcher.db';
const MANIFEST = 'migration-v0.0.1.json';

class MigrationCancelledError extends Error {
  constructor(message = '用户取消了数据迁移和应用启动') {
    super(message);
    this.name = 'MigrationCancelledError';
  }
}

function temporaryPath(destination, label) {
  return `${destination}.${label}-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
}

function quickCheck(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const result = database.prepare('PRAGMA quick_check').get();
    if (result.quick_check !== 'ok') {
      throw new Error(`SQLite quick_check failed for ${databasePath}: ${result.quick_check}`);
    }
  } finally {
    database.close();
  }
}

async function writeAtomic(destination, content) {
  const temporary = temporaryPath(destination, 'write');
  try {
    await fs.promises.writeFile(temporary, content);
    await fs.promises.rename(temporary, destination);
  } catch (error) {
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function migrateSettings(sourceDirectory, canonicalDirectory) {
  if (path.resolve(sourceDirectory) === path.resolve(canonicalDirectory)) return;
  const source = path.join(sourceDirectory, 'settings.json');
  const destination = path.join(canonicalDirectory, 'settings.json');
  if (!fs.existsSync(source) || fs.existsSync(destination)) return;
  await writeAtomic(destination, await fs.promises.readFile(source));
}

async function choosePackagedSource({ appDataDir, canonicalDirectory, chooseSource }) {
  const current = path.join(canonicalDirectory, LEGACY_DATABASE);
  const legacy = path.join(appDataDir, '捕风司', LEGACY_DATABASE);
  const hasCurrent = fs.existsSync(current);
  const hasLegacy = fs.existsSync(legacy);

  if (hasCurrent && hasLegacy) {
    if (typeof chooseSource !== 'function') {
      throw new Error('检测到两份旧数据库，但没有提供安全的数据源选择器');
    }
    const selection = await chooseSource({ current, legacy });
    if (selection === 'cancel' || selection == null) throw new MigrationCancelledError();
    if (selection === 'current') return current;
    if (selection === 'legacy') return legacy;
    throw new Error(`未知的数据迁移选择: ${selection}`);
  }
  if (hasCurrent) return current;
  if (hasLegacy) return legacy;
  return null;
}

async function migrateUserData(options) {
  const {
    isPackaged,
    appDataDir,
    repoDataDir,
    chooseSource,
    now = () => new Date(),
    backupDatabase = (database, destination) => backup(database, destination)
  } = options || {};

  if (isPackaged && !appDataDir) throw new Error('Packaged migration requires appDataDir');
  if (!isPackaged && !repoDataDir) throw new Error('Development migration requires repoDataDir');

  const canonicalDirectory = isPackaged ? path.join(appDataDir, '摘星阁') : repoDataDir;
  const destination = path.join(canonicalDirectory, CANONICAL_DATABASE);
  await fs.promises.mkdir(canonicalDirectory, { recursive: true });

  if (fs.existsSync(destination)) {
    quickCheck(destination);
    return { status: 'existing', destination };
  }

  const source = isPackaged
    ? await choosePackagedSource({ appDataDir, canonicalDirectory, chooseSource })
    : path.join(repoDataDir, LEGACY_DATABASE);

  if (!source || !fs.existsSync(source)) return { status: 'fresh', destination };

  const temporaryDestination = temporaryPath(destination, 'backup');
  let sourceDatabase;
  try {
    sourceDatabase = new DatabaseSync(source, { readOnly: true });
    const sourceCheck = sourceDatabase.prepare('PRAGMA quick_check').get();
    if (sourceCheck.quick_check !== 'ok') {
      throw new Error(`SQLite quick_check failed for migration source: ${sourceCheck.quick_check}`);
    }
    await backupDatabase(sourceDatabase, temporaryDestination);
  } catch (error) {
    await fs.promises.rm(temporaryDestination, { force: true }).catch(() => {});
    throw error;
  } finally {
    sourceDatabase?.close();
  }

  try {
    quickCheck(temporaryDestination);
    await fs.promises.rename(temporaryDestination, destination);
    await migrateSettings(path.dirname(source), canonicalDirectory);
    const record = {
      source,
      destination,
      timestamp: now().toISOString(),
      status: 'migrated'
    };
    await writeAtomic(path.join(canonicalDirectory, MANIFEST), JSON.stringify(record, null, 2));
    return record;
  } catch (error) {
    await fs.promises.rm(temporaryDestination, { force: true }).catch(() => {});
    throw error;
  }
}

module.exports = {
  CANONICAL_DATABASE,
  LEGACY_DATABASE,
  MigrationCancelledError,
  migrateUserData
};
