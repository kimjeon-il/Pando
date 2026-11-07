import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalWorldCases} from '../fixtures/historical-world-cases.mjs';
import {compileBuiltinWorldCatalog,coalesceCoverageAdjustments} from '../../tools/builtin-world-compiler.mjs';
import {assembleBuiltinWorld,selectBuiltinCountries} from "../../shared/frontend/js/modules/builtin-world-loader.js";
import {createBuiltinProjectSetup} from '../../shared/frontend/js/modules/project-setup.js';
import {PROJECT_SCHEMA_VERSION} from '../../shared/frontend/js/modules/version-contract.js';
import {buildBuiltinWorldNamePublication} from '../../tools/build-builtin-world.mjs';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {temporalContains,temporalMonthEnd} from '../../shared/frontend/js/modules/temporal.js';
import {resolveWorld} from '../../shared/frontend/js/modules/timeline-resolver.js';
import {createGeometryVersionStore} from '../../shared/frontend/js/modules/geometry-version-store.js';

let built;
function fixture(){
 if(built)return built;
 const input=historicalWorldCases();
 const view={schemaVersion:1,id:'world:catalog',selections:input.currentSnapshot.entityRefs.map(entityId=>({entityId,
  geometryVersionId:input.entities.find(e=>e.entityId===entityId).geometryVersions[0].versionId}))};
 return built=compileBuiltinWorldCatalog({...input,view});
}
test('country catalog has no global project or observation month and selects only required countries',()=>{
 const {index,countries}=fixture();
 assert.equal(Object.hasOwn(index,'project'),false);assert.equal(Object.hasOwn(index,'sourceMonth'),false);
 const old=selectBuiltinCountries(index,'2014-02');
 assert.ok(old.some(e=>e.entityId==='state:test-ukraine'));
 assert.equal(old.some(e=>e.entityId==='RUS'),true);
 for(const month of ['2026-10','2026-11','2027-01']){
  const selected=selectBuiltinCountries(index,month);
  assert.ok(selected.some(e=>e.entityId==='RUS'));
  const project=assembleBuiltinWorld(index,countries,month);
  assert.ok(project.territorialEntities.some(e=>e.id==='RUS'));
  assert.equal(project.projectSetup.initialMonth,month);
 }
});
test('a historical geometry gap is not filled with present context',()=>{
 const {index}=fixture();
 assert.equal(selectBuiltinCountries(index,'2015-10').some(e=>e.entityId==='state:test-ukraine'),false);
 assert.equal(selectBuiltinCountries(index,'1989-04').some(e=>e.entityId==='state:single-day'),false);
});

test('country names compile as independent property bindings while geometry stays unchanged',()=>{
 const input=historicalWorldCases();
 const source=input.entities.find(row=>row.sourceInfo?.featureId==='RUS');
 source.nameVersions=[{validFrom:null,validTo:'1999',names:{ko:{common:'옛 이름',formal:'옛 정식명'}}},
  {validFrom:'2000',validTo:null,names:{ko:{common:'새 이름'},native:[{language:'ru',common:'Россия'}]}}];
 const view={schemaVersion:1,id:'world:names',selections:input.currentSnapshot.entityRefs.map(entityId=>({entityId,
  geometryVersionId:input.entities.find(e=>e.entityId===entityId).geometryVersions[0].versionId}))};
 const compiled=compileBuiltinWorldCatalog({...input,view}),country=compiled.countries.find(row=>row.entityId==='RUS');
 assert.equal(country.timelineRecords.geometryBindings.length,1);
 assert.deepEqual(country.timelineRecords.propertyBindings.map(row=>[row.validFrom,row.validTo,row.value.name]),[[null,'1999-12-31','옛 이름'],['2000-01-01',null,'새 이름']]);
 assert.equal(country.timelineRecords.propertyBindings[0].value.names.ko.formal,'옛 정식명');
 assert.equal(country.timelineRecords.propertyBindings[1].value.names.native[0].language,'ru');
});

