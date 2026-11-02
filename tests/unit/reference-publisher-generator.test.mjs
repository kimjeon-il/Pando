import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {inspectNativeJpeg,readNativeTrainingMask} from '../../tools/map-image/native-resample.mjs';
import {preparePublisherCorpus,preparePublisherSheet} from '../../tools/reference-analysis/prepare-publisher.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
function source(root,fixture='fixture.pdf'){
  mkdirSync(join(root,'sources'));const path=join(root,'sources','fixture.pdf');
  copyFileSync(resolve('tests/fixtures/reference-publisher-layers',fixture),path);
  const metadata={id:'fixture',format:'pdf',familyId:'fixture-family',editionId:'fixture-edition',language:'eng',script:'Latin',published:'2014',
    materialKind:'publisher-layered-pdf',rightsReviewed:true,license:'fixture only',url:'https://example.test/source.pdf',sha256:sha(readFileSync(path))};
  writeFileSync(join(root,'sources','fixture.source.json'),JSON.stringify(metadata));return {path,metadata};
}
test('publisher generator preserves originals and source-bound training masks',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-publisher-generator-'));t.after(()=>rmSync(root,{recursive:true}));
  const {path,metadata}=source(root),original=readFileSync(path),oracle=JSON.parse(readFileSync('tests/fixtures/reference-publisher-layers/oracle.json','utf8'));
  const sheet=await preparePublisherSheet({source:path,root,maximumDimension:160});
  const annotation=JSON.parse(readFileSync(join(root,sheet.annotations),'utf8'));
  assert.equal(annotation.reviewed,false);assert.equal(annotation.origin,'publisher-layer-export');assert.equal(annotation.producer.renderer,'MuPDF');
  assert.deepEqual(annotation.sourceRectPts,oracle.sourceRectPts);assert.equal(annotation.positivePixels.international,oracle.derived.positivePixels[0]);
  assert.deepEqual(await inspectNativeJpeg(readFileSync(join(root,sheet.image))),[160,120]);
  for(const [field,expected] of [['raster',oracle.derived.maskSha256],['validRaster',oracle.derived.validSha256]]){
    const encoded=readFileSync(join(root,annotation[field].path)),decoded=await readNativeTrainingMask(encoded,annotation[field].sha256);
    assert.equal(sha(decoded.data),expected);
  }
  const before=readFileSync(join(root,sheet.image));
  assert.deepEqual(await preparePublisherSheet({source:path,root,maximumDimension:160}),sheet);
  const result=await preparePublisherCorpus({sources:join(root,'sources'),maximumDimension:160});
  assert.equal(result.sheets,1);assert.equal(result.trainingOnly,true);assert.equal(result.releaseApproved,false);
  await assert.rejects(preparePublisherSheet({source:path,root,maximumDimension:320}),/existing.*identity/i);
  writeFileSync(path,Buffer.concat([original,Buffer.from('changed')]));
  await assert.rejects(preparePublisherSheet({source:path,root,maximumDimension:160}),/provenance/i);writeFileSync(path,original);
  writeFileSync(join(root,'sources','fixture.source.json'),JSON.stringify({...metadata,rightsReviewed:false}));
  await assert.rejects(preparePublisherSheet({source:path,root,maximumDimension:160}),/provenance/i);
  assert.deepEqual(readFileSync(join(root,sheet.image)),before);assert.deepEqual(readFileSync(path),original);
});
test('publisher generator rejects incomplete output and missing required layers',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-publisher-protect-'));t.after(()=>rmSync(root,{recursive:true}));
  const {path}=source(root);mkdirSync(join(root,'derived'));const occupied=join(root,'derived','fixture.jpg');writeFileSync(occupied,'protected');
  await assert.rejects(preparePublisherSheet({source:path,root,maximumDimension:160}),/incomplete.*outputs/i);
  assert.equal(readFileSync(occupied,'utf8'),'protected');assert.equal(existsSync(join(root,'labels')),false);
  const missing=mkdtempSync(join(tmpdir(),'pando-publisher-missing-'));t.after(()=>rmSync(missing,{recursive:true}));
  mkdirSync(join(missing,'sources'));const pdf=join(missing,'sources','fixture.pdf');copyFileSync('tests/fixtures/map-image/pdf-read/single.pdf',pdf);
  writeFileSync(join(missing,'sources','fixture.source.json'),JSON.stringify({id:'fixture',format:'pdf',materialKind:'publisher-layered-pdf',rightsReviewed:true,
    license:'fixture',url:'https://example.test/source.pdf',sha256:sha(readFileSync(pdf))}));
  await assert.rejects(preparePublisherSheet({source:pdf,root:missing,maximumDimension:160}),/layer/i);
  assert.equal(existsSync(join(missing,'derived')),false);
});
