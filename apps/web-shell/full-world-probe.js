import { finishDiagnostics } from './probe-storage.js';

export function inspectFullWorldRuntime(scope = globalThis, {
  expectedSourceCount = 258, expectedModelCount = 254, expectedRootCount = 207,
} = {}) {
  const meta = scope.PANDOLAB_BUILD_META || {};
  const startup = scope.__PANDOLAB_STARTUP_METRICS__ || {};
  const gpu = scope.__PANDOLAB_GPU_METRICS__ || {};
  const network = scope.__PANDOLAB_SHELL_NETWORK__ || {};
  const territorial = scope.PANDOLAB_TERRITORIAL;
  // Current world geometry contains 258 territorial features, including
  // dependent territories. Filtering parentId:'' measures only sovereign roots.
  const countries = typeof territorial?.list === 'function'
    ? territorial.list({ kind: 'general' }) : [];
  const countryCount = Array.isArray(countries) ? countries.length : -1;
  const sovereignRoots = typeof territorial?.list === 'function'
    ? territorial.list({ kind: 'general', parentId: '' }) : [];
  const sovereignRootCount = Array.isArray(sovereignRoots) ? sovereignRoots.length : -1;
  const baseline = scope.PANDOLAB_PREVIEW_BASELINE?.defaultClassification || {};
  const sourceCountryCount = Object.keys(baseline.countries || {}).length
    + (Array.isArray(baseline.removedIds) ? baseline.removedIds.length : 0);
  const workers = Array.isArray(network.workers) ? network.workers : [];
  const blocked = Array.isArray(network.blocked) ? network.blocked : [];
  const checks = {
    packageProfile: meta.resourceProfile === 'full-world' ? 'PASS' : 'FAIL',
    builtinWorld: meta.builtinWorld?.sha256 ? 'PASS' : 'FAIL',
    sourceCountryCount: sourceCountryCount === expectedSourceCount ? 'PASS' : 'FAIL',
    modelEntityCount: countryCount === expectedModelCount ? 'PASS' : 'FAIL',
    sovereignRootCount: sovereignRootCount === expectedRootCount ? 'PASS' : 'FAIL',
    preview: startup.preview ? 'PASS' : 'FAIL',
    canonicalGeometry: startup.geometry ? 'PASS' : 'FAIL',
    canonicalMesh: startup.mesh ? 'PASS' : 'FAIL',
    renderer: /^webgl[12]$/.test(String(gpu.renderer || ''))
      && Number(gpu.triangleCount) > 0 && Number(gpu.countryBaseIndexCount) > 0
      ? 'PASS' : 'FAIL',
    sharedCore: scope.PandoLabSphericalCore ? 'PASS' : 'FAIL',
    dataLoaderWorker: workers.some(worker => worker.name === 'pandolab-data-loader') ? 'PASS' : 'FAIL',
    blockedRequests: blocked.length === 0 ? 'PASS' : 'FAIL',
  };
  return {
    schema: 'pandolab-web-shell-world-probe',
    version: 1,
    phase: 'canonical-ready',
    ok: Object.values(checks).every(value => value === 'PASS'),
    checks,
    observed: {
      countryCount,
      sovereignRootCount,
      sourceCountryCount,
      expectedSourceCount,
      expectedModelCount,
      expectedRootCount,
      renderer: String(gpu.renderer || ''),
      triangleCount: Number(gpu.triangleCount || 0),
      countryBaseIndexCount: Number(gpu.countryBaseIndexCount || 0),
      activeWebGlContextCount: Number(gpu.activeWebGlContextCount || 0),
      previewReceivedMs: startup.previewReceivedMs ?? null,
      canonicalGeometryReceivedMs: startup.canonicalGeometryReceivedMs ?? null,
      canonicalMeshReceivedMs: startup.canonicalMeshReceivedMs ?? null,
      readyMs: startup.readyMs ?? null,
      dataRevision: String(meta.dataRevision || ''),
      blockedRequests: blocked.length,
      workers: workers.map(worker => ({ name: worker.name, type: worker.type })),
    },
  };
}

export function installFullWorldProbe({
  scope = globalThis,
  expectedSourceCount = 258, expectedModelCount = 254, expectedRootCount = 207,
  timeoutMs = 240_000,
  readyDelayMs = 500, reportFn = finishDiagnostics,
} = {}) {
  if (scope.__PANDOLAB_SHELL_AUTO__ !== true) return false;
  let finished = false;
  const finish = (phase, error = '') => {
    if (finished) return;
    finished = true;
    scope.clearTimeout(timeout);
    let report;
    try {
      report = inspectFullWorldRuntime(scope, {
        expectedSourceCount, expectedModelCount, expectedRootCount,
      });
    } catch (cause) {
      report = { schema: 'pandolab-web-shell-world-probe', phase, ok: false, error: String(cause) };
    }
    if (phase !== 'canonical-ready' || error) {
      report = { ...report, phase, ok: false, error: String(error || phase) };
    }
    scope.__PANDOLAB_SHELL_WORLD_REPORT__ = report;
    Promise.resolve().then(() => reportFn(report)).catch(cause => {
      scope.console?.error?.('[PANDOLAB-WORLD-PROBE]', cause);
    });
  };
  const timeout = scope.setTimeout(() => finish('timeout', 'Full-world canonical readiness timed out'), timeoutMs);
  scope.addEventListener('pandolab:ready', () => {
    scope.setTimeout(() => finish('canonical-ready'), readyDelayMs);
  }, { once: true });
  for (const event of ['pandolab:error', 'pandolab:geometry-error', 'pandolab:mesh-error']) {
    scope.addEventListener(event, detail => {
      finish(event, String(detail?.detail || detail?.message || 'World bootstrap failure'));
    }, { once: true });
  }
  return true;
}
