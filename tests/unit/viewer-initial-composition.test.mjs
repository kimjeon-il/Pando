import { nextEventTurn } from '../helpers/async-test-ports.mjs';
import { describe as contractSuite } from 'node:test';
import * as __dep0 from "../../apps/viewer/js/modules/viewer-load-status.js";
import * as __dep1 from "node:test";
import * as __dep2 from "node:assert/strict";
import * as __dep3 from "node:fs";
import * as __dep4 from "node:vm";
import * as __dep5 from "../../apps/viewer/js/modules/viewer-initial-presentation.js";
import * as __dep6 from "../../apps/viewer/js/modules/viewer-post-presentation.js";
import * as __dep7 from "../../apps/viewer/js/modules/viewer-initial-preview.js";
contractSuite("viewer-initial-composition", () => {
const { presentViewerLoadStatus } = __dep0;
const test = __dep1.default;
const assert = __dep2.default;
const { readFileSync } = __dep3;
const { runInNewContext } = __dep4;
const { createViewerInitialPresentation } = __dep5;
const { createViewerPostPresentation } = __dep6;

const source = readFileSync(new URL('../../apps/viewer/js/modules/viewer-composition.js', import.meta.url), 'utf8')
  .replace(/^import [^\n]*\r?\n/gm, '').replace('export async function ', 'async function ')
  .replaceAll('import.meta.url', JSON.stringify(import.meta.url));
const tick = nextEventTurn;
const noop = () => {};
function fixture({hydration = Promise.resolve(), autoReady = true} = {}) {
  const nodes = new Map(), ports = {previewFinishes: 0,previewCancels: 0,mapUpdates:0,mapPublicationWaits:[]}, errors = [];
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, {dataset: {}, hidden: false, textContent: '', addEventListener: noop, appendChild: noop, setAttribute(name, value) { this[name] = value; }});
    return nodes.get(id);
  };
  const document = {getElementById: get, createElement: () => ({addEventListener: noop}),
    addEventListener: noop,removeEventListener: noop,visibilityState: 'visible'};
  const window = {location: {search: '?debug=1'}, dispatchEvent: noop};
  const surfaces = {isMobile: () => false, initializeWorkspaceSurfaces: noop, closeMobileSheets: noop,
    closeSurface: noop, applyLayoutMode: noop, syncOverlayState: noop, closeFileMenu: noop,
    surfaceController: {isOpen: () => false}};
  const project = {documentId: 'fixture', projectSetup: {initialMapBounds: null}};
  let revision = 0, generation = 0, opening = false, failNext = false;
  const domain = {getOpenRevision: () => revision, getGeneration: () => generation, isOpening: () => opening,
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
  const map = {finishInitialPreview: () => { ports.previewFinishes++; }, cancelInitialReveal: () => { ports.previewCancels++; }, viewState: {}, objectPresentation: {}, objectQuery: {},
    objectCatalog: {invalidateObjectPresentation: noop, pruneLayerItemVisibility: async () => {}},
    navigation: {}, capturePresentation: () => ({}), loadPhysicalResources: noop,
    loadPhysicalLandMask: async () => {}, update: async () => {ports.mapUpdates++;},
    renderer:{waitForMapPresentation:async generation=>{ports.mapPublicationWaits.push(generation);return true;}},
    prepareBuiltinProject: async () => ({}), refreshAppearance: noop};
  const context = {presentViewerLoadStatus, document, window, URL, URLSearchParams, structuredClone, console,
    createViewerPostPresentation,
    // Startup tests isolate the map; inspector lifecycle behavior has its own focused tests.
    createViewerInspectorController: () => ({syncMapSelection: noop, openAfterStartup: async () => false, dispose: noop}),
    createViewerAdjacentPrefetch: () => ({afterPresented: noop,interrupt: noop,dispose: noop}),
    CustomEvent: class {constructor(type) { this.type = type; }}, createViewerInitialPresentation,
    createPlatformPorts: () => ({}), createRuntimeContext: ({meta}) => ({meta, platform: {}}),
    createPreferencePresentation: () => ({current: {}, apply: noop}),
    createDiagnosticLog: () => ({snapshot: () => [],push: noop}),
    createTooltipController: () => ({bind: noop}), createBrowserProjectStorage: () => ({}),
    createMapOwners: () => ({workspaceSurfaces: surfaces, physicalResources: {}, territorialLabels: {},
      builtinSession: {setPresentedSourceMonth: noop, clearPreparedSourceCache: noop}}),
    createSelectController: () => ({enhanceAll: noop}),
    createNotificationPresentation: () => ({reportOperationError: error => errors.push(error)}),
    createInitialDocument: () => project,
    createDocumentSession: () => ({commandOwner: {load: async () => {}, state: () => ({})}, documentModel: {snapshot: () => project}}),
    createProjectDomain: () => domain,
    createSelectionDomain: () => ({}), createSelectionUiController: () => ({syncNow: noop}), connectMapOwner: noop,
    createViewerMap: value => { ports.map = value; return map; },
    createAppObjectSearchController: () => ({bind: noop, render: noop, completeHydration: () => hydration}),
    installTimelineControls: value => { ports.timeline = value; return noop; },
    createBuiltinMonthClock: value => {
      let month = null;
      const selectMonth = async next => {
        const result = await value.applyMonth(next, {isCurrent: () => true, commit: () => { month = next; }});
        if (result) month = next;
        return result;
      };
      const clock = {month: () => month, refresh: () => selectMonth('2026-10'), selectMonth,
        followNow: () => selectMonth('2026-10'), isAutomatic: () => true, suspend: () => () => true};
      ports.clock = clock; return clock;
    },
    createFileController: () => ({bind: noop, openProjectPicker: noop}), createBrowserFileAccess: () => ({}),
    createMapSettings: () => ({connect: noop, initializeLAYER_STYLE_TARGETS: noop}),
    createNavigationBindings: () => ({connect: noop, bindNavigationUI: noop}), createPreferencesDialog: noop,
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
  assert.equal(run.ports.previewFinishes, 1);
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
  assert.equal(run.ports.previewFinishes, 0);
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
  assert.deepEqual(run.ports.mapPublicationWaits,[1,2]);
  assert.equal(run.get('viewerStatus').dataset.ready,'true');
});

test('normal year change and later source failure never restore initial mode', async () => {
  const run = fixture(); await run.started;
  await run.ports.timeline.setMonth('2025-12');
  // This isolated fixture exercises the project replacement path. In-place
  // builtin cursor navigation is covered by the clock and temporal suites.
  assert.equal(run.get('viewerStatus').dataset.loadingKind, 'project');
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
  assert.equal(run.ports.previewFinishes, 1);
  assert.ok(run.ports.previewCancels>=2,'later timeline attempts cancel first-page effects without replaying them');
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
  assert.equal(run.ports.previewFinishes, 1);
  assert.equal(run.errors.length, 1);
  assert.match(run.errors[0].message, /post-search unavailable/);
});
});
contractSuite("viewer-initial-preview", () => {
const test = __dep1.default;
const assert = __dep2.default;
const { createViewerInitialPreview : createPreview } = __dep7;
class Element {
  attributes = new Map();
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  removeAttribute(key) { this.attributes.delete(key); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  hasAttribute(key) { return this.attributes.has(key); }
}
const geometry = Object.freeze({type: 'MultiPolygon', coordinates: Object.freeze([])});
const palette = {ocean: '#ffffff', defaultLand: '#cccccc'};
function frame(width = 640, height = 480, name = 'globe') {
  const seen = [];
  return {viewRevision: name, projectionRevision: 0, cssViewport: [width, height], seen,
    projectPath(value) { seen.push(value); return value.type === 'Sphere' ? `${name}-ocean` : `${name}-land`; }};
}
function fixture({load = async () => ({geometry}), active = true} = {}) {
  const element = new Element(), ocean = new Element(), land = new Element(), errors = [];
  let loads = 0, initial = active;
  element.querySelector = selector => selector === '.viewer-initial-preview-ocean' ? ocean : land;
  const preview = createPreview({element, loadLand: () => { loads++; return load(); },
    isInitial: () => initial, onError: error => errors.push(error)});
  return {preview, element, ocean, land, errors, loads: () => loads, complete: () => { initial = false; }};
}
test('preview reuses the exact land and canonical frame projection without country metadata', async () => {
  const f = fixture(), view = frame(); f.preview.render(view, palette); await f.preview.start();
  assert.equal(f.element.hasAttribute('hidden'), false);
  assert.equal(f.element.getAttribute('viewBox'), '0 0 640 480');
  assert.equal(f.ocean.getAttribute('d'), 'globe-ocean'); assert.equal(f.land.getAttribute('d'), 'globe-land');
  assert.equal(view.seen[1], geometry); assert.equal(f.land.getAttribute('fill'), palette.defaultLand);
  assert.equal(f.ocean.getAttribute('fill'), palette.ocean); assert.deepEqual(f.errors, []);
});
test('loading is shared once and does not need a frame to finish', async () => {
  const f = fixture(); await Promise.all([f.preview.start(), f.preview.start()]);
  assert.equal(f.loads(), 1); assert.equal(f.element.hasAttribute('hidden'), true);
  f.preview.render(frame(), palette); assert.equal(f.element.hasAttribute('hidden'), false);
});
test('land completion uses the latest viewport, camera path and theme', async () => {
  let resolve; const f = fixture({load: () => new Promise(done => { resolve = done; })});
  const started = f.preview.start(); await Promise.resolve();
  const first = frame(); f.preview.render(first, palette);
  const latest = frame(390, 844, 'flat-wrap'); const dark = {ocean: '#0d2837', defaultLand: '#63758a'};
  f.preview.render(latest, dark); resolve({geometry}); await started;
  assert.deepEqual(first.seen, []); assert.equal(f.land.getAttribute('d'), 'flat-wrap-land');
  assert.equal(f.element.getAttribute('viewBox'), '0 0 390 844');
  assert.equal(f.ocean.getAttribute('fill'), dark.ocean);
});
test('first map completion hides and releases the preview synchronously without a timer', async () => {
  const f = fixture(); f.preview.render(frame(), palette); await f.preview.start();
  f.complete(); f.preview.dispose();
  assert.equal(f.element.hasAttribute('hidden'), true); assert.equal(f.land.getAttribute('d'), null);
  assert.equal(f.preview.render(frame(), palette), false); await f.preview.start(); assert.equal(f.loads(), 1);
});
test('late load after dispose cannot show a preview over the accepted map', async () => {
  let resolve; const f = fixture({load: () => new Promise(done => { resolve = done; })});
  f.preview.render(frame(), palette); const started = f.preview.start(); await Promise.resolve();
  f.complete(); f.preview.dispose(); resolve({geometry}); await started;
  assert.equal(f.element.hasAttribute('hidden'), true); assert.equal(f.land.getAttribute('d'), null);
});
test('already-presented pages do not load or display an initial preview', async () => {
  const f = fixture({active: false}); await f.preview.start(); f.preview.render(frame(), palette);
  assert.equal(f.loads(), 0); assert.equal(f.element.hasAttribute('hidden'), true);
});
test('land rejection stays optional, is diagnosed and cannot stall the normal map', async () => {
  const error = new Error('preview unavailable'); const f = fixture({load: async () => { throw error; }});
  await assert.doesNotReject(f.preview.start());
  assert.deepEqual(f.errors, [error]); assert.equal(f.element.hasAttribute('hidden'), true);
  f.complete(); assert.equal(f.preview.render(frame(), palette), false);
});
test('late failure after page disposal does not report against a new map', async () => {
  let reject; const f = fixture({load: () => new Promise((_, no) => { reject = no; })});
  const started = f.preview.start(); await Promise.resolve(); f.preview.dispose();
  reject(new Error('late')); await started; assert.deepEqual(f.errors, []);
});
test('invalid preview geometry is rejected without mutating or completing the main map', async () => {
  const f = fixture({load: async () => ({geometry: {type: 'FeatureCollection', features: []}})});
  await f.preview.start(); assert.equal(f.errors.length, 1); assert.equal(f.element.hasAttribute('hidden'), true);
});
test('projection failure removes the preview and never escapes into the frame renderer', async () => {
  const f = fixture(); await f.preview.start();
  const view = frame(); view.projectPath = () => { throw new Error('bad projection'); };
  assert.doesNotThrow(() => f.preview.render(view, palette));
  assert.equal(f.errors.length, 1); assert.equal(f.element.hasAttribute('hidden'), true);
});
test('an ocean-only view can have a null land path', async () => {
  const f = fixture(); await f.preview.start(); const view = frame();
  view.projectPath = value => value.type === 'Sphere' ? 'ocean' : null;
  assert.equal(f.preview.render(view, palette), true); assert.equal(f.land.getAttribute('d'), '');
});
test('a new page instance can preview even after the previous instance was disposed', async () => {
  const old = fixture(); old.preview.dispose(); const fresh = fixture();
  fresh.preview.render(frame(), palette); await fresh.preview.start();
  assert.equal(old.element.hasAttribute('hidden'), true); assert.equal(fresh.element.hasAttribute('hidden'), false);
});

test('upload-only frames reuse coastline paths while theme-only changes recolor them', async () => {
  const f = fixture(), original = frame(); f.preview.render(original, palette); await f.preview.start();
  const upload = frame(); upload.frameId = 500;
  f.preview.render(upload, {ocean: '#0d2837', defaultLand: '#63758a'});
  assert.deepEqual(upload.seen, []); assert.equal(f.land.getAttribute('fill'), '#63758a');
  const moved = frame(640, 480, 'new-camera'); f.preview.render(moved, palette);
  assert.equal(moved.seen.length, 2); assert.equal(f.land.getAttribute('d'), 'new-camera-land');
});

test('an empty clipped path may be undefined without making preview preparation fail', async () => {
  const f = fixture(); await f.preview.start(); const view = frame();
  view.projectPath = value => value.type === 'Sphere' ? 'ocean' : undefined;
  assert.equal(f.preview.render(view, palette), true); assert.equal(f.land.getAttribute('d'), '');
  assert.deepEqual(f.errors, []);
});

test('startup globe preview fits the canonical minimum world fit without changing the map frame', async () => {
  const f = fixture();
  const view = {...frame(), projection: 'globe', globeZoom: 1, cssTranslate: [320, 240]};
  await f.preview.start();
  f.preview.render(view, palette);
  assert.equal(f.ocean.getAttribute('transform'), 'translate(320 240) scale(1.25) translate(-320 -240)');
  assert.equal(f.land.getAttribute('transform'), f.ocean.getAttribute('transform'));
  assert.equal(view.globeZoom, 1);
});

test('already zoomed globe and flat maps do not receive a second preview zoom', async () => {
  const f = fixture(); await f.preview.start();
  f.preview.render({...frame(), projection: 'globe', globeZoom: 1.25, cssTranslate: [320, 240]}, palette);
  assert.equal(f.land.getAttribute('transform'), null);
  f.preview.render({...frame(), projection: 'flat', globeZoom: 1, cssTranslate: [320, 240]}, palette);
  assert.equal(f.land.getAttribute('transform'), null);
});

test('first normal presentation reveals country/border frame before labels', async () => {
  const f = fixture(), root = {dataset: {}}, listeners = new Map();
  let resolveAnimation;
  f.element.closest = name => name === '.viewer-root' ? root : null;
  f.element.ownerDocument = {visibilityState: 'visible',
    defaultView: {matchMedia: () => ({matches: false})},
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: name => listeners.delete(name)};
  f.element.animate = () => ({cancel: () => {}, finished: new Promise(resolve => {resolveAnimation = resolve;})});
  f.preview.render(frame(), palette); await f.preview.start(); f.complete();
  assert.equal(f.preview.finish(), true);
  assert.equal(root.dataset.initialReveal, 'countries');
  assert.equal(f.element.hasAttribute('hidden'), false);
  assert.equal(f.preview.render(frame(), palette), false);
  resolveAnimation(); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.element.hasAttribute('hidden'), true);
  assert.equal(root.dataset.initialReveal, 'labels');
  assert.equal(listeners.size, 0);
});

test('navigation or imported file cancels an in-flight first-page reveal', async () => {
  const f = fixture(), root = {dataset: {}}, listeners = new Map();
  let resolveAnimation, cancels = 0;
  f.element.closest = () => root;
  f.element.ownerDocument = {visibilityState: 'visible',
    defaultView: {matchMedia: () => ({matches: false})},
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: name => listeners.delete(name)};
  f.element.animate = () => ({cancel: () => {cancels++;}, finished: new Promise(resolve => {resolveAnimation = resolve;})});
  f.preview.render(frame(), palette); await f.preview.start(); f.complete();
  assert.equal(f.preview.finish(), true);
  f.preview.dispose(); root.dataset.initialReveal = 'complete';
  resolveAnimation(); await Promise.resolve(); await Promise.resolve();
  assert.equal(root.dataset.initialReveal, 'complete');
  assert.equal(f.element.hasAttribute('hidden'), true);
  assert.equal(cancels, 1); assert.equal(listeners.size, 0);
});

test('hidden tab aborts animation, reduced motion and absent preview never delay readiness', async () => {
  const f = fixture(), root = {dataset: {}}, listeners = new Map();
  let resolveAnimation;
  const doc = {visibilityState: 'visible',defaultView: {matchMedia: () => ({matches: false})},
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: name => listeners.delete(name)};
  f.element.closest = () => root; f.element.ownerDocument = doc;
  f.element.animate = () => ({cancel: () => {},finished: new Promise(resolve => {resolveAnimation = resolve;})});
  f.preview.render(frame(), palette);await f.preview.start();f.complete();
  assert.equal(f.preview.finish(), true);
  doc.visibilityState = 'hidden'; listeners.get('visibilitychange')();
  resolveAnimation();await Promise.resolve();await Promise.resolve();
  assert.equal(root.dataset.initialReveal, 'complete');
  assert.equal(f.element.hasAttribute('hidden'), true);
  const reduced = fixture();reduced.element.closest = () => ({dataset: {}});
  reduced.element.ownerDocument = {visibilityState: 'visible',
    defaultView: {matchMedia: () => ({matches: true})}};
  reduced.preview.render(frame(), palette);await reduced.preview.start();reduced.complete();
  assert.equal(reduced.preview.finish(), false);
  assert.equal(reduced.element.hasAttribute('hidden'), true);
  const fast = fixture();fast.complete();
  assert.equal(fast.preview.finish(), false);
});

test('optional animation API failure does not change Core/map readiness', async () => {
  const f = fixture(), root = {dataset: {}};
  f.element.closest = () => root;
  f.element.ownerDocument = {visibilityState: 'visible',
    defaultView: {matchMedia: () => ({matches: false})},
    addEventListener: () => {},removeEventListener: () => {}};
  f.element.animate = () => {throw new Error('animation unavailable');};
  f.preview.render(frame(), palette);await f.preview.start();f.complete();
  assert.equal(f.preview.finish(), false);
  assert.equal(f.element.hasAttribute('hidden'), true);
  assert.equal(root.dataset.initialReveal, 'complete');
  assert.equal(f.errors.length, 1);
});
});
