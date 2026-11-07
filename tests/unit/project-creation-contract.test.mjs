import { describe as contractSuite } from 'node:test';
import * as __project_dep0 from "node:test";
import * as __project_dep1 from "node:assert/strict";
import * as __project_dep2 from "node:fs";
import * as __project_dep3 from "../../shared/frontend/js/modules/initial-document.js";
import * as __project_dep4 from "../helpers/core-project.mjs";
import * as __project_dep5 from "../../shared/frontend/js/modules/territorial-units.js";
import * as __project_dep6 from "../helpers/timeline-project.mjs";
import * as __project_dep7 from "../helpers/legacy-project-autosave.mjs";
import * as __project_dep8 from "../../shared/frontend/js/modules/project-state.js";
import * as __project_dep9 from "../../shared/frontend/js/modules/version-contract.js";

// Original feature contract: project-creation-contract.test.mjs
contractSuite("project-creation-contract", () => {
const { describe : contractSuite } = __project_dep0;
const __dep0 = __project_dep0;
const __dep1 = __project_dep1;
const __dep2 = __project_dep2;
const __dep3 = __project_dep3;
const __dep4 = __project_dep4;

// Original feature contract: project-creation-contract.test.mjs
contractSuite("project-creation-contract", () => {
const test = __dep0.default;
const assert = __dep1.default;
const { readFileSync } = __dep2;
const { createInitialDocument } = __dep3;
const { createNodeCoreProject } = __dep4;

const viewing=['defaultView','layerVisibility','itemVisibility'];
test('new projects carry one initial setup and no authored viewing defaults',()=>{
 const setup={initialMonth:'-0044-03',timelineRange:{start:'-0500-01',end:'0100-12'},initialMapBounds:{west:5,east:20,south:30,north:50},sourceMode:'empty'};
 const project=createInitialDocument({appVersion:'test',state:{projectSetup:setup}});
 assert.equal(project.schemaVersion,14);
 assert.deepEqual(project.projectSetup,setup);
 for(const key of viewing)assert.equal(Object.hasOwn(project,key),false,key);
});

test('Core file and autosave serialization exclude device viewing while preserving creation settings and styles',async()=>{
 const project=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
 const owner=await createNodeCoreProject(project,{appVersion:'test'});
 try{
  const admitted=owner.documentModel.snapshot();
  const receipt=await owner.project.buildFileSnapshot();
  assert.equal(receipt.project.schemaVersion,14);
  for(const key of viewing)assert.equal(Object.hasOwn(receipt.project,key),false,key);
  assert.deepEqual(receipt.project.projectSetup,project.projectSetup);
  assert.deepEqual(receipt.project.layerPresentation,admitted.layerPresentation);
  const saved=(await owner.project.buildAutosave()).project;
  for(const key of viewing)assert.equal(Object.hasOwn(saved,key),false,key);
  const before=JSON.parse(await owner.client.storageSnapshot());
  await owner.client.setTimelineCursor('1914-07');
  assert.deepEqual(JSON.parse(await owner.client.storageSnapshot()),before);
  const reopened=await createNodeCoreProject(receipt.project);
  try{assert.equal(reopened.client.state().timelineCursor,project.projectSetup.initialMonth);}finally{reopened.dispose();}
 }finally{owner.dispose();}
});
});

// Original feature contract: project-creation-storage.test.mjs
contractSuite("project-creation-storage", () => {
const test = __dep0.default;
const assert = __dep1.default;
const { readFileSync } = __dep2;
const { createInitialDocument } = __dep3;
const { createNodeCoreProject } = __dep4;

test('new documents have independent identity and only one creation setup',()=>{
 const a=createInitialDocument({appVersion:'test'}),b=createInitialDocument({appVersion:'test'});
 assert.equal(a.schemaVersion,14);assert.notEqual(a.documentId,b.documentId);
 assert.match(a.documentId,/^[0-9a-f-]{36}$/);assert.equal(typeof a.projectSetup.initialMonth,'string');
 for(const key of ['defaultView','editorState','physicalSettings','layerVisibility','itemVisibility'])assert.equal(Object.hasOwn(a,key),false,key);
});
test('retired settings commands and old saves cannot change the active document',async()=>{
 const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url)));
 seed.labels[0].territorialUnitId='missing-label-owner';
 const owner=await createNodeCoreProject(seed);
 try{
  const before=JSON.parse(await owner.client.storageSnapshot()),state=owner.client.state();
  for(const commandId of ['project.default-view','project.configure'])await assert.rejects(owner.project.executeCommand({commandId,targets:[],payload:{}}));
  await assert.rejects(owner.client.load(JSON.stringify({...seed,schemaVersion:13})),/UNSUPPORTED_VERSION/);
  assert.deepEqual(JSON.parse(await owner.client.storageSnapshot()),before);assert.deepEqual(owner.client.state(),state);
  const reopened=await createNodeCoreProject(before);
  try{assert.equal(reopened.client.state().timelineCursor,seed.projectSetup.initialMonth);assert.deepEqual(reopened.documentModel.snapshot().labels,before.labels);assert.deepEqual(reopened.documentModel.snapshot().geometries,before.geometries);}finally{reopened.dispose();}
 }finally{owner.dispose();}
});
});
});

