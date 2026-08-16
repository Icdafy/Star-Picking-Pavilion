'use strict';

const fs = require('node:fs');
const path = require('node:path');

function parseSemver(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
}

function isNewerVersion(candidate, current) {
  const left = parseSemver(candidate);
  const right = parseSemver(current);
  if (!left || !right) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

function prepareUpdateMetadata({ packageJson, latestContent }) {
  const packageVersion = String(packageJson?.version || '');
  const bridgeVersion = String(packageJson?.legacyUpdaterBridgeVersion || '');
  if (!bridgeVersion) return { content: latestContent, version: packageVersion, bridged: false };
  if (!parseSemver(packageVersion) || !parseSemver(bridgeVersion)) {
    throw new Error('package and legacy updater bridge versions must be valid SemVer');
  }
  if (!isNewerVersion(bridgeVersion, packageVersion)) {
    throw new Error(`legacy updater bridge ${bridgeVersion} must be newer than ${packageVersion}`);
  }
  const match = latestContent.match(/^version:\s*['"]?([^'"\s]+)['"]?\s*$/m);
  if (!match) throw new Error('latest.yml has no version field');
  if (match[1] !== packageVersion) {
    throw new Error(`latest.yml starts at ${match[1]}, expected package ${packageVersion}`);
  }
  return {
    content: latestContent.replace(match[0], `version: ${bridgeVersion}`),
    version: bridgeVersion,
    bridged: true
  };
}

if (require.main === module) {
  try {
    const projectRoot = path.join(__dirname, '..');
    const latestPath = path.join(projectRoot, 'dist', 'latest.yml');
    const packageJson = require(path.join(projectRoot, 'package.json'));
    const result = prepareUpdateMetadata({
      packageJson,
      latestContent: fs.readFileSync(latestPath, 'utf8')
    });
    fs.writeFileSync(latestPath, result.content, 'utf8');
    console.log(result.bridged
      ? `Prepared one-time updater bridge ${result.version} for public v${packageJson.version}`
      : `Updater metadata remains at public v${result.version}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { isNewerVersion, parseSemver, prepareUpdateMetadata };
