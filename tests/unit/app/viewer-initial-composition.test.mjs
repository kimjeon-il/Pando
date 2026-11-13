import { nextEventTurn } from "../../helpers/async-test-ports.mjs";
import { describe as contractSuite } from 'node:test';
import * as __dep0 from "../../../src/app/viewer-load-status.js";
import * as __dep1 from "node:test";
import * as __dep2 from "node:assert/strict";
import * as __dep3 from "node:fs";
import * as __dep4 from "node:vm";
import * as __dep5 from "../../../src/app/viewer-initial-presentation.js";
import * as __dep6 from "../../../src/app/viewer-post-presentation.js";
contractSuite("viewer-initial-composition", () => {
const { presentViewerLoadStatus } = __dep0;
const test = __dep1.default;
const assert = __dep2.default;
const { readFileSync } = __dep3;
const { runInNewContext } = __dep4;
const { createViewerInitialPresentation } = __dep5;
const { createViewerPostPresentation } = __dep6;

const source = readFileSync(new URL("../../../src/app/viewer-composition.js", import.meta.url), 'utf8')
  .replace(/^import [^\n]*\r?\n/gm, '').replace('export async function ', 'async function ')
  .replaceAll('import.meta.url', JSON.stringify(import.meta.url));
const tick = nextEventTurn;
const noop = () => {};
function fixture({hydration = Promise.resolve(), autoReady = true} = {}) {
  const nodes = new Map(), ports = {mapUpdates:0,mapPublicationWaits:[]}, errors = [];
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, {dataset: {}, hidden: false, textContent: '', addEventListener: noop, appendChild: noop, setAttribute(name, value) { this[name] = value; }});
    return nodes.get(id);
  };
  const document = {getElementById: get, createElement: () => ({addEventListener: noop}),
    addEventListener: noop,removeEventListener: noop,visibilityState: 'visible'};
  const window = {location: {search: '?debug=1'}, dispatchEvent: noop, addEventListener: noop, removeEventListener: noop};
  const surfaces = {isMobile: () => false, initializeWorkspaceSurfaces: noop, closeMobileSheets: noop,
    closeSurface: noop, applyLayoutMode: noop, syncOverlayState: noop, closeFileMenu: noop,
    surfaceController: {isOpen: () => false}};
  const project = {documentId: 'fixture', projectSetup: {initialMapBounds: null}};
  let revision = 0, generation = 0, opening = false, failNext = false, cursor = null;
  const domain = {activeProjectScope: () => 'fixture', activeProject: () => generation ? {source:'builtin'} : null, requireTimelineMonth: noop, getOpenRevision: () => revision, getGeneration: () => generation, isOpening: () => opening,
    async open(reader, options) {
      revision++; opening = true;
      try {
        await reader();
        if (failNext) { failNext = false; throw new Error('source unavailable'); }
        generation++;
        await map.update();
        if (autoReady) ports.map.onMapPreparationStatus({status: 'ready',mapReady:true,label: '준비됨'}, generation);
        if (options?.presentation === 'temporal') options.onPresented();
        return true;
      } finally { opening = false; }
    },
  };
  const map = {viewState: {}, objectPresentation: {}, objectQuery: {},
    objectCatalog: {invalidateObjectPresentation: noop, pruneLayerItemVisibility: async () => {}},
    features:()=>[], navigation: {}, capturePresentation: () => ({}), loadPhysicalResources: noop,
    loadPhysicalLandMask: async () => {}, update: async () => {ports.mapUpdates++;},
    renderer:{beginTemporalViewTransition:()=>1,admitTemporalViewTransition:()=>true,finishTemporalViewTransition:noop,waitForMapPresentation:async generation=>{ports.mapPublicationWaits.push(generation);return true;}},
    prepareBuiltinProject: async () => ({}), refreshAppearance: noop};
  const context = {presentViewerLoadStatus, document, window, URL, URLSearchParams, structuredClone, console,
    createViewerPostPresentation,
    // Startup tests isolate the map; inspector lifecycle behavior has its own focused tests.
    createViewerInspectorController: () => ({syncMapSelection: noop, openAfterStartup: async () => false, dispose: noop}),
    createViewerAdjacentPrefetch: () => ({afterPresented: noop,interrupt: noop,dispose: noop}),
    CustomEvent: class {constructor(type) { this.type = type; }}, createViewerInitialPresentation,
    createPlatformPorts: () => ({}), createRuntimeContext: ({meta}) => ({meta, platform: {}}), createMapProjectRuntime:()=>({project:{},hydratePhysicalMetadata:async()=>({})}), territorialMembershipDelta:()=>({changed:false}),
    createPreferencePresentation: () => ({current: {timeline:{defaultWorldFollowCurrentMonth:true},appearance:{mapStyle:'standard'}}, apply: noop}),
    createDiagnosticLog: () => ({snapshot: () => [],push: noop}),
    createTooltipController: () => ({bind: noop}), createBrowserProjectStorage: () => ({}),
    createMapOwners: () => ({workspaceSurfaces: surfaces, physicalResources: {preparePhysicalContext:async()=>{}}, territorialLabels: {},
      builtinSession: {setPresentedSourceMonth: noop, clearPreparedSourceCache: noop}}),
    createSelectController: () => ({enhanceAll: noop}),
    createNotificationPresentation: () => ({reportOperationError: error => errors.push(error)}),
    createInitialDocument: () => project,
    createDocumentSession: () => ({commandOwner: {load: async () => {}, setTimelineCursor:async month=>{if(failNext){failNext=false;throw new Error('source unavailable');}cursor=month;}, state: () => ({timelineCursor:cursor})}, documentModel: {snapshot: () => project}}),
    createProjectDomain: () => domain,
    createSelectionDomain: () => ({}), createSelectionUiController: () => ({syncNow: noop}), connectMapOwner: noop,
    createViewerMap: value => { ports.map = value; return map; },
    createAppObjectSearchController: () => ({bind: noop, render: noop, completeHydration: () => hydration}),
    installTimelineControls: value => { ports.timeline = value; return noop; },
    createProjectMonthClock: value => {
      let month = null;
      const selectMonth = async (next, mode='manual') => {
        const result = await value.applyMonth(next, {mode, isCurrent: () => true, commit: () => { month = next; cursor=next; return true; }});
        if (result) month = next;
        return result;
      };
      const clock = {month: () => month, initialize: () => selectMonth('2026-10','startup'), selectMonth,
        followNow: () => selectMonth('2026-10','follow'), isAutomatic: () => true, suspend: () => () => true};
      ports.clock = clock; return clock;
    },
    createFileController: () => ({bind: noop, openProjectPicker: noop}), createBrowserFileAccess: () => ({}),
    createMapSettings: () => ({connect: noop, applyMapStyle: async()=>false, dispose:noop}),
    createNavigationBindings: () => ({connect: noop, bindNavigationUI: noop}), createPreferencesDialog: () => ({sync:noop,dispose:noop}),
    createEmptyState: noop, createSemanticIcon: noop, createSurfaceController: noop,
    saveUserPreferences: noop, layerStyle: noop, DISTRIBUTION_RENDER_MODES: {},
    coreSelectionRefToWeb: noop, isRecoverableLoadError: () => true,
    createApplicationLifecycle: value => {
      ports.lifecycle = value;
      return {async start() { for (const compose of value.compose) await compose(); return value.startup(); }};
    },
  };
  runInNewContext(source, context);
  const started = context.composeViewer({productMode: 'viewer', meta: {appVersion: 'test'}});
  return {started, get, ports, errors, debug: () => context.__PANDOLAB_VIEWER__,
    publish: status => ports.map.onMapPreparationStatus({status,mapReady:status==='ready'||status==='limited',label: status}, generation),
    failNext: () => { failNext = true; }};
}

