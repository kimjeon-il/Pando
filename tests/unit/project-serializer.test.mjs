import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createStaticTerritorialSnapshot } from '../../assets/js/modules/territorial-entity-store.js';
import { createProjectSerializer } from '../../assets/js/modules/project-serializer.js';
import { restoreEntitiesFromDelta } from '../../assets/js/modules/project-state.js';
import { PROJECT_SCHEMA_VERSION } from '../../assets/js/modules/version-contract.js';
import { staticSerializerSnapshot } from '../helpers/timeline-project.mjs';
const geometry={type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]};
const entity=(id,entityKind='general',options={})=>createTerritorialFeature({id,entityKind,geometry,name:id,...options});
const serializer=snapshot=>createProjectSerializer({appVersion:'0.34.0',baseDataset:'base',baseDatasetFingerprint:'1'.repeat(64),distributionModes:['territorial','geometry'],terrainDataset:'terrain',hydroDataset:'hydro',readSnapshot:()=>snapshot,now:()=>new Date('2026-10-03T00:00:00Z')});

test('full and delta autosaves contain immutable archive geometry while detaching metadata',()=>{
  const a=entity('A');const snapshot=staticSerializerSnapshot({territorialEntities:[a],entityDelta:{changed:[a],removedIds:[]}});
  const service=serializer(snapshot),first=service.buildAutosave(),second=service.buildAutosave();
  assert.equal(first.entityDelta.changed[0].geometry,null);
  assert.deepEqual(first.geometries,second.geometries);
  assert.notEqual(first.geometries[0].geojson,a.geometry);
  assert.ok(Object.isFrozen(first.geometries[0].geojson.coordinates));
  first.entityDelta.changed[0].properties.name='detached';assert.equal(a.properties.name,'A');
  const full=serializer({...snapshot,fullAutosave:true}).buildAutosave();
  assert.deepEqual(full.timelineRecords,first.timelineRecords);assert.deepEqual(full.geometries,first.geometries);
});

test('project header and physical source metadata use the current common contract',()=>{
  const entities=[entity('A'),entity('S','general',{parentId:'A'}),entity('R','regional',{})];
  const snapshot=staticSerializerSnapshot({territorialEntities:entities,projectFields:{labels:[],layerVisibility:{countries:false}},terrainManifest:{dataset:'terrain-current',version:'1'},hydroManifest:{dataset:'hydro-current',selection:{rivers:true}}});
  const project=serializer(snapshot).buildProject();
  assert.equal(project.schemaVersion,PROJECT_SCHEMA_VERSION);assert.equal(project.savedAt,'2026-10-03T00:00:00.000Z');
  assert.equal(project.territorialModel.storage,'territorialEntities');assert.equal(project.territorialModel.schemaVersion,5);
  assert.deepEqual(project.territorialEntities,snapshot.territorialEntities);assert.equal(project.physicalSourceInfo.terrain.dataset,'terrain-current');assert.deepEqual(project.physicalSourceInfo.hydro.selection,{rivers:true});
  for(const key of ['countriesData','countryOverrides','territorialUnits','countryDelta','territorialRelations','projection','view'])assert.equal(key in project,false);
  assert.deepEqual(project.territorialModel.kinds,['general','regional']);assert.equal('types' in project.territorialModel,false);
});

test('entity delta replaces removes and adds both kinds against a matching base without mutating inputs',()=>{
  const base=createStaticTerritorialSnapshot([entity('A'),entity('B'),entity('S','general',{parentId:'A'})]).territorialEntities;
  const changed=[entity('A','general',{name:'renamed',metadata:{capital:'capital'}}),entity('S','general',{parentId:'A',color:'#123456'}),entity('R','regional',{})];
  const content=createStaticTerritorialSnapshot(changed);
  const project={...content,baseDataset:'base',baseDatasetFingerprint:'1'.repeat(64),entityDelta:{changed:content.territorialEntities,removedIds:['B']}};
  const original=structuredClone({base,project});const restored=restoreEntitiesFromDelta(project,{base,baseDataset:'base',baseDatasetFingerprint:'1'.repeat(64)});
  assert.deepEqual(restored.map(x=>x.id),['A','S','R']);assert.deepEqual(restored,content.territorialEntities);assert.deepEqual({base,project},original);
  restored[0].properties.metadata.capital='changed';assert.equal(content.territorialEntities[0].properties.metadata.capital,'capital');
  assert.throws(()=>restoreEntitiesFromDelta({...project,entityDelta:{changed:[content.territorialEntities[0]],removedIds:['A']}},{base,baseDataset:'base',baseDatasetFingerprint:'1'.repeat(64)}),/중복/);
  assert.throws(()=>restoreEntitiesFromDelta({...project,entityDelta:{changed:[],removedIds:['A']}},{base,baseDataset:'base',baseDatasetFingerprint:'1'.repeat(64)}));
  assert.throws(()=>restoreEntitiesFromDelta(project,{base,baseDataset:'different'}),{code:'PL-SCHEMA-BASE'});
});

test('external full projects remain independent from the builtin delta baseline when reopened', () => {
  const source=staticSerializerSnapshot({territorialEntities:[entity('external')],fullAutosave:true});
  const project=serializer(source).buildProject();assert.equal(project.baseDataset,'external-territorial-entities');
  const {territorialEntities,...projectFields}=project;
  const reopened=serializer({territorialEntities,projectFields,fullAutosave:project.baseDataset !== 'base'}).buildAutosave();
  assert.equal(reopened.format,'pandolab-autosave-full');assert.deepEqual(reopened.territorialEntities,project.territorialEntities);
  assert.deepEqual(reopened.timelineRecords,project.timelineRecords);assert.deepEqual(reopened.geometries,project.geometries);
  assert.equal('entityDelta' in reopened,false);
});
