import { describe as featureDescribe } from 'node:test';
import * as __suiteDependency0 from "node:assert/strict";
import * as __suiteDependency1 from "node:test";
import * as __suiteDependency2 from "../../tools/gis/hydro-border-alignment.mjs";
import * as __suiteDependency3 from "node:assert/strict";
import * as __suiteDependency4 from "node:test";
import * as __suiteDependency5 from "../../tools/gis/hydro-border-partial.mjs";
import * as __suiteDependency6 from "node:assert/strict";
import * as __suiteDependency7 from "node:test";
import * as __suiteDependency8 from "../../tools/gis/hydro-border-whole.mjs";

// Original feature contract: hydro-border-alignment.test.mjs
featureDescribe("hydro-border-alignment", () => {
  const assert = __suiteDependency0.default;
  const test = __suiteDependency1.default;
  const { alignHydroBorderChains } = __suiteDependency2;
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
});
// Original feature contract: hydro-border-partial.test.mjs
featureDescribe("hydro-border-partial", () => {
  const assert = __suiteDependency3.default;
  const test = __suiteDependency4.default;
  const { alignHydroPartialBorderChains } = __suiteDependency5;
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
});
// Original feature contract: hydro-border-whole.test.mjs
featureDescribe("hydro-border-whole", () => {
  const assert = __suiteDependency6.default;
  const test = __suiteDependency7.default;
  const { alignHydroWholeBorderChains } = __suiteDependency8;
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
});
