# Star-Picking-Pavilion v0.0.4 Desktop Background Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为摘星阁增加默认关闭、用户可控的托盘后台运行与 Windows 登录启动能力，并发布通过全部门禁的 v0.0.4。

**Architecture:** 扩展现有版本化界面偏好保存 `closeToTray`，新增可独立测试的 Electron 后台生命周期控制器作为托盘、窗口关闭和 Windows 登录启动的唯一协调者，再以严格白名单 IPC 暴露给独立的渲染层设置控制器。`electron/main.js` 只负责依赖组装和生命周期转发，Windows 登录启动状态始终从 Electron/操作系统回读，不写入 JSON。

**Tech Stack:** Electron 42、Node.js 22+、原生 JavaScript/CommonJS、Node test runner、Playwright Electron、HTML/CSS、electron-builder、GitHub Actions

---

## File map

- `renderer/ui-preference-schema.js`：为共享偏好结构增加 `closeToTray`。
- `electron/ui-preferences.js`：继续通过共享 schema 校验并原子保存后台偏好。
- `electron/background-mode.js`：新增；管理托盘、窗口显示/隐藏、首次提示、退出门禁和 Windows 登录启动。
- `electron/desktop-settings-ipc.js`：新增；注册桌面设置查询和白名单更新 IPC。
- `electron/main.js`：组装后台控制器，接入关闭、第二实例、隐藏启动和退出生命周期。
- `electron/preload.js`：暴露深冻结的桌面设置查询与更新方法。
- `renderer/desktop-settings-controller.js`：新增；串行加载、更新和渲染两个桌面开关。
- `renderer/index.html`：新增“桌面运行”设置卡和脚本引用。
- `renderer/styles.css`：新增可访问开关及状态样式。
- `renderer/app.js`：装配桌面设置控制器并在设置页加载。
- `test/ui-preferences.test.js`：偏好默认值、规范化、保存和拒绝行为。
- `test/ui-preference-schema.test.js`：渲染层与 Electron 层的共享 schema 等价性。
- `test/background-mode.test.js`：新增；后台生命周期控制器单元测试。
- `test/desktop-settings-ipc.test.js`：新增；IPC 就绪、转发和错误边界测试。
- `test/desktop-settings-controller.test.js`：新增；渲染控制器队列、回读和失败测试。
- `test/preload.test.js`：桌面 API 权限边界与深冻结测试。
- `test/main-security.test.js`：主进程组装顺序、安全与退出回归。
- `test/renderer-integration.test.js`：设置页结构、脚本装配和样式回归。
- `test/e2e/electron.test.js`：真实 Electron 托盘隐藏、第二实例唤醒、隐藏冷启动和持久化。
- `test/branding.test.js`、`test/package-verifier.test.js`、`test/release-readiness.test.js`：v0.0.4 发布身份。
- `package.json`、`package-lock.json`：托盘图标资源白名单与版本更新。
- `scripts/verify-package.js`：允许并验证发布包中的托盘图标资源。
- `README.md`、`CHANGELOG.md`、`RELEASE_NOTES.md`、`RELEASING.md`、`THIRD_PARTY_NOTICES.txt`：用户说明和发布元数据。

### Task 1: Extend the versioned preference schema with `closeToTray`

**Files:**
- Modify: `test/ui-preferences.test.js`
- Modify: `test/ui-preference-schema.test.js`
- Modify: `renderer/ui-preference-schema.js`
- Modify: `electron/ui-preferences.js`

- [ ] **Step 1: Add failing preference-shape and validation assertions**

Update the complete expected shape in `test/ui-preferences.test.js`:

```js
assert.deepEqual(DEFAULT_UI_PREFERENCES, {
  version: 1,
  theme: 'dark',
  view: 'featured',
  domain: '',
  category: '',
  dailyDate: null,
  linksCategory: CommonLinks.ALL_CATEGORY,
  commonLinksFavorites: defaultFavoriteIds,
  realtime: true,
  closeToTray: false
});
```

Extend the valid normalization fixture with `closeToTray: true`, extend the invalid fixture with `closeToTray: 'yes'`, and add:

```js
test('closeToTray accepts only booleans and persists atomically', async t => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-ui-preferences-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  await store.load();

  assert.equal((await store.update({ closeToTray: true })).closeToTray, true);
  assert.equal(JSON.parse(await fs.promises.readFile(store.file, 'utf8')).closeToTray, true);
  assert.throws(() => store.update({ closeToTray: 'yes' }), /closeToTray.*boolean/i);
});
```

Add `closeToTray` to both normal and damaged input objects in `test/ui-preference-schema.test.js` so the renderer/Electron equivalence assertion covers it.

- [ ] **Step 2: Run the focused tests and verify the expected failure**

Run:

```powershell
node --test test/ui-preferences.test.js test/ui-preference-schema.test.js
```

Expected: FAIL because defaults omit `closeToTray`, valid input is discarded, and the patch is rejected as unknown.

- [ ] **Step 3: Add the shared schema field and strict validation**

In `renderer/ui-preference-schema.js`, add the field to `UI_PREFERENCE_FIELDS`, the default object, normalization result and validator:

```js
const UI_PREFERENCE_FIELDS = Object.freeze([
  'theme',
  'view',
  'domain',
  'category',
  'dailyDate',
  'linksCategory',
  'commonLinksFavorites',
  'realtime',
  'closeToTray'
]);
```

```js
function getDefaultUiPreferences(commonLinks) {
  return {
    theme: 'dark',
    view: 'featured',
    domain: '',
    category: '',
    dailyDate: null,
    linksCategory: commonLinks.ALL_CATEGORY,
    commonLinksFavorites: [...commonLinks.getDefaultFavoriteIds()],
    realtime: true,
    closeToTray: false
  };
}
```

```js
closeToTray: chooseValue(
  source.closeToTray,
  secondary.closeToTray,
  value => typeof value === 'boolean',
  defaults.closeToTray
)
```

```js
if (field === 'closeToTray') return typeof value === 'boolean';
```

In `electron/ui-preferences.js`, add the explicit error message beside the `realtime` validation:

```js
if (
  Object.hasOwn(patch, 'closeToTray')
  && !UiPreferenceSchema.isValidUiPreferenceValue(
    'closeToTray',
    patch.closeToTray,
    CommonLinks,
    { today }
  )
) {
  throw new TypeError('closeToTray must be a boolean');
}
```

- [ ] **Step 4: Run the focused tests and verify green**

Run:

```powershell
node --test test/ui-preferences.test.js test/ui-preference-schema.test.js
```

Expected: PASS with zero failures.

- [ ] **Step 5: Commit the preference contract**

```powershell
git add renderer/ui-preference-schema.js electron/ui-preferences.js test/ui-preferences.test.js test/ui-preference-schema.test.js
git commit -m "feat: persist background mode preference"
```

### Task 2: Build the isolated Electron background-mode controller

**Files:**
- Create: `electron/background-mode.js`
- Create: `test/background-mode.test.js`
- Modify: `electron/server-process.js`
- Modify: `test/server-process.test.js`

- [ ] **Step 1: Add failing tests for window visibility, tray lifecycle and login startup**

Create `test/background-mode.test.js` with fake Electron dependencies. The fake tray must record menu, tooltip, listener and destroy operations; the fake app must record `setLoginItemSettings()` calls and expose a mutable `getLoginItemSettings()` result.

The public contract under test is:

```js
const {
  createBackgroundModeController,
  DEFAULT_DESKTOP_SETTINGS
} = require('../electron/background-mode');
```

Cover these assertions:

```js
test('defaults stay visible and do not create a tray', async () => {
  const fixture = createFixture({ closeToTray: false });
  const controller = createBackgroundModeController(fixture.dependencies);

  assert.deepEqual(await controller.initialize(), {
    ...DEFAULT_DESKTOP_SETTINGS,
    launchAtLoginSupported: true
  });
  assert.equal(fixture.trays.length, 0);
  assert.equal(controller.shouldStartHidden(['electron', '.', '--hidden']), false);
});
```

```js
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
  assert.equal(fixture.trays.length, 1);
});
```

```js
test('desktop update validates fields and confirms login state by readback', async () => {
  const fixture = createFixture({ closeToTray: false, launchAtLogin: false });
  const controller = createBackgroundModeController(fixture.dependencies);
  await controller.initialize();

  await assert.rejects(
    controller.updateSettings({ closeToTray: 'yes' }),
    /closeToTray must be a boolean/
  );
  await assert.rejects(
    controller.updateSettings({ unknown: true }),
    /Unknown desktop setting/
  );
  const snapshot = await controller.updateSettings({ launchAtLogin: true });
  assert.equal(snapshot.launchAtLogin, true);
  assert.deepEqual(fixture.loginWrites.at(-1), {
    openAtLogin: true,
    path: fixture.execPath,
    args: []
  });
});
```

Also cover:

- disabling background mode destroys the tray;
- tray click, double-click and menu “打开摘星阁” call the shared show helper;
- menu “退出摘星阁” calls the injected quit request;
- `isQuitting()` bypasses hiding;
- a minimized hidden window restores, shows and focuses;
- `--hidden` is honored only when background mode is confirmed and the tray exists;
- packaged non-Windows and unpackaged Windows report `launchAtLoginSupported: false`;
- an enabled login item receives `args: ['--hidden']` when background mode is enabled and `args: []` when disabled;
- tray construction failure leaves `closeToTray: false` at runtime and returns a fixed warning;
- preference write failure restores the previous runtime mode;
- login write/readback mismatch rejects and returns the actual OS value on the next query;
- `dispose()` is idempotent.

Add a narrow regression in `test/server-process.test.js` for a new exported `showExistingWindow()` name while retaining `focusExistingWindow` as a compatibility alias.

- [ ] **Step 2: Run the new tests and verify module-not-found failure**

Run:

```powershell
node --test test/background-mode.test.js test/server-process.test.js
```

Expected: FAIL because `electron/background-mode.js` and `showExistingWindow` do not exist.

- [ ] **Step 3: Implement a small shared show helper**

In `electron/server-process.js`, rename the implementation to:

```js
function showExistingWindow(window) {
  if (!window || window.isDestroyed()) return false;
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.focus();
  return true;
}

const focusExistingWindow = showExistingWindow;
```

