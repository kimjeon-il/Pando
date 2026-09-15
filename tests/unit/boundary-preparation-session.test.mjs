import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeometryPreview } from '../../assets/js/modules/app-geometry-preview.js';

function fixture() {
  const requests = [], counters = { stop: 0, refresh: 0 };
  let generation = 1;
  const state = { tool: 'country-border', boundaryEditPhase: 'selecting', boundaryEditCountryIds: ['A', 'B'],
    coastEditScopeGenericFeatureId: null, countriesData: { features: [{ id: 'A', geometry: {} }, { id: 'B', geometry: {} }] },
    territorialUnits: [], countryOverrides: {}, genericFeatures: [] };
  const app = createGeometryPreview();
  app.connect({ state, projectDomain: { getGeneration: () => generation },
    mapEditClient: { execute(operation, payload, options) { return new Promise((resolve, reject) => requests.push({ operation, payload, options, resolve, reject })); }, stop() { counters.stop++; } },
    editingDomain: { refreshTerritorySelection({ tool }) { assert.equal(tool, state.tool); counters.refresh++; } }, updateModeButtons() {},
  });
  const result = (selectedIds = ['A', 'B']) => ({ result: { preparationId: 'ready', selectedIds, valid: true, neighbors: ['C'], handles: [], segments: [], isolatedIds: [] } });
  return { app, state, requests, counters, result, nextProject() { generation++; } };
}

test('identical in-flight entry requests share the promise and getters never prepare topology', async () => {
  const f = fixture();
  const first = f.app.rebuildBoundaryTopology(['B', 'A']);
  assert.strictEqual(first, f.app.rebuildBoundaryTopology(['A', 'B']));
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0].payload.payload.targetIds, ['A', 'B']);
  for (let i = 0; i < 10; i++) { f.app.getCountryBoundaryHandles(); f.app.getCountryBoundarySegments(); f.app.boundaryEditSelectionAnalysis(); }
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve(f.result()); await first;
  assert.equal(f.counters.refresh, 2, 'pending and ready boundary packets both invalidate editing presentation');
  f.state.countryOverrides.A = { color: 'red' };
  assert.strictEqual(f.app.rebuildBoundaryTopology(['A', 'B']), first);
  assert.equal(f.app.boundaryEditSelectionAnalysis().valid, true);
});

test('cancel terminates a pending worker and a late result cannot reopen editing', async () => {
  const f = fixture(), pending = f.app.rebuildBoundaryTopology(['A', 'B']);
  f.state.boundaryPreparation.cancel(); f.state.boundaryPreparation = null; f.state.tool = 'select';
  f.requests[0].resolve(f.result());
  assert.equal(await pending, false);
  assert.equal(f.state.boundaryPreparation, null);
  assert.equal(f.counters.stop, 1);
  assert.equal(f.requests[0].options.signal.aborted, true);
});

test('changing targets replaces the pending request and discards the old response', async () => {
  const f = fixture(), first = f.app.rebuildBoundaryTopology(['A', 'B']);
  f.state.boundaryEditCountryIds = ['B'];
  const second = f.app.rebuildBoundaryTopology(['B']);
  f.requests[0].resolve(f.result()); assert.equal(await first, false);
  assert.equal(f.state.boundaryPreparation.status, 'pending');
  f.requests[1].resolve(f.result(['B'])); await second;
  assert.deepEqual(f.state.boundaryPreparation.result.selectedIds, ['B']);
});

test('geometry, lock, and project changes reject late results with a retryable state', async () => {
  for (const change of [f => { f.state.countriesData.features[0].geometry = {}; }, f => { f.state.countryOverrides.A = { locked: true }; }, f => f.nextProject()]) {
    const f = fixture(), pending = f.app.rebuildBoundaryTopology(['A', 'B']);
    change(f); f.requests[0].resolve(f.result());
    assert.equal(await pending, false);
    assert.equal(f.state.boundaryPreparation.status, 'error');
    f.state.boundaryPreparation.retry();
    assert.equal(f.requests.length, 2);
    f.requests[1].resolve(f.result()); await f.state.boundaryPreparation.promise;
  }
});

test('worker failure keeps the tool open and retry does not run a main-thread fallback', async () => {
  const f = fixture(), pending = f.app.rebuildBoundaryTopology(['A', 'B']);
  f.requests[0].reject(new Error('timeout')); await pending;
  assert.equal(f.state.boundaryPreparation.status, 'error');
  assert.equal(f.state.tool, 'country-border');
  f.state.boundaryPreparation.retry();
  f.requests[1].resolve(f.result()); await f.state.boundaryPreparation.promise;
  assert.equal(f.state.boundaryPreparation.status, 'ready');
});
