import test from 'node:test';
import assert from 'node:assert/strict';

import { createGeometryPreview } from '../../assets/js/modules/app-geometry-preview.js';
import {
  beginGeometryPreview,
  clearGeometryPreview,
  previewIsCurrent,
} from '../../assets/js/modules/geometry-preview.js';

function fixture({ execute } = {}) {
  const calls = [];
  const state = {
    stateRevision: 1,
    geometryPreview: { revision: 0, session: null },
    territorialEntities: [],
    distributionLayers: [],
    distributionEntries: [],
    labels: [],
    genericFeatures: [],
    itemVisibility: {},
    labelSettings: {},
  };
  const mapEditClient = {
    async execute(operation, payload) {
      calls.push(['execute', operation, payload]);
      if (execute) return execute(operation, payload);
      throw new Error('unexpected worker call');
    },
    commit(id) { calls.push(['commit', id]); },
    discard(id) { calls.push(['discard', id]); },
    stop() { calls.push(['stop']); },
    sourcesCurrent() { return true; },
    rebase() {},
  };
  const preview = createGeometryPreview();
  preview.connect({
    domains: {
      projectDomain: {
        commitHistorySnapshot(snapshot) { calls.push(['history', snapshot]); },
        queueAutosave() { calls.push(['autosave']); },
        getGeneration() { return 1; },
      },
      renderingDomain: {
        invalidateGpuInteraction(reason) { calls.push(['gpu', reason]); },
        invalidateGenericPatch(reason) { calls.push(['generic', reason]); },
      },
      editingDomain: {
        refreshEditingPresentation(reason) { calls.push(['draft', reason]); },
      },
    },
    feedback: {
      setActionStatus(...args) { calls.push(['status', ...args]); },
      reportOperationError(...args) { calls.push(['error', ...args]); },
    },
    geometryEditingCore: {
      beginGeometryPreview,
      clearGeometryPreview,
      previewIsCurrent,
      runMapEditTransaction() { throw new Error('unused'); },
    },
    platform: {
      $() { return null; },
      deepClone: structuredClone,
    },
    presentation: {
      genericFeatureDisplayFeature(feature) { return feature; },
    },
    projectState: { state },
    readiness: { reliabilityDiagnostic: [] },
    snapshots: { snapshotEditable: () => ({ snapshot: true }) },
    spatialFactories: {
      createEditPreviewController() { return {}; },
    },
    spatialQuery: {
      mapEditClient,
    },
    taskUi: {
      setModeBanner(...args) { calls.push(['banner', ...args]); },
      updateModeButtons() { calls.push(['buttons']); },
    },
    territorialModel: {
      assertProjectReferenceIntegrity() { return { ok: true, issues: [] }; },
      entityRepository: { get() { return null; }, list() { return []; } },
    },
    territoryGeometry: {
      pointInGenericFeature() { return true; },
    },
    validation: {
      restoreEditTransactionSnapshot(snapshot) { calls.push(['restore', snapshot]); },
    },
  });
  return { preview, state, calls, mapEditClient };
}

test('worker geometry preview resolves affected entities through the supplied resolver', async () => {
  const before = {
    type: 'Feature',
    id: 'unit-a',
    properties: { entityKind: 'general' },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] },
  };
  const after = structuredClone(before);
  after.geometry.coordinates[0][1] = [3, 0];
  const { preview, state } = fixture({
    execute: async operation => {
      assert.equal(operation, 'territorial-worker-test');
      return {
        requestId: 17,
        result: {
          affectedIds: ['unit-a'],
          removedIds: [],
          features: [after],
          preview: { validation: { issues: [] }, delta: null, metrics: null },
        },
      };
    },
  });
  const resolved = [];
  const ready = await preview.beginWorkerGeometryPreview({
    operation: 'territorial-worker-test',
    payload: {},
    snapshot: {},
    resolveFeature(id) {
      resolved.push(id);
      return before;
    },
    applyResult() {},
    invalidateAfterApply() {},
  });

  assert.equal(ready, true);
  assert.deepEqual(resolved, ['unit-a']);
  assert.equal(state.geometryPreview.session.beforeFeatures[0].id, 'unit-a');
  assert.deepEqual(state.geometryPreview.session.beforeFeatures[0].geometry, before.geometry);
  assert.deepEqual(state.geometryPreview.session.afterFeatures[0].geometry, after.geometry);
});

test('local geometry preview runs only the supplied post-apply invalidation', async () => {
  const { preview, state, calls } = fixture();
  let applied = 0;
  let territorialInvalidations = 0;
  const ready = await preview.beginLocalGeometryPreview({
    operation: 'territorial-test',
    snapshot: { before: true },
    beforeFeatures: [],
    afterFeatures: [],
    preparedPreview: { validation: { issues: [] }, delta: null, metrics: null },
    commitHistorySnapshot: true,
    applyResult() { applied += 1; },
    invalidateAfterApply() { territorialInvalidations += 1; },
  });
  assert.equal(ready, true);

  const committed = await preview.applyActiveGeometryPreview();
  assert.equal(committed, true);
  assert.equal(applied, 1);
  assert.equal(territorialInvalidations, 1);
  assert.equal(state.stateRevision, 2);
  assert.equal(calls.filter(call => call[0] === 'generic').length, 0);
  assert.equal(calls.filter(call => call[0] === 'history').length, 1);
  assert.equal(calls.filter(call => call[0] === 'autosave').length, 1);
});