Export both names so current callers and tests remain valid.

- [ ] **Step 4: Implement `createBackgroundModeController`**

Implement `electron/background-mode.js` as a CommonJS module with these constants:

```js
const DEFAULT_DESKTOP_SETTINGS = Object.freeze({
  closeToTray: false,
  launchAtLogin: false,
  launchAtLoginSupported: false,
  warnings: Object.freeze([])
});

const ALLOWED_PATCH_FIELDS = new Set(['closeToTray', 'launchAtLogin']);
const BACKGROUND_WARNING = '系统托盘暂不可用，摘星阁将保持窗口运行。';
const LOGIN_WARNING = 'Windows 登录启动设置未能同步，请在系统启动应用中确认。';
```

Expose one factory:

```js
function createBackgroundModeController({
  app,
  Tray,
  Menu,
  Notification,
  getWindow,
  preferenceStore,
  iconPath,
  platform = process.platform,
  isPackaged = app.isPackaged,
  execPath = process.execPath,
  isQuitting = () => false,
  requestQuit = () => app.quit(),
  logError = error => console.error('[桌面运行]', error.message)
}) {
}
```

Return a frozen controller containing:

```js
{
  initialize,
  getSettings,
  updateSettings,
  handleWindowClose,
  showMainWindow,
  shouldStartHidden,
  dispose
}
```

Implementation rules:

- read `preferenceStore.getSnapshot().closeToTray` during `initialize()`;
- create at most one tray with `new Tray(iconPath)`;
- build the exact menu labels `打开摘星阁` and `退出摘星阁`;
- use `showExistingWindow(getWindow())` for tray activation;
- use a single process-local `backgroundNoticeShown` boolean;
- only intercept close when `closeToTray && tray && !isQuitting()`;
- query login state on every `getSettings()` call;
- support login modification only for `platform === 'win32' && isPackaged`;
- call `app.setLoginItemSettings({ openAtLogin, path: execPath, args })`, then verify with `getLoginItemSettings()`;
- if login is already enabled when `closeToTray` changes, rewrite the item with the matching args;
- preserve the confirmed background runtime state if a preference write rejects;
- keep warning strings fixed and never return raw system exception text;
- destroy the tray before marking the controller disposed.

- [ ] **Step 5: Run controller tests and the existing lifecycle suite**

Run:

```powershell
node --test test/background-mode.test.js test/server-process.test.js test/ui-preferences.test.js
```

Expected: PASS with zero failures.

- [ ] **Step 6: Commit the background controller**

```powershell
git add electron/background-mode.js electron/server-process.js test/background-mode.test.js test/server-process.test.js
git commit -m "feat: add desktop background controller"
```

### Task 3: Add the desktop-settings IPC and preload bridge

**Files:**
- Create: `electron/desktop-settings-ipc.js`
- Create: `test/desktop-settings-ipc.test.js`
- Modify: `electron/preload.js`
- Modify: `test/preload.test.js`

- [ ] **Step 1: Add failing IPC tests**

Create `test/desktop-settings-ipc.test.js` using the same listener/handler capture pattern as `test/ui-preferences-ipc.test.js`.

Test this registration:

```js
const { registerDesktopSettingsIpc } = require('../electron/desktop-settings-ipc');

test('desktop settings IPC returns safe defaults before initialization', async () => {
  const fake = captureIpcCallbacks();
  registerDesktopSettingsIpc({ ipcMain: fake.ipcMain, getController: () => null });

  assert.deepEqual([...fake.handlers.keys()], [
    'desktop-settings:get',
    'desktop-settings:update'
  ]);
  assert.deepEqual(
    await fake.handlers.get('desktop-settings:get')(),
    {
      closeToTray: false,
      launchAtLogin: false,
      launchAtLoginSupported: false,
      warnings: []
    }
  );
  await assert.rejects(
    fake.handlers.get('desktop-settings:update')({}, { closeToTray: true }),
    /Desktop settings are not ready/
  );
});
```

Add a second test proving exact patch identity is forwarded to `controller.updateSettings(patch)` and its confirmed snapshot is returned.

- [ ] **Step 2: Extend the preload test before implementation**

Update `test/preload.test.js` so the fake `ipcRenderer.invoke` returns a mutable desktop snapshot for `desktop-settings:get` and `desktop-settings:update`. Assert:

```js
const desktopSettings = await api.getDesktopSettings();
assert.equal(Object.isFrozen(desktopSettings), true);
assert.equal(Object.isFrozen(desktopSettings.warnings), true);
assert.deepEqual(JSON.parse(JSON.stringify(desktopSettings)), {
  closeToTray: false,
  launchAtLogin: false,
  launchAtLoginSupported: true,
  warnings: []
});

const updated = await api.updateDesktopSettings({ closeToTray: true });
assert.equal(Object.isFrozen(updated), true);
assert.deepEqual(ipcCalls.at(-1), [
  'invoke',
  'desktop-settings:update',
  { closeToTray: true }
]);
```

- [ ] **Step 3: Run focused tests and verify the failures**

Run:

```powershell
node --test test/desktop-settings-ipc.test.js test/preload.test.js
```