test('explicit name-history gaps cannot inherit the latest country name or its details',()=>{
 const input=historicalWorldCases(),source=input.entities.find(row=>row.sourceInfo?.featureId==='RUS');
 source.nameVersions=[{validFrom:null,validTo:'1999',names:{ko:{common:'Old',formal:'Old formal'}}},
  {validFrom:'2001',validTo:null,names:{ko:{common:'New',formal:'New formal'}}}];
 const view={schemaVersion:1,id:'world:gap',selections:input.currentSnapshot.entityRefs.map(entityId=>({entityId,
  geometryVersionId:input.entities.find(e=>e.entityId===entityId).geometryVersions[0].versionId}))};
 const {index,countries}=compileBuiltinWorldCatalog({...input,view});
 const project=assembleBuiltinWorld(index,countries,'2000-06');
 const identity=project.territorialEntities.find(row=>row.id==='RUS');
 assert.equal(identity.properties.name,'');assert.equal(identity.properties.metadata.nameDetails,undefined);
 assert.equal(identity.properties.metadata.nameSource.baseName,'');
 assert.equal(project.timelineRecords.propertyBindings.filter(row=>row.objectRef.id==='RUS').length,2,
  'all name editions survive a cursor in their gap');
 const archive=createGeometryVersionStore(project.geometries);
 const nameAt=month=>resolveWorld(project.territorialEntities,project.timelineRecords,archive,month)
  .byId.get('RUS')?.identity.properties.name;
 assert.deepEqual(['1999-12','2000-06','2001-06'].map(nameAt),['Old','','New']);
});

test('name-only publication decodes only the selected country and rejects hidden non-name changes',()=>{
 const {index,countries}=fixture(),country=countries.find(row=>row.entityId==='RUS');
 const stored=gzipSync(JSON.stringify(country)),opaque=Buffer.from('unrelated immutable stored bytes');
 const descriptor=(entityId,bytes,decodedBytes)=>{
  const hash=createHash('sha256').update(bytes).digest('hex');
  return {entityId,file:`countries/${entityId}-sha256-${hash}.json.gz`,encoding:'gzip',sha256:hash,compressedBytes:bytes.length,decodedBytes};
 };
 const selected=descriptor('RUS',stored,Buffer.byteLength(JSON.stringify(country))),untouched=descriptor('opaque',opaque,100);
 const previous=structuredClone(index);previous.entities=[selected,untouched];
 previous.inputHashes={sourceRevisions:{'current:RUS':'before'}};
 const source=historicalWorldCases().entities.find(row=>row.entityId==='current:RUS'),updated={...source,names:{ko:'수정명'}};
 const args={entityIds:[source.entityId],sourceIndex:{entities:[{entityId:source.entityId,sha256:'after'}]},previousIndex:previous,
  readCountry:file=>{assert.equal(file,selected.file);return stored;},readSource:()=>updated,readPreviousSource:()=>source};
 const files=buildBuiltinWorldNamePublication(args),nextIndex=JSON.parse(files.get('index.json'));
 const next=JSON.parse(gunzipSync(files.get(nextIndex.entities[0].file)));
 assert.equal(next.identity.properties.name,'수정명');
 assert.deepEqual(next.geometries,country.geometries);assert.deepEqual(next.timelineRecords.geometryBindings,country.timelineRecords.geometryBindings);
 assert.equal(files.has(untouched.file),false);
 assert.deepEqual(nextIndex.entities[1],untouched);
 assert.throws(()=>buildBuiltinWorldNamePublication({...args,readSource:()=>({...updated,lifetime:{validFrom:'1900',validTo:null}})}),/non-name changes/);
});

