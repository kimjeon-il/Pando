import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {encodeNativeGrayPng} from '../../tools/map-image/native-resample.mjs';
import {deriveMacroPdf} from '../../tools/reference-analysis/native-macro-pdf.mjs';
import {encodePublisherRgbJpeg} from '../../tools/reference-analysis/native-publisher-pdf.mjs';
import {validateMacroSheet} from '../../tools/reference-analysis/validate-macro.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('macro source recomputation rejects modified supervision and source identity',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-macro-validate-'));t.after(()=>rmSync(root,{recursive:true}));
  const pdf=join(root,'source.pdf');copyFileSync('tests/fixtures/reference-macro-pdf/base.pdf',pdf);
  const metadata={id:'fixture',familyId:'family',editionId:'edition',duplicateGroup:'fixture',geographicScope:'country',scopeEvidence:'fixture',
    materialKind:'published-macro-pdf',rightsReviewed:true,license:'fixture',url:'https://example.test',sha256:sha(readFileSync(pdf)),
    supervision:{strategy:'country-fill-adjacency',radiusPixels:3,countryFillColors:[[.7,.5,.3],[.3,.5,.7]]}};
  const metadataBytes=Buffer.from(JSON.stringify(metadata));writeFileSync(join(root,'source.json'),metadataBytes);
  const result=await deriveMacroPdf({path:pdf,metadata,maximumDimension:160});
  const jpeg=await encodePublisherRgbJpeg({width:result.width,height:result.height,rgb:result.image});writeFileSync(join(root,'image.jpg'),jpeg);
  const raster=await encodeNativeGrayPng({width:result.width,height:result.height,data:result.target});writeFileSync(join(root,'target.png'),raster);
  const valid=await encodeNativeGrayPng({width:result.width,height:result.height,data:result.known});writeFileSync(join(root,'known.png'),valid);
  const sheet={id:metadata.id,familyId:metadata.familyId,editionId:metadata.editionId,duplicateGroup:metadata.duplicateGroup,
    geographicScope:metadata.geographicScope,scopeEvidence:metadata.scopeEvidence,source:{url:metadata.url,license:metadata.license},image:'image.jpg',sha256:sha(jpeg)};
  const channels=['international','administrative','coast','hydro','transport','text','frame'];
  const annotation={schemaVersion:1,origin:'macro-vector-supervision',reviewed:false,supervisionQuality:'source-derived-weak',
    sourcePdf:'source.pdf',sourceSha256:metadata.sha256,sourceMetadata:'source.json',sourceMetadataSha256:sha(metadataBytes),
    producer:{script:'tools/reference-analysis/macro.py',sha256:'a'.repeat(64),renderer:'PyMuPDF',rendererVersion:'1.26.6'},
    width:result.width,height:result.height,maximumDimension:160,raster:{path:'target.png',sha256:sha(raster)},validRaster:{path:'known.png',sha256:sha(valid)},
    observedChannels:channels.filter((_,i)=>result.known.some(value=>value&(1<<i))),
    positivePixels:Object.fromEntries(channels.map((name,i)=>[name,result.target.reduce((sum,value)=>sum+!!(value&(1<<i)),0)]))};
  assert.deepEqual(await validateMacroSheet({root,sheet,annotation}),{valid:true,sheets:1,trainingOnly:true,independentEvaluation:false});
  const forged=await encodeNativeGrayPng({width:result.width,height:result.height,data:Buffer.alloc(result.target.length)});
  writeFileSync(join(root,'target.png'),forged);annotation.raster.sha256=sha(forged);
  await assert.rejects(validateMacroSheet({root,sheet,annotation}),/source supervision differs/i);
  writeFileSync(join(root,'source.json'),'{}');
  await assert.rejects(validateMacroSheet({root,sheet,annotation}),/metadata hash changed/i);
});
