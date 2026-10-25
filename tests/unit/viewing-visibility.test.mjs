import test from 'node:test';
import assert from 'node:assert/strict';
import {createObjectQuery} from "../../shared/frontend/js/modules/object-query.js";
import {normalizeObjectRef} from "../../shared/frontend/js/modules/object-selection-controller.js";
test('one category visibility controls searchable objects regardless of their source',()=>{
 const state={layerVisibility:{genericFeatures:false,labels:true,rivers:true},itemVisibility:{hydro:{}},physicalSettings:{}};
 const query=createObjectQuery({selectionServices:{normalizeObjectRef},projectState:{state},
   layerPresentation:{isLayerItemVisible:()=>true},hydroPresentation:{hydroEditById:()=>null},hydroModel:{hydroFeatureById:()=>({id:'river-a'})}});
 assert.equal(query.objectRefVisible({domain:'generic',type:'feature',id:'A'}),false);
 assert.equal(query.objectRefVisible({domain:'hydro',type:'river',id:'river-a'}),true);
 state.layerVisibility.rivers=false;
 assert.equal(query.objectRefVisible({domain:'hydro',type:'river',id:'river-a'}),false);
 state.layerVisibility.rivers=true;
 state.resourceCapabilities={builtinHydro:false};
 assert.equal(query.objectRefVisible({domain:'hydro',type:'river',id:'river-a'}),false);
 state.resourceCapabilities.builtinPlaces=false;
 assert.equal(query.objectRefVisible({domain:'label',type:'label',id:'builtin:place:test:one'}),false);
 assert.equal(query.objectRefVisible({domain:'label',type:'label',id:'authored-place'}),true);
});
