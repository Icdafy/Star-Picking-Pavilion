'use strict';

const fs = require('node:fs');
const path = require('node:path');

function windowsPath(value) {
  return typeof value === 'string' && value.trim()
    ? path.win32.resolve(value).toLowerCase()
    : null;
}

/**
 * Refresh only shortcuts that point to this exact executable. The caller limits
 * this to packaged Windows startup; tests use temporary directories and a shell mock.
 * @returns {{updated: string[], failed: {path: string, error: string}[]}}
 */
function refreshApplicationShortcuts({ shell, app, executablePath, iconPath, appId }) {
  const updated = [];
  const failed = [];
  const reportFailure = (file, error) => failed.push({ path: file, error: String(error?.message || error) });
  const targetPath = windowsPath(executablePath);
  const desiredIcon = windowsPath(iconPath);
  if (!targetPath || !desiredIcon || typeof appId !== 'string' || !appId) {
    reportFailure(executablePath || '', new Error('Application shortcut identity is incomplete'));
    return { updated, failed };
  }

  const directories = [];
  try { directories.push(app.getPath('desktop')); } catch (error) { reportFailure('desktop', error); }
  try {
    const appData = app.getPath('appData');
    const programs = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    directories.push(programs, path.join(programs, '摘星阁'));
    directories.push(path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'));
  } catch (error) { reportFailure('appData', error); }

  for (const directory of new Set(directories)) {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code !== 'ENOENT') reportFailure(directory, error);
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !/\.lnk$/i.test(entry.name)) continue;
      const file = path.join(directory, entry.name);
      try {
        const shortcut = shell.readShortcutLink(file);
        if (windowsPath(shortcut.target) !== targetPath) continue;
        if (windowsPath(shortcut.icon) === desiredIcon
          && shortcut.iconIndex === 0
          && shortcut.appUserModelId === appId) continue;
        const success = shell.writeShortcutLink(file, 'update', {
          icon: iconPath,
          iconIndex: 0,
          appUserModelId: appId
        });
        if (success === false) throw new Error('Windows declined the shortcut update');
        updated.push(file);
      } catch (error) { reportFailure(file, error); }
    }
  }
  return { updated, failed };
}

module.exports = { refreshApplicationShortcuts };
