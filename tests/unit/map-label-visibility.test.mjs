import { resourceCapabilities } from "../../shared/frontend/js/modules/resource-capabilities.js";
import { createMapVisualFrame } from "../../shared/frontend/js/modules/map-visual-frame.js";
import { defaultUserPreferences, normalizeUserPreferences } from "../../shared/frontend/js/modules/user-preferences.js";
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import {createTestViewingSession} from '../helpers/viewing-project.mjs';
import { createTerritorialLabels } from "../../shared/frontend/js/modules/territorial-labels.js";
import { createApplicationPorts, MAP_RESOURCE_OWNER_PORTS, PROJECT_IO_OWNER_PORTS } from "../../apps/editor/frontend/js/modules/app-capability-ports.js";
import { createMapSettings } from "../../shared/frontend/js/modules/app-map-settings.js";
import { createRenderingDomain } from "../../shared/frontend/js/modules/rendering-domain.js";
import { layoutTerritorialFlags } from "../../shared/frontend/js/modules/territorial-label-flags.js";
import { automaticLabelSettings, labelKey, layoutLabels, LABEL_PRIORITIES } from "../../shared/frontend/js/modules/label-layout.js";
import { capabilityPortsForFixture } from './helpers/capability-port-fixture.mjs';

function fixture(visibility = {}) {
  const features = ['AAA', 'BBB', 'SUBUNIT', 'NOFLAG'].map(id => ({
    type: 'Feature', id, properties: { name: id, entityKind: 'general', parentId: id === 'SUBUNIT' ? 'AAA' : '', metadata: ['AAA','BBB'].includes(id) ? { flagDataUrl: `/${id}.svg` } : {} },
    geometry: { type: 'Polygon', coordinates: [[[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]]] },
  }));
  const anchors = new Map(features.map((feature, index) => [feature.id, [100 + index * 200, 100]]));
  const hiddenIds = new Set();
  const state = {
    backgroundSettings:{}, projection: 'globe', view: { globeZoom: 2 }, countryVisualPhase: 'canonical',
    layerVisibility: { objects: true, objectNames: true, objectFlags: true, labels: true, ...visibility },
    territorialEntities: features, labelSettings: {}, size: { width: 1000, height: 600 },
    labels: [{ id: 'PLACE', kind: 'capital', name: 'Place', coordinates: [100, 300] }],
  };
  const controller = createTerritorialLabels();
  const providers = new Proxy({
    projectSession: { state },
    runtime: { automaticLabelSettings, labelKey, layoutLabels, layoutTerritorialFlags, LABEL_PRIORITIES,
      },
    countryIndex: { countryLabelAnchors: anchors, pendingCountryLabelAnchors: new Set() },
    builtinSession: { builtinTerritorialScene: () => ({
      labelById: new Map(features.map(feature => [feature.id, feature])),
      labelRefs: new Map(features.map(f => [f.id, { domain: 'territorial', type: 'entity', id: f.id }])),
    }) },
    objectCatalog: { isLayerItemVisible: (_group, id) => !hiddenIds.has(id) },
    spatialIndex: {
      visibleMapObjectCandidates: () => state.labels.filter(label => !hiddenIds.has(label.id)),
      geometryBounds: () => [-10, -10, 10, 10],
      viewportCullingMetrics: { lastByDomain: { label: {} } },
    },
    mapProjection: {
      projectVisibleCoordinate: coordinate => coordinate,
      activeProjection: () => ({ scale: () => 1000 }),
    },
    domainAssembly: {
      territorialEntityRepository: { get: id => features.find(f => f.id === id) },
      territorialScope: { displayFeature: id => features.find(f => f.id === id) },
      selectionDomain: { has: () => false, snapshot: () => ({ selection: { items: [], primaryKey: null } }) },
    },
    environment: { runtimeAssetUrl: path => new URL(path, 'http://localhost/assets/js/'), userPreferences: defaultUserPreferences() },
    renderQuality: { currentRenderQuality: { labelDensity: 1, tier: 'high' } },
    objectPresentation: { territorialScope: { displayFeature: id => features.find(f => f.id === id) }, territorialEntityName: feature => feature.properties.name },
    workspaceSurfaces: { isMobile: () => false },
  }, { get: (target, key) => target[key] ||= {} });
  const ports = createApplicationPorts(providers);
  controller.connect(Object.freeze(Object.fromEntries(
    MAP_RESOURCE_OWNER_PORTS.territorialLabels.map(portName => [portName, ports[portName]]),
  )));
  const layoutFrame = () => Object.freeze({ ...createMapVisualFrame({ frameId: 1,
    viewState: { projection: state.projection, size: state.size, scale: 1000, zoom: state.view.globeZoom, dpr: 1 } }),
    projectVisibleCoordinate: coordinate => coordinate });
  const visibleLabelLayout = controller.visibleLabelLayout;
  // Screen-space fixture projector is explicit in its frame, never a live map port.
  const framedController = new Proxy(controller, { get: (owner, key) => key === 'visibleLabelLayout'
    ? () => visibleLabelLayout(layoutFrame()) : owner[key] });
  controller.initializeTerritorialLabelScreenAreas();
  controller.initializeLabelLayoutMetrics();
  return { controller: framedController, state, anchors, hiddenIds, features, layoutFrame, quality: providers.renderQuality };
}

