import { describe as contractSuite } from 'node:test';
import * as __render_dep0 from "node:assert/strict";
import * as __render_dep1 from "node:test";
import * as __render_dep2 from "node:fs";
import * as __render_dep3 from "../../src/rendering/gpu-scene-preparation.js";
import * as __render_dep4 from "../../src/rendering/gpu-base-scene-pass.js";
import * as __render_dep5 from "../../src/rendering/gpu-scene.js";
import * as __render_dep6 from "../../src/map/object-picking.js";
import * as __render_dep7 from "../../src/ui/object-selection-controller.js";
import * as __render_dep8 from "../../src/ui/layer-presentation.js";
import * as __render_dep9 from "../../src/rendering/gpu-polygon-overlay-pass.js";
import * as __render_dep10 from "../../src/rendering/gpu-stroke-renderer.js";
import * as __render_dep11 from "../../src/rendering/selection-pass.js";
import * as __render_dep12 from "../../src/rendering/gpu-interaction-pass.js";
import "../../src/rendering/workers/canvas-scene-composition-core.js";
import { canDrawTerrainTiles } from "../../src/rendering/map-render-publication.js";
import { canSubmitCountryIndices } from "../../src/rendering/gpu-country-ranges.js";
const assert = __render_dep0.default;
const test = __render_dep1.default;
const { readFileSync } = __render_dep2;
const { prepareGpuBaseScene } = __render_dep3;
const { drawGpuBaseScene } = __render_dep4;
const { createGpuScene } = __render_dep5;
const { createObjectPicking } = __render_dep6;
const { normalizeObjectRef } = __render_dep7;
const { layerObjectRank, OVERLAY_GROUPS } = __render_dep8;

test('empty country index ranges cannot submit a WebGL draw',()=>{
  assert.equal(canSubmitCountryIndices(0),false);
  assert.equal(canSubmitCountryIndices(30,[]),false);
  assert.equal(canSubmitCountryIndices(30,[{first:0,count:0}]),false);
  assert.equal(canSubmitCountryIndices(30,[{first:0,count:3}]),true);
  assert.equal(canSubmitCountryIndices(30,null),true);
});

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
            events.push({ kind: 'mask-physical', key: packets[0].key, ...state });
          }
          return { renderedKeys: packets.map(packet => packet.key), missingKeys: [] };
        } };
      drawGpuBaseScene({ gl, frame: {}, width: 10, height: 10, terrainVisible: true,
        surfacePresentation: { quality: 'canonical' },
        terrainStyle: style, countriesVisible: false,
        countries: { mesh: { triangleIndices: { length: 3 } }, overrideMesh: { triangleIndices: { length: 3 } },
          fillProgram: 'country-surface' },
        prepared: { baseTriangleDraw: range, baseBoundaryDraw: range, overrideTriangleDraw: range, overrideBoundaryDraw: range,
          deferredOverlayKeys: new Set(), failedOverlayKeys: new Set(),
          physicalLandItems: [{ kind: 'polygon', packet: { key: 'physical-land', role: 'physical-land' } }],
          territoryItems: [{ kind: 'polygon', packet: { key: 'general', role: 'territorial-fill' } }],
          independentItems: [{ kind: 'polygon', packet: { key: 'regional', role: 'regional-overlay' } }] },
      }, { drawOceanSubstrate() {}, polygonOverlayPass, strokeRenderer: {},
        drawProgram: (...args) => { if (args[10] && !state.color) events.push({kind:'mask-physical',key:'country-surface',...state}); },
        renderTerrain: pass => events.push({ kind: pass, ...state }),
        drawHydro() {}, drawCountryBoundaryStrokes: () => ({ succeeded: true }) });
      assert.deepEqual(events.map(event => event.kind),
        ['mask-physical', ...(style === 'physical' ? ['ocean'] : []), 'land']);
      for (const event of events.slice(0, 1)) {
        assert.equal(event.stencil, true);
        assert.equal(event.color, false);
        assert.equal(event.func, 'ALWAYS');
      }
      assert.equal(events[0].key, 'physical-land', 'the paired physical source survives country removal and visibility changes');
      for (const event of events.slice(1)) {
        assert.equal(event.stencil, true);
        assert.equal(event.color, true);
        assert.equal(event.func, event.kind === 'ocean' ? 'NOTEQUAL' : 'EQUAL');
        assert.equal(event.mask, 0);
      }
      assert.equal(state.stencil, false);
      assert.equal(state.mask, 0xff);
    });
}

