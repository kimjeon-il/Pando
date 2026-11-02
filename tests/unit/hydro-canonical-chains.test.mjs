import assert from 'node:assert/strict';
import test from 'node:test';
import {assembleHydroCanonicalChains} from '../../tools/gis/hydro-reference-guides.mjs';

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