test('place visibility survives quality changes and zoom round trips in a crowded territorial view', () => {
  const { controller, state, anchors, features, quality } = fixture();
  state.labels[0].kind = 'city';
  for (let index = 0; index < 85; index++) {
    const id = `COUNTRY${index}`;
    features.push({ ...features[0], id, properties: { ...features[0].properties, name: `C${index}` } });
    anchors.set(id, [100 + index % 14 * 55, 100 + Math.floor(index / 14) * 65]);
  }
  for (const [zoom, tier, labelDensity] of [
    [2, 'high', 1], [2, 'medium', 0.76], [2.2, 'coarse', 0.52], [2, 'coarse', 0.52],
  ]) {
    state.view.globeZoom = zoom;
    quality.currentRenderQuality = { tier, labelDensity };
    assert.deepEqual(controller.visibleLabelLayout().userLabels.map(label => label.id), ['PLACE'], `${tier} at zoom ${zoom}`);
    assert.equal(controller.labelLayoutMetrics.qualityCulledCount, 0);
  }
  state.view.globeZoom = 1;
  assert.equal(controller.visibleLabelLayout().userLabels.length, 0, 'the city minimum zoom still applies');
  state.view.globeZoom = 2;
  assert.deepEqual(controller.visibleLabelLayout().userLabels.map(label => label.id), ['PLACE']);
});

for (const names of [true, false]) for (const flags of [true, false]) for (const places of [true, false]) {
  test(`label visibility stays independent: names=${names}, flags=${flags}, places=${places}`, () => {
    const { controller } = fixture({ objectNames: names, objectFlags: flags, labels: places });
    const layout = controller.visibleLabelLayout();
    assert.equal(layout.territorialLabels.length, names ? 4 : flags ? 2 : 0);
    assert.equal(layout.territorialFlags.size, flags ? 2 : 0);
    assert.equal(layout.userLabels.length, places ? 1 : 0);
  });
}

test('flag-only layout uses flag dimensions without reserving invisible name space', () => {
  const { controller, anchors } = fixture({ objectNames: false, labels: false });
  anchors.set('BBB', [130, 100]);
  assert.deepEqual([...controller.visibleLabelLayout().territorialFlags.keys()], ['AAA', 'BBB']);
});

test('flag-only markers keep zoom and per-object visibility rules', () => {
  const { controller, state, hiddenIds } = fixture({ objectNames: false });
  state.view.globeZoom = 1;
  assert.equal(controller.visibleLabelLayout().territorialLabels.length, 0);
  state.view.globeZoom = 2;
  hiddenIds.add('AAA');
  assert.deepEqual(controller.visibleLabelLayout().territorialLabels.map(feature => feature.id), ['BBB']);
});

