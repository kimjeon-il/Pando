import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {composeNativeTerrainPreview,rasterizeNativeTerrainLand} from '../../tools/gis/terrain-preview-native.mjs';

const binary=process.env.PANDO_TERRAIN_PREVIEW_BINARY;
const cases=JSON.parse(readFileSync('tests/fixtures/terrain-preview-kernel.json','utf8'));
const masks=JSON.parse(readFileSync('tests/fixtures/terrain-land-mask.json','utf8'));
function encode(row){
  const header=Buffer.alloc(56);header.write('PDTERR01',0,'ascii');
  for(const [i,value] of [row.width,row.height,row.tintWidth,row.tintHeight].entries())header.writeUInt32LE(value,8+i*4);
  for(const [i,value] of [row.x,row.y,row.levelWidth,row.levelHeight].entries())header.writeDoubleLE(value,24+i*8);
  return Buffer.concat([header,Buffer.from(row.dem),Buffer.from(row.tint),Buffer.from(row.land)]);
}
test('native terrain preview matches frozen Python pixels for slopes, ocean, wrap and polar rows', {skip:!binary},()=>{
  for(const row of cases){const input=encode(row),result=spawnSync(binary,[],{input,maxBuffer:16*1024*1024});
    assert.equal(result.status,0,`${row.name}: ${result.stderr}`);assert.deepEqual(result.stdout,Buffer.from(row.expected),row.name);}
});
test('native terrain preview rejects truncated input, invalid dimensions and nonopaque DEM',{skip:!binary},()=>{
  const input=encode(cases[0]);
  for(const bad of [input.subarray(0,input.length-1),(()=>{const copy=Buffer.from(input);copy.writeUInt32LE(0,8);return copy;})(),
    (()=>{const copy=Buffer.from(input);copy[56+3]=0;return copy;})()]){
    const result=spawnSync(binary,[],{input:bad});assert.equal(result.status,1);assert.equal(result.stdout.length,0);assert(result.stderr.length>0);
  }
});
test('native land mask preserves dateline wrapping, holes and overlapping polygons',{skip:!binary},()=>{
  for(const row of masks){const result=spawnSync(binary,['mask'],{input:JSON.stringify(row),maxBuffer:2*1024*1024});
    assert.equal(result.status,0,`${row.name}: ${result.stderr}`);assert.deepEqual(result.stdout,Buffer.from(row.expectedBase64,'base64'),row.name);}
});
test('terrain preview interface validates pixel buffers before starting the native tool',async()=>{
  const row=cases[0];await assert.rejects(composeNativeTerrainPreview({...row,dem:Buffer.alloc(1),tint:Buffer.from(row.tint),land:Buffer.from(row.land)}),/buffer/i);
});
test('source-bound terrain preview interface preserves all frozen pixel cases',{
  skip:!process.env.PANDO_TERRAIN_PREVIEW_DIRECTORY,
},async()=>{
  for(const row of cases){const output=await composeNativeTerrainPreview({...row,dem:Buffer.from(row.dem),tint:Buffer.from(row.tint),land:Buffer.from(row.land)},
    {directory:process.env.PANDO_TERRAIN_PREVIEW_DIRECTORY});assert.deepEqual(output,Buffer.from(row.expected),row.name);}
  for(const row of masks){const output=await rasterizeNativeTerrainLand(row,{directory:process.env.PANDO_TERRAIN_PREVIEW_DIRECTORY});
    assert.deepEqual(output,Buffer.from(row.expectedBase64,'base64'),row.name);}
});
