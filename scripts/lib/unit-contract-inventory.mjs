// Machine-checked preservation of original unit contract identities.
// File counts are deliberately not used as a proxy for coverage.
import {basename} from 'node:path';
import {readFileSync} from 'node:fs';

const baselineURL = new URL('../contracts/unit-contract-identities.json', import.meta.url);

export function auditUnitContractIdentities(repository, baseline = JSON.parse(readFileSync(baselineURL, 'utf8'))) {
  if (baseline.schema !== 'pando-unit-contract-identities-v1' || !Array.isArray(baseline.unitFiles))
    throw Error('Invalid unit contract baseline');
  const unitFiles = repository.tests.filter(file => file.startsWith('tests/unit/')).sort();
  const owners = new Map(), duplicates = [];
  for (const file of unitFiles) {
    const source = repository.read(file);
    const identities = [basename(file), ...[...source.matchAll(
      /^\s*\/\/ Original feature contract: ([\w.-]+\.test\.mjs)\s*$/gm,
    )].map(match => match[1])];
    for (const identity of new Set(identities)) {
      const previous = owners.get(identity);
      if (previous && previous !== file) duplicates.push({identity, files: [previous, file]});
      else owners.set(identity, file);
    }
  }
  const missing = baseline.unitFiles.filter(file => !owners.has(file));
  const retired = baseline.unitFiles.filter(file => !repository.exists('tests/unit/' + file));
  // Check only references made stale by this migration, not historical paths
  // in unrelated archived research workflows.
  const staleReferences = [];
  const retiredPaths = new Set(retired.map(file => 'tests/unit/' + file));
  for (const file of repository.files.filter(file => file === 'package.json'
      || file.startsWith('.github/workflows/') || file.startsWith('scripts/'))) {
    if (!/\.(?:mjs|js|json|yml|yaml)$/.test(file)) continue;
    const source = repository.read(file);
    for (const match of source.matchAll(/tests\/unit\/[\w./-]+\.test\.mjs/g)) {
      if (retiredPaths.has(match[0])) staleReferences.push({file, reference: match[0]});
    }
  }
  return {unitFileCount: unitFiles.length, originalContractCount: baseline.unitFiles.length,
    registeredContractCount: owners.size, missing, duplicates, staleReferences};
}
