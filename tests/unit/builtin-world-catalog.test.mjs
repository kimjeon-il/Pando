import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalWorldCases} from '../fixtures/historical-world-cases.mjs';
import {compileBuiltinWorldCatalog, coalesceCoverageAdjustments} from '../../tools/builtin-world-compiler.mjs';
import {assembleBuiltinWorld, selectBuiltinCountries} from '../../shared/frontend/js/modules/builtin-world-loader.js';
import {createBuiltinProjectSetup} from '../../shared/frontend/js/modules/project-setup.js';
import {PROJECT_SCHEMA_VERSION} from '../../shared/frontend/js/modules/version-contract.js';
import {buildBuiltinWorldNamePublication} from '../../tools/build-builtin-world.mjs';
import {gzipSync, gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {temporalContains, temporalMonthEnd} from '../../shared/frontend/js/modules/temporal.js';
import {resolveWorld} from '../../shared/frontend/js/modules/timeline-resolver.js';
import {createGeometryVersionStore} from '../../shared/frontend/js/modules/geometry-version-store.js';
import fs from 'node:fs';
import {builtinProject} from '../helpers/builtin-world.mjs';
import {deviceCurrentMonth} from '../../shared/frontend/js/modules/builtin-month-clock.js';

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

const row=(validFrom,validTo,change={})=>({entityId:'state:target',kind:'explicit-replacement',relatedIds:['state:priority'],...change,validFrom,validTo});

test('coverage evidence without objectRef merges adjacent intervals',()=>{
 const input=[row('1900-01-01','1900-01-31'),row('1900-02-01','1900-02-28')];
 assert.deepEqual(coalesceCoverageAdjustments(input),[row('1900-01-01','1900-02-28')]);
 assert.equal(Object.hasOwn(input[0],'objectRef'),false);
});

test('coverage sorting and maximal coalescing do not mutate the input evidence',()=>{
 const input=[row('1900-03-01','1900-03-31'),row('1900-01-01','1900-01-31'),row('1900-02-01','1900-02-28')];
 const original=structuredClone(input);
 for(const value of input){Object.freeze(value.relatedIds);Object.freeze(value);}Object.freeze(input);
 const output=coalesceCoverageAdjustments(input);
 assert.deepEqual(output,[row('1900-01-01','1900-03-31')]);assert.deepEqual(input,original);
 assert.deepEqual(coalesceCoverageAdjustments(output),output);
});

test('different coverage entity, kind, related owners and precision evidence stay separate',()=>{
 const variants=[{}, {entityId:'state:other'}, {kind:'parent-clipping'}, {relatedIds:['state:other-priority']},
  {kind:'certified-clipping-precision-artifact',polygonIndex:0,areaM2:0.1,operation:'difference state:target / state:priority'},
  {kind:'certified-clipping-precision-artifact',polygonIndex:0,areaM2:0.2,operation:'difference state:target / state:priority'}];
 const input=variants.flatMap(change=>[row('1900-01-01','1900-01-31',change),row('1900-02-01','1900-02-28',change)]);
 const output=coalesceCoverageAdjustments(input);
 assert.equal(output.length,variants.length);
 for(const change of variants)assert.ok(output.some(value=>JSON.stringify(value)===JSON.stringify(row('1900-01-01','1900-02-28',change))));
});

test('coverage gaps and overlapping intervals are not silently filled or unioned',()=>{
 const gap=[row('1900-01-01','1900-01-10'),row('1900-01-12','1900-01-31')];
 const overlap=[row('1900-01-01','1900-01-10'),row('1900-01-09','1900-01-20')];
 assert.deepEqual(coalesceCoverageAdjustments(gap),gap);
 assert.deepEqual(coalesceCoverageAdjustments(overlap),overlap);
});

test('open coverage bounds coalesce only across the finite adjacent boundary',()=>{
 assert.deepEqual(coalesceCoverageAdjustments([row('1900-01-01',null),row(null,'1899-12-31')]),[row(null,null)]);
 const input=[row(null,null),row('1900-01-01','1900-01-31')];
 assert.deepEqual(coalesceCoverageAdjustments(input),input);
});

test('coverage coalescing preserves leap-day adjacency',()=>{
 const input=[row('2024-02-28','2024-02-28'),row('2024-02-29','2024-02-29'),row('2024-03-01','2024-03-01')];
 assert.deepEqual(coalesceCoverageAdjustments(input),[row('2024-02-28','2024-03-01')]);
});

test('coverage coalescing crosses BCE to CE without inventing year zero',()=>{
 assert.deepEqual(coalesceCoverageAdjustments([row('-0001-12-31','-0001-12-31'),row('0001-01-01','0001-01-01')]),
  [row('-0001-12-31','0001-01-01')]);
});

test('empty and single coverage records keep their original shape',()=>{
 assert.deepEqual(coalesceCoverageAdjustments([]),[]);
 assert.deepEqual(coalesceCoverageAdjustments([row(null,null)]),[row(null,null)]);
});

const catalogPath = new URL('../../assets/data/builtin-world/generated/v1/index.json', import.meta.url);
const catalog = () => JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const monthsToCheck = () => {
  const now = new Date();
  return [...new Set([deviceCurrentMonth(now),
    deviceCurrentMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1))])];
};

