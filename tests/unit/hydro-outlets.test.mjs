import { describe as contractSuite } from 'node:test';
import * as __hydro_dep0 from "node:assert/strict";
import * as __hydro_dep1 from "node:test";
import * as __hydro_dep2 from "../../tools/gis/hydro-outlets.mjs";
import * as __hydro_dep3 from "../../tools/gis/hydro-connectivity-native.mjs";

// Original feature contract: hydro-outlets.test.mjs
contractSuite("hydro-outlets", () => {
const assert = __hydro_dep0.default;
const test = __hydro_dep1.default;
const { classifyHydroTerminalReaches, createHydroWaterRasterSampler } = __hydro_dep2;




test('water raster sampling follows the original equirectangular pixel and RGB rule',async()=>{
  const data=Uint8Array.from([0,0,0,255, 249,250,249,255, 248,248,248,255, 255,255,255,255,
    255,253,255,255, 250,250,250,255, 0,0,0,255, 255,255,255,255]);
  const sample=createHydroWaterRasterSampler({width:4,height:2,data});
  assert.deepEqual(await sample([[-180,90],[-90,90],[0,90],[180,-90],[-180,-90],[-90,-90]]),
    [true,true,false,true,true,true]);
  assert.deepEqual(await createHydroWaterRasterSampler({width:2,height:1,data:Uint8Array.from([0,0,0,249,250,249])})([[-90,0],[90,0]]),[false,true]);
  assert.throws(()=>createHydroWaterRasterSampler({width:4,height:2,data:data.subarray(1)}),/raster/i);
  await assert.rejects(sample([[0,91]]),/point/i);
});

test('outlet pipeline preserves water precedence and drops only invalid upstream basins',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY||!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},async()=>{
    const rect=(a,b,c,d)=>({type:'Polygon',coordinates:[[[a,b],[c,b],[c,d],[a,d],[a,b]]]});
    const reach=(id,next,end,endorheic=false)=>({id,next,endorheic,originalEndpoint:end,parts:[[[end[0]-.1,end[1]],end]]});
    const reaches=[reach(1,2,[.5,5]),reach(2,0,[0,5]),reach(3,0,[5,5]),reach(4,5,[10,5]),
      reach(5,0,[20,5]),reach(6,0,[2,2]),reach(7,0,[3,3]),reach(8,0,[8,8],true)];
    const options={pointScreen:{directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT},
      connectivity:{directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY}};
    const result=await classifyHydroTerminalReaches({reaches,land:[rect(0,0,10,10)],lakes:[rect(4,4,6,6)],
      sampleWater:async points=>points.map(point=>point[0]===3)},options);
    assert.deepEqual(result.reaches.map(row=>row.id),[1,2,3,8]);
    assert.deepEqual(result.reaches.map(row=>row.terminalClass),[null,'sea','lake','endorheic']);
    assert.equal(result.stats.excludedTerminalReachCount,4);
    assert.deepEqual(result.stats.terminalClassCounts,{sea:1,lake:1,'excluded-small-land':1,'unresolved-land':0,
      'excluded-unresolved-source-terminal':1,'excluded-undisplayed-water':1,endorheic:1});
    assert.deepEqual(result.stats.excludedTerminalSources.map(row=>[row.sourceId,row.class]),
      [[5,'excluded-small-land'],[6,'excluded-unresolved-source-terminal'],[7,'excluded-undisplayed-water']]);
    // Rounded distances from CoastSnapper.resolve on the same land, lake and raster pixels.
    assert.deepEqual(result.stats.excludedTerminalSources.map(row=>row.distanceKm),[1108.964,221.14,331.71]);
    assert.equal(result.stats.coastSnappedTerminalCount,0);
  });
});

// Original feature contract: hydro-terminal-exclusion.test.mjs
contractSuite("hydro-terminal-exclusion", () => {
const assert = __hydro_dep0.default;
const test = __hydro_dep1.default;
const { classifyHydroOutlets, excludeHydroInvalidTerminalBasins } = __hydro_dep3;




test('bounded outlet observations preserve the native class and snap decisions',
  {skip:!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},async()=>{
    const options={directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY};
    const base={lakeDistance:null,lakeCovers:false,coastDistance:3,onLand:true,undisplayedWater:false,
      outsideLength:0,maxKm:25,target:[181,2]};
    assert.deepEqual(await classifyHydroOutlets([base,{...base,lakeDistance:.5}],options),
      [{class:'sea',distanceKm:3,snap:[-179,2]},{class:'lake',distanceKm:.5,snap:null}]);
    assert.deepEqual(await classifyHydroOutlets([],options),[]);
    await assert.rejects(classifyHydroOutlets([{...base,coastDistance:-1}],options),/outlet distance/i);
  });

test('unresolved Hydro terminals exclude only their upstream source basins in source order',
  {skip:!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},async()=>{
    const reaches=[{id:1,next:3,terminalClass:null},{id:2,next:3,terminalClass:null},
      {id:3,next:0,terminalClass:'unresolved-land'},{id:4,next:5,terminalClass:null},
      {id:5,next:0,terminalClass:'sea'},{id:6,next:0,terminalClass:'excluded-undisplayed-water'},
      {id:7,next:6,terminalClass:null},{id:8,next:0,terminalClass:'endorheic'}];
    const before=structuredClone(reaches),options={directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY};
    const actual=await excludeHydroInvalidTerminalBasins(reaches,options);
    assert.deepEqual(actual,{kept:[4,5,8],excluded:[1,2,3,6,7],terminals:[
      {id:3,terminalClass:'excluded-unresolved-source-terminal'},{id:6,terminalClass:'excluded-undisplayed-water'}]});
    assert.deepEqual(reaches,before);
    await assert.rejects(excludeHydroInvalidTerminalBasins([...reaches,reaches[0]],options),/duplicate/i);
  });
});
