'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { refreshApplicationShortcuts } = require('../electron/desktop-branding');

const executablePath = 'C:\\Users\\Example\\Apps\\摘星阁\\Star-Picking-Pavilion.exe';
const iconPath = 'C:\\Users\\Example\\Apps\\摘星阁\\resources\\application-icon-0.2.42.ico';
const appId = 'com.icdafy.star-picking-pavilion';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-shortcuts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const desktop = path.join(root, 'Desktop');
  const appData = path.join(root, 'AppData');
  const programs = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const applicationFolder = path.join(programs, '摘星阁');
  const taskbar = path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar');
  for (const directory of [desktop, programs, applicationFolder, taskbar]) fs.mkdirSync(directory, { recursive: true });
  const shortcuts = new Map();
  const reads = [];
  const writes = [];
  const app = { getPath: name => ({ desktop, appData })[name] };
  const shell = {
    readShortcutLink(file) {
      reads.push(file);
      const shortcut = shortcuts.get(file);
      if (shortcut instanceof Error) throw shortcut;
      return { ...shortcut };
    },
    writeShortcutLink(file, operation, options) {
      writes.push({ file, operation, options });
      shortcuts.set(file, { ...shortcuts.get(file), ...options });
      return true;
    }
  };
  function add(directory, name, shortcut) {
    const file = path.join(directory, name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(file, 'mock Windows shortcut');
    shortcuts.set(file, shortcut);
    return file;
  }
  const run = () => refreshApplicationShortcuts({ shell, app, executablePath, iconPath, appId });
  return { root, desktop, appData, programs, applicationFolder, taskbar, shortcuts, reads, writes, app, shell, add, run };
}

test('updates only exact application targets and leaves shortcut arguments and names intact', t => {
  const f = fixture(t);
  const original = { target: executablePath.toUpperCase().replace('\\APPS\\', '\\Apps\\unused\\..\\'), args: '--hidden --profile "my profile"', description: '我的工作快捷方式', icon: 'C:\\old.ico', iconIndex: 2, appUserModelId: 'old.identity' };
  const own = f.add(f.desktop, '自定义名字.LNK', original);
  f.add(f.desktop, '其它应用.lnk', { target: 'C:\\Other\\Star-Picking-Pavilion.exe', icon: 'C:\\other.ico' });
  f.add(f.desktop, '相似目录.lnk', { target: executablePath.replace('摘星阁', '摘星阁副本'), icon: 'C:\\other.ico' });
  f.add(f.desktop, '旧安装位置.lnk', { target: executablePath.replace('Example', 'Previous'), icon: 'C:\\old.ico' });
  f.add(f.desktop, '不能处理.txt', { target: executablePath });

  assert.deepEqual(f.run(), { updated: [own], failed: [] });
  assert.deepEqual(f.writes, [{ file: own, operation: 'update', options: { icon: iconPath, iconIndex: 0, appUserModelId: appId } }]);
  assert.equal(f.shortcuts.get(own).target, original.target);
  assert.equal(f.shortcuts.get(own).args, original.args);
  assert.equal(f.shortcuts.get(own).description, original.description);
  assert.equal(fs.existsSync(own), true);
  assert.equal(f.reads.length, 4);
});

test('scans only the requested roots and one named Start Menu folder, then skips identical branding', t => {
  const f = fixture(t);
  const expected = [
    f.add(f.desktop, 'desktop.lnk', { target: executablePath }),
    f.add(f.programs, 'start.lnk', { target: executablePath }),
    f.add(f.applicationFolder, 'application.lnk', { target: executablePath }),
    f.add(f.taskbar, 'pinned.lnk', { target: executablePath })
  ];
  f.add(path.join(f.desktop, 'nested'), 'nested.lnk', { target: executablePath });
  f.add(path.join(f.programs, 'Other App'), 'other-folder.lnk', { target: executablePath });
  f.add(path.join(f.applicationFolder, 'nested'), 'too-deep.lnk', { target: executablePath });
  f.add(path.join(f.taskbar, 'nested'), 'nested-pinned.lnk', { target: executablePath });
  f.add(f.desktop, 'already-current.lnk', { target: executablePath, icon: iconPath.toUpperCase(), iconIndex: 0, appUserModelId: appId });
  assert.deepEqual(new Set(f.run().updated), new Set(expected));
  assert.equal(f.writes.length, 4);
  assert.deepEqual(f.run(), { updated: [], failed: [] });
  assert.equal(f.writes.length, 4);
});

test('one unreadable or unwritable shortcut does not stop the remaining updates', t => {
  const f = fixture(t);
  const unreadable = f.add(f.desktop, 'a-unreadable.lnk', new Error('Unreadable shortcut'));
  const unwritable = f.add(f.desktop, 'b-unwritable.lnk', { target: executablePath });
  const good = f.add(f.desktop, 'c-good.lnk', { target: executablePath });
  const write = f.shell.writeShortcutLink;
  f.shell.writeShortcutLink = (file, ...args) => file === unwritable ? false : write(file, ...args);
  const result = f.run();
  assert.deepEqual(result.updated, [good]);
  assert.deepEqual(result.failed.map(item => item.path), [unreadable, unwritable]);
  assert.match(result.failed[0].error, /Unreadable shortcut/);
  assert.match(result.failed[1].error, /declined/);
});

test('missing shortcut locations and failed directory scans do not abort startup', t => {
  const f = fixture(t);
  fs.rmSync(f.desktop, { recursive: true });
  fs.writeFileSync(f.desktop, 'not a directory');
  fs.rmSync(f.taskbar, { recursive: true });
  const good = f.add(f.programs, 'working.lnk', { target: executablePath });
  const result = f.run();
  assert.deepEqual(result.updated, [good]);
  assert.deepEqual(result.failed.map(item => item.path), [f.desktop]);
  assert.match(result.failed[0].error, /ENOTDIR/);
});

test('an unavailable desktop path does not prevent Start Menu and taskbar updates', t => {
  const f = fixture(t);
  const getPath = f.app.getPath;
  f.app.getPath = name => {
    if (name === 'desktop') throw new Error('Desktop unavailable');
    return getPath(name);
  };
  const good = f.add(f.taskbar, 'working.lnk', { target: executablePath });
  const result = f.run();
  assert.deepEqual(result.updated, [good]);
  assert.deepEqual(result.failed, [{ path: 'desktop', error: 'Desktop unavailable' }]);
});
