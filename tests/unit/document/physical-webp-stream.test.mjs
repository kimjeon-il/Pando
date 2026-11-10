import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {encodeNativeWebpLossless,readNativeRawWebp} from "../../../tools/map-image/native-resample.mjs";

const fixture=JSON.parse(readFileSync('tests/fixtures/physical-gutter-composite-oracle.json','utf8'));
const binary=process.env.PANDO_MAP_IMAGE_ARTIFACT;
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
