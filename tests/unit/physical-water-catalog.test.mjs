import test from 'node:test';
import assert from 'node:assert/strict';
import {compilePhysicalWaterCatalog} from '../../tools/physical-water-catalog.mjs';
import {resolvePhysicalWaterObjects} from '../../shared/frontend/js/modules/physical-resources.js';

const geometry={type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[0,0]]]};
const source=id=>({schemaVersion:2,entityId:id,entityKind:'lake',lineageId:id.split(':')[1],names:{ko:id},alternateNames:[],
 lifetime:{validFrom:null,validTo:null},parentEntityId:'',instantiation:{mode:'independent',countryUpdates:{}},metadata:{},sourceInfo:{},
 geometryVersions:[{versionId:'reviewed',validFrom:'1922-01-01',validTo:'1929-12-31',certainty:'reviewed',geometry}]});
test('physical catalog derives its dates only from independent lake library versions',()=>{
 const sources=[source('waterbody:a'),source('waterbody:b')],before=structuredClone(sources),land={sha256:'same'};
 const assignments=sources.map(entity=>({entityId:entity.entityId,versionId:'reviewed',geometryRef:{id:entity.entityId+':reviewed',version:1},asset:{sha256:entity.entityId},land,replaces:[]}));
 const catalog=compilePhysicalWaterCatalog(sources,assignments);
 assert.deepEqual(sources,before);assert.equal(catalog.identities.length,2);assert.equal(catalog.timelineRecords.schemaVersion,3);
 assert.equal(resolvePhysicalWaterObjects(catalog,'1922').length,2);assert.equal(resolvePhysicalWaterObjects(catalog,'1930').length,0);
 assert.deepEqual(catalog.timelineRecords.lifetimes.map(row=>[row.validFrom,row.validTo]),[[null,null],[null,null]]);
 assert.throws(()=>compilePhysicalWaterCatalog(sources,assignments.slice(1)),/Missing.*asset/);
 assert.throws(()=>compilePhysicalWaterCatalog(sources,[...assignments,assignments[0]]),/Duplicate/);
});
