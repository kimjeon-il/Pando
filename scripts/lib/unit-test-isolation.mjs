// Explicit only when a runnable unit suite touches a shared repository resource.
// In-memory state and bounded per-test temporary directories are not global locks.
const isolatedResources = new Map([
  ['tests/unit/place-publication.test.mjs', 'shared-report-worktree'],
  ['tests/unit/place-sync-contract.test.mjs', 'shared-report-worktree'],
]);

export const unitIsolationResource = file => isolatedResources.get(file) || null;
export const requiresUnitIsolation = file => unitIsolationResource(file) !== null;
export const isolatedUnitSuites = () => new Map(isolatedResources);
