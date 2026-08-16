'use strict';

const fs = require('node:fs');
const path = require('node:path');

function expectedInstallerName(packageJson) {
  const template = packageJson.build?.win?.artifactName;
  if (template !== 'Star-Picking-Pavilion-Setup-${buildVersion}.${ext}') {
    throw new Error(`unexpected installer template: ${template || '(missing)'}`);
  }
  return template.replace('${buildVersion}', packageJson.build?.buildVersion).replace('${ext}', 'exe');
}

function readLatestVersion(file) {
  const content = fs.readFileSync(file, 'utf8');
  const match = content.match(/^version:\s*['"]?([^'"\s]+)['"]?\s*$/m);
  if (!match) throw new Error(`latest.yml has no version: ${file}`);
  return match[1];
}

function verifyVersion({
  packageJson,
  tag,
  distDir,
  requireArtifacts = false
}) {
  const version = String(packageJson?.version || '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`invalid package version: ${version}`);
  const releaseVersion = String(packageJson?.build?.buildVersion || '');
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(releaseVersion)) {
    throw new Error(`invalid public release version: ${releaseVersion}`);
  }
  if (packageJson?.shortVersionWindows !== releaseVersion) {
    throw new Error(
      `Windows product version ${packageJson?.shortVersionWindows || '(missing)'} `
      + `does not match public release ${releaseVersion}`
    );
  }
  const expectedTag = `v${releaseVersion}`;
  if (tag !== expectedTag) {
    throw new Error(`tag ${tag || '(missing)'} does not match public release ${releaseVersion}`);
  }

  const installer = expectedInstallerName(packageJson);
  if (requireArtifacts) {
    if (!distDir) throw new Error('distDir is required for artifact verification');
    const installerPath = path.join(distDir, installer);
    const latestPath = path.join(distDir, 'latest.yml');
    if (!fs.existsSync(installerPath)) throw new Error(`missing installer for package version: ${installerPath}`);
    if (!fs.existsSync(latestPath)) throw new Error(`missing latest.yml: ${latestPath}`);
    const latestVersion = readLatestVersion(latestPath);
    if (latestVersion !== version) {
      throw new Error(`latest.yml ${latestVersion} does not match package ${version}`);
    }
  }

  return { version, releaseVersion, tag: expectedTag, installer };
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (require.main === module) {
  try {
    const projectRoot = path.join(__dirname, '..');
    const args = process.argv.slice(2);
    const result = verifyVersion({
      packageJson: require(path.join(projectRoot, 'package.json')),
      tag: argumentValue(args, '--tag') || process.env.GITHUB_REF_NAME,
      distDir: path.join(projectRoot, 'dist'),
      requireArtifacts: args.includes('--artifacts')
    });
    console.log(`Verified ${result.tag} -> ${result.installer}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { expectedInstallerName, readLatestVersion, verifyVersion };
