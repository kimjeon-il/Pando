import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {encodeNativeGrayPng} from '../../tools/map-image/native-resample.mjs';
import * as corpus from '../../tools/reference-analysis/reviewed-corpus.mjs';
import {diagnoseMacroTrainingSource} from '../../tools/reference-analysis/native-diagnostic-preview.mjs';
import * as trainingSample from '../../tools/reference-analysis/training-sample.mjs';

test('publisher training source binds metadata, source image and observed masks',async t=>{
  assert.equal(typeof corpus.validatePublisherTrainingSource,'function');
  const root=mkdtempSync(join(tmpdir(),'pando-publisher-source-'));t.after(()=>rmSync(root,{recursive:true}));
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const pdf=Buffer.from('publisher fixture'),image=await encodeNativeGrayPng({width:2,height:2,data:Buffer.from([0,1,1,0])});
  const mask=await encodeNativeGrayPng({width:2,height:2,data:Buffer.from([0,1,0,1])});
  writeFileSync(join(root,'source.pdf'),pdf);writeFileSync(join(root,'map.png'),image);writeFileSync(join(root,'mask.png'),mask);
  const sheet={id:'fixture',familyId:'family',editionId:'edition',duplicateGroup:'group',split:'train',image:'map.png',sha256:hash(image),
    annotations:'label.json',language:'eng',script:'Latin',mapKind:'monochrome',source:{url:'https://example.test/map',license:'fixture only'}};
  const metadata={sha256:hash(pdf),rightsReviewed:true,materialKind:'publisher-layered-pdf',license:'fixture only',id:sheet.id,familyId:sheet.familyId,url:sheet.source.url};
  const saveMetadata=value=>{const bytes=Buffer.from(JSON.stringify(value));writeFileSync(join(root,'source.json'),bytes);return hash(bytes);};
  const annotation={schemaVersion:1,origin:'publisher-layer-export',reviewed:false,width:2,height:2,sourcePdf:'source.pdf',sourceMetadata:'source.json',
    sourceSha256:hash(pdf),sourceMetadataSha256:saveMetadata(metadata),observedChannels:['international'],
    raster:{path:'mask.png',sha256:hash(mask)},validRaster:{path:'mask.png',sha256:hash(mask)},
    producer:{script:'tools/reference-analysis/publisher.py',sha256:'65a08b347a886e7d18d3f84e07594ab56f822afb22f7e14d6d2febe27d2b2a07',renderer:'PyMuPDF',rendererVersion:'1.26.6'}};
  const saveAnnotation=()=>writeFileSync(join(root,'label.json'),JSON.stringify(annotation));saveAnnotation();
  const manifest={schemaVersion:1,trainingOnly:true,sheets:[sheet]},request={root,corpus:manifest,sourceId:'fixture'};
  const verified=await corpus.validatePublisherTrainingSource(request);
  assert.equal(verified.sheet.id,'fixture');assert.equal(verified.annotation.width,2);
  const corpusPath=join(root,'corpus.json'),checkpoint=join(root,'checkpoint.pt');
  writeFileSync(corpusPath,JSON.stringify(manifest));writeFileSync(checkpoint,'fixture checkpoint');
  assert.equal(typeof trainingSample.writePublisherTrainingSample,'function');
  const samplePath=join(root,'sample');
  await trainingSample.writePublisherTrainingSample({corpus:corpusPath,sourceId:'fixture',tileIndex:0,x:0,y:0,augment:false,epoch:0,output:samplePath});
  const sample=trainingSample.verifyTrainingSample(samplePath,{requireInternational:true});
  assert.equal(sample.sourceKind,'publisher-pdf');
  const target=readFileSync(join(samplePath,'target.f32')),valid=readFileSync(join(samplePath,'valid.f32'));
  assert.equal(target.readFloatLE(4),1);assert.equal(valid.readFloatLE(4),1);
  assert.equal(valid.readFloatLE(4*512*2),0);
  await assert.rejects(trainingSample.writePublisherTrainingSample({corpus:corpusPath,sourceId:'fixture',tileIndex:0,x:0,y:0,augment:false,epoch:0,output:samplePath}),/exists/i);
  writeFileSync(checkpoint+'.receipt.json',JSON.stringify({schemaVersion:1,trainingOnly:true,releaseApproved:false,device:'cpu',
    checkpointSha256:hash(readFileSync(checkpoint)),corpusSha256:hash(readFileSync(corpusPath))}));
  await assert.rejects(diagnoseMacroTrainingSource({corpus:corpusPath,checkpoint,sourceId:'fixture',device:'cpu',torchLibrary:root}),{code:'ENOENT'});
  writeFileSync(join(root,'map.png'),'tampered');await assert.rejects(corpus.validatePublisherTrainingSource(request),/image.*hash/i);
  writeFileSync(join(root,'map.png'),image);annotation.sourceMetadataSha256=saveMetadata({...metadata,rightsReviewed:false});saveAnnotation();
  await assert.rejects(corpus.validatePublisherTrainingSource(request),/provenance/i);
  annotation.sourceMetadataSha256=saveMetadata(metadata);annotation.raster.sha256='0'.repeat(64);saveAnnotation();
  await assert.rejects(corpus.validatePublisherTrainingSource(request),/hash/i);
  assert.deepEqual(readFileSync(join(root,'source.pdf')),pdf);
});
