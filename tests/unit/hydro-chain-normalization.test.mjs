import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeHydroChains} from '../../tools/gis/hydro-chain-normalization.mjs';

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
