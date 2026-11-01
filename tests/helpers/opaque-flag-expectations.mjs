import { readFileSync } from 'node:fs';

const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/portability/${name}.json`, import.meta.url), 'utf8'));

/** Preserve independently recorded flag behavior without loading an obsolete project format. */
export function currentOpaqueFlagExpectations() {
  const recorded = fixture('web-opaque-flag-contract'), seed = fixture('web-document-seed');
  return { baseline: recorded.baseline, cases: recorded.cases.map(row => {
    // Only the flag metadata changes in this scenario. Every other current
    // document field must equal the independently authored complete v14 seed.
    const project = structuredClone(seed);
    project.territorialEntities.find(entity => entity.id === 'A').properties.metadata = structuredClone(row.metadata);
    return { ...structuredClone(row), project };
  }) };
}
