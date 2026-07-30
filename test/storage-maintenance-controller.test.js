'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createStorageMaintenanceController
} = require('../renderer/storage-maintenance-controller');

class FakeElement {
  constructor() {
    this.textContent = '';
    this.className = '';
    this.disabled = false;
    this.attributes = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

function elements() {
  return Object.fromEntries([
    'articles', 'expiring', 'database', 'reclaimable', 'cache',
    'migrationResidue', 'legacy', 'total', 'hint',
    'pruneButton', 'compactButton', 'cacheButton', 'legacyButton',
    'pruneStatus', 'compactStatus', 'cacheStatus', 'legacyStatus'
  ].map(name => [name, new FakeElement()]));
}

const formatBytes = bytes => `${Number(bytes) / 1024} KB`;

function databaseSnapshot(overrides = {}) {
  return {
    articles: 1234,
    expiring: 12,
    retentionDays: 180,
    irrelevantRetentionDays: 21,
    lastPruneAt: '2026-07-30T00:00:00.000Z',
    lastOptimizeAt: '2026-07-30T00:00:00.000Z',
    lastCompactionAt: null,
    database: {
      fileBytes: 12 * 1024,
      allocatedBytes: 10 * 1024,
      reclaimableBytes: 2 * 1024,
      reclaimableRatio: 0.2
    },
    ...overrides
  };
}

function desktopSnapshot(overrides = {}) {
  return {
    cache: {
      bytes: 5 * 1024,
      entries: [],
      softLimitBytes: 256 * 1024 * 1024,
      pendingRestart: false
    },
    migrationResidue: { bytes: 1024, files: 1 },
    legacy: {
      bytes: 3 * 1024,
      candidates: [{
        id: 'legacy-123456789abc',
        path: 'C:\\legacy.db',
        eligible: true,
        reason: null
      }]
    },
    ...overrides
  };
}

test('combines database and desktop snapshots into one truthful storage dashboard', async () => {
  const view = elements();
  const controller = createStorageMaintenanceController({
    elements: view,
    requestDatabase: async () => databaseSnapshot(),
    pruneDatabase: async () => ({}),
    compactDatabase: async () => ({}),
    getDesktopStorage: async () => desktopSnapshot(),
    clearDesktopCache: async () => ({}),
    deleteLegacyData: async () => ({}),
    formatBytes
  });

  const result = await controller.load();

  assert.equal(result.databaseAvailable, true);
  assert.equal(result.desktopAvailable, true);
  assert.equal(view.articles.textContent, '1,234');
  assert.equal(view.expiring.textContent, '12');
  assert.equal(view.database.textContent, '12 KB');
  assert.equal(view.reclaimable.textContent, '2 KB');
  assert.equal(view.cache.textContent, '5 KB');
  assert.equal(view.migrationResidue.textContent, '1 KB');
  assert.equal(view.legacy.textContent, '3 KB');
  assert.equal(view.total.textContent, '21 KB');
  assert.equal(view.pruneButton.disabled, false);
  assert.equal(view.compactButton.disabled, false);
  assert.equal(view.cacheButton.disabled, false);
  assert.equal(view.legacyButton.disabled, false);
  assert.match(view.hint.textContent, /情报保留 180 天/);
  assert.match(view.hint.textContent, /可回收 20%/);
});

test('unavailable desktop storage is never rendered as zero and total becomes a lower bound', async () => {
  const view = elements();
  const controller = createStorageMaintenanceController({
    elements: view,
    requestDatabase: async () => databaseSnapshot(),
    pruneDatabase: async () => ({}),
    compactDatabase: async () => ({}),
    getDesktopStorage: async () => { throw new Error('desktop unavailable'); },
    clearDesktopCache: async () => ({}),
    deleteLegacyData: async () => ({}),
    formatBytes
  });

  const result = await controller.load();

  assert.equal(result.desktopAvailable, false);
  for (const field of ['cache', 'migrationResidue', 'legacy']) {
    assert.equal(view[field].textContent, '暂不可用');
  }
  assert.equal(view.total.textContent, '≥ 12 KB');
  assert.equal(view.cacheButton.disabled, true);
  assert.equal(view.legacyButton.disabled, true);
  assert.equal(view.pruneButton.disabled, false);
});

test('cache accounting failures render known bytes as a lower bound instead of an exact zero', async () => {
  const view = elements();
  const controller = createStorageMaintenanceController({
    elements: view,
    requestDatabase: async () => databaseSnapshot(),
    pruneDatabase: async () => ({}),
    compactDatabase: async () => ({}),
    getDesktopStorage: async () => desktopSnapshot({
      cache: {
        bytes: 1024,
        entries: [{ name: 'Cache', bytes: 1024 }],
        failures: [{ name: 'Code Cache', reason: 'EACCES' }],
        softLimitBytes: 256 * 1024 * 1024,
        pendingRestart: false
      }
    }),
    clearDesktopCache: async () => ({}),
    deleteLegacyData: async () => ({}),
    formatBytes
  });

  await controller.load();

  assert.equal(view.cache.textContent, '≥ 1 KB');
  assert.equal(view.total.textContent, '≥ 17 KB');
});

test('legacy cleanup stays disabled until an eligible regenerated candidate exists', async () => {
  const view = elements();
  let desktop = desktopSnapshot({
    legacy: {
      bytes: 3 * 1024,
      candidates: [{ id: 'legacy-123456789abc', eligible: false, reason: 'grace-period' }]
    }
  });
  const deleted = [];
  const controller = createStorageMaintenanceController({
    elements: view,
    requestDatabase: async () => databaseSnapshot(),
    pruneDatabase: async () => ({}),
    compactDatabase: async () => ({}),
    getDesktopStorage: async () => desktop,
    clearDesktopCache: async () => ({}),
    deleteLegacyData: async id => { deleted.push(id); return { deleted: true, deletedBytes: 3072 }; },
    formatBytes
  });
  await controller.load();
  assert.equal(view.legacyButton.disabled, true);
  await assert.rejects(controller.deleteLegacy(), /没有可清理/);

  desktop = desktopSnapshot();
  await controller.load();
  assert.equal(view.legacyButton.disabled, false);
  await controller.deleteLegacy();
  assert.deepEqual(deleted, ['legacy-123456789abc']);
  assert.equal(view.legacyStatus.textContent, '✓ 已清理 3 KB');
  assert.match(view.legacyStatus.className, /ok/);
});

test('each maintenance action owns its busy and error state independently', async () => {
  const view = elements();
  let releaseCompact;
  const compacting = new Promise(resolve => { releaseCompact = resolve; });
  const controller = createStorageMaintenanceController({
    elements: view,
    requestDatabase: async () => databaseSnapshot(),
    pruneDatabase: async () => ({ removedArticles: 2 }),
    compactDatabase: async () => compacting,
    getDesktopStorage: async () => desktopSnapshot(),
    clearDesktopCache: async () => { throw new Error('cache failed'); },
    deleteLegacyData: async () => ({}),
    formatBytes
  });
  await controller.load();

  const pending = controller.compact();
  assert.equal(view.compactButton.disabled, true);
  assert.equal(view.pruneButton.disabled, false);
  assert.equal(view.compactStatus.attributes.get('aria-busy'), 'true');
  releaseCompact({
    skipped: false,
    reclaimedBytes: 4096,
    after: { fileBytes: 8192, reclaimableBytes: 0, reclaimableRatio: 0 }
  });
  await pending;
  assert.equal(view.compactButton.disabled, false);
  assert.equal(view.compactStatus.textContent, '✓ 已释放 4 KB');

  await assert.rejects(controller.clearCache(), /cache failed/);
  assert.equal(view.cacheButton.disabled, false);
  assert.equal(view.cacheStatus.textContent, '✗ cache failed');
  assert.match(view.cacheStatus.className, /fail/);
  assert.equal(view.compactStatus.textContent, '✓ 已释放 4 KB');
});

test('busy checkpoints and partial cleanup results are reported without false success', async () => {
  const view = elements();
  let compactResult = { skipped: true, reason: 'busy' };
  const controller = createStorageMaintenanceController({
    elements: view,
    requestDatabase: async () => databaseSnapshot(),
    pruneDatabase: async () => ({}),
    compactDatabase: async () => compactResult,
    getDesktopStorage: async () => desktopSnapshot(),
    clearDesktopCache: async () => ({
      pendingRestart: true,
      releasedBytes: 1024,
      failedBytes: 2048,
      pendingBytes: 2048,
      failures: [{ name: 'Cache', reason: 'EBUSY' }]
    }),
    deleteLegacyData: async () => ({
      deleted: true,
      deletedBytes: 1024,
      failedBytes: 2048,
      failedFiles: [{ name: 'windcatcher.db-wal', reason: 'EBUSY' }]
    }),
    formatBytes
  });
  await controller.load();

  await controller.compact();
  assert.equal(view.compactStatus.textContent, '暂未压缩：采集或清理正在进行');
  assert.doesNotMatch(view.compactStatus.className, /ok|fail/);

  compactResult = { skipped: true, reason: 'checkpoint-busy' };
  await controller.compact();
  assert.equal(view.compactStatus.textContent, '暂未压缩：数据库正在读取中，请稍后重试');
  assert.doesNotMatch(view.compactStatus.className, /ok|fail/);

  await controller.clearCache();
  assert.match(view.cacheStatus.textContent, /已释放 1 KB/);
  assert.match(view.cacheStatus.textContent, /2 KB 暂未清理/);
  assert.match(view.cacheStatus.className, /fail/);

  await controller.deleteLegacy();
  assert.match(view.legacyStatus.textContent, /已释放 1 KB/);
  assert.match(view.legacyStatus.textContent, /2 KB 暂未删除/);
  assert.match(view.legacyStatus.className, /fail/);
});
