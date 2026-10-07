import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import vm from 'node:vm';
import { createObjectPicking } from '../../assets/js/modules/app-object-picking.js';
import { createSelectionDomain } from '../../assets/js/modules/selection-domain.js';
import { createSelectionUiController } from '../../assets/js/modules/selection-ui-controller.js';
import { normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';
import { editorNode } from './helpers/editor-dom-fixture.mjs';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const countryLabels = () => {
  const rendering = read('assets/js/modules/rendering-domain.js');
  return rendering.slice(rendering.indexOf('const renderTerritorialLabels ='), rendering.indexOf('enter.append(\'image\')', rendering.indexOf('const renderTerritorialLabels =')));
};

function fixture(t, { ground = ['B'], coord = [5, 5], mobile = false } = {}) {
  const oldDocument = globalThis.document, oldFrame = globalThis.requestAnimationFrame;
  globalThis.document = { createElement: editorNode };
  globalThis.requestAnimationFrame = () => 0;
  t.after(() => { globalThis.document = oldDocument; globalThis.requestAnimationFrame = oldFrame; });
  const features = new Map(['A', 'B'].map(id => [id, { id, properties: { name: id, entityKind: 'general', parentId: id === 'A' ? 'B' : '' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]] } }]));
  const state = { tool: 'select', layerVisibility: { countries: true, subunits: true }, layerPresentation: { overlayOrder: [] } };
  const domain = createSelectionDomain(), opened = [], coords = [], chooserCandidates = [];
  const ui = createSelectionUiController({ selectionDomain: domain, resolveRef: normalizeObjectRef,
    uiActions: { openEditor: ref => opened.push(ref.id), focusObject: () => assert.fail('label selection must not focus the camera') } });
  const event = { stopPropagation() { event.stopped = true; } };
  const nodes = new Map(['objectChooser', 'objectChooserList', 'map'].map(id => [id, editorNode()]));
  const picking = createObjectPicking();
  picking.connect({
    projectState: { state }, territorialModel: { entityRepository: { get: id => features.get(id), ancestors: () => [] } },
    countries: { builtinTerritorialScene: () => ({ labelRefs: new Map([['label-A', normalizeObjectRef({ domain: 'territorial', type: 'entity', id: 'A' })]]) }) },
    domains: { selectionDomain: domain, selectionUiController: ui, projectDomain: { getGeneration: () => 1 } },
    selectionServices: { normalizeObjectRef }, objectLookup: { objectRefExists: ref => features.has(ref.id) },
    layerPresentation: { isLayerItemVisible: () => true }, surfaces: { isMobile: () => mobile },
    renderScene: { OVERLAY_GROUPS: [] }, rendering: { selectionPerformanceMetrics: {} },
    renderServices: { selectionPerformanceCounterSnapshot: () => ({}), publishSelectionPerformanceSample() {} },
    mapLayout: { viewRevision: 1 }, mapView: { screenToGeo: () => { coords.push(coord); return coord; }, activeProjection: () => point => point },
    spatialRecords: { indexedMapObjectCandidates: () => ground.map(id => ({ domain: 'territorial', id })), geometryBoundsCache: new WeakMap() },
    cutGeometry: { coordinateBounds: () => [0, 0, 10, 10] }, labelPresentation: { currentMapZoom: () => 100 },
    landRelations: { pointInCountryFeature: () => true },
    objectOperationsA: { objectDisplayInfo: ref => ({ name: ref.id, type: 'entity' }) },
    projectSession: { objectChooserCandidates: [] },
    surfaceCommands: { replaceObjectChooserCandidates: refs => { chooserCandidates.push(refs); } },
    workspaceUiA: { closeSurface() {} },
    genericEditingA: { addLabelAt: value => coords.push(['placed', value]) },
    platform: { $: id => nodes.get(id), d3: { event }, clamp: (v, a, b) => Math.max(a, Math.min(v, b)) },
  });
  let operation;
  let blocked = false;
  const labels = { mapClickBlocked: () => blocked, d3: { event, mouse: () => [5, 5] }, svg: { node: () => ({}) },
    handleMapClick: (...args) => { operation = picking.handleMapClick(...args); } };
  // Execute the production listener, not a reimplementation of its dispatch.
  const handler = countryLabels().match(/\.on\('click', (function\([^)]*\) \{[\s\S]*?\n {6}\})\);/)[1];
  const click = vm.runInNewContext(`(${handler})`, { labels });
  return { state, domain, opened, coords, event, chooserCandidates, picking, setBlocked: value => { blocked = value; },
    async activate() { operation = null; click.call({ dataset: { labelId: 'label-A' } }, { id: 'label-A' }); await operation; } };
}

for (const [name, options] of [['another territory', { ground: ['B'] }], ['empty ground', { ground: [] }], ['outside the projected globe', { coord: null }], ['overlapping parent and child', { ground: ['A', 'B'] }], ['mobile tap', { ground: ['B'], mobile: true }]]) {
  test(`a territorial label over ${name} selects its explicit identity and opens its editor once`, async t => {
    const f = fixture(t, options); await f.activate();
    assert.equal(f.domain.primary()?.id, 'A'); assert.deepEqual(f.opened, ['A']);
    assert.deepEqual(f.coords, [], 'label selection must not fall through to ground picking');
    assert.ok(f.chooserCandidates.every(refs => refs.length === 0));
    assert.equal(f.event.stopped, true);
  });
}

test('territorial label dispatch preserves click blocking, pan, modifier toggling and placement tools', async t => {
  const f = fixture(t); f.setBlocked(true); await f.activate(); assert.equal(f.domain.size(), 0);
  f.setBlocked(false); f.state.spacePanActive = true; await f.activate(); assert.equal(f.domain.size(), 0);
  f.state.spacePanActive = false; await f.activate();
  f.event.ctrlKey = true; await f.activate(); assert.equal(f.domain.size(), 0); assert.deepEqual(f.opened, ['A']);
  f.event.ctrlKey = false; f.state.labelPlacementMode = true; await f.activate();
  assert.deepEqual(f.coords, [[5, 5], ['placed', [5, 5]]]); assert.equal(f.domain.size(), 0);
});

test('ground map clicks keep the common coordinate handler and label rendering does not duplicate editing tools', () => {
  assert.doesNotMatch(countryLabels(), /toggleNewCountrySource|toggleAnnexDonor|toggleMergeTarget|toggleBoundaryEditCountry/);
  assert.match(countryLabels(), /if \(labels\.mapClickBlocked\?\.\(\)\) return;/);
  assert.match(read('assets/js/modules/map-input-presentation.js'), /svg\.on\('click', function\(\)\s*\{\s*if \(mapClickBlocked\(\)\) return;\s*handleMapClick\(d3\.mouse\(this\)\);/);
});
