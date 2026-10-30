import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {writeMacroTrainingSample,prepareMacroTrainingBatch} from '../../tools/reference-analysis/training-sample.mjs';
import {indexMacroTrainingDataset,macroTrainingSupervision} from '../../tools/reference-analysis/training-tiles.mjs';
import {writeMacroTrainingSupervision,verifyMacroTrainingSupervision} from '../../tools/reference-analysis/training-supervision.mjs';

test('source-bound macro sample is generated from original pixels without overwriting',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-macro-sample-'));t.after(()=>rmSync(root,{recursive:true}));
  const fixture='tests/fixtures/reference-training-raster',sha=value=>createHash('sha256').update(value).digest('hex');
  for(const name of ['map.png','raster.png','valid.png'])copyFileSync(join(fixture,name),join(root,name));
  writeFileSync(join(root,'source.pdf'),'original fixture pdf');
  const source={id:'fixture',familyId:'family',editionId:'edition',duplicateGroup:'group',geographicScope:'world',scopeEvidence:'fixture',
    rightsReviewed:true,license:'CC0',materialKind:'published-macro-pdf',sha256:sha('original fixture pdf'),url:'https://example.org/map.pdf',
    language:'eng',script:'Latin',mapKind:'color'};
  const metadata=Buffer.from(JSON.stringify(source));writeFileSync(join(root,'source.json'),metadata);
  const annotation={...JSON.parse(readFileSync(join(fixture,'label.json'),'utf8')),reviewed:false,supervisionQuality:'source-derived-weak',
    sourcePdf:'source.pdf',sourceSha256:source.sha256,sourceMetadata:'source.json',sourceMetadataSha256:sha(metadata)};
  writeFileSync(join(root,'label.json'),JSON.stringify(annotation));
  const sheet={...source,split:'train',image:'map.png',sha256:sha(readFileSync(join(root,'map.png'))),annotations:'label.json',source:{url:source.url,license:source.license}};
  const corpus=join(root,'corpus.json');writeFileSync(corpus,JSON.stringify({schemaVersion:1,trainingOnly:true,sheets:[sheet]}));
  const indexed=await indexMacroTrainingDataset(corpus);
  assert.deepEqual(indexed.tiles.map(({sourceId,index,x,y,duplicateGroup})=>({sourceId,index,x,y,duplicateGroup})),
    [{sourceId:'fixture',index:0,x:0,y:0,duplicateGroup:'group'}]);
  const supervision=await macroTrainingSupervision(corpus);
  assert.deepEqual(supervision.counts,[[288,144],[288,144],[288,144],[288,144],[288,143],[288,147],[384,209]]);
  assert.deepEqual(supervision.unobservedChannels,[]);
  assert.deepEqual(supervision.positiveWeights.slice(0,4),[1,1,1,1]);
  const supervisionOutput=join(root,'supervision');
  const stored=await writeMacroTrainingSupervision({corpus,output:supervisionOutput});
  assert.equal(stored.unobservedMask,0);
  assert.equal((await verifyMacroTrainingSupervision({corpus,directory:supervisionOutput})).unobservedMask,0);
  await assert.rejects(writeMacroTrainingSupervision({corpus,output:supervisionOutput}),/exists/);
  const weightsPath=join(supervisionOutput,'weights.f32'),weights=readFileSync(weightsPath);writeFileSync(weightsPath,Buffer.alloc(28));
  await assert.rejects(verifyMacroTrainingSupervision({corpus,directory:supervisionOutput}),/weights/i);writeFileSync(weightsPath,weights);
  const output=join(root,'sample'),request={corpus,sourceId:'fixture',tileIndex:0,x:0,y:0,augment:false,epoch:0,output};
  const result=await writeMacroTrainingSample(request),expected=JSON.parse(readFileSync(join(fixture,'expected.json'),'utf8'))[0];
  assert.deepEqual(['tile','overview','position','target','valid'].map(name=>result.tensorSha256[name]),expected.hashes);
  await assert.rejects(writeMacroTrainingSample(request),/exists/);
  const order=join(root,'order.u64');writeFileSync(order,Buffer.alloc(8));
  const batch=await prepareMacroTrainingBatch({corpus,order,cursor:0,count:1,epoch:0,augment:false,output:join(root,'batch')});
  assert.equal(batch.samples.length,1);assert.equal(batch.samples[0].index,0);
  assert.equal(JSON.parse(readFileSync(join(batch.samples[0].directory,'sample.json'))).tensorSha256.tile,expected.hashes[0]);
  await assert.rejects(prepareMacroTrainingBatch({corpus,order,cursor:0,count:1,epoch:0,augment:false,output:join(root,'batch')}),/exists/);
  writeFileSync(order,Buffer.from([1,0,0,0,0,0,0,0]));
  await assert.rejects(prepareMacroTrainingBatch({corpus,order,cursor:0,count:1,epoch:0,augment:false,output:join(root,'invalid')}),/index/);
  assert.equal(existsSync(join(root,'invalid')),false);
  writeFileSync(join(root,'source.pdf'),'changed');
  await assert.rejects(writeMacroTrainingSample({...request,output:join(root,'next')}),/PDF hash changed/);
  await assert.rejects(indexMacroTrainingDataset(corpus),/PDF hash changed/);
  await assert.rejects(verifyMacroTrainingSupervision({corpus,directory:supervisionOutput}),/PDF hash changed/);
  assert.equal(existsSync(join(root,'next')),false);
});
