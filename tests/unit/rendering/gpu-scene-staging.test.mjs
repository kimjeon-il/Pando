import { describe as contractSuite } from 'node:test';
import { createGpuScene } from "../../../src/rendering/gpu-scene.js";
import { createGpuCanvasWorker } from "../../../src/rendering/gpu-canvas-worker.js";
import { createCanvasScenePackets } from "../../../src/rendering/gpu-canvas-scene-packets.js";
import { classifyGpuResourceReady, classifyCanvasWorkerFrame } from "../../../src/rendering/map-render-publication.js";
import * as __contract_dep0 from "node:assert/strict";
import * as __contract_dep1 from "node:test";
import * as __contract_dep2 from "../../../src/rendering/gpu-scene-preparation.js";
import * as __contract_dep3 from "../../../src/rendering/gpu-base-scene-pass.js";
import * as __contract_dep5 from "../../../src/ui/map-content-presentation.js";
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
  const previousBaseInvalidations=baseInvalidations;
  scene.replaceGpuSceneDomain('generic-features',{polygons:[{key:'A',geometryRevision:'v2',
    geometry:{type:'Polygon',coordinates:[]},style:{color:'#ffffff'}}]});
  scene.syncGpuRenderScene();
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(attempts,3);
  assert.equal(canvasRequests,1,'prepared Canvas resources must submit a real bitmap');
  assert.equal(baseInvalidations-previousBaseInvalidations,1,'Canvas path must invalidate base once for the new scene');
  assert.ok(presented>=1);
});

test('resource completion classifies country boundaries, scene packets and selection fills',()=>{
  const scene={polygons:[{key:'polygon:A'}],strokes:[{key:'stroke:A',resourceKey:'mesh:A'}]};
  const classify=key=>classifyGpuResourceReady(key,scene,packet=>packet.resourceKey);
  for(const key of ['country-boundary:canonical','country-shared-boundary:world','country-outline-overrides:mesh'])
    assert.equal(classify(key),'country-boundary');
  assert.equal(classify('polygon:A'),'scene');
  assert.equal(classify('mesh:A'),'scene');
  assert.equal(classify('ui-selection-only'),'interaction');
});

test('Canvas transport retains only the latest queued view after an in-flight completion',()=>{
  const sent=[],worker={postMessage:message=>sent.push(message),terminate(){}};
  const channel=createGpuCanvasWorker({worker,generation:1,acceptFrame:()=>true});
  worker.onmessage({data:{type:'ready'}});
  const frame=id=>({type:'view',frameId:id,revision:id+1,projectGeneration:1});
  channel.queueFrame(frame(0));channel.queueFrame(frame(1));channel.queueFrame(frame(2));
  assert.equal(sent.length,1);
  worker.onmessage({data:{type:'frame',renderRequestId:sent[0].renderRequestId,
    projectGeneration:1,revision:1,bitmap:{close(){}}}});
  assert.equal(sent.length,2);
  assert.equal(sent[1].frameId,2);
  channel.terminate();
});