Expected: FAIL because the IPC module and preload methods are missing.

- [ ] **Step 4: Implement the IPC module**

Create `electron/desktop-settings-ipc.js`:

```js
'use strict';

const DEFAULT_SNAPSHOT = Object.freeze({
  closeToTray: false,
  launchAtLogin: false,
  launchAtLoginSupported: false,
  warnings: Object.freeze([])
});

function getDefaultDesktopSettings() {
  return { ...DEFAULT_SNAPSHOT, warnings: [] };
}

function registerDesktopSettingsIpc({ ipcMain, getController }) {
  ipcMain.handle('desktop-settings:get', async () => {
    const controller = getController();
    return controller ? controller.getSettings() : getDefaultDesktopSettings();
  });
  ipcMain.handle('desktop-settings:update', async (_event, patch) => {
    const controller = getController();
    if (!controller) throw new Error('Desktop settings are not ready');
    return controller.updateSettings(patch);
  });
}

module.exports = {
  DEFAULT_SNAPSHOT,
  getDefaultDesktopSettings,
  registerDesktopSettingsIpc
};
```

- [ ] **Step 5: Expose only the two approved preload methods**

Add to `desktopApi` in `electron/preload.js`:

```js
getDesktopSettings: () => ipcRenderer
  .invoke('desktop-settings:get')
  .then(cloneAndFreeze),
updateDesktopSettings: patch => ipcRenderer
  .invoke('desktop-settings:update', patch)
  .then(cloneAndFreeze),
```

Do not add generic send/invoke methods or expose Electron classes.

- [ ] **Step 6: Run focused tests and verify green**

Run:

```powershell
node --test test/desktop-settings-ipc.test.js test/preload.test.js
```

Expected: PASS with zero failures.

- [ ] **Step 7: Commit the IPC boundary**

```powershell
git add electron/desktop-settings-ipc.js electron/preload.js test/desktop-settings-ipc.test.js test/preload.test.js
git commit -m "feat: expose safe desktop settings IPC"
```

### Task 4: Integrate background mode into the Electron main lifecycle

**Files:**
- Modify: `electron/main.js`
- Modify: `test/main-security.test.js`
- Modify: `test/e2e/electron.test.js`
- Modify: `package.json`
- Modify: `scripts/verify-package.js`
- Modify: `test/package-verifier.test.js`

- [ ] **Step 1: Add failing main-process assembly assertions**

Extend `test/main-security.test.js` with:

```js
test('main process assembles background mode after preferences and before the window', () => {
  assert.match(source, /Tray/);
  assert.match(source, /Menu/);
  assert.match(source, /Notification/);
  assert.match(source, /registerDesktopSettingsIpc/);
  assert.match(source, /createBackgroundModeController/);
  assert.match(source, /backgroundMode\\.initialize\\(\\)/);
  assert.match(source, /backgroundMode\\.handleWindowClose\\(event\\)/);
  assert.match(source, /backgroundMode\\.shouldStartHidden\\(process\\.argv\\)/);
  assert.match(source, /backgroundMode\\.dispose\\(\\)/);

  const loadPreferences = source.indexOf('uiPreferencesStore = await loadUiPreferencesStore');
  const initializeBackground = source.indexOf('await backgroundMode.initialize()', loadPreferences);
  const createWindow = source.indexOf('await createWindow(serverPort)', initializeBackground);
  assert.ok(loadPreferences >= 0);
  assert.ok(initializeBackground > loadPreferences);
  assert.ok(createWindow > initializeBackground);
});
```

Change the existing second-instance assertion to require the controller-first fallback:

```js
assert.match(
  source,
  /backgroundMode\\?\\.showMainWindow\\(\\)\\s*\\|\\|\\s*focusExistingWindow\\(win\\)/
);
```

Extend `test/package-verifier.test.js` so the exact resource allowlist includes the tray icon:

```js
assert.deepEqual(packageJson.build.extraResources, [
  { from: 'LICENSE', to: 'LICENSE.txt' },
  { from: 'THIRD_PARTY_NOTICES.txt', to: 'THIRD_PARTY_NOTICES.txt' },
  { from: 'build/icon.ico', to: 'tray-icon.ico' }
]);
assert.doesNotThrow(() => assertAllowedResourceEntries([
  'app.asar',
  'app-update.yml',
  'elevate.exe',
  'LICENSE.txt',
  'THIRD_PARTY_NOTICES.txt',
  'tray-icon.ico'
]));
```

- [ ] **Step 2: Add the real hide, wake and hidden-start E2E assertions before implementation**

Add `'closeToTray'` to `EXPECTED_UI_PREFERENCE_KEYS` in `test/e2e/electron.test.js`, and add `closeToTray: false` to the first persisted preference expectation.

Before the existing single-instance probe, enable background mode through the approved preload bridge and close the real window:

```js
const backgroundSnapshot = await firstPage.evaluate(() => (
  window.starPickingPavilion.updateDesktopSettings({ closeToTray: true })
));
assert.equal(backgroundSnapshot.closeToTray, true);
await waitForJson(
  path.join(dataDir, 'ui-preferences.json'),
  preferences => preferences.closeToTray === true
);

await firstApp.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows()[0].close();
});
await firstPage.waitForTimeout(100);
assert.equal(
  await firstApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
  false
);
assert.equal(firstProcess.exitCode, null);
```

