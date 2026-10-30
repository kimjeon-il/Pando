import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const binary=process.env.PANDO_TERRAIN_PREVIEW_BINARY;
const cases=JSON.parse(readFileSync('tests/fixtures/terrain-preview-kernel.json','utf8'));
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
