import assert from 'node:assert/strict';
import test from 'node:test';
import {alignHydroWholeBorderChains} from '../../tools/gis/hydro-border-whole.mjs';

test('whole border alignment keeps canonical vertices and the source chain order',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY||!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},async()=>{
    const borders=[{pair:['AAA','BBB'],coordinates:[[1,0],[1,2]]}],reach=(id,x)=>({id,parts:[[[x,.2],[x,1.8]]],
      borderPair:null,renderSnap:null,terminalClass:null});
    const chains=[[reach(1,1.02)],[reach(2,1.2)]],before=structuredClone(chains);
    const result=await alignHydroWholeBorderChains({chains,borders},{pointScreen:{directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,
      runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT},connectivity:{directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY}});
    assert.deepEqual(result.chains.map(chain=>chain.map(row=>({id:row.id,parts:row.parts,borderPair:row.borderPair}))),
      [[{id:1,parts:[[[1,.2],[1,1.8]]],borderPair:['AAA','BBB']}],[{id:2,parts:[[[1.2,.2],[1.2,1.8]]],borderPair:null}]]);
    assert.equal(result.stats.alignedReaches,1);assert.equal(result.stats.alignedChains,1);assert.equal(result.stats.changedCoordinates,2);
    assert.ok(Math.abs(result.stats.alignedLength-176.912)<1e-9);assert.deepEqual(chains,before);
  });
test('short consecutive reaches align together when their combined length qualifies',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY||!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},async()=>{
    const borders=[{pair:['AAA','BBB'],coordinates:[[1,0],[1,2]]}],chains=[[{id:1,parts:[[[1.02,.2],[1.02,.26]]]},
      {id:2,parts:[[[1.02,.26],[1.02,.32]]]}]];
    const result=await alignHydroWholeBorderChains({chains,borders},{pointScreen:{directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,
      runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT},connectivity:{directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY}});
    assert.equal(result.stats.alignedReaches,2);assert.equal(result.stats.alignedChains,1);assert.equal(result.stats.changedCoordinates,4);
    assert.ok(Math.abs(result.stats.alignedLength-13.2684)<1e-9);
    assert.deepEqual(result.chains[0].map(row=>row.borderPair),[['AAA','BBB'],['AAA','BBB']]);
  });