test('symbol and hierarchy visibility switches refresh labels while retaining independent preferences', async t => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} },
  });
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
  });
  const { controller, state, layoutFrame } = fixture();
  const seed = JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json', import.meta.url), 'utf8'));
  const core = await createNodeCoreProject(seed);
  t.after(() => core.dispose());
  const viewing=createTestViewingSession(core);t.after(viewing.dispose);
  Object.defineProperty(state,'layerVisibility',{get:()=>viewing.session.state.layerVisibility});
  Object.defineProperty(state, 'layerPresentation', { get: () => core.documentModel.snapshot().layerPresentation });
  const frames = [], layouts = [];
  const rendering = createRenderingDomain({
    prepareView: layoutFrame,
    requestFrame: callback => { frames.push(callback); return frames.length; },
    renderers: { labelLayout: () => { const layout = controller.visibleLabelLayout(); layouts.push(layout); return layout; } },
  });
  let baseInvalidations = 0, workspaceUpdates = 0;
  const settings = createMapSettings({capabilities:resourceCapabilities('editor'),viewPresentation:{applyPresentation:payload=>{workspaceUpdates++;return viewing.session.applyViewingPresentation(payload);}}});
  settings.connect(capabilityPortsForFixture(PROJECT_IO_OWNER_PORTS.mapSettings, {
    loadHydroData:async()=>{},preparePlaces:async()=>{},
    state, $: () => null, expandedMapDisplayGroups: new Set(), DISTRIBUTION_GROUP_TYPES: {},
    reportOperationError: error => assert.fail(error.stack),
    userPreferences: defaultUserPreferences(), saveUserPreferences: next => normalizeUserPreferences(next), setUserPreferences() {},
    normalizeLayerPresentation: value => value, invalidateObjectPresentation() {},
    gpuMapRenderer: { invalidateCountryPalette() {} },
    renderingDomain: {
      invalidateLabels: rendering.invalidateLabels,
      invalidateBaseScene: () => { baseInvalidations += 1; },
    },
    projectDomain: { queueViewAutosave(){},getGeneration: core.project.getGeneration,executeCommand:()=>assert.fail('visibility must use the shared viewing owner') },
  }));
  await settings.setLayerVisibility('objectNames', false);
  frames.shift()();
  assert.equal(layouts.at(-1).territorialFlags.size, 2);
  await settings.setLayerVisibility('objectFlags', false);
  frames.shift()();
  assert.deepEqual(layouts.at(-1).territorialLabels.map(feature => feature.id), []);
  await settings.setLayerVisibility('labels', false);
  frames.shift()();
  assert.equal(layouts.at(-1).userLabels.length, 0);
  await settings.setLayerVisibility('objectNames', true);
  await settings.setLayerVisibility('objectFlags', true);
  await settings.setLayerVisibility('labels', true);
  assert.equal(frames.length, 1, 'successive visibility changes share a frame');
  frames.shift()();
  assert.equal(layouts.at(-1).territorialLabels.length, 4);
  assert.equal(layouts.at(-1).territorialFlags.size, 2);
  assert.equal(layouts.at(-1).userLabels.length, 1);
  assert.equal(baseInvalidations, 0);
  assert.equal(workspaceUpdates, 6);
  await settings.setLayerVisibility('objects', false);
  frames.shift()();
  assert.equal(layouts.at(-1).territorialLabels.length, 0);
  assert.equal(state.layerVisibility.objectFlags, true);
  await settings.setLayerVisibility('objects', true);
  frames.shift()();
  assert.equal(layouts.at(-1).territorialLabels.length, 4);
  assert.equal(baseInvalidations, 2);
  assert.equal(workspaceUpdates, 8);
  assert.equal(core.client.state().dirty,false);
  rendering.dispose();
});

test('all territorial kinds share symbol switches without changing their stored preferences', () => {
  const {controller,state,features}=fixture();
  features.find(feature=>feature.id==='BBB').properties.entityKind='regional';
  for(const feature of features)feature.properties.metadata={flagDataUrl:`/${feature.id}.svg`};
  state.layerVisibility.objectNames=false;
  let layout=controller.visibleLabelLayout();
  for(const id of ['AAA','SUBUNIT','BBB']){
    assert.equal(layout.territorialLabelNames.get(id),false);
    assert.equal(layout.territorialFlags.has(id),true);
  }
  state.layerVisibility.objectFlags=false;
  assert.equal(controller.visibleLabelLayout().territorialLabels.length,0);
  state.layerVisibility.objectFlags=true;state.layerVisibility.objects=false;
  assert.equal(controller.visibleLabelLayout().territorialLabels.length,0);
  assert.equal(state.layerVisibility.objectFlags,true);
});

test('place language toggles persist independently and invalidate only label layout', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelectorAll: () => [] } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  const settings = createMapSettings({capabilities:resourceCapabilities('editor')});
  let current = defaultUserPreferences(), invalidations = 0, saved = 0;
  const flat = {
    reportOperationError: error => assert.fail(error.stack),
    userPreferences: current,
    saveUserPreferences: next => { saved++; return normalizeUserPreferences(next); },
    setUserPreferences: next => { current = next; flat.userPreferences = next; },
    renderingDomain: { invalidateLabels: () => { invalidations++; } },
  };
  Object.assign(flat,{loadHydroData:async()=>{},preparePlaces:async()=>{}});
  settings.connect(capabilityPortsForFixture(PROJECT_IO_OWNER_PORTS.mapSettings, flat));
  assert.equal(settings.setPlaceLanguage('en', true), true);
  assert.deepEqual(current.labels.place.languages, { ko: true, en: true, native: false });
  assert.equal(settings.setPlaceLanguage('ko', false), true);
  assert.deepEqual(current.labels.place.languages, { ko: false, en: true, native: false });
  assert.equal(settings.setPlaceLanguage('en', false), false);
  assert.equal(saved, 2);
  assert.equal(invalidations, 2);
});
