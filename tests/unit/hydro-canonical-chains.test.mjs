import assert from 'node:assert/strict';
import test from 'node:test';
import {assembleHydroCanonicalChains} from '../../tools/gis/hydro-reference-guides.mjs';
import {normalizeHydroChains} from '../../tools/gis/hydro-chain-normalization.mjs';
import {normalizeHydroNetwork} from '../../tools/gis/hydro-network-normalization.mjs';

const directory=process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY;
const connectivity=process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY;
test('canonical chain preparation rejects an already cancelled request',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(assembleHydroCanonicalChains({reaches:[],references:[]},{signal:controller.signal}),{name:'AbortError'});
});
test('selected source reaches follow the named reference through a confluence',
  {skip:!directory||!connectivity},async()=>{
    const reaches=[
      {id:1,next:3,mainRiver:7,upstreamArea:20,flow:2,order:1,parts:[[[-1,0],[0,0]]]},
      {id:2,next:3,mainRiver:7,upstreamArea:100,flow:5,order:3,parts:[[[0,1],[0,0]]]},
      {id:3,next:0,mainRiver:7,upstreamArea:120,flow:7,order:4,parts:[[[0,0],[1,0]]]}
    ];
    const references=[{id:'reference',properties:{name:'Guide'},geometry:{type:'LineString',coordinates:[[-1,0],[1,0]]}}];
    const before=structuredClone(reaches),options={pointScreen:{directory,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT},
      connectivity:{directory:connectivity}};
    assert.deepEqual(await assembleHydroCanonicalChains({reaches,references},options),[[2],[1,3]]);
    assert.deepEqual(await assembleHydroCanonicalChains({reaches,references:[]},options),[[2,3],[1]]);
    assert.deepEqual(reaches,before);
    const snapped=structuredClone(reaches);snapped[1].parts=[[[1,0],[0,0]]];snapped[2].renderSnap=[-1,0];
    assert.deepEqual(await assembleHydroCanonicalChains({reaches:snapped,references},options),[[2,3],[1]]);
    assert.deepEqual(snapped[2].parts,[[[0,0],[1,0]]]);
    await assert.rejects(assembleHydroCanonicalChains({reaches:reaches.slice(0,2),references},options),/downstream/i);
  });
test('chain normalization preserves border endpoints and triple-border junctions',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY||!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},async()=>{
    const borders=[{pair:['AAA','BBB'],coordinates:[[1,0],[1,2]]},{pair:['BBB','CCC'],coordinates:[[1,1],[2,1]]}],
      chains=[[{id:1,parts:[[[.5,0],[1,.5]]],borderPair:null},{id:2,parts:[[[1,.5001],[1,.999]]],borderPair:['AAA','BBB']},
        {id:3,parts:[[[1.001,1],[2,1]]],borderPair:['BBB','CCC']}]],before=structuredClone(chains);
    const result=await normalizeHydroChains({chains,borders},{pointScreen:{directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,
      runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT},connectivity:{directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY}});
    assert.equal(result.changed,2);assert.deepEqual(result.chains[0].map(row=>row.parts[0]),
      [[[.5,0],[1,.5001]],[[1,.5001],[1,1]],[[1,1],[2,1]]]);assert.deepEqual(chains,before);
    await assert.rejects(normalizeHydroChains({chains,borders:[]},{pointScreen:{directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,
      runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT},connectivity:{directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY}}),/junction/i);
  });
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