test('composition ends only initial presentation while search hydration is still pending', async () => {
  let release;
  const run = fixture({hydration: new Promise(resolve => { release = resolve; })});
  await tick();
  assert.equal(run.debug().initialMapPresented(), true);
  assert.equal(run.get('viewer').dataset.initialLoading, 'false');
  assert.equal(run.get('viewerStatus').dataset.ready, 'true',
    'map readiness must not wait for deferred search hydration');
  assert.equal(run.ports.map.isInitialPresentation(), false);
  try {
    assert.equal(run.get('viewerStatus').className, 'ui-visually-hidden');
    assert.equal(run.get('viewerStatus').hidden, false);
    assert.equal(run.get('viewerStatus').role, 'status');
    await run.started; // Startup is allowed to resolve while search is withheld.
  } finally { release(); }
  assert.equal(run.get('viewerStatus').textContent, '지도 준비 완료.');
  assert.equal(run.get('viewerStatus').hidden, false);
});

test('completed loading without a ready renderer frame remains initial', async () => {
  const run = fixture({autoReady: false}); await run.started;
  assert.equal(run.get('viewerStatus').dataset.ready, 'true');
  assert.equal(run.debug().initialMapPresented(), false);
  assert.equal(run.ports.map.isInitialPresentation(), true);
  run.publish('loading'); assert.equal(run.debug().initialMapPresented(), false);
  run.publish('ready'); assert.equal(run.debug().initialMapPresented(), true);
});

