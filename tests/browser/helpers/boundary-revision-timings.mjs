import { writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export const BOUNDARY_REVISION_STAGES = Object.freeze(['undo-click', 'child-observation', 'parent-observation', 'storage-observation',
  'redo-click', 'redo-observation']);

export function isBoundaryRevisionComparison(env = process.env) {
  const mode = env.PANDOLAB_BOUNDARY_REVISION_COMPARISON;
  if (mode === undefined) return false;
  if (mode !== '1') throw new Error('PANDOLAB_BOUNDARY_REVISION_COMPARISON must be exactly 1');
  return true;
}

// Only host scalars: never reads the page or adds work to the browser.
export function createBoundaryRevisionTimings(now = () => performance.now()) {
  const entries = BOUNDARY_REVISION_STAGES.map(name => ({ name, status: 'not-reached', startMs: null, endMs: null, durationMs: null }));
  let finished = false;
  return {
    async measure(name, operation) {
      const entry = entries.find(stage => stage.name === name);
      if (!entry || entry.status !== 'not-reached' || finished) throw new Error(`Invalid boundary timing stage: ${name}`);
      entry.startMs = now();
      entry.status = 'pending';
      try {
        const result = await operation();
        if (!finished) entry.status = 'fulfilled';
        return result;
      } catch (error) {
        if (!finished) entry.status = 'rejected';
        throw error;
      } finally {
        if (!finished) { entry.endMs = now(); entry.durationMs = entry.endMs - entry.startMs; }
      }
    },
    finish(testStatus) {
      finished = true;
      for (const entry of entries) if (entry.status === 'pending' && testStatus !== 'passed') entry.status = 'pending-at-failure';
      return { schemaVersion: 1, label: 'boundary-project-undo', testStatus,
        clock: 'host performance.now() milliseconds', stages: entries };
    },
  };
}

// Teardown runs even when preparation fails before project Undo or the test
// times out with a browser operation still pending. Output failure never masks
// the functional result; the runner separately requires readable timings.
// Playwright requires an object fixture dependency parameter.
// eslint-disable-next-line no-empty-pattern
export async function boundaryRevisionTimingFixture({}, use, testInfo, env = process.env) {
  if (!isBoundaryRevisionComparison(env)) { await use(null); return; }
  if (testInfo.config.metadata?.boundaryRevisionComparison !== true) throw new Error('Helpers off requires the isolated comparison config');
  const path = env.PANDOLAB_BOUNDARY_TIMINGS_PATH;
  if (!path || !isAbsolute(path)) throw new Error('PANDOLAB_BOUNDARY_TIMINGS_PATH must be an absolute path');
  const recorder = createBoundaryRevisionTimings();
  try { await use(recorder); }
  finally {
    try { writeFileSync(path, `${JSON.stringify(recorder.finish(testInfo.status), null, 2)}\n`); }
    catch (error) { console.error(`Boundary timing output unavailable: ${error.code || 'OUTPUT_ERROR'}`); }
  }
}