test('Canvas picture classifier rejects superseded geometry, style and physical sources',()=>{
  const source={expectedPresentationKey:'current',geometryRevision:7,
    styleRevision:3,surfaceQuality:'canonical',physicalMatches:true};
  const frame={frameId:4,presentationKey:'current',geometryRevision:7,
    styleRevision:3,surfaceQuality:'canonical'};
  const classify=(message,options=source)=>classifyCanvasWorkerFrame(message,options);
  assert.equal(classify(frame),'');
  assert.equal(classify({...frame,frameId:3}),'');
  assert.equal(classify({...frame,presentationKey:'old'}),'presentation');
  assert.equal(classify({...frame,geometryRevision:4}),'geometry');
  assert.equal(classify(frame,{...source,styleRevision:4}),'style');
  assert.equal(classify(frame,{...source,surfaceQuality:'pending'}),'quality');
  assert.equal(classify(frame,{...source,physicalMatches:false}),'physical');
  const bg={backgroundPresentationKey:'background',physicalStyleRevision:3};
  const ctx={backgroundEligible:true,expectedBackgroundKey:'background',physicalStyleRevision:3,physicalMatches:true};
  assert.equal(classify(bg,ctx),'');
  assert.equal(classify({...bg,backgroundPresentationKey:'old'},ctx),'background-presentation');
  assert.equal(classify({...bg,physicalStyleRevision:2},ctx),'physical-style');
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

test('unchanged renderer inputs do not rebuild scene packets or resource object indexes', () => {
  const calls = { build: 0, patch: 0, submit: 0 };
  const makeScene = (input, previous = {}) => ({
    revision: input.revision,
    revisions: { editPreview: 0, ...input.revisions }, // actual RenderScene default contract
    country: { ...(previous.country || {}), ...input.country },
    physical: { ...(previous.physical || {}), ...input.physical },
    quality: { ...(previous.quality || {}), ...input.renderQuality },
    interaction: { selectionPacket: input.interaction.selectionPacket,
      genericFillItems: [...input.interaction.genericFillItems] },
    polygons: previous.polygons || [], strokes: previous.strokes || [],
  });
  const builder = {
    setCacheByteBudget() {}, missingPolygons() { return []; }, releasePrepared() {}, clear() {},
    build(input) { calls.build++; return makeScene(input); },
    patch(previous, input) { calls.patch++; return makeScene(input, previous); },
  };
  const state = {
    layerPresentation: { overlayOrder: [] }, projection: 'flat', stateRevision: 0,
    layerVisibility: { objects: true, rivers: true, lakes: true },
    physicalSettings: { terrainVisible: false, terrainStyle: 'physical', hiddenHydroIds: {} },
    pendingCountryRenderIds: new Set(),
  };
  const mapLayout = { viewRevision: 1 };
  const renderer = createGpuScene();
  renderer.connect({
    projectState: { state, mapWorkScheduler: { cancel() {} } },
    renderScene: {
      createRenderSceneBuilder: () => builder,
      currentRenderQuality: { backgroundLod: 'high', renderPacketCacheBudgetBytes: 1024 },
      OVERLAY_GROUPS: [],
    },
    countries: { countryLandRevision: 1 }, mapLayout,
    interactionPresentation: { currentGpuInteractionFillItems: [] },
    interactionStateCommands: { replaceGpuInteractionFillItems() {} },
    rendering: { gpuMapRenderer: { setRenderScene() { calls.submit++; } } },
    platform: { runtimeAssetUrl: value => value },
  });
  renderer.initializeGpuSceneDomains();
  renderer.initializeGpuSceneResourceObjectKeys();
  renderer.initializeRenderSceneBuilder();
  const first = renderer.syncGpuRenderScene();
  assert.equal(first.revisions.editPreview, 0, 'normalized RenderScene adds a default revision');
  assert.equal(renderer.syncGpuRenderScene(), first);
  assert.deepEqual(calls, { build: 1, patch: 0, submit: 1 });
  state.layerVisibility.objects = false;
  renderer.syncGpuRenderScene();
  assert.equal(calls.patch, 1, 'changed presentation still patches existing packets');
  mapLayout.viewRevision++;
  renderer.syncGpuRenderScene();
  assert.equal(calls.patch, 2, 'changed view metadata still reaches the scene');
  renderer.syncGpuRenderScene();
  assert.equal(calls.patch, 2, 'settled frame does not create another scene');
  state.physicalSettings.terrainVisible = true;
  renderer.syncGpuRenderScene();
  assert.equal(calls.patch, 3, 'physical presentation changes still reach the scene');
  assert.equal(renderer.syncGpuRenderScene().revision, first.revision + 3,
    'no-op sync attempts cannot consume public scene revision numbers');
  renderer.initializeRenderSceneBuilder();
  assert.notEqual(renderer.syncGpuRenderScene(), first,
    'a fresh packet builder must never inherit an unverified no-op from an old owner');
});

test('Canvas Worker packets omit equivalent immutable geometry but resend changed identities', () => {
  const packets = createCanvasScenePackets();
  const packet = (sourceKey, coordinates) => ({
    key: 'land', sourceKey, ringCoordinates: Float64Array.from(coordinates),
    ringOffsets: Uint32Array.from([0, 4]), polygonOffsets: Uint32Array.from([0, 1]),
  });
  const first = packets.delta([packet('revision:one', [0, 0, 1, 0, 1, 1, 0, 0])], 'scene');
  assert.ok(first[0].ringCoordinates instanceof Float64Array);
  const repeated = packets.delta([packet('revision:one', [0, 0, 1, 0, 1, 1, 0, 0])], 'scene');
  assert.equal(Object.hasOwn(repeated[0], 'ringCoordinates'), false,
    'new typed arrays with certified unchanged source do not cross the Worker boundary');
  const changed = packets.delta([packet('revision:two', [0, 0, 2, 0, 2, 2, 0, 0])], 'scene');
  assert.ok(changed[0].ringCoordinates instanceof Float64Array);
  const anonymous = () => ({ key: 'unversioned', startsEnds: new Float32Array([0, 0, 1, 1]) });
  packets.delta([anonymous()], 'strokes');
  assert.ok(packets.delta([anonymous()], 'strokes')[0].startsEnds instanceof Float32Array,
    'unversioned geometry cannot be omitted merely because its values look similar');
  packets.clear();
  assert.ok(packets.delta([packet('revision:two', [0, 0, 2, 0, 2, 2, 0, 0])], 'scene')[0].ringCoordinates,
    'a new Worker generation must receive complete packet bytes');
});

test('GPU upload completion classifies an indexed immutable scene without rescanning packets', () => {
  const scene = { get polygons() { throw new Error('unnecessary polygon rescan'); },
    get strokes() { throw new Error('unnecessary stroke rescan'); } };
  const indexed = new Set(['overlay:one', 'scene-stroke:two']);
  assert.equal(classifyGpuResourceReady('overlay:one', scene, undefined, indexed), 'scene');
  assert.equal(classifyGpuResourceReady('scene-stroke:two', scene, undefined, indexed), 'scene');
  assert.equal(classifyGpuResourceReady('selection:one', scene, undefined, indexed), 'interaction');
  assert.equal(classifyGpuResourceReady('country-boundary:one', scene, undefined, indexed), 'country-boundary');
});
