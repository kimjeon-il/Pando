import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareGpuBaseScene } from '../../assets/js/modules/gpu-scene-preparation.js';
import { drawGpuBaseScene } from '../../assets/js/modules/gpu-base-scene-pass.js';
import '../../assets/js/workers/canvas-scene-composition-core.js';
import { createGpuScene } from '../../assets/js/modules/app-gpu-scene.js';
import { createObjectPicking } from '../../assets/js/modules/app-object-picking.js';
import { normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';
import { layerObjectRank, OVERLAY_GROUPS } from '../../assets/js/modules/layer-presentation.js';

for (const style of ['political', 'physical']) {
    test(`${style} prepares the common land mask before its terrain passes`, () => {
      const events = [], state = { stencil: false, color: true, func: null, mask: null };
      const gl = new Proxy({
        enable: key => { if (key === 'STENCIL_TEST') state.stencil = true; },
        disable: key => { if (key === 'STENCIL_TEST') state.stencil = false; },
        colorMask: enabled => { state.color = enabled; },
        stencilFunc: func => { state.func = func; },
        stencilMask: mask => { state.mask = mask; },
      }, { get: (target, key) => target[key] ?? (/^[A-Z_]+$/.test(key) ? key : () => {}) });
      const range = { ranges: [{ first: 0, count: 3 }] };
      const polygonOverlayPass = { hasResource: () => true,
        drawPackets(packets, _frame, options) {
          if (!state.color && options.claimTransparent) {
            events.push({ kind: 'mask-general', key: packets[0].key, ...state });
          }
          return { renderedKeys: packets.map(packet => packet.key), missingKeys: [] };
        } };
      drawGpuBaseScene({ gl, frame: {}, width: 10, height: 10, terrainVisible: true,
        terrainStyle: style, countriesVisible: false,
        countries: { mesh: { triangleIndices: { length: 3 } }, overrideMesh: { triangleIndices: { length: 3 } },
          landMaskProgram: 'land-mask' },
        prepared: { baseTriangleDraw: range, baseBoundaryDraw: range, overrideTriangleDraw: range, overrideBoundaryDraw: range,
          deferredOverlayKeys: new Set(), failedOverlayKeys: new Set(),
          territoryItems: [{ kind: 'polygon', packet: { key: 'general', role: 'territorial-fill' } }],
          independentItems: [{ kind: 'polygon', packet: { key: 'regional', role: 'regional-overlay' } }] },
      }, { polygonOverlayPass, strokeRenderer: {},
        drawProgram: program => { if (program === 'land-mask') events.push({ kind: 'mask-country', ...state }); },
        renderTerrain: pass => events.push({ kind: pass, ...state }),
        drawHydro() {}, drawCountryBoundaryStrokes: () => ({ succeeded: true }) });
      assert.deepEqual(events.map(event => event.kind),
        ['mask-country', 'mask-country', 'mask-general', ...(style === 'physical' ? ['ocean'] : []), 'land']);
      for (const event of events.slice(0, 3)) {
        assert.equal(event.stencil, true);
        assert.equal(event.color, false);
        assert.equal(event.func, 'ALWAYS');
      }
      assert.equal(events[2].key, 'general', 'independent regions must not add land to the mask');
      for (const event of events.slice(3)) {
        assert.equal(event.stencil, true);
        assert.equal(event.color, true);
        assert.equal(event.func, event.kind === 'ocean' ? 'NOTEQUAL' : 'EQUAL');
        assert.equal(event.mask, 0);
      }
      assert.equal(state.stencil, false);
      assert.equal(state.mask, 0xff);
    });
}

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
