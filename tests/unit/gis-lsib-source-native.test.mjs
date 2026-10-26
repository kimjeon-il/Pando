import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {auditLSIBGeometry,readOriginalLineages,verifyLSIBCountryContracts}
  from '../../tools/gis/verify-lsib-country-sources.mjs';

const square=(w,s,e,n)=>({type:'Polygon',coordinates:[[
  [w,s],[e,s],[e,n],[w,n],[w,s]]]});
const model=(id,geometry)=>({
  entityId:id,lineageId:'lineage-'+id,
  names:{ko:id,en:id},lifetime:{validFrom:'1900-01-01',validTo:null},
  parentEntityId:null,metadata:{source:'fixture'},
  geometryVersions:[
    {versionId:id+':historic',validFrom:'1900',validTo:'1910',
      geometry:square(0,0,.5,.5)},
    {versionId:id+':modern',validFrom:null,validTo:null,geometry}
  ]});
const fixture=()=>{
  const originalA=model('A',square(0,0,1,1));
  const originalB=model('B',square(1,0,2,1));
  const after={A:structuredClone(originalA),B:structuredClone(originalB)};
  for(const current of Object.values(after))
    current.metadata.representativeGeometryVersionId=current.entityId+':modern';
  return {
    originals:[
      {lineageId:'lineage-A',entities:[Object.fromEntries(
        Object.entries(originalA).filter(([key])=>key!=='lineageId'))]},
      {lineageId:'lineage-B',entities:[Object.fromEntries(
        Object.entries(originalB).filter(([key])=>key!=='lineageId'))]}
    ],
    after,view:{selections:[
      {entityId:'A',geometryVersionId:'A:modern'},
      {entityId:'B',geometryVersionId:'B:modern'}]},
    candidate:{changes:[{entityId:'A'}]}
  };
};
const contract=fixture=>verifyLSIBCountryContracts(fixture);

test('LSIB Node source contract leaves all history and country identity intact',()=>{
  const source=fixture(),unchanged=structuredClone(source);
  const result=contract(source);
  assert.deepEqual(source,unchanged,'Source contract must be read-only');
  assert.equal(result.unchanged,1);
  assert.equal(result.historical,2);
  assert.equal(result.changedCount,1);
  assert.equal(result.beforeWorld.length,2);
  assert.equal(result.changedModern.length,1);
});

test('LSIB refuses a changed name, historical version or unrelated country',()=>{
  const name=fixture();name.after.A.names.ko='unreviewed';
  assert.throws(()=>contract(name),/Names changed/);
  const past=fixture();past.after.A.geometryVersions[0].geometry.coordinates[0][1][0]+=.01;
  assert.throws(()=>contract(past),/Historical version overwritten/);
  const other=fixture();other.after.B.geometryVersions[1].geometry.coordinates[0][1][0]+=.01;
  assert.throws(()=>contract(other),/Unrelated country changed/);
  const added=fixture();added.candidate.changes.push({entityId:'absent'});
  assert.throws(()=>contract(added),/unknown country/);
});

test('LSIB binary git cat-file reader honors declared exact original bytes',()=>{
  const docs=[{lineageId:'first',entities:[]},{lineageId:'second',entities:[]}];
  const bytes=Buffer.concat(docs.flatMap(doc=>{
    const b=Buffer.from(JSON.stringify(doc));
    return [Buffer.from('hash blob '+b.length+'\n'),b,Buffer.from('\n')];
  }));
  const seen=[];
  const original=readOriginalLineages('abc123',['one','two'],{
    git:(_cmd,_args,opts)=>{seen.push(opts.input);return bytes;}
  });
  assert.deepEqual(original,docs);
  assert.equal(seen[0].split('\n').length,3);
  assert.throws(()=>readOriginalLineages('--danger',['one']),/Unsafe source revision/);
});

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
test('native GEOS validates changed modern country geometry and exact coastline parity',
  {skip:!binary},()=>{
    const input=contract(fixture());
    const result=auditLSIBGeometry(input,{binary});
    assert.equal(result.passed,true);
    assert.equal(result.modernChangedPolygonsValid,true);
    assert.equal(result.globalUnpairedEdgesIdentical,true);
    assert.equal(result.oldOnlyEdges,0);
    assert.equal(result.newOnlyEdges,0);
    assert.equal(result.validatedModernPolygons,1);
  });
test('native GEOS rejects changed outer/coastal edges without accepting near misses',
  {skip:!binary},()=>{
    const input=contract(fixture());
    input.afterWorld[0]=square(0,0,1.01,1);
    input.changedModern[0]=input.afterWorld[0];
    const result=auditLSIBGeometry(input,{binary});
    assert.equal(result.passed,false);
    assert.ok(result.oldOnlyEdges>0);
    assert.ok(result.newOnlyEdges>0);
    assert.ok(result.newUnpairedEdgeSamples.length>0);
  });
test('native GEOS rejects a self-crossing modern polygon',
  {skip:!binary},()=>{
    const input=contract(fixture());
    input.changedModern[0]={type:'Polygon',coordinates:[[
      [0,0],[1,1],[0,1],[1,0],[0,0]]]};
    const result=auditLSIBGeometry(input,{binary});
    assert.equal(result.modernChangedPolygonsValid,false);
    assert.equal(result.passed,false);
  });
