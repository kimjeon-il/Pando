// Shared owner indexing for executable unit suites and retired feature identities.
// Marker identities remain visible to check selection after physical file merges.
const originalMarker = /^\s*\/\/ Original feature contract: ([\w.-]+\.test\.mjs)\s*$/gm;

export function indexUnitContractOwners(unitFiles, read) {
  const contractOwners = new Map(), suiteContracts = new Map(), duplicates = [];
  for (const file of [...unitFiles].sort()) {
    if (!file.startsWith('tests/unit/') || !file.endsWith('.test.mjs'))
      throw Error('Invalid unit suite path: ' + file);
    const source = read(file);
    const identities = new Set([file, ...[...source.matchAll(originalMarker)]
      .map(match => 'tests/unit/' + match[1])]);
    suiteContracts.set(file, identities);
    for (const identity of identities) {
      const previous = contractOwners.get(identity);
      if (previous && previous !== file)
        duplicates.push({identity, files: [previous, file]});
      else contractOwners.set(identity, file);
    }
  }
  return {contractOwners, suiteContracts, duplicates};
}
