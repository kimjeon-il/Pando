import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {verifyHydroBorderFragments} from '../../tools/gis/hydro-point-screen-native.mjs';

const binary=process.env.PANDO_HYDRO_POINT_SCREEN_BINARY;
const polygon=coordinates=>({type:'Polygon',coordinates:[coordinates]});
const left=polygon([[0,0],[1,0],[1,1],[0,1],[0,0]]);
const right=polygon([[1,0.25],[2,0.25],[2,0.75],[1,0.75],[1,0.25]]);
function run(input){assert(binary,'PANDO_HYDRO_POINT_SCREEN_BINARY is required');return spawnSync(binary,[],{input:JSON.stringify(input),encoding:'utf8'});}
test('selected border uses the true GEOS intersection of country boundaries',()=>{
  const result=run({mode:'shared-boundary',left,right,points:[[1,0.5],[1.000001,0.5],[1,0]]});
  assert.equal(result.status,0,result.stderr);const output=JSON.parse(result.stdout);
  assert.equal(output.distances.length,3);assert.equal(output.distances[0],0);
  assert.ok(Math.abs(output.distances[1]-0.000001)<1e-12);assert.equal(output.distances[2],0.25);
});
test('border screen refuses an empty shared boundary and invalid coordinates',()=>{
  let result=run({mode:'shared-boundary',left,right:polygon([[3,0],[4,0],[4,1],[3,1],[3,0]]),points:[[1,0.5]]});
  assert.notEqual(result.status,0);assert.match(result.stderr,/shared.*empty/i);
  result=run({mode:'shared-boundary',left,right,points:[[181,0]]});assert.notEqual(result.status,0);assert.match(result.stderr,/coordinate/i);
});
test('selected border fragments enforce the exact source pair and distance tolerance',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async()=>{
    const feature={metadata:{category:'river',flags:1,source:'Natural Earth border CHN/PRK'},
      geometry:{type:'LineString',coordinates:[[1,0.4],[1,0.6]]}};
    const options={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    const result=await verifyHydroBorderFragments({left,right,pair:'CHN/PRK',features:[feature]},options);
    assert.deepEqual(result,{pair:'CHN/PRK',fragments:1,points:2,maxDistanceDegrees:0});
    const changed=structuredClone(feature);changed.geometry.coordinates[1][0]=1.000003;
    await assert.rejects(verifyHydroBorderFragments({left,right,pair:'CHN/PRK',features:[changed]},options),/shared boundary/i);
    changed.metadata.source='Natural Earth border CHN/RUS';
    await assert.rejects(verifyHydroBorderFragments({left,right,pair:'CHN/PRK',features:[changed]},options),/source pair/i);
  });
