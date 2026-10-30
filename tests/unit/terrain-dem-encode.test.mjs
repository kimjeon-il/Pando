import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {encodeNativeDemElevation} from '../../tools/gis/terrain-dem-encode.mjs';

const directory=process.env.PANDO_TERRAIN_DEM_ENCODE_DIRECTORY;
const cases=JSON.parse(readFileSync('tests/fixtures/terrain-dem-encoding-oracle.json','utf8'));
test('DEM encoding rejects invalid grids before launching native code',async()=>{
  await assert.rejects(encodeNativeDemElevation({width:1,height:1,levelWidth:1,levelHeight:1,north:0,elevation:Buffer.alloc(1)}),/grid/i);
});
test('native DEM encoding matches original elevation and hillshade bytes',{skip:!directory},async()=>{
  for(const row of cases){const actual=await encodeNativeDemElevation({...row,elevation:Buffer.from(row.elevation,'base64')},{directory});
    assert.deepEqual(actual.shade,Buffer.from(row.shade,'base64'),row.name+' shade');
    assert.deepEqual(actual.rgba,Buffer.from(row.rgba,'base64'),row.name+' RGBA');}
  const row=cases[0],bad=Buffer.from(row.elevation,'base64');bad.writeFloatLE(-12001,0);
  await assert.rejects(encodeNativeDemElevation({...row,elevation:bad},{directory}),/range/i);
  bad.writeFloatLE(NaN,0);await assert.rejects(encodeNativeDemElevation({...row,elevation:bad},{directory}),/range/i);
});
