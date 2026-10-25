import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createProgressiveStartup } from "../../apps/editor/frontend/js/modules/app-progressive-startup.js";
import { normalizeCountryCollection } from "../../shared/frontend/js/modules/country-feature.js";
import { createTerritorialScopeResolver } from "../../shared/frontend/js/modules/territorial-scope.js";
import { geometryRevision } from "../../shared/frontend/js/modules/geometry-versions.js";
import { createCoreStartupState,startupDocument,historicalStartupDocument,startupBaseline } from '../helpers/core-startup.mjs';
import {createNodeCoreProject} from '../helpers/core-project.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const square = size => ({ type: 'Polygon', coordinates: [[[0,0],[0,size],[size,size],[size,0],[0,0]]] });
const collection = size => normalizeCountryCollection({ features: [{ id: 'A', geometry: square(size) }] });

async function startupFixture(t, { pauseAt = null, restored = false, restoredSnapshot = false, onEditable = () => {}, startMonth = '', baselinePending = null, viewRecord = null } = {}) {
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
  let sourceReceipt;
  const baselineProject=restoredSnapshot ? startupDocument(collection(10).features)
    :historicalStartupDocument(normalizeCountryCollection({features:[{id:'state:ukraine',geometry:square(1)},{id:'A',geometry:square(10)}]}).features);
  let project=restored ? startupDocument(collection(10).features):null;
  if(restoredSnapshot) {
    const producer=await createNodeCoreProject(baselineProject);
    try {
      await startupBaseline(baselineProject,producer.project,'2026-10',{kind:'static-features'});
      const changed=await producer.project.executeCommand({commandId:'territorial.metadata',targets:[{domain:'territorial',id:'A'}],
        payload:{id:'A',field:'notes',valuePresent:true,value:'restored snapshot'}});
      assert.equal(changed.ok,true);
      project=JSON.parse((await producer.client.exportSnapshot({format:'pandolab-autosave-full',version:'fixture',savedAt:'2026-10-04T00:00:00.000Z'})).storageJson);
      assert.equal(project.format,'pandolab-autosave-full');
    } finally {producer.dispose();}
  }
  const owner=await createCoreStartupState(t,{ startMonth,view:{ globeZoom:1,flatZoom:1 },projection:'globe',
    dataReadiness:'loading',historyDirtyEntityIds:new Set(),pendingCountryRenderIds:new Set(),autosaveMode:'delta' });
  const { state,entityStore,entityRepository }=owner;
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
        Promise.resolve(onEditable({ state, entityStore, entityRepository,owner })).then(editable.resolve,editable.reject);
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
      restoreAutosave: async () => ({ project, view: viewRecord }),
      syncHistory: noop,
      completeAutosaveRecovery: () => pause('recovery'),
    } },
    domains: {
      commandOwner: owner.client,
      projectDomain: { snapshot:owner.project.snapshot,getGeneration:owner.project.getGeneration,
        state:owner.project.state,inspectImport:owner.project.inspectImport,
        prepareImport:owner.project.prepareImport,admitStorageBaseline:owner.project.admitStorageBaseline,admit:async (input,options) => {
        const accepted=await owner.project.admit(input,options);
        if (options?.reason==='startup-canonical-territories' && pauseAt==='admission') await pause('admission');
        return accepted;
      },restorePreview: async () => null, queueAutosave: () => calls.push(['autosave']),
        ensurePreview: value => calls.push(['ensure-preview', value]) },
      objectSearchController: { beginHydration: noop, completeHydration: () => pause('hydration') },
      editingDomain: { setTool: noop },
      renderingDomain: { invalidateView: noop },
    },
    snapshots: { normalizeProjectObjects: noop, applySharedProjectFields: noop },
    persistence: { applyAutosavedView: noop,
      applyAutosavedTimeline: async view => {
        calls.push(['restore-month', view?.lastViewedMonth || null]);
        return view?.lastViewedMonth ? entityStore.setTimelineCursor(view.lastViewedMonth) : false;
      } }, platform: { deepClone: structuredClone },
    geometryPreview: { boundarySelectionAnalysisCache: new Map() }, labelCacheCommands: {},
    spatialQuery: { mapEditClient: { stop: noop } }, mapView: { syncMapHostFromState: noop },
    projectSession: { saveState: {
      markNewProject: value => calls.push(['mark-new', value]),
      setAutosave: value => calls.push(['saved', value]),
    } },
    territorialModel: { entityStore, entityRepository }, countryServices: { normalizeCountryCollection },
    applicationServicesA: { classifyBuiltinCountries: countries => ({ countries, subunits: [] }) },
    builtinBaseline: { prepareProjectBaseline: async () => {
      if (baselinePending) { paused.resolve(); await baselinePending; }
      return sourceReceipt ||= await startupBaseline(baselineProject,owner.project,'2026-10',{kind:restoredSnapshot?'static-features':'stored-asset'});
    } },
    builtinCountries: { applyFreshBuiltinClassification: noop, installCanonicalCountryStore: noop, materializePristineCountriesSync: () => normalizeCountryCollection(globalThis.window.PANDOLAB_COUNTRIES) },
    countryRecords: { applyPristineLabelAnchors: noop }, objectCatalogView: { pruneLayerItemVisibility: noop },
    countries: { scheduleCountryLabelAnchors: noop }, objectDisplay: { invalidateObjectPresentation: noop },
    projectSnapshots: { configureDatasetSession: noop }, workspaceUiA: { applyLayoutMode: noop },
    editorBindings: { bindUI: noop, syncProjectControls: noop }, mapHostViewA: { initSvg: noop },
    mapHostViewB: { resizeMap: noop, initializeMapHost: async () => {} },
    mapHostViewC: { startMapResizeObserver: noop }, mapHostCommands: { setReadyPromise: noop },
    rendering: { gpuMapRenderer: {
      initialize: async options => { calls.push(['initialize', options]); return true; }, getProjectGeneration: () => generation,
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
    owner,state, entityStore, entityRepository, calls, errors, editable, paused, resume, running, interactive, geometry, mesh,
    async promote() {
      await interactive.promise;
      geometry.resolve({ countries: collection(10), canonicalCountryStore: {} });
    },
    async replaceProject() {
      generation += 1;
      await owner.project.admit(owner.project.snapshot(),{ features:collection(20).features.map(row => ({ ...row,id:'replacement' })),preserveCursor:true });
      state.auditPreviewGeometryReferences = new Map([['replacement', { geometry: state.territorialEntities[0].geometry, revision: 0 }]]);
    },
  };
}

