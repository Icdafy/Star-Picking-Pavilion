'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BACKGROUND_WARNING,
  DEFAULT_DESKTOP_SETTINGS,
  LOGIN_WARNING,
  createBackgroundModeController
} = require('../electron/background-mode');

function createFixture({
  closeToTray = false,
  launchAtLogin = false,
  platform = 'win32',
  isPackaged = true,
  trayFails = false,
  preferenceWriteFails = false,
  loginReadbackMismatch = false,
  notificationSupported = true
} = {}) {
  const execPath = 'C:\\Program Files\\摘星阁\\Star-Picking-Pavilion.exe';
  const windowCalls = [];
  const loginWrites = [];
  const preferenceWrites = [];
  const trays = [];
  const notifications = [];
  const logs = [];
  let preferences = { closeToTray };
  let loginEnabled = launchAtLogin;
  let loginReadFails = false;
  let quitting = false;
  let quitRequests = 0;

  const window = {
    destroyed: false,
    minimized: false,
    visible: true,
    isDestroyed() { return this.destroyed; },
    isMinimized() { return this.minimized; },
    isVisible() { return this.visible; },
    restore() {
      this.minimized = false;
      windowCalls.push('restore');
    },
    show() {
      this.visible = true;
      windowCalls.push('show');
    },
    focus() { windowCalls.push('focus'); },
    hide() {
      this.visible = false;
      windowCalls.push('hide');
    }
  };

  class FakeTray {
    constructor(iconPath) {
      if (trayFails) throw new Error('injected tray failure');
      this.iconPath = iconPath;
      this.handlers = new Map();
      this.destroyCount = 0;
      this.destroyed = false;
      trays.push(this);
    }

    setToolTip(value) { this.tooltip = value; }
    setContextMenu(value) { this.menu = value; }
    on(event, listener) { this.handlers.set(event, listener); }
    isDestroyed() { return this.destroyed; }
    destroy() {
      this.destroyed = true;
      this.destroyCount += 1;
    }
    emit(event) { this.handlers.get(event)?.(); }
  }

  const Menu = {
    buildFromTemplate(template) {
      return { template };
    }
  };

  class FakeNotification {
    static isSupported() { return notificationSupported; }

    constructor(options) {
      this.options = options;
      this.showCount = 0;
      notifications.push(this);
    }

    show() { this.showCount += 1; }
  }

  const app = {
    isPackaged,
    getLoginItemSettings() {
      if (loginReadFails) throw new Error('injected login read failure');
      return { openAtLogin: loginEnabled };
    },
    setLoginItemSettings(settings) {
      loginWrites.push(settings);
      if (!loginReadbackMismatch) loginEnabled = settings.openAtLogin;
    },
    quit() { quitRequests += 1; }
  };

  const preferenceStore = {
    getSnapshot() { return { ...preferences }; },
    async update(patch) {
      preferenceWrites.push(patch);
      if (preferenceWriteFails) throw new Error('injected preference failure');
      preferences = { ...preferences, ...patch };
      return { version: 1, ...preferences };
    }
  };

  const dependencies = {
    app,
    Tray: FakeTray,
    Menu,
    Notification: FakeNotification,
    getWindow: () => window,
    preferenceStore,
    iconPath: 'C:\\resources\\tray-icon.ico',
    platform,
    isPackaged,
    execPath,
    isQuitting: () => quitting,
    requestQuit: () => { quitRequests += 1; },
    logError: error => logs.push(error.message)
  };

  return {
    dependencies,
    execPath,
    window,
    windowCalls,
    loginWrites,
    preferenceWrites,
    trays,
    notifications,
    logs,
    get preferences() { return preferences; },
    get loginEnabled() { return loginEnabled; },
    get quitRequests() { return quitRequests; },
    setLoginReadFails(value) { loginReadFails = value; },
    setQuitting(value) { quitting = value; }
  };
}

test('defaults stay visible and do not create a tray', async () => {
  const fixture = createFixture({ closeToTray: false });
  const controller = createBackgroundModeController(fixture.dependencies);

  assert.deepEqual(await controller.initialize(), {
    ...DEFAULT_DESKTOP_SETTINGS,
    launchAtLoginSupported: true
  });
  assert.equal(fixture.trays.length, 0);
  assert.equal(controller.shouldStartHidden(['electron', '.', '--hidden']), false);
  assert.equal(Object.isFrozen(controller), true);
});

