import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {resizeNativePhysicalRgb,resizeNativePhysicalMask,convertNativePhysicalLuminance,createNativePhysicalCompositor} from '../../tools/gis/terrain-preview-native.mjs';

const enabled=Boolean(process.env.PANDO_TERRAIN_PREVIEW_DIRECTORY);
for(const [name,fixture,resize] of [
  ['RGB','physical-resize-oracle.json',resizeNativePhysicalRgb],
  ['mask','physical-mask-resize-oracle.json',resizeNativePhysicalMask],
])test(`physical ${name} resizing matches frozen Pillow pixels`,{skip:!enabled},async()=>{
  const oracle=JSON.parse(readFileSync('tests/fixtures/'+fixture,'utf8'));
  for(const row of oracle.cases){
    const input=Buffer.from(row.input,'base64');
    const actual=await resize({width:row.width,height:row.height,outputWidth:row.outputWidth,outputHeight:row.outputHeight,pixels:input});
    assert.deepEqual(actual,Buffer.from(row.expected,'base64'));
    await assert.rejects(resize({width:row.width,height:row.height,outputWidth:row.width+1,outputHeight:row.height,pixels:input}),/invalid/i);
  }
});
test('physical relief luminance matches frozen Pillow pixels',{skip:!enabled},async()=>{
  const f=JSON.parse(readFileSync('tests/fixtures/physical-luminance-oracle.json','utf8'));
  assert.deepEqual(await convertNativePhysicalLuminance({width:f.width,height:f.height,pixels:Buffer.from(f.input,'base64')}),Buffer.from(f.expected,'base64'));
});
test('physical compositor reuses its process for frozen tile requests',{skip:!enabled},async()=>{
  const fixture=JSON.parse(readFileSync('tests/fixtures/physical-gutter-composite-oracle.json','utf8'));
  const planes=Object.fromEntries(['land','ocean','mask','relief'].map(key=>[key,Buffer.from(fixture[key],'base64')]));
  const compositor=createNativePhysicalCompositor();
  try{
    for(const row of fixture.cases){
      const result=await compositor.combine({width:fixture.width,height:fixture.height,box:row.box,...planes});
      assert.deepEqual(result,Buffer.from(row.expected,'base64'));
    }
  }finally{await compositor.close();}
});
