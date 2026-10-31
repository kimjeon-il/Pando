import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapContentPresentation} from '../../shared/frontend/js/modules/map-content-presentation.js';

function setup() {
  const updates=[];
  const state={layerVisibility:{objects:true},pendingCountryRenderIds:new Set()};
  const countries={
    getState:()=>state,
    renderPendingCountryOverlays:()=>updates.push('svg'),
    replaceGpuSceneDomain:()=>updates.push('replace-scene'),
    syncGpuRenderScene:()=>updates.push('sync-scene'),
    gpuMapRenderer:{renderFrame:()=>({succeeded:true})},
    applyGpuSceneCoverage:()=>{},applyGpuInteractionCoverage:()=>{},
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
