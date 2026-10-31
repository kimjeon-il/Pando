import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../../shared/frontend/js/modules/country-mesh-zoom-policy.js';

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
