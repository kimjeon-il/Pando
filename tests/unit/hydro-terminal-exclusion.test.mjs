import assert from 'node:assert/strict';
import test from 'node:test';
import {classifyHydroOutlets,excludeHydroInvalidTerminalBasins} from '../../tools/gis/hydro-connectivity-native.mjs';

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
