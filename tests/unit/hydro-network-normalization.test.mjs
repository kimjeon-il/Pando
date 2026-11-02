import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeHydroNetwork} from '../../tools/gis/hydro-network-normalization.mjs';

test('network normalization repairs source-proven junctions without mutating input',
  {skip:!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},async()=>{
    const reach=(id,next,points,borderPair=null)=>({id,next,mainRiver:10,parts:[points],borderPair});
    const chains=[[reach(1,2,[[0,0],[1,0]])],[reach(2,0,[[1.002,0],[2,0]],['AAA','BBB'])],
      [reach(3,2,[[0,1],[1,0]])]],raw={1:{region:'eu',next:2,start:[0,0],end:[1,0]},
      2:{region:'eu',next:0,start:[1,0],end:[2,0]},3:{region:'eu',next:2,start:[0,1],end:[1,0]}},before=structuredClone(chains);
    const result=await normalizeHydroNetwork({chains,raw,sourceOrder:[1,2,3],region:'eu'},
      {directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY});
    assert.equal(result.changedPorts,2);assert.equal(result.remaining.length,0);
    assert.deepEqual(result.chains[0][0].parts[0].at(-1),[1.002,0]);
    assert.deepEqual(result.chains[2][0].parts[0].at(-1),[1.002,0]);assert.deepEqual(chains,before);
  });
test('network normalization retains the order of repeated split source IDs',
  {skip:!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},async()=>{
    const reach=(id,next,points,aligned=false)=>({id,next,mainRiver:10,parts:[points],borderPair:aligned?['AAA','BBB']:null});
    const chains=[[reach(1,2,[[0,0],[1,0]])],[reach(2,0,[[1.002,0],[1.5,0]],true),reach(2,0,[[1.5,0],[2,0]],true)]],
      raw={1:{region:'eu',next:2,start:[0,0],end:[1,0]},2:{region:'eu',next:0,start:[1,0],end:[2,0]}};
    const result=await normalizeHydroNetwork({chains,raw,sourceOrder:[1,2],region:'eu'},
      {directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY});
    assert.deepEqual(result.chains[0][0].parts[0].at(-1),[1.002,0]);
    assert.deepEqual(result.chains[1].map(row=>row.parts[0]),[[[1.002,0],[1.5,0]],[[1.5,0],[2,0]]]);
    assert.equal(result.remaining.length,0);
  });
