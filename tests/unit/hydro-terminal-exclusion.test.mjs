import assert from 'node:assert/strict';
import test from 'node:test';
import {excludeHydroInvalidTerminalBasins} from '../../tools/gis/hydro-connectivity-native.mjs';

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
