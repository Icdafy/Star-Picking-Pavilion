'use strict';

(function exposeDesktopSettingsController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.DesktopSettingsController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDesktopSettingsModule() {
  const SETTING_FIELDS = Object.freeze(['closeToTray', 'launchAtLogin']);
  const SAVE_ERROR = '桌面运行设置保存失败，请重试。';
  const DEFAULT_SNAPSHOT = Object.freeze({
    closeToTray: false,
    launchAtLogin: false,
    launchAtLoginSupported: false,
    warnings: Object.freeze([])
  });

  function createDesktopSettingsController({
    elements,
    getSettings,
    updateSettings
  } = {}) {
    if (
      !elements
      || typeof getSettings !== 'function'
      || typeof updateSettings !== 'function'
    ) {
      throw new TypeError('desktop settings elements and bridge methods are required');
    }
    for (const name of ['closeToTray', 'launchAtLogin', 'status']) {
      if (!elements[name]) {
        throw new TypeError(`desktop settings element is required: ${name}`);
      }
    }

    let queue = Promise.resolve();
    let pending = false;
    let confirmedSnapshot = DEFAULT_SNAPSHOT;

    function normalizeSnapshot(snapshot) {
      const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
      return {
        closeToTray: source.closeToTray === true,
        launchAtLogin: source.launchAtLogin === true,
        launchAtLoginSupported: source.launchAtLoginSupported === true,
        warnings: Array.isArray(source.warnings)
          ? source.warnings.filter(value => typeof value === 'string' && value)
          : []
      };
    }

    function render(snapshot, { error = false } = {}) {
      confirmedSnapshot = normalizeSnapshot(snapshot);
      elements.closeToTray.checked = confirmedSnapshot.closeToTray;
      elements.launchAtLogin.checked = confirmedSnapshot.launchAtLogin;
      elements.closeToTray.disabled = pending;
      elements.launchAtLogin.disabled = pending
        || !confirmedSnapshot.launchAtLoginSupported;
      elements.status.setAttribute('aria-busy', String(pending));

      if (error) {
        elements.status.textContent = SAVE_ERROR;
        elements.status.className = 'desktop-settings-status error';
        return;
      }
      elements.status.textContent = confirmedSnapshot.warnings.join('；');
      elements.status.className = confirmedSnapshot.warnings.length
        ? 'desktop-settings-status warning'
        : 'desktop-settings-status';
    }

    function setPending(value) {
      pending = value;
      render(confirmedSnapshot);
    }

    function enqueue(operation) {
      const next = queue.catch(() => {}).then(operation);
      queue = next;
      return next;
    }

    function load() {
      return enqueue(async () => {
        setPending(true);
        try {
          const snapshot = await getSettings();
          confirmedSnapshot = normalizeSnapshot(snapshot);
          return snapshot;
        } finally {
          setPending(false);
        }
      });
    }

    function update(field, value) {
      if (!SETTING_FIELDS.includes(field)) {
        return Promise.reject(new TypeError(`Unknown desktop setting: ${field}`));
      }
      if (typeof value !== 'boolean') {
        return Promise.reject(new TypeError(`${field} must be a boolean`));
      }

      return enqueue(async () => {
        setPending(true);
        try {
          const snapshot = await updateSettings({ [field]: value });
          confirmedSnapshot = normalizeSnapshot(snapshot);
          return snapshot;
        } catch (error) {
          try {
            confirmedSnapshot = normalizeSnapshot(await getSettings());
          } catch {
            // Keep the last confirmed snapshot if the readback also fails.
          }
          pending = false;
          render(confirmedSnapshot, { error: true });
          throw error;
        } finally {
          if (pending) setPending(false);
        }
      });
    }

    render(confirmedSnapshot);
    return Object.freeze({ load, update });
  }

  return Object.freeze({ createDesktopSettingsController });
});
