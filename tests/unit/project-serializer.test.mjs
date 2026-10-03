import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createProjectSerializer, restoreEntitiesFromDelta } from '../../assets/js/modules/project-serializer.js';
import { PROJECT_SCHEMA_VERSION } from '../../assets/js/modules/version-contract.js';
const geometry={type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]};
const entity=(id,unitType='country',options={})=>createTerritorialFeature({id,unitType,geometry,name:id,...options});
const serializer=snapshot=>createProjectSerializer({appVersion:'0.34.0',baseDataset:'base',distributionModes:['territorial','geometry'],terrainDataset:'terrain',hydroDataset:'hydro',readSnapshot:()=>snapshot,now:()=>new Date('2026-10-03T00:00:00Z')});
test('full and delta autosaves share immutable geometry while detaching metadata',()=>{
 const a=entity('A');const service=serializer({territorialEntities:[a],entityDelta:{changed:[a],removedIds:[]},projectFields:{}});
 const first=service.buildAutosave(),second=service.buildAutosave();assert.equal(first.entityDelta.changed[0].geometry,second.entityDelta.changed[0].geometry);assert.notEqual(first.entityDelta.changed[0].geometry,a.geometry);assert.ok(Object.isFrozen(first.entityDelta.changed[0].geometry.coordinates));
 first.entityDelta.changed[0].properties.name='detached';assert.equal(a.properties.name,'A');
 const full=serializer({territorialEntities:[a],fullAutosave:true,projectFields:{}});assert.equal(full.buildAutosave().territorialEntities[0].geometry,full.buildAutosave().territorialEntities[0].geometry);
});
test('project header and physical source metadata use the current common contract',()=>{
 const entities=[entity('A'),entity('S','subunit',{parentId:'A'}),entity('R','region',{associatedCountryId:'A'})];
 const project=serializer({territorialEntities:entities,projectFields:{labels:[],layerVisibility:{countries:false}},terrainManifest:{dataset:'terrain-current',version:'1'},hydroManifest:{dataset:'hydro-current',selection:{rivers:true}}}).buildProject();
 assert.equal(project.schemaVersion,PROJECT_SCHEMA_VERSION);assert.equal(project.savedAt,'2026-10-03T00:00:00.000Z');assert.equal(project.territorialModel.storage,'territorialEntities');assert.equal(project.territorialModel.schemaVersion,3);assert.deepEqual(project.territorialEntities,entities);assert.equal(project.physicalSourceInfo.terrain.dataset,'terrain-current');assert.deepEqual(project.physicalSourceInfo.hydro.selection,{rivers:true});
 for(const key of ['countriesData','countryOverrides','territorialUnits','countryDelta','projection','view'])assert.equal(key in project,false);
});
test('entity delta replaces, removes and adds all types in stable order without mutating inputs',()=>{
 const base=[entity('A'),entity('B'),entity('S','subunit',{parentId:'A'})];const changed=[entity('A','country',{name:'renamed',metadata:{capital:'capital'}}),entity('S','subunit',{parentId:'A',color:'#123456'}),entity('R','region',{associatedCountryId:'A'})];
 const project={entityDelta:{changed,removedIds:['B']}};const original=structuredClone({base,project});const restored=restoreEntitiesFromDelta(project,{base});
 assert.deepEqual(restored.map(x=>x.id),['A','S','R']);assert.deepEqual(restored,changed);assert.deepEqual({base,project},original);restored[0].properties.metadata.capital='changed';assert.equal(changed[0].properties.metadata.capital,'capital');
 assert.throws(()=>restoreEntitiesFromDelta({entityDelta:{changed:[changed[0]],removedIds:['A']}},{base}),/중복/);
 assert.throws(()=>restoreEntitiesFromDelta({entityDelta:{changed:[],removedIds:['A']}},{base}),/부모/);
});

test('external full projects remain independent from the builtin delta baseline when reopened', () => {
  const source = { territorialEntities: [entity('external')], fullAutosave: true, projectFields: {} };
  const project = serializer(source).buildProject();
  assert.equal(project.baseDataset, 'external-territorial-entities');
  const reopened = serializer({ territorialEntities: project.territorialEntities,
    projectFields: {}, fullAutosave: project.baseDataset !== 'base' }).buildAutosave();
  assert.equal(reopened.format, 'pandolab-autosave-full');
  assert.deepEqual(reopened.territorialEntities, project.territorialEntities);
  assert.equal('entityDelta' in reopened, false);
});
