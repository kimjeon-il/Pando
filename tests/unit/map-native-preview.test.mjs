import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {drawNativePreviewLabels} from '../../tools/map-image/native-preview.mjs';
test('shared image labels use a verified font and preserve their source pixels',async()=>{
  const fontFile=resolve('tools/cpp/map-preview/aileron-subset.ttf');
  const fontSha256=createHash('sha256').update(readFileSync(fontFile)).digest('hex');
  const data=Buffer.alloc(240*60*4,255),input={width:240,height:60,data};
  const result=await drawNativePreviewLabels(input,[{x:5,y:5,text:'Map labels',size:18,color:0x172033}],{fontFile,fontSha256});
  assert.equal(result.data.length,data.length);assert.ok(!result.data.equals(data));assert.ok(data.every(value=>value===255));
  await assert.rejects(drawNativePreviewLabels(input,[{x:5,y:5,text:'Map labels',size:18}],{fontFile,fontSha256:'0'.repeat(64)}),/font.*hash/i);
});