test('cold snapshot restoration needs no current source before the saved view or during promotion',async t=>{
  const fixture=await startupFixture(t,{restoredSnapshot:true});
  await fixture.interactive.promise;
  const sourceId=fixture.owner.client.state().storageBaselineId;
  assert.equal(sourceId,0);assert.equal(fixture.entityRepository.get('A').properties.notes,'restored snapshot');
  assert.equal(fixture.owner.client.state().documentDirty,false);assert.equal(fixture.owner.client.state().canUndo,false);
  assert.deepEqual(fixture.errors,[]);
  await fixture.promote();await fixture.editable.promise;
  assert.equal(fixture.owner.client.state().storageBaselineId,sourceId,'promotion remains independent of a builtin source handle');
  assert.equal(fixture.entityRepository.get('A').properties.notes,'restored snapshot');assert.deepEqual(fixture.errors,[]);
  fixture.mesh.resolve({});await fixture.running;
});
test('staleBaselineDoesNotReplaceNewGeneration', async t => {
  const pending = deferred(), fixture = await startupFixture(t, { baselinePending: pending.promise });
  await fixture.promote(); await fixture.paused.promise;
  await fixture.replaceProject(); pending.resolve(); await setImmediate();
  assert.deepEqual(fixture.state.territorialEntities.map(row => row.id), ['replacement']);
  assert.deepEqual(fixture.errors, []);
  fixture.mesh.resolve({}); await fixture.running;
});
test('nonCurrentStartHasNoModernPreview', async t => {
  const fixture = await startupFixture(t, { startMonth: '2012-10' });
  await fixture.interactive.promise;
  assert.equal(fixture.calls.find(row => row[0] === 'initialize')[1].allowPreview, false);
  assert.equal(fixture.state.territorialEntities.some(row => row.id === 'RUS'), false);
});

