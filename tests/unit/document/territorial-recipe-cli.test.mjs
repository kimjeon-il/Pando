// Generic historical geometry recipe invariants: no country/year/source pin is a unit oracle.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {replaceRecipeGeometry,sameRecipeGeometryWithinProjectionRounding,verifySourceHashes}
  from '../../../tools/build/build-territorial-geometry.mjs';

const oldGeometry={type:'MultiPolygon',coordinates:[[[[0,0],[0,1],[1,0],[0,0]]]]};
const newGeometry={type:'MultiPolygon',coordinates:[[[[0,0],[0,2],[2,0],[0,0]]]]};
const referenceDate='2001-02-03';
const id='fixture-version';
const recipe={entityId:'state:fixture',id,referenceDate};
const entity={
  entityId:'state:fixture',
  geometryVersions:[
    {versionId:id,validFrom:referenceDate,validTo:referenceDate,geometry:oldGeometry,
      sourceId:'original'},
    {versionId:'earlier',validFrom:'1999-01-01',validTo:'2000-12-31',
      geometry:oldGeometry,sourceId:'original'},
  ],
  sourceInfo:{title:'Original entity',license:'fixture',notes:'Original',
    sources:[{url:'https://example.invalid/source-original',title:'Original'}],
    importProvenance:{versionIds:{[id]:'imported-record'}},
    geometryRecipes:[{id:'imported-record',sourceId:'original',notes:'Original'}]},
};
const candidateSource={id:'source:reviewed',title:'Approved candidate',license:'fixture',
  notes:'New review',sources:[{url:'https://example.invalid/source-reviewed',title:'Review'}]};

test('recipe input checks selected original bytes and rejects source drift',t=>{
  const dir=mkdtempSync(join(tmpdir(),'pando-recipe-unit-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const raw='{"value":"original"}\n';
  writeFileSync(join(dir,'original.json'),raw);
  const sources={reference:{path:'original.json',
    sha256:createHash('sha256').update(raw).digest('hex')}};
  assert.doesNotThrow(()=>verifySourceHashes({sources},dir));
  assert.throws(()=>verifySourceHashes({sources:{reference:{...sources.reference,
    sha256:'0'.repeat(64)}}},dir),/SHA-256 mismatch/);
});
test('recipe changes only the selected version and never mutates accepted source',()=>{
  const before=structuredClone(entity),result=replaceRecipeGeometry(entity,recipe,newGeometry);
  assert.deepEqual(entity,before);
  assert.deepEqual(result.geometryVersions[0].geometry,newGeometry);
  assert.deepEqual(result.geometryVersions[1],before.geometryVersions[1]);
  result.geometryVersions[0].geometry=before.geometryVersions[0].geometry;
  assert.deepEqual(result,before);
  assert.throws(()=>replaceRecipeGeometry(entity,{...recipe,entityId:'state:wrong'},
    newGeometry),/identity mismatch/);
  assert.throws(()=>replaceRecipeGeometry(entity,{...recipe,referenceDate:'2001-02-04'},
    newGeometry),/date mismatch/);
});
test('projection tolerance permits only finite, unchanged polygon structures',()=>{
  const almost=structuredClone(oldGeometry);
  almost.coordinates[0][0][0][0]+=1e-12;
  assert.equal(sameRecipeGeometryWithinProjectionRounding(almost,oldGeometry),true);
  almost.coordinates[0][0][0][0]+=1e-8;
  assert.equal(sameRecipeGeometryWithinProjectionRounding(almost,oldGeometry),false);
  almost.coordinates[0][0].pop();
  assert.equal(sameRecipeGeometryWithinProjectionRounding(almost,oldGeometry),false);
  assert.equal(sameRecipeGeometryWithinProjectionRounding(
    {type:'Polygon',coordinates:oldGeometry.coordinates},oldGeometry),false);
});
test('recipe provenance updates only the reviewed version and replaces matching source URLs',()=>{
  const withSource={...recipe,resultSource:candidateSource,boundarySupplement:{kind:'reviewed'}};
  const before=structuredClone(entity),result=replaceRecipeGeometry(entity,withSource,newGeometry);
  assert.deepEqual(entity,before);
  assert.equal(result.geometryVersions[0].sourceId,candidateSource.id);
  assert.deepEqual(result.geometryVersions[0].boundarySupplement,withSource.boundarySupplement);
  assert.deepEqual(result.geometryVersions[1],before.geometryVersions[1]);
  assert.equal(result.sourceInfo.title,candidateSource.title);
  assert.equal(result.sourceInfo.geometryRecipes[0].sourceId,candidateSource.id);
  assert.deepEqual(result.sourceInfo.sources,[...before.sourceInfo.sources,...candidateSource.sources]);
  assert.deepEqual(replaceRecipeGeometry(result,withSource,newGeometry),result);
});
test('review evidence is attached without changing geometry identity or the source master',()=>{
  const review={schemaVersion:1,status:'passed',geometrySha256:'fixture-digest'};
  const before=structuredClone(entity);
  const result=replaceRecipeGeometry(entity,{...recipe,displayDetailReview:review},newGeometry);
  assert.deepEqual(entity,before);
  assert.deepEqual(result.geometryVersions[0].historicalProvenance.displayDetailReview,review);
  assert.deepEqual(result.sourceInfo,before.sourceInfo);
});
