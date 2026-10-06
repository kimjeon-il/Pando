import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTerritorialLibraryEntity, selectGeometryVersion } from '../../assets/js/modules/territorial-library.js';
import { restoreTimelineStorage, snapshotTimelineStorage } from '../../assets/js/modules/timeline-storage.js';
import { createProjectSerializer } from '../../assets/js/modules/project-serializer.js';
import { assertCurrentProjectSchema } from '../../assets/js/modules/project-state.js';
import { createEmptyTerritorialState, createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { projectForStorage } from '../helpers/timeline-project.mjs';

const polygon = east => ({type:'Polygon',coordinates:[[[0,0],[0,1],[east,1],[east,0],[0,0]]]});
function completeCatalog() {
  return normalizeTerritorialLibraryEntity({schemaVersion:1,entityId:'state:synthetic',entityKind:'general',canonicalName:'Synthetic only',lifetime:{validFrom:'1948-08-15',validTo:null},geometryVersions:[
    {id:'snapshot:1948',validFrom:'1948-08-15',validTo:'1953-07-26',geometry:polygon(1),datePrecision:'date',sourceId:'synthetic',certainty:'high'},
    {id:'snapshot:1953',validFrom:'1953-07-27',validTo:'2000-12-31',geometry:polygon(2),datePrecision:'date',sourceId:'synthetic',certainty:'high'},
    {id:'snapshot:current',validFrom:'2001-01-01',validTo:null,geometry:polygon(3),datePrecision:'date',sourceId:'synthetic',certainty:'high'},
  ]});
}
function storageInput(entity) {
  // Explicit fixture mappings: catalog IDs are not project logical IDs and
  // snapshot IDs are not archive IDs. No product ID is inferred or reissued.
  const logicalId='project-object';
  const refs=new Map([['snapshot:1948',{id:'archive-shape',version:7}],['snapshot:1953',{id:'archive-shape',version:11}],['snapshot:current',{id:'archive-shape',version:18}]]);
  return {entities:[{id:logicalId,entityKind:entity.entityKind}],input:{schemaVersion:1,records:{schemaVersion:1,
    lifetimes:[{id:'life-existing',entityId:logicalId,...entity.lifetime}],
    geometryBindings:entity.geometryVersions.map(v=>({id:`binding:${v.id}`,entityId:logicalId,validFrom:v.validFrom,validTo:v.validTo,geometryRef:refs.get(v.id)})),
    parentRelations:[{id:'parent-existing',entityId:logicalId,parentId:'',coverageMode:'explicit',...entity.lifetime}],
  },geometries:[...entity.geometryVersions.map(v=>({...refs.get(v.id),geojson:v.geometry})),{id:'unreferenced',version:4,geojson:polygon(4)}]}};
}
test('catalog versions retain explicit identities, records and whole archive through production full/delta saves',()=>{
  const catalog=completeCatalog(),row=storageInput(catalog),before=structuredClone(catalog);
  const restored=restoreTimelineStorage(row.input,row.entities);
  assert.deepEqual(snapshotTimelineStorage(restored.records,restored.geometries,row.entities),row.input);
  const snapshot=projectForStorage(row);
  for(const fullAutosave of [true,false]){
    const serializer=createProjectSerializer({appVersion:'test',baseDataset:'test-base',distributionModes:['territorial','geometry'],terrainDataset:'test',hydroDataset:'test',readSnapshot:()=>({...snapshot,fullAutosave,baseDatasetFingerprint:'1'.repeat(64),entityDelta:{changed:snapshot.territorialEntities,removedIds:[]}})});
    const saved=serializer.buildAutosave();
    assert.equal(saved.schemaVersion,9);assert.equal(saved.timelineRecords.schemaVersion,1);
    assert.deepEqual(saved.timelineRecords,row.input.records);assert.deepEqual(saved.geometries,row.input.geometries);
    assertCurrentProjectSchema(saved,fullAutosave?{}:{baseEntities:snapshot.territorialEntities,baseDataset:'test-base',baseDatasetFingerprint:'1'.repeat(64)});
    const reopened=restoreTimelineStorage({schemaVersion:1,records:saved.timelineRecords,geometries:saved.geometries},row.entities);
    assert.deepEqual(snapshotTimelineStorage(reopened.records,reopened.geometries,row.entities),row.input);
  }
  assert.deepEqual(catalog,before);
});
test('complex catalog storage succeeds but live activation rejects before replacing current owners',()=>{
  const row=storageInput(completeCatalog()),snapshot=projectForStorage(row);
  const state={...createEmptyTerritorialState(),history:['preserved'],future:['preserved'],dirty:true,selection:'preserved',saveTarget:'preserved'};
  const before={...state},store=createTerritorialEntityStore({getState:()=>state});
  assert.throws(()=>store.restoreProject({territorialEntities:snapshot.territorialEntities,timelineRecords:row.input.records,geometries:row.input.geometries}),{code:'TIMELINE_ACTIVATION'});
  for(const key of Object.keys(before))assert.equal(state[key],before[key]);
});
test('partial catalog coverage cannot silently become a complete project lifetime',()=>{
  const entity=structuredClone(completeCatalog());entity.geometryVersions.splice(1,1);
  assert.equal(selectGeometryVersion(entity,'1990'),null);
  const row=storageInput(entity);
  assert.throws(()=>restoreTimelineStorage(row.input,row.entities),{code:'TIMELINE_GAP'});
});
test('a coastline-only snapshot change keeps both complete polygon versions in the existing archive',()=>{
  const entity=completeCatalog(),older=selectGeometryVersion(entity,'1953-07-26'),newer=selectGeometryVersion(entity,'1953-07-27');
  assert.deepEqual(older.geometry.coordinates[0].slice(0,2),newer.geometry.coordinates[0].slice(0,2),'synthetic land border unchanged');
  assert.notDeepEqual(older.geometry.coordinates[0].slice(2,4),newer.geometry.coordinates[0].slice(2,4),'synthetic coast changed');
  const row=storageInput(entity),restored=restoreTimelineStorage(row.input,row.entities);
  const saved=snapshotTimelineStorage(restored.records,restored.geometries,row.entities);
  assert.deepEqual(saved.geometries.find(g=>g.version===7).geojson,older.geometry);
  assert.deepEqual(saved.geometries.find(g=>g.version===11).geojson,newer.geometry);
  assert.equal(saved.geometries.length,4);
});
