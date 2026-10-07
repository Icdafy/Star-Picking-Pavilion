'use strict';

// npm marks Electron as dev, but its native runtime is shipped in the installer.
const fs = require('node:fs');
const path = require('node:path');
const { JsonValidator } = require('@cyclonedx/cyclonedx-library/Validation');

async function completeReleaseSbom(file, root = path.join(__dirname, '..')) {
  const bom = JSON.parse(fs.readFileSync(file, 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const electron = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8'));
  const rootRef = bom.metadata?.component?.['bom-ref'];
  if (bom.bomFormat !== 'CycloneDX' || bom.specVersion !== '1.6' || !rootRef
    || !Array.isArray(bom.components) || bom.metadata.component.version !== packageJson.version
    || electron.version !== lock.packages['node_modules/electron']?.version) {
    throw new Error('SBOM, package and installed Electron versions must match the release');
  }
  const ref = `pkg:npm/electron@${electron.version}`;
  if (bom.components.some(component => component.name === 'electron' && component['bom-ref'] !== ref)) {
    throw new Error('SBOM already contains a conflicting Electron runtime');
  }
  if (!bom.components.some(component => component['bom-ref'] === ref)) {
    bom.components.push({ type: 'framework', 'bom-ref': ref, name: 'electron', version: electron.version,
      scope: 'required', purl: ref, licenses: [{ license: { id: 'MIT' } }],
      description: 'Native Electron desktop runtime shipped with the Windows installer; npm download tooling is excluded.',
      externalReferences: [{ type: 'vcs', url: 'https://github.com/electron/electron' }] });
  }
  bom.dependencies ||= [];
  let rootDependency = bom.dependencies.find(dependency => dependency.ref === rootRef);
  if (!rootDependency) { rootDependency = { ref: rootRef, dependsOn: [] }; bom.dependencies.push(rootDependency); }
  rootDependency.dependsOn = [...new Set([...(rootDependency.dependsOn || []), ref])].sort();
  if (!bom.dependencies.some(dependency => dependency.ref === ref)) bom.dependencies.push({ ref, dependsOn: [] });
  const content = JSON.stringify(bom, null, 2) + '\n';
  const errors = await new JsonValidator('1.6').validate(content);
  if (errors) throw new Error(`Completed release SBOM failed schema validation: ${JSON.stringify(errors)}`);
  fs.writeFileSync(file, content, 'utf8');
  return { electronVersion: electron.version, components: bom.components.length };
}

if (require.main === module) {
  if (!process.argv[2]) { console.error('Usage: node scripts/complete-release-sbom.js <sbom.cdx.json>'); process.exitCode = 1; }
  else completeReleaseSbom(path.resolve(process.argv[2]))
    .then(result => console.log(`Validated ${result.components} SBOM components including Electron ${result.electronVersion}`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { completeReleaseSbom };
