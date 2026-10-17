'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchNativeElectron } = require('./native-electron.cjs');
const { assertWindowsWindowIcons } = require('./windows-window-icons.cjs');

const root = path.resolve(__dirname, '../..');
const brand = require('../../config/brand.json');

test('v0242 native window and Shell taskbar identity use the uploaded logo',
  { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-v0242-native-logo-'));
    const app = await launchNativeElectron(root, profile, { presentWindow: false });
    t.after(async () => {
      await app.close();
      await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });
    const page = await app.firstWindow();
    await page.waitForSelector('[data-brand-logo] > svg');
    const source = fs.readFileSync(path.join(root, 'renderer', 'logo.png'));
    const launch = await app.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath() }));
    const expectedShell = {
      appId: `${brand.appId}.development`,
      displayName: brand.displayName,
      iconPath: path.join(root, 'build', 'icon.ico'),
      relaunchCommand: `"${launch.executable}" "${launch.appPath}"`
    };
    const report = await assertWindowsWindowIcons(app, source, {
      directory: path.join(root, 'work', 'v0242', 'native-window'), shell: expectedShell
    });
    assert.equal(report.comparisons.length, 3, 'Inspect all three real WM_GETICON requests');
    assert.equal(await page.locator('[data-brand-logo] > svg animateTransform').count(), 6,
      'The main page keeps the original animated header logo');

    const shortcuts = await app.evaluate(({ shell }, options) => {
      const fs = require('node:fs');
      const path = require('node:path');
      const { refreshApplicationShortcuts } = require(path.join(options.root, 'electron', 'desktop-branding'));
      const desktop = path.join(options.profile, 'Desktop');
      const appData = path.join(options.profile, 'AppData');
      const programs = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
      const directories = [desktop, programs, path.join(programs, '摘星阁'),
        path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar')];
      for (const directory of directories) fs.mkdirSync(directory, { recursive: true });
      const files = directories.map(directory => path.join(directory, '摘星阁.lnk'));
      const original = { target: process.execPath, icon: process.execPath, iconIndex: 0,
        args: '--hidden --keep-fixture-argument', cwd: options.profile,
        description: 'preserve shortcut metadata', appUserModelId: 'obsolete.fixture.app' };
      for (const file of files) {
        if (!shell.writeShortcutLink(file, 'create', original)) throw new Error('Cannot create temporary shortcut fixture');
      }
      const unrelatedFile = path.join(desktop, 'Other application.lnk');
      const unrelated = { ...original, target: path.join(options.profile, 'OtherApp.exe') };
      if (!shell.writeShortcutLink(unrelatedFile, 'create', unrelated)) throw new Error('Cannot create unrelated shortcut fixture');
      const before = shell.readShortcutLink(files[0]);
      const unrelatedBefore = shell.readShortcutLink(unrelatedFile);
      const parameters = { shell, app: { getPath: name => name === 'desktop' ? desktop : appData },
        executablePath: process.execPath, iconPath: options.iconPath, appId: options.appId };
      const first = refreshApplicationShortcuts(parameters);
      const after = files.map(file => shell.readShortcutLink(file));
      const second = refreshApplicationShortcuts(parameters);
      return { files, first, second, before, after, unrelatedBefore,
        unrelatedAfter: shell.readShortcutLink(unrelatedFile) };
    }, { root, profile, iconPath: expectedShell.iconPath, appId: expectedShell.appId });
    assert.deepEqual(shortcuts.first.failed, []);
    assert.deepEqual(shortcuts.first.updated.sort(), shortcuts.files.sort(),
      'Refresh actual Windows desktop, Start Menu and taskbar pin shortcut files');
    assert.deepEqual(shortcuts.second, { updated: [], failed: [] }, 'Shortcut migration must be idempotent');
    assert.deepEqual(shortcuts.unrelatedAfter, shortcuts.unrelatedBefore, 'Other application shortcuts must remain untouched');
    for (const shortcut of shortcuts.after) {
      assert.equal(shortcut.icon.toLowerCase(), expectedShell.iconPath.toLowerCase());
      assert.equal(shortcut.iconIndex, 0);
      assert.equal(shortcut.appUserModelId, expectedShell.appId);
      for (const key of ['target', 'args', 'cwd', 'description']) {
        assert.equal(shortcut[key], shortcuts.before[key], `Shortcut ${key} must survive the icon upgrade`);
      }
    }

    // A window can have the right HICON and still fall back to an Electron
    // shortcut for taskbar pinning. This negative control recreates that exact
    // missing-Shell-properties condition without changing the real app window.
    const control = await app.evaluate(({ BrowserWindow, nativeImage }, iconPath) => {
      const window = new BrowserWindow({ show: false, icon: nativeImage.createFromPath(iconPath),
        webPreferences: { sandbox: true } });
      return window.id;
    }, path.join(root, 'build', 'icon.png'));
    try {
      await assert.rejects(assertWindowsWindowIcons(app, source, { windowId: control, shell: expectedShell }),
        /window must have the product AppUserModelID/);
      // Wrong artwork must also fail the pixel comparison even if Electron
      // returns valid icon handles for every WM_GETICON size.
      await app.evaluate(({ BrowserWindow, nativeImage }, id) => {
        BrowserWindow.fromId(id).setIcon(nativeImage.createFromBitmap(Buffer.alloc(32 * 32 * 4, 255),
          { width: 32, height: 32 }));
      }, control);
      await assert.rejects(assertWindowsWindowIcons(app, source, { windowId: control }), /differs from the uploaded logo/);
    } finally {
      await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), control);
    }
    const defaultWindow = await app.evaluate(({ BrowserWindow }) => new BrowserWindow({ show: false,
      webPreferences: { sandbox: true } }).id);
    try {
      await assert.rejects(assertWindowsWindowIcons(app, source, { windowId: defaultWindow }),
        /must return the application icon/, 'The Electron default window class icon must be rejected');
    } finally {
      await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), defaultWindow);
    }
    console.log('Native logo verification:', JSON.stringify(report));
  });
