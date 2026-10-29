import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const binary=process.env.PANDO_HYDRO_POINT_SCREEN_BINARY;
const fixture={crs:'EPSG:32632',lines:[[[9,0],[9,1]],[[9.2,0],[9.2,1]]],points:[[9,0],[9.1,0.5],[9.19,0.5]]};
function invoke(value){
  assert.ok(binary,'PANDO_HYDRO_POINT_SCREEN_BINARY must name the native test tool');
  return spawnSync(binary,[],{input:JSON.stringify(value),encoding:'utf8',maxBuffer:16*1024*1024});
}
test('native point screen computes projected lengths and closest points',{skip:!binary},()=>{
  const output=invoke(fixture);assert.equal(output.status,0,output.stderr);
  const result=JSON.parse(output.stdout);assert.equal(result.points.length,3);assert.equal(result.lineLengthsMeters.length,2);
  assert.ok(result.lineLengthsMeters.every(x=>x>110000&&x<111000));
  assert.ok(result.points[0].distanceMeters<1e-6);
  assert.ok(result.points[1].distanceMeters>10000&&result.points[1].distanceMeters<12000);
  assert.ok(result.points[2].distanceMeters>1000&&result.points[2].distanceMeters<1200);
  assert.ok(Math.abs(result.points[2].nearestLonLat[0]-9.199992435555043)<1e-8);
  assert.ok(Math.abs(result.points[2].nearestLonLat[1]-0.500000007662718)<1e-8);
});
test('native point screen rejects invalid CRS and coordinates without partial output',{skip:!binary},()=>{
  for(const input of [{...fixture,crs:'EPSG:4326'}, {...fixture,points:[[181,0]]},{...fixture,lines:[[[9,0]]]},{...fixture,mode:'unknown'}]){
    const result=invoke(input);assert.notEqual(result.status,0);assert.equal(result.stdout,'');
  }
});
test('native point screen supports independent input parts for batch audits',{skip:!binary},()=>{
  const result=invoke({...fixture,mode:'parts',lines:[...fixture.lines,[[9,0],[9,0]]]});assert.equal(result.status,0,result.stderr);
  const output=JSON.parse(result.stdout);assert.equal(output.points.length,3);
  assert.equal(output.lineLengthsMeters.length,2);
  assert.ok(Math.abs(output.points[2].nearestLonLat[0]-9.199992435555043)<1e-8);
});
test('native point screen reports line lengths when a system has no external points',{skip:!binary},()=>{
  const result=invoke({...fixture,mode:'parts',points:[]});assert.equal(result.status,0,result.stderr);
  const output=JSON.parse(result.stdout);assert.deepEqual(output.points,[]);assert.equal(output.lineLengthsMeters.length,2);
});
test('native point screen supports indexed nearest-line searches',{skip:!binary},()=>{
  const result=invoke({...fixture,mode:'tree'});assert.equal(result.status,0,result.stderr);
  const output=JSON.parse(result.stdout);assert.equal(output.points.length,3);
  assert.ok(Math.abs(output.points[2].nearestLonLat[0]-9.199992435555043)<1e-8);
});
test('native vector screen compares both directions in projected coordinates',{skip:!binary},()=>{
  const line=[[145,-37.8],[145.01,-37.81]],result=invoke({crs:'EPSG:32755',mode:'vector',lines:[line],referenceLines:[line],points:[],samples:5});
  assert.equal(result.status,0,result.stderr);const output=JSON.parse(result.stdout);
  assert.equal(output.lineLengthsMeters.length,1);assert.equal(output.referenceLengthsMeters.length,1);
  assert.equal(output.hydroToReferenceMeters.length,5);assert.equal(output.referenceToHydroMeters.length,5);
  assert.ok(output.hydroToReferenceMeters.every(value=>value<1e-6));
  assert.ok(output.referenceToHydroMeters.every(value=>value<1e-6));
  assert.equal(output.referenceBoundsMeters.length,4);
});
test('native vector screen rejects missing, invalid or degenerate source lines',{skip:!binary},()=>{
  for(const referenceLines of [[],[[[145,-37.8],[145,-37.8]]]]){
    const result=invoke({crs:'EPSG:32755',mode:'vector',lines:[[[145,-37.8],[145.01,-37.81]]],referenceLines,points:[],samples:5});
    assert.notEqual(result.status,0);assert.equal(result.stdout,'');
  }
});
