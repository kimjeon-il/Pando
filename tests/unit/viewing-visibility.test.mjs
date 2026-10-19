import test from 'node:test';
import assert from 'node:assert/strict';
import {createObjectQuery} from '../../assets/js/modules/object-query.js';
import {normalizeObjectRef} from '../../assets/js/modules/object-selection-controller.js';
test('temporary master visibility and builtin background preferences constrain searchable objects',()=>{
 const state={layerVisibility:{genericFeatures:false,labels:true,rivers:true},itemVisibility:{hydro:{}},backgroundSettings:{builtinHydro:false,builtinPlaces:false},physicalSettings:{}};
 const query=createObjectQuery({selectionServices:{normalizeObjectRef},projectState:{state},
   layerPresentation:{isLayerItemVisible:()=>true},hydroPresentation:{hydroEditById:()=>null},hydroModel:{hydroFeatureById:()=>({id:'river-a'})}});
 assert.equal(query.objectRefVisible({domain:'generic',type:'feature',id:'A'}),false);
 assert.equal(query.objectRefVisible({domain:'hydro',type:'river',id:'river-a'}),false);
 state.backgroundSettings.builtinHydro=true;
 assert.equal(query.objectRefVisible({domain:'hydro',type:'river',id:'river-a'}),true);
 state.layerVisibility.rivers=false;
 assert.equal(query.objectRefVisible({domain:'hydro',type:'river',id:'river-a'}),false);
});
