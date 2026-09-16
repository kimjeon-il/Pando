import assert from 'node:assert/strict';
import test from 'node:test';
import { createCountryLabels } from '../../assets/js/modules/app-country-labels.js';
import { createApplicationPorts, MAP_RESOURCE_OWNER_PORTS, PROJECT_IO_OWNER_PORTS } from '../../assets/js/modules/app-capability-ports.js';
import { createMapSettings } from '../../assets/js/modules/app-map-settings.js';
import { createRenderingDomain } from '../../assets/js/modules/rendering-domain.js';
import { layoutCountryFlags } from '../../assets/js/modules/country-label-flags.js';
import { automaticLabelSettings, labelKey, layoutLabels, LABEL_PRIORITIES } from '../../assets/js/modules/label-layout.js';
import { capabilityPortsForFixture } from './helpers/capability-port-fixture.mjs';

function fixture(visibility = {}) {
  const features = ['AAA', 'BBB', 'SUBUNIT', 'NOFLAG'].map(id => ({
    type: 'Feature', id, properties: { name: id, ...(id === 'SUBUNIT' ? { unitType: 'subunit' } : {}) },
    geometry: { type: 'Polygon', coordinates: [[[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]]] },
  }));
  const anchors = new Map(features.map((feature, index) => [feature.id, [100 + index * 200, 100]]));
  const hiddenIds = new Set();
  const state = {
    projection: 'globe', view: { globeZoom: 2 }, countryVisualPhase: 'canonical',
    layerVisibility: { basemapLabels: true, countryFlags: true, labels: true, subunitLabels: visibility.basemapLabels !== false, ...visibility },
    countryOverrides: {}, labelSettings: {}, size: { width: 1000, height: 600 },
    labels: [{ id: 'PLACE', kind: 'capital', name: 'Place', coordinates: [100, 300] }],
  };
  const controller = createCountryLabels();
  const providers = new Proxy({
    projectSession: { state },
    runtime: { automaticLabelSettings, labelKey, layoutLabels, layoutCountryFlags, LABEL_PRIORITIES,
      TERRITORIAL_UNIT_TYPES: { COUNTRY: 'country' },
      effectiveCountryFlagUrl: ({ countryId }) => countryId === 'NOFLAG' ? null : `/${countryId}.svg`,
    },
    countryIndex: { countryLabelAnchors: anchors, pendingCountryLabelAnchors: new Set() },
    builtinSession: { builtinRenderCountries: () => ({
      labelById: new Map(features.map(feature => [feature.id, feature])),
      labelRefs: new Map([['SUBUNIT', { domain: 'territorial', type: 'subunit', id: 'SUBUNIT' }]]),
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
    domainAssembly: { selectionDomain: { has: () => false } },
    renderQuality: { currentRenderQuality: { labelDensity: 1, tier: 'high' } },
    objectPresentation: { countryName: feature => feature.properties.name },
    workspaceSurfaces: { isMobile: () => false },
  }, { get: (target, key) => target[key] ||= {} });
  const ports = createApplicationPorts(providers);
  controller.connect(Object.freeze(Object.fromEntries(
    MAP_RESOURCE_OWNER_PORTS.countryLabels.map(portName => [portName, ports[portName]]),
  )));
  controller.initializeCountryLabelScreenAreas();
  return { controller, state, anchors, hiddenIds, features };
}

for (const names of [true, false]) for (const flags of [true, false]) for (const places of [true, false]) {
  test(`label visibility stays independent: names=${names}, flags=${flags}, places=${places}`, () => {
    const { controller } = fixture({ basemapLabels: names, countryFlags: flags, labels: places });
    const layout = controller.visibleLabelLayout();
    assert.equal(layout.countryLabels.length, names ? 4 : flags ? 2 : 0);
    assert.equal(layout.countryFlags.size, flags ? 2 : 0);
    assert.equal(layout.userLabels.length, places ? 1 : 0);
  });
}

test('flag-only layout uses flag dimensions without reserving invisible name space', () => {
  const { controller, anchors } = fixture({ basemapLabels: false, labels: false });
  anchors.set('BBB', [130, 100]);
  assert.deepEqual([...controller.visibleLabelLayout().countryFlags.keys()], ['AAA', 'BBB']);
});

test('flag-only markers keep zoom and per-object visibility rules', () => {
  const { controller, state, hiddenIds } = fixture({ basemapLabels: false });
  state.view.globeZoom = 1;
  assert.equal(controller.visibleLabelLayout().countryLabels.length, 0);
  state.view.globeZoom = 2;
  hiddenIds.add('AAA');
  assert.deepEqual(controller.visibleLabelLayout().countryLabels.map(feature => feature.id), ['BBB']);
});

test('all symbol switches schedule a fresh label layout without redrawing country geometry', t => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} },
  });
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
  });
  const { controller, state } = fixture();
  const frames = [], layouts = [];
  const rendering = createRenderingDomain({
    requestFrame: callback => { frames.push(callback); return frames.length; },
    renderers: { labelLayout: () => { const layout = controller.visibleLabelLayout(); layouts.push(layout); return layout; } },
  });
  const settings = createMapSettings();
  let baseInvalidations = 0, autosaves = 0;
  settings.connect(capabilityPortsForFixture(PROJECT_IO_OWNER_PORTS.mapSettings, {
    state, $: () => null, expandedMapDisplayGroups: new Set(), DISTRIBUTION_GROUP_TYPES: {},
    normalizeLayerPresentation: value => value, markLayerTreeDirty() {},
    renderingDomain: {
      invalidateLabels: rendering.invalidateLabels,
      invalidateBaseScene: () => { baseInvalidations += 1; },
    },
    projectDomain: { queuePresentationAutosave: () => { autosaves += 1; } },
  }));
  settings.setLayerVisibility('basemapLabels', false);
  frames.shift()();
  assert.equal(layouts.at(-1).countryFlags.size, 2);
  settings.setLayerVisibility('countryFlags', false);
  frames.shift()();
  assert.deepEqual(layouts.at(-1).countryLabels.map(feature => feature.id), ['SUBUNIT']);
  settings.setLayerVisibility('labels', false);
  frames.shift()();
  assert.equal(layouts.at(-1).userLabels.length, 0);
  settings.setLayerVisibility('basemapLabels', true);
  settings.setLayerVisibility('countryFlags', true);
  settings.setLayerVisibility('labels', true);
  assert.equal(frames.length, 1, 'successive visibility changes share a frame');
  frames.shift()();
  assert.equal(layouts.at(-1).countryLabels.length, 4);
  assert.equal(layouts.at(-1).countryFlags.size, 2);
  assert.equal(layouts.at(-1).userLabels.length, 1);
  assert.equal(baseInvalidations, 0);
  assert.equal(autosaves, 6);
  rendering.dispose();
});

