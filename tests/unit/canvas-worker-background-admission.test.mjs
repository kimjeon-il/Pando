import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../../shared/frontend/js/modules/country-mesh-zoom-policy.js';
import {createGpuCanvasWorker} from '../../shared/frontend/js/modules/gpu-canvas-worker.js';
import {readFileSync} from 'node:fs';

const input = Object.freeze({
  rendererMode: 'canvas-worker',
  committedBitmap: true,
  physicalSceneMatched: true,
  temporalPending: false,
});
const surface = Object.freeze({
  cssScale: 700,
  canonicalReady: true,
  focus: true,
});

test('a genuine current Canvas Worker bitmap admits an initial canonical country surface even while terrain tiles continue', () => {
  assert.equal(policy.resolveMapSurfacePresentation({...surface, backgroundPresented:false}).quality,'pending');
  const accepted=policy.canAdmitCanvasWorkerPartialBackground?.(input);
  assert.equal(accepted,true, 'a painted physical background must release the first country frame');
  assert.equal(policy.resolveMapSurfacePresentation({...surface,backgroundPresented:accepted}).quality,'canonical');
});
test('unpainted, wrong-backend and temporal replacements never authorize partial background admission', () => {
  for(const change of [
    {committedBitmap:false},{physicalSceneMatched:false},{temporalPending:true},
    {rendererMode:'webgl2'},{rendererMode:'webgl1'},{rendererMode:'canvas2d'},
  ])assert.equal(policy.canAdmitCanvasWorkerPartialBackground?.({...input,...change}),false);
});

const physical = Object.freeze({ready:true,landRevision:'land-v2',waterRevision:'water-v3'});
const painted = Object.freeze({physicalLandCount:1,physicalLandRevision:'land-v2',physicalWaterCount:1,physicalWaterRevision:'water-v3'});
test('only a bitmap containing current physical land and water may certify a Canvas Worker country frame',()=>{
  assert.equal(policy.canvasWorkerFrameMatchesPhysical(painted,physical),true);
  for(const input of [
    {physicalLandCount:0},{physicalLandCount:2},{physicalLandRevision:'land-v1'},
    {physicalWaterCount:0},{physicalWaterCount:2},{physicalWaterRevision:'water-v2'},
  ])assert.equal(policy.canvasWorkerFrameMatchesPhysical({...painted,...input},physical),false);
  assert.equal(policy.canvasWorkerFrameMatchesPhysical(painted,{...physical,ready:false}),false);
  assert.equal(policy.canvasWorkerFrameMatchesPhysical({},physical),false);
  assert.equal(policy.canvasWorkerFrameMatchesPhysical(painted,{ready:true,landRevision:'land-v2',waterRevision:null}),false);
  assert.equal(policy.canvasWorkerFrameMatchesPhysical({physicalLandCount:1,physicalLandRevision:'land-v2',physicalWaterCount:0},
    {ready:true,landRevision:'land-v2',waterRevision:null}),true);
});

test('a submitted physical WebGL base frame publishes countries without certifying unfinished terrain LOD',()=>{
  const eligible={rendererMode:'webgl2',submittedBaseFrame:true,physicalSceneMatched:true,temporalPending:false};
  assert.equal(policy.canAdmitWebGlPartialBackground(eligible),true);
  assert.equal(policy.canAdmitWebGlPartialBackground({...eligible,rendererMode:'webgl1'}),true);
  for(const change of [{submittedBaseFrame:false},{physicalSceneMatched:false},{temporalPending:true},
    {rendererMode:'canvas-worker'},{rendererMode:'canvas2d'}])
    assert.equal(policy.canAdmitWebGlPartialBackground({...eligible,...change}),false);
  assert.equal(policy.resolveMapSurfacePresentation({...surface,backgroundPresented:true}).quality,'canonical');
});


const canvasFixture = Object.freeze({
  frameId: 10, viewRevision: 3, projectionRevision: 2, projectGeneration: 1,
  projection: 'globe', cssViewport: [960, 672], dpr: 1,
  cssScale: 430, cssTranslate: [480, 336],
  safeInset: {top: 0, right: 0, bottom: 26, left: 0},
  viewState: {rotation: [-40, -20, 0], projectionCenter: null,
    flatCenter: [0, 20], flatZoom: 1, globeZoom: 1.5},
});
const canvasIdentity = Object.freeze({
  projectGeneration: 1, contextRevision: 2, geometryRevision: 1,
  paletteRevision: 5, physicalStyleRevision: 7, terrainVisible: true,
  surfaceQuality: 'canonical', surfaceGeometryQuality: 'canonical',
  surfaceTargetQuality: 'canonical',
});

