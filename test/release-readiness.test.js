'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('package and lockfile versions stay synchronized at v0.0.2', () => {
  const packageJson = JSON.parse(read('package.json'));
  const packageLock = JSON.parse(read('package-lock.json'));

  assert.equal(packageJson.version, '0.0.2');
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].version, packageJson.version);
});

test('public release documentation and compliance artifacts are complete', () => {
  for (const file of [
    'LICENSE',
    'CHANGELOG.md',
    'SECURITY.md',
    'THIRD_PARTY_NOTICES.txt',
    'RELEASE_NOTES.md',
    'scripts/verify-version.js',
    'scripts/generate-third-party-notices.js',
    '.github/workflows/ci.yml'
  ]) assert.equal(fs.existsSync(path.join(root, file)), true, `missing ${file}`);

  assert.match(read('LICENSE'), /MIT License[\s\S]*THE SOFTWARE IS PROVIDED "AS IS"/);
  assert.equal(require('../package.json').version, '0.0.2');
  assert.match(read('CHANGELOG.md'), /\[0\.0\.2\].*2026-07-23/);
  assert.match(read('CHANGELOG.md'), /\[0\.0\.1\].*2026-07-21/);
  assert.match(read('SECURITY.md'), /Security Advisories/);
  assert.match(read('RELEASE_NOTES.md'), /v0\.0\.2[\s\S]*选择[\s\S]*DeepSeek[\s\S]*未签名/);
  assert.match(read('THIRD_PARTY_NOTICES.txt'), /cheerio@1\.2\.0/);
  assert.doesNotMatch(read('THIRD_PARTY_NOTICES.txt'), /UNKNOWN/);
});

test('third-party notices use the platform line ending', () => {
  const { renderNotices } = require('../scripts/generate-third-party-notices');
  const output = renderNotices({ version: '0.0.2' }, []);
  const contentWithoutExpectedLineEndings = output.split(os.EOL).join('');

  assert.doesNotMatch(contentWithoutExpectedLineEndings, /[\r\n]/);
});

test('README documents installation, privacy, recovery and security truthfully', () => {
  const readme = read('README.md');
  for (const required of [
    /Windows 10\/11.*x64/,
    /Star-Picking-Pavilion-Setup-0\.0\.2\.exe/,
    /SmartScreen/,
    /Get-FileHash/,
    /云幄\s*·\s*常用网址/,
    /%APPDATA%\\摘星阁/,
    /卸载.*保留/s,
    /备份.*star-picking-pavilion\.db/s,
    /发送.*配置的.*模型服务/s,
    /随机.*端口.*令牌/s,
    /safeStorage/,
    /MIT/
  ]) assert.match(readme, required);
  assert.match(readme, /API Key 不写入 `settings\.json`/);
  assert.doesNotMatch(readme, /settings\.json`\s*\|\s*DeepSeek Key/i);
  assert.doesNotMatch(readme, /HTTP\s*:7644/);
});

test('version verifier matches package, tag, installer and latest metadata', async t => {
  assert.equal(fs.existsSync(path.join(root, 'scripts', 'verify-version.js')), true);
  const { verifyVersion } = require('../scripts/verify-version');
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-version-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  await fs.promises.writeFile(path.join(directory, 'latest.yml'), 'version: 0.0.2\n');
  await fs.promises.writeFile(path.join(directory, 'Star-Picking-Pavilion-Setup-0.0.2.exe'), 'fixture');

  assert.deepEqual(verifyVersion({
    packageJson: require('../package.json'),
    tag: 'v0.0.2',
    distDir: directory,
    requireArtifacts: true
  }), {
    version: '0.0.2',
    tag: 'v0.0.2',
    installer: 'Star-Picking-Pavilion-Setup-0.0.2.exe'
  });
  assert.throws(() => verifyVersion({
    packageJson: require('../package.json'),
    tag: 'v0.0.1',
    distDir: directory
  }), /tag.*package/i);
});

test('CI and tag release workflows enforce every gate before publishing', () => {
  const ci = read('.github/workflows/ci.yml');
  const release = read('.github/workflows/release.yml');
  const releasingGuide = read('RELEASING.md');
  assert.match(ci, /pull_request:/);
  assert.match(ci, /push:/);
  for (const command of ['npm ci', 'npm test', 'npm run test:e2e', 'npm run audit:runtime']) {
    assert.match(ci, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const workflow of [ci, release]) {
    assert.ok(workflow.indexOf('npm run notices') < workflow.indexOf('npm run dist'));
    assert.match(workflow, /git diff --exit-code -- THIRD_PARTY_NOTICES\.txt/);
  }
  const localReleaseOrder = [
    'npm run notices',
    'git diff --exit-code -- THIRD_PARTY_NOTICES.txt',
    'npm run dist'
  ];
  let previousLocal = -1;
  for (const value of localReleaseOrder) {
    const index = releasingGuide.indexOf(value);
    assert.ok(index > previousLocal, `${value} missing or out of order in RELEASING.md`);
    previousLocal = index;
  }

  const ordered = [
    'npm ci',
    'npm run verify:version',
    'npm test',
    'npm run test:e2e',
    'npm run audit:runtime',
    'npm run notices',
    'npm run dist',
    'npm run verify:package',
    'Get-FileHash',
    'cyclonedx-npm',
    'gh release create'
  ];
  let previous = -1;
  for (const value of ordered) {
    const index = release.indexOf(value);
    assert.ok(index > previous, `${value} missing or out of order`);
    previous = index;
  }
  assert.match(release, /THIRD_PARTY_NOTICES\.txt/);
  assert.match(release, /sbom\.cdx\.json/);
  assert.match(release, /SHA256SUMS\.txt/);
  assert.doesNotMatch(release, /--publish always/);
});

test('package exposes reproducible release maintenance commands', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.scripts['verify:version'], 'node scripts/verify-version.js');
  assert.equal(pkg.scripts.notices, 'node scripts/generate-third-party-notices.js');
  assert.equal(pkg.devDependencies['@cyclonedx/cyclonedx-npm'], '^6.0.0');
  assert.equal(Object.hasOwn(pkg.scripts, 'release'), false);
});
