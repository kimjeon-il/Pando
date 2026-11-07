import { describe as contractSuite } from 'node:test';
import * as __contract_dep0 from "node:test";
import * as __contract_dep1 from "node:assert/strict";
import * as __contract_dep2 from "../../shared/frontend/js/modules/object-catalog.js";
import * as __contract_dep3 from "../../shared/frontend/js/modules/object-query.js";
import * as __contract_dep4 from "../../shared/frontend/js/modules/object-selection-controller.js";
import * as __contract_dep5 from "../../shared/frontend/js/modules/territorial-entity-repository.js";
import * as __contract_dep6 from "node:test";
import * as __contract_dep7 from "node:assert/strict";
import * as __contract_dep8 from "../../shared/frontend/js/modules/object-search-model.js";

// Original feature contract: object-search-availability.test.mjs
contractSuite("object-search-availability", () => {
const test = __contract_dep0.default;
const assert = __contract_dep1.default;
const { createObjectCatalog } = __contract_dep2;
const { createObjectQuery } = __contract_dep3;
const { normalizeObjectRef } = __contract_dep4;
const { createTerritorialEntityRepository } = __contract_dep5;

test('search uses current existence and display visibility without truncating literal IDs',()=>{
 const entities=[{type:'Feature',id:'alpha:one',properties:{name:'기간 객체',entityKind:'general',parentId:'',validFrom:'1900-01-01',validTo:'1914-12-31'},geometry:{type:'Point',coordinates:[0,0]}}];
 const repository=createTerritorialEntityRepository({getEntities:()=>entities});
 const state={timelineCursor:'1914-06',layerVisibility:{objects:true},itemVisibility:{},labels:[],genericFeatures:[]};
 const ports={projectState:{state},territorialModel:{entityRepository:repository},selectionServices:{normalizeObjectRef},
  objectPresentation:{territorialRootName:()=>'',territorialEntityName:feature=>feature.properties.name},colorModel:{territorialEntityColor:()=>null},
  layerPresentation:{ASSET_REVISION:'test'},labelPresentation:{pendingCountryLabelAnchors:new Set()}};
 const query=createObjectQuery(ports);
 const catalog=createObjectCatalog({isObjectVisible:(group,id)=>query.objectRefVisible(query.layerItemObjectRef(group,id))});catalog.connect(ports);
 ports.layerPresentation.isLayerItemVisible=catalog.isLayerItemVisible;
 assert.deepEqual(query.layerItemObjectRef('objects','alpha:one'),normalizeObjectRef({domain:'territorial',type:'entity',id:'alpha:one'}));
 assert.equal(catalog.listObjectSearchItems('objects').length,1);
 assert.equal(query.visibleTerritorialCount(),1);
 state.layerVisibility.objects=false;assert.equal(catalog.listObjectSearchItems('objects').length,0);
 assert.equal(query.objectRefVisible(query.layerItemObjectRef('objects','alpha:one')),false);
 assert.equal(query.visibleTerritorialCount(),0);
 assert.equal(catalog.listObjectCatalogItems('objects').length,1,'the complete object catalog remains independent of search');
 state.layerVisibility.objects=true;state.timelineCursor='1915-01';assert.equal(catalog.listObjectSearchItems('objects').length,0);
 state.timelineCursor='1899-12';assert.equal(catalog.listObjectSearchItems('objects').length,0);
 state.timelineCursor='1914-12';state.itemVisibility.objects={'alpha:one':false};assert.equal(catalog.listObjectSearchItems('objects').length,0);
});

test('built-in selection and hover descriptions use the same active period name as search and map labels', async () => {
 const {normalizePlace}=await import("../../shared/frontend/js/modules/place-contract.js");
 const place=normalizePlace({source:'geonames',sourceId:'703448',name:'키이우',nameEn:'Kyiv',nameNative:'Київ',kind:'capital',coordinates:[30.52,50.45],nameTimeline:[{fromYear:1801,ko:'키예프'},{fromDate:'1991-08-24',ko:'키이우'}]});
 const state={timelineCursor:'1990-01'};
 const query=createObjectQuery({projectState:{state},preferences:{userPreferences:{labels:{place:{languages:{ko:true}}}}},selectionServices:{normalizeObjectRef},labelPresentation:{labelById:()=>place}});
 const ref={domain:'label',type:'capital',id:place.id};
 assert.equal(query.objectDisplayInfo(ref).name,'키예프');
 state.timelineCursor='2026-10';assert.equal(query.objectDisplayInfo(ref).name,'키이우');
});
});


// Original feature contract: flat-object-search.test.mjs
contractSuite("flat-object-search", () => {
const test = __contract_dep6.default;
const assert = __contract_dep7.default;
const { createObjectSearchModel, visibleObjectSearchRows } = __contract_dep8;
const model = data => createObjectSearchModel({items:group=>data[group]||[],groups:Object.keys(data),
  itemRef:(group,id)=>({key:`${group}:${id}`}),compare:(a,b)=>a.name.localeCompare(b.name)});
test('flat search preserves explicit object identity, name ordering, parent text and type matching without folder state',()=>{
  const result=model({objects:[{id:'same',name:'동명',searchText:'상위 객체'},{id:'child',name:'하위 객체',parentId:'same'}],labels:[{id:'same',name:'동명'}]});
  assert.equal(result.items.length,3);
  assert.deepEqual(visibleObjectSearchRows(result,'동명').map(row=>row.key),['labels:same','objects:same']);
  assert.deepEqual(visibleObjectSearchRows(result,'상위').map(row=>row.id),['same']);
  assert.deepEqual(visibleObjectSearchRows(result,'지명').map(row=>row.key),['labels:same']);
  assert.deepEqual(visibleObjectSearchRows(result,''),[]);
});
test('flat search deduplicates the same object across catalog groups and includes the full supplied global catalog',()=>{
  const rows=Array.from({length:1002},(_,id)=>({id:String(id),name:`객체 ${id}`}));
  const result=model({objects:rows});
  assert.equal(visibleObjectSearchRows(result,'객체').length,1002);
});

test('parent links do not create folders or hide cyclic entries in the flat result',()=>{
  const result=model({objects:[{id:'a',name:'객체 A',parentId:'b'},{id:'b',name:'객체 B',parentId:'a'}]});
  assert.deepEqual(visibleObjectSearchRows(result,'객체').map(row=>row.id),['a','b']);
});
});
