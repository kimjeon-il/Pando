import test from 'node:test';
import assert from 'node:assert/strict';
import {createObjectQuery} from "../../shared/frontend/js/modules/object-query.js";
import {normalizeObjectRef} from "../../shared/frontend/js/modules/object-selection-controller.js";
import {normalizePlace} from "../../shared/frontend/js/modules/place-contract.js";
test('one category visibility controls searchable objects regardless of their source',()=>{
 const builtin=normalizePlace({source:'test',sourceId:'one',name:'Place',coordinates:[0,0]});
 const labels=[builtin,{id:'authored-place',name:'Authored place',validFrom:null,validTo:null}];
 const state={timelineCursor:'2026-10',genericFeatures:[{id:'A',properties:{validFrom:null,validTo:null}}],
   layerVisibility:{genericFeatures:false,labels:true,rivers:true},itemVisibility:{hydro:{}},physicalSettings:{}};
 const query=createObjectQuery({selectionServices:{normalizeObjectRef},projectState:{state},
   layerPresentation:{isLayerItemVisible:()=>true},labelPresentation:{labelById:id=>labels.find(label=>label.id===id)||null},
   hydroPresentation:{hydroEditById:()=>null},hydroModel:{hydroFeatureById:()=>({id:'river-a'})}});
 assert.equal(query.objectRefVisible({domain:'generic',type:'feature',id:'A'}),false);
 state.layerVisibility.genericFeatures=true;
 assert.equal(query.objectRefVisible({domain:'generic',type:'feature',id:'A'}),true);
 assert.equal(query.objectRefVisible({domain:'hydro',type:'river',id:'river-a'}),true);
 state.layerVisibility.rivers=false;
 assert.equal(query.objectRefVisible({domain:'hydro',type:'river',id:'river-a'}),false);
 state.layerVisibility.rivers=true;
 state.resourceCapabilities={builtinHydro:false};
 assert.equal(query.objectRefVisible({domain:'hydro',type:'river',id:'river-a'}),false);
 assert.equal(query.objectRefVisible({domain:'label',type:'label',id:'builtin:place:test:one'}),true);
 state.resourceCapabilities.builtinPlaces=false;
 assert.equal(query.objectRefVisible({domain:'label',type:'label',id:'builtin:place:test:one'}),false);
 assert.equal(query.objectRefVisible({domain:'label',type:'label',id:'authored-place'}),true);
});