test('enabled background mode hides close, creates one tray and notifies once', async () => {
  const fixture = createFixture({ closeToTray: true });
  const controller = createBackgroundModeController(fixture.dependencies);
  await controller.initialize();
  const firstEvent = { prevented: 0, preventDefault() { this.prevented += 1; } };
  const secondEvent = { prevented: 0, preventDefault() { this.prevented += 1; } };

  assert.equal(controller.handleWindowClose(firstEvent), true);
  assert.equal(controller.handleWindowClose(secondEvent), true);
  assert.equal(firstEvent.prevented, 1);
  assert.equal(secondEvent.prevented, 1);
  assert.deepEqual(fixture.windowCalls, ['hide', 'hide']);
  assert.equal(fixture.notifications.length, 1);
  assert.equal(fixture.notifications[0].showCount, 1);
  assert.equal(fixture.trays.length, 1);
  assert.equal(controller.shouldStartHidden(['electron', '.', '--hidden']), true);
});

test('disabled or quitting background mode allows the normal close path', async () => {
  const fixture = createFixture({ closeToTray: true });
  const controller = createBackgroundModeController(fixture.dependencies);
  await controller.initialize();
  fixture.setQuitting(true);
  const quittingEvent = { preventDefault() { throw new Error('must not intercept'); } };
  assert.equal(controller.handleWindowClose(quittingEvent), false);

  fixture.setQuitting(false);
  const snapshot = await controller.updateSettings({ closeToTray: false });
  assert.equal(snapshot.closeToTray, false);
  assert.equal(fixture.trays[0].destroyCount, 1);
  const disabledEvent = { preventDefault() { throw new Error('must not intercept'); } };
  assert.equal(controller.handleWindowClose(disabledEvent), false);
});

test('tray activation shares window restore and the menu exposes explicit quit', async () => {
  const fixture = createFixture({ closeToTray: true });
  fixture.window.visible = false;
  fixture.window.minimized = true;
  const controller = createBackgroundModeController(fixture.dependencies);
  await controller.initialize();
  const tray = fixture.trays[0];

  tray.emit('click');
  tray.emit('double-click');
  tray.menu.template[0].click();
  assert.deepEqual(fixture.windowCalls, [
    'restore', 'show', 'focus',
    'focus',
    'focus'
  ]);
  assert.deepEqual(
    tray.menu.template.map(item => item.label || item.type),
    ['打开摘星阁', 'separator', '退出摘星阁']
  );
  tray.menu.template[2].click();
  assert.equal(fixture.quitRequests, 1);
});

test('desktop update validates fields and confirms login state by readback', async () => {
  const fixture = createFixture({ closeToTray: false, launchAtLogin: false });
  const controller = createBackgroundModeController(fixture.dependencies);
  await controller.initialize();

  await assert.rejects(
    controller.updateSettings({ closeToTray: 'yes' }),
    /closeToTray 必须是布尔值/
  );
  await assert.rejects(
    controller.updateSettings({ unknown: true }),
    /未知桌面设置/
  );
  await assert.rejects(controller.updateSettings([]), /普通对象/);

  const snapshot = await controller.updateSettings({ launchAtLogin: true });
  assert.equal(snapshot.launchAtLogin, true);
  assert.deepEqual(fixture.loginWrites.at(-1), {
    openAtLogin: true,
    path: fixture.execPath,
    args: []
  });
});

test('login startup is unsupported outside a packaged Windows build', async () => {
  for (const options of [
    { platform: 'linux', isPackaged: true },
    { platform: 'win32', isPackaged: false }
  ]) {
    const fixture = createFixture(options);
    const controller = createBackgroundModeController(fixture.dependencies);
    const snapshot = await controller.initialize();
    assert.equal(snapshot.launchAtLoginSupported, false);
    await assert.rejects(
      controller.updateSettings({ launchAtLogin: true }),
      /Windows 登录启动仅在安装版中可用/
    );
    assert.equal(fixture.loginWrites.length, 0);
  }
});

