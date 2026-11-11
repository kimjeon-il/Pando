import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:assert/strict";
import * as __dep1 from "node:test";
import * as __dep2 from "../../fixtures/viewer-project-package.mjs";
import * as __dep3 from "../../helpers/core-project.mjs";
import * as __dep4 from "../../../src/document/territorial-entity-repository.js";
import * as __dep5 from "../../../src/document/distribution-model.js";
import * as __dep6 from "../../../src/ui/layer-presentation.js";
import * as __dep7 from "../../../src/ui/map-theme.js";
import * as __dep8 from "../../../src/document/generic-feature-normalization.js";
import * as __dep9 from "../../../src/ui/color-adapter.js";
import * as __dep10 from "../../../src/ui/map-content-presentation.js";
import * as __dep11 from "../../../src/document/object-ref-identity.js";
import * as __dep12 from "node:worker_threads";
import * as __dep13 from "../../../src/ui/map-display-client.js";
import * as __dep14 from "../../../src/runtime/worker-rpc.js";
import * as __dep15 from "../../../src/document/territorial-units.js";
import * as __dep16 from "../../../src/ui/map-display-menu-state.js";


import * as __dep19 from "../../../src/map/map-interaction-gate.js";
import * as __dep20 from "../../../src/ui/map-host.js";
import * as __dep21 from "../../../src/rendering/map-render-coordinator.js";
import * as __dep22 from "../../../src/rendering/gpu-base-scene-pass.js";
import * as __dep23 from "../../../src/document/initial-document.js";
import * as __dep24 from "../../../src/document/core-document-read-model.js";
import * as __dep25 from "../../../src/geometry/geometry-version-store.js";
import * as __dep26 from "node:vm";
import * as __dep27 from "node:fs";
import * as __dep28 from "../../helpers/map-transition-baseline.mjs";
contractSuite("map-content-scene", () => {
const assert = __dep0.default;
const test = __dep1.default;
const { createViewerProjectPackage } = __dep2;
const { createNodeCoreProject } = __dep3;
const { createTerritorialEntityRepository } = __dep4;
const { createDistributionLayer, createDistributionEntry } = __dep5;
const { normalizeLayerPresentation } = __dep6;
const { resolveMapTheme } = __dep7;
const { normalizeGenericFeatureSemantics } = __dep8;
const { readDomainColor, COLOR_DOMAINS } = __dep9;
const { createMapContentPresentation } = __dep10;
const { layerStyle, overlayVisualOrder } = __dep6;
const { normalizeObjectRef } = __dep11;
const { DISTRIBUTION_MODES, DISTRIBUTION_RENDER_MODES } = __dep5;

const square = { type: 'Polygon', coordinates: [[[1,1],[1,2],[2,2],[2,1],[1,1]]] };
const line = { type: 'LineString', coordinates: [[1,1],[2,2]] };
const ids = Object.fromEntries(['point','line','area','label','lake','population','temperature','expired','low','high','old','other','expired-entry']
  .map((name, index) => [name, `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));
const feature = (name, geometry) => normalizeGenericFeatureSemantics({ type: 'Feature', id: ids[name], geometry,
  properties: { schemaVersion: 2, name, color: '#112233', source: { kind: 'user' } } });


const chain=new Proxy(function(){},{get:(_target,key)=>key==='then'?undefined:()=>chain,apply:()=>chain});
async function fixture(t,mutate=()=>{},layers={}){
 const {project}=await createViewerProjectPackage();
 project.genericFeatures=[feature('line',line),feature('area',square)];
 project.layerPresentation=normalizeLayerPresentation({styles:{genericFeatures:{opacity:.5}}});mutate(project);
 const core=await createNodeCoreProject(project);t.after(core.dispose);
 const state={...core.documentModel.snapshot(),timelineCursor:'1914-06'};
 const entityRepository=createTerritorialEntityRepository({getEntities:()=>core.documentModel.territorialViews()});
 let scene={polygons:[],strokes:[]};let revision=0;
 const resources={getState:()=>state,layerStyle,normalizeObjectRef,
  isLayerItemVisible:(group,id)=>state.itemVisibility?.[group]?.[String(id)]!==false,
  visibleMapObjectCandidates:domains=>domains.includes('distribution')?state.distributionEntries.map(row=>({id:row.id})):
    domains.includes('generic')?state.genericFeatures.map(row=>({id:row.id})):core.documentModel.territorialViews().map(row=>({id:row.id})),
  geometryMayIntersectViewport:()=>true,replaceGpuSceneDomain:(_domain,packet)=>{scene.polygons.push(...packet.polygons||[]);scene.strokes.push(...packet.strokes||[]);},
  genericFeatureColor:feature=>feature.properties.color,gpuSceneOrder:(...args)=>overlayVisualOrder(state.layerPresentation,...args),
  buildRenderableStrokeFeature:feature=>feature,distributionLayer:layers.distribution||{selectAll:()=>chain},genericFeatureLayer:layers.generic,
  distributionColor:layer=>readDomainColor(COLOR_DOMAINS.DISTRIBUTION,{layer}).value,
  DISTRIBUTION_MODES,DISTRIBUTION_RENDER_MODES,territorialEntityRepository:entityRepository,
  featureFromGeometry:geometry=>({type:'Feature',properties:{},geometry}),getCountryGeometryRevision:()=>revision,getDistributionVisibilityRevision:()=>revision};
 const content=createMapContentPresentation({active:()=>{},framePath:()=>()=>'',isDisposed:()=>false,isSmooth:()=>true,
  generic:resources,distribution:resources,territorial:{...resources,displayEntities:()=>core.documentModel.territorialViews(),entityRepository},
  countries:{mapTheme:()=>resolveMapTheme({state,theme:'dark'})}});
 return {core,state,async build(month='1914-06'){
   await core.client.setTimelineCursor(month);state.timelineCursor=month;revision++;
   scene={polygons:[],strokes:[]};content.renderGenericFeatures({});content.renderDistributions({});return scene;
 },content};
}

test('rendered polygon and line objects do not create duplicate SVG hit paths',async t=>{
 const recorded=[];
 const layer={selectAll(selector){const selection={data(rows){recorded.push({selector,rows});return selection},enter(){return selection},exit(){return selection},append(){return selection},on(){return selection},attr(){return selection},style(){return selection},classed(){return selection},remove(){return selection}};return selection}};
 const f=await fixture(t,project=>{project.distributionLayers=[createDistributionLayer({id:ids.population,name:'인구'})];project.distributionEntries=[createDistributionEntry({id:ids.low,layerId:ids.population,mode:'geometry',geometry:square,value:10})];},{generic:layer,distribution:layer});
 const scene=await f.build();
 assert.ok(scene.polygons.length>0);assert.ok(scene.strokes.length>0);
 assert.ok(recorded.filter(row=>row.selector==='path.generic-feature-shape').every(row=>row.rows.length===0));
 assert.ok(recorded.filter(row=>row.selector==='path.distribution-shape').every(row=>row.rows.length===0));
});

test('the shared content owner keeps saved generic geometry and opacity without document writes',async t=>{
 const f=await fixture(t),before=f.core.documentModel.snapshot(),scene=await f.build();
 assert.equal(scene.strokes.find(row=>row.key===`generic:feature:${ids.line}:line`).style.alpha,.5);
 assert.equal(scene.polygons.find(row=>row.key===`generic:feature:${ids.area}:fill`).style.fillAlpha,.17);
 assert.deepEqual(scene.polygons.find(row=>row.key===`generic:feature:${ids.area}:fill`).geometry,square);
 assert.deepEqual(f.core.documentModel.snapshot(),before);assert.equal(f.core.client.state().canUndo,false);
});
test('distributions honor month-end validity, current territorial geometry, active layer and overlap', async t => {
  const f = await fixture(t, project => {
    project.distributionLayers = [
      createDistributionLayer({ id: ids.population, name: '인구', color: '#226688' }),
      createDistributionLayer({ id: ids.temperature, name: '기온', color: '#cc6644' }),
      createDistributionLayer({ id: ids.expired, validTo: '1914-06-29' }),
    ];
    project.distributionEntries = [
      createDistributionEntry({ id: ids.low, layerId: ids.population, mode: 'territorial', territorialUnitId: 'A', value: 10 }),
      createDistributionEntry({ id: ids.high, layerId: ids.population, mode: 'geometry', geometry: square, value: 30, validFrom: '1914-06-30' }),
      createDistributionEntry({ id: ids.old, layerId: ids.population, mode: 'geometry', geometry: square, value: 9999, validTo: '1914-06-29' }),
      createDistributionEntry({ id: ids.other, layerId: ids.temperature, mode: 'geometry', geometry: square, value: 20 }),
      createDistributionEntry({ id: ids['expired-entry'], layerId: ids.expired, mode: 'geometry', geometry: square, value: 20 }),
    ];
    project.distributionSettings = { renderMode: 'single', activeLayerId: ids.population, boundaryVisible: false };
  });
  let scene = await f.build();
  const rows = scene.polygons.filter(item => item.key.startsWith('distribution-entry:'));
  assert.deepEqual(rows.map(item => item.key), [`distribution-entry:${ids.low}:fill`,`distribution-entry:${ids.high}:fill`]);
  assert.equal(rows[0].style.fillAlpha, 0.12);
  assert.equal(rows[1].style.fillAlpha, 0.7);
  assert.deepEqual(rows[0].geometry, f.core.documentModel.territorialViews().find(item => item.id === 'A').geometry);
  assert.ok(!scene.strokes.some(item => item.key.startsWith('distribution-entry:')));
  const oldGeometry = rows[0].geometry;
  scene = await f.build('1914-07');
  assert.notDeepEqual(scene.polygons.find(item => item.key === `distribution-entry:${ids.low}:fill`).geometry, oldGeometry);
  f.state.distributionSettings = { ...f.state.distributionSettings, renderMode: 'overlap' };
  scene = await f.build('1914-07');
  assert.equal(scene.polygons.filter(item => item.key.startsWith('distribution-entry:')).length, 3);
  f.state.itemVisibility = { ...f.state.itemVisibility, distributions: { [ids.population]: false } };
  f.state.distributionSettings = { ...f.state.distributionSettings, renderMode: 'single' };
  scene = await f.build('1914-07');
  assert.deepEqual(scene.polygons.filter(item => item.key.startsWith('distribution-entry:')).map(item => item.key), [`distribution-entry:${ids.other}:fill`]);
});
});
contractSuite("map-display-client", () => {
const { describe : featureDescribe } = __dep1;
const __suiteDependency0 = __dep1;
const __suiteDependency1 = __dep0;
const __suiteDependency2 = __dep12;
const __suiteDependency3 = __dep13;
const __suiteDependency4 = __dep14;
const __suiteDependency5 = __dep15;
const __suiteDependency6 = __dep1;
const __suiteDependency7 = __dep0;
const __suiteDependency8 = __dep16;

const __suiteDependency10 = __dep0;

const __suiteDependency12 = __dep1;
const __suiteDependency13 = __dep19;
const __suiteDependency14 = __dep20;
featureDescribe("map-display-client", () => {
  const test = __suiteDependency0.default;
  const assert = __suiteDependency1.default;
  const { Worker } = __suiteDependency2;
  const { createMapDisplayClient } = __suiteDependency3;
  const { createWorkerRpcClient } = __suiteDependency4;
  const { createTerritorialFeature } = __suiteDependency5;
function createWorker(){const worker=new Worker(new URL("../../helpers/map-display-worker-thread.mjs",import.meta.url));const adapter={postMessage:value=>worker.postMessage(value),terminate:()=>worker.terminate()};worker.on('message',data=>adapter.onmessage?.({data}));worker.on('error',error=>adapter.onerror?.(error));return adapter;}
const shape=(id,x)=>createTerritorialFeature({id,entityKind:id==='CHILD'?'regional':'general',parentId:'',geometry:{type:'Polygon',coordinates:[[[0,0],[0,10],[x,10],[x,0],[0,0]]]}});
test('the actual common presentation Worker prepares boundaries and accepts current results without document writes',async t=>{
 const entities=[shape('ROOT',10),shape('CHILD',5)],before=structuredClone(entities);
 const client=createMapDisplayClient({createWorker,getEntities:()=>entities,getRevision:()=>1});t.after(client.dispose);
 const result=await client.prepare({kind:'boundaries'});assert.ok(result.result.segments.length);assert.deepEqual(entities,before);
 const highlight=await client.prepare({kind:'highlight',feature:entities[1],occluders:[{feature:entities[0]}]});assert.ok(highlight.result.feature.geometry);assert.deepEqual(entities,before);
});
test('the presentation transport discards results from a replaced document',async t=>{
 let revision=1;const client=createMapDisplayClient({createWorker,getEntities:()=>[shape('ROOT',10),shape('CHILD',5)],getRevision:()=>revision});t.after(client.dispose);
 const pending=client.prepare({kind:'boundaries'});revision++;
 await assert.rejects(pending,error=>error.code==='PL-WORKER-RPC-STALE');
});
test('the actual presentation Worker has no editing request handler',async t=>{
 const rpc=createWorkerRpcClient({createWorker});t.after(()=>rpc.stop());
 await assert.rejects(rpc.request('territorial-edit',{operation:'delete'}),error=>error.code==='PL-WORKER-RPC-UNKNOWN-OPERATION');
});
});
featureDescribe("map-display-menu-state", () => {
  const test = __suiteDependency6.default;
  const assert = __suiteDependency7.default;
  const { createMapDisplayMenuState } = __suiteDependency8;
test('desktop menu state owns its path and focus without sharing domain settings',()=>{
  const menu=createMapDisplayMenuState();
  assert.deepEqual(menu.path,[]);
  menu.setPath(['objects','labels']);
  assert.deepEqual(menu.path,['objects','labels']);
  assert.equal(menu.popPath(),'labels');
  assert.deepEqual(menu.path,['objects']);
  const focus={id:'row'};menu.rememberFocus(focus);
  assert.equal(menu.focusedControl,focus);
  menu.rememberFocus(null);
  assert.equal(menu.focusedControl,null);
});

test('a new pointer gesture cancels pending menu open and close',async()=>{
  const menu=createMapDisplayMenuState();
  let opened=0,closed=0;
  menu.scheduleOpen(()=>opened++,5);
  menu.scheduleClose(()=>closed++,5);
  menu.beginGesture(7);
  assert.equal(menu.gesture,7);
  assert.equal(menu.endGesture(8),false);
  assert.equal(menu.endGesture(7),true);
  await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(opened,0);assert.equal(closed,0);
});
});
featureDescribe("map-host", () => {

  const assert = __suiteDependency10.default;

  const test = __suiteDependency12.default;
  const {  createMapInteractionGate  } = __suiteDependency13;
  const {  normalizeMapSurfaceDragDelta,  } = __suiteDependency14;
test('MapHost surface drag contract preserves the user input direction', () => {
  assert.deepEqual(normalizeMapSurfaceDragDelta(40, 15), [40, 15]);
  assert.deepEqual(normalizeMapSurfaceDragDelta(-40, -15), [-40, -15]);
  assert.deepEqual(normalizeMapSurfaceDragDelta(Number.NaN, Number.POSITIVE_INFINITY), [0, 0]);
});

test('MapInteractionGate keeps labels in Pando and Space pan in the host', () => {
  const gate = createMapInteractionGate();
  const handle = { closest: selector => selector.includes('.user-label') ? {} : null };
  const background = { closest: () => null };
  assert.equal(gate.ownerForEvent(handle), 'pando');
  assert.equal(gate.ownerForEvent(background), 'host');
  gate.setNavigationEnabled(false);
  assert.equal(gate.ownerForEvent(background), 'pando');
  gate.setForcedPan(true);
  assert.equal(gate.ownerForEvent(handle), 'host');
});
});
});
contractSuite("map-loading-continuity", () => {
const test = __dep1.default;
const assert = __dep0.default;
const { createMapRenderCoordinator, MAP_RENDER_MASKS } = __dep21;
const { drawGpuBaseScene } = __dep22;
const { createInitialDocument } = __dep23;
const { createCoreDocumentReadModel } = __dep24;
const { createGeometryVersionStore } = __dep25;
const { resolveMapTheme } = __dep7;

test('project replacement preserves the presented scene without moving labels into the new document', () => {
  const frames=[],calls=[];let blocked=true;
  const coordinator=createMapRenderCoordinator({requestFrame:callback=>frames.push(callback),
    isPresentationBlocked:()=>blocked,prepareView:()=>{calls.push('prepare');return {revision:1};},
    renderers:{preservedFrame:()=>calls.push('preserve'),beginFrame:()=>calls.push('begin'),
      countries:()=>calls.push('countries'),territorialLabels:()=>calls.push('labels')}});
  coordinator.invalidate(MAP_RENDER_MASKS.PROJECT,'replacement');frames.shift()();
  assert.deepEqual(calls,['preserve']);
  blocked=false;coordinator.invalidate(MAP_RENDER_MASKS.PROJECT,'new-first-frame');frames.shift()();
  assert.deepEqual(calls,['preserve','prepare','begin','countries','labels']);
});

test('the shared base pass can show land and ocean before country mesh exists', () => {
  const draws=[];
  const gl=new Proxy({},{get:(_target,name)=>typeof name==='string'&&name.toUpperCase()===name?0:()=>{}});
  const prepared={baseTriangleDraw:{ranges:[]},overrideTriangleDraw:{ranges:[]},territoryItems:[],
    physicalLandItems:[{packet:{key:'land',role:'physical-land'}}],independentItems:[],
    deferredOverlayKeys:new Set(),failedOverlayKeys:new Set(),strokeDomainReplacements:[]};
  const result=drawGpuBaseScene({gl,frame:{frameId:1,projectGeneration:0},width:100,height:100,
    surfacePresentation:{quality:'pending',targetQuality:'canonical'},
    terrainVisible:true,terrainStyle:'physical',countriesVisible:true,mapSubstrate:{color:'#ccc',fillAlpha:1},
    countries:{mesh:null,overrideMesh:null},prepared},
  {drawProgram:()=>{throw new Error('Country data must not be drawn.');},drawOceanSubstrate:()=>draws.push('ocean-substrate'),renderTerrain:pass=>draws.push(pass),
    drawHydro:()=>{},drawCountryBoundaryStrokes:()=>({renderedKeys:[],missingKeys:[]}),
    polygonOverlayPass:{drawPackets:()=>draws.push('land')},strokeRenderer:{}});
  assert.deepEqual(draws,['ocean-substrate','land','land','ocean','land']);
  assert.equal(result.frameId,1);
  assert.equal(result.surface.quality,'pending');
  assert.equal(result.surface.landSource,'physical-background');
  assert.equal(result.surface.countryIndexCount,0);
});

test('the ocean substrate and hydro share the physical palette without changing political water', () => {
  const state={physicalSettings:{terrainVisible:true,terrainStyle:'physical'}};
  assert.equal(resolveMapTheme({state,theme:'light'}).ocean,'#6aa8d2');
  state.terrainManifest={displayColors:{oceanRepresentative:'#6496c8'}};
  assert.equal(resolveMapTheme({state,theme:'dark'}).ocean,'#517fb1');
  state.physicalSettings.terrainStyle='political';
  assert.equal(resolveMapTheme({state,theme:'light'}).ocean,'#ffffff');
});

test('accepting immutable geometry keeps the validated allocation and isolates mutable project properties', () => {
  const ref={id:'land',version:1};
  const store=createGeometryVersionStore([{...ref,geojson:{type:'Polygon',coordinates:[[[0,0],[2,0],[0,2],[0,0]]]}}]);
  const source=createInitialDocument({appVersion:'test'});source.geometries=store.snapshot();
  const model=createCoreDocumentReadModel(createInitialDocument({appVersion:'test'}));
  model.acceptLoadedProject(source);
  assert.deepEqual(model.geometry(ref),store.get(ref));
  source.labels.push({id:'outside'});
  assert.deepEqual(model.snapshot().labels,[]);
  const raw=structuredClone(source);raw.labels=[];model.acceptLoadedProject(raw);
  raw.geometries[0].geojson.coordinates[0][1][0]=77;
  assert.equal(model.geometry(ref).coordinates[0][1][0],2);
  assert.equal(Object.isFrozen(model.geometry(ref).coordinates[0][1]),true);
});
});
contractSuite("map-transition-baseline", () => {
const test = __dep1.default;
const assert = __dep0.default;
const { runInNewContext } = __dep26;
const { readFileSync } = __dep27;
const { semanticSnapshot, summarizeLatency, resourceDelta, replaceExactlyOnce, installMapBaselineCollector, instrumentMapBaselineSource } = __dep28;

const document = () => ({
  documentId: 'ephemeral', projectSetup: { initialMonth: '1950-12' },
  territorialEntities: [{ id: 'B', geometry: { coordinates: [[1, 2]] }, properties: { name: 'Beta' } },
    { id: 'A', properties: { name: 'Alpha', color: '#123456', flag: 'flag-a', parentId: '' } }],
  geometries: [{ id: 'g', version: 1, coordinates: [[[0, 0], [0, 1], [1, 0], [0, 0]]] }],
  timelineRecords: { lifetimes: [], geometryBindings: [], propertyBindings: [], parentRelations: [] },
});

test('semantic baseline ignores document instance metadata, not map content', () => {
  const a = document(), b = document(); b.documentId = 'another'; b.projectSetup.initialMonth = '1951-12';
  assert.deepEqual(semanticSnapshot(a), semanticSnapshot(b));
  assert.ok(semanticSnapshot(a).territorialEntities.length === 2);
});
test('semantic baseline normalizes object keys and entity order without mutating source', () => {
  const a = document(), original = structuredClone(a), b = document(); b.territorialEntities.reverse();
  assert.deepEqual(semanticSnapshot(a), semanticSnapshot(b)); assert.deepEqual(a, original);
});
for (const [field, value] of [['name', 'Changed'], ['color', '#ffffff'], ['flag', 'flag-b'], ['parentId', 'B']]) {
  test(`semantic baseline detects ${field} changes`, () => {
    const a = document(), b = document(); b.territorialEntities[1].properties[field] = value;
    assert.notDeepEqual(semanticSnapshot(a), semanticSnapshot(b));
  });
}
test('semantic baseline preserves full geometry coordinates and version', () => {
  const a = document(), b = document(); b.geometries[0].coordinates[0][1][1] = 1.00000001;
  assert.notDeepEqual(semanticSnapshot(a), semanticSnapshot(b));
  b.geometries[0].coordinates = a.geometries[0].coordinates; b.geometries[0].version = 2;
  assert.notDeepEqual(semanticSnapshot(a), semanticSnapshot(b));
});
test('semantic baseline detects entity existence and temporal record changes', () => {
  const a = document(), b = document(); b.territorialEntities.pop();
  assert.notDeepEqual(semanticSnapshot(a), semanticSnapshot(b));
  const c = document(); c.timelineRecords.lifetimes.push({ entityId: 'A', validTo: '1950-12-31' });
  assert.notDeepEqual(semanticSnapshot(a), semanticSnapshot(c));
});
test('missing semantic fields are a measurement failure, not an empty map', () => {
  assert.throws(() => semanticSnapshot({}), /territorialEntities/);
  const a = document(); delete a.geometries; assert.throws(() => semanticSnapshot(a), /geometries/);
});
test('latency summary uses nearest-rank percentiles and records sample count', () => {
  const result = summarizeLatency(Array.from({length: 20}, (_, i) => ({ ms: i + 1, outcome: 'success' })));
  assert.deepEqual(result, { count: 20, failed: 0, incomplete: 0, p50Ms: 10, p95Ms: 19, maxMs: 20, meanMs: 10.5 });
});
test('failed, incomplete and invalid samples cannot become zero-millisecond success', () => {
  assert.deepEqual(summarizeLatency([{ms: 7, outcome: 'success'}, {ms: 2, outcome: 'failed'}, {ms: null, outcome: 'incomplete'}]),
    {count: 1, failed: 1, incomplete: 1, p50Ms: 7, p95Ms: 7, maxMs: 7, meanMs: 7});
  for (const ms of [null, undefined, NaN, Infinity, -1]) assert.throws(() => summarizeLatency([{ms, outcome: 'success'}]), /latency/);
  assert.throws(() => summarizeLatency([{ms: 1, outcome: 'unknown'}]), /outcome/);
});
test('empty latency series remains explicitly unmeasured', () => {
  assert.deepEqual(summarizeLatency([]), {count: 0, failed: 0, incomplete: 0, p50Ms: null, p95Ms: null, maxMs: null, meanMs: null});
});
test('resource deltas preserve unsupported metrics and allow GC reductions', () => {
  assert.deepEqual(resourceDelta({heap: 10, gpu: null, workers: 2}, {heap: 8, gpu: null, workers: 3}),
    {heap: -2, gpu: null, workers: 1});
});
test('instrumentation must find one exact anchor; source drift fails closed', () => {
  assert.equal(replaceExactlyOnce('before ANCHOR after', 'ANCHOR', 'probe;ANCHOR'), 'before probe;ANCHOR after');
  assert.throws(() => replaceExactlyOnce('none', 'ANCHOR', 'probe'), /exactly one/);
  assert.throws(() => replaceExactlyOnce('ANCHOR ANCHOR', 'ANCHOR', 'probe'), /exactly one/);
});

function collector() {
  let now = 0; const handlers = {};
  const sandbox = { performance: {now: () => ++now},
    document: {addEventListener: (name, fn) => {handlers[name] = fn;}},
    PerformanceObserver: {supportedEntryTypes: []} };
  runInNewContext(`(${installMapBaselineCollector.toString()})()`, sandbox);
  return {probe: sandbox.__PANDO_P0__, handlers};
}
test('collector pairs actual input and displayed/settled markers without fabricating resources', () => {
  const {probe, handlers} = collector();
  handlers.click({target: {closest: () => ({id: 'timelinePreviousYear'})}});
  probe.begin('1950-12'); probe.presented('1950-12'); probe.settled();
  const data = probe.snapshot();
  assert.equal(data.events[0].origin, 'dom-input');
  assert.deepEqual(Array.from(data.events, row => row.kind), ['requested', 'presented', 'settled']);
  assert.equal(data.supported.longtask, false); assert.equal(data.resources.length, 0);
});
test('collector rejects wrong-month presentation and reports overlapping benchmark requests', () => {
  const {probe} = collector(); probe.begin('1950-12'); probe.presented('1951-12'); probe.begin('1952-12');
  assert.equal(probe.snapshot().errors.length, 2);
  assert.equal(probe.snapshot().events.some(row => row.kind === 'presented'), false);
});
test('collector distinguishes a handler-only start from a captured DOM input', () => {
  const {probe} = collector(); probe.begin('1950-12');
  assert.equal(probe.snapshot().events[0].origin, 'timeline-handler');
});
test('instrumentation preserves Core temporal adoption statement and refuses unsupported modules', () => {
  const statement = `await commandOwner.temporalCandidateAdopt({
          candidateId:prepared.candidateId,sourceId:prepared.sourceId,
          targetMonth:prepared.targetMonth,sourceFingerprint:prepared.sourceFingerprint,
          worldSha256:prepared.worldSha256,replacementId:checkpoint.replacementId,
          expectedEpoch:prepared.expectedEpoch,
        });`;
  const source = readFileSync(new URL("../../../src/document/project-domain.js", import.meta.url), 'utf8');
  const output = instrumentMapBaselineSource(source, 'project-domain.js');
  assert.ok(output.includes(statement)); assert.ok(output.includes('candidate-adopt:start')); assert.ok(output.includes('candidate-adopt:end'));
  assert.throws(() => instrumentMapBaselineSource('', 'unknown.js'), /Unknown probe/);
});

test('Worker timing probe preserves return values and errors and measures only temporal preparation', async () => {
  const {instrumentTemporalWorkerSource} = await import("../../helpers/map-transition-baseline.mjs");
  const original = "return projectResult(core[method](...(typeof args === 'function' ? args() : args)),core);";
  const source = instrumentTemporalWorkerSource(original);
  const measures = [];
  let tick = 0;
  const invoke = runInNewContext(`({core,method,args,projectResult}) => {${source}}`, {
    performance: {now: () => ++tick, measure: (name, options) => measures.push({name, ...options})},
  });
  const core = {temporalCandidatePrepare: value => value + 1, state: () => 7,
    temporalSourcePrepare: () => {throw new Error('source failure');}};
  assert.equal(invoke({core, method:'temporalCandidatePrepare', args:[2], projectResult: value => value}), 3);
  assert.equal(invoke({core, method:'state', args:[], projectResult: value => value}), 7);
  assert.throws(() => invoke({core, method:'temporalSourcePrepare', args:[], projectResult: value => value}), /source failure/);
  assert.deepEqual(measures.map(row => row.name), ['pando-worker:temporalCandidatePrepare','pando-worker:temporalSourcePrepare']);
  assert.throws(() => instrumentTemporalWorkerSource(''), /exactly one/);
  const runtime = readFileSync(new URL("../../../src/document/core-document-runtime.js", import.meta.url), 'utf8');
  assert.match(instrumentTemporalWorkerSource(runtime), /pando-worker:/);
});

test('diagnostic observation has a deadline when a browser stops replying', async () => {
  const {observeWithDeadline} = await import("../../helpers/map-transition-baseline.mjs");
  const result = await observeWithDeadline(() => new Promise(() => {}), 5);
  assert.equal(result.status, 'timeout'); assert.equal(result.value, null);
});
test('diagnostic observation distinguishes a real null, thrown error and data', async () => {
  const {observeWithDeadline} = await import("../../helpers/map-transition-baseline.mjs");
  assert.deepEqual(await observeWithDeadline(() => null), {status: 'ok', value: null});
  assert.deepEqual(await observeWithDeadline(() => ({count: 4})), {status: 'ok', value: {count: 4}});
  const failed = await observeWithDeadline(() => {throw new Error('closed page');});
  assert.equal(failed.status, 'failed'); assert.match(failed.error, /closed page/);
});

test('temporal probes instrument the active production sources on LF and CRLF checkouts',()=>{
 for(const [name,path] of [
  ['viewer-composition.js','src/app/viewer-composition.js'],
  ['project-domain.js','src/document/project-domain.js'],
 ]){
  const source=readFileSync(new URL("../../../"+path,import.meta.url),'utf8').replaceAll('\r\n','\n');
  const instrumented=instrumentMapBaselineSource(source,name);
  assert.equal(instrumentMapBaselineSource(source.replaceAll('\n','\r\n'),name),instrumented);
  if(name==='project-domain.js'){
   for(const phase of ['candidate-adopt','candidate-queue','temporal-source','temporal-candidate']){
    assert.match(instrumented,new RegExp(phase+':start'));
    assert.match(instrumented,new RegExp(phase+':end'));
   }
  }
 }
});
});