test('WebGL never submits a second physical-land mask when raster/DEM tiles are not drawable', () => {
  const canDraw=(tiles,representation,style,tintReady)=>
    canDrawTerrainTiles(tiles,representation,style,tintReady,'dem-relief-v1');
  assert.equal(canDraw([], 'dem-relief-v1', 'physical', true), false);
  assert.equal(canDraw([{}], 'dem-relief-v1', 'physical', false), false);
  assert.equal(canDraw([{}], 'dem-relief-v1', 'physical', true), true);
  assert.equal(canDraw([{}], 'dem-relief-v1', 'political', false), true);
  assert.equal(canDraw([{}], 'raster-rgba-v1', 'physical', false), true);

  let landDraws=0, terrainDraws=0, invisibleMaskDraws=0, colorEnabled=true;
  const gl = new Proxy({colorMask:value=>{colorEnabled=value;}},
    {get:(target,key)=>target[key] ?? (/^[A-Z_]+$/.test(key)?key:()=>{})});
  const polygonOverlayPass = {
    hasResource:()=>true,
    drawPackets:packets=>{
      for(const packet of packets)if(packet.role==='physical-land'){
        landDraws++;
        if(!colorEnabled) invisibleMaskDraws++;
      }
      return {renderedKeys:packets.map(row=>row.key),missingKeys:[]};
    },
  };
  drawGpuBaseScene({gl,frame:{},width:100,height:100,terrainVisible:canDraw([],'dem-relief-v1','physical',true),
    surfacePresentation:{quality:'pending'}, countriesVisible:false,
    prepared:{baseTriangleDraw:{ranges:[]}, overrideTriangleDraw:{ranges:[]},
      territoryItems:[],independentItems:[],physicalWaterItems:[],
      physicalLandItems:[{kind:'polygon',packet:{key:'land',role:'physical-land'}}],
      deferredOverlayKeys:new Set(),failedOverlayKeys:new Set()},
    countries:{}},
  {drawProgram(){},drawOceanSubstrate(){},renderTerrain:()=>{terrainDraws++},
    drawHydro(){},drawCountryBoundaryStrokes(){},polygonOverlayPass,strokeRenderer:{}});
  assert.equal(landDraws,1,'first background needs exactly one physical land submission');
  assert.equal(invisibleMaskDraws,0,'unavailable DEM cannot add an empty stencil draw');
  assert.equal(terrainDraws,0,'no terrain tile means no GPU terrain submission');
});

test('empty or unpublished territorial ownership never clears another full-viewport stencil', () => {
  const paint=(quality, items)=>{
    let clears=0, territories=0;
    const gl=new Proxy({clear(){clears++}}, {get:(target,key)=>target[key] ?? (/^[A-Z_]+$/.test(key)?key:()=>{})});
    const polygonOverlayPass={
      hasResource:()=>true,
      drawPackets:packets=>{
        if(packets[0].role==='territorial-fill')territories++;
        return {renderedKeys:packets.map(row=>row.key),missingKeys:[]};
      },
    };
    drawGpuBaseScene({gl,frame:{},width:200,height:100,terrainVisible:false,
      surfacePresentation:{quality},countriesVisible:false,countries:{},
      prepared:{baseTriangleDraw:{ranges:[]},overrideTriangleDraw:{ranges:[]},
        territoryItems:items,independentItems:[],physicalWaterItems:[],physicalLandItems:[],
        deferredOverlayKeys:new Set(),failedOverlayKeys:new Set()}},
    {drawOceanSubstrate(){},renderTerrain(){},drawHydro(){},drawProgram(){},
      drawCountryBoundaryStrokes(){},polygonOverlayPass,strokeRenderer:{}});
    return {clears,territories};
  };
  const region=[{kind:'polygon',packet:{key:'zone',role:'territorial-fill'}}];
  assert.deepEqual(paint('canonical',[]),{clears:2,territories:0});
  assert.deepEqual(paint('pending',region),{clears:2,territories:0});
  assert.deepEqual(paint('canonical',region),{clears:3,territories:1});
});

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
  const scene = { polygons: [{ key: 'upper-fill', order: 200 }], strokes: [{ key: 'lower-line', sourceKey: 'stroke:lower-line:1', order: 100 }] };
  const prepared = prepareGpuBaseScene({ scene, frame: {}, presentedStrokeDomains: new Map() }, { polygonOverlayPass, strokeRenderer });
  drawGpuBaseScene({ gl, frame: {}, surfacePresentation:{quality:'canonical'},countriesVisible: false, terrainVisible: false, countries: {}, prepared },
    { drawOceanSubstrate() {}, renderTerrain() {}, drawHydro: kind => events.push({ key: kind, ...state }),
      drawCountryBoundaryStrokes: () => events.push({ key: 'base-borders', ...state }), polygonOverlayPass, strokeRenderer });
  const lineResourceKey = prepared.overlayItems.find(item => item.kind === 'stroke').resourcePacket.key;
  assert.deepEqual(events.filter(event => ['upper-fill', lineResourceKey].includes(event.key)).map(event => event.key), [lineResourceKey, 'upper-fill']);
  assert.equal(events.find(event => event.key === 'upper-fill').stencil, true);
  assert.equal(events.find(event => event.key === lineResourceKey).stencil, false);
  assert.ok(events.some(event => event.key === 'base-borders' && !event.color));
  assert.ok(events.findIndex(event => event.key === 'lake' && event.color) < events.findIndex(event => event.key === lineResourceKey));
});

