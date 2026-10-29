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
  assert.ok(Math.abs(result.points[2].nearestLonLat[0]-9.2)<1e-7);
});
test('native point screen rejects invalid CRS and coordinates without partial output',{skip:!binary},()=>{
  for(const input of [{...fixture,crs:'EPSG:4326'}, {...fixture,points:[[181,0]]},{...fixture,lines:[[[9,0]]]}]){
    const result=invoke(input);assert.notEqual(result.status,0);assert.equal(result.stdout,'');
  }
});