test('coverage adjustments coalesce adjacent intervals without timeline object references',()=>{
 const rows=[
  {entityId:'state:test',reason:'clip',validFrom:'1922-01-01',validTo:'1922-01-31'},
  {entityId:'state:test',reason:'clip',validFrom:'1922-02-01',validTo:'1922-02-28'},
  {entityId:'state:test',reason:'clip',validFrom:'1922-03-02',validTo:'1922-03-31'},
  {entityId:'state:other',reason:'clip',validFrom:'1922-03-01',validTo:'1922-03-31'},
 ];
 const result=coalesceCoverageAdjustments(rows);
 assert.equal(result.length,3);
 assert.ok(result.some(row=>row.entityId==='state:test' && row.validFrom==='1922-01-01' && row.validTo==='1922-02-28'));
 assert.ok(result.some(row=>row.entityId==='state:test' && row.validFrom==='1922-03-02'));
 assert.ok(result.some(row=>row.entityId==='state:other'));
});

test('complete builtin history assembles ordinary schema-14 projects without template mutation',()=>{
 const {index,countries}=fixture();
 const template=structuredClone(index.template);
 assert.equal(Object.hasOwn(index.template,'projectSetup'),false);
 const at=month=>assembleBuiltinWorld(index,countries,month);
 const historical=at('2014-02'),modern=at('2026-10');
 for(const [project,month] of [[historical,'2014-02'],[modern,'2026-10']]) {
  assert.equal(project.format,'pandolab-project-state');
  assert.equal(project.schemaVersion,PROJECT_SCHEMA_VERSION);
  assert.deepEqual(project.projectSetup,createBuiltinProjectSetup(month));
  assert.equal(project.timelineRecords.schemaVersion,3);
  assert.equal(Object.hasOwn(project,'timelineCursor'),false);
  assert.ok(Array.isArray(project.labels)&&Array.isArray(project.hydroEdits));
 }
 assert.deepEqual(index.template,template,'dated assembly must never mutate immutable source template');
 historical.labels.push({id:'local-only'});
 assert.equal(modern.labels.length,0,'different project instances must not share authored arrays');
 assert.deepEqual(index.template,template);
 const missing=structuredClone(index);
 missing.template.projectSetup=createBuiltinProjectSetup('2014-02');
 assert.throws(()=>assembleBuiltinWorld(missing,countries,'2014-02'),/Invalid builtin project template/);
});

test('one immutable project resolves every historical month through the native timeline oracle',()=>{
 const {index,countries}=fixture(),source=structuredClone(index);
 const months=['-0001-12','0001-01','1914-07','1989-04','2014-02','2015-10',
  '2026-10','2026-11','2027-01','+10000-01'];
 const project=assembleBuiltinWorld(index,countries,'2014-02');
 const archive=createGeometryVersionStore(project.geometries);
 assert.deepEqual(project.territorialEntities.map(row=>row.id),countries.map(row=>row.entityId));
 for(const month of months){
  const expected=selectBuiltinCountries(index,month);
  const world=resolveWorld(project.territorialEntities,project.timelineRecords,archive,month);
  assert.deepEqual(world.entities.map(row=>row.id).sort(),
   expected.map(row=>row.entityId).sort(),month);
  for(const country of expected){
   const sourceCountry=countries.find(row=>row.entityId===country.entityId);
   const edition=sourceCountry.sourceBindings.find(row=>temporalContains(row,temporalMonthEnd(month)));
   assert.deepEqual(world.byId.get(country.entityId)?.geometryRef,edition?.geometryRef,month);
  }
 }
 for(const country of countries){
  for(const name of ['lifetimes','geometryBindings','parentRelations','propertyBindings'])
   assert.deepEqual(project.timelineRecords[name].filter(row=>row.objectRef.id===country.entityId),
     country.timelineRecords[name],country.entityId+' '+name);
 }
 assert.deepEqual(index,source,'source catalog must not be mutated');
 assert.throws(()=>selectBuiltinCountries(index,'1914-07-01'),/query month/i);
});
