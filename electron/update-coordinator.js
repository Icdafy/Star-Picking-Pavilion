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
  return extractPublicVersion(packageJson?.version)
    || extractPublicVersion(packageJson?.build?.buildVersion)
    || extractPublicVersion(fallback);
}

function releaseVersionFromUpdateInfo(info = {}) {
  return extractPublicVersion(info.tag) || extractPublicVersion(info.releaseName);
}

function comparePublicVersions(left, right) {
  const leftVersion = extractPublicVersion(left);
  const rightVersion = extractPublicVersion(right);
  if (!leftVersion || !rightVersion) return null;
  const leftParts = leftVersion.split('.').map(Number);
  const rightParts = rightVersion.split('.').map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

function createPublicUpdateSupport({ currentVersion, fallback } = {}) {
  return async info => {
    const releaseVersion = releaseVersionFromUpdateInfo(info);
    if (releaseVersion && comparePublicVersions(releaseVersion, currentVersion) <= 0) {
      return false;
    }
    return typeof fallback === 'function' ? fallback(info) : true;
  };
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
      // Silent NSIS update avoids presenting its transient process-close dialog as a
      // failed installation; force-run reopens the app only after replacement succeeds.
      autoUpdater.quitAndInstall(true, true);
      return { started: true };
    } catch (error) {
      installing = false;
      setQuitReady?.(false);
      const message = String(error?.message || error);
      reportStatus?.('error', { message });
      return { started: false, reason: 'install-failed', message };
    }
  }

  function reportFailure(error) {
    if (!installing) return false;
    installing = false;
    setQuitReady?.(false);
    const message = String(error?.message || error);
    reportStatus?.('error', { message });
    return true;
  }

  return Object.freeze({
    install,
    reportFailure,
    get installing() { return installing; }
  });
}

module.exports = {
  createUpdateInstallCoordinator,
  comparePublicVersions,
  createPublicUpdateSupport,
  extractPublicVersion,
  publicVersionFromPackage,
  publicVersionFromUpdateInfo,
  releaseVersionFromUpdateInfo
};