test('changing overlay order keeps the frontmost stroke or fill aligned with canonical picking', async t => {
  const node = () => ({ dataset: {}, classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, append(...children) {this.children=children;}, replaceChildren(...children) {this.children=children;}, getBoundingClientRect: () => null });
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: node };
  t.after(() => { if (previousDocument) globalThis.document = previousDocument; else delete globalThis.document; });
  const selected = [], session = { objectChooserCandidates: [] }, elements = { objectChooser: node(), objectChooserList: node(), map: node() };
  const region = { id: 'R', properties: { entityKind: 'regional' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]] } };
  const line = { id: 'G', geometry: { type: 'LineString', coordinates: [[0, 5], [10, 5]] } };
  const state = { tool: 'select', territorialEntities: [region], genericFeatures: [line], layerVisibility: { genericFeatures: true },
    layerPresentation: { overlayOrder: ['genericFeatures', 'objects'] } };
  const records = [{ domain: 'territorial', id: 'R' }, { domain: 'generic', id: 'G' }];
  const ports = { projectState: { state }, selectionServices: { normalizeObjectRef }, renderScene: { OVERLAY_GROUPS },
    objectModelB: {territorialScope:{displayFeature:id=>id==='R'?region:null}},
    applicationServicesB: { layerObjectRank }, territorialModel: { entityRepository: { get: id => id === 'R' ? region : null, ancestors: () => [] } },
    objectLookup: { isObjectAvailable:()=>true, objectRefExists: () => true }, layerPresentation: { isLayerItemVisible: () => true },
    surfaces: { isMobile: () => false }, rendering: { selectionPerformanceMetrics: {} },
    spatialRecords: { geometryBoundsCache: new WeakMap(), indexedMapObjectCandidates: () => records },
    cutGeometry: { coordinateBounds: () => [0, 0, 10, 10] }, labelPresentation: { currentMapZoom: () => 100 },
    mapView: { activeProjection: () => point => point, screenToGeo: point => point }, landRelations: { pointInCountryFeature: () => true },
    platform: { $: id => elements[id], clamp: (value, min, max) => Math.max(min, Math.min(max, value)) },
    projectSession: session, mapLayout: { viewRevision: 1 }, renderServices: { selectionPerformanceCounterSnapshot: () => ({}) },
    surfaceCommands: { replaceObjectChooserCandidates: refs => { session.objectChooserCandidates = refs; } },
    domains: { selectionDomain: { has: () => false }, selectionUiController: { applyIntent: ref => selected.push(ref.key) } },
    objectOperationsA: { objectRefVisible: () => true, objectDisplayInfo: ref => ({ name: ref.id }) } };
  const scene = createGpuScene(), picking = createObjectPicking(); scene.connect(ports); picking.connect(ports);
  for (const order of [['genericFeatures', 'objects'], ['objects', 'genericFeatures']]) {
    state.layerPresentation.overlayOrder = order;
    const packets = [
      { key: 'territorial:entity:R', order: scene.gpuSceneOrder('objects') },
      { key: 'generic:feature:G', order: scene.gpuSceneOrder('genericFeatures') },
    ];
    const front = packets.sort((a, b) => b.order - a.order)[0].key;
    await picking.handleObjectSelectionAt([5, 5], { sourceEvent: {} });
    assert.equal(elements.objectChooserList.children[0].children[0].textContent, front.endsWith(':R')?'R':'G');
    await picking.chooseObjectCandidate(0);
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
contractSuite("gpu-prepared-draw", () => {
const test = __render_dep1.default;
const assert = __render_dep0.default;
const { createGpuPolygonOverlayPass } = __render_dep9;
const { createGpuStrokeRenderer } = __render_dep10;
const { createSelectionPass } = __render_dep11;
const { drawGpuBaseScene } = __render_dep4;
const { drawGpuInteractionPass } = __render_dep12;
const { prepareGpuBaseScene, prepareGpuInteractionPlan } = __render_dep3;

function glFixture() {
  const gl = { createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true, getAttribLocation: () => 0,
    getUniformLocation: (_program, name) => name, isContextLost: () => false };
  for (const name of ['shaderSource', 'compileShader', 'deleteShader', 'attachShader', 'linkProgram', 'deleteProgram',
    'bindBuffer', 'bufferData', 'deleteBuffer', 'useProgram', 'disable', 'enable', 'blendFuncSeparate', 'uniform4f',
    'enableVertexAttribArray', 'vertexAttribPointer', 'uniform2f', 'uniform1f', 'uniform3fv', 'uniform1i',
    'drawElements', 'disableVertexAttribArray']) gl[name] = () => {};
  return gl;
}

const frame = { viewport: [100, 100], translate: [50, 50], flatCenter: [0, 0], rowX: [1, 0, 0], rowY: [0, 1, 0], rowZ: [0, 0, 1], scale: 1, mode: 1 };
test('prepared-only polygon submission reports a missing resource without allocating or enqueueing', () => {
  const gl = glFixture();
  const pass = createGpuPolygonOverlayPass();
  pass.initialize({ gl, version: 2, capabilities: { uintIndices: true } });
  let allocations = 0;
  gl.createBuffer = () => { allocations++; return {}; };
  const packet = { key: 'pending', positions: new Float32Array([0, 0, 1, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]) };
  const result = pass.drawPackets([packet], { viewport: [100, 100], mode: 1 }, { preparedOnly: true });
  assert.equal(allocations, 0);
  assert.deepEqual(result.missingKeys, ['pending']);
  assert.deepEqual(result.renderedKeys, []);
  pass.dispose();
});

test('selection prepares each shared country packet once and forwards prepared-only drawing', () => {
  const pass = createSelectionPass();
  const prepared = [], optionsSeen = [];
  pass.initialize({ gl: {}, version: 2, capabilities: {} }, { strokeRenderer: {
    isAvailable: () => true, stats: () => ({ gpuHealth: 'healthy', selfTestPassed: true }),
    ensureResource: packet => prepared.push(packet.key),
    drawBatches: (batches, _frame, options) => { optionsSeen.push(options); return { succeeded: true, renderedKeys: batches.map(batch => batch.key) }; },
  } });
  pass.setCountryBoundaryResources({ revision: '1', visibleIds: ['A', 'B'], pendingIds: [],
    strokeResources: { selectionBase: { ownerIds: ['A', 'B'], packet: { key: 'shared' } } } });
  pass.updateData({ channels: { primary: [{ key: 'territorial:entity:A', boundaryOwnerId: 'A' }], secondary: [{ key: 'territorial:entity:B', boundaryOwnerId: 'B' }] }, countryBoundaryRevision: '1' });
  assert.equal(typeof pass.prepare, 'function');
  pass.prepare();
  assert.deepEqual(prepared, ['shared']);
  pass.draw({}, {}, { frameContext: { frameId: 1 }, preparedOnly: true });
  assert.ok(optionsSeen.length > 0);
  assert.ok(optionsSeen.every(options => options?.preparedOnly === true));
  assert.deepEqual(prepared, ['shared']);
});

test('base pass draws map substrate before terrain and preserves territory, country, water and stroke order', () => {
  const calls = [];
  const gl = glFixture();
  for (const name of ['viewport', 'colorMask', 'clearColor', 'clearStencil', 'clear', 'stencilMask', 'stencilFunc', 'stencilOp']) gl[name] = () => {};
  const polygonOverlayPass = {
    hasResource: () => true,
    ensureResource: () => assert.fail('draw initiated polygon preparation'),
    drawPackets: (packets, _frame, options) => {
      assert.equal(options.preparedOnly, true);
      const keys = packets.map(packet => packet.key); calls.push(...packets.map(packet => packet.style?.color === '#cccccc' ? `${packet.key}-substrate` : packet.key));
      return { renderedKeys: keys, missingKeys: [] };
    },
  };
  const strokeRenderer = { hasResource: () => true, ensureResource: () => assert.fail('draw initiated stroke preparation'),
    drawBatches: (packets, _frame, options) => {
      assert.equal(options.preparedOnly, true); calls.push('stroke');
      return { renderedKeys: packets.map(packet => packet.key), missingKeys: [] };
    } };
  const range = { ranges: [{ first: 0, count: 3 }] };
  const result = drawGpuBaseScene({ gl, frame: {}, width: 10, height: 10,
    surfacePresentation: { quality: 'canonical' },
    terrainVisible: true, terrainStyle: 'neutral', countriesVisible: true, mapSubstrate: { color: '#cccccc', fillAlpha: 1 },mapOcean:{color:'#006b8b',fillAlpha:1},
    countries: { mesh: { triangleIndices: { length: 3 } }, fillProgram: 'country' },
    prepared: { baseTriangleDraw: range, baseBoundaryDraw: range, overrideTriangleDraw: range, overrideBoundaryDraw: range,
      physicalLandItems:[{kind:'polygon',packet:{key:'physical-land',role:'physical-land'}}],physicalWaterItems:[{kind:'polygon',packet:{key:'historical-water',role:'physical-water'}}],
      deferredOverlayKeys: new Set(), failedOverlayKeys: new Set(), territoryItems: [
        { kind: 'polygon', packet: { key: 'parent', role: 'territorial-fill', territoryDepth: 1, order: 1 } },
        { kind: 'polygon', packet: { key: 'child', role: 'territorial-fill', territoryDepth: 2, order: 2 } },
      ].reverse(), independentItems: [{ kind: 'polygon', packet: { key: 'generic' } }, { kind: 'stroke', packet: { key: 'line' } }] },
  }, { drawOceanSubstrate() {}, polygonOverlayPass, strokeRenderer, drawProgram: (...args) => calls.push(args[10] ? 'country-substrate' : args[0]),
    renderTerrain: () => calls.push('terrain'), drawHydro: category => calls.push(category),
    drawCountryBoundaryStrokes: () => { calls.push('boundary'); return { succeeded: true }; } });
  assert.deepEqual(calls, ['physical-land-substrate','physical-land','terrain', 'child', 'parent', 'country', 'lake', 'lake-boundary', 'river', 'border-river', 'boundary','historical-water', 'lake', 'lake-boundary', 'river', 'border-river','historical-water', 'boundary', 'generic', 'stroke']);
  assert.deepEqual(result.overlayMissingKeys, []);
});

test('overlay preparation defers excess work and keeps protected uploads within the existing budget policy', () => {
  const uploaded = [];
  const pass = { hasResource: () => false, ensureResource: packet => { uploaded.push(packet.key); return { resource: { byteLength: packet.byteLength } }; } };
  const result = prepareGpuBaseScene({ mesh: null, frame: {}, budgetBytes: 65536, presentedStrokeDomains: new Map(),
    scene: { polygons: [{ key: 'protected', protected: true, byteLength: 40000 },
      { key: 'deferred', byteLength: 40000 }, { key: 'small', byteLength: 10000 }], strokes: [] } },
  { polygonOverlayPass: pass, strokeRenderer: pass });
  assert.deepEqual(uploaded, ['protected', 'small']);
  assert.deepEqual([...result.deferredOverlayKeys], ['deferred']);
  assert.equal(result.overlayUploadBytes, 50000);
});

test('same-key polygon revision and LOD replacements are prepared before draw', () => {
  const pass = createGpuPolygonOverlayPass();
  pass.initialize({ gl: glFixture(), version: 2, capabilities: { uintIndices: true } });
  const original = { key: 'edited', geometryRevision: 1, lod: 'low', positions: new Float32Array([0, 0, 1, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]) };
  for (const packet of [original, { ...original, geometryRevision: 2 }, { ...original, geometryRevision: 2, lod: 'high' }]) {
    prepareGpuBaseScene({ frame: {}, scene: { polygons: [packet] }, presentedStrokeDomains: new Map() }, { polygonOverlayPass: pass });
    const result = pass.drawPackets([packet], frame, { preparedOnly: true });
    assert.deepEqual(result.renderedKeys, ['edited']);
    assert.deepEqual(result.missingKeys, []);
  }
  pass.dispose();
});

test('same-key stroke revision and LOD replacements are prepared before draw', () => {
  const gl = new Proxy(glFixture(), { get(target, name) {
    if (name in target) return target[name];
    if (/^[A-Z0-9_]+$/.test(name)) return name;
    if (name.startsWith('create')) return () => ({});
    if (name === 'getParameter') return () => [0, 0, 16, 16];
    if (name === 'checkFramebufferStatus') return () => 'FRAMEBUFFER_COMPLETE';
    if (name === 'readPixels') return (...args) => args.at(-1).fill(255);
    if (name === 'isEnabled') return () => false;
    return () => {};
  } });
  const pass = createGpuStrokeRenderer();
  assert.equal(pass.initialize({ gl, version: 2, capabilities: { instancing: true } }), true);
  const original = { key: 'edited-stroke', geometryRevision: 1, lod: 'low', style: { width: 2 }, startsEnds: new Float32Array([0, 0, 1, 1]) };
  for (const packet of [original, { ...original, geometryRevision: 2 }, { ...original, geometryRevision: 2, lod: 'high' }]) {
    const sourceKey = `${packet.key}:${packet.geometryRevision}:${packet.lod}`;
    const prepared = prepareGpuBaseScene({ frame, scene: { strokes: [{ ...packet, sourceKey }] }, presentedStrokeDomains: new Map() }, { strokeRenderer: pass });
    const resourcePacket = prepared.overlayItems[0].resourcePacket;
    const result = pass.drawBatches([resourcePacket], frame, { preparedOnly: true });
    assert.deepEqual(result.renderedKeys, [resourcePacket.key]);
    assert.deepEqual(result.missingKeys, []);
  }
  pass.dispose();
});

test('same-key polygon replacements obey the frame budget and resume next frame', () => {
  const pass = createGpuPolygonOverlayPass();
  pass.initialize({ gl: glFixture(), version: 2, capabilities: { uintIndices: true } });
  const packets = ['one', 'two'].map(key => ({ key, geometryRevision: 1, positions: new Float32Array(12000), indices: new Uint32Array(6000) }));
  for (const packet of packets) pass.ensureResource(packet);
  const updated = packets.map(packet => ({ ...packet, geometryRevision: 2 }));
  const input = { frame, scene: { polygons: updated }, budgetBytes: 65536, presentedStrokeDomains: new Map() };
  const first = prepareGpuBaseScene(input, { polygonOverlayPass: pass });
  assert.deepEqual([...first.deferredOverlayKeys], ['two']);
  assert.equal(pass.hasPreparedResource(updated[0]), true);
  assert.equal(pass.hasPreparedResource(updated[1]), false);
  prepareGpuBaseScene(input, { polygonOverlayPass: pass });
  assert.equal(pass.hasPreparedResource(updated[1]), true);
  pass.dispose();
});

test('selection preparation attributes resource build and upload metrics without double counting draw', () => {
  const pass = createSelectionPass();
  let built = false;
  pass.initialize({ gl: {}, version: 2, capabilities: {} }, { strokeRenderer: {
    isAvailable: () => true,
    stats: () => ({ buildCount: Number(built), buildMs: built ? 7 : 0, uploadBytes: built ? 128 : 0 }),
    ensureResource: () => { built = true; },
    drawBatches: batches => ({ succeeded: true, renderedKeys: batches.map(batch => batch.key) }),
  } });
  pass.setCountryBoundaryResources({ revision: '1', visibleIds: ['A'], pendingIds: [], strokeResources: { selectionBase: { ownerIds: ['A'], packet: { key: 'shared' } } } });
  pass.updateData({ channels: { primary: [{ key: 'territorial:entity:A', boundaryOwnerId: 'A' }] }, countryBoundaryRevision: '1' });
  pass.prepare();
  pass.prepare();
  pass.draw({}, {}, { frameContext: {}, preparedOnly: true });
  assert.equal(pass.stats().bufferBuildCount, 1);
  assert.equal(pass.stats().bufferBuildMs, 7);
  assert.equal(pass.stats().bufferUploadBytes, 128);
});

test('interaction pass submits prepared priorities and ranges then composites before selection strokes', () => {
  const calls = [];
  const gl = new Proxy(glFixture(), { get: (target, key) => key in target ? target[key] : () => {} });
  const polygonOverlayPass = { hasResource: () => true,
    ensureResource: () => assert.fail('draw started preparation'),
    drawResourceItems: items => { calls.push(...items.map(item => item.key)); return { succeeded: true, renderedKeys: items.map(item => item.key) }; } };
  const plan = prepareGpuInteractionPlan({
    interaction: { genericFillItems: [{ key: 'hover', priority: 2 }, { key: 'primary', priority: 4 }] },
    emphasis: { selectedIds: new Set(['A']), primaryId: 'A', primaryIds: new Set(['A']), hoverId: '', priorities: {} },
    mesh: { triangleRangesByCountryId: new Map([['A', [{ first: 2, count: 3 }]]]) }, overrideIds: new Set(), countriesVisible: true, isPending: () => false, isVisible: () => true,
  }, polygonOverlayPass);
  const dependencies = { polygonOverlayPass,
    selectionPass: { draw: () => { calls.push('selection'); return {}; } },
    drawHydro: category => calls.push(category), drawPhysicalWaterMask:()=>calls.push('physical-water-mask'), drawCountryRanges: ranges => { if (ranges.base.length) { assert.deepEqual(ranges.base, [{ first: 2, count: 3 }]); calls.push('country'); } },
    fillCache: { finishScene: () => calls.push('finish'), composite: () => { calls.push('composite'); return true; } } };
  const result = drawGpuInteractionPass({ gl, frame, viewport: {}, fillTargetReady: true, prepared: plan }, dependencies);
  assert.equal(result.fillOwner, 'gpu');
  assert.deepEqual(calls, ['lake', 'lake-boundary', 'river', 'border-river', 'physical-water-mask', 'country', 'primary', 'hover', 'finish', 'composite', 'selection']);
  calls.length = 0;
  const fallback = drawGpuInteractionPass({ gl, frame, viewport: {}, fillTargetReady: true, prepared: { ...plan, fillReady: false } }, dependencies);
  assert.equal(fallback.fillOwner, 'svg');
  assert.deepEqual(fallback.genericFillResult.renderedKeys, []);
  assert.deepEqual(fallback.genericFillResult.missingKeys, ['hover', 'primary']);
  assert.deepEqual(calls, ['lake', 'lake-boundary', 'river', 'border-river', 'physical-water-mask', 'finish', 'selection']);
});

test('interaction pass skips unneeded water/border masks when no GPU fill is requested', () => {
  const calls = [];
  const gl = new Proxy(glFixture(), { get: (target, key) => key in target ? target[key] : () => {} });
  const polygonOverlayPass = { hasResource: () => true, hasPreparedResource: () => true };
  const plan = prepareGpuInteractionPlan({
    interaction: { genericFillItems: [] },
    emphasis: { selectedIds: new Set(), primaryId: '', primaryIds: new Set(), hoverId: '', priorities: {} },
    mesh: { triangleRangesByCountryId: new Map() }, overrideIds: new Set(),
    countriesVisible: true, isPending: () => false, isVisible: () => true,
  }, polygonOverlayPass);
  assert.equal(plan.hasFillItems, false);
  const skip = () => assert.fail('empty interaction fills must not draw a mask or prepare a framebuffer');
  const result = drawGpuInteractionPass({ gl, frame, viewport: {}, fillTarget: null, fillTargetReady: false, prepared: plan }, {
    polygonOverlayPass: { ...polygonOverlayPass, drawPackets: skip, drawResourceItems: skip },
    strokeRenderer: { drawBatches: skip },
    selectionPass: { draw: () => { calls.push('selection'); return { succeeded: true }; } },
    drawHydro: skip, drawCountryBoundaryMask: skip, drawPhysicalWaterMask:skip, drawCountryRanges: skip,
    fillCache: { finishScene: skip, composite: skip },
  });
  assert.deepEqual(calls, ['selection']);
  assert.equal(result.fillOwner, 'gpu');
  assert.equal(result.genericFillResult.succeeded, true);
});
});
