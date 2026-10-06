import assert from 'node:assert/strict';
import test from 'node:test';
import {createTerritorialLibraryService} from '../../assets/js/modules/territorial-library-service.js';
const geometry={type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[0,0]]]};
const entity=(entityId,parentEntityId='',validTo=null)=>({schemaVersion:1,entityId,entityKind:'general',canonicalName:entityId,displayNames:{},alternateNames:[],parentEntityId,lifetime:{validFrom:null,validTo},geometryVersions:[{id:`${entityId}:v1`,validFrom:null,validTo,geometry,certainty:'high',datePrecision:'current',sourceId:'fixture'}],metadata:{},sourceInfo:{},instantiation:{mode:'independent',countryUpdates:{}}});
function fixture(){
 const entities=[entity('state:parent'),entity('state:child','state:parent'),entity('state:expired','state:parent','1991-12-25')];
 let loads=0; const cache=new Map();
 const loader={loadIndex:async()=>({schemaVersion:1,entities:entities.map(e=>({...e,geometryVersions:e.geometryVersions.map(({geometry,...v})=>v)})),snapshots:[]}),loadEntity:async id=>{loads++;const e=entities.find(e=>e.entityId===id);cache.set(id,e);return e;},peek:id=>cache.get(id)||null};
 return {service:createTerritorialLibraryService({loader,today:()=> '2026-10-06'}),loads:()=>loads};
}
test('catalog loading shares requests and searching loads no geometry',async()=>{
 const f=fixture(); const [a,b]=await Promise.all([f.service.load(),f.service.load()]);assert.equal(a,b);
 assert.equal(f.service.search({query:'parent'}).length,1);assert.equal(f.loads(),0);
 assert.equal(f.service.search({status:'current'}).length,2);assert.equal(f.service.search({status:'past'}).length,1);
});
test('descriptors lazily load requested alive descendants without runtime current/historical synthesis',async()=>{
 const f=fixture();await f.service.load();const items=await f.service.instantiateDescriptors(['state:parent'],'1991','all');
 assert.deepEqual(items.map(i=>i.entityId),['state:parent','state:child']);assert.equal(items[1].parentEntityId,'state:parent');assert.deepEqual(items[1].geometry,geometry);assert.equal(f.loads(),2);
});
test('failed catalog loading can retry',async()=>{
 let n=0;const service=createTerritorialLibraryService({loader:{loadIndex:async()=>{if(!n++)throw new Error('offline');return {schemaVersion:1,entities:[],snapshots:[]};},loadEntity:async()=>null,peek:()=>null}});
 await assert.rejects(service.load(),/offline/);await service.load();assert.equal(n,2);
});
