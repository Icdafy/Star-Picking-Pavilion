'use strict';

const PUBLIC_VERSION_PATTERN = /\d+\.\d+\.\d+(?:\.\d+)?/;

function extractPublicVersion(value) {
  const match = String(value || '').match(PUBLIC_VERSION_PATTERN);
  return match ? match[0] : '';
}

function publicVersionFromUpdateInfo(info = {}) {
  return extractPublicVersion(info.tag)
    || extractPublicVersion(info.releaseName)
    || String(info.version || '');
}

function publicVersionFromPackage(packageJson, fallback = '') {
  return extractPublicVersion(packageJson?.build?.buildVersion)
    || extractPublicVersion(fallback);
}

function createUpdateInstallCoordinator({
  autoUpdater,
  shutdown,
  setQuitReady,
  reportStatus
} = {}) {
  let installing = false;

  async function install(version = '') {
    if (installing) return { started: false, reason: 'already-installing' };
    if (!autoUpdater || typeof autoUpdater.quitAndInstall !== 'function') {
      return { started: false, reason: 'updater-unavailable' };
    }

    installing = true;
    reportStatus?.('installing', { version });
    try {
      // NSIS must not race the utility process or Electron for files that are still open.
      // Finish the app's cooperative shutdown before the updater launches the installer.
      await shutdown();
      setQuitReady?.(true);
      autoUpdater.quitAndInstall();
      return { started: true };
    } catch (error) {
      installing = false;
      setQuitReady?.(false);
      const message = String(error?.message || error);
      reportStatus?.('error', { message });
      return { started: false, reason: 'install-failed', message };
    }
  }

  return Object.freeze({
    install,
    get installing() { return installing; }
  });
}

module.exports = {
  createUpdateInstallCoordinator,
  extractPublicVersion,
  publicVersionFromPackage,
  publicVersionFromUpdateInfo
};
