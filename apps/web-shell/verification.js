import { installDiagnostics } from './diagnostics.js';
import { installFullWorldProbe } from './full-world-probe.js';
import { installReferenceRuntimeProbe } from './reference-analysis-probe.js';
export { finishDiagnostics } from './probe-storage.js';
export { installDiagnostics };
export function installWorld(profile) {
  if (globalThis.__PANDOLAB_SHELL_REFERENCE_ANALYSIS__) installReferenceRuntimeProbe();
  else installFullWorldProbe({
    readyDelayMs: Number(globalThis.__PANDOLAB_SHELL_PROBE_HOLD_MS__) || 500,
    expectedSourceCount: profile.world.countryCount,
    expectedModelCount: profile.world.modelEntityCount,
    expectedRootCount: profile.world.rootCount,
  });
}
