import assert from 'node:assert/strict';
import { createRiverCandidates } from '../../assets/js/modules/app-river-candidates.js';
import test from 'node:test';
import { setImmediate } from 'node:timers';

function harness() {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = [];
  const country = { id: 'SRB', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } };
  const session = {
    kind: 'annex', tool: 'annex-territory', stage: 'selection', selectionPhase: 'components', useRiverBoundaries: true,
    componentFeatures: [country], riverPartitionStatus: 'idle', riverPartitionCandidates: [], riverPartitionDonorResults: [],
  };
  const state = {
    territorySelectionSession: session, hydroEdits: [],
    hydroManifest: null, physicalLoadState: { hydro: 'idle' },
  };
  const context = {
    state, countryLandRevision: 1,
    projectDomain: { getGeneration: () => 1 },
    RIVER_TERRITORY_PARTITION_CONFIG: {}, RIVER_TERRITORY_PARTITION_ALGORITHM_REVISION: 'river-partitions-v2',
    riverTerritoryPartitionConfigFingerprint: () => '', countryFeatureById: () => country,
    activeTerritorySelectionSession: () => state.territorySelectionSession,
    riverBoundaryComposition: (_base, { candidates = [] } = {}) => ({
      items: candidates.length ? candidates : [{}],
      riverCandidateCount: candidates.length,
    }),
    territoryBaseComponentItems: () => [],
    countryName: feature => feature.id,
    ensureGisRuntime: async () => {},
    loadHydroData: async () => {
      await gate;
      state.hydroManifest = { version: '0.13.0', index: { sha256: 'loaded-index' } };
      state.physicalLoadState.hydro = 'ready';
      return true;
    },
    gisDomain: {
      loadRiverPartitionFeatures: async () => { calls.push('sources'); return { features: [], diagnostics: {} }; },
      computeRiverPartition: async request => { calls.push('compute'); calls.push(request.hydroRevision); return { candidates: [], donorResults: [] }; },
    },
    setModeBanner: message => calls.push(message), updateModeButtons: () => {},
    editingDomain: { refreshTerritorySelection: ({ tool, reason }) => { calls.push(reason); return tool === session.tool; } },
    normalizeClippedLandGeometry: geometry => geometry,
    reportOperationError: error => calls.push(error.message),
  };
  const candidates = createRiverCandidates();
  candidates.connect(context);
  candidates.initializeRiverPartitionGeneration();
  context.resetRiverPartitionState = candidates.resetRiverPartitionState;
  return { state, session, calls, context, release, run: candidates.prepareRiverPartitionCandidates };

}

test('first checkbox request survives manifest loading and caches under the loaded identity', async () => {
  const h = harness();
  const pending = h.run();
  assert.equal(h.session.riverPartitionStatus, 'loading');
  h.release();
  await pending;
  assert.equal(h.session.riverPartitionStatus, 'ready');
  assert.equal(h.calls.filter(call => call === 'compute').length, 1);
  assert.ok(h.calls.some(call => call.startsWith('0.13.0:loaded-index:')));
  assert.ok(h.calls.includes('분할 가능한 하천이 없어 기존 영토 조각을 표시합니다.'));
  await h.run();
  assert.equal(h.calls.filter(call => call === 'compute').length, 1);
  assert.equal(h.calls.at(-1), 'river-partition-cache-ready');
});

test('result guidance follows the displayed river composition rather than raw candidates', async () => {
  const h = harness();
  h.context.gisDomain.computeRiverPartition = async () => ({
    candidates: [{ key: 'river:1', donorCountryId: 'SRB', componentKey: 'SRB:0', geometry: h.session.componentFeatures[0].geometry }],
    donorResults: [],
  });
  const pending = h.run();
  h.release();
  await pending;
  assert.ok(h.calls.includes('하천으로 나뉜 영토 조각을 선택하세요.'));
  assert.equal(h.calls.at(-1), 'river-partition-ready');
});

test('cancellation or target change during initial loading does not launch a stale computation', async () => {
  for (const change of [h => h.context.resetRiverPartitionState(), h => { h.session.componentFeatures = [{ ...h.session.componentFeatures[0], id: 'AUT' }]; }]) {
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
    assert.equal(h.session.riverPartitionStatus, 'error');
    assert.equal(h.calls.includes('compute'), false);
    assert.equal(h.calls.at(-1), 'river-partition-error');
  }
});
