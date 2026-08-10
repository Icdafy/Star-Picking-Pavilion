'use strict';

/* 摘星阁 · 设置视图控制器
   阶段 3 批 2 自 app.js 抽离：AI 配置、采集、数据保留、桌面运行、
   每日归档、存储治理与情报备忘的装配和接线。
   $、api、toast、桌面桥与各子控制器工厂一律走依赖注入。 */

(function exposeSettingsViewController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.SettingsViewController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSettingsViewControllerModule() {
  function createSettingsViewController({
    $, api, esc, timeAgo, formatBytes, toast, confirmGlass, refreshStats,
    Desktop, SettingsFormController, DesktopSettingsController,
    StorageMaintenanceController, DailyArchiveController
  } = {}) {
    if (typeof $ !== 'function' || typeof api !== 'function'
      || typeof esc !== 'function' || typeof timeAgo !== 'function'
      || typeof formatBytes !== 'function' || typeof toast !== 'function'
      || typeof confirmGlass !== 'function' || typeof refreshStats !== 'function'
      || !SettingsFormController || !StorageMaintenanceController) {
      throw new TypeError('settings view controller requires $, api, esc, timeAgo, formatBytes, toast, confirmGlass, refreshStats and sub-controller dependencies');
    }

    const settingsForm = SettingsFormController.createSettingsFormController({
      elements: {
        apiKey: $('#setApiKey'),
        baseUrl: $('#setBaseUrl'),
        model: $('#setModel'),
        intervalMinutes: $('#setInterval'),
        rsshubBase: $('#setRsshub'),
        retentionDays: $('#setRetentionDays'),
        irrelevantRetentionDays: $('#setIrrelevantRetentionDays'),
        clearApiKeyButton: $('#btnClearAiKey')
      },
      request: api
    });

    const desktopSettings = (
      DesktopSettingsController
      && Desktop?.getDesktopSettings
      && Desktop?.updateDesktopSettings
    ) ? DesktopSettingsController.createDesktopSettingsController({
        elements: {
          closeToTray: $('#setCloseToTray'),
          launchAtLogin: $('#setLaunchAtLogin'),
          status: $('#desktopSettingsResult')
        },
        getSettings: () => Desktop.getDesktopSettings(),
        updateSettings: patch => Desktop.updateDesktopSettings(patch)
      }) : null;

    if (!desktopSettings) {
      $('#setCloseToTray').disabled = true;
      $('#setLaunchAtLogin').disabled = true;
      $('#desktopSettingsResult').textContent = '桌面运行设置仅在安装版中可用。';
      $('#desktopSettingsResult').className = 'test-result desktop-settings-result warning';
    }

    const dailyArchiveAvailable = Boolean(
      DailyArchiveController
      && Desktop?.getDailyArchiveSettings
      && Desktop?.chooseDailyArchiveDirectory
      && Desktop?.setDailyArchiveEnabled
      && Desktop?.saveCurrentDailyArchive
      && Desktop?.retryDailyArchives
    );
    const dailyArchive = dailyArchiveAvailable
      ? DailyArchiveController.createDailyArchiveController({
          elements: {
            enabled: $('#dailyArchiveEnabled'),
            rootDirectory: $('#dailyArchivePath'),
            chooseButton: $('#btnChooseDailyArchive'),
            saveButton: $('#btnSaveDailyArchive'),
            retryButton: $('#btnRetryDailyArchive'),
            nextRun: $('#dailyArchiveNextRun'),
            lastSuccess: $('#dailyArchiveLastSuccess'),
            pending: $('#dailyArchivePending'),
            status: $('#dailyArchiveStatus')
          },
          bridge: {
            getDailyArchiveSettings: () => Desktop.getDailyArchiveSettings(),
            chooseDailyArchiveDirectory: () => Desktop.chooseDailyArchiveDirectory(),
            setDailyArchiveEnabled: enabled => Desktop.setDailyArchiveEnabled(enabled),
            saveCurrentDailyArchive: () => Desktop.saveCurrentDailyArchive(),
            retryDailyArchives: () => Desktop.retryDailyArchives()
          }
        })
      : null;

    if (!dailyArchive) {
      $('#dailyArchiveEnabled').disabled = true;
      $('#btnChooseDailyArchive').disabled = true;
      $('#btnSaveDailyArchive').disabled = true;
      $('#btnRetryDailyArchive').disabled = true;
      $('#dailyArchiveStatus').textContent = '每日新闻简报自动归档仅在安装版中可用；当前仍可在“情报日报”中手动导出 Markdown。';
      $('#dailyArchiveStatus').className = 'test-result daily-archive-live warning';
    }

    $('#setCloseToTray').addEventListener('change', event => {
      desktopSettings?.update('closeToTray', event.currentTarget.checked).catch(() => {});
    });
    $('#setLaunchAtLogin').addEventListener('change', event => {
      desktopSettings?.update('launchAtLogin', event.currentTarget.checked).catch(() => {});
    });
    $('#dailyArchiveEnabled').addEventListener('change', event => {
      dailyArchive?.toggle(event.currentTarget.checked).catch(() => {});
    });
    $('#btnChooseDailyArchive').addEventListener('click', () => {
      dailyArchive?.chooseDirectory().catch(() => {});
    });
    $('#btnSaveDailyArchive').addEventListener('click', () => {
      dailyArchive?.saveCurrent().catch(() => {});
    });
    $('#btnRetryDailyArchive').addEventListener('click', () => {
      dailyArchive?.retry().catch(() => {});
    });

    const desktopStorageAvailable = Boolean(
      Desktop?.getStorageSnapshot
      && Desktop?.clearManagedCache
      && Desktop?.deleteLegacyData
    );
    const desktopStorageUnavailable = async () => {
      throw new Error('桌面存储治理仅在安装版中可用');
    };
    const storageMaintenance = StorageMaintenanceController.createStorageMaintenanceController({
      elements: {
        articles: $('#msArticles'),
        expiring: $('#msExpiring'),
        database: $('#msDatabase'),
        reclaimable: $('#msReclaimable'),
        cache: $('#msCache'),
        migrationResidue: $('#msMigrationResidue'),
        legacy: $('#msLegacy'),
        total: $('#msTotal'),
        hint: $('#lastPruneHint'),
        pruneButton: $('#btnPruneNow'),
        compactButton: $('#btnCompactNow'),
        cacheButton: $('#btnClearCache'),
        legacyButton: $('#btnDeleteLegacy'),
        pruneStatus: $('#pruneResult'),
        compactStatus: $('#compactResult'),
        cacheStatus: $('#cacheResult'),
        legacyStatus: $('#legacyResult')
      },
      requestDatabase: () => api('/api/maintenance'),
      pruneDatabase: () => api('/api/maintenance/prune', { body: {} }),
      compactDatabase: () => api('/api/maintenance/compact', { body: {} }),
      getDesktopStorage: desktopStorageAvailable
        ? () => Desktop.getStorageSnapshot()
        : desktopStorageUnavailable,
      clearDesktopCache: desktopStorageAvailable
        ? () => Desktop.clearManagedCache()
        : desktopStorageUnavailable,
      deleteLegacyData: desktopStorageAvailable
        ? candidateId => Desktop.deleteLegacyData(candidateId)
        : desktopStorageUnavailable,
      formatBytes
    });

    async function loadMaintenance() {
      return storageMaintenance.load().catch(() => null);
    }

    async function loadSettings() {
      try {
        await Promise.all([
          settingsForm.load(),
          desktopSettings?.load(),
          dailyArchive?.load()
        ]);
      } catch {}
      loadMaintenance();
      loadFeedback();
    }

    $('#btnSaveAi').addEventListener('click', async () => {
      try {
        await settingsForm.saveAi();
        toast('AI 配置已保存，下轮分析生效');
        refreshStats();
      } catch (error) {
        toast('AI 配置保存失败：' + error.message, true);
      }
    });

    $('#btnClearAiKey').addEventListener('click', async () => {
      if (!await confirmGlass('确定清除已由 Windows 安全保存的 AI API Key？清除后将使用关键词启发式降级模式。', { title: '清除密钥', okText: '清除' })) return;
      try {
        await settingsForm.clearApiKey();
        toast('AI API Key 已清除');
        refreshStats();
      } catch (error) {
        toast('清除密钥失败：' + error.message, true);
      }
    });

    $('#btnTestAi').addEventListener('click', async () => {
      const el = $('#aiTestResult');
      el.textContent = '测试中…'; el.className = 'test-result';
      $('#btnTestAi').disabled = true;
      try {
        const r = await api('/api/settings/test', { body: {} });
        el.textContent = r.ok ? '✓ 连接正常' : '✗ ' + r.error;
        el.classList.add(r.ok ? 'ok' : 'fail');
      } catch (e) {
        el.textContent = '✗ ' + e.message; el.classList.add('fail');
      } finally {
        $('#btnTestAi').disabled = false;
      }
    });

    $('#btnSaveCollect').addEventListener('click', async () => {
      try {
        await settingsForm.saveCollect();
        toast('采集设置已保存（间隔重启后生效，RSSHub 立即生效）');
      } catch (error) {
        toast('采集设置保存失败：' + error.message, true);
      }
    });

    $('#btnSaveRetention').addEventListener('click', async () => {
      try {
        await settingsForm.saveRetention();
        toast('数据保留设置已保存');
        loadMaintenance();
      } catch (error) {
        toast('数据保留设置保存失败：' + error.message, true);
      }
    });

    $('#btnPruneNow').addEventListener('click', async () => {
      try {
        await storageMaintenance.prune();
        refreshStats();
      } catch {}
    });

    $('#btnCompactNow').addEventListener('click', () => {
      storageMaintenance.compact().catch(() => {});
    });

    $('#btnClearCache').addEventListener('click', () => {
      storageMaintenance.clearCache().catch(() => {});
    });

    $('#btnDeleteLegacy').addEventListener('click', () => {
      storageMaintenance.deleteLegacy().catch(() => {});
    });

    // 情报备忘：写进本机库后要能回看和删除，否则提交等于写进黑洞
    async function loadFeedback() {
      const list = $('#feedbackList');
      try {
        const notes = await api('/api/feedback');
        list.innerHTML = notes.map(note => `
      <li class="note-item" data-id="${note.id}">
        <div class="note-body">
          <p>${esc(note.content)}</p>
          <span class="note-time">${esc(timeAgo(note.createdAt))}</span>
        </div>
        <button class="note-remove" data-act="remove-note" type="button"
          aria-label="删除这条备忘">删除</button>
      </li>`).join('');
      } catch {
        list.innerHTML = '';
      }
    }

    $('#feedbackList').addEventListener('click', async event => {
      const button = event.target.closest('button[data-act="remove-note"]');
      if (!button) return;
      const id = button.closest('.note-item').dataset.id;
      try {
        await api(`/api/feedback/${id}`, { method: 'DELETE' });
        loadFeedback();
      } catch (error) {
        toast('备忘删除失败：' + error.message, true);
      }
    });

    $('#btnFeedback').addEventListener('click', async () => {
      const t = $('#feedbackText').value.trim();
      if (!t) return toast('请先写点什么', true);
      try {
        await api('/api/feedback', { body: { kind: 'feedback', content: t } });
        $('#feedbackText').value = '';
        toast('已记入情报备忘');
        loadFeedback();
      } catch (error) {
        toast('反馈保存失败：' + error.message, true);
      }
    });

    return Object.freeze({ loadSettings });
  }

  return Object.freeze({ createSettingsViewController });
});