test('the current and preceding months resolve from one complete historical world', () => {
  const index = catalog(), untouched = structuredClone(index);
  assert.ok(Array.isArray(index.entities) && index.entities.length > 0, 'missing country catalog');
  for (const month of monthsToCheck()) {
    const selected = selectBuiltinCountries(index, month);
    assert.ok(selected.length > 0, month + ': missing current country coverage');
    const project = builtinProject(month);
    assert.equal(project.projectSetup.initialMonth, month);
    assert.deepEqual(project.territorialEntities.map(row => row.id), index.entities.map(row => row.entityId),
      month + ': a historical identity was lost from the project');
    const ids = new Set(project.territorialEntities.map(row => row.id));
    assert.equal(ids.size, index.entities.length, month + ': duplicate country identity');
    const geometries = new Map(project.geometries.map(row => [JSON.stringify([row.id, row.version]), row]));
    for (const binding of project.timelineRecords.geometryBindings) {
      assert.ok(ids.has(binding.objectRef.id), 'binding to a country absent from this query');
      assert.ok(geometries.has(JSON.stringify([binding.geometryRef.id, binding.geometryRef.version])),
        'binding to missing loaded geometry: ' + binding.objectRef.id);
    }
    const visible = resolveWorld(project.territorialEntities, project.timelineRecords,
      createGeometryVersionStore(project.geometries), month);
    assert.ok(visible.entities.length > 0, month + ': empty physical map');
    assert.equal(new Set(visible.entities.map(row => row.id)).size, visible.entities.length);
    assert.deepEqual(visible.entities.map(row => row.id).sort(),selected.map(row => row.entityId).sort(),
      month + ': C++ selected world differs from source coverage');
    for (const row of visible.entities) {
      assert.ok(ids.has(row.id), 'unloaded country appears in the displayed scene');
      const timeline = row.identity.properties.metadata.historicalTimeline;
      assert.ok(timeline?.geometryBindings, row.id + ': missing source timeline');
      const binding = timeline.geometryBindings.find(value =>
        temporalContains(value, temporalMonthEnd(month)));
      assert.ok(binding, row.id + ': no geometry edition for selected month');
      assert.deepEqual(row.geometryRef,binding.geometryRef,
        row.id + ': resolved source geometry differs from the historic interval');
      assert.equal(row.identity.properties.sourceGeometryVersion,binding.sourceVersionId,
        row.id + ': visible source version must follow the native cursor');
      assert.ok(row.geometry && ['Polygon', 'MultiPolygon'].includes(row.geometry.type),
        row.id + ': expected an actual displayed country geometry');
    }
  }
  assert.deepEqual(catalog(), untouched, 'date queries must never rewrite the source catalog');
});

test('a missing selected country fails instead of substituting an unrelated past snapshot', () => {
  const index = catalog(), month = monthsToCheck()[0];
  assert.ok(selectBuiltinCountries(index, month).length > 0);
  assert.throws(() => assembleBuiltinWorld(index, [], month), /Incomplete builtin country selection/);
  assert.deepEqual(catalog(), index, 'negative selection cannot mutate the index');
});
