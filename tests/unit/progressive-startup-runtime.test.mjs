import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createProgressiveStartup } from '../../assets/js/modules/app-progressive-startup.js';
import { normalizeCountryCollection } from '../../assets/js/modules/country-feature.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { createTerritorialScopeResolver } from '../../assets/js/modules/territorial-scope.js';
import { geometryRevision, touchGeometry } from '../../assets/js/modules/geometry-versions.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const square = size => ({ type: 'Polygon', coordinates: [[[0,0],[0,size],[size,size],[size,0],[0,0]]] });
const collection = size => normalizeCountryCollection({ features: [{ id: 'A', geometry: square(size) }] });

function startupFixture(t, { pauseAt = null, restored = false, onEditable = () => {} } = {}) {
  const noop = () => {};
  const geometry = deferred();
  const mesh = deferred();
  const interactive = deferred();
  const editable = deferred();
  const paused = deferred();
  const resume = deferred();
  const calls = [];
  const errors = [];
  let generation = 1;
  const project = restored ? { territorialEntities: collection(10).features, baseDataset: 'fixture' } : null;
  const state = {
    view: { globeZoom: 1, flatZoom: 1 }, projection: 'globe', territorialEntities: [],
    dataReadiness: 'loading', historyDirtyEntityIds: new Set(), pendingCountryRenderIds: new Set(),
    autosaveMode: 'delta', selected: null,
  };
  const entityStore = createTerritorialEntityStore({ getState: () => state });
  const entityRepository = createTerritorialEntityRepository({ entityStore });
  const originalWindow = globalThis.window;
  const originalFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => globalThis.queueMicrotask(callback);
  globalThis.window = {
    d3: {},
    PANDOLAB_COUNTRIES: collection(1),
    PANDOLAB_CANONICAL_GEOMETRY_PROMISE: geometry.promise,
    PANDOLAB_CANONICAL_MESH_PROMISE: mesh.promise,
    addEventListener: noop,
    dispatchEvent(event) {
      if (event.type === 'pandolab:interactive') interactive.resolve();
      if (event.type === 'pandolab:editable') {
        calls.push(['editable']);
        onEditable({ state, entityStore, entityRepository });
        editable.resolve();
      }
    },
  };
  t.after(() => {
    globalThis.window = originalWindow;
    globalThis.requestAnimationFrame = originalFrame;
  });
  t.mock.method(globalThis, 'setTimeout', () => 1);
  t.mock.method(globalThis, 'clearTimeout', noop);
  t.mock.method(console, 'error', (...args) => calls.push(['error', ...args]));
  const pause = async stage => {
    calls.push([stage]);
    if (pauseAt === stage) {
      paused.resolve();
      await resume.promise;
    }
  };
  const startup = createProgressiveStartup();
  startup.connect({
    projectState: { state },
    platformConfigurationB: { assertRuntimeCompatibility: noop },
    platformConfigurationA: { BASE_DATASET: 'fixture' },
    lifecycleUi: { projectUi: {
      restoreAutosave: async () => ({ project }),
      syncHistory: noop,
      completeAutosaveRecovery: () => pause('recovery'),
    } },
    domains: {
      projectDomain: { restorePreview: async () => null, queueAutosave: () => calls.push(['autosave']),
        ensurePreview: value => calls.push(['ensure-preview', value]) },
      layerTreeController: { beginHydration: noop, completeHydration: () => pause('hydration') },
      editingDomain: { setTool: noop },
      renderingDomain: { invalidateView: noop },
    },
    snapshots: { normalizeProjectObjects: noop, applySharedProjectFields: noop },
    persistence: { applyAutosavedView: noop }, platform: { deepClone: structuredClone },
    geometryPreview: { boundarySelectionAnalysisCache: new Map() }, labelCacheCommands: {},
    spatialQuery: { mapEditClient: { stop: noop } }, mapView: { syncMapHostFromState: noop },
    projectSession: { saveState: {
      markNewProject: value => calls.push(['mark-new', value]),
      setAutosave: value => calls.push(['saved', value]),
    } },
    territorialModel: { entityStore, entityRepository }, countryServices: { normalizeCountryCollection },
    applicationServicesA: { classifyBuiltinCountries: countries => ({ countries, subunits: [] }) },
    builtinCountries: { applyFreshBuiltinClassification: noop, installCanonicalCountryStore: noop },
    countryRecords: { applyPristineLabelAnchors: noop }, layerTree: { pruneLayerItemVisibility: noop },
    countries: { scheduleCountryLabelAnchors: noop }, layers: { markLayerTreeDirty: noop },
    projectSnapshots: { configureDatasetSession: noop }, workspaceUiA: { applyLayoutMode: noop },
    editorBindings: { bindUI: noop, syncProjectControls: noop }, mapHostViewA: { initSvg: noop },
    mapHostViewB: { resizeMap: noop, initializeMapHost: async () => {} },
    mapHostViewC: { startMapResizeObserver: noop }, mapHostCommands: { setReadyPromise: noop },
    rendering: { gpuMapRenderer: {
      initialize: async () => true, getProjectGeneration: () => generation,
      getRuntimeState: () => ({ renderer: 'webgl2' }), waitForPreviewFrame: async () => true,
    } },
    applicationConstantsA: {
      READINESS_EVENTS: { PREVIEW_READY: 'preview', RESTORE_STARTED: 'restore', GEOMETRY_READY: 'ready' },
      AUTOSAVE_STATES: { SAVED: 'saved' },
    },
    readiness: { canMutateProject: () => false },
    readinessUi: { applyDataReadinessEvent: noop }, startupCommands: { markRuntimeReady: noop },
    feedback: { setActionStatus: noop, reportOperationError: error => errors.push(error) },
    physicalResources: { loadTerrainManifest: async () => {} },
  });
  const running = startup.init().catch(error => errors.push(error));
  return {
    state, entityStore, entityRepository, calls, errors, editable, paused, resume, running, interactive, geometry, mesh,
    async promote() {
      await interactive.promise;
      geometry.resolve({ countries: collection(10), canonicalCountryStore: {} });
    },
    replaceProject() {
      generation += 1;
      entityStore.replaceEntities(normalizeCountryCollection({ features: [{ id: 'replacement', geometry: square(20) }] }).features);
      state.auditPreviewGeometryReferences = new Map([['replacement', { geometry: state.territorialEntities[0].geometry, revision: 0 }]]);
    },
  };
}

