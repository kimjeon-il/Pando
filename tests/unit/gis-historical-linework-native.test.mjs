import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {digest,verifyHistoricalLinework}
  from '../../tools/gis/verify-historical-linework.mjs';

const executable=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const collection=rows=>({type:'FeatureCollection',features:rows.map((coordinates,i)=>({
  type:'Feature',id:'historical-'+i,properties:{},geometry:{type:'LineString',coordinates},
}))});
function audit(t,rows){
  assert.ok(executable,'Native GEOS recipe executable required');
  const folder=mkdtempSync(join(tmpdir(),'pando-c1-line-'));
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const path=join(folder,'lines.geojson'),bytes=JSON.stringify(collection(rows));
  writeFileSync(path,bytes);
  const p=spawnSync(executable,['--audit-linework',path],{encoding:'utf8'});
  assert.equal(p.status,0,p.stderr);
  return {result:JSON.parse(p.stdout),path,sha256:digest(Buffer.from(bytes))};
}
test('four independent lineage branches retain only permitted common endpoint touches',t=>{
  const {result,path,sha256}=audit(t,[
    [[0,0],[1,0]],[[1,0],[2,0]],[[1,0],[1,1]]
  ]);
  assert.equal(result.passed,true);
  assert.equal(result.featureCount,3);
  assert.equal(result.endpointTouchPairs,3);
  assert.deepEqual(result.nonEndpointCrossings,[]);
  assert.deepEqual(result.nonSimpleFeatures,[]);
  const checked=verifyHistoricalLinework(path,sha256,executable);
  assert.equal(checked.verified,true);
  assert.equal(checked.sourceBytesUnchanged,true);
  assert.equal(checked.endpointTouchPairs,3);
});
test('a true cross, collinear overlap and endpoint-on-interior T junction are each rejected',t=>{
  for(const rows of [
    [[[0,0],[2,2]],[[0,2],[2,0]]],
    [[[0,0],[3,0]],[[1,0],[4,0]]],
    [[[0,0],[3,0]],[[1,0],[1,2]]],
  ]){
    const {result,path,sha256}=audit(t,rows);
    assert.equal(result.passed,false);
    assert.deepEqual(result.nonEndpointCrossings,[[0,1]]);
    assert.throws(()=>verifyHistoricalLinework(path,sha256,executable),
      /intersections rejected/);
  }
});
test('self-crossing reach is independently rejected even if it has no neighbors',t=>{
  const {result}=audit(t,[[[0,0],[3,3],[0,3],[3,0]]]);
  assert.deepEqual(result.nonSimpleFeatures,[0]);
  assert.equal(result.passed,false);
});
test('bad source geometry or unexpected feature type cannot be mistaken for no crossings',t=>{
  const {path}=audit(t,[[[0,0],[1,0]]]);
  const wrong=collection([[[0,0],[1,0]]]);
  wrong.features[0].geometry.type='Polygon';
  writeFileSync(path,JSON.stringify(wrong));
  const checked=spawnSync(executable,['--audit-linework',path],{encoding:'utf8'});
  assert.notEqual(checked.status,0);
  assert.match(checked.stderr,/requires LineStrings/);
});
test('SHA mismatch fails before the native engine can reinterpret unapproved input',t=>{
  const {path,sha256}=audit(t,[[[0,0],[1,0]]]);
  assert.throws(()=>verifyHistoricalLinework(path,'0'.repeat(64),executable),
    /SHA-256 mismatch/);
  assert.notEqual(sha256,'0'.repeat(64));
  assert.ok(readFileSync(path).length>0);
});
