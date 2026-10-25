import test from 'node:test';
import assert from 'node:assert/strict';
import {createObjectCatalog} from "../../shared/frontend/js/modules/object-catalog.js";
import {createObjectQuery} from "../../shared/frontend/js/modules/object-query.js";
import {normalizeObjectRef} from "../../shared/frontend/js/modules/object-selection-controller.js";
import {createTerritorialEntityRepository} from "../../shared/frontend/js/modules/territorial-entity-repository.js";

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
