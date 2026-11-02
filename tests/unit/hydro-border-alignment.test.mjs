import assert from 'node:assert/strict';
import test from 'node:test';
import {alignHydroBorderChains} from '../../tools/gis/hydro-border-alignment.mjs';

test('complete and partial border alignment share chain counts and Python source statistics',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY||!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},async()=>{
    const borders=[{pair:['AAA','BBB'],coordinates:[[1,0],[1,2]]}],chains=[[
      {id:1,parts:[[[1.02,.2],[1.02,1.8]]],borderPair:null,renderSnap:null,terminalClass:''},
      {id:2,parts:[[[.5,.2],[1.02,.5],[1.02,1.6],[1.5,1.8]]],borderPair:null,renderSnap:null,terminalClass:''}]];
    const result=await alignHydroBorderChains({chains,borders},{pointScreen:{directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,
      runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT},connectivity:{directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY}});
    assert.deepEqual(result.stats,{borderAlignedReachCount:2,borderAlignedRiverCount:1,borderAlignedLengthKm:325.5,
      borderChangedCoordinateCount:6,borderPairLengthsKm:{'AAA/BBB':325.5}});
    assert.deepEqual(result.chains[0].map(row=>[row.id,row.borderPair]),
      [[1,['AAA','BBB']],[2,null],[2,['AAA','BBB']],[2,null]]);
  });
