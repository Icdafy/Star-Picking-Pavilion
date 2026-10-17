'use strict';

/* 摘星阁 · 设置视图控制器
   阶段 3 批 2 自 app.js 抽离：模型（v0.2.3 重构，形制照搬 DSH Models 页）、采集、新闻推送（v0.2.35）、数据保留、桌面运行、
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
        automatic: $('#setAutomaticCollect'),
        automaticCleanup: $('#setAutomaticCleanup'),
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
      motion,
      badge: $('#modelsBadge')
    });

    const pushSettings = typeof SettingsFormController.createPushSettings !== 'function' ? null : SettingsFormController.createPushSettings({
      elements: {
        enabled: $('#pushEnabled'),
        hero: $('#pushHero'),
        nextRun: $('#pushNextRun'),
        heroDetail: $('#pushHeroDetail'),
        timeline: $('#pushTimeline'),
        badge: $('#pushBoundBadge'),
        channels: $('#pushChannels'),
        bindPanel: $('#pushBindPanel'),
        schedule: $('#pushSchedule'),
        content: $('#pushContent'),
        preview: $('#btnPushPreview'),
        pushNow: $('#btnPushNow'),
        status: $('#pushStatus'),
        previewList: $('#pushPreview'),
        logSummary: $('#pushLogSummary'),
        history: $('#pushHistory')
      },
      request: api,
      toast,
      confirm: confirmGlass,
      escapeHTML: esc
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

    // —— v0.2.37 自动采集与保留期限：开关、点选、回车即保存，失败时读回服务器上的值 ——
    const Form = SettingsFormController;
    function renderPresets(selector, group, presets, current) {
      if (typeof Form.presetChips !== 'function' || !presets) return;
      $(selector).innerHTML = Form.presetChips(group, presets, current, esc);
    }
    function intervalText() {
      return Form.describeInterval?.($('#setInterval').value) || `${$('#setInterval').value} 分钟`;
    }
    function renderCollect() {
      const automatic = $('#setAutomaticCollect').checked === true;
      renderPresets('#collectIntervalChips', 'interval', Form.COLLECT_INTERVAL_PRESETS, Number($('#setInterval').value));
      $('#collectHeroTitle').textContent = !automatic ? '已关闭'
        : $('#setInterval').value ? `每 ${intervalText()}采集一次` : '已开启';
    }
    function renderRetention() {
      renderPresets('#retentionChips', 'retention', Form.RETENTION_PRESETS, Number($('#setRetentionDays').value));
      renderPresets('#irrelevantRetentionChips', 'irrelevant', Form.IRRELEVANT_RETENTION_PRESETS,
        Number($('#setIrrelevantRetentionDays').value));
    }

    async function loadForm() {
      try { return await settingsForm.load(); } finally { renderCollect(); renderRetention(); }
    }

    async function saveCollectField(field, describe) {
      try {
        await settingsForm.saveCollect([field]);
        toast(describe());
        await refreshStats();
        if (field === 'automatic') await loadMaintenance();
      } catch (error) {
        toast('自动采集设置保存失败：' + error.message, true);
        await settingsForm.discard?.([field]).catch(() => {});
      }
      renderCollect();
    }

    async function saveRetentionField(field, label, input) {
      try {
        await settingsForm.saveRetention([field]);
        toast(`${label}改为保留 ${input.value} 天`);
        loadMaintenance();
      } catch (error) {
        toast('保留期限保存失败：' + error.message, true);
        await settingsForm.discard?.([field]).catch(() => {});
      }
      renderRetention();
    }

    const describeAutomatic = () => ($('#setAutomaticCollect').checked
      ? `自动采集已开启：每 ${intervalText()}采集一次，首轮在一个间隔后开始`
      : '自动采集已关闭：之后只在点击“立即采集分析”时工作');
    const describeInterval = () => `采集间隔已改为每 ${intervalText()}，下一轮起按新间隔计时`;
    const describeRsshub = () => ($('#setRsshub').value.trim() ? 'RSSHub 地址已保存，rsshub:// 信源下一轮生效' : '已清除 RSSHub 地址');

    $('#setAutomaticCollect').addEventListener('change', () => saveCollectField('automatic', describeAutomatic));
    $('#setAutomaticCleanup').addEventListener('change', async () => {
      const input = $('#setAutomaticCleanup');
      input.disabled = true;
      try {
        await settingsForm.saveRetention(['automaticCleanup']);
        toast(input.checked ? '自动清理已开启：随自动采集每天清理过期内容' : '自动清理已关闭：可随时手动清理过期内容');
      } catch (error) {
        toast('自动清理设置保存失败：' + error.message, true);
        await settingsForm.discard?.(['automaticCleanup']).catch(() => {});
      } finally {
        input.disabled = false;
        await loadMaintenance();
      }
    });
    $('#setInterval').addEventListener('change', () => saveCollectField('intervalMinutes', describeInterval));
    $('#setRsshub').addEventListener('change', () => saveCollectField('rsshubBase', describeRsshub));
    $('#collectIntervalChips').addEventListener('click', event => {
      const chip = event.target.closest?.('[data-preset="interval"]');
      if (!chip || chip.getAttribute('aria-pressed') === 'true') return;
      $('#setInterval').value = chip.dataset.value;
      saveCollectField('intervalMinutes', describeInterval);
    });

    const retentionInputs = [
      ['#retentionChips', 'retention', '#setRetentionDays', 'retentionDays', '相关情报'],
      ['#irrelevantRetentionChips', 'irrelevant', '#setIrrelevantRetentionDays', 'irrelevantRetentionDays', '无关内容']
    ];
    for (const [chips, group, selector, field, label] of retentionInputs) {
      $(selector).addEventListener('change', () => saveRetentionField(field, label, $(selector)));
      $(chips).addEventListener('click', event => {
        const chip = event.target.closest?.(`[data-preset="${group}"]`);
        if (!chip || chip.getAttribute('aria-pressed') === 'true') return;
        $(selector).value = chip.dataset.value;
        saveRetentionField(field, label, $(selector));
      });
    }

    // 显示 → 深浅主题：与顶栏主题按钮同源（点它切换，含圆形揭开动画），并跟随 Alt+T 等外部切换
    const themeRoot = doc?.documentElement;
    function syncThemeOptions() {
      const current = themeRoot?.dataset.theme === 'dark' ? 'dark' : 'light';
      for (const button of $('#themeOptions').querySelectorAll?.('[data-theme-choice]') || []) {
        button.setAttribute('aria-pressed', String(button.dataset.themeChoice === current));
      }
    }
    $('#themeOptions').addEventListener('click', event => {
      const button = event.target.closest?.('[data-theme-choice]');
      if (button && themeRoot && themeRoot.dataset.theme !== button.dataset.themeChoice) $('#btnTheme').click?.();
    });
    if (themeRoot && win?.MutationObserver) {
      new win.MutationObserver(syncThemeOptions).observe(themeRoot, { attributes: true, attributeFilter: ['data-theme'] });
      syncThemeOptions();
    }

    async function loadSettings() {
      try {
        await Promise.all([
          loadForm(),
          refreshStats(),
          modelsSettings.load(),
          pushSettings?.load(),
          desktopSettings?.load(),
          dailyArchive?.load()
        ]);
      } catch {}
      loadMaintenance();
      loadFeedback();
    }

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
        list.innerHTML = notes.length ? notes.map(note => `
      <li class="note-item" data-id="${note.id}">
        <div class="note-body">
          <p>${esc(note.content)}</p>
          <span class="note-time">${esc(timeAgo(note.createdAt))}</span>
        </div>
        <button class="note-remove" data-act="remove-note" type="button"
          aria-label="删除这条备忘">删除</button>
      </li>`).join('') : '<li class="note-empty">还没有备忘。写下的内容会按时间倒序列在这里。</li>';
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

    async function addNote() {
      const t = $('#feedbackText').value.trim();
      if (!t) return toast('请先写点什么', true);
      try {
        await api('/api/feedback', { body: { kind: 'feedback', content: t } });
        $('#feedbackText').value = '';
        toast('已记入情报备忘');
        loadFeedback();
      } catch (error) {
        toast('备忘保存失败：' + error.message, true);
      }
    }
    $('#btnFeedback').addEventListener('click', addNote);
    $('#feedbackText').addEventListener('keydown', event => {
      if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.isComposing) return;
      event.preventDefault();
      addNote();
    });

    return Object.freeze({ loadSettings, loadModels: () => modelsSettings.load(), loadPush: () => pushSettings?.load(),
      enter: () => navigation?.enter(), leave: () => navigation?.leave(), dispose: () => navigation?.dispose() });
  }

  return Object.freeze({ createSettingsViewController, createSettingsNavigation });
});
