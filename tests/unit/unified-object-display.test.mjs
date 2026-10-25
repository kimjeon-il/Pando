import {createTestViewingSession} from '../helpers/viewing-project.mjs';
import {createObjectPicking} from "../../shared/frontend/js/modules/object-picking.js";
import {readFileSync} from 'node:fs';
import {createNodeCoreProject} from '../helpers/core-project.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {MAP_DISPLAY_TARGETS} from "../../shared/frontend/js/modules/map-display-catalog.js";
import {normalizeLayerPresentation,layerStyle} from "../../shared/frontend/js/modules/layer-presentation.js";
import {createObjectQuery} from "../../shared/frontend/js/modules/object-query.js";
import {normalizeObjectRef} from "../../shared/frontend/js/modules/object-selection-controller.js";

test('all territorial objects share one display group irrespective of kind or parent',()=>{
 const rows={A:{id:'A',properties:{entityKind:'general',parentId:''}},B:{id:'B',properties:{entityKind:'general',parentId:'A'}},R:{id:'R',properties:{entityKind:'regional',parentId:'A'}}};
 const state={layerVisibility:{objects:true},itemVisibility:{objects:{B:false}}};
 const query=createObjectQuery({selectionServices:{normalizeObjectRef},projectState:{state},territorialModel:{entityRepository:{get:id=>rows[id]}},layerPresentation:{isLayerItemVisible:(group,id)=>state.itemVisibility[group]?.[id]!==false}});
 assert.deepEqual(Object.keys(MAP_DISPLAY_TARGETS).filter(key=>['objects','countries','subunits','regions'].includes(key)),['objects']);
 for(const id of Object.keys(rows)){const ref={domain:'territorial',type:'entity',id};assert.equal(query.layerGroupForObjectRef(ref),'objects');}
 assert.equal(query.objectRefVisible({domain:'territorial',type:'entity',id:'B'}),false);
 rows.B.properties.parentId='';assert.equal(query.objectRefVisible({domain:'territorial',type:'entity',id:'B'}),false);
 rows.B.properties.entityKind='regional';assert.equal(query.objectRefVisible({domain:'territorial',type:'entity',id:'B'}),false);
 state.layerVisibility.objects=false;for(const id of Object.keys(rows))assert.equal(query.objectRefVisible({domain:'territorial',type:'entity',id}),false);
});
test('one object style owns color, opacity and boundary controls',()=>{
 const value=normalizeLayerPresentation({styles:{objects:{opacity:.4,colorVisible:false,boundaryVisible:false}}});
 assert.equal(layerStyle(value,'objects').opacity,.4);assert.equal(layerStyle(value,'objects').colorVisible,false);assert.equal(layerStyle(value,'objects').boundaryVisible,false);
 for(const key of ['countries','subunits','regions'])assert.equal(Object.hasOwn(value.styles,key),false);
});

test('Core preserves object visibility across temporal parent changes and only accepts unified current settings',async t=>{
 const seed=JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/complex.json',import.meta.url)));
 seed.projectSetup.initialMonth='1914-06';
 const owner=await createNodeCoreProject(seed);t.after(()=>owner.dispose());
 const viewing=createTestViewingSession(owner);t.after(viewing.dispose);viewing.session.setViewingPresentation({itemVisibility:{objects:{B:false}}});
 const before=JSON.parse(await owner.client.storageSnapshot());
 await owner.client.setTimelineCursor('1914-07');await owner.client.setTimelineCursor('1916-01');
 assert.deepEqual(JSON.parse(await owner.client.storageSnapshot()),before);
 assert.equal(viewing.session.state.itemVisibility.objects.B,false);
 const edited=await owner.project.executeCommand({commandId:'presentation.apply',targets:[],payload:{action:'groupStyle',group:'objects',patch:{opacity:.4,boundaryVisible:false}}});
 assert.equal(edited.ok,true,JSON.stringify(edited.error));
 assert.equal(owner.documentModel.snapshot().layerPresentation.styles.objects.opacity,.4);
 assert.equal(owner.documentModel.snapshot().layerPresentation.styles.objects.boundaryVisible,false);
 assert.equal(viewing.session.state.itemVisibility.objects.B,false);
 const saved=JSON.parse(await owner.client.storageSnapshot());assert.equal(saved.schemaVersion,14);assert.equal(saved.layerPresentation.schemaVersion,5);
 const reopened=await createNodeCoreProject(saved);try{assert.equal(Object.hasOwn(reopened.documentModel.snapshot(),'itemVisibility'),false);}finally{reopened.dispose();}
 await assert.rejects(owner.client.load(JSON.stringify({...saved,schemaVersion:12})),/UNSUPPORTED_VERSION/);
 const invalid={...saved,layerVisibility:{countries:true}};
 await assert.rejects(owner.client.load(JSON.stringify(invalid)),/PL-SCHEMA-FIELD/);
});

test('readonly picking selects through common rules without an editor service',async()=>{
 const intents=[],errors=[],picking=createObjectPicking();
 const ref={domain:'territorial',type:'entity',id:'A',key:'territorial:entity:A'};
 picking.connect({projectState:{state:{tool:'select',layerVisibility:{objects:true}}},
  selectionServices:{normalizeObjectRef},objectLookup:{objectRefExists:()=>true,isObjectAvailable:()=>true},
  layerPresentation:{isLayerItemVisible:()=>true},countries:{builtinTerritorialScene:()=>({labelRefs:new Map([['A',ref]])})},
  territorialModel:{entityRepository:{get:()=>null}},platform:{$:()=>null,d3:{event:{}}},
  domains:{selectionUiController:{applyIntent:async(value,options)=>intents.push({value,options})}},
  feedback:{reportOperationError:error=>errors.push(error)}});
 await picking.handleMapClick([5,5],{territorialLabelId:'A'});
 assert.deepEqual(errors,[]);assert.equal(intents.length,1);assert.deepEqual(intents[0].value,ref);
 assert.equal(intents[0].options.openEditor,false);
});

test('registered editor picking still commits vertex placement before ordinary selection',async()=>{
 const interactions=[],errors=[],picking=createObjectPicking({handleEditingClick:()=>assert.fail('placement must commit first')});
 picking.connect({projectState:{state:{tool:'select'}},domains:{editingDomain:{snapshot:()=>({vertexPlacement:true,projectGeneration:9}),
  handleInteraction:async intent=>interactions.push(intent)}},feedback:{reportOperationError:error=>errors.push(error)}});
 await picking.handleMapClick([5,5]);
 assert.deepEqual(errors,[]);assert.deepEqual(interactions,[{type:'vertex-placement-commit',projectGeneration:9,screenPoint:[5,5],pointerType:'touch'}]);
});
