import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {raster} from '../../plugins/pando-map-tools/lib/raster.mjs';
import {encodeNativePng,readNativeImage} from '../../tools/map-image/native-resample.mjs';
import {drawNativePreviewLabels,renderNativePreview} from '../../tools/map-image/native-preview.mjs';

async function assertCandidatePreview(decoded,oracle,job,name){
  // The UI branch explicitly changed only the candidate banner text; preserve
  // the frozen raster comparison for every pixel below that banner.
  const start=25*decoded.width*4;
  assert.equal(Buffer.compare(decoded.data.subarray(start),oracle.subarray(start)),0,name+' map and overlay pixels');
  const data=Buffer.alloc(decoded.width*24*4,255);
  const banner='PROVISIONAL CANDIDATES | orange: border / blue: admin / purple: mixed / yellow: unresolved | georeference: '+
    (job.quality?.recommended?'recommended':'needs review');
  const expected=await drawNativePreviewLabels({width:decoded.width,height:24,data},[{x:5,y:5,text:banner}]);
  assert.equal(Buffer.compare(decoded.data.subarray(0,expected.data.length),expected.data),0,name+' candidate banner');
}

test('native review previews preserve map pixels, overlays and labels without Python',async t=>{
  process.env.PANDO_MAP_PYTHON=resolve('definitely-missing-python');
  const root=resolve('tests/fixtures/map-image/preview'),temporary=mkdtempSync(join(tmpdir(),'pando-map-preview-'));
  t.after(()=>rmSync(temporary,{recursive:true,force:true}));
  for(const name of ['rich','wide','large']){
    const path=resolve(root,name+'.png'),before=readFileSync(path),oracle=JSON.parse(readFileSync(resolve(root,name+'.json'),'utf8'));
    const actual=await raster({action:'preview',path,job:oracle.job});
    assert.deepEqual({width:actual.width,height:actual.height},oracle.expected,name+' dimensions');
    const output=join(temporary,name+'.png');writeFileSync(output,actual.data);
    const decoded=await readNativeImage({path:output,format:'png',maxPixels:16777216});
    await assertCandidatePreview(decoded,readFileSync(resolve(root,name+'.rgba')),oracle.job,name);
    assert.deepEqual(readFileSync(path),before,name+' original');
  }
});

test('wide PDF review previews preserve original two-stage resize pixels',async t=>{
  const root=resolve('tests/fixtures/map-image/preview'),temporary=mkdtempSync(join(tmpdir(),'pando-map-preview-pdf-'));
  t.after(()=>rmSync(temporary,{recursive:true,force:true}));
  for(const name of ['pdf-wide','pdf-odd']){
    const oracle=JSON.parse(readFileSync(resolve(root,name+'.json'),'utf8'));
    const image=await readNativeImage({path:resolve(root,name+'-source.png'),format:'png',maxPixels:16777216});
    const actual=await renderNativePreview(image,oracle.job,{sourceIsPdf:true});
    assert.deepEqual({width:actual.width,height:actual.height},oracle.expected,name+' dimensions');
    const output=join(temporary,name+'.png');writeFileSync(output,actual.data);
    const decoded=await readNativeImage({path:output,format:'png',maxPixels:16777216});
    await assertCandidatePreview(decoded,readFileSync(resolve(root,name+'.rgba')),oracle.job,name);
  }
});

test('reviewed selection preview shows only selected lines, polygon rings and nearby unresolved markers',async t=>{
  const temporary=mkdtempSync(join(tmpdir(),'pando-map-selected-preview-'));
  t.after(()=>rmSync(temporary,{recursive:true,force:true}));
  const image={width:120,height:120,data:Buffer.alloc(120*120*4,255)};
  const original=join(temporary,'source.png');writeFileSync(original,(await encodeNativePng(image)).data);
  const job={source:{width:120,height:120,mapping:{}},graph:{chains:[{points:[[10,105],[100,105]],semanticBits:1}],
    unresolved:[{point:[40,35]},{point:[50,105]}]}};
  const selectedGeometry=[{type:'Polygon',coordinates:[[[10,35],[100,35],[100,95],[10,95],[10,35]],
    [[40,55],[70,55],[70,75],[40,75],[40,55]]]},{type:'LineString',coordinates:[[20,90],[80,90]]}];
  const result=await raster({action:'preview',path:original,job,selectedGeometry});
  const output=join(temporary,'result.png');writeFileSync(output,result.data);
  const decoded=await readNativeImage({path:output,format:'png',maxPixels:16777216});
  const pixel=(x,y)=>[...decoded.data.subarray((y*120+x)*4,(y*120+x)*4+3)];
  assert.deepEqual(pixel(10,60),[22,128,60]);
  assert.deepEqual(pixel(50,55),[22,128,60]);
  assert.deepEqual(pixel(30,90),[22,128,60]);
  assert.deepEqual(pixel(50,65),[255,255,255]);
  assert.deepEqual(pixel(20,105),[255,255,255]);
  assert.deepEqual(pixel(40,30),[255,186,0]);
  assert.deepEqual(pixel(50,100),[255,255,255]);
  await assert.rejects(raster({action:'preview',path:original,job,selectedGeometry:[{type:'Point',coordinates:[1,2]}]}),/selected.*geometry/i);
});