for (const [id, group, nameKey, flagKey] of [
  ['AAA', 'countries', 'basemapLabels', 'countryFlags'],
  ['SUBUNIT', 'subunits', 'subunitLabels', 'subunitFlags'],
  ['BBB', 'regions', 'regionLabels', 'regionFlags'],
]) {
  test(`territorial symbols are independent for ${group}`, () => {
    const { controller, state, features } = fixture();
    features.find(feature => feature.id === 'BBB').properties.unitType = 'region';
    for (const feature of features.filter(feature => feature.properties.unitType)) {
      feature.properties.metadata = { flagDataUrl: `/${feature.id}.svg` };
    }
    state.layerVisibility[nameKey] = false;
    let layout = controller.visibleLabelLayout();
    assert.equal(layout.countryLabelNames.get(id), false);
    assert.equal(layout.countryFlags.has(id), true, 'hiding a name retains its flag');
    for (const other of ['AAA', 'SUBUNIT', 'BBB'].filter(key => key !== id)) {
      assert.equal(layout.countryLabelNames.get(other), true, 'other types retain names');
    }
    state.layerVisibility[flagKey] = false;
    layout = controller.visibleLabelLayout();
    assert.equal(layout.countryLabels.some(feature => feature.id === id), false);
    state.layerVisibility[flagKey] = true;
    state.layerVisibility[group] = false;
    layout = controller.visibleLabelLayout();
    assert.equal(layout.countryLabels.some(feature => feature.id === id), false);
    assert.equal(state.layerVisibility[flagKey], true, 'hiding a type retains its symbol preferences');
  });
}