After the existing single-instance probe exits, require the existing hidden window to be visible:

```js
await firstPage.waitForFunction(() => document.visibilityState === 'visible');
assert.equal(
  await firstApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
  true
);
```

Launch the second Electron run with the persisted background preference and the hidden argument:

```js
secondApp = await electron.launch({
  args: ['.', '--hidden'],
  cwd: projectRoot,
  env
});
```

After `firstWindow()` resolves, assert the BrowserWindow exists but is hidden:

```js
assert.equal(
  await secondApp.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()
  ),
  false
);
```

Spawn another single-instance probe to reveal the second run before continuing the existing restored-preference UI assertions. Add `closeToTray: true` to the restored preference expectation.

- [ ] **Step 3: Run main and E2E tests to verify the lifecycle assertions fail**

Run:

```powershell
node --test test/main-security.test.js
npm run test:e2e
```

Expected: the main-process test FAILS because background mode is not assembled, and E2E FAILS because the desktop controller is not initialized or window close still exits.

- [ ] **Step 4: Import and register desktop components**

Change the Electron import to:

```js
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  shell,
  utilityProcess,
  ipcMain,
  dialog,
  session,
  safeStorage
} = require('electron');
```

Import:

```js
const { createBackgroundModeController } = require('./background-mode');
const { registerDesktopSettingsIpc } = require('./desktop-settings-ipc');
```

Add `let backgroundMode = null;` beside `uiPreferencesStore`.

Register:

```js
registerDesktopSettingsIpc({
  ipcMain,
  getController: () => backgroundMode
});
```

- [ ] **Step 5: Assemble the controller and make startup safely visible**

After loading `uiPreferencesStore`, construct and initialize:

```js
backgroundMode = createBackgroundModeController({
  app,
  Tray,
  Menu,
  Notification,
  getWindow: () => win,
  preferenceStore: uiPreferencesStore,
  iconPath: app.isPackaged
    ? path.join(process.resourcesPath, 'tray-icon.ico')
    : path.join(__dirname, '..', 'build', 'icon.ico'),
  isQuitting: () => quitAfterShutdown,
  requestQuit: () => app.quit()
});
await backgroundMode.initialize();
```

Add the resource to `package.json`:

```json
{
  "from": "build/icon.ico",
  "to": "tray-icon.ico"
}
```

and add `'tray-icon.ico'` to `ALLOWED_RESOURCE_ENTRIES` in `scripts/verify-package.js`.

In `createWindow`, compute:

```js
const startHidden = backgroundMode?.shouldStartHidden(process.argv) === true;
```

and set `show: !startHidden` in `BrowserWindow` options. Attach:

```js
win.on('close', event => {
  backgroundMode?.handleWindowClose(event);
});
```

Use:

```js
else app.on('second-instance', () => {
  backgroundMode?.showMainWindow() || focusExistingWindow(win);
});
```

During `will-quit`, call `backgroundMode?.dispose()` before clearing the update timer.

- [ ] **Step 6: Preserve the current shutdown contract**

Keep `window-all-closed -> app.quit()` and the existing `before-quit` cooperative shutdown. Do not directly kill the utility process from the background controller. Confirm that tray “退出摘星阁” calls `app.quit()` and reaches the same `shutdownDesktop()` path.

- [ ] **Step 7: Run main, controller and E2E regressions**

Run:

```powershell
node --test test/main-security.test.js test/background-mode.test.js test/server-process.test.js test/package-verifier.test.js
npm run test:e2e
npm run test:e2e
```

Expected: both E2E runs PASS with fresh random ports and disposable data directories, and the real Electron process still closes within the existing graceful timeout.

- [ ] **Step 8: Commit main-process integration**

```powershell
git add electron/main.js package.json scripts/verify-package.js test/main-security.test.js test/e2e/electron.test.js test/package-verifier.test.js
git commit -m "feat: integrate tray background lifecycle"
```

### Task 5: Build the renderer desktop-settings controller

**Files:**
- Create: `renderer/desktop-settings-controller.js`
- Create: `test/desktop-settings-controller.test.js`

- [ ] **Step 1: Write failing controller tests**

Create a browser/CommonJS-compatible controller test with fake checkboxes and status elements. Require:

```js
const {
  createDesktopSettingsController
} = require('../renderer/desktop-settings-controller');
```

Cover:

```js
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
  assert.equal(fixture.launchAtLogin.disabled, false);
  assert.equal(fixture.status.textContent, '');
});
```

```js
test('changes serialize and render only confirmed snapshots', async () => {
  const first = deferred();
  const calls = [];
  const fixture = createFixture(undefined, {
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
  assert.deepEqual(calls, [{ closeToTray: true }]);
  first.resolve({
    closeToTray: true,
    launchAtLogin: false,
    launchAtLoginSupported: true,
    warnings: []
  });
  await one;
  await two;
  assert.deepEqual(calls, [
    { closeToTray: true },
    { launchAtLogin: true }
  ]);
});
```

Also prove:

