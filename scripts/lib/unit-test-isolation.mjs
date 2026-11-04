// These fixtures share the report worktree or require system-wide Git idleness.
const isolated = new Set(['tests/unit/place-publication.test.mjs',
  'tests/unit/place-sync-contract.test.mjs','tests/unit/reference-cache-cleanup.test.mjs']);

export const requiresUnitIsolation = file => isolated.has(file);