test('each accepted file/date opens one scene and waits once for its committed generation',async()=>{
  const run=fixture();await run.started;
  assert.equal(run.ports.mapUpdates,1,'startup has exactly one scene build');
  assert.deepEqual(run.ports.mapPublicationWaits,[1]);
  await run.ports.timeline.setMonth('2025-12');
  assert.equal(run.ports.mapUpdates,2,'date replacement must not rebuild the same scene twice');
  assert.deepEqual(run.ports.mapPublicationWaits,[1,1]);
  assert.equal(run.get('viewerStatus').dataset.ready,'true');
});

test('normal year change and later source failure never restore initial mode', async () => {
  const run = fixture(); await run.started;
  await run.ports.timeline.setMonth('2025-12');
  // Date navigation keeps the accepted project and replaces its time cursor.
  assert.equal(run.get('viewerStatus').dataset.loadingKind, 'temporal');
  assert.equal(run.get('viewerStatus').dataset.ready, 'true',
    'the accepted successor is ready only after its date navigation commits');
  assert.equal(run.get('viewerStatus').className, 'ui-visually-hidden');
  run.failNext();
  await assert.rejects(run.ports.timeline.setMonth('2024-12'), /source unavailable/);
  assert.equal(run.get('viewerStatus').dataset.ready, 'true',
    'a failed next-month read must restore the previous accepted map readiness');
  assert.equal(run.debug().initialMapPresented(), true);
  assert.equal(run.get('viewer').dataset.initialLoading, 'false');
  await run.ports.lifecycle.startup(); // Same entry used by lifecycle recovery.
  assert.equal(run.debug().initialMapPresented(), true);
  assert.equal(run.ports.map.isInitialPresentation(), false);
});

test('failed first open and lifecycle retry keep one page-scoped presentation owner', async () => {
  const run = fixture(); run.failNext();
  await assert.rejects(run.started, /source unavailable/);
  assert.equal(run.debug().initialMapPresented(), false);
  assert.equal(run.get('viewer').dataset.initialLoading, 'true');
  assert.equal(run.get('viewerStatus').dataset.ready, 'false');
  await run.ports.lifecycle.startup();
  assert.equal(run.debug().initialMapPresented(), true);
  assert.equal(run.get('viewer').dataset.initialLoading, 'false');
});


test('P2-3 failed search hydration cannot reject an accepted map or reset readiness', async () => {
  const run = fixture({hydration: Promise.reject(new Error('post-search unavailable'))});
  await run.started;
  await tick();
  assert.equal(run.get('viewerStatus').dataset.ready, 'true');
  assert.equal(run.get('viewer').dataset.initialLoading, 'false');
  assert.equal(run.debug().initialMapPresented(), true);
  assert.equal(run.errors.length, 1);
  assert.match(run.errors[0].message, /post-search unavailable/);
});
});
