import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { prepareGpuBaseScene } from "../../shared/frontend/js/modules/gpu-scene-preparation.js";
import { drawGpuBaseScene } from "../../shared/frontend/js/modules/gpu-base-scene-pass.js";
import "../../shared/frontend/js/workers/canvas-scene-composition-core.js";
import { createGpuScene } from "../../shared/frontend/js/modules/gpu-scene.js";
import { createObjectPicking } from "../../shared/frontend/js/modules/object-picking.js";
import { normalizeObjectRef } from "../../shared/frontend/js/modules/object-selection-controller.js";
import { layerObjectRank, OVERLAY_GROUPS } from "../../shared/frontend/js/modules/layer-presentation.js";

test('culled or empty indexed country passes issue no redundant GL state changes', () => {
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-map-renderer.js',import.meta.url),'utf8');
  const start=source.indexOf('    function drawProgram('),end=source.indexOf('    function hydroLineParts(',start);
  assert.ok(start>0&&end>start);
  const gl=new Proxy({}, {get(){throw Error('empty index submission touched GL state')}});
  const draw=new Function('gl','paletteTexture',source.slice(start,end)+';return drawProgram;')(gl,null);
  assert.equal(draw('fill',null,null,0,0,null,null,null,null,null),null);
  assert.equal(draw('fill',null,null,30,0,null,null,null,null,[]),null);
  assert.equal(draw('fill',null,null,30,0,null,null,null,null,[{first:0,count:0}]),null);
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
  const source = readFileSync(new URL('../../shared/frontend/js/modules/gpu-map-renderer.js', import.meta.url),'utf8');
  const begin = source.indexOf('    function hasRenderableTerrain() {');
  const end = source.indexOf('    function renderTerrain(', begin);
  assert.ok(begin > 0 && end > begin);
  const functionBody = source.slice(begin,end)+';return hasRenderableTerrain();';
  const canDraw = (tiles, representation, style, tintReady) =>
    new Function('preparedTerrain','terrainManifest','state','terrainPreparation','TERRAIN_DEM_FORMAT',functionBody)(
      tiles, {representation}, {physicalSettings:{terrainStyle:style}},
      {stats:()=>({terrainTintReady:tintReady})},'dem-relief-v1');
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
