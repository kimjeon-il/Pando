import { describe as contractSuite } from 'node:test';
import { createGpuScene } from '../../shared/frontend/js/modules/gpu-scene.js';
import * as __contract_dep0 from "node:assert/strict";
import * as __contract_dep1 from "node:test";
import * as __contract_dep2 from "../../shared/frontend/js/modules/gpu-scene-preparation.js";
import * as __contract_dep3 from "../../shared/frontend/js/modules/gpu-base-scene-pass.js";
import * as __contract_dep4 from "node:fs";
import * as __contract_dep5 from "../../shared/frontend/js/modules/map-content-presentation.js";
const assert = __contract_dep0.default;
const test = __contract_dep1.default;
const { prepareGpuBaseScene, commitGpuStrokeDomains } = __contract_dep2;
const { drawGpuBaseScene } = __contract_dep3;

const packet = (key, revision, domain = 'boundaries', objectKey = '') => ({
  key, domain, objectKey, sourceKey: `stroke:${key}:${revision}:high:flat`, geometryRevision: revision,
  startsEnds: new Float32Array([revision, 0, revision + 1, 1]), byteLength: 16,
  style: { alpha: 1, width: 2 },
});
function harness() {
  const presentedStrokeDomains = new Map(), resources = new Set(), uploaded = [], released = [];
  const strokeRenderer = {
    hasPreparedResource: value => resources.has(value.key), hasResource: key => resources.has(key),
    ensureResource: value => { uploaded.push(value); return { resource: null, reason: 'upload-pending' }; },
    releaseResource: key => { resources.delete(key); released.push(key); },
  };
  const prepare = strokes => prepareGpuBaseScene({ scene: { polygons: [], strokes },
    frame: { projectGeneration: 7 }, presentedStrokeDomains }, { strokeRenderer });
  const ready = (...rows) => rows.forEach(row => resources.add(`scene-stroke:${row.sourceKey}`));
  const accept = result => commitGpuStrokeDomains({ frameId: 1, projectGeneration: 7,
    overlayRenderedKeys: result.overlayItems.map(row => row.packet.key), overlayMissingKeys: [],
    strokeDomainReplacements: result.strokeDomainReplacements }, { frameId: 1, projectGeneration: 7 }, presentedStrokeDomains, strokeRenderer);
  return { prepare, ready, accept, presentedStrokeDomains, resources, uploaded, released };
}
test('a stroke domain retains A while every replacement resource in B is prepared', () => {
  const h = harness(), a = packet('line', 1), b = packet('line', 2), extra = packet('new-line', 2);
  h.ready(a); h.accept(h.prepare([a]));
  const waiting = h.prepare([b, extra]);
  assert.deepEqual(waiting.overlayItems.map(row => row.packet), [a]);
  assert.deepEqual(waiting.strokeDomainReplacements, []);
  assert.equal(waiting.deferredOverlayKeys.has('line'), true);
  assert.equal(waiting.failedOverlayKeys.size, 0, 'pending uploads are not failures');
  h.ready(b);
  assert.deepEqual(h.prepare([b, extra]).overlayItems.map(row => row.packet), [a], 'partial readiness cannot promote a domain');
  h.ready(extra);
  const prepared = h.prepare([b, extra]);
  assert.deepEqual(prepared.overlayItems.map(row => row.packet), [b, extra]);
  assert.equal(h.presentedStrokeDomains.get('boundaries')[0].packet, a, 'preparation is not presentation');
  h.accept(prepared);
  assert.deepEqual(h.presentedStrokeDomains.get('boundaries').map(row => row.packet), [b, extra]);
  assert.deepEqual(h.released, [`scene-stroke:${a.sourceKey}`]);
});
test('failed and stale presentation cannot release A or promote a prepared B', () => {
  const h = harness(), a = packet('a', 1), b = packet('a', 2); h.ready(a); h.accept(h.prepare([a])); h.ready(b);
  const prepared = h.prepare([b]);
  const result = { frameId: 1, projectGeneration: 7, overlayRenderedKeys: [], overlayMissingKeys: ['a'],
    strokeDomainReplacements: prepared.strokeDomainReplacements };
  const renderer = { releaseResource: () => assert.fail('failed presentation released A') };
  assert.equal(commitGpuStrokeDomains(result, { frameId: 1, projectGeneration: 7 }, h.presentedStrokeDomains, renderer), false);
  assert.equal(commitGpuStrokeDomains({ ...result, overlayRenderedKeys: ['a'], overlayMissingKeys: [] },
    { frameId: 2, projectGeneration: 7 }, h.presentedStrokeDomains, renderer), false);
  assert.equal(h.presentedStrokeDomains.get('boundaries')[0].packet, a);
});
test('an aggregate visibility scope change rejects the old boundary archive while replacement uploads wait', () => {
  const h = harness(), a = { ...packet('a', 1), continuityOwnerIds: ['A', 'B'] }; h.ready(a); h.accept(h.prepare([a]));
  const b = { ...packet('a', 2), continuityOwnerIds: ['A'] };
  assert.deepEqual(h.prepare([b]).overlayItems, [], 'deleted or hidden B cannot survive in an aggregate resource');
});
test('adding a visible object preserves the still-valid old aggregate during its replacement upload', () => {
  const h = harness(), a = { ...packet('a', 1), continuityOwnerIds: ['A', 'B'] }; h.ready(a); h.accept(h.prepare([a]));
  const b = { ...packet('a', 2), continuityOwnerIds: ['A', 'B', 'C'] };
  assert.deepEqual(h.prepare([b]).overlayItems.map(row => row.packet), [a]);
});
test('same-key revisions get independent GPU resource identities', () => {
  const h = harness(), a = packet('line', 1), b = packet('line', 2);
  h.prepare([a]); h.prepare([b]);
  assert.equal(new Set(h.uploaded.map(row => row.key)).size, 2);
});
test('deleting a distribution sibling sharing an objectKey removes that exact visual while another upload waits', () => {
  const h = harness(), one = packet('entry:one:line', 1, 'distribution', 'layer:one'), two = packet('entry:two:line', 1, 'distribution', 'layer:one');
  h.ready(one, two); h.accept(h.prepare([one, two]));
  const next = packet('entry:one:line', 2, 'distribution', 'layer:one');
  assert.deepEqual(h.prepare([next]).overlayItems.map(row => row.packet), [one]);
  assert.equal(h.prepare([next]).canPreserveStrokeScene, false, 'the old whole-scene texture still contains the deleted sibling');
});
test('a superseded ready B cannot replace the current desired C or an A return', () => {
  const h = harness(), a = packet('line', 1), b = packet('line', 2), c = packet('line', 3);
  h.ready(a); h.accept(h.prepare([a])); h.prepare([b]); h.ready(b);
  assert.deepEqual(h.prepare([c]).overlayItems.map(row => row.packet), [a]);
  assert.deepEqual(h.prepare([a]).overlayItems.map(row => row.packet), [a]);
});
test('independent domains can promote while another retains its old strokes', () => {
  const h = harness(), a = packet('a', 1), other = packet('other', 1, 'other');
  h.ready(a, other); h.accept(h.prepare([a, other]));
  const b = packet('a', 2), next = packet('other', 2, 'other'); h.ready(next);
  const result = h.prepare([b, next]);
  assert.deepEqual(result.overlayItems.map(row => row.packet), [a, next]);
});
test('empty domains, removed objects and disabled strokes do not leave old geometry', () => {
  const h = harness(), a = packet('a', 1, 'boundaries', 'object:a'), other = packet('other', 1, 'boundaries', 'object:other');
  h.ready(a, other); h.accept(h.prepare([a, other]));
  assert.deepEqual(h.prepare([packet('a', 2, 'boundaries', 'object:a')]).overlayItems.map(row => row.packet), [a]);
  assert.deepEqual(h.prepare([{ ...a, style: { alpha: 0, width: 2 } }]).overlayItems, []);
  assert.deepEqual(h.prepare([]).overlayItems, []);
});
test('a new project can reuse the exact requested resource but cannot display previous project fallback', () => {
  const h = harness(), a = packet('a', 1); h.ready(a); h.accept(h.prepare([a]));
  const result = prepareGpuBaseScene({ scene: { strokes: [a] }, frame: { projectGeneration: 8 },
    presentedStrokeDomains: new Map() }, { strokeRenderer: {
    hasPreparedResource: row => h.resources.has(row.key), ensureResource: () => ({ resource: null, reason: 'upload-pending' }),
  } });
  assert.deepEqual(result.overlayItems.map(row=>row.packet), [a]);
  const changed=prepareGpuBaseScene({scene:{strokes:[packet('a',2)]},frame:{projectGeneration:8},
    presentedStrokeDomains:h.presentedStrokeDomains},{strokeRenderer:{
      hasPreparedResource:row=>h.resources.has(row.key),ensureResource:()=>({resource:null,reason:'upload-pending'}),
    }});
  assert.deepEqual(changed.overlayItems,[]);
});
test('a failed prepared B draw redraws eligible A before publication and cannot promote B', () => {
  const h = harness(), a = packet('line', 1), b = packet('line', 2); h.ready(a); h.accept(h.prepare([a])); h.ready(b);
  const prepared = h.prepare([b]), drawn = [];
  const gl = new Proxy({}, { get: (_target, key) => /^[A-Z_]+$/.test(key) ? key : () => {} });
  const result = drawGpuBaseScene({ gl, frame: { frameId: 1, projectGeneration: 7 }, surfacePresentation:{quality:'canonical'}, countries: {}, prepared }, {
    drawOceanSubstrate() {}, drawHydro() {}, drawCountryBoundaryStrokes() {}, strokeRenderer: { ...h,
      hasResource: key => h.resources.has(key),
      drawBatches: rows => { const row = rows[0]; drawn.push(row.geometryRevision);
        return row.geometryRevision === 2 ? { renderedKeys: [], missingKeys: [row.key], failures: [{ key: row.key, reason: 'GPU draw failed' }] }
          : { renderedKeys: [row.key], missingKeys: [], failures: [] }; },
    },
  });
  assert.deepEqual(drawn, [2, 1], 'retry is one same-frame redraw of the previously presented domain');
  assert.deepEqual(result.overlayMissingKeys, []);
  assert.deepEqual(result.strokeDomainReplacements, []);
  assert.deepEqual(result.recoveredStrokeDomains, ['boundaries']);
  assert.equal(result.strokePresentationFailed, false);
  assert.equal(prepared.canPreserveStrokeScene, true);
  assert.equal(commitGpuStrokeDomains(result, { frameId: 1, projectGeneration: 7 }, h.presentedStrokeDomains,
    { releaseResource: () => assert.fail('failed B must not release A') }), false);
});
test('failure of both B and eligible A is a failed presentation with no promotion', () => {
  const h = harness(), a = packet('line', 1), b = packet('line', 2); h.ready(a); h.accept(h.prepare([a])); h.ready(b);
  const gl = new Proxy({}, { get: (_target, key) => /^[A-Z_]+$/.test(key) ? key : () => {} });
  const result = drawGpuBaseScene({ gl, frame: { frameId: 1, projectGeneration: 7 }, surfacePresentation:{quality:'canonical'}, countries: {}, prepared: h.prepare([b]) }, {
    drawOceanSubstrate() {}, drawHydro() {}, drawCountryBoundaryStrokes() {}, strokeRenderer: {
      hasResource: () => true, drawBatches: rows => ({ renderedKeys: [], missingKeys: rows.map(row => row.key) }),
    },
  });
  assert.equal(result.strokePresentationFailed, true);
  assert.deepEqual(result.strokeDomainReplacements, []);
});
contractSuite("gpu-scene-worker-presentation", () => {
const test = __contract_dep1.default;
const assert = __contract_dep0.default;
const { readFileSync } = __contract_dep4;

test('failed polygon preparation clears pending identity and retries the current input',async()=>{
  let attempts=0, ready=false, scheduled=null, presented=0, errorReports=0,renderer='webgl2',canvasRequests=0,baseInvalidations=0;
  const builder={
    clear(){},setCacheByteBudget(){},releasePrepared(){},cancelPreparation(){},
    missingPolygons:()=>ready?[]:[{cacheKey:'polygon:A'}],
    preparePolygons:()=>++attempts===1?Promise.reject(new Error('temporary worker error'))
      :Promise.resolve().then(()=>{ready=true;}),
    build:input=>({revision:input.revision,revisions:input.revisions,polygons:input.polygons||[],strokes:input.strokes||[]}),
    patch:(previous,input)=>({...previous,...input,polygons:input.polygons||previous.polygons,strokes:input.strokes||previous.strokes}),
  };
  const scene=createGpuScene();
  scene.connect({
    projectState:{state:{layerPresentation:{},layerVisibility:{objects:true,rivers:true,lakes:true},
      pendingCountryRenderIds:new Set(),physicalSettings:{terrainVisible:false},projection:'flat',stateRevision:1},
      mapWorkScheduler:{cancel(){},scheduleIdle(_key,fn){scheduled=fn;}}},
    interactionPresentation:{currentGpuInteractionFillItems:[]},
    interactionStateCommands:{replaceGpuInteractionFillItems(){}},
    countries:{countryLandRevision:1},mapLayout:{viewRevision:1},
    renderScene:{createRenderSceneBuilder:()=>builder,currentRenderQuality:{revision:1,backgroundLod:'high',renderPacketCacheBudgetBytes:1024},OVERLAY_GROUPS:[]},
    platform:{runtimeAssetUrl:name=>name},
    rendering:{gpuMapRenderer:{getRuntimeState:()=>({renderer}),setRenderScene(){presented++;},
      requestPreparedCanvasFrame(){canvasRequests++;}}},
    domains:{renderingDomain:{invalidateBaseScene(){baseInvalidations++;},invalidateGpuInteraction(){}}},
    feedback:{reportOperationError(){errorReports++;}},
  });
  scene.initializeGpuSceneDomains();scene.initializeGpuSceneResourceObjectKeys();scene.initializeRenderSceneBuilder();
  scene.replaceGpuSceneDomain('generic-features',{polygons:[{key:'A',geometryRevision:'v1',
    geometry:{type:'Polygon',coordinates:[]},style:{color:'#ffffff'}}]});
  scene.syncGpuRenderScene();
  await Promise.resolve();await Promise.resolve();
  assert.equal(attempts,1);
  assert.equal(typeof scheduled,'function');
  assert.equal(errorReports,0);
  scheduled();
  scene.syncGpuRenderScene();
  await Promise.resolve();await Promise.resolve();
  assert.equal(attempts,2);
  assert.ok(presented>=1);
  renderer='canvas-worker';ready=false;
  scene.replaceGpuSceneDomain('generic-features',{polygons:[{key:'A',geometryRevision:'v2',
    geometry:{type:'Polygon',coordinates:[]},style:{color:'#ffffff'}}]});
  scene.syncGpuRenderScene();
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(attempts,3);
  assert.equal(canvasRequests,1,'prepared Canvas resources must submit a real bitmap');
  assert.equal(baseInvalidations,1,'Canvas path must invalidate base rather than interaction only');
  assert.ok(presented>=1);
});

test('restored base country strokes invalidate the base scene rather than interaction only',()=>{
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-map-renderer.js',import.meta.url),'utf8');
  const begin=source.indexOf('    function overlayResourceReady(key) {');
  const end=source.indexOf('    function buildCountryStrokeResource(',begin);
  assert.ok(begin>=0 && end>begin);
  const events=[];
  const ready=new Function('sceneColorCache','invalidateGpuFrame','scheduleGpuInteractionFrame',
    'renderScene','sceneStrokeResourcePacket','projectGeneration','promotePreparedCountryBoundary',
    source.slice(begin,end)+'\nreturn overlayResourceReady;')(
    {invalidate:reason=>events.push(['cache',reason])},
    reason=>events.push(['base',reason]),reason=>events.push(['interaction',reason]),
    {polygons:[],strokes:[]},()=>({key:''}),1,()=>events.push(['shared','promote'])
  );
  ready('country-boundary:canonical');
  assert.ok(events.some(([kind])=>kind==='base'),'base country stroke upload must schedule a composited frame');
  assert.equal(events.some(([kind])=>kind==='interaction'),false);
  events.length=0;
  ready('ui-selection-only');
  assert.deepEqual(events,[['interaction','interaction-resource-ready']]);
});

test('Canvas Worker submits the latest view when a drag finishes',()=>{
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-map-renderer.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
  const renderStart=source.indexOf('    function renderCanvasWorker(visualFrame) {');
  const renderEnd=source.indexOf('\n    // Reconnect an asynchronously prepared physical scene',renderStart);
  const latestStart=source.indexOf('    function prioritizeLatest() {');
  const latestEnd=source.indexOf('\n    function ',latestStart+1);
  assert.ok(renderStart>=0&&renderEnd>renderStart&&latestStart>=0&&latestEnd>latestStart);
  const create=new Function(`
    let interactionActive=false, rendererMode='canvas-worker', lastVisualFrame=null, projectGeneration=1;
    const sent=[], canvasWorker={queueFrame:frame=>sent.push(frame)};
    const resize=()=>{}, syncCanvasWorkerState=()=>{}, canvasWorkerViewMessage=frame=>frame||lastVisualFrame;
    ${source.slice(renderStart,renderEnd)}
    ${source.slice(latestStart,latestEnd)}
    return {sent, move:frame=>{lastVisualFrame=frame;renderCanvasWorker(frame);},
      setGeneration:value=>{projectGeneration=value;},
      begin:()=>{interactionActive=true;}, finish:()=>{interactionActive=false;prioritizeLatest();}};
  `);
  const h=create();h.setGeneration(0);h.move({id:'pre-document'});
  h.begin();h.finish();
  assert.deepEqual(h.sent,[],'pre-document work cannot block the current project');
  h.setGeneration(1);h.move({id:0});h.begin();h.move({id:1});h.move({id:2});h.finish();
  assert.deepEqual(h.sent.map(frame=>frame.id),[0,2]);
});


test('Canvas rejection reasons classify stale style, physical scene and source identities without accepting old pixels',()=>{
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-map-renderer.js',import.meta.url),'utf8');
  const begin=source.indexOf('          const canvasFrameRejectionReason =');
  const end=source.indexOf('          canvasWorker = createGpuCanvasWorker(',begin);
  const map={frameId:4};
  let style=3,geom=7,quality='canonical',physical=true;
  const initial={frameId:4,presentationKey:'current',geometryRevision:7,
    styleRevision:3,surfaceQuality:'canonical'};
  const factory=new Function('lastVisualFrame','currentCanvasPresentationKey','geometryRevisionTracker',
    'canvasStyleRevision','surfacePresentation','canvasWorkerFrameMatchesPhysical','getPhysicalContextState',
    'currentCanvasPhysical','canvasBackgroundEligible','currentCanvasBackgroundKey','canvasPhysicalStyleRevision',
    source.slice(begin,end)+';return canvasFrameRejectionReason;');
  const make=()=>factory(map,()=> 'current',{committedRevision:()=>geom},style,
    {quality},()=>physical,()=>({}),()=>({context:{ready:true}}),()=>false,()=> 'background',3);
  assert.equal(make()(initial),'');
  assert.equal(make()({...initial,frameId:3}),'',
    'a scheduling-only frameId must not discard an identical physical picture');
  assert.equal(make()({...initial,presentationKey:'old'}),'presentation');
  assert.equal(make()({...initial,geometryRevision:4}),'geometry');
  style=4;assert.equal(make()(initial),'style');style=3;
  quality='pending';assert.equal(make()(initial),'quality');quality='canonical';
  physical=false;assert.equal(make()(initial),'physical');
});

});
contractSuite("gpu-scene-presentation-ownership", () => {
const test = __contract_dep1.default;
const assert = __contract_dep0.default;
const { createMapContentPresentation } = __contract_dep5;

function fixture() {
  const actions={pending:0,replace:0,sync:0,draw:0,coverage:[]};
  const countries={
    getState:()=>({layerVisibility:{objects:true},pendingCountryRenderIds:new Set()}),
    renderPendingCountryOverlays:()=>{actions.pending++;},
    replaceGpuSceneDomain:()=>{actions.replace++;},
    syncGpuRenderScene:()=>{actions.sync++;},
    applyGpuSceneCoverage:value=>actions.coverage.push(value),
    gpuMapRenderer:{renderFrame:()=>{actions.draw++;return{succeeded:true};}},
  };
  const content=createMapContentPresentation({countries,active:()=>{},requireFrame:value=>value});
  return {actions,content,frame:{__mapVisualFrame:true,frameId:9}};
}

test('presentation-only country pass cannot replace scene after GPU draw but retains coverage',()=>{
  const f=fixture(), result={succeeded:true,frameId:9};
  const outcome=f.content.renderCountries(f.frame,{presentationOnly:true,gpuResult:result});
  assert.equal(outcome,result);
  assert.equal(f.actions.pending,1,'SVG pending-country outlines still update on the approved frame');
  assert.equal(f.actions.replace,0,'presentation must not overwrite drawn GPU scene');
  assert.equal(f.actions.sync,0,'presentation must not advance rendered scene identity');
  assert.equal(f.actions.draw,0,'presentation must not draw a second GPU frame');
  assert.deepEqual(f.actions.coverage,[result]);
});

test('normal country pass still synchronizes geometry and draws before presenting',()=>{
  const f=fixture(),result=f.content.renderCountries(f.frame);
  assert.deepEqual([f.actions.pending,f.actions.replace,f.actions.sync,f.actions.draw],[1,1,1,1]);
  assert.deepEqual(f.actions.coverage,[result]);
});
});
