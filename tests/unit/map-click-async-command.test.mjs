import assert from 'node:assert/strict';
import test from 'node:test';
import { createObjectPicking } from "../../shared/frontend/js/modules/object-picking.js";
import { normalizeObjectRef } from "../../shared/frontend/js/modules/object-selection-controller.js";

import { editorNode } from './helpers/dom-node-fixture.mjs';









async function chooser(t) {
  const previousDocument=globalThis.document,previousFrame=globalThis.requestAnimationFrame;
  globalThis.document={createElement:editorNode};globalThis.requestAnimationFrame=()=>0;
  t.after(()=>{globalThis.document=previousDocument;globalThis.requestAnimationFrame=previousFrame;});
  let resolve,reject;const acknowledgement=new Promise((accept,fail) => { resolve=accept;reject=fail; });
  const refs=['G','H'].map(id=>normalizeObjectRef({ domain: 'generic',type: 'feature',id })),calls=[],owner=createObjectPicking({openEditor:true});
  const nodes=new Map(['objectChooser','objectChooserList','map'].map(id=>[id,editorNode()]));
  owner.connect({ projectState: { state: { tool:'select',layerVisibility: { genericFeatures: true },
      genericFeatures:refs.map(ref=>({id:ref.id,geometry:{type:'Point',coordinates:[1,2]}})) } },
    selectionServices: { normalizeObjectRef },
    objectOperationsA: { objectRefVisible: ref=>refs.some(item=>item.key===ref.key),objectDisplayInfo:ref=>({name:ref.id,type:'feature'}) },
    layerPresentation:{isLayerItemVisible:()=>true},renderScene:{OVERLAY_GROUPS:['genericFeatures']},
    rendering:{selectionPerformanceMetrics:{}},mapLayout:{viewRevision:1},
    mapView:{screenToGeo:point=>point,activeProjection:()=>point=>point},
    spatialRecords:{indexedMapObjectCandidates:()=>refs,geometryBoundsCache:new WeakMap()},
    cutGeometry:{coordinateBounds:([x,y])=>[x,y,x,y]},labelPresentation:{currentMapZoom:()=>1},
    landRelations:{pointInCountryFeature:()=>assert.fail('Point picking must not query polygon interiors')},
    surfaces:{isMobile:()=>false},platform:{$:id=>nodes.get(id),clamp:(value,min,max)=>Math.max(min,Math.min(value,max))},
    domains: { projectDomain:{getGeneration:()=>1},selectionDomain:{has:()=>false},
      selectionUiController: { applyIntent: (value,options) => { calls.push([value,options]);return acknowledgement; } } } });
  assert.equal(await owner.handleObjectSelectionAt([1,2],{sourceEvent:{}}),true);
  assert.equal(nodes.get('objectChooserList').children.length,2);
  assert.deepEqual(calls,[],'opening the overlap chooser must not select before acknowledgement');
  return { owner,resolve,reject,calls };
}
test('object chooser waits for the canonical selection acknowledgement and retains the captured intent',async t => {
  const f=await chooser(t),pending=f.owner.chooseObjectCandidate(0,{ toggle: true });let done=false;
  pending.then(() => { done=true; });assert.equal(done,false);assert.equal(f.calls[0][0].id,'G');
  assert.deepEqual(f.calls[0][1],{ mode: 'toggle',scope: 'map',openEditor:true });f.resolve(true);assert.equal(await pending,true);
});
test('object chooser propagates its Worker rejection to the explicit chooser event boundary',async t => {
  const f=await chooser(t),pending=f.owner.chooseObjectCandidate(0),failure=Object.assign(new Error('Selection worker failed'),{ code: 'STALE_REVISION' });
  f.reject(failure);await assert.rejects(pending,error => error===failure);
});