- unpackaged mode disables only the login switch;
- controls stay disabled while an update is pending;
- warnings render with the warning style;
- a rejection reloads the last confirmed snapshot and renders a fixed error;
- non-boolean updates are rejected locally;
- the exported API is frozen and does not create globals under CommonJS.

- [ ] **Step 2: Run the test and verify module-not-found failure**

Run:

```powershell
node --test test/desktop-settings-controller.test.js
```

Expected: FAIL because the renderer controller does not exist.

- [ ] **Step 3: Implement the controller**

Create `renderer/desktop-settings-controller.js` with the existing UMD pattern. Its factory accepts:

```js
function createDesktopSettingsController({
  elements,
  getSettings,
  updateSettings
}) {
}
```

Validate the three elements:

```js
{
  closeToTray,
  launchAtLogin,
  status
}
```

Return a frozen API:

```js
{
  load,
  update
}
```

Use one promise queue:

```js
let queue = Promise.resolve();

function enqueue(operation) {
  const next = queue.catch(() => {}).then(operation);
  queue = next;
  return next;
}
```

Render from the returned snapshot only. Set `aria-busy` on the status region while pending. On error, call `getSettings()` once to restore actual state, then show `桌面运行设置保存失败，请重试。`. Join returned warnings with `；`.

- [ ] **Step 4: Run the focused controller tests**

Run:

```powershell
node --test test/desktop-settings-controller.test.js
```

Expected: PASS with zero failures.

- [ ] **Step 5: Commit the renderer controller**

```powershell
git add renderer/desktop-settings-controller.js test/desktop-settings-controller.test.js
git commit -m "feat: add desktop settings controller"
```

### Task 6: Add the desktop-run settings card and wire it into the app

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/styles.css`
- Modify: `renderer/app.js`
- Modify: `test/renderer-integration.test.js`

- [ ] **Step 1: Add failing static integration assertions**

Extend `test/renderer-integration.test.js`:

```js
test('设置页提供可访问的桌面运行开关', () => {
  assert.match(html, /<script src="desktop-settings-controller\\.js"><\\/script>/);
  assert.match(html, /id="setCloseToTray"[^>]*type="checkbox"[^>]*role="switch"/);
  assert.match(html, /id="setLaunchAtLogin"[^>]*type="checkbox"[^>]*role="switch"/);
  assert.match(html, /id="desktopSettingsResult"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(app, /DesktopSettingsController\\.createDesktopSettingsController/);
  assert.match(app, /Desktop\\.getDesktopSettings/);
  assert.match(app, /Desktop\\.updateDesktopSettings/);
  assert.ok(css.includes('.desktop-switch'));
  assert.ok(css.includes('.switch-track'));
});
```

- [ ] **Step 2: Run the static test and verify failure**

Run:

```powershell
node --test test/renderer-integration.test.js
```

Expected: FAIL because the card, script reference and styles are missing.

- [ ] **Step 3: Add the settings card**

Add a fourth `.glass.card-pad` item after data maintenance:

```html
<div class="glass card-pad">
  <h3>桌面运行 <span class="muted">Windows</span></h3>
  <label class="desktop-switch">
    <span class="switch-copy">
      <strong>关闭主窗口后在后台运行</strong>
      <small>关闭窗口时继续采集，可从系统托盘重新打开或彻底退出。</small>
    </span>
    <input id="setCloseToTray" type="checkbox" role="switch">
    <span class="switch-track" aria-hidden="true"></span>
  </label>
  <label class="desktop-switch">
    <span class="switch-copy">
      <strong>登录 Windows 时自动启动</strong>
      <small>若同时开启后台运行，登录后不会弹出主窗口。</small>
    </span>
    <input id="setLaunchAtLogin" type="checkbox" role="switch">
    <span class="switch-track" aria-hidden="true"></span>
  </label>
  <p id="desktopSettingsResult"
     class="test-result desktop-settings-result"
     role="status"
     aria-live="polite"></p>
  <p class="hint">两项默认关闭且相互独立。托盘菜单始终提供“退出摘星阁”。</p>
</div>
```

Add:

```html
<script src="desktop-settings-controller.js"></script>
```

immediately after `settings-form-controller.js`.

- [ ] **Step 4: Add theme-compatible switch styles**

Add styles that use existing variables:

```css
.desktop-switch {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
  padding: 15px 0;
  border-bottom: 1px solid var(--rail-line);
  cursor: pointer;
}
.desktop-switch:last-of-type { border-bottom: 0; }
.switch-copy { display: flex; flex-direction: column; gap: 5px; }
.switch-copy strong { font-size: 14px; color: var(--c-fg); }
.switch-copy small { color: var(--c-fg-faint); line-height: 1.6; }
.desktop-switch input {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  opacity: 0;
}
.switch-track {
  position: relative;
  width: 44px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid var(--glass-border);
  background: var(--input-bg);
  transition: all var(--dur) var(--ease);
}
.switch-track::after {
  content: '';
  position: absolute;
  width: 18px;
  height: 18px;
  left: 2px;
  top: 2px;
  border-radius: 50%;
  background: var(--c-fg-faint);
  transition: all var(--dur) var(--ease-spring);
}
.desktop-switch input:checked + .switch-track {
  border-color: var(--c-teal);
  background: color-mix(in srgb, var(--c-teal) 24%, var(--input-bg));
}
.desktop-switch input:checked + .switch-track::after {
  transform: translateX(20px);
  background: var(--c-teal);
}
.desktop-switch input:focus-visible + .switch-track {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--c-teal) 24%, transparent);
}
.desktop-switch input:disabled + .switch-track {
  opacity: .45;
  cursor: not-allowed;
}
.desktop-settings-result { min-height: 20px; margin-top: 14px; }
```

- [ ] **Step 5: Wire the controller into `renderer/app.js`**

At the top:

```js
const DesktopSettingsController = window.DesktopSettingsController;
```

After the existing settings form controller:

```js
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