test('changing background mode rewrites an enabled login item hidden arguments', async () => {
  const fixture = createFixture({ closeToTray: false, launchAtLogin: true });
  const controller = createBackgroundModeController(fixture.dependencies);
  await controller.initialize();

  const enabled = await controller.updateSettings({ closeToTray: true });
  assert.equal(enabled.closeToTray, true);
  assert.deepEqual(fixture.loginWrites.at(-1), {
    openAtLogin: true,
    path: fixture.execPath,
    args: ['--hidden']
  });

  const disabled = await controller.updateSettings({ closeToTray: false });
  assert.equal(disabled.closeToTray, false);
  assert.deepEqual(fixture.loginWrites.at(-1), {
    openAtLogin: true,
    path: fixture.execPath,
    args: []
  });
});

test('tray construction failure preserves a visible safe runtime', async () => {
  const fixture = createFixture({ closeToTray: true, trayFails: true });
  const controller = createBackgroundModeController(fixture.dependencies);
  const snapshot = await controller.initialize();

  assert.equal(snapshot.closeToTray, false);
  assert.deepEqual(snapshot.warnings, [BACKGROUND_WARNING]);
  assert.equal(controller.shouldStartHidden(['electron', '.', '--hidden']), false);
  assert.equal(controller.handleWindowClose({ preventDefault() {} }), false);
  assert.equal(fixture.logs.includes('injected tray failure'), true);
});

test('failed preference writes restore the previous confirmed runtime', async () => {
  const fixture = createFixture({
    closeToTray: false,
    preferenceWriteFails: true
  });
  const controller = createBackgroundModeController(fixture.dependencies);
  await controller.initialize();

  await assert.rejects(
    controller.updateSettings({ closeToTray: true }),
    /后台运行设置保存失败/
  );
  assert.equal((await controller.getSettings()).closeToTray, false);
  assert.equal(fixture.trays[0].destroyCount, 1);
  assert.equal(controller.handleWindowClose({ preventDefault() {} }), false);
  assert.deepEqual(fixture.preferenceWrites, [{ closeToTray: true }]);
});

test('login readback mismatch rejects without claiming success', async () => {
  const fixture = createFixture({
    launchAtLogin: false,
    loginReadbackMismatch: true
  });
  const controller = createBackgroundModeController(fixture.dependencies);
  await controller.initialize();

  await assert.rejects(
    controller.updateSettings({ launchAtLogin: true }),
    /Windows 登录启动设置未能确认/
  );
  const snapshot = await controller.getSettings();
  assert.equal(snapshot.launchAtLogin, false);
  assert.deepEqual(snapshot.warnings, [LOGIN_WARNING]);
});

test('a login readback error cannot masquerade as confirmed disabled state', async () => {
  const fixture = createFixture({ launchAtLogin: true });
  const controller = createBackgroundModeController(fixture.dependencies);
  await controller.initialize();
  fixture.setLoginReadFails(true);

  await assert.rejects(
    controller.updateSettings({ launchAtLogin: false }),
    /Windows 登录启动设置未能确认/
  );
  assert.deepEqual(fixture.loginWrites.at(-1), {
    openAtLogin: false,
    path: fixture.execPath,
    args: []
  });
  assert.deepEqual((await controller.getSettings()).warnings, [LOGIN_WARNING]);
});

test('an externally destroyed tray never permits an inaccessible hidden window', async () => {
  const fixture = createFixture({ closeToTray: true });
  const controller = createBackgroundModeController(fixture.dependencies);
  await controller.initialize();
  fixture.trays[0].destroyed = true;

  assert.equal(controller.handleWindowClose({ preventDefault() {} }), false);
  assert.equal(controller.shouldStartHidden(['--hidden']), false);
  assert.equal((await controller.getSettings()).closeToTray, false);

  const recovered = await controller.updateSettings({ closeToTray: true });
  assert.equal(recovered.closeToTray, true);
  assert.equal(fixture.trays.length, 2);
  controller.dispose();
  assert.equal(fixture.trays[0].destroyCount, 0);
  assert.equal(fixture.trays[1].destroyCount, 1);
});

test('notification failures degrade silently and dispose is idempotent', async () => {
  const fixture = createFixture({
    closeToTray: true,
    notificationSupported: false
  });
  const controller = createBackgroundModeController(fixture.dependencies);
  await controller.initialize();
  controller.handleWindowClose({ preventDefault() {} });
  assert.equal(fixture.notifications.length, 0);

  controller.dispose();
  controller.dispose();
  assert.equal(fixture.trays[0].destroyCount, 1);
  assert.equal(controller.shouldStartHidden(['--hidden']), false);
  assert.equal(controller.handleWindowClose({ preventDefault() {} }), false);
});
