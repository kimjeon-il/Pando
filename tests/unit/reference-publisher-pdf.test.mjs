import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {derivePublisherPdfTrainingLayers,encodePublisherRgbJpeg,extractPublisherPdfText,inspectPublisherPdf,renderMacroPdf,renderMacroStrokes,renderPublisherPdfLayers} from '../../tools/reference-analysis/native-publisher-pdf.mjs';
import {inspectNativeJpeg} from '../../tools/map-image/native-resample.mjs';
import {deriveMacroFill} from '../../tools/reference-analysis/native-macro-fill.mjs';

test('publisher layer renderer matches the frozen original PDF pixels',async()=>{
  const root=resolve('tests/fixtures/reference-publisher-layers');
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  for(const [file,manifest] of [['fixture.pdf','oracle.json'],['rotated-glyphs.pdf','rotated-glyphs.json'],['ocmd.pdf','ocmd.json']]){
  const path=resolve(root,file),input=readFileSync(path),oracle=JSON.parse(readFileSync(resolve(root,manifest),'utf8'));
  assert.equal(sha(input),oracle.sourceSha256);
  const info=await inspectPublisherPdf({path});
  // MuPDF enumerates OCGs in a different order from the PDF layer UI.
  // Selection is by name, while the UI order preserves parent relationships.
  assert.deepEqual(info.layers.map(layer=>layer.name).sort(),[...oracle.layers].sort());
  assert.deepEqual(info.ui.map(layer=>layer.text),oracle.layers);
  assert.equal(info.pageCount,1);assert.equal(info.rotation,0);
  assert.deepEqual(info.sourceRectPts,oracle.sourceRectPts);
  for(const row of oracle.renders){
    const rendered=await renderPublisherPdfLayers({path,enabled:row.enabled,maximumDimension:oracle.text.maximumDimension});
    assert.equal(rendered.width,row.width);assert.equal(rendered.height,row.height);assert.equal(sha(rendered.rgb),row.sha256);
  }
  if(oracle.fractional){const row=oracle.fractional,result=await renderPublisherPdfLayers({path,enabled:row.enabled,maximumDimension:row.maximumDimension});
    assert.equal(result.width,row.width);assert.equal(result.height,row.height);assert.equal(sha(result.rgb),row.sha256);}
  const text=await extractPublisherPdfText({path,maximumDimension:oracle.text.maximumDimension});
  assert.equal(sha(text.mask),oracle.text.maskSha256);assert.equal(sha(text.credits),oracle.text.creditSha256);
  assert.equal(text.characters,oracle.text.characters);
  const derived=await derivePublisherPdfTrainingLayers({path,maximumDimension:oracle.text.maximumDimension});
  assert.equal(sha(derived.rgb),oracle.derived.rgbSha256);assert.equal(sha(derived.mask),oracle.derived.maskSha256);
  assert.equal(sha(derived.validMask),oracle.derived.validSha256);assert.equal(derived.observedMask,oracle.derived.observedMask);
  assert.deepEqual(derived.positivePixels,oracle.derived.positivePixels);assert.equal(sha(derived.credits),oracle.text.creditSha256);
  const jpeg=await encodePublisherRgbJpeg(derived);assert.deepEqual(await inspectNativeJpeg(jpeg),[derived.width,derived.height]);
  await assert.rejects(renderPublisherPdfLayers({path,enabled:['missing'],maximumDimension:160}),/layer/i);
  await assert.rejects(renderPublisherPdfLayers({path,enabled:['International','International'],maximumDimension:160}),/layer/i);
  await assert.rejects(renderPublisherPdfLayers({path,enabled:[],maximumDimension:16}),/dimension/i);
  assert.deepEqual(readFileSync(path),input);
  }
});

test('macro stroke signatures match original solid and dashed masks',async()=>{
  const root=resolve('tests/fixtures/reference-macro-pdf'),path=resolve(root,'strokes.pdf');
  const original=readFileSync(path),oracle=JSON.parse(readFileSync(resolve(root,'strokes.json'),'utf8'));
  for(const row of oracle.rows){const actual=await renderMacroStrokes({path,maximumDimension:160,signatures:row.signatures});
    assert.deepEqual([actual.width,actual.height],[oracle.width,oracle.height]);
    assert.equal(createHash('sha256').update(actual.mask).digest('hex'),row.sha256);}
  await assert.rejects(renderMacroStrokes({path,maximumDimension:160,signatures:[{color:[0,0,0],width:9,dashes:[]}]}),/absent/i);
  assert.deepEqual(readFileSync(path),original);
});

test('macro PDF image and glyph masks match the original unrotated coordinate system',async()=>{
  const root=resolve('tests/fixtures/reference-macro-pdf'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  for(const name of ['base','rotation-90','rotation-180','rotation-270']){
    const path=resolve(root,name+'.pdf'),original=readFileSync(path),oracle=JSON.parse(readFileSync(resolve(root,name+'.json'),'utf8'));
    const actual=await renderMacroPdf({path,maximumDimension:160});
    assert.deepEqual([actual.width,actual.height,actual.rotation],[oracle.width,oracle.height,oracle.rotation]);
    assert.equal(sha(actual.rgb),oracle.rgbSha256);assert.equal(sha(actual.textMask),oracle.textSha256);
    assert.equal(sha(actual.credits),oracle.creditsSha256);assert.deepEqual(readFileSync(path),original);
    const metadata={geographicScope:'country',scopeEvidence:'test fixture',materialKind:'published-macro-pdf',rightsReviewed:true,
      license:'fixture only',supervision:{strategy:'country-fill-adjacency',radiusPixels:3,countryFillColors:[[.7,.5,.3],[.3,.5,.7]]},
      excludedRegionsNormalized:[[.45,.75,.55,.95]]};
    const fill=await deriveMacroFill({path,metadata,maximumDimension:160});
    assert.deepEqual([fill.width,fill.height],[oracle.fill.width,oracle.fill.height]);
    assert.equal(sha(fill.image),oracle.fill.rgbSha256);assert.equal(sha(fill.target),oracle.fill.targetSha256);
    assert.equal(sha(fill.known),oracle.fill.knownSha256);assert.equal(sha(fill.credits),oracle.fill.creditsSha256);
    await assert.rejects(deriveMacroFill({path,metadata:{...metadata,rightsReviewed:false},maximumDimension:160}),/rights/i);
  }
  await assert.rejects(renderMacroPdf({path:resolve(root,'base.pdf'),maximumDimension:63}),/dimension/i);
});
