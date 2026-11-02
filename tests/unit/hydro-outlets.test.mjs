import assert from 'node:assert/strict';
import test from 'node:test';
import {classifyHydroTerminalReaches,createHydroWaterRasterSampler} from '../../tools/gis/hydro-outlets.mjs';

test('water raster sampling follows the original equirectangular pixel and RGB rule',async()=>{
  const data=Uint8Array.from([0,0,0,255, 249,250,249,255, 248,248,248,255, 255,255,255,255,
    255,253,255,255, 250,250,250,255, 0,0,0,255, 255,255,255,255]);
  const sample=createHydroWaterRasterSampler({width:4,height:2,data});
  assert.deepEqual(await sample([[-180,90],[-90,90],[0,90],[180,-90],[-180,-90],[-90,-90]]),
    [true,true,false,true,true,true]);
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
