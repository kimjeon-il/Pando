import { describe as contractSuite } from 'node:test';
import * as __country_dep0 from "node:test";
import * as __country_dep1 from "node:assert/strict";
import * as __country_dep2 from "../../tools/builtin-world-compiler.mjs";
import * as __country_dep3 from "../../tools/territorial-current-world.mjs";
import * as __country_dep4 from "../../shared/frontend/js/modules/temporal.js";
import * as __country_dep5 from "node:crypto";
import * as __country_dep6 from "../../tools/territorial-entity-sources.mjs";
import * as __country_dep7 from "../../tools/gis/apply-post-2000-territorial-links.mjs";

// Original feature contract: historical-world-parent-relations.test.mjs
contractSuite("historical-world-parent-relations", () => {
const test = __country_dep0.default;
const assert = __country_dep1.default;
const { compileBuiltinWorldCatalog } = __country_dep2;
const { buildCurrentWorld } = __country_dep3;
const { temporalContains } = __country_dep4;






const box=(a,b)=>({type:'Polygon',coordinates:[[[a,50],[b,50],[b,51],[a,51],[a,50]]]});
function fixture(){
 const entity=(id,geometry)=>({entityId:id,entityKind:'general',names:{en:id},lifetime:{validFrom:null,validTo:null},
  parentEntityId:'',instantiation:{coverageMode:'explicit'},metadata:{},sourceInfo:{},
  geometryVersions:[{versionId:id+':baseline',validFrom:null,validTo:null,geometry}]});
 const germany=entity('state:DEU',box(0,2));
 germany.sourceInfo={featureId:'DEU',featureProperties:{name:'Germany'}};
 germany.geometryVersions=[
  {versionId:'before',validFrom:null,validTo:'1914-07-30',geometry:box(0,2)},
  {versionId:'empire',validFrom:'1914-07-31',validTo:'1914-07-31',geometry:box(0,8)},
  {versionId:'modern',validFrom:'1914-08-01',validTo:null,geometry:box(0,2)}];
 const entities=[germany,entity('state:east-prussia',box(3,5)),entity('state:west-prussia',box(5,7))];
 const view={schemaVersion:1,selections:[{entityId:'state:DEU',geometryVersionId:'modern'}],sourceInfo:{collectionMetadata:{type:'FeatureCollection'}}};
 const parentRelations=entities.slice(1).map(row=>({entityId:row.entityId,parentEntityId:'state:DEU',
  validFrom:'1914-07-31',validTo:'1914-07-31',basis:{sourceEntityId:'state:DEU',geometryVersionIds:['empire']}}));
 return {entities,view,policy:{schemaVersion:1,unknownPeerOverlap:'exclude-from-all',replacements:[],parentRelations}};
}
const compile=input=>compileBuiltinWorldCatalog({...input,currentWorld:buildCurrentWorld(input),availableSourceIds:new Set(['DEU'])});
function geometryAt(country,date){
 const binding=country.timelineRecords.geometryBindings.find(row=>temporalContains(row,date));
 return country.geometries.find(row=>row.id===binding?.geometryRef.id&&row.version===binding.geometryRef.version)?.geojson;
}

test('dated parent relations retain empire and province coordinates on one day without changing source or adjacent dates',()=>{
 const input=fixture(),before=structuredClone(input),result=compile(input),country=id=>result.countries.find(row=>row.entityId===id);
 assert.deepEqual(geometryAt(country('DEU'),'1914-07-31'),input.entities[0].geometryVersions[1].geometry);
 for(const source of input.entities.slice(1)){
  const actual=country(source.entityId);
  assert.deepEqual(geometryAt(actual,'1914-07-31'),source.geometryVersions[0].geometry);
  assert.deepEqual(actual.timelineRecords.parentRelations.map(({validFrom,validTo,parentId})=>({validFrom,validTo,parentId})),[
   {validFrom:null,validTo:'1914-07-30',parentId:''},
   {validFrom:'1914-07-31',validTo:'1914-07-31',parentId:'DEU'},
   {validFrom:'1914-08-01',validTo:null,parentId:''}]);
 }
 const baseline=compile({...input,policy:{...input.policy,parentRelations:[]}});
 for(const date of ['1914-07-30','1914-08-01','2026-11-05'])for(const actual of result.countries)
  assert.deepEqual(geometryAt(actual,date),geometryAt(baseline.countries.find(row=>row.entityId===actual.entityId),date));
 assert.deepEqual(input,before);
 assert.equal(result.coverageReport.adjustments.some(row=>row.validFrom==='1914-07-31'),false);
});

test('dated parent relations reject unknown, self, overlapping, unbounded and cyclic references',()=>{
 for(const update of [
  rule=>({...rule,parentEntityId:'state:missing'}),
  rule=>({...rule,parentEntityId:rule.entityId}),
  rule=>({...rule,validFrom:null}),
 ]){
  const input=fixture();input.policy.parentRelations=[update(input.policy.parentRelations[0])];
  assert.throws(()=>compile(input),/parent relation/i);
 }
 const overlapping=fixture();overlapping.policy.parentRelations.push({...overlapping.policy.parentRelations[0]});
 assert.throws(()=>compile(overlapping),/overlapping.*parent relation/i);
 const cyclic=fixture();cyclic.policy.parentRelations.push({...cyclic.policy.parentRelations[0],entityId:'state:DEU',parentEntityId:'state:east-prussia'});
 assert.throws(()=>compile(cyclic),/cyclic parent/i);
});


// The partial generator must include dated hierarchy dependencies, then filter
// policy relations out of independently compiled components.
test('partial publication follows dated parent dependencies and leaves unrelated component rules out',async()=>{
 const {historicalWorldCases}=await import('../fixtures/historical-world-cases.mjs');
 const {withExplicitView}=await import('../helpers/builtin-world.mjs');
 const {territorialIndexEntry}=await import('../../tools/gis/territorial-index-entry.js');
 const {buildBuiltinWorldPublication,buildBuiltinWorldPartialPublication}=await import('../../tools/build-builtin-world.mjs');
 const input=withExplicitView(historicalWorldCases());
 const child=input.entities.find(row=>row.entityId==='state:child');child.parentEntityId='';
 child.geometryVersions[0].geometry=box(70,71);
 input.policy.parentRelations=[{entityId:child.entityId,parentEntityId:'state:parent',validFrom:'1900-07-31',validTo:'1900-07-31'}];
 const previousSourceIndex={entities:input.entities.map(entity=>territorialIndexEntry(entity,{sha256:'before'}))};
 const previous=buildBuiltinWorldPublication({input:{...input,sourceIndex:previousSourceIndex}});
 const common={sourceIndex:previousSourceIndex,previousSourceIndex,view:input.view,policy:input.policy,
  previousIndex:JSON.parse(previous.get('index.json')),previousCoverage:JSON.parse(previous.get('coverage-report.json')),
  currentWorld:input.currentWorld,readSource:id=>input.entities.find(row=>row.entityId===id)};
 const plan=buildBuiltinWorldPartialPublication({...common,entityIds:[child.entityId],planOnly:true});
 assert.ok(plan.sourceIds.includes('state:parent'),'a dated parent is required even when bounds do not overlap');
 input.entities.find(row=>row.entityId==='current:KOR').lifetime.validFrom='1948-08-15';
 const sourceIndex={entities:input.entities.map(entity=>territorialIndexEntry(entity,{sha256:entity.entityId==='current:KOR'?'after':'before'}))};
 const partial=buildBuiltinWorldPartialPublication({...common,sourceIndex,entityIds:['current:KOR']});
 const full=buildBuiltinWorldPublication({input:{...input,sourceIndex}});
 assert.deepEqual(JSON.parse(partial.get('index.json')).entities,JSON.parse(full.get('index.json')).entities);
});
});

