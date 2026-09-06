import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { setImmediate } from 'node:timers';

const app = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
// Exercise the actual app orchestration with controlled asynchronous services.
const signatures = app.slice(app.indexOf('  function riverPartitionGeometrySignature('), app.indexOf('  function riverPartitionBoundsOverlap('));
const request = app.slice(app.indexOf('  async function prepareRiverPartitionCandidates('), app.indexOf('  function finishGenericFeatureDraft('));

function harness() {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = [];
  const country = { id: 'SRB', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } };
  const state = {
    annexTargetCountryId: 'HUN', annexDonorCountryIds: ['SRB'], hydroEdits: [],
    hydroManifest: null, physicalLoadState: { hydro: 'idle' }, annexRiverPartitionStatus: 'idle',
  };
  const context = vm.createContext({
    state, structuredClone, riverPartitionGeneration: 0, countryLandRevision: 1,
    projectDomain: { getGeneration: () => 1 },
    RIVER_TERRITORY_PARTITION_CONFIG: {}, RIVER_TERRITORY_PARTITION_ALGORITHM_REVISION: 'river-partitions-v2',
    riverTerritoryPartitionConfigFingerprint: () => '', countryFeatureById: () => country,
    riverPartitionRequestActive: () => true, riverPartitionCache: new Map(),
    resetRiverPartitionState: () => { context.riverPartitionGeneration++; state.annexRiverPartitionStatus = 'idle'; },
    ensureGisRuntime: async () => {},
    loadHydroData: async () => {
      await gate;
      state.hydroManifest = { version: '0.13.0', index: { sha256: 'loaded-index' } };
      state.physicalLoadState.hydro = 'ready';
      return true;
    },
    gisDomain: {
      loadRiverPartitionFeatures: async () => { calls.push('sources'); return { features: [], diagnostics: {} }; },
      computeRiverPartition: async () => { calls.push('compute'); return { candidates: [], donorResults: [] }; },
    },
    setModeBanner: () => {}, updateModeButtons: () => {},
    editingDomain: { refreshTerritoryOperation: reason => calls.push(reason) },
    normalizeClippedLandGeometry: geometry => geometry,
    applyRiverPartitionResult: () => { state.annexRiverPartitionStatus = 'ready'; },
    riverPartitionResultMessage: () => '', reportOperationError: error => calls.push(error.message),
  });
  vm.runInContext(signatures + '\n' + request, context);
  return { state, calls, context, release, run: () => vm.runInContext('prepareRiverPartitionCandidates()', context) };
}

test('first checkbox request survives manifest loading and caches under the loaded identity', async () => {
  const h = harness();
  const pending = h.run();
  assert.equal(h.state.annexRiverPartitionStatus, 'loading');
  h.release();
  await pending;
  assert.equal(h.state.annexRiverPartitionStatus, 'ready');
  assert.equal(h.calls.filter(call => call === 'compute').length, 1);
  assert.match([...h.context.riverPartitionCache.keys()][0], /0\.13\.0:loaded-index/);
  await h.run();
  assert.equal(h.calls.filter(call => call === 'compute').length, 1);
  assert.equal(h.calls.at(-1), 'river-partition-cache-ready');
});

test('cancellation or target change during initial loading does not launch a stale computation', async () => {
  for (const change of [h => h.context.resetRiverPartitionState(), h => { h.state.annexTargetCountryId = 'AUT'; }]) {
    const h = harness();
    const pending = h.run();
    await new Promise(resolve => setImmediate(resolve));
    change(h);
    h.release();
    await pending;
    assert.equal(h.calls.includes('compute'), false);
    assert.equal(h.calls.includes('river-partition-ready'), false);
  }
});

test('initial runtime or hydro failure exits loading and publishes an error', async () => {
  for (const service of ['ensureGisRuntime', 'loadHydroData']) {
    const h = harness();
    h.context[service] = async () => { throw new Error('initialization failed'); };
    await h.run();
    assert.equal(h.state.annexRiverPartitionStatus, 'error');
    assert.equal(h.calls.includes('compute'), false);
    assert.equal(h.calls.at(-1), 'river-partition-error');
  }
});
