'use strict';

(function attachStorageMaintenanceController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StorageMaintenanceController = api;
})(typeof window !== 'undefined' ? window : globalThis, function createModule() {
  const UNAVAILABLE = '暂不可用';

  function requireFunction(value, name) {
    if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
    return value;
  }

  function createStorageMaintenanceController({
    elements,
    requestDatabase,
    pruneDatabase,
    compactDatabase,
    getDesktopStorage,
    clearDesktopCache,
    deleteLegacyData,
    formatBytes
  } = {}) {
    if (!elements) throw new TypeError('elements are required');
    [
      'articles', 'expiring', 'database', 'reclaimable', 'cache',
      'migrationResidue', 'legacy', 'total', 'hint',
      'pruneButton', 'compactButton', 'cacheButton', 'legacyButton',
      'pruneStatus', 'compactStatus', 'cacheStatus', 'legacyStatus'
    ].forEach(name => {
      if (!elements[name]) throw new TypeError(`elements.${name} is required`);
    });

    const operations = {
      requestDatabase: requireFunction(requestDatabase, 'requestDatabase'),
      pruneDatabase: requireFunction(pruneDatabase, 'pruneDatabase'),
      compactDatabase: requireFunction(compactDatabase, 'compactDatabase'),
      getDesktopStorage: requireFunction(getDesktopStorage, 'getDesktopStorage'),
      clearDesktopCache: requireFunction(clearDesktopCache, 'clearDesktopCache'),
      deleteLegacyData: requireFunction(deleteLegacyData, 'deleteLegacyData')
    };
    requireFunction(formatBytes, 'formatBytes');

    const state = {
      databaseAvailable: false,
      desktopAvailable: false,
      desktopExact: false,
      database: null,
      desktop: null,
      eligibleLegacy: null,
      busy: new Set()
    };

    const asBytes = value => {
      const bytes = Number(value);
      return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
    };

    function setStatus(kind, message = '', tone = '', busy = false) {
      const element = elements[`${kind}Status`];
      element.textContent = message;
      element.className = `test-result maintenance-action-status${tone ? ` ${tone}` : ''}`;
      element.setAttribute('aria-busy', String(busy));
    }

    function renderButtons() {
      elements.pruneButton.disabled = !state.databaseAvailable || state.busy.has('prune');
      elements.compactButton.disabled = !state.databaseAvailable || state.busy.has('compact');
      elements.cacheButton.disabled = !state.desktopAvailable || state.busy.has('cache');
      elements.legacyButton.disabled = (
        !state.desktopAvailable
        || !state.eligibleLegacy
        || state.busy.has('legacy')
      );
    }

    function renderDatabase(snapshot) {
      state.database = snapshot;
      state.databaseAvailable = true;
      const storage = snapshot?.database || {};
      elements.articles.textContent = Number(snapshot?.articles || 0).toLocaleString('zh-CN');
      elements.expiring.textContent = Number(snapshot?.expiring || 0).toLocaleString('zh-CN');
      elements.database.textContent = formatBytes(asBytes(storage.fileBytes));
      elements.reclaimable.textContent = formatBytes(asBytes(storage.reclaimableBytes));
      const ratio = Math.max(0, Math.min(1, Number(storage.reclaimableRatio) || 0));
      elements.hint.textContent = (
        `情报保留 ${snapshot.retentionDays} 天，无关内容保留 ${snapshot.irrelevantRetentionDays} 天`
        + ` · 当前可回收 ${Math.round(ratio * 100)}%`
        + (snapshot.lastPruneAt ? ' · 已启用每日自动清理' : ' · 等待首次自动清理')
      );
    }

    function renderDatabaseUnavailable() {
      state.database = null;
      state.databaseAvailable = false;
      for (const field of ['articles', 'expiring', 'database', 'reclaimable']) {
        elements[field].textContent = UNAVAILABLE;
      }
      elements.hint.textContent = '本地情报库状态暂不可用，请稍后重试。';
    }

    function renderDesktop(snapshot) {
      state.desktop = snapshot;
      state.desktopAvailable = true;
      state.desktopExact = !snapshot?.cache?.failures?.length;
      state.eligibleLegacy = snapshot?.legacy?.candidates?.find(candidate => candidate.eligible) || null;
      const cacheBytes = asBytes(snapshot?.cache?.bytes);
      elements.cache.textContent = state.desktopExact
        ? formatBytes(cacheBytes)
        : (cacheBytes > 0 ? `≥ ${formatBytes(cacheBytes)}` : UNAVAILABLE);
      elements.migrationResidue.textContent = formatBytes(asBytes(snapshot?.migrationResidue?.bytes));
      elements.legacy.textContent = formatBytes(asBytes(snapshot?.legacy?.bytes));
    }

    function renderDesktopUnavailable() {
      state.desktop = null;
      state.desktopAvailable = false;
      state.desktopExact = false;
      state.eligibleLegacy = null;
      for (const field of ['cache', 'migrationResidue', 'legacy']) {
        elements[field].textContent = UNAVAILABLE;
      }
    }

    function renderTotal() {
      const databaseBytes = state.databaseAvailable
        ? asBytes(state.database?.database?.fileBytes)
        : 0;
      const desktopBytes = state.desktopAvailable
        ? asBytes(state.desktop?.cache?.bytes)
          + asBytes(state.desktop?.migrationResidue?.bytes)
          + asBytes(state.desktop?.legacy?.bytes)
        : 0;
      const total = formatBytes(databaseBytes + desktopBytes);
      elements.total.textContent = state.databaseAvailable && state.desktopAvailable && state.desktopExact
        ? total
        : `≥ ${total}`;
    }

    async function load() {
      const [databaseResult, desktopResult] = await Promise.allSettled([
        operations.requestDatabase(),
        operations.getDesktopStorage()
      ]);
      if (databaseResult.status === 'fulfilled') renderDatabase(databaseResult.value);
      else renderDatabaseUnavailable();
      if (desktopResult.status === 'fulfilled') renderDesktop(desktopResult.value);
      else renderDesktopUnavailable();
      renderTotal();
      renderButtons();
      return Object.freeze({
        databaseAvailable: state.databaseAvailable,
        desktopAvailable: state.desktopAvailable
      });
    }

    async function run(kind, operation, successMessage) {
      if (state.busy.has(kind)) throw new Error('该维护操作正在进行中');
      state.busy.add(kind);
      setStatus(kind, '处理中…', '', true);
      renderButtons();
      try {
        const result = await operation();
        const feedback = successMessage(result);
        if (typeof feedback === 'string') setStatus(kind, feedback, 'ok', false);
        else setStatus(kind, feedback.message, feedback.tone || '', false);
        await load();
        return result;
      } catch (error) {
        setStatus(kind, `✗ ${error.message}`, 'fail', false);
        throw error;
      } finally {
        state.busy.delete(kind);
        renderButtons();
      }
    }

    function prune() {
      return run('prune', operations.pruneDatabase, result => {
        if (result?.skipped) return '清理已在进行中，请稍候';
        return result?.removedArticles
          ? `✓ 已清理 ${result.removedArticles} 条`
          : '✓ 没有需要清理的内容';
      });
    }

    function compact() {
      return run('compact', operations.compactDatabase, result => {
        if (!result?.skipped) return `✓ 已释放 ${formatBytes(asBytes(result?.reclaimedBytes))}`;
        if (result.reason === 'space') {
          return { message: '暂未压缩：磁盘可用空间不足', tone: '' };
        }
        if (result.reason === 'busy') {
          return { message: '暂未压缩：采集或清理正在进行', tone: '' };
        }
        if (result.reason === 'checkpoint-busy') {
          return { message: '暂未压缩：数据库正在读取中，请稍后重试', tone: '' };
        }
        return { message: '暂未压缩：当前无需深度整理', tone: '' };
      });
    }

    function clearCache() {
      return run('cache', operations.clearDesktopCache, result => {
        const released = asBytes(result?.releasedBytes);
        const pending = asBytes(result?.pendingBytes);
        const failed = asBytes(result?.failedBytes);
        if (failed > 0 || result?.failures?.length > 0) {
          return {
            message: `已释放 ${formatBytes(released)}，`
              + (failed > 0
                ? `${formatBytes(failed)} 暂未清理，将在重启后重试`
                : '部分缓存未能处理，请稍后重试'),
            tone: 'fail'
          };
        }
        if (result?.pendingRestart) {
          return `✓ 已清理运行中缓存，约 ${formatBytes(pending)} 将在重启后清理`;
        }
        return `✓ 已清理 ${formatBytes(released)}`;
      });
    }

    function deleteLegacy() {
      const candidate = state.eligibleLegacy;
      if (!candidate) return Promise.reject(new Error('没有可清理的旧版数据'));
      return run('legacy', () => operations.deleteLegacyData(candidate.id), result => {
        if (result?.cancelled) return '已取消';
        if (asBytes(result?.failedBytes) > 0) {
          return {
            message: `已释放 ${formatBytes(asBytes(result?.deletedBytes))}，`
              + `${formatBytes(asBytes(result?.failedBytes))} 暂未删除`,
            tone: 'fail'
          };
        }
        if (result?.deleted === false) {
          return {
            message: '未删除：文件正在使用，请关闭相关程序后重试',
            tone: 'fail'
          };
        }
        return `✓ 已清理 ${formatBytes(asBytes(result?.deletedBytes))}`;
      });
    }

    renderButtons();
    return Object.freeze({ load, prune, compact, clearCache, deleteLegacy });
  }

  return Object.freeze({ createStorageMaintenanceController });
});
