'use strict';

const { showExistingWindow } = require('./server-process');

const DEFAULT_DESKTOP_SETTINGS = Object.freeze({
  closeToTray: false,
  launchAtLogin: false,
  launchAtLoginSupported: false,
  warnings: Object.freeze([])
});
const ALLOWED_PATCH_FIELDS = new Set(['closeToTray', 'launchAtLogin']);
const BACKGROUND_WARNING = '系统托盘暂不可用，摘星阁将保持窗口运行。';
const LOGIN_WARNING = 'Windows 登录启动设置未能同步，请在系统启动应用中确认。';
const BACKGROUND_SAVE_ERROR = '后台运行设置保存失败，请重试。';
const LOGIN_CONFIRM_ERROR = 'Windows 登录启动设置未能确认，请重试。';
const LOGIN_UNSUPPORTED_ERROR = 'Windows 登录启动仅在安装版中可用。';

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function createBackgroundModeController({
  app,
  Tray,
  Menu,
  Notification,
  getWindow,
  preferenceStore,
  iconPath,
  platform = process.platform,
  isPackaged = app?.isPackaged === true,
  execPath = process.execPath,
  isQuitting = () => false,
  requestQuit = () => app.quit(),
  logError = error => console.error('[桌面运行]', error.message)
} = {}) {
  if (!app || typeof app.getLoginItemSettings !== 'function'
    || typeof app.setLoginItemSettings !== 'function') {
    throw new TypeError('app 必须提供登录启动设置接口');
  }
  if (typeof Tray !== 'function') throw new TypeError('Tray 构造器不可用');
  if (!Menu || typeof Menu.buildFromTemplate !== 'function') {
    throw new TypeError('Menu 构造器不可用');
  }
  if (typeof getWindow !== 'function') throw new TypeError('getWindow 必须是函数');
  if (!preferenceStore || typeof preferenceStore.getSnapshot !== 'function'
    || typeof preferenceStore.update !== 'function') {
    throw new TypeError('preferenceStore 不可用');
  }

  const launchAtLoginSupported = platform === 'win32' && isPackaged;
  let initialized = false;
  let disposed = false;
  let closeToTray = false;
  let tray = null;
  let backgroundNoticeShown = false;
  let warnings = [];

  function addWarning(message) {
    if (!warnings.includes(message)) warnings.push(message);
  }

  function recordError(error) {
    try { logError(error instanceof Error ? error : new Error(String(error))); } catch {}
  }

  function queryLaunchAtLogin() {
    if (!launchAtLoginSupported) return { confirmed: true, value: false };
    try {
      return {
        confirmed: true,
        value: app.getLoginItemSettings().openAtLogin === true
      };
    } catch (error) {
      recordError(error);
      addWarning(LOGIN_WARNING);
      return { confirmed: false, value: false };
    }
  }

  function getSettings() {
    const login = queryLaunchAtLogin();
    return {
      closeToTray: closeToTray === true && hasUsableTray() && !disposed,
      launchAtLogin: login.value,
      launchAtLoginSupported,
      warnings: [...warnings]
    };
  }

  function showMainWindow() {
    return showExistingWindow(getWindow());
  }

  function destroyTray() {
    const current = tray;
    tray = null;
    if (!current) return;
    try {
      if (current.isDestroyed?.() !== true) current.destroy();
    } catch (error) {
      recordError(error);
    }
  }

  function hasUsableTray() {
    if (!tray) return false;
    try {
      if (tray.isDestroyed?.() !== true) return true;
    } catch (error) {
      recordError(error);
    }
    tray = null;
    return false;
  }

  function ensureTray() {
    if (disposed) return false;
    if (hasUsableTray()) return true;
    try {
      const created = new Tray(iconPath);
      created.setToolTip('摘星阁 · 情报站');
      created.setContextMenu(Menu.buildFromTemplate([
        { label: '打开摘星阁', click: showMainWindow },
        { type: 'separator' },
        { label: '退出摘星阁', click: requestQuit }
      ]));
      created.on('click', showMainWindow);
      created.on('double-click', showMainWindow);
      tray = created;
      return true;
    } catch (error) {
      tray = null;
      recordError(error);
      addWarning(BACKGROUND_WARNING);
      return false;
    }
  }

  function showBackgroundNotice() {
    if (backgroundNoticeShown) return;
    backgroundNoticeShown = true;
    try {
      if (!Notification || Notification.isSupported?.() === false) return;
      const notification = new Notification({
        title: '摘星阁仍在后台运行',
        body: '可从系统托盘重新打开，或选择“退出摘星阁”彻底退出。'
      });
      notification.show();
    } catch {}
  }

  function handleWindowClose(event) {
    if (disposed || !closeToTray || !hasUsableTray() || isQuitting()) return false;
    const window = getWindow();
    if (!window || window.isDestroyed?.() || typeof window.hide !== 'function') return false;
    event?.preventDefault?.();
    window.hide();
    showBackgroundNotice();
    return true;
  }

  function shouldStartHidden(argv = process.argv) {
    return !disposed && closeToTray && hasUsableTray()
      && Array.isArray(argv) && argv.includes('--hidden');
  }

  function loginItemSettings(openAtLogin) {
    return {
      openAtLogin,
      path: execPath,
      args: closeToTray ? ['--hidden'] : []
    };
  }

  function writeLaunchAtLogin(openAtLogin) {
    if (!launchAtLoginSupported) throw new Error(LOGIN_UNSUPPORTED_ERROR);
    try {
      app.setLoginItemSettings(loginItemSettings(openAtLogin));
    } catch (error) {
      recordError(error);
      addWarning(LOGIN_WARNING);
      throw new Error(LOGIN_CONFIRM_ERROR);
    }
    const readback = queryLaunchAtLogin();
    if (!readback.confirmed || readback.value !== openAtLogin) {
      addWarning(LOGIN_WARNING);
      throw new Error(LOGIN_CONFIRM_ERROR);
    }
  }

  async function updateCloseToTray(nextValue) {
    const previousValue = closeToTray;
    const createdForUpdate = nextValue && !hasUsableTray();
    if (nextValue && !ensureTray()) throw new Error(BACKGROUND_WARNING);

    try {
      await preferenceStore.update({ closeToTray: nextValue });
    } catch (error) {
      recordError(error);
      closeToTray = previousValue;
      if (createdForUpdate && !previousValue) destroyTray();
      throw new Error(BACKGROUND_SAVE_ERROR);
    }

    closeToTray = nextValue;
    if (!nextValue) destroyTray();

    const login = queryLaunchAtLogin();
    if (login.confirmed && login.value) {
      try {
        writeLaunchAtLogin(true);
      } catch (error) {
        recordError(error);
        addWarning(LOGIN_WARNING);
      }
    }
  }

  async function updateSettings(patch) {
    if (disposed) throw new Error('桌面运行控制器已停止。');
    if (!isPlainObject(patch)) throw new TypeError('桌面设置更新必须是普通对象。');
    for (const field of Reflect.ownKeys(patch)) {
      if (!ALLOWED_PATCH_FIELDS.has(field)) {
        throw new TypeError(`未知桌面设置：${String(field)}`);
      }
    }
    if (Object.hasOwn(patch, 'closeToTray') && typeof patch.closeToTray !== 'boolean') {
      throw new TypeError('closeToTray 必须是布尔值。');
    }
    if (Object.hasOwn(patch, 'launchAtLogin') && typeof patch.launchAtLogin !== 'boolean') {
      throw new TypeError('launchAtLogin 必须是布尔值。');
    }

    warnings = [];
    if (Object.hasOwn(patch, 'closeToTray')) {
      await updateCloseToTray(patch.closeToTray);
    }
    if (Object.hasOwn(patch, 'launchAtLogin')) {
      writeLaunchAtLogin(patch.launchAtLogin);
    }
    return getSettings();
  }

  async function initialize() {
    if (initialized) return getSettings();
    initialized = true;
    closeToTray = preferenceStore.getSnapshot().closeToTray === true;
    if (closeToTray && !ensureTray()) closeToTray = false;
    return getSettings();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    closeToTray = false;
    destroyTray();
  }

  return Object.freeze({
    initialize,
    getSettings,
    updateSettings,
    handleWindowClose,
    showMainWindow,
    shouldStartHidden,
    dispose
  });
}

module.exports = {
  BACKGROUND_WARNING,
  DEFAULT_DESKTOP_SETTINGS,
  LOGIN_WARNING,
  createBackgroundModeController
};
