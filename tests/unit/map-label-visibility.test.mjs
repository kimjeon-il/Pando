import { createMapVisualFrame } from '../../assets/js/modules/map-visual-frame.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerritorialLabels } from '../../assets/js/modules/app-territorial-labels.js';
import { createApplicationPorts, MAP_RESOURCE_OWNER_PORTS, PROJECT_IO_OWNER_PORTS } from '../../assets/js/modules/app-capability-ports.js';
import { createMapSettings } from '../../assets/js/modules/app-map-settings.js';
import { createRenderingDomain } from '../../assets/js/modules/rendering-domain.js';
import { layoutTerritorialFlags } from '../../assets/js/modules/territorial-label-flags.js';
import { automaticLabelSettings, labelKey, layoutLabels, LABEL_PRIORITIES } from '../../assets/js/modules/label-layout.js';
import { capabilityPortsForFixture } from './helpers/capability-port-fixture.mjs';

function fixture(visibility = {}) {
  const features = ['AAA', 'BBB', 'SUBUNIT', 'NOFLAG'].map(id => ({
    type: 'Feature', id, properties: { name: id, entityKind: 'general', parentId: id === 'SUBUNIT' ? 'AAA' : '', metadata: ['AAA','BBB'].includes(id) ? { flagDataUrl: `/${id}.svg` } : {} },
    geometry: { type: 'Polygon', coordinates: [[[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]]] },
  }));
  const anchors = new Map(features.map((feature, index) => [feature.id, [100 + index * 200, 100]]));
  const hiddenIds = new Set();
  const state = {
    projection: 'globe', view: { globeZoom: 2 }, countryVisualPhase: 'canonical',
    layerVisibility: { basemapLabels: true, countryFlags: true, labels: true, subunitLabels: visibility.basemapLabels !== false, ...visibility },
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
    layerList: { isLayerItemVisible: (_group, id) => !hiddenIds.has(id) },
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
    environment: { runtimeAssetUrl: path => new URL(path, 'http://localhost/assets/js/') },
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
  return { controller: framedController, state, anchors, hiddenIds, features, layoutFrame };
}

for (const names of [true, false]) for (const flags of [true, false]) for (const places of [true, false]) {
  test(`label visibility stays independent: names=${names}, flags=${flags}, places=${places}`, () => {
    const { controller } = fixture({ basemapLabels: names, countryFlags: flags, labels: places });
    const layout = controller.visibleLabelLayout();
    assert.equal(layout.territorialLabels.length, names ? 4 : flags ? 2 : 0);
    assert.equal(layout.territorialFlags.size, flags ? 2 : 0);
    assert.equal(layout.userLabels.length, places ? 1 : 0);
  });
}

test('flag-only layout uses flag dimensions without reserving invisible name space', () => {
  const { controller, anchors } = fixture({ basemapLabels: false, labels: false });
  anchors.set('BBB', [130, 100]);
  assert.deepEqual([...controller.visibleLabelLayout().territorialFlags.keys()], ['AAA', 'BBB']);
});

test('flag-only markers keep zoom and per-object visibility rules', () => {
  const { controller, state, hiddenIds } = fixture({ basemapLabels: false });
  state.view.globeZoom = 1;
  assert.equal(controller.visibleLabelLayout().territorialLabels.length, 0);
  state.view.globeZoom = 2;
  hiddenIds.add('AAA');
  assert.deepEqual(controller.visibleLabelLayout().territorialLabels.map(feature => feature.id), ['BBB']);
});

test('symbol and hierarchy visibility switches refresh labels while retaining independent preferences', t => {
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
  const frames = [], layouts = [];
  const rendering = createRenderingDomain({
    prepareView: layoutFrame,
    requestFrame: callback => { frames.push(callback); return frames.length; },
    renderers: { labelLayout: () => { const layout = controller.visibleLabelLayout(); layouts.push(layout); return layout; } },
  });
  const settings = createMapSettings();
  let baseInvalidations = 0, autosaves = 0;
  settings.connect(capabilityPortsForFixture(PROJECT_IO_OWNER_PORTS.mapSettings, {
    state, $: () => null, expandedMapDisplayGroups: new Set(), DISTRIBUTION_GROUP_TYPES: {},
    normalizeLayerPresentation: value => value, markLayerTreeDirty() {},
    gpuMapRenderer: { invalidateCountryPalette() {} },
    renderingDomain: {
      invalidateLabels: rendering.invalidateLabels,
      invalidateBaseScene: () => { baseInvalidations += 1; },
    },
    projectDomain: { queuePresentationAutosave: () => { autosaves += 1; } },
  }));
  settings.setLayerVisibility('basemapLabels', false);
  frames.shift()();
  assert.equal(layouts.at(-1).territorialFlags.size, 2);
  settings.setLayerVisibility('countryFlags', false);
  frames.shift()();
  assert.deepEqual(layouts.at(-1).territorialLabels.map(feature => feature.id), ['SUBUNIT']);
  settings.setLayerVisibility('labels', false);
  frames.shift()();
  assert.equal(layouts.at(-1).userLabels.length, 0);
  settings.setLayerVisibility('basemapLabels', true);
  settings.setLayerVisibility('countryFlags', true);
  settings.setLayerVisibility('labels', true);
  assert.equal(frames.length, 1, 'successive visibility changes share a frame');
  frames.shift()();
  assert.equal(layouts.at(-1).territorialLabels.length, 4);
  assert.equal(layouts.at(-1).territorialFlags.size, 2);
  assert.equal(layouts.at(-1).userLabels.length, 1);
  assert.equal(baseInvalidations, 0);
  assert.equal(autosaves, 6);
  settings.setLayerVisibility('countries', false);
  frames.shift()();
  assert.deepEqual(layouts.at(-1).territorialLabels.map(feature => feature.id), ['SUBUNIT']);
  assert.equal(state.layerVisibility.countryFlags, true);
  settings.setLayerVisibility('subunits', false);
  frames.shift()();
  assert.equal(layouts.at(-1).territorialLabels.length, 0);
  settings.setLayerVisibility('countries', true);
  frames.shift()();
  assert.deepEqual(layouts.at(-1).territorialLabels.map(feature => feature.id), ['AAA', 'BBB', 'NOFLAG']);
  assert.equal(state.layerVisibility.subunits, false);
  settings.setLayerVisibility('subunits', true);
  frames.shift()();
  assert.equal(layouts.at(-1).territorialLabels.length, 4);
  assert.equal(baseInvalidations, 4);
  assert.equal(autosaves, 10);
  rendering.dispose();
});

for (const [id, group, nameKey, flagKey] of [
  ['AAA', 'countries', 'basemapLabels', 'countryFlags'],
  ['SUBUNIT', 'subunits', 'subunitLabels', 'subunitFlags'],
  ['BBB', 'regions', 'regionLabels', 'regionFlags'],
]) {
  test(`territorial symbols are independent for ${group}`, () => {
    const { controller, state, features } = fixture();
    features.find(feature => feature.id === 'BBB').properties.entityKind = 'regional';
    for (const feature of features.filter(feature => feature.properties.entityKind)) {
      feature.properties.metadata = { flagDataUrl: `/${feature.id}.svg` };
    }
    state.layerVisibility[nameKey] = false;
    let layout = controller.visibleLabelLayout();
    assert.equal(layout.territorialLabelNames.get(id), false);
    assert.equal(layout.territorialFlags.has(id), true, 'hiding a name retains its flag');
    for (const other of ['AAA', 'SUBUNIT', 'BBB'].filter(key => key !== id)) {
      assert.equal(layout.territorialLabelNames.get(other), true, 'other types retain names');
    }
    state.layerVisibility[flagKey] = false;
    layout = controller.visibleLabelLayout();
    assert.equal(layout.territorialLabels.some(feature => feature.id === id), false);
    state.layerVisibility[flagKey] = true;
    state.layerVisibility[group] = false;
    layout = controller.visibleLabelLayout();
    assert.equal(layout.territorialLabels.some(feature => feature.id === id), false);
    assert.equal(state.layerVisibility[flagKey], true, 'hiding a type retains its symbol preferences');
  });
}