for (const pauseAt of ['hydration', 'recovery']) {
  test(`project replacement while ${pauseAt} is pending prevents obsolete startup mutations`, async t => {
    const fixture = startupFixture(t, { pauseAt, restored: pauseAt === 'recovery' });
    await fixture.promote();
    await fixture.paused.promise;
    fixture.replaceProject();
    const replacementEntities = fixture.state.territorialEntities;
    const replacementReferences = fixture.state.auditPreviewGeometryReferences;
    const callCount = fixture.calls.length;
    fixture.resume.resolve();
    await setImmediate();
    assert.deepEqual(fixture.calls.slice(callCount), [], 'retired initialization must not mark save state or publish editable');
    assert.equal(fixture.state.territorialEntities, replacementEntities);
    assert.equal(fixture.state.auditPreviewGeometryReferences, replacementReferences);
    assert.deepEqual(fixture.errors, []);
  });
}

for (const stage of ['geometry', 'hydration', 'recovery', 'mesh']) {
  test(`a rejected obsolete ${stage} operation leaves the replacement project and diagnostics untouched`, async t => {
    const pauseAt = ['hydration', 'recovery'].includes(stage) ? stage : null;
    const fixture = startupFixture(t, { pauseAt, restored: stage === 'recovery' });
    if (stage === 'geometry') await fixture.interactive.promise;
    else {
      await fixture.promote();
      if (stage === 'mesh') {
        await fixture.editable.promise;
        await setImmediate();
      } else await fixture.paused.promise;
    }
    fixture.replaceProject();
    const replacementEntities = fixture.state.territorialEntities;
    const replacementReferences = fixture.state.auditPreviewGeometryReferences;
    const callCount = fixture.calls.length;
    const error = new Error(`obsolete ${stage} failed`);
    if (stage === 'geometry') fixture.geometry.reject(error);
    else if (stage === 'mesh') fixture.mesh.reject(error);
    else fixture.resume.reject(error);
    await fixture.running;
    assert.equal(fixture.state.territorialEntities, replacementEntities);
    assert.equal(fixture.state.auditPreviewGeometryReferences, replacementReferences);
    assert.deepEqual(fixture.calls.slice(callCount), [], 'stale failure must not log or apply recovery side effects');
    assert.deepEqual(fixture.errors, [], 'stale rejection must be contained');
  });
}

test('an immediate editable listener edit cannot bless stale preview geometry as current', async t => {
  let baselineGeometry;
  const fixture = startupFixture(t, {
    onEditable({ entityRepository }) {
      baselineGeometry = entityRepository.get('A').geometry;
      baselineGeometry.coordinates[0][1][1] = 12;
      touchGeometry(baselineGeometry);
    },
  });
  await fixture.promote();
  await fixture.editable.promise;
  await setImmediate();
  const reference = fixture.state.auditPreviewGeometryReferences.get('A');
  assert.equal(reference.geometry, baselineGeometry);
  assert.equal(reference.revision, 0, 'preview baseline must precede editable listeners');
  assert.equal(geometryRevision(baselineGeometry), 1);
  const scope = createTerritorialScopeResolver({ entityRepository: fixture.entityRepository,
    getState: () => fixture.state, clipper: () => null });
  assert.equal(fixture.state.countryVisualPhase, 'preview');
  assert.equal(scope.displayFeature('A'), fixture.entityRepository.get('A'), 'edited entity uses exact geometry during preview display');
  assert.deepEqual(fixture.errors, []);
});

for (const replacementStage of ['editable-listener', 'pending-mesh']) {
  test(`replacement at ${replacementStage} cannot schedule an obsolete saved-project preview`, async t => {
    let callCount;
    const fixture = startupFixture(t, {
      restored: true,
      onEditable() {
        if (replacementStage !== 'editable-listener') return;
        fixture.replaceProject();
        callCount = fixture.calls.length;
      },
    });
    await fixture.promote();
    await fixture.editable.promise;
    await setImmediate();
    if (replacementStage === 'pending-mesh') {
      fixture.replaceProject();
      callCount = fixture.calls.length;
    }
    const replacementEntities = fixture.state.territorialEntities;
    const replacementReferences = fixture.state.auditPreviewGeometryReferences;
    fixture.mesh.resolve({});
    await fixture.running;
    assert.deepEqual(fixture.calls.slice(callCount), [], 'old startup must not cache the retired project preview');
    assert.equal(fixture.state.territorialEntities, replacementEntities);
    assert.equal(fixture.state.auditPreviewGeometryReferences, replacementReferences);
    assert.deepEqual(fixture.errors, []);
  });
}