// Original feature contract: post-2000-territorial-links.test.mjs
contractSuite("post-2000-territorial-links", () => {
const test = __country_dep0.default;
const assert = __country_dep1.default;
const { createHash } = __country_dep5;
const { readTerritorialSources, readTerritorialLineages } = __country_dep6;
const { planPost2000CountryLinks } = __country_dep7;






const hash=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex');
test('transition plan reuses existing geometry and does not predate independence',()=>{
 const sources=readTerritorialSources();
 const policy={schemaVersion:1,replacements:[]};
 const plan=planPost2000CountryLinks(sources,readTerritorialLineages(),policy);
 const byId=new Map(sources.map(x=>[x.entityId,x]));
 if(plan.already){
  assert.ok(byId.has('state:untaet-east-timor'));
  assert.ok(byId.has('state:unmik-kosovo'));
  return;
 }
 const yugoslavia=byId.get('state:yugoslavia');
 const newYugo=plan.updated[0];
 assert.equal(hash(newYugo.geometryVersions.at(-1).geometry),hash(yugoslavia.geometryVersions.at(-1).geometry));
 assert.equal(newYugo.geometryVersions.at(-1).validFrom,'2003-02-04');
 assert.equal(newYugo.lifetime.validTo,'2006-06-02');
 const timor=plan.created.find(x=>x.entityId==='state:untaet-east-timor');
 const kosovo=plan.created.find(x=>x.entityId==='state:unmik-kosovo');
 assert.equal(hash(timor.geometryVersions[0].geometry),hash(byId.get('state:TLS').geometryVersions[0].geometry));
 assert.equal(hash(kosovo.geometryVersions[0].geometry),hash(byId.get('state:KOS').geometryVersions[0].geometry));
 assert.deepEqual(timor.lifetime,{validFrom:'1999-10-25',validTo:'2002-05-19'});
 assert.deepEqual(kosovo.lifetime,{validFrom:'1999-06-10',validTo:'2008-02-16'});
 assert.equal(byId.get('state:TLS').lifetime.validFrom,'2002-05-20');
 assert.equal(byId.get('state:KOS').lifetime.validFrom,'2008-02-17');
 assert.equal(byId.get('state:SDN').geometryVersions[0].validTo,'2011-07-08');
 assert.equal(byId.get('state:SDS').geometryVersions[0].validFrom,'2011-07-09');
});
});