for (const pauseAt of ['admission', 'hydration', 'recovery']) {
  test(`project replacement while ${pauseAt} is pending prevents obsolete startup mutations`, async t => {
    const fixture = await startupFixture(t, { pauseAt, restored: pauseAt === 'recovery' });
    await fixture.promote();
    await fixture.paused.promise;
    await fixture.replaceProject();
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
    const fixture = await startupFixture(t, { pauseAt, restored: stage === 'recovery' });
    if (stage === 'geometry') await fixture.interactive.promise;
    else {
      await fixture.promote();
      if (stage === 'mesh') {
        await fixture.editable.promise;
        await setImmediate();
      } else await fixture.paused.promise;
    }
    await fixture.replaceProject();
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
  const fixture = await startupFixture(t, {
    async onEditable({ entityRepository,owner }) {
      baselineGeometry = entityRepository.get('A').geometry;
      const changed = structuredClone(entityRepository.get('A'));
      changed.geometry.coordinates[0][1][1] = 12;
      await owner.project.executeCommand({ commandId:'territorial.geometry',targets:[{ domain:'territorial',id:'A' }],
        payload:{ id:'A',geometry:changed.geometry } });
    },
  });
  await fixture.promote();
  await fixture.editable.promise;
  await setImmediate();
  const reference = fixture.state.auditPreviewGeometryReferences.get('A');
  assert.equal(reference.geometry, baselineGeometry);
  assert.equal(reference.revision, 0, 'preview baseline must precede editable listeners');
  assert.equal(geometryRevision(baselineGeometry), 0);
  assert.notEqual(fixture.entityRepository.get('A').geometry, baselineGeometry);
  const scope = createTerritorialScopeResolver({ entityRepository: fixture.entityRepository,
    getState: () => fixture.state, clipper: () => null });
  assert.equal(fixture.state.countryVisualPhase, 'preview');
  assert.equal(scope.displayFeature('A'), fixture.entityRepository.get('A'), 'edited entity uses exact geometry during preview display');
  assert.deepEqual(fixture.errors, []);
});

for (const replacementStage of ['editable-listener', 'pending-mesh']) {
  test(`replacement at ${replacementStage} cannot schedule an obsolete saved-project preview`, async t => {
    let callCount;
    const fixture = await startupFixture(t, {
      restored: true,
      async onEditable() {
        if (replacementStage !== 'editable-listener') return;
        await fixture.replaceProject();
        callCount = fixture.calls.length;
      },
    });
    await fixture.promote();
    await fixture.editable.promise;
    await setImmediate();
    if (replacementStage === 'pending-mesh') {
      await fixture.replaceProject();
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

test('progressive canonical admission restores the separately stored session cursor', async t => {
  const f = await startupFixture(t, { startMonth: '2026-10', viewRecord: { lastViewedMonth: '2012-10' } });
  await f.promote();
  await f.editable.promise;
  assert.equal(f.owner.client.state().timelineCursor, '2012-10');
  assert.ok(f.calls.some(row => row[0] === 'restore-month' && row[1] === '2012-10'));
  assert.deepEqual(f.errors, []);
  f.mesh.resolve({}); await f.running;
});

test('user navigation during preview wins over an older saved cursor', async t => {
  const f = await startupFixture(t, { startMonth: '2026-10', viewRecord: { lastViewedMonth: '2012-10' } });
  await f.interactive.promise;
  await f.entityStore.setTimelineCursor('2012-11');
  f.geometry.resolve({ countries: collection(10), canonicalCountryStore: {} });
  await f.editable.promise;
  assert.equal(f.owner.client.state().timelineCursor, '2012-11');
  assert.ok(f.calls.some(row => row[0] === 'restore-month' && row[1] === '2012-11'));
  assert.deepEqual(f.errors, []);
  f.mesh.resolve({}); await f.running;
});
