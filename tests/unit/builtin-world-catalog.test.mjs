import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalWorldCases} from '../fixtures/historical-world-cases.mjs';
import {compileBuiltinWorldCatalog} from '../../tools/builtin-world-compiler.mjs';
import {assembleBuiltinWorld,selectBuiltinCountries} from "../../shared/frontend/js/modules/builtin-world-loader.js";
import {buildBuiltinWorldNamePublication} from '../../tools/build-builtin-world.mjs';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';

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
  const project=assembleBuiltinWorld(index,selected.map(row=>countries.find(c=>c.entityId===row.entityId)),month);
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
 const project=assembleBuiltinWorld(index,selectBuiltinCountries(index,'2000-06').map(row=>countries.find(c=>c.entityId===row.entityId)),'2000-06');
 const identity=project.territorialEntities.find(row=>row.id==='RUS');
 assert.equal(identity.properties.name,'');assert.equal(identity.properties.metadata.nameDetails,undefined);
 assert.equal(identity.properties.metadata.nameSource.baseName,'');
 assert.equal(project.timelineRecords.propertyBindings.some(row=>row.objectRef.id==='RUS'),false);
});

test('name-only publication decodes only the selected country and rejects hidden non-name changes',()=>{
 const {index,countries}=fixture(),country=countries.find(row=>row.entityId==='RUS');
 const stored=gzipSync(JSON.stringify(country)),opaque=Buffer.from('unrelated immutable stored bytes');
 const previous=structuredClone(index);previous.entities=[{entityId:'RUS',file:'selected.gz',sha256:createHash('sha256').update(stored).digest('hex'),compressedBytes:stored.length},
  {entityId:'opaque',file:'opaque.gz',compressedBytes:opaque.length}];
 previous.inputHashes={sourceRevisions:{'current:RUS':'before'}};
 const source=historicalWorldCases().entities.find(row=>row.entityId==='current:RUS'),updated={...source,names:{ko:'수정명'}};
 const args={entityIds:[source.entityId],sourceIndex:{entities:[{entityId:source.entityId,sha256:'after'}]},previousIndex:previous,
  readCountry:file=>file==='selected.gz'?stored:opaque,readSource:()=>updated,readPreviousSource:()=>source};
 const files=buildBuiltinWorldNamePublication(args),nextIndex=JSON.parse(files.get('index.json'));
 const next=JSON.parse(gunzipSync(files.get(nextIndex.entities[0].file)));
 assert.equal(next.identity.properties.name,'수정명');
 assert.deepEqual(next.geometries,country.geometries);assert.deepEqual(next.timelineRecords.geometryBindings,country.timelineRecords.geometryBindings);
 assert.equal(files.get('opaque.gz'),opaque);
 assert.throws(()=>buildBuiltinWorldNamePublication({...args,readSource:()=>({...updated,lifetime:{validFrom:'1900',validTo:null}})}),/non-name changes/);
});
