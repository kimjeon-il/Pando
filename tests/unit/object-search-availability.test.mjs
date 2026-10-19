import test from 'node:test';
import assert from 'node:assert/strict';
import {createObjectCatalog} from '../../assets/js/modules/object-catalog.js';
import {createObjectQuery} from '../../assets/js/modules/object-query.js';
import {normalizeObjectRef} from '../../assets/js/modules/object-selection-controller.js';
import {createTerritorialEntityRepository} from '../../assets/js/modules/territorial-entity-repository.js';

test('search uses current existence and display visibility without truncating literal IDs',()=>{
 const entities=[{type:'Feature',id:'alpha:one',properties:{name:'기간 객체',entityKind:'general',parentId:'',validFrom:'1900-01-01',validTo:'1914-12-31'},geometry:{type:'Point',coordinates:[0,0]}}];
 const repository=createTerritorialEntityRepository({getEntities:()=>entities});
 const state={timelineCursor:'1914-06',layerVisibility:{countries:true},itemVisibility:{},labels:[],genericFeatures:[]};
 const ports={projectState:{state},territorialModel:{entityRepository:repository},selectionServices:{normalizeObjectRef},
  objectPresentation:{territorialEntityName:feature=>feature.properties.name},colorModel:{territorialEntityColor:()=>null},
  layerPresentation:{ASSET_REVISION:'test'},labelPresentation:{pendingCountryLabelAnchors:new Set()}};
 const query=createObjectQuery(ports);
 const catalog=createObjectCatalog({isObjectAvailable:(group,id)=>query.isObjectAvailable(query.layerItemObjectRef(group,id))});catalog.connect(ports);
 assert.deepEqual(query.layerItemObjectRef('countries','alpha:one'),normalizeObjectRef({domain:'territorial',type:'entity',id:'alpha:one'}));
 assert.equal(catalog.listObjectSearchItems('countries').length,1);
 state.layerVisibility.countries=false;assert.equal(catalog.listObjectSearchItems('countries').length,0);
 assert.equal(catalog.listObjectCatalogItems('countries').length,1,'the complete object catalog remains independent of search');
 state.layerVisibility.countries=true;state.timelineCursor='1915-01';assert.equal(catalog.listObjectSearchItems('countries').length,0);
 state.timelineCursor='1899-12';assert.equal(catalog.listObjectSearchItems('countries').length,0);
 state.timelineCursor='1914-12';state.itemVisibility.countries={'alpha:one':false};assert.equal(catalog.listObjectSearchItems('countries').length,0);
});
