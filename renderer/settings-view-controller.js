'use strict';

/* 摘星阁 · 设置视图控制器
   阶段 3 批 2 自 app.js 抽离：模型（v0.2.3 重构，形制照搬 DSH Models 页）、采集、数据保留、桌面运行、
   每日归档、存储治理与情报备忘的装配和接线。
   $、api、toast、桌面桥与各子控制器工厂一律走依赖注入。 */

(function exposeSettingsViewController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.SettingsViewController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSettingsViewControllerModule() {
  function createSettingsNavigation({ document: doc, window: win, viewport, panel, nav } = {}) {
    if (!win || !viewport || !panel || !nav?.querySelectorAll) return null;
    const links = [...nav.querySelectorAll('[data-settings-target]')];
    const sections = links.map(link => doc.getElementById(link.dataset.settingsTarget));
    let entered = false, frame = null;

    function offset() {
      const stickyTop = parseFloat(win.getComputedStyle(nav).top) || 0;
      return stickyTop + (win.matchMedia('(min-width: 70rem)').matches ? 0 : nav.getBoundingClientRect().height) + 12;
    }
    function select(id) {
      for (const link of links) {
        if (link.dataset.settingsTarget === id) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      }
    }
    function update() {
      frame = null;
      if (!entered || panel.hidden) return;
      const boundary = viewport.getBoundingClientRect().top + offset() + 28;
      let current = sections[0];
      for (const section of sections) {
        if (section?.getBoundingClientRect().top <= boundary) current = section;
      }
      if (viewport.scrollTop > 0 && viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 2) current = sections.at(-1);
      if (current) select(current.id);
    }
    function schedule() {
      if (entered && frame === null) frame = win.requestAnimationFrame(update);
    }
    function onClick(event) {
      const link = event.target.closest('[data-settings-target]');
      if (!link || !nav.contains(link)) return;
      const section = doc.getElementById(link.dataset.settingsTarget);
      if (!section) return;
      event.preventDefault();
      const top = section === sections[0] ? 0
        : viewport.scrollTop + section.getBoundingClientRect().top - viewport.getBoundingClientRect().top - offset();
      const reduced = win.matchMedia('(prefers-reduced-motion: reduce)').matches || doc.documentElement.dataset.fxTier === 'static';
      viewport.scrollTo({ top: Math.max(0, top), behavior: reduced ? 'instant' : 'smooth' });
      select(section.id);
      if (event.detail === 0) section.querySelector('h3')?.focus({ preventScroll: true });
    }
    function onKey(event) {
      const current = links.indexOf(doc.activeElement);
      if (current < 0) return;
      let next;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = links.length - 1;
      else if (['ArrowDown', 'ArrowRight'].includes(event.key)) next = (current + 1) % links.length;
      else if (['ArrowUp', 'ArrowLeft'].includes(event.key)) next = (current + links.length - 1) % links.length;
      else return;
      event.preventDefault(); event.stopPropagation(); links[next]?.focus({ preventScroll: true });
    }
    const resize = win.ResizeObserver ? new win.ResizeObserver(schedule) : null;
    nav.addEventListener('click', onClick);
    nav.addEventListener('keydown', onKey);
    function leave() {
      entered = false;
      viewport.removeEventListener('scroll', schedule);
      win.removeEventListener('resize', schedule);
      resize?.disconnect();
      if (frame !== null) win.cancelAnimationFrame(frame);
      frame = null;
    }
    return Object.freeze({
      enter() {
        if (entered) return;
        entered = true;
        viewport.addEventListener('scroll', schedule, { passive: true });
        win.addEventListener('resize', schedule, { passive: true });
        resize?.observe(panel);
        if (sections[0]) select(sections[0].id);
        schedule();
      },
      leave,
      dispose() { leave(); nav.removeEventListener('click', onClick); nav.removeEventListener('keydown', onKey); }
    });
  }

  function createSettingsViewController({
    $, api, esc, timeAgo, formatBytes, toast, confirmGlass, refreshStats,
    Desktop, SettingsFormController, DesktopSettingsController,
    StorageMaintenanceController, DailyArchiveController,
    focusTools = {}, motion = null,
    document: doc, window: win, viewport
  } = {}) {
    if (typeof $ !== 'function' || typeof api !== 'function'
      || typeof esc !== 'function' || typeof timeAgo !== 'function'
      || typeof formatBytes !== 'function' || typeof toast !== 'function'
      || typeof confirmGlass !== 'function' || typeof refreshStats !== 'function'
      || !SettingsFormController || !StorageMaintenanceController) {
      throw new TypeError('settings view controller requires $, api, esc, timeAgo, formatBytes, toast, confirmGlass, refreshStats and sub-controller dependencies');
    }
    const navigation = createSettingsNavigation({ document: doc, window: win, viewport, panel: $('#viewSettings'), nav: $('#settingsNav') });

    const settingsForm = SettingsFormController.createSettingsFormController({
      elements: {
        intervalMinutes: $('#setInterval'),
        rsshubBase: $('#setRsshub'),
        retentionDays: $('#setRetentionDays'),
        irrelevantRetentionDays: $('#setIrrelevantRetentionDays')
      },
      request: api
    });

    const modelsSettings = SettingsFormController.createModelsSettings({
      root: $('#modelsSection'),
      picker: $('#modelPickerDialog'),
      request: api,
      toast,
      confirm: confirmGlass,
      escapeHTML: esc,
      findFocusKey: focusTools.findFocusKey,
      restoreFocusByKey: focusTools.restoreFocusByKey,
      motion
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
      $('#dailyArchiveStatus').textContent = '每日新闻简报自动归档仅在安装版中可用；当前仍可在“情报日志”中手动导出 Markdown。';
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
          modelsSettings.load(),
          desktopSettings?.load(),
          dailyArchive?.load()
        ]);
      } catch {}
      loadMaintenance();
      loadFeedback();
    }

    $('#btnSaveCollect').addEventListener('click', async () => {
      try {
        await settingsForm.saveCollect();
        toast('采集设置已保存，采集间隔与 RSSHub 已生效');
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

    return Object.freeze({ loadSettings, loadModels: () => modelsSettings.load(),
      enter: () => navigation?.enter(), leave: () => navigation?.leave(), dispose: () => navigation?.dispose() });
  }

  return Object.freeze({ createSettingsViewController, createSettingsNavigation });
});
