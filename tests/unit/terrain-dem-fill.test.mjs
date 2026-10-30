import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import * as source from '../../tools/gis/terrain-dem-source.mjs';

test('DEM tint filling rejects invalid grids and missing valid land before starting GDAL',async()=>{
  const fill=source.fillGdalDemTint;
  await assert.rejects(fill({width:2,height:1,rgb:new Float32Array(6),valid:Buffer.alloc(2)}),/valid land/i);
  await assert.rejects(fill({width:2,height:1,rgb:new Float32Array(5),valid:Buffer.from([1,0])}),/grid/i);
  await assert.rejects(fill({width:1,height:1,rgb:Float32Array.from([NaN,1,2]),valid:Buffer.from([1])}),/non-finite/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(fill({width:1,height:1,rgb:new Float32Array(3),valid:Buffer.from([1])},{signal:controller.signal}),{name:'AbortError'});
});

test('tint stream rejects a truncated or invalid request before invoking the native tool',()=>{
  const header=Buffer.alloc(16);header.write('PDTINT01');header.writeUInt32LE(1,8);header.writeUInt32LE(1,12);
  for(const input of [Buffer.from('bad'),header]){
    const result=spawnSync(process.execPath,['tools/gis/terrain-dem-fill.mjs','--fill-tint'],{input,encoding:'buffer'});
    assert.notEqual(result.status,0);assert.equal(result.stdout.length,0);assert.ok(result.stderr.length);
  }
});

const nativeDirectory=process.env.PANDO_TERRAIN_DEM_FILL_DIRECTORY;
test('GDAL nearest tint fill wraps longitude and preserves actual donor colours',{skip:!nativeDirectory},async()=>{
  const width=8,height=2,rgb=new Float32Array(width*height*3),valid=Buffer.alloc(width*height);
  for(let y=0;y<height;y++)for(const [x,colour] of [[0,[120,160,140]],[4,[180,140,100]]]){
    const i=y*width+x;valid[i]=1;for(let c=0;c<3;c++)rgb[c*width*height+i]=colour[c];
  }
  const result=await source.fillGdalDemTint({width,height,rgb,valid});
  assert.equal(result.length,rgb.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x,colour=[0,1,2].map(c=>result[c*width*height+i]);
    assert.ok([[120,160,140],[180,140,100]].some(donor=>donor.every((v,c)=>colour[c]===v)));
  }
  for(let c=0;c<3;c++){
    assert.equal(result[c*width*height],[120,160,140][c]);
    assert.equal(result[c*width*height+4],[180,140,100][c]);
  }
  assert.equal(result[7],120);assert.equal(result[3],180);
});

test('GDAL tint filling rounds ties to even and clips finite floating point colours',{skip:!nativeDirectory},async()=>{
  const width=4,height=1,valid=Buffer.from([1,1,0,1]);
  const rgb=Float32Array.from([0.5,1.5,NaN,256.75, 254.5,-4.5,NaN,22.75, 12.25,13.5,NaN,14.5]);
  const result=await source.fillGdalDemTint({width,height,rgb,valid});
  assert.deepEqual([result[0],result[1],result[3]],[0,2,255]);
  assert.deepEqual([result[4],result[5],result[7]],[254,0,23]);
  assert.deepEqual([result[8],result[9],result[11]],[12,14,14]);
});

test('GDAL tint filling matches the frozen Python result for a mixed fractional grid',
  {skip:!nativeDirectory},async()=>{
    const fixture=JSON.parse(await readFile(new URL('../fixtures/terrain-dem-fill-oracle.json',import.meta.url),'utf8'));
    const {width,height,expected}=fixture,valid=Uint8Array.from(fixture.valid),
      rgb=Float32Array.from(fixture.rgb,value=>value===null?NaN:value);
    assert.deepEqual(Array.from(await source.fillGdalDemTint({width,height,rgb,valid})),expected);
  });
