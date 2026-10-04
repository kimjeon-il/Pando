import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareGpuBaseScene } from '../../assets/js/modules/gpu-scene-preparation.js';
import { drawGpuBaseScene } from '../../assets/js/modules/gpu-base-scene-pass.js';
import '../../assets/js/workers/canvas-scene-composition-core.js';
import { createGpuScene } from '../../assets/js/modules/app-gpu-scene.js';
import { createObjectPicking } from '../../assets/js/modules/app-object-picking.js';
import { normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';
import { layerObjectRank, OVERLAY_GROUPS } from '../../assets/js/modules/layer-presentation.js';

test('WebGL mixes overlays by order and protects base water and borders from fills', () => {
  const events = [], state = { stencil: false, color: true };
  const gl = new Proxy({ STENCIL_TEST: 'stencil', enable: key => { if (key === 'stencil') state.stencil = true; },
    disable: key => { if (key === 'stencil') state.stencil = false; }, colorMask: enabled => { state.color = enabled; } },
  { get: (target, key) => target[key] ?? (() => {}) });
  const record = (packets, kind) => { for (const packet of packets) events.push({ key: packet.key, kind, ...state });
    return { renderedKeys: packets.map(packet => packet.key), missingKeys: [] }; };
  const polygonOverlayPass = { hasResource: () => true, hasPreparedResource: () => true,
    drawPackets: packets => record(packets, 'fill') };
  const strokeRenderer = { hasResource: () => true, hasPreparedResource: () => true,
    drawBatches: packets => record(packets, 'stroke') };
  const scene = { polygons: [{ key: 'upper-fill', order: 200 }], strokes: [{ key: 'lower-line', order: 100 }] };
  const prepared = prepareGpuBaseScene({ scene, frame: {} }, { polygonOverlayPass, strokeRenderer });
  drawGpuBaseScene({ gl, frame: {}, countriesVisible: false, terrainVisible: false, countries: {}, prepared },
    { renderTerrain() {}, drawHydro: kind => events.push({ key: kind, ...state }),
      drawCountryBoundaryStrokes: () => events.push({ key: 'base-borders', ...state }), polygonOverlayPass, strokeRenderer });
  assert.deepEqual(events.filter(event => ['upper-fill', 'lower-line'].includes(event.key)).map(event => event.key), ['lower-line', 'upper-fill']);
  assert.equal(events.find(event => event.key === 'upper-fill').stencil, true);
  assert.equal(events.find(event => event.key === 'lower-line').stencil, false);
  assert.ok(events.some(event => event.key === 'base-borders' && !event.color));
  assert.ok(events.findIndex(event => event.key === 'lake' && event.color) < events.findIndex(event => event.key === 'lower-line'));
});

test('changing overlay order keeps the frontmost stroke or fill aligned with canonical picking', async t => {
  const node = () => ({ dataset: {}, classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, append() {}, replaceChildren() {}, getBoundingClientRect: () => null });
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: node };
  t.after(() => { if (previousDocument) globalThis.document = previousDocument; else delete globalThis.document; });
  const selected = [], session = { objectChooserCandidates: [] }, elements = { objectChooser: node(), objectChooserList: node(), map: node() };
  const region = { id: 'R', properties: { entityKind: 'regional' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]] } };
  const line = { id: 'G', geometry: { type: 'LineString', coordinates: [[0, 5], [10, 5]] } };
  const state = { tool: 'select', territorialEntities: [region], genericFeatures: [line], layerVisibility: { genericFeatures: true },
    layerPresentation: { overlayOrder: ['genericFeatures', 'regions'] } };
  const records = [{ domain: 'territorial', id: 'R' }, { domain: 'generic', id: 'G' }];
  const ports = { projectState: { state }, selectionServices: { normalizeObjectRef }, renderScene: { OVERLAY_GROUPS },
    applicationServicesB: { layerObjectRank }, territorialModel: { entityRepository: { get: id => id === 'R' ? region : null, ancestors: () => [] } },
    objectLookup: { objectRefExists: () => true }, layerPresentation: { isLayerItemVisible: () => true },
    surfaces: { isMobile: () => false }, rendering: { selectionPerformanceMetrics: {} },
    spatialRecords: { geometryBoundsCache: new WeakMap(), indexedMapObjectCandidates: () => records },
    cutGeometry: { coordinateBounds: () => [0, 0, 10, 10] }, labelPresentation: { currentMapZoom: () => 100 },
    mapView: { activeProjection: () => point => point, screenToGeo: point => point }, landRelations: { pointInCountryFeature: () => true },
    platform: { $: id => elements[id], clamp: (value, min, max) => Math.max(min, Math.min(max, value)) },
    projectSession: session, mapLayout: { viewRevision: 1 }, renderServices: { selectionPerformanceCounterSnapshot: () => ({}) },
    surfaceCommands: { replaceObjectChooserCandidates: refs => { session.objectChooserCandidates = refs; } },
    domains: { selectionDomain: { has: () => false }, selectionUiController: { applyIntent: ref => selected.push(ref.key) } },
    objectOperationsA: { objectDisplayInfo: ref => ({ name: ref.id }) } };
  const scene = createGpuScene(), picking = createObjectPicking(); scene.connect(ports); picking.connect(ports);
  for (const order of [['genericFeatures', 'regions'], ['regions', 'genericFeatures']]) {
    state.layerPresentation.overlayOrder = order;
    const packets = [
      { key: 'territorial:entity:R', order: scene.gpuSceneOrder('regions') },
      { key: 'generic:feature:G', order: scene.gpuSceneOrder('genericFeatures') },
    ];
    const front = packets.sort((a, b) => b.order - a.order)[0].key;
    await picking.handleObjectSelectionAt([5, 5], { sourceEvent: {} });
    assert.equal(session.objectChooserCandidates[0].key, front);
    picking.chooseObjectCandidate(0);
    assert.equal(selected.at(-1), front);
  }
});

test('Canvas consumes line and fill packets in the same overlay order', () => {
  const events = [];
  const context = { save() {}, restore() {}, beginPath() {}, setLineDash() {}, stroke: () => events.push('line'), fill: () => events.push('fill') };
  const polygon = { key: 'upper-fill', order: 200, ringCoordinates: new Float64Array([0, 0, 0, 1, 1, 1, 0, 0]),
    ringOffsets: new Uint32Array([0, 4]), polygonOffsets: new Uint32Array([0, 1]), style: { color: '#ffffff', fillAlpha: 1 } };
  const stroke = { key: 'lower-line', order: 100, startsEnds: new Float32Array([0, 0, 1, 1]), style: { color: '#000000', width: 1, alpha: 1 } };
  globalThis.PandoLabCanvasSceneComposition.drawOverlays(context, () => {}, [polygon], [stroke], 1);
  assert.deepEqual(events, ['line', 'fill']);
});