$('#setCloseToTray').addEventListener('change', event => {
  desktopSettings?.update('closeToTray', event.currentTarget.checked);
});
$('#setLaunchAtLogin').addEventListener('change', event => {
  desktopSettings?.update('launchAtLogin', event.currentTarget.checked);
});
```

Update `loadSettings()`:

```js
async function loadSettings() {
  try {
    await Promise.all([
      settingsForm.load(),
      desktopSettings?.load()
    ]);
  } catch {}
  loadMaintenance();
}
```

When the desktop API is absent, disable both controls and show `桌面运行设置仅在安装版中可用。`.

- [ ] **Step 6: Run renderer and preload regressions**

Run:

```powershell
node --test test/desktop-settings-controller.test.js test/renderer-integration.test.js test/preload.test.js
```

Expected: PASS with zero failures.

- [ ] **Step 7: Perform a development visual smoke check**

Launch with a disposable data directory through Playwright Electron, open the settings view and capture the viewport. Verify:

- the new card occupies the previously empty lower-right grid area;
- both switch labels are fully visible at 1440×920;
- keyboard focus is visible;
- the unsupported login-start switch is disabled in development;
- no horizontal overflow appears in dark or light theme.

Do not add the screenshot to Git.

- [ ] **Step 8: Commit the settings UI**

```powershell
git add renderer/index.html renderer/styles.css renderer/app.js test/renderer-integration.test.js
git commit -m "feat: add desktop runtime settings UI"
```

### Task 7: Update v0.0.4 identity and release documentation

**Files:**
- Modify: `test/branding.test.js`
- Modify: `test/package-verifier.test.js`
- Modify: `test/release-readiness.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `RELEASE_NOTES.md`
- Modify: `RELEASING.md`
- Modify: `THIRD_PARTY_NOTICES.txt`

- [ ] **Step 1: Change version assertions first**

Update release tests from `0.0.3` to `0.0.4`, including:

```js
assert.equal(pkg.version, '0.0.4');
assert.equal(
  expectedInstallerName(packageJson.version),
  'Star-Picking-Pavilion-Setup-0.0.4.exe'
);
```

Update temporary `latest.yml`, installer fixture names, expected tag and notice rendering fixtures in `test/release-readiness.test.js`.

- [ ] **Step 2: Run release tests and verify red**

Run:

```powershell
node --test test/branding.test.js test/package-verifier.test.js test/release-readiness.test.js
```

Expected: FAIL because package metadata and documents still identify v0.0.3.

- [ ] **Step 3: Bump package and lockfile**

Run:

```powershell
npm version 0.0.4 --no-git-tag-version
```

Confirm `package.json`, top-level `package-lock.json.version`, and `package-lock.json.packages[""].version` all equal `0.0.4`.

- [ ] **Step 4: Update user and release documentation**

Write the v0.0.4 changelog and release notes around one coherent theme:

- both desktop switches default off;
- close-to-tray behavior and exact exit path;
- independent Windows login startup;
- hidden login start only when background mode is also enabled;
- safe visible fallback if tray startup fails;
- no change to credential, network, AI, retention or source policies;
- unsigned installer and SmartScreen warning retained.

Update all commands and installer names in README/RELEASING to v0.0.4.

- [ ] **Step 5: Regenerate third-party notices**

Run:

```powershell
npm run notices
```

Expected: the header becomes `摘星阁 (Star-Picking-Pavilion) 0.0.4`; dependency entries remain deterministic.

- [ ] **Step 6: Run release-focused tests and version verification**

Run:

```powershell
node --test test/branding.test.js test/package-verifier.test.js test/release-readiness.test.js
npm run verify:version -- --tag v0.0.4
```

Expected: PASS with package/tag identity `0.0.4` and no artifact requirement yet.

- [ ] **Step 7: Commit the version and documentation**

```powershell
git add package.json package-lock.json README.md CHANGELOG.md RELEASE_NOTES.md RELEASING.md THIRD_PARTY_NOTICES.txt test/branding.test.js test/package-verifier.test.js test/release-readiness.test.js
git commit -m "chore: prepare v0.0.4 release"
```

### Task 8: Full verification, review, build and publish

**Files:**
- Inspect all changes since design commit `06859da`
- Modify only files required by verified review findings

- [ ] **Step 1: Inspect scope before verification**

Run:

```powershell
git status --short --branch
git diff --stat 06859da..HEAD
git diff --check 06859da..HEAD
git log --oneline 06859da..HEAD
```

