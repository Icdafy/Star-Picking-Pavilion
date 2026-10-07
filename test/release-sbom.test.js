'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { completeReleaseSbom } = require('../scripts/complete-release-sbom');

test('real release SBOM includes the locked native Electron runtime while excluding build tooling', { timeout: 60000 }, async t => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-release-sbom-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'sbom.cdx.json');
  const root = path.join(__dirname, '..');
  const cli = path.join(root, 'node_modules/@cyclonedx/cyclonedx-npm/bin/cyclonedx-npm-cli.js');
  await promisify(execFile)(process.execPath, [cli, '--omit', 'dev', '--spec-version', '1.6',
    '--output-reproducible', '--output-file', file, '--validate'], { cwd: root, timeout: 45000 });
  const result = await completeReleaseSbom(file, root);
  const bom = JSON.parse(fs.readFileSync(file, 'utf8'));
  const runtime = bom.components.find(component => component.name === 'electron');
  assert.equal(runtime.version, require('../package-lock.json').packages['node_modules/electron'].version);
  assert.equal(result.electronVersion, runtime.version);
  assert.equal(bom.components.some(component => component.name === 'electron-builder'), false);
  assert.ok(bom.dependencies.find(dependency => dependency.ref === bom.metadata.component['bom-ref']).dependsOn.includes(runtime['bom-ref']));
  const first = fs.readFileSync(file, 'utf8');
  await completeReleaseSbom(file, root);
  assert.equal(fs.readFileSync(file, 'utf8'), first);
  bom.metadata.component.version = '0.0.0';
  fs.writeFileSync(file, JSON.stringify(bom));
  await assert.rejects(completeReleaseSbom(file, root), /versions must match/);
});
