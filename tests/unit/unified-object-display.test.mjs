import { describe as contractSuite } from 'node:test';
import * as __merge_dep0 from "../helpers/viewing-project.mjs";
import * as __merge_dep1 from "../../src/map/object-picking.js";
import * as __merge_dep2 from "node:fs";
import * as __merge_dep3 from "../helpers/core-project.mjs";
import * as __merge_dep4 from "node:test";
import * as __merge_dep5 from "node:assert/strict";
import * as __merge_dep6 from "../../src/ui/map-display-catalog.js";
import * as __merge_dep7 from "../../src/ui/layer-presentation.js";
import * as __merge_dep8 from "../../src/document/object-query.js";
import * as __merge_dep9 from "../../src/ui/object-selection-controller.js";
import * as __merge_dep10 from "../../src/document/territorial-units.js";
import * as __merge_dep11 from "../../src/document/territorial-entity-repository.js";
import * as __merge_dep12 from "../../src/ui/country-flags.js";
import * as __merge_dep13 from "../../src/ui/object-search-controller.js";
import * as __merge_dep14 from "../../src/document/territorial-entity-store.js";
contractSuite("unified-object-display", () => {
const { createTestViewingSession } = __merge_dep0;
const { createObjectPicking } = __merge_dep1;
const { readFileSync } = __merge_dep2;
const { createNodeCoreProject } = __merge_dep3;
const test = __merge_dep4.default;
const assert = __merge_dep5.default;
const { MAP_DISPLAY_TARGETS } = __merge_dep6;
const { normalizeLayerPresentation, layerStyle } = __merge_dep7;
const { createObjectQuery } = __merge_dep8;
const { normalizeObjectRef } = __merge_dep9;

test('all territorial objects share one display group irrespective of kind or parent',()=>{
 const rows={A:{id:'A',properties:{entityKind:'general',parentId:''}},B:{id:'B',properties:{entityKind:'general',parentId:'A'}},R:{id:'R',properties:{entityKind:'regional',parentId:'A'}}};
 const state={timelineCursor:'1914-06',layerVisibility:{objects:true},itemVisibility:{objects:{B:false}}};
 const query=createObjectQuery({selectionServices:{normalizeObjectRef},projectState:{state},territorialModel:{entityRepository:{get:id=>rows[id]}},layerPresentation:{isLayerItemVisible:(group,id)=>state.itemVisibility[group]?.[id]!==false}});
 assert.deepEqual(Object.keys(MAP_DISPLAY_TARGETS).filter(key=>['objects','countries','subunits','regions'].includes(key)),['objects']);
 for(const id of Object.keys(rows)){const ref={domain:'territorial',type:'entity',id};assert.equal(query.layerGroupForObjectRef(ref),'objects');}
 for(const id of ['A','R'])assert.equal(query.objectRefVisible({domain:'territorial',type:'entity',id}),true);
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
 const state={tool:'select',timelineCursor:'1914-06',layerVisibility:{objects:true},itemVisibility:{objects:{}}};
 const entity={id:'A',properties:{entityKind:'general',parentId:''}};
 const queryPorts={projectState:{state},selectionServices:{normalizeObjectRef},
  territorialModel:{entityRepository:{get:id=>id===entity.id?entity:null}},
  layerPresentation:{isLayerItemVisible:(group,id)=>state.itemVisibility[group]?.[id]!==false}};
 picking.connect({...queryPorts,objectOperationsA:createObjectQuery(queryPorts),
  countries:{builtinTerritorialScene:()=>({labelRefs:new Map([['A',ref]])})},platform:{$:()=>null,d3:{event:{}}},
  domains:{selectionUiController:{applyIntent:async(value,options)=>intents.push({value,options})}},
  feedback:{reportOperationError:error=>errors.push(error)}});
 await picking.handleMapClick([5,5],{territorialLabelId:'A'});
 assert.deepEqual(errors,[]);assert.equal(intents.length,1);assert.deepEqual(intents[0].value,ref);
 assert.equal(intents[0].options.scope,'map');
 state.itemVisibility.objects.A=false;
 await picking.handleMapClick([5,5],{territorialLabelId:'A'});
 assert.deepEqual(errors,[]);assert.equal(intents.length,1,'hidden objects must be rejected by the same shared query');
});
});
contractSuite("shared-object-view", () => {
const test = __merge_dep4.default;
const assert = __merge_dep5.default;
const { createObjectQuery } = __merge_dep8;
const { createTerritorialFeature } = __merge_dep10;
const { createTerritorialEntityRepository } = __merge_dep11;
const { normalizeObjectRef } = __merge_dep9;
const { effectiveTerritorialFlagUrl } = __merge_dep12;

test('the shared territorial display view resolves default, custom and absent flags for hover',()=>{
 const geometry={type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]};
 const features=[createTerritorialFeature({id:'FRA',name:'프랑스',entityKind:'general',geometry}),
  createTerritorialFeature({id:'child',name:'하위 객체',entityKind:'general',geometry,parentId:'FRA',metadata:{flagDataUrl:'data:image/svg+xml;base64,PHN2Zy8+'}}),
  createTerritorialFeature({id:'regional',name:'독립 권역',entityKind:'regional',geometry})];
 const repository=createTerritorialEntityRepository({getEntities:()=>features});
 const query=createObjectQuery({selectionServices:{normalizeObjectRef},territorialModel:{entityRepository:repository},
  objectPresentation:{territorialEntityName:feature=>feature.properties.name},layerPresentation:{ASSET_REVISION:'parity-test'}});
 for(const feature of features){
  const info=query.objectDisplayInfo({domain:'territorial',type:'entity',id:feature.id});
  assert.equal(info.name,feature.properties.name);
  assert.equal(info.flagUrl,effectiveTerritorialFlagUrl(feature,{assetRevision:'parity-test'}));
 }
});

test('the common visibility query honors hidden object items for selection and hover output',()=>{
 const feature=createTerritorialFeature({id:'A',name:'A',entityKind:'general',geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}});
 let visible=true;
 const query=createObjectQuery({projectState:{state:{timelineCursor:'2026-10',layerVisibility:{objects:true}}},
  selectionServices:{normalizeObjectRef},territorialModel:{entityRepository:createTerritorialEntityRepository({getEntities:()=>[feature]})},
  layerPresentation:{isLayerItemVisible:()=>visible},hydroPresentation:{hydroEditById:()=>null}});
 const ref={domain:'territorial',type:'entity',id:'A'};
 assert.equal(query.objectRefVisible(ref),true);
 visible=false;assert.equal(query.objectRefVisible(ref),false);
});
});
contractSuite("viewer-country-membership-p4-4", () => {
const test = __merge_dep4.default;
const assert = __merge_dep5.default;
const { createObjectSearchController } = __merge_dep13;
const { normalizeObjectRef } = __merge_dep9;
const { territorialMembershipDelta, createTerritorialEntityStore } = __merge_dep14;

function node() {
  const events=new Map(),classes=new Set();
  return {
    children:[],events,dataset:{},attributes:{},inert:false,
    classList:{toggle:(key,enabled)=>enabled?classes.add(key):classes.delete(key)},
    setAttribute(key,value){this.attributes[key]=value;},
    addEventListener(key,handler){events.set(key,handler);},
    append(...children){this.children.push(...children);},
    prepend(...children){this.children.unshift(...children);},
    replaceChildren(...children){this.children=children;},
    querySelectorAll(){return this.children.filter(child=>child.dataset.objectKey);},
    closest(selector){
      if(selector==='[data-object-search-select]'&&this.dataset.objectSearchSelect)return this;
      if(selector==='[data-object-search-focus]'&&this.dataset.objectSearchFocus)return this;
      return null;
    },
    contains(other){return this===other;},
  };
}
function searchFixture(){
  let rows=[{id:'OLD',name:'이전 국가'},{id:'REMAIN',name:'기존 국가'}];
  const state={search:'국가',searchActive:false,searchSurfaceOpen:true};
  const results=node(),input=node(),sections=node(),selected=[],focused=[],hovered=[],closed=[];
  const itemRef=(_group,id)=>normalizeObjectRef({domain:'territorial',type:'entity',id});
  const controller=createObjectSearchController({
    window:{setTimeout,clearTimeout},document:{createElement:node},
    elements:{searchResults:results,search:input,section:sections},
    groups:{search:['objects']},
    model:{snapshot:()=>state,items:()=>rows,itemRef,compare:(a,b)=>a.name.localeCompare(b.name),
      selectionSnapshot:()=>({selection:{items:[],primaryKey:null}})},
    createEmptyState:node,
    commands:{selectItem:({id})=>{selected.push(id);return true;},
      focusItem:(_group,id)=>focused.push(id),hoverItem:(_group,id)=>hovered.push(id),
      closeAfterSingleSelection:()=>closed.push(true)},
  });
  controller.bind();controller.render();
  const button=(id,action='select')=>{
    const row=results.children.find(child=>child.children[0]?.dataset.itemId===id);
    return row?.children[action==='focus'?1:0]||null;
  };
  const click=target=>results.events.get('click')({target,preventDefault(){},
    ctrlKey:false,metaKey:false,shiftKey:false});
  return {controller,results,state,selected,focused,hovered,closed,button,click,
    replace(next){rows=next;}};
}
const country=(id)=>({id,properties:{entityKind:'general',parentId:''},
  geometry:{type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]}});

test('P4-4 membership delta proves births and deaths without interpreting names as country IDs',()=>{
  const a=[country('OLD'),country('REMAIN')],b=[country('REMAIN'),country('NEW')];
  assert.deepEqual(territorialMembershipDelta(a,b),
    {addedIds:['NEW'],removedIds:['OLD'],changed:true});
  const renamed=structuredClone(a);renamed[0].properties.name='renamed';
  assert.deepEqual(territorialMembershipDelta(a,renamed),
    {addedIds:[],removedIds:[],changed:false});
});

test('P4-4 a C++ membership transition reports new and extinct country IDs for downstream renderers',()=>{
  let rows=[country('OLD'),country('REMAIN')],notify;
  const updates=[];
  const owner=createTerritorialEntityStore({
    documentModel:{territorialViews:()=>rows,list:()=>[],world:()=>({}),projectWorld:()=>({})},
    commandOwner:{state:()=>({}),resolveWorld:async()=>({}),
      setTimelineCursor:async()=>({state:{timelineCursor:'2006-12'}}),
      subscribeTransitions:callback=>{notify=callback;return ()=>{};}},
    onEntitiesReplaced:(_rows,change)=>updates.push(change),
  });
  const previous=rows;
  rows=[country('REMAIN'),country('NEW')];notify();
  // The accepted Core projection may rematerialize an unchanged row wrapper.
  // changedIds is a conservative render invalidation; membership is the
  // actual set difference and must not misclassify that surviving country.
  assert.ok(updates[0].changedIds.has('OLD'));
  assert.ok(updates[0].changedIds.has('NEW'));
  assert.deepEqual(territorialMembershipDelta(previous,rows),
    {addedIds:['NEW'],removedIds:['OLD'],changed:true});
  assert.equal(updates[0].rootGeometryChanged,true);
  assert.equal(updates[0].propertyOnly,false);
  assert.deepEqual(owner.snapshot().map(feature=>feature.id),['REMAIN','NEW']);
  owner.dispose();
});

test('P4-4 pending project keeps old search visible but inert and makes old actions no-ops',()=>{
  const f=searchFixture(),old=f.button('OLD'),oldFocus=f.button('OLD','focus');
  assert.ok(old&&oldFocus);
  const ticket=f.controller.beginProjectTransition();
  assert.equal(f.results.inert,true);
  assert.equal(f.results.attributes['aria-busy'],'true');
  assert.equal(f.controller.render(),false);
  f.click(old);f.click(oldFocus);
  assert.deepEqual(f.selected,[]);
  assert.deepEqual(f.focused,[]);
  f.replace([{id:'REMAIN',name:'기존 국가'},{id:'NEW',name:'신규 국가'}]);
  assert.equal(f.controller.endProjectTransition(ticket),true);
  assert.equal(f.results.inert,false);
  assert.equal(f.results.attributes['aria-busy'],'false');
  assert.equal(f.button('OLD'),null);
  assert.ok(f.button('NEW'));
  f.click(old);f.click(oldFocus);
  assert.deepEqual(f.selected,[],'removed row handlers stay inert even after new rows are mounted');
  assert.deepEqual(f.focused,[]);
  f.click(f.button('NEW'));
  assert.deepEqual(f.selected,['NEW']);
  assert.equal(f.closed.length,1);
  f.controller.dispose();
});

test('P4-4 superseded projects cannot unlock or publish previous search results',()=>{
  const f=searchFixture();
  const first=f.controller.beginProjectTransition();
  const next=f.controller.beginProjectTransition();
  f.replace([{id:'NEW',name:'신규 국가'}]);
  assert.equal(f.controller.endProjectTransition(first),false);
  assert.equal(f.results.inert,true);
  assert.ok(f.button('OLD'));
  assert.equal(f.controller.endProjectTransition(next),true);
  assert.equal(f.button('OLD'),null);
  assert.ok(f.button('NEW'));
  f.controller.dispose();
});

test('P4-4 aborted project restores the old country rows without resetting the active query',()=>{
  const f=searchFixture();
  const before=f.button('OLD');
  const request=f.controller.beginProjectTransition();
  assert.equal(f.controller.endProjectTransition(request),true);
  const after=f.button('OLD');
  assert.ok(after);
  assert.notEqual(before,after);
  assert.equal(f.state.search,'국가');
  f.click(before);assert.deepEqual(f.selected,[]);
  f.click(after);assert.deepEqual(f.selected,['OLD']);
  f.controller.dispose();
});
});