// Original feature contract: project-serializer.test.mjs
contractSuite("project-serializer", () => {
const test = __project_dep0.default;
const assert = __project_dep1.default;
const { createTerritorialFeature } = __project_dep5;
const { staticTerritorialInput } = __project_dep6;
const { createProjectSerializer } = __project_dep7;
const { restoreEntitiesFromDelta } = __project_dep8;
const { PROJECT_SCHEMA_VERSION } = __project_dep9;
const { staticSerializerSnapshot } = __project_dep6;
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
  const snapshot=staticSerializerSnapshot({territorialEntities:entities,projectFields:{labels:[]},physicalSourceInfo:{hydro:{dataset:'hydro-current',selection:{rivers:true}}}});
  const project=serializer(snapshot).buildProject();
  assert.equal(project.schemaVersion,PROJECT_SCHEMA_VERSION);assert.equal(project.savedAt,'2026-10-03T00:00:00.000Z');
  assert.equal(project.territorialModel.storage,'territorialEntities');assert.equal(project.territorialModel.schemaVersion,6);
  assert.deepEqual(project.territorialEntities,snapshot.territorialEntities);assert.equal(Object.hasOwn(project.physicalSourceInfo,'terrain'),false);assert.deepEqual(project.physicalSourceInfo.hydro.selection,{rivers:true});
  for(const key of ['countriesData','countryOverrides','territorialUnits','countryDelta','territorialRelations','projection','view'])assert.equal(key in project,false);
  assert.deepEqual(project.territorialModel.kinds,['general','regional']);assert.equal('types' in project.territorialModel,false);
});

test('entity delta replaces removes and adds both kinds against a matching base without mutating inputs',()=>{
  const base=staticTerritorialInput([entity('A'),entity('B'),entity('S','general',{parentId:'A'})]).territorialEntities;
  const changed=[entity('A','general',{name:'renamed',metadata:{capital:'capital'}}),entity('S','general',{parentId:'A',color:'#123456'}),entity('R','regional',{})];
  const content=staticTerritorialInput(changed);
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
  const reopened=serializer({documentId:project.documentId,physicalSourceInfo:project.physicalSourceInfo,territorialEntities,projectFields,fullAutosave:project.baseDataset !== 'base'}).buildAutosave();
  assert.equal(reopened.format,'pandolab-autosave-full');assert.deepEqual(reopened.territorialEntities,project.territorialEntities);
  assert.deepEqual(reopened.timelineRecords,project.timelineRecords);assert.deepEqual(reopened.geometries,project.geometries);
  assert.equal('entityDelta' in reopened,false);
});
});
