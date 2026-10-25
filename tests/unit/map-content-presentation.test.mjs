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
