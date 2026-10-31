import {presentViewerLoadStatus} from '../../apps/viewer/js/modules/viewer-load-status.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createViewerInitialPresentation} from '../../apps/viewer/js/modules/viewer-initial-presentation.js';
import {createViewerPostPresentation} from '../../apps/viewer/js/modules/viewer-post-presentation.js';

const source = readFileSync(new URL('../../apps/viewer/js/modules/viewer-composition.js', import.meta.url), 'utf8')
  .replace(/^import .*\n/gm, '').replace('export async function ', 'async function ')
  .replaceAll('import.meta.url', JSON.stringify(import.meta.url));
const tick = () => new Promise(resolve => setImmediate(resolve));
const noop = () => {};
function fixture({hydration = Promise.resolve(), autoReady = true} = {}) {
  const nodes = new Map(), ports = {previewFinishes: 0}, errors = [];
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, {dataset: {}, hidden: false, textContent: '', addEventListener: noop, appendChild: noop, setAttribute(name, value) { this[name] = value; }});
    return nodes.get(id);
  };
  const document = {getElementById: get, createElement: () => ({addEventListener: noop})};
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
        if (autoReady) ports.map.onMapPreparationStatus({status: 'ready', label: '준비됨'}, generation);
        if (options?.presentation === 'temporal') options.onPresented();
        return true;
      } finally { opening = false; }
    },
  };
  const map = {finishInitialPreview: () => { ports.previewFinishes++; }, viewState: {}, objectPresentation: {}, objectQuery: {},
    objectCatalog: {invalidateObjectPresentation: noop, pruneLayerItemVisibility: async () => {}},
    navigation: {}, capturePresentation: () => ({}), loadPhysicalResources: noop,
    loadPhysicalLandMask: async () => {}, update: async () => {},
    prepareBuiltinProject: async () => ({}), refreshAppearance: noop};
  const context = {presentViewerLoadStatus, document, window, URL, URLSearchParams, structuredClone, console,
    createViewerPostPresentation,
    CustomEvent: class {constructor(type) { this.type = type; }}, createViewerInitialPresentation,
    createRuntimeContext: ({meta}) => ({meta, platform: {}}),
    createPreferencePresentation: () => ({current: {}, apply: noop}),
    createDiagnosticLog: () => ({snapshot: () => []}),
    createTooltipController: () => ({bind: noop}), createBrowserProjectStorage: () => ({}),
    createMapOwners: () => ({workspaceSurfaces: surfaces, physicalResources: {}, territorialLabels: {}}),
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
    publish: status => ports.map.onMapPreparationStatus({status, label: status}, generation),
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

test('normal year change and later source failure never restore initial mode', async () => {
  const run = fixture(); await run.started;
  await run.ports.timeline.setMonth('2025-12');
  assert.equal(run.get('viewerStatus').dataset.loadingKind, 'temporal');
  assert.equal(run.get('viewerStatus').className, 'ui-visually-hidden');
  run.failNext();
  await assert.rejects(run.ports.timeline.setMonth('2024-12'), /source unavailable/);
  assert.equal(run.debug().initialMapPresented(), true);
  assert.equal(run.get('viewer').dataset.initialLoading, 'false');
  await run.ports.lifecycle.startup(); // Same entry used by lifecycle recovery.
  assert.equal(run.debug().initialMapPresented(), true);
  assert.equal(run.ports.previewFinishes, 1);
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
