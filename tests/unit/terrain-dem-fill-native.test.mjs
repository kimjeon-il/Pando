import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const binary=process.env.PANDO_TERRAIN_DEM_FILL_BINARY;
const fixture=JSON.parse(await readFile(new URL('../fixtures/terrain-dem-fill-oracle.json',import.meta.url),'utf8'));
function request({width=fixture.width,height=fixture.height,rgb=fixture.rgb,valid=fixture.valid}={}){
  const header=Buffer.alloc(16);header.write('PDTINT01');header.writeUInt32LE(width,8);header.writeUInt32LE(height,12);
  const colours=Buffer.alloc(rgb.length*4);
  for(let i=0;i<rgb.length;i++)colours.writeFloatLE(rgb[i]===null?NaN:rgb[i],i*4);
  return Buffer.concat([header,colours,Buffer.from(valid)]);
}
function run(input){return spawnSync(binary,[],{input,encoding:'buffer',maxBuffer:1024*1024,windowsHide:true});}

test('native GDAL fill matches the frozen Python output, including longitude wrap and float rounding',{skip:!binary},()=>{
  const result=run(request());
  assert.equal(result.status,0,String(result.stderr));
  assert.deepEqual(Array.from(result.stdout),fixture.expected);
});

test('native GDAL fill rejects missing donors, nonfinite valid pixels, and truncated input',{skip:!binary},()=>{
  for(const input of [
    request({width:1,height:1,rgb:[1,2,3],valid:[0]}),
    request({width:1,height:1,rgb:[NaN,2,3],valid:[1]}),
    request().subarray(0,20),
  ]){
    const result=run(input);
    assert.notEqual(result.status,0);
    assert.equal(result.stdout.length,0);
    assert.ok(result.stderr.length);
  }
});
