import assert from 'node:assert/strict';
import test from 'node:test';
import {alignHydroPartialBorderChains} from '../../tools/gis/hydro-border-partial.mjs';

test('partial border alignment splits entry and exit while preserving terminal metadata',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY||!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},async()=>{
    const borders=[{pair:['AAA','BBB'],coordinates:[[1,0],[1,2]]}],reach={id:1,parts:[[[.5,.2],[1.02,.5],[1.02,1.6],[1.5,1.8]]],
      borderPair:null,renderSnap:[1.5,1.8],terminalClass:'sea',originalEndpoint:[1.5,1.8]},chains=[[reach]],before=structuredClone(chains);
    const result=await alignHydroPartialBorderChains({chains,borders},{pointScreen:{directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,
      runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT},connectivity:{directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY}});
    assert.equal(result.chains[0].length,3);assert.deepEqual(result.chains[0].map(row=>row.borderPair),[null,['AAA','BBB'],null]);
    const coords=result.chains[0].flatMap(row=>row.parts[0]);
    const expected=[[.5,.2],[.8921858098902988,.42626104416748],[1,.42626104416748],[1,1.636589245879042],
      [1.1078141901097012,1.6365892458790423],[1.5,1.8]];
    for(let i=0;i<coords.length;i++)for(let j=0;j<2;j++)assert.ok(Math.abs(coords[i][j]-expected[i][j])<1e-9);
    assert.deepEqual(result.chains[0].map(row=>row.terminalClass),['','','sea']);
    assert.deepEqual(result.chains[0].at(-1).renderSnap,[1.5,1.8]);assert.equal(result.stats.alignedReaches,1);
    assert.equal(result.stats.changedCoordinates,4);assert.ok(Math.abs(result.stats.alignedLength-148.60202603118262)<1e-8);
    assert.deepEqual(chains,before);
  });
