import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapContentPresentation} from "../../shared/frontend/js/modules/map-content-presentation.js";
import {normalizeLayerPresentation,layerStyle,overlayVisualOrder} from "../../shared/frontend/js/modules/layer-presentation.js";
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
