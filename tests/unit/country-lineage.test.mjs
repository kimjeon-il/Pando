import assert from 'node:assert/strict';
import test from 'node:test';
import * as catalog from '../../assets/js/modules/territorial-library.js';

const entity=(entityId,from=null,to=null)=>({schemaVersion:2,entityId,entityKind:'general',names:{ko:entityId,en:entityId,de:'curated'},alternateNames:['alias'],lifetime:{validFrom:from,validTo:to},geometryVersions:[{versionId:'border',validFrom:from,validTo:to,datePrecision:'date',certainty:'high',sourceId:'synthetic-test',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]}}]});
const lineage=()=>({schemaVersion:1,lineageId:'germany',names:{ko:'독일',en:'Germany'},entities:[entity('state:test-frg','1949-05-23','1990-10-02'),entity('state:test-gdr','1949-10-07','1990-10-02')],relations:[]});

test('new entity contract retains names and entity-scoped version identity without geometry rewrites',()=>{
  const raw=entity('state:test');
  const result=catalog.normalizeTerritorialLibraryEntity(raw);
  assert.deepEqual(result.names,{ko:'state:test',en:'state:test',de:'curated'});
  assert.equal(result.geometryVersions[0].versionId,'border');
  assert.deepEqual(result.geometryVersions[0].geometry,raw.geometryVersions[0].geometry);
  assert.ok(Object.isFrozen(result.geometryVersions[0].geometry.coordinates));
});
test('split countries coexist in a lineage and relation never overrides lifetime selection',()=>{
  const raw=lineage();raw.relations=[{type:'successor',from:'state:test-frg',to:'state:test-gdr'}];
  const result=catalog.normalizeTerritorialLineage(raw);
  assert.deepEqual(result.entities.filter(e=>catalog.territorialEntityExistsAt(e,'1970')).map(e=>e.entityId),['state:test-frg','state:test-gdr']);
  assert.equal(catalog.selectGeometryVersion(result.entities[1],'1949-05'),null);
  assert.equal(catalog.selectGeometryVersion(result.entities[1],'1990-10-02').versionId,'border');
  assert.equal(catalog.selectGeometryVersion(result.entities[1],'1990-10-03'),null);
});
test('duplicate entities, unsafe lineage names and malformed succession fail visibly',()=>{
  for(const mutate of [r=>r.entities.push(r.entities[0]),r=>r.lineageId='../escape',r=>r.relations=[{type:'successor',from:'state:test-frg',to:'state:test-frg'}],r=>r.relations=[{type:'parent',from:'state:test-frg',to:'state:test-gdr'}],r=>r.relations=Array(2).fill({type:'successor',from:'state:test-frg',to:'state:test-gdr'})]){const raw=lineage();mutate(raw);assert.throws(()=>catalog.normalizeTerritorialLineage(raw));}
});
test('retired names and version ID keys are rejected rather than read as fallback',()=>{
  for(const mutate of [r=>r.canonicalName='old',r=>r.displayNames={ko:'old'},r=>r.geometryVersions[0].id='old',r=>r.names={}]){const raw=entity('state:test');mutate(raw);assert.throws(()=>catalog.normalizeTerritorialLibraryEntity(raw));}
});