test('Canvas bitmap picture identity survives only GPU-only frameId churn',()=>{
  const expected=policy.canvasWorkerPresentationKey(canvasFixture,canvasIdentity);
  assert.equal(policy.canvasWorkerPresentationKey({...canvasFixture,frameId:11},canvasIdentity),expected);
  for(const mutation of [
    {viewRevision:4}, {projectionRevision:3}, {projection:'flat'}, {cssScale:431},
    {cssViewport:[960,673]}, {cssTranslate:[481,336]}, {dpr:2},
    {viewState:{...canvasFixture.viewState,rotation:[-41,-20,0]}},
    {viewState:{...canvasFixture.viewState,flatCenter:[1,20]}},
  ])assert.notEqual(policy.canvasWorkerPresentationKey({...canvasFixture,...mutation},canvasIdentity),expected,
    'any distinct camera/viewport must reject the stale picture');
  for(const mutation of [
    {projectGeneration:2},{contextRevision:3},{geometryRevision:2},
    {paletteRevision:6},{physicalStyleRevision:8},{terrainVisible:false},
    {surfaceQuality:'pending'},{surfaceGeometryQuality:'preview'},
    {surfaceTargetQuality:'preview'},
  ])assert.notEqual(policy.canvasWorkerPresentationKey(canvasFixture,{...canvasIdentity,...mutation}),expected,
    'project/scene/style/quality changes must invalidate Worker pictures');
});

test('transport accepts a visually identical older scheduled frame but rejects wrong physical data and rotations',()=>{
  const sent=[],shown=[],rejected=[];let currentFrame=canvasFixture;
  const physical={ready:true,landRevision:'land-v2',waterRevision:null};
  const native={postMessage:message=>sent.push(message),terminate(){}};
  const channel=createGpuCanvasWorker({
    worker:native,generation:1,
    acceptFrame:message=>message.presentationKey===policy.canvasWorkerPresentationKey(currentFrame,canvasIdentity)
      && message.styleRevision===4
      && message.geometryRevision===1
      && message.surfaceQuality==='canonical'
      && policy.canvasWorkerFrameMatchesPhysical(message,physical),
    onStale:message=>rejected.push(message),
  });
  channel.onmessage=event=>{if(event.data.type==='frame')shown.push(event.data);};
  const sourceKey=policy.canvasWorkerPresentationKey(canvasFixture,canvasIdentity);
  channel.queueFrame({type:'view',frameId:10,revision:3,projectGeneration:1,presentationKey:sourceKey});
  native.onmessage({data:{type:'ready'}});
  assert.equal(sent.length,1);
  currentFrame={...canvasFixture,frameId:11};
  native.onmessage({data:{...sent[0],type:'frame',frameId:10,styleRevision:4,geometryRevision:1,
    surfaceQuality:'canonical',physicalLandCount:1,physicalLandRevision:'land-v2',
    physicalWaterCount:0,bitmap:{close(){assert.fail('current picture must not be closed');}}}});
  assert.equal(shown.length,1,'same camera with a newer coordinator frameId is admissible');
  assert.equal(rejected.length,0);
  const moved={...canvasFixture,frameId:12,viewState:{...canvasFixture.viewState,rotation:[-41,-20,0]}};
  currentFrame=moved;
  let closed=0;
  native.onmessage({data:{type:'frame',projectGeneration:1,revision:3,frameId:10,
    presentationKey:sourceKey,styleRevision:4,geometryRevision:1,surfaceQuality:'canonical',
    physicalLandCount:1,physicalLandRevision:'land-v2',physicalWaterCount:0,
    bitmap:{close(){closed++;}}}});
  assert.equal(closed,1);
  assert.equal(rejected.length,1,'a changed camera cannot inherit an old picture');
  currentFrame={...canvasFixture,frameId:13};
  native.onmessage({data:{type:'frame',projectGeneration:1,revision:3,frameId:10,
    presentationKey:sourceKey,styleRevision:4,geometryRevision:1,surfaceQuality:'canonical',
    physicalLandCount:0,physicalWaterCount:0,bitmap:{close(){closed++;}}}});
  assert.equal(closed,2);
  assert.equal(rejected.length,2,'zero physical-land packets must still be rejected');
  channel.terminate();
});

test('renderer binds Canvas bitmap admission to its picture key and commits the latest coordinator frame',()=>{
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-map-renderer.js',import.meta.url),'utf8');
  assert.match(source,/presentationKey: currentCanvasPresentationKey\(frame\)/);
  assert.match(source,/message\.presentationKey !== currentCanvasPresentationKey\(lastVisualFrame\)/);
  assert.match(source,/canvasWorkerFrameMatchesPhysical\(message, getPhysicalContextState\(\)\)/);
  assert.match(source,/frameId: Number\(presentedVisualFrame\.frameId\)/);
  assert.doesNotMatch(source,/Number\(message\.frameId\) !== Number\(lastVisualFrame\?\.frameId\)/);
});