Expected: only v0.0.4 implementation, tests and release documentation are present; `git diff --check` emits nothing.

- [ ] **Step 2: Run the complete test and security gates**

Run:

```powershell
npm test
npm run test:e2e
npm run audit:runtime
npm run notices
git diff --exit-code -- THIRD_PARTY_NOTICES.txt
npm run verify:version -- --tag v0.0.4
```

Expected:

- all unit tests pass;
- the real Electron test passes;
- production audit reports zero high-or-higher vulnerabilities;
- notices regeneration is deterministic;
- version/tag metadata matches v0.0.4.

- [ ] **Step 3: Review the implementation against the approved specification**

Review `git diff 06859da..HEAD` and check every acceptance criterion in `docs/superpowers/specs/2026-07-24-star-picking-pavilion-v0.0.4-design.md`.

Reject release if any of these are true:

- either switch defaults on;
- `launchAtLogin` is persisted in JSON instead of read from Windows;
- a tray failure permits a hidden inaccessible process;
- renderer gains arbitrary IPC access;
- tray exit bypasses cooperative server shutdown;
- raw system exceptions are injected into HTML;
- existing security or persistence tests regress.

Apply fixes through a new failing regression test, run it red, implement the correction and run it green.

- [ ] **Step 4: Build the Windows installer**

Run:

```powershell
npm run dist
```

Expected: `dist/Star-Picking-Pavilion-Setup-0.0.4.exe`, blockmap and `latest.yml` are generated successfully.

- [ ] **Step 5: Audit the generated package and versioned artifacts**

Run:

```powershell
npm run verify:package
npm run verify:version -- --tag v0.0.4 --artifacts
Get-AuthenticodeSignature .\dist\Star-Picking-Pavilion-Setup-0.0.4.exe
```

Expected:

- package verifier passes the allowlist, secret scan, license and size gates;
- installer and `latest.yml` both report `0.0.4`;
- signature status is `NotSigned`, matching the documented release limitation.

- [ ] **Step 6: Perform an installed-artifact smoke test**

Run the unpacked app or installer-built executable with a disposable data directory. Verify:

- first launch is visible and both settings are off;
- enabling background mode creates a tray and close hides the window;
- tray open restores it;
- tray exit ends the backend;
- relaunch restores the selected background preference;
- disabling background mode restores close-to-exit.

Do not use or overwrite the user’s production `%APPDATA%\摘星阁` directory.

- [ ] **Step 7: Commit any verification corrections**

If review or package verification required corrections:

```powershell
git add electron/background-mode.js electron/desktop-settings-ipc.js electron/main.js electron/preload.js electron/server-process.js renderer/app.js renderer/desktop-settings-controller.js renderer/index.html renderer/styles.css renderer/ui-preference-schema.js electron/ui-preferences.js test/background-mode.test.js test/desktop-settings-controller.test.js test/desktop-settings-ipc.test.js test/e2e/electron.test.js test/main-security.test.js test/preload.test.js test/renderer-integration.test.js test/server-process.test.js test/ui-preference-schema.test.js test/ui-preferences.test.js package.json package-lock.json README.md CHANGELOG.md RELEASE_NOTES.md RELEASING.md THIRD_PARTY_NOTICES.txt test/branding.test.js test/package-verifier.test.js test/release-readiness.test.js
git commit -m "fix: satisfy v0.0.4 release gates"
```

If no correction was needed, do not create an empty commit.

- [ ] **Step 8: Confirm GitHub authentication and exact remote**

Run:

```powershell
gh auth status
git remote get-url origin
git status --short --branch
```

Expected:

- active GitHub account is authorized for `Icdafy/Star-Picking-Pavilion`;
- `origin` is `https://github.com/Icdafy/Star-Picking-Pavilion.git`;
- worktree is clean and `main` is only ahead by reviewed v0.0.4 commits.

- [ ] **Step 9: Push main and the annotated release tag**

Run:

```powershell
git push origin main
git tag -a v0.0.4 -m "摘星阁 v0.0.4"
git push origin v0.0.4
```

Expected: both pushes succeed without force. Do not move or overwrite an existing public tag.

- [ ] **Step 10: Wait for the release workflow and verify public assets**

Run:

```powershell
$releaseRunId = gh run list --repo Icdafy/Star-Picking-Pavilion --workflow release.yml --limit 10 --json databaseId,headBranch --jq 'map(select(.headBranch == "v0.0.4"))[0].databaseId'
if (-not $releaseRunId) { throw '未找到 v0.0.4 发布工作流' }
gh run watch --repo Icdafy/Star-Picking-Pavilion $releaseRunId --exit-status
gh release view v0.0.4 --repo Icdafy/Star-Picking-Pavilion --json tagName,name,isDraft,isPrerelease,publishedAt,url,assets
```

Expected Release assets:

- `Star-Picking-Pavilion-Setup-0.0.4.exe`
- `Star-Picking-Pavilion-Setup-0.0.4.exe.blockmap`
- `latest.yml`
- `SHA256SUMS.txt`
- `sbom.cdx.json`
- `THIRD_PARTY_NOTICES.txt`

Confirm the Release is public, not a draft or prerelease, and every asset reports `state: uploaded`.
