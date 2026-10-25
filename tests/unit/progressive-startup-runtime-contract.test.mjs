import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import { applicationFunctionSource } from '../../scripts/lib/application-source.mjs';
import { createProgressiveStartup } from "../../apps/editor/frontend/js/modules/app-progressive-startup.js";
import { normalizeCountryCollection } from "../../shared/frontend/js/modules/country-feature.js";
import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";
import { createCoreStartupState,startupDocument,historicalStartupDocument,startupBaseline } from '../helpers/core-startup.mjs';

const source = readFileSync(new URL("../../apps/editor/frontend/js/modules/app-progressive-startup.js", import.meta.url), 'utf8');

test('progressive and canonical startup share one ordered runtime initializer', () => {
  assert.match(source, /async function initializeStartupRuntime\(/);
  const helper = applicationFunctionSource(source, 'initializeStartupRuntime');
  const orderedSteps = [
    'applyLayoutMode',
    'bindUI',
    'beginHydration',
    'initSvg',
    'resizeMap',
    'afterInitialMapSetup();',
    "mapHostStage = 'frame-pending'",
    'await awaitVisualFrame()',
    "mapHostStage = 'host-initialize'",
    'initializeMapHost',
    "mapHostStage = 'gpu-initialize'",
    'gpuMapRenderer.initialize',
    "mapHostStage = 'ready'",
    'startMapResizeObserver',
  ];
  let previous = -1;
  for (const step of orderedSteps) {
    const index = helper.indexOf(step);
    assert.ok(index > previous, `startup runtime step is missing or out of order: ${step}`);
    previous = index;
  }
  assert.match(helper, /return \{ gpuReady, gpuInitializeMs \}/);

  const progressive = applicationFunctionSource(source, 'initProgressive');
  const canonical = applicationFunctionSource(source, 'init');
  assert.match(progressive, /\{ gpuInitializeMs \}\s*=\s*await initializeStartupRuntime\(\{ allowPreview,[\s\S]*preview:/);
  assert.match(canonical, /\{ gpuReady \}\s*=\s*await initializeStartupRuntime\(\{[\s\S]*afterInitialMapSetup:[\s\S]*mapEditClient\.rebase/);
  for (const entrypoint of [progressive, canonical]) {
    assert.doesNotMatch(entrypoint, /applyLayoutMode|bindUI|beginHydration|initializeMapHost|gpuMapRenderer\.initialize|startMapResizeObserver/);
  }
});

test('saved geometry is classified before any first-map source is chosen', () => {
  const progressive = applicationFunctionSource(source, 'initProgressive');
  assert.ok(progressive.indexOf('restoreAutosave()') < progressive.indexOf('await admitFeatures'));
  assert.ok(progressive.indexOf('restorePreview(savedProject)') < progressive.indexOf('initializeStartupRuntime'));
  assert.match(progressive, /previewSource\.kind === 'restore'/);
  assert.match(progressive, /if \(allowPreview\) \{[\s\S]*PREVIEW_READY/);
});

test('canonical promotion discards a worker initialized from preview geometry before editing resumes', () => {
  const promote = applicationFunctionSource(source, 'completeGeometryInitialization');
  const canonicalAssignment = promote.indexOf('await admitTerritorialBaseline');
  const discardPreviewWorker = promote.indexOf('mapEditClient.stop()');
  const editable = promote.indexOf("pandolab:editable");
  assert.ok(canonicalAssignment >= 0);
  assert.ok(discardPreviewWorker > canonicalAssignment);
  assert.ok(editable > discardPreviewWorker);
  assert.doesNotMatch(promote.slice(canonicalAssignment, editable), /mapEditClient\.rebase\(/);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((done,fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function startupFixture(t, { project = null } = {}) {
  const noop = () => {};
  const geometry = deferred();
  const previewFrame = deferred();
  const interactive = deferred();
  const editable = deferred();
  const calls = [];
  const errors = [];
  let sourceReceipt;
  const owner=await createCoreStartupState(t,{ view:{},projection:'globe',dataReadiness:'loading',
    historyDirtyEntityIds:new Set(),pendingCountryRenderIds:new Set(),autosaveMode:'delta' });
  const { state,entityStore,entityRepository }=owner;
  t.mock.method(globalThis, 'setTimeout', () => {
    // Only the host-frame fallback and preview deadline are scheduled here.
    // requestAnimationFrame supplies the host frame; the test owns preview paint.
    return 1;
  });
  t.mock.method(globalThis, 'clearTimeout', noop);
  const oldWindow = globalThis.window;
  const oldAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => globalThis.queueMicrotask(callback);
  globalThis.window = {
    d3: {}, PANDOLAB_COUNTRIES: { type: 'FeatureCollection', features: [{ id: 'A', geometry: { type: 'Polygon', coordinates: [[[0,0],[0,1],[1,1],[1,0],[0,0]]] } }] },
    PANDOLAB_CANONICAL_GEOMETRY_PROMISE: geometry.promise,
    PANDOLAB_CANONICAL_MESH_PROMISE: new Promise(() => {}),
    addEventListener: noop,
    dispatchEvent(event) {
      if (event.type === 'pandolab:interactive') interactive.resolve();
      if (event.type === 'pandolab:editable') {
        calls.push(['editable', state.territorialEntities.map(feature => feature.id)]);
        editable.resolve();
      }
    },
  };
  t.after(() => {
    globalThis.window = oldWindow;
    globalThis.requestAnimationFrame = oldAnimationFrame;
  });
  const startup = createProgressiveStartup();
  startup.connect({
    projectState: { state }, platformConfigurationB: { assertRuntimeCompatibility: noop },
    lifecycleUi: { projectUi: { restoreAutosave: async () => ({ project }), syncHistory: noop } },
    domains: {
      commandOwner: owner.client,
      projectDomain: {snapshot:owner.project.snapshot,getGeneration:owner.project.getGeneration,prepareImport:owner.project.prepareImport,
        state:owner.project.state,inspectImport:owner.project.inspectImport,
        admitStorageBaseline:owner.project.admitStorageBaseline,admit:owner.project.admit,restorePreview:async()=>null},
      objectSearchController: { beginHydration: noop, completeHydration: async () => {} }, editingDomain: { setTool: noop },
    },
    snapshots: { normalizeProjectObjects: noop, applySharedProjectFields: noop }, persistence: { applyAutosavedView: noop, applyAutosavedTimeline: noop },
    platform: { deepClone: structuredClone },
    platformConfigurationA: { BASE_DATASET: 'fixture' },
    geometryPreview: { boundarySelectionAnalysisCache: new Map() },
    labelCacheCommands: {},
    spatialQuery: { mapEditClient: { stop: () => calls.push(['worker-stop']) } },
    mapView: { syncMapHostFromState: noop },
    projectSession: { saveState: { markNewProject: noop } },
    territorialModel: {
      entityStore,
      entityRepository: entityRepository,
    },
    countryServices: { normalizeCountryCollection },
    applicationServicesA: { classifyBuiltinCountries: countries => ({ countries, subunits: [] }) },
    builtinBaseline: { prepareProjectBaseline: async () => {
      const project = historicalStartupDocument(normalizeCountryCollection({ features:[{ id:'state:ukraine',geometry:{ type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[0,0]]] } },{ id:'B',geometry:{ type:'Polygon',coordinates:[[[2,0],[2,1],[3,1],[3,0],[2,0]]] } }] }).features);
      project.territorialEntities.find(row => row.id === 'B').properties.name = 'Detailed B';
      return sourceReceipt ||= await startupBaseline(project,owner.project);
    } },
    builtinCountries: { applyFreshBuiltinClassification: noop, installCanonicalCountryStore: noop, materializePristineCountriesSync: () => normalizeCountryCollection(globalThis.window.PANDOLAB_COUNTRIES) },
    countryRecords: { applyPristineLabelAnchors: noop },
    objectCatalogView: { pruneLayerItemVisibility: noop }, countries: { scheduleCountryLabelAnchors: noop },
    objectDisplay: { invalidateObjectPresentation: noop }, projectSnapshots: { configureDatasetSession: noop },
    workspaceUiA: { applyLayoutMode: noop }, editorBindings: { bindUI: noop, syncProjectControls: noop },
    mapHostViewA: { initSvg: noop },
    mapHostViewB: { resizeMap: noop, initializeMapHost: async () => {}, mapHostReadyPromise: Promise.resolve() },
    mapHostViewC: { startMapResizeObserver: noop }, mapHostCommands: { setReadyPromise: noop },
    rendering: { gpuMapRenderer: {
      initialize: async options => { calls.push(['initialize', options]); return true; },
      getRuntimeState: () => ({ renderer: 'webgl2' }), waitForPreviewFrame: () => previewFrame.promise,
    } },
    applicationConstantsA: { READINESS_EVENTS: { PREVIEW_READY: 'preview-ready', RESTORE_STARTED: 'restore-started', GEOMETRY_READY: 'geometry-ready' } },
    readiness: { canMutateProject: () => false },
    readinessUi: { applyDataReadinessEvent: event => calls.push(['readiness', event]) },
    startupCommands: { markRuntimeReady: noop },
    feedback: { setActionStatus: noop, reportOperationError: (...args) => errors.push(args) },
  });
  startup.init().catch(error => errors.push(error));
  return { previewFrame, interactive, editable, geometry, calls, errors, state };
}

test('canonical geometry reaches the common Store before editing resumes while the detailed mesh is pending', async t => {
  const fixture = await startupFixture(t);
  fixture.previewFrame.resolve(true);
  await fixture.interactive.promise;
  assert.deepEqual(fixture.state.territorialEntities.map(feature => feature.id), ['A']);
  const geometry = { type: 'Polygon', coordinates: [[[2, 0], [2, 1], [3, 1], [3, 0], [2, 0]]] };
  const countries = { type: 'FeatureCollection', features: [createTerritorialFeature({ id: 'B', entityKind: 'general', name: 'Detailed B', geometry })] };
  const before = structuredClone(countries);
  fixture.geometry.resolve({ countries, canonicalCountryStore: {} });
  await fixture.editable.promise;
  const [country] = fixture.state.territorialEntities;
  assert.deepEqual(fixture.state.territorialEntities.map(feature => feature.id), ['B']);
  assert.equal(country.properties.entityKind, 'general');
  assert.equal(country.properties.parentId, '');
  assert.equal(country.properties.name, 'Detailed B');
  assert.deepEqual(country.geometry, geometry);
  assert.equal(Object.hasOwn(country.properties, 'sovereignId'), false);
  assert.deepEqual(countries, before);
  assert.deepEqual(fixture.calls.find(([kind]) => kind === 'editable')[1], ['B']);
  assert.ok(fixture.calls.findIndex(([kind]) => kind === 'worker-stop')
    < fixture.calls.findIndex(([kind]) => kind === 'editable'));
  assert.deepEqual(fixture.errors, []);
});

test('canonical startup becomes editable without waiting for a preview frame', async t => {
  const fixture = await startupFixture(t);
  await fixture.interactive.promise;
  fixture.geometry.resolve({countries:normalizeCountryCollection(window.PANDOLAB_COUNTRIES),canonicalCountryStore:{}});
  await fixture.editable.promise;
  assert.deepEqual(fixture.errors,[]);
});

test('preview frame failure is reported without blocking canonical startup', async t => {
  const error = new Error('preview presentation failed');
  const fixture = await startupFixture(t);
  await fixture.interactive.promise;
  fixture.previewFrame.reject(error);
  fixture.geometry.resolve({countries:normalizeCountryCollection(window.PANDOLAB_COUNTRIES),canonicalCountryStore:{}});
  await fixture.editable.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.errors.length, 1);
  assert.equal(fixture.errors[0][0], error);
  assert.equal(fixture.errors[0][2], 'PL-PREVIEW-FRAME-001');
});

test('uncached saved geometry uses validated exact state while builtin preview stays disabled', async t => {
  const fixture = await startupFixture(t, { project: startupDocument(normalizeCountryCollection({ features: [{ id:'edited',geometry: { type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]] } }] }).features) });
  await fixture.interactive.promise;
  assert.deepEqual(fixture.state.territorialEntities.map(entity => entity.id), ['edited']);
  assert.equal(fixture.calls.find(([kind]) => kind === 'initialize')[1].allowPreview, false);
});
