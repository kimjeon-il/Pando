import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import { applicationFunctionSource } from '../../scripts/lib/application-source.mjs';
import { createProgressiveStartup } from '../../assets/js/modules/app-progressive-startup.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { normalizeCountryCollection } from '../../assets/js/modules/country-feature.js';
import { TERRITORIAL_UNIT_TYPES } from '../../assets/js/modules/territorial-units.js';

const source = readFileSync(new URL('../../assets/js/modules/app-progressive-startup.js', import.meta.url), 'utf8');

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
  assert.match(progressive, /\{ gpuInitializeMs \}\s*=\s*await initializeStartupRuntime\(\{ allowPreview: !hasStoredCountryGeometry,[\s\S]*preview:/);
  assert.match(canonical, /\{ gpuReady \}\s*=\s*await initializeStartupRuntime\(\{[\s\S]*afterInitialMapSetup:[\s\S]*mapEditClient\.rebase/);
  for (const entrypoint of [progressive, canonical]) {
    assert.doesNotMatch(entrypoint, /applyLayoutMode|bindUI|beginHydration|initializeMapHost|gpuMapRenderer\.initialize|startMapResizeObserver/);
  }
});

test('saved geometry is classified before any first-map source is chosen', () => {
  const progressive = applicationFunctionSource(source, 'initProgressive');
  assert.ok(progressive.indexOf('restoreAutosave()') < progressive.indexOf('entityStore.replaceEntities'));
  assert.ok(progressive.indexOf('restorePreview(savedProject)') < progressive.indexOf('initializeStartupRuntime'));
  assert.match(progressive, /previewSource\.kind === 'restore'/);
  assert.match(progressive, /if \(!hasStoredCountryGeometry\) \{[\s\S]*PREVIEW_READY/);
});

test('canonical promotion discards a worker initialized from preview geometry before editing resumes', () => {
  const promote = applicationFunctionSource(source, 'completeGeometryInitialization');
  const canonicalAssignment = promote.indexOf('entityStore.replaceEntities');
  const discardPreviewWorker = promote.indexOf('mapEditClient.stop()');
  const editable = promote.indexOf("pandolab:editable");
  assert.ok(canonicalAssignment >= 0);
  assert.ok(discardPreviewWorker > canonicalAssignment);
  assert.ok(editable > discardPreviewWorker);
  assert.doesNotMatch(promote.slice(canonicalAssignment, editable), /mapEditClient\.rebase\(/);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function startupFixture(t, { project = null, terrainError = null } = {}) {
  const noop = () => {};
  const geometry = deferred();
  const previewFrame = deferred();
  const interactive = deferred();
  const calls = [];
  const errors = [];
  const state = {
    view: {},
    projection: 'globe',
    territorialEntities: [],
    dataReadiness: 'loading',
  };
  const entityStore = createTerritorialEntityStore({ getState: () => state });
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
    addEventListener: noop,
    dispatchEvent(event) {
      if (event.type === 'pandolab:interactive') interactive.resolve();
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
      projectDomain: { restorePreview: async () => null },
      layerTreeController: { beginHydration: noop }, editingDomain: { setTool: noop },
    },
    snapshots: { normalizeProjectObjects: noop }, persistence: { applyAutosavedView: noop },
    territorialModel: {
      entityStore,
      TERRITORIAL_UNIT_TYPES,
    },
    countryServices: { normalizeCountryCollection },
    applicationServicesA: { classifyBuiltinCountries: countries => ({ countries, subunits: [] }) },
    builtinCountries: { applyFreshBuiltinClassification: noop },
    countryRecords: { applyPristineLabelAnchors: noop },
    layerTree: { pruneLayerItemVisibility: noop }, countries: { scheduleCountryLabelAnchors: noop },
    layers: { markLayerTreeDirty: noop }, projectSnapshots: { configureDatasetSession: noop },
    workspaceUiA: { applyLayoutMode: noop }, editorBindings: { bindUI: noop, syncProjectControls: noop },
    mapHostViewA: { initSvg: noop },
    mapHostViewB: { resizeMap: noop, initializeMapHost: async () => {}, mapHostReadyPromise: Promise.resolve() },
    mapHostViewC: { startMapResizeObserver: noop }, mapHostCommands: { setReadyPromise: noop },
    rendering: { gpuMapRenderer: {
      initialize: async options => { calls.push(['initialize', options]); return true; },
      getRuntimeState: () => ({ renderer: 'webgl2' }), waitForPreviewFrame: () => previewFrame.promise,
    } },
    applicationConstantsA: { READINESS_EVENTS: { PREVIEW_READY: 'preview-ready', RESTORE_STARTED: 'restore-started' } },
    readiness: { canMutateProject: () => false },
    readinessUi: { applyDataReadinessEvent: event => calls.push(['readiness', event]) },
    startupCommands: { markRuntimeReady: noop },
    feedback: { setActionStatus: noop, reportOperationError: (...args) => errors.push(args) },
    physicalResources: { loadTerrainManifest: () => {
      calls.push(['terrain']);
      return terrainError ? Promise.reject(terrainError) : new Promise(() => {});
    } },
  });
  startup.init().catch(error => errors.push(error));
  return { previewFrame, interactive, calls, errors, state };
}

test('painted preview starts terrain without waiting for canonical data or terrain completion', async t => {
  const fixture = startupFixture(t);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.calls.some(([kind]) => kind === 'terrain'), false);
  fixture.previewFrame.resolve(true);
  await fixture.interactive.promise;
  assert.equal(fixture.calls.filter(([kind]) => kind === 'terrain').length, 1);
  assert.ok(fixture.calls.findIndex(([kind]) => kind === 'terrain')
    > fixture.calls.findIndex(([kind, event]) => kind === 'readiness' && event === 'preview-ready'));
});

test('terrain rejection is handled independently of canonical startup', async t => {
  const error = new Error('terrain startup failed');
  const fixture = startupFixture(t, { terrainError: error });
  fixture.previewFrame.resolve(true);
  await fixture.interactive.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.errors.length, 1);
  assert.equal(fixture.errors[0][0], error);
  assert.equal(fixture.errors[0][2], 'PL-TERRAIN-001');
});

test('uncached saved geometry retains neutral startup until exact restoration', async t => {
  const fixture = startupFixture(t, { project: { territorialEntities: normalizeCountryCollection({ features: [{ id: 'edited', geometry: { type: 'Polygon', coordinates: [[[0,0],[0,1],[1,1],[1,0],[0,0]]] } }] }).features } });
  await fixture.interactive.promise;
  assert.equal(fixture.calls.some(([kind]) => kind === 'terrain'), false);
  assert.deepEqual(fixture.state.territorialEntities, []);
  assert.equal(fixture.calls.find(([kind]) => kind === 'initialize')[1].allowPreview, false);
  const progressive = applicationFunctionSource(source, 'initProgressive');
  assert.match(progressive, /await completeGeometryInitialization[\s\S]*if \(hasStoredCountryGeometry\) startTerrainLoading\(\)/);
  assert.doesNotMatch(applicationFunctionSource(source, 'completeMeshEnhancement'), /loadTerrainManifest|startTerrainLoading/);
});
