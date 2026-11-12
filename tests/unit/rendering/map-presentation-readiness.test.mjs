import { describe as featureDescribe } from 'node:test';
import { mapPresentationTargetKey, mapBackgroundTargetKey, physicalSceneMatchesContext } from "../../../src/rendering/map-render-publication.js";
import {createRenderDeviceFixture} from '../../helpers/render-device-fixture.mjs';
import { visibleFlatWorldOffsets } from "../../../src/rendering/map-visual-frame.js";
import * as __suiteDependency0 from "node:assert/strict";
import * as __suiteDependency1 from "node:test";
import * as __suiteDependency2 from "../../../src/app/startup-readiness.js";
import * as __suiteDependency3 from "../../../src/rendering/map-visual-frame.js";
import * as __suiteDependency4 from "node:assert/strict";
import * as __suiteDependency5 from "node:test";
import * as __suiteDependency6 from "../../../src/rendering/map-visual-frame.js";
import * as __suiteDependency7 from "node:assert/strict";
import * as __suiteDependency8 from "node:test";
import * as __suiteDependency9 from "../../../src/ui/layer-presentation.js";
import * as __suiteDependency10 from "../../../src/rendering/selection-pass.js";
import * as __suiteDependency12 from "node:test";
import * as __suiteDependency13 from "node:assert/strict";
import * as __suiteDependency14 from "../../../src/ui/map-content-presentation.js";
import * as __suiteDependency15 from "../../../src/ui/layer-presentation.js";
import * as __suiteDependency16 from "node:assert/strict";
import * as __suiteDependency17 from "node:test";
import * as __suiteDependency18 from "../../../src/rendering/map-render-coordinator.js";
featureDescribe("map-presentation-readiness", () => {
  const assert = __suiteDependency0.default;
  const test = __suiteDependency1.default;
  const {  mapPresentationReadiness  } = __suiteDependency2;
  const {  createMapVisualFrame  } = __suiteDependency3;
const snapshot = center => createMapVisualFrame({frameId: 1, viewRevision: 1,
  viewState: {projection:'flat', size:{width:900,height:600}, scale:420,
    translate:[450,300], projectionCenter:center}});
const stage = (current, presented=current, overrides={}) => ({
  boundaryReady:true, terrainVisible:true, terrain:{terrainReady:true},
  targetKey:current.signature, presentedKey:presented?.signature, band:'low', ...overrides,
});

test('publication keys exclude optional terrain completion but include authoritative source and camera', () => {
  const frame=snapshot([0,0]),changed=snapshot([20,0]);
  const source={projectGeneration:4,contextRevision:2,geometryRevision:8,paletteRevision:1,
    physicalStyleRevision:1,terrainVisible:true,surfaceQuality:'canonical',surfaceGeometryQuality:'canonical'};
  const key=mapPresentationTargetKey(frame,source);
  assert.equal(mapPresentationTargetKey(frame,{...source,terrainTileCompletion:42}),key);
  assert.notEqual(mapPresentationTargetKey(changed,source),key);
  assert.notEqual(mapPresentationTargetKey(frame,{...source,geometryRevision:9}),key);
  const scene={polygons:[{role:'physical-land',sourceKey:'land:v1'}]};
  const background={scene,projectGeneration:4,contextRevision:2,physicalStyleRevision:1,terrainVisible:true};
  assert.equal(mapBackgroundTargetKey(frame,background),mapBackgroundTargetKey(frame,{...background,demTileCount:50}));
  assert.notEqual(mapBackgroundTargetKey(frame,{...background,scene:{polygons:[{role:'physical-land',sourceKey:'land:v2'}]}}),
    mapBackgroundTargetKey(frame,background));
  assert.equal(physicalSceneMatchesContext({polygons:[{role:'physical-land',geometryRevision:'land:v1'}]},
    {ready:true,landRevision:'land:v1',waterRevision:null}),true);
  assert.equal(physicalSceneMatchesContext({polygons:[]},{ready:true,landRevision:'land:v1'}),false);
  assert.deepEqual(visibleFlatWorldOffsets({translateX:450,scale:420,viewportWidth:900}),[0]);
  assert.deepEqual(visibleFlatWorldOffsets({translateX:Infinity,scale:420,viewportWidth:900}),[0]);
});

test('only an accepted frame with its own source/camera identity certifies a ready map', () => {
  const initial=snapshot([0,0]), changed=snapshot([20,0]);
  assert.equal(mapPresentationReadiness(stage(initial)).status, 'ready');
  assert.equal(mapPresentationReadiness(stage(initial)).mapReady, true);
  const pending=mapPresentationReadiness(stage(changed,initial));
  assert.equal(pending.mapReady,false);
  assert.equal(pending.status,'presenting');
  assert.equal(mapPresentationReadiness(stage(changed,changed)).mapReady,true);
  assert.equal(mapPresentationReadiness(stage(initial,null)).mapReady,false);
  assert.equal(mapPresentationReadiness(stage(initial,initial,{mapPresented:false})).mapReady,false);
});

test('optional terrain cannot hide an accepted country frame or report false completion', () => {
  const frame=snapshot([0,0]);
  const terrain=mapPresentationReadiness(stage(frame,frame,{terrain:{terrainReady:false}}));
  assert.equal(terrain.mapReady,true);
  assert.equal(terrain.terrainReady,false);
  assert.equal(terrain.status,'terrain');
  const readyWithoutTerrain=mapPresentationReadiness(stage(frame,frame,{terrainVisible:false,terrain:{}}));
  assert.equal(readyWithoutTerrain.status,'ready');
  assert.equal(readyWithoutTerrain.terrainReady,true);
  const failed=mapPresentationReadiness(stage(frame,frame,{terrain:{terrainReady:false,terrainFailed:true}}));
  assert.equal(failed.status,'error');
  assert.equal(failed.retry,true);
  assert.equal(mapPresentationReadiness(stage(frame,frame,{boundaryReady:false})).status,'boundaries');
  assert.equal(mapPresentationReadiness(stage(frame,frame,{boundaryFailed:true})).status,'error');
});

test('a resolution-limited frame is explicitly complete but never claims additional DEM data', () => {
  const frame=snapshot([0,0]);
  const limited=mapPresentationReadiness(stage(frame,frame,{terrain:{terrainReady:true,terrainResolutionLimited:true}}));
  assert.equal(limited.mapReady,true);
  assert.equal(limited.terrainReady,true);
  assert.equal(limited.status,'limited');
  assert.ok(limited.label.includes('최고 해상도'));
  assert.match(mapPresentationReadiness(stage(frame)).label,/저배율/);
});
});
featureDescribe("map-visual-frame", () => {
  const assert = __suiteDependency4.default;
  const test = __suiteDependency5.default;
  const {  createMapVisualFrame, isMapVisualFrame  } = __suiteDependency6;
test('globe visual frame derives CSS and GPU values from one immutable snapshot', () => {
  const frame = createMapVisualFrame({
    frameId: 12,
    viewRevision: 7,
    projectGeneration: 3,
    projectionRevision: 2,
    viewState: {
      projection: 'globe',
      size: { width: 800, height: 600 },
      dpr: 2,
      translate: [400, 300],
      scale: 280,
      rotation: [10, -20, 0],
      flatCenter: [0, 0],
    },
    projectCoordinate: coordinate => [400 + coordinate[0], 300 - coordinate[1]],
  });

  assert.equal(isMapVisualFrame(frame), true);
  assert.deepEqual(frame.cssViewport, [800, 600]);
  assert.deepEqual(frame.gpuViewport, [1600, 1200]);
  assert.deepEqual(frame.cssTranslate, [400, 300]);
  assert.deepEqual(frame.gpuTranslate, [800, 600]);
  assert.equal(frame.cssScale, 280);
  assert.equal(frame.gpuScale, 560);
  assert.deepEqual(frame.worldOffsets, [0]);
  assert.equal(Object.isFrozen(frame), true);
  assert.equal(Object.isFrozen(frame.viewState), true);
  assert.equal(Object.isFrozen(frame.viewState.rotation), true);
  assert.deepEqual(frame.projectVisibleCoordinate([0, 0]), [400, 300]);
  assert.equal(frame.projectVisibleCoordinate([180, 0]), null);
});

test('flat visual frame keeps visible wrapped worlds in the shared frame', () => {
  const frame = createMapVisualFrame({
    frameId: 4,
    viewRevision: 9,
    projectionRevision: 1,
    viewState: {
      projection: 'flat',
      size: { width: 1200, height: 700 },
      dpr: 1.5,
      translate: [600, 350],
      scale: 190,
      projectionCenter: [179, 0],
      flatCenter: [179, 0],
    },
  });

  assert.equal(frame.mode, 1);
  assert.equal(frame.viewState.flatCenter[0], 179);
  assert.equal(frame.flatCenter[0], 179 * Math.PI / 180);
  assert.ok(frame.worldOffsets.length >= 1);
  assert.ok(frame.worldOffsets.every(Number.isFinite));
  assert.equal(Object.isFrozen(frame.worldOffsets), true);
  const datelinePoint = frame.projectVisibleCoordinate([-179, 0]);
  assert.ok(datelinePoint);
  assert.ok(datelinePoint[0] >= -30 && datelinePoint[0] <= 1230);
  assert.equal(Object.isFrozen(datelinePoint), true);
});
});
featureDescribe("map-visual-order", () => {
  const assert = __suiteDependency7.default;
  const test = __suiteDependency8.default;
  const {  mapVisualOrder, mapVisualRank, INTERACTION_ROLE_PRIORITY, SELECTION_PAINT_ORDER, overlayVisualOrder  } = __suiteDependency9;
  const {  createSelectionPass  } = __suiteDependency10;
test('one policy orders paint, claim, selection and SVG roles without changing overlay object order', () => {
  assert.deepEqual(mapVisualOrder('hydro'), ['lake', 'lake-boundary', 'river', 'border-river']);
  const paint = mapVisualOrder('base');
  assert.ok(paint.indexOf('country-fill') < paint.indexOf('territorial-fill'));
  assert.ok(paint.indexOf('country-boundary') < paint.indexOf('independent-overlay'));
  assert.deepEqual(mapVisualOrder('base', 'gpu').filter(role => role.endsWith('-fill')), ['territorial-fill', 'country-fill']);
  assert.deepEqual(SELECTION_PAINT_ORDER, ['candidate', 'hover', 'secondary', 'primary']);
  assert.equal(INTERACTION_ROLE_PRIORITY.primary, 4);
  assert.ok(mapVisualRank('primary') < mapVisualRank('territorial-labels'));
  assert.ok(mapVisualRank('territorial-labels') < mapVisualRank('labels'));
  const presentation = { overlayOrder: ['distributions', 'objects', 'genericFeatures'], objectOrder: ['generic:a', 'generic:b'] };
  assert.ok(overlayVisualOrder(presentation, 'objects', 'boundary') < overlayVisualOrder(presentation, 'genericFeatures', 'fill'));
  assert.ok(overlayVisualOrder(presentation, 'genericFeatures', 'fill', 'generic:a') < overlayVisualOrder(presentation, 'genericFeatures', 'fill', 'generic:b'));
  assert.throws(() => mapVisualRank('unknown'), /visual role/);
});

test('selection submits the actual strokes in policy order regardless of input channel order', () => {
  const submitted = [];
  const renderer = { isAvailable: () => true, stats: () => ({}),
    drawBatches: batches => {
      const keys = batches.map(batch => batch.key); submitted.push(...keys);
      return { succeeded: true, renderedKeys: keys, missingKeys: [] };
    } };
  const pass = createSelectionPass();
  pass.initialize(createRenderDeviceFixture().device, { strokeRenderer: renderer });
  const geometry = { type: 'LineString', coordinates: [[0, 0], [1, 1]] };
  pass.updateData({ channels: Object.fromEntries(['primary', 'secondary', 'hover', 'candidate'].map(role =>
    [role, [{ key: role, geometryRevision: 1, geometry }]])) });
  const result = pass.draw({}, {}, { frameContext: {} });
  assert.equal(result.succeeded, true);
  assert.deepEqual(submitted, SELECTION_PAINT_ORDER.map(role => `selection-object:${role}`));
});
});
featureDescribe("map-content-presentation", () => {
  const test = __suiteDependency12.default;
  const assert = __suiteDependency13.default;
  const { createMapContentPresentation } = __suiteDependency14;
  const { normalizeLayerPresentation,layerStyle,overlayVisualOrder } = __suiteDependency15;
const feature={type:'Feature',id:'literal:area',properties:{name:'Area'},geometry:{type:'Polygon',coordinates:[[[0,0],[0,2],[2,2],[2,0],[0,0]]]}};
test('the canonical content owner produces generic fill and boundary packets without modifying model geometry',()=>{
 const state={genericFeatures:[feature],layerVisibility:{genericFeatures:true},layerPresentation:normalizeLayerPresentation()};
 const before=structuredClone(state);let scene;
 const content=createMapContentPresentation({generic:{getState:()=>state,layerStyle,
  visibleMapObjectCandidates:()=>[{id:feature.id}],isLayerItemVisible:()=>true,geometryMayIntersectViewport:()=>true,
  genericFeatureColor:()=> '#123456',gpuSceneOrder:(...args)=>overlayVisualOrder(state.layerPresentation,...args),
  replaceGpuSceneDomain:(_domain,packet)=>{scene=packet;},buildRenderableStrokeFeature:value=>value},
  active:()=>{},framePath:()=>()=>'',isDisposed:()=>false,isSmooth:()=>true});
 content.renderGenericFeatures({});
 assert.equal(scene.polygons.length,1);assert.equal(scene.strokes.length,1);
 assert.equal(scene.polygons[0].objectKey,'generic:feature:literal:area');
 assert.equal(scene.polygons[0].style.color,'#123456');
 assert.equal(scene.polygons[0].style.fillAlpha,.34*layerStyle(state.layerPresentation,'genericFeatures').opacity);
 assert.deepEqual(state,before);assert.strictEqual(scene.polygons[0].geometry,feature.geometry);
});

// A frame is drawn before the coordinator's presentation-only commit.
// That commit must not mutate the GPU scene revision before admission.
function setup() {
  const updates=[];
  const state={layerVisibility:{objects:true},pendingCountryRenderIds:new Set()};
  const countries={
    getState:()=>state,
    renderPendingCountryOverlays:()=>updates.push('svg'),
    replaceGpuSceneDomain:()=>updates.push('replace-scene'),
    syncGpuRenderScene:()=>updates.push('sync-scene'),
    gpuMapRenderer:{renderFrame:()=>({succeeded:true})},
    applyGpuSceneCoverage:()=>{},
  };
  const owner=createMapContentPresentation({countries,active:()=>{},requireFrame:value=>value,isDisposed:()=>false});
  return{owner,updates,frame:{__mapVisualFrame:true,frameId:17}};
}
test('presenting a GPU frame cannot change the scene after that frame was drawn',()=>{
  const f=setup(),accepted={succeeded:true};
  f.owner.renderCountries(f.frame);
  assert.deepEqual(f.updates,['svg','replace-scene','sync-scene']);
  f.updates.length=0;
  assert.equal(f.owner.renderCountries(f.frame,{presentationOnly:true,gpuResult:accepted}),accepted);
  assert.deepEqual(f.updates,['svg'],'presentation-only country overlays must not change the rendered scene');
});
test('a normal GPU content frame still updates scene domains before drawing',()=>{
  const f=setup();
  const result=f.owner.renderCountries(f.frame);
  assert.equal(result?.succeeded,true);
  assert.deepEqual(f.updates,['svg','replace-scene','sync-scene']);
});
});
featureDescribe("map-render-coordinator", () => {
  const assert = __suiteDependency16.default;
  const test = __suiteDependency17.default;
  const {  createMapRenderCoordinator, MAP_RENDER_DIRTY, MAP_RENDER_MASKS, RenderInvalidationError,  } = __suiteDependency18;
test('a preserved temporal frame holds labels and publishes them with its successful successor', () => {
  let preserved = true;
  const calls = [];
  const frames = [];
  const coordinator = createMapRenderCoordinator({requestFrame:callback=>frames.push(callback),prepareView:()=>({frameId:1}),
    renderers:{countries:()=>({preserved,deferred:preserved}),view:()=>({preserved,deferred:preserved}),
      labelLayout:()=>{calls.push('layout');return {};},territorialLabels:()=>calls.push('labels'),viewPresentation:()=>calls.push('present')}});
  coordinator.invalidate(MAP_RENDER_MASKS.PROJECT,'temporal-stage');frames.shift()();
  assert.deepEqual(calls,[]);
  preserved=false;
  coordinator.invalidate(MAP_RENDER_DIRTY.GPU_FRAME,'temporal-ready');frames.shift()();
  assert.deepEqual(calls,['layout','labels','present']);
});

test('temporal publication also holds label-only and selection-only invalidations', () => {
  const frames = [], calls = [];
  let ready = false;
  const coordinator = createMapRenderCoordinator({requestFrame: fn => frames.push(fn),
    prepareView: ({frameId}) => ({frameId}),
    canPresentFrame: (_frame, result) => ready && result?.succeeded === true,
    renderers: {view: () => ({succeeded: ready, preserved: !ready}),
      labelLayout: () => { calls.push('layout'); return {}; },
      territorialLabels: () => calls.push('labels'), selectionData: () => calls.push('selection'),
      viewPresentation: () => calls.push('present')}});
  for (const mask of [MAP_RENDER_DIRTY.GPU_FRAME, MAP_RENDER_DIRTY.LABEL_LAYOUT | MAP_RENDER_DIRTY.VIEW_PRESENTATION,
    MAP_RENDER_DIRTY.SELECTION_DATA]) {
    coordinator.invalidate(mask); frames.shift()();
    assert.deepEqual(calls, [], 'no presentation may bypass the renderer publication gate');
  }
  ready = true;
  coordinator.invalidate(MAP_RENDER_DIRTY.GPU_FRAME); frames.shift()();
  assert.deepEqual(calls, ['selection', 'layout', 'labels', 'present']);
});

test('resource completion can draw the pending temporal frame before publishing deferred labels', () => {
  const frames = [], calls = [];
  let prepared = false, presentedFrame = null;
  const coordinator = createMapRenderCoordinator({requestFrame: fn => frames.push(fn),
    prepareView: ({frameId}) => ({frameId}),
    canPresentFrame: (frame, result) => presentedFrame === frame.frameId && !result?.preserved,
    renderers: {view: frame => { if (prepared) presentedFrame = frame.frameId; return {preserved: !prepared}; },
      labelLayout: () => calls.push('layout'), territorialLabels: () => calls.push('labels'),
      viewPresentation: () => calls.push('present')}});
  coordinator.invalidate(MAP_RENDER_MASKS.VIEW | MAP_RENDER_DIRTY.LABEL_LAYOUT); frames.shift()();
  assert.deepEqual(calls, []);
  prepared = true;
  coordinator.invalidate(MAP_RENDER_DIRTY.GPU_INTERACTION, 'overlay-mesh-ready'); frames.shift()();
  assert.deepEqual(calls, ['layout', 'labels', 'present']);
});

test('project preparation invalidated while replacement is blocked is replayed before publication', () => {
  const frames = [], calls = [];
  let blocked = true;
  const coordinator = createMapRenderCoordinator({requestFrame: fn => frames.push(fn),
    prepareView: ({frameId}) => ({frameId}), isPresentationBlocked: () => blocked,
    renderers: {base: () => calls.push('base'), countries: () => { calls.push('countries'); return {succeeded:true}; },
      territorialLabels: () => calls.push('labels'), viewPresentation: () => calls.push('present')}});
  coordinator.invalidate(MAP_RENDER_MASKS.PROJECT); frames.shift()();
  assert.deepEqual(calls, []);
  blocked = false;
  coordinator.invalidate(MAP_RENDER_DIRTY.GPU_FRAME); frames.shift()();
  assert.deepEqual(calls, ['base', 'countries', 'labels', 'present']);
});

test('blocked Canvas startup submits only a physical background frame, keeping country presentation deferred', () => {
  const frames = [], calls = [];
  let blocked = true, backgroundReady = true;
  const coordinator = createMapRenderCoordinator({
    requestFrame: callback => frames.push(callback),
    prepareView: ({frameId}) => ({frameId, projectGeneration:3}),
    isPresentationBlocked: () => blocked,
    renderers: {
      preservedFrame: () => calls.push('preserved'),
      canRenderBlockedBackground: () => backgroundReady,
      blockedBackground: frame => calls.push(`background:${frame.projectGeneration}:${frame.frameId}`),
      countries: () => { calls.push('countries'); return {succeeded:true}; },
      viewPresentation: () => calls.push('present'),
    },
  });
  coordinator.invalidate(MAP_RENDER_MASKS.PROJECT); frames.shift()();
  assert.deepEqual(calls, ['preserved', 'background:3:1']);
  backgroundReady = false;
  coordinator.invalidate(MAP_RENDER_DIRTY.GPU_FRAME); frames.shift()();
  assert.deepEqual(calls, ['preserved', 'background:3:1', 'preserved']);
  blocked = false;
  coordinator.invalidate(MAP_RENDER_DIRTY.GPU_FRAME); frames.shift()();
  assert.ok(calls.includes('countries'));
  assert.ok(calls.includes('present'));
});

test('generation reset stages one Canvas background frame before the blocked RAF', () => {
  const callbacks = [], prepared = [], staged = [];
  let needsStage = true;
  const coordinator = createMapRenderCoordinator({
    requestFrame: callback => callbacks.push(callback),
    prepareView: ({frameId}) => { prepared.push(frameId); return {frameId, projectGeneration: 4}; },
    isPresentationBlocked: () => true,
    renderers: {
      canRenderBlockedBackground: () => needsStage,
      blockedBackground: frame => { staged.push(frame); needsStage = false; return true; },
    },
  });
  assert.equal(coordinator.stageBlockedBackground(), true);
  assert.deepEqual(prepared, [1]);
  coordinator.invalidate(MAP_RENDER_MASKS.PROJECT);
  callbacks.shift()();
  assert.deepEqual(prepared, [1], 'deferred project work does not prepare a second camera');
  assert.equal(staged[0].projectGeneration, 4);
  assert.equal(coordinator.stageBlockedBackground(), false);
});

function fixture() {
  const calls = [];
  const frames = [];
  const viewState = Object.freeze({ revision: 7, projection: 'globe' });
  const viewFrameResult = Object.freeze({ succeeded: true, selection: { succeeded: true } });
  const names = [
    'view',
    'base', 'countries', 'hydro', 'hydroEdits',
    'territorialUnits', 'distributions', 'genericFeatures', 'stackOverlays', 'projectedOverlays',
    'selectionData', 'selectionView', 'selectionStyle', 'territorialLabelPositions', 'userLabelPositions',
    'labelLayout', 'territorialLabels', 'userLabels', 'viewPresentation', 'debug', 'objectSearch',
  ];
  const renderers = Object.fromEntries(names.map(name => [name, (...args) => {
    calls.push([name, ...args]);
    if (name === 'view') return viewFrameResult;
    return name === 'labelLayout' ? { territorialLabels: [], userLabels: [] } : undefined;
  }]));
  const coordinator = createMapRenderCoordinator({
    requestFrame: callback => frames.push(callback),
    prepareView: () => { calls.push(['prepare']); return viewState; },
    renderers,
  });
  return { calls, frames, coordinator, viewState, viewFrameResult };
}

test('scheduled view and full renders merge into one full frame', () => {
  const { calls, frames, coordinator } = fixture();
  assert.equal(coordinator.invalidate(MAP_RENDER_MASKS.VIEW, 'pan'), true);
  assert.equal(coordinator.invalidate(MAP_RENDER_MASKS.PROJECT, 'selection'), false);
  assert.equal(coordinator.invalidate(MAP_RENDER_MASKS.RESIZE, 'resize'), false);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(coordinator.getStats().renderRevision, 1);
  assert.equal(calls.some(call => call[0] === 'hydro'), true);
  assert.equal(calls.some(call => call[0] === 'territorialLabelPositions'), false);
  assert.deepEqual(coordinator.getStats().lastReasons, ['pan', 'selection', 'resize']);
});

test('camera settle refreshes viewport-culled objects once before drawing their land mask', () => {
  const { calls, frames, coordinator } = fixture();
  coordinator.beginInteraction();
  coordinator.invalidate(MAP_RENDER_MASKS.VIEW, 'pan-to-child');
  frames.shift()();
  assert.equal(calls.some(call => call[0] === 'territorialUnits'), false, 'drag frames reuse prepared geometry');
  calls.length = 0;
  coordinator.endInteraction('viewport-culling-settle');
  frames.shift()();
  for (const name of ['hydroEdits', 'territorialUnits', 'distributions', 'genericFeatures']) {
    assert.equal(calls.filter(call => call[0] === name).length, 1, `${name} must recheck the settled viewport`);
  }
  assert.ok(calls.findIndex(call => call[0] === 'territorialUnits') < calls.findIndex(call => call[0] === 'countries'));
  assert.equal(calls.some(call => ['draft', 'vertices', 'selectionData'].includes(call[0])), false);
  assert.equal(coordinator.getStats().fullRenderCount, 0);
});

test('selection data and view invalidations use independent render paths', () => {
  const { calls, frames, coordinator } = fixture();
  coordinator.invalidate(MAP_RENDER_DIRTY.SELECTION_DATA, 'selection-change');
  frames.shift()();
  assert.equal(calls.filter(call => call[0] === 'selectionData').length, 1);
  assert.equal(calls.some(call => call[0] === 'selectionView'), false);

  calls.length = 0;
  coordinator.invalidate(MAP_RENDER_DIRTY.SELECTION_VIEW, 'selection-pan');
  frames.shift()();
  assert.equal(calls.filter(call => call[0] === 'selectionView').length, 1);
  assert.equal(calls.some(call => call[0] === 'selectionData'), false);
});

test('domain geometry patches do not rebuild unrelated overlay domains', () => {
  const { calls, frames, coordinator } = fixture();
  coordinator.invalidate(MAP_RENDER_DIRTY.GENERIC_PATCH, 'generic-vertex-commit');
  frames.shift()();
  assert.equal(calls.filter(call => call[0] === 'genericFeatures').length, 1);
  assert.equal(calls.filter(call => call[0] === 'countries').length, 1);
  assert.equal(calls.some(call => call[0] === 'territorialUnits'), false);
  assert.equal(calls.some(call => call[0] === 'distributions'), false);
  assert.equal(calls.some(call => call[0] === 'hydroEdits'), false);

  calls.length = 0;
  coordinator.invalidate(MAP_RENDER_DIRTY.HYDRO_EDIT_PATCH, 'hydro-vertex-commit');
  frames.shift()();
  assert.equal(calls.filter(call => call[0] === 'hydroEdits').length, 1);
  assert.equal(calls.some(call => call[0] === 'countries'), false);
  assert.equal(calls.some(call => call[0] === 'genericFeatures'), false);
});

test('invalid masks throw in strict mode without queuing or widening a frame', () => {
  const { coordinator, frames } = fixture();
  for (const input of [0, 'view', {}, Number.NaN, Number.POSITIVE_INFINITY, 1 << 29, 2 ** 32]) {
    assert.throws(
      () => coordinator.invalidate(input, 'invalid-test'),
      error => error instanceof RenderInvalidationError && error.code === 'PL-RENDER-MASK-001',
    );
  }
  assert.equal(frames.length, 0);
  assert.equal(coordinator.getStats().requestCount, 0);
  assert.equal(coordinator.getStats().invalidMaskCount, 7);

  coordinator.invalidate(MAP_RENDER_MASKS.VIEW, 'valid-view');
  assert.throws(() => coordinator.invalidate('full', 'invalid-after-valid'), /Invalid render invalidation mask/);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(coordinator.getStats().lastRequestedMask, MAP_RENDER_MASKS.VIEW);
  assert.equal(coordinator.getStats().fullRenderCount, 0);
});

test('invalid masks are safely reported in production mode', () => {
  const frames = [];
  const errors = [];
  const coordinator = createMapRenderCoordinator({
    requestFrame: callback => frames.push(callback),
    prepareView: () => ({ revision: 1 }),
    renderers: {},
    invalidMaskMode: 'report',
    onInvalidMask: error => errors.push(error),
  });
  assert.equal(coordinator.invalidate('unknown', 'production-invalid'), false);
  assert.equal(frames.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'PL-RENDER-MASK-001');
  assert.equal(coordinator.getStats().lastInvalidMask, 'unknown');
});

test('merged work bits never become a project frame without the project trigger', () => {
  const { frames, coordinator } = fixture();
  const triggerMask = MAP_RENDER_DIRTY.RESIZE | MAP_RENDER_DIRTY.PROJECTION | MAP_RENDER_DIRTY.PROJECT;
  const workMask = Object.values(MAP_RENDER_DIRTY)
    .reduce((mask, bit) => mask | (triggerMask & bit ? 0 : bit), 0);
  coordinator.invalidate(workMask, 'all-work-bits');
  frames.shift()();
  const stats = coordinator.getStats();
  assert.equal(stats.fullRenderCount, 0);
  assert.equal(stats.projectFrameCount, 0);
  assert.equal(stats.lastMode, 'partial');
  assert.equal(stats.recentFrames.at(-1).frameKind, 'partial');
});

test('resize and projection triggers reproject visible domains without becoming project frames', () => {
  for (const [mask, counter] of [
    [MAP_RENDER_MASKS.RESIZE, 'resizeFrameCount'],
    [MAP_RENDER_MASKS.PROJECTION, 'projectionFrameCount'],
  ]) {
    const { calls, frames, coordinator } = fixture();
    coordinator.invalidate(mask, counter);
    frames.shift()();
    const names = calls.map(call => call[0]);
    assert.equal(names.filter(name => name === 'countries').length, 1);
    assert.equal(names.includes('base'), true);
    assert.equal(names.includes('hydro'), true);
    assert.equal(names.includes('territorialUnits'), true);
    assert.equal(names.includes('distributions'), true);
    assert.equal(names.includes('genericFeatures'), true);
    assert.equal(names.includes('projectedOverlays'), true);
    assert.equal(names.includes('labelLayout'), true);
    assert.equal(names.includes('view'), false, 'scene draw must not be duplicated before the country renderer');
    assert.equal(coordinator.getStats()[counter], 1);
    assert.equal(coordinator.getStats().projectFrameCount, 0);
    assert.equal(coordinator.getStats().fullRenderCount, 0);
  }
});

test('selection-only frames do not draw the base scene or rebuild geometry', () => {
  const { calls, frames, coordinator } = fixture();
  coordinator.invalidate(MAP_RENDER_DIRTY.SELECTION_DATA | MAP_RENDER_DIRTY.GPU_INTERACTION, 'selection-only');
  frames.shift()();
  const names = calls.map(call => call[0]);
  assert.equal(names.filter(name => name === 'selectionData').length, 1);
  for (const forbidden of ['view', 'base', 'countries', 'hydro', 'territorialUnits', 'distributions', 'genericFeatures']) {
    assert.equal(names.includes(forbidden), false, `${forbidden} must not run in a selection-only frame`);
  }
});
});
