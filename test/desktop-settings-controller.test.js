'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

let DesktopSettingsController;
const priorGlobal = globalThis.DesktopSettingsController;
try {
  DesktopSettingsController = require('../renderer/desktop-settings-controller');
} catch {
  DesktopSettingsController = null;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createElement() {
  return {
    checked: false,
    disabled: false,
    textContent: '',
    className: '',
    attributes: new Map(),
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    },
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }
  };
}

const DEFAULT_SNAPSHOT = Object.freeze({
  closeToTray: false,
  launchAtLogin: false,
  launchAtLoginSupported: true,
  warnings: Object.freeze([])
});

function createFixture(snapshot = DEFAULT_SNAPSHOT, overrides = {}) {
  const closeToTray = createElement();
  const launchAtLogin = createElement();
  const status = createElement();
  const getSettings = overrides.getSettings || (async () => snapshot);
  const updateSettings = overrides.updateSettings || (async patch => ({
    ...snapshot,
    ...patch
  }));
  const controller = DesktopSettingsController.createDesktopSettingsController({
    elements: { closeToTray, launchAtLogin, status },
    getSettings,
    updateSettings
  });
  return {
    closeToTray,
    launchAtLogin,
    status,
    controller
  };
}

test('module is CommonJS-safe and exposes a frozen API', () => {
  assert.ok(DesktopSettingsController, 'desktop settings controller must exist');
  assert.equal(globalThis.DesktopSettingsController, priorGlobal);
  assert.equal(Object.isFrozen(DesktopSettingsController), true);
  assert.equal(Object.isFrozen(createFixture().controller), true);
});

test('load renders the confirmed desktop snapshot', async () => {
  const fixture = createFixture({
    closeToTray: true,
    launchAtLogin: false,
    launchAtLoginSupported: true,
    warnings: []
  });
  await fixture.controller.load();

  assert.equal(fixture.closeToTray.checked, true);
  assert.equal(fixture.launchAtLogin.checked, false);
  assert.equal(fixture.closeToTray.disabled, false);
  assert.equal(fixture.launchAtLogin.disabled, false);
  assert.equal(fixture.status.textContent, '');
  assert.equal(
    fixture.status.className,
    'test-result desktop-settings-result desktop-settings-status'
  );
  assert.equal(fixture.status.getAttribute('aria-busy'), 'false');
});

test('changes serialize and render only confirmed snapshots', async () => {
  const first = deferred();
  const calls = [];
  const fixture = createFixture(undefined, {
    getSettings: async () => DEFAULT_SNAPSHOT,
    updateSettings(patch) {
      calls.push(patch);
      if (calls.length === 1) return first.promise;
      return Promise.resolve({
        closeToTray: false,
        launchAtLogin: true,
        launchAtLoginSupported: true,
        warnings: []
      });
    }
  });

  const one = fixture.controller.update('closeToTray', true);
  const two = fixture.controller.update('launchAtLogin', true);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, [{ closeToTray: true }]);
  assert.equal(fixture.closeToTray.checked, false);
  assert.equal(fixture.closeToTray.disabled, true);
  assert.equal(fixture.launchAtLogin.disabled, true);
  assert.equal(fixture.status.getAttribute('aria-busy'), 'true');

  first.resolve({
    closeToTray: true,
    launchAtLogin: false,
    launchAtLoginSupported: true,
    warnings: []
  });
  await one;
  assert.equal(fixture.closeToTray.checked, true);
  await two;
  assert.deepEqual(calls, [
    { closeToTray: true },
    { launchAtLogin: true }
  ]);
  assert.equal(fixture.closeToTray.checked, false);
  assert.equal(fixture.launchAtLogin.checked, true);
  assert.equal(fixture.closeToTray.disabled, false);
  assert.equal(fixture.launchAtLogin.disabled, false);
});

test('unsupported login disables only that switch and warnings use warning status', async () => {
  const fixture = createFixture({
    closeToTray: true,
    launchAtLogin: false,
    launchAtLoginSupported: false,
    warnings: ['仅 Windows 安装版支持登录启动', '托盘暂不可用']
  });
  await fixture.controller.load();

  assert.equal(fixture.closeToTray.disabled, false);
  assert.equal(fixture.launchAtLogin.disabled, true);
  assert.equal(
    fixture.status.textContent,
    '仅 Windows 安装版支持登录启动；托盘暂不可用'
  );
  assert.equal(
    fixture.status.className,
    'test-result desktop-settings-result desktop-settings-status warning'
  );
});

test('failed update restores actual settings and shows a fixed error', async () => {
  const calls = [];
  const fixture = createFixture(undefined, {
    getSettings: async () => {
      calls.push('get');
      return {
        closeToTray: false,
        launchAtLogin: true,
        launchAtLoginSupported: true,
        warnings: []
      };
    },
    updateSettings: async patch => {
      calls.push(patch);
      throw new Error('sensitive system detail');
    }
  });

  await assert.rejects(
    fixture.controller.update('closeToTray', true),
    /sensitive system detail/
  );
  assert.deepEqual(calls, [{ closeToTray: true }, 'get']);
  assert.equal(fixture.closeToTray.checked, false);
  assert.equal(fixture.launchAtLogin.checked, true);
  assert.equal(fixture.closeToTray.disabled, false);
  assert.equal(fixture.launchAtLogin.disabled, false);
  assert.equal(fixture.status.textContent, '桌面运行设置保存失败，请重试。');
  assert.equal(
    fixture.status.className,
    'test-result desktop-settings-result desktop-settings-status error'
  );
  assert.doesNotMatch(fixture.status.textContent, /sensitive/);
});

test('updates reject invalid fields and values before calling the bridge', async () => {
  let calls = 0;
  const fixture = createFixture(DEFAULT_SNAPSHOT, {
    updateSettings: async () => {
      calls += 1;
      return DEFAULT_SNAPSHOT;
    }
  });

  await assert.rejects(
    fixture.controller.update('closeToTray', 'yes'),
    /boolean/
  );
  await assert.rejects(
    fixture.controller.update('unknown', true),
    /Unknown desktop setting/
  );
  assert.equal(calls, 0);
});
