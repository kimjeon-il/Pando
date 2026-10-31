import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {encodeNativeWebpLossless,readNativeRawWebp} from '../../tools/map-image/native-resample.mjs';
import {resolve} from 'node:path';

const fixture=JSON.parse(readFileSync('tests/fixtures/physical-gutter-composite-oracle.json','utf8'));
const binary=process.env.PANDO_MAP_IMAGE_ARTIFACT;
test('physical RGB resampling preserves the frozen Pillow Lanczos result',{skip:!process.env.PANDO_TERRAIN_PREVIEW_BINARY},()=>{
  const oracle=JSON.parse(readFileSync('tests/fixtures/physical-resize-oracle.json','utf8'));
  for(const item of oracle.cases){
    const header=Buffer.alloc(24);header.write('PDPRES01');
    [item.width,item.height,item.outputWidth,item.outputHeight].forEach((v,i)=>header.writeUInt32LE(v,8+4*i));
    const result=spawnSync(resolve(process.env.PANDO_TERRAIN_PREVIEW_BINARY),['physical-resize'],
      {input:Buffer.concat([header,Buffer.from(item.input,'base64')]),timeout:20000});
    assert.equal(result.status,0,String(result.stderr));
    assert.deepEqual(result.stdout,Buffer.from(item.expected,'base64'));
    const truncated=spawnSync(resolve(process.env.PANDO_TERRAIN_PREVIEW_BINARY),['physical-resize'],
      {input:header,timeout:20000});
    assert.notEqual(truncated.status,0);assert.equal(truncated.stdout.length,0);
  }
});
function frame(row){
  const width=row.box[2]-row.box[0]+2,height=row.box[3]-row.box[1]+2;
  const expected=Buffer.from(row.expected,'base64');return {width,height,expected};
}
test('physical WebP encoding preserves all RGBA and transparent colors',{skip:!binary},async()=>{
  const frames=fixture.cases.map(frame),transparent=Buffer.from([200,10,50,0,100,99,2,1,0,50,10,255]);
  frames.push({width:3,height:1,expected:transparent});
  for(const row of frames){
    const encoded=await encodeNativeWebpLossless({width:row.width,height:row.height,data:row.expected});
    const decoded=await readNativeRawWebp(encoded.data);
    assert.equal(decoded.width,row.width);assert.equal(decoded.height,row.height);assert.deepEqual(decoded.data,row.expected);
  }
  await assert.rejects(encodeNativeWebpLossless({width:2,height:1,data:Buffer.alloc(3)}),/length/i);
});
