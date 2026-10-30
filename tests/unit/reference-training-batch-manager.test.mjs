import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {nativeTrainingBatch,runMacroTrainingBatch} from '../../tools/reference-analysis/native-training-batch.mjs';

test('macro batch CLI refuses incomplete configuration without creating outputs',()=>{
  const result=spawnSync(process.execPath,['tools/reference-analysis/native-training-batch.mjs'],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,1);assert.match(result.stderr,/explicit/i);
});

test('training batch management rejects changed samples and preserves existing outputs',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-training-batch-'));t.after(()=>rmSync(root,{recursive:true}));
  const sample=join(root,'sample'),weights=join(root,'weights.safetensors'),output=join(root,'new.pt'),order=join(root,'order.u64'),corpus=join(root,'corpus.json');mkdirSync(sample);
  const sha=value=>createHash('sha256').update(value).digest('hex'),names=['tile','overview','position','target','valid'];
  const receipt={trainingOnly:true,releaseApproved:false,sourceId:'synthetic',tileIndex:0,sourcePdfSha256:'a'.repeat(64),imageSha256:'b'.repeat(64),
    annotationSha256:'c'.repeat(64),maskSha256:'d'.repeat(64),validMaskSha256:'e'.repeat(64),tensorSha256:{}};
  for(const name of names){writeFileSync(join(sample,name+'.f32'),name);receipt.tensorSha256[name]=sha(name);}
  writeFileSync(join(sample,'sample.json'),JSON.stringify(receipt));writeFileSync(weights,'weights');
  writeFileSync(join(root,'transfer.json'),JSON.stringify({trainingOnly:true,evaluationStatus:'pending',releaseApproved:false,transfer:'weights-only-no-optimizer',weightsSha256:sha('weights')}));
  writeFileSync(order,Buffer.alloc(8));writeFileSync(corpus,JSON.stringify({schemaVersion:1,trainingOnly:true,sheets:[]}));
  const request={mode:'warm',input:weights,output,corpus,order,epoch:0,seed:20261023,freezeEpochs:2,learningRate:.0001,
    device:'cpu',unobservedMask:0,torchLibrary:root,samples:[{index:0,directory:sample}]};
  await assert.rejects(nativeTrainingBatch({...request,unobservedMask:undefined}),/configuration/i);
  await assert.rejects(nativeTrainingBatch({...request,amp:true}),/configuration/i);
  writeFileSync(output,'preserve');await assert.rejects(nativeTrainingBatch(request),/exists/i);assert.equal(readFileSync(output,'utf8'),'preserve');
  const sampleOutput=join(root,'prepared');await assert.rejects(runMacroTrainingBatch({...request,samples:undefined,count:1,sampleOutput,augment:false}),/exists/i);
  assert.equal(existsSync(sampleOutput),false);
  const changed={...request,output:join(root,'fresh.pt')};writeFileSync(join(sample,'target.f32'),'changed');
  await assert.rejects(nativeTrainingBatch(changed),/tensor changed/i);assert.equal(existsSync(changed.output),false);
  writeFileSync(join(sample,'target.f32'),'target');
  receipt.tileIndex=1;writeFileSync(join(sample,'sample.json'),JSON.stringify(receipt));
  await assert.rejects(nativeTrainingBatch(changed),/sample index/i);assert.equal(existsSync(changed.output),false);
  receipt.tileIndex=0;writeFileSync(join(sample,'sample.json'),JSON.stringify(receipt));
  const source={id:'synthetic',familyId:'family',editionId:'edition',duplicateGroup:'group',geographicScope:'world',scopeEvidence:'fixture',
    rightsReviewed:true,license:'CC0',materialKind:'published-macro-pdf',sha256:receipt.sourcePdfSha256,url:'https://example.org/map.pdf',
    language:'eng',script:'Latin',mapKind:'color'};
  const sourceBytes=Buffer.from(JSON.stringify(source));writeFileSync(join(root,'source.json'),sourceBytes);writeFileSync(join(root,'source.pdf'),'changed source');
  const annotation={origin:'macro-vector-supervision',reviewed:false,supervisionQuality:'source-derived-weak',sourcePdf:'source.pdf',
    sourceSha256:receipt.sourcePdfSha256,sourceMetadata:'source.json',sourceMetadataSha256:sha(sourceBytes),raster:{sha256:receipt.maskSha256},validRaster:{sha256:receipt.validMaskSha256}};
  const annotationBytes=Buffer.from(JSON.stringify(annotation));writeFileSync(join(root,'annotation.json'),annotationBytes);receipt.annotationSha256=sha(annotationBytes);
  writeFileSync(join(sample,'sample.json'),JSON.stringify(receipt));
  writeFileSync(corpus,JSON.stringify({schemaVersion:1,trainingOnly:true,sheets:[{...source,split:'train',sha256:receipt.imageSha256,
    annotations:'annotation.json',image:'image.png',source:{url:source.url,license:source.license}}]}));
  await assert.rejects(nativeTrainingBatch(changed),/PDF hash changed/i);assert.equal(existsSync(changed.output),false);
  const checkpoint=join(root,'previous.pt');writeFileSync(checkpoint,'previous checkpoint');
  writeFileSync(checkpoint+'.receipt.json',JSON.stringify({schemaVersion:1,trainingOnly:true,releaseApproved:false,lineageComplete:false,
    checkpointSha256:sha('previous checkpoint'),device:'cuda',precision:'fp32',seed:request.seed,freezeEpochs:request.freezeEpochs,
    learningRate:request.learningRate,unobservedMask:0,positiveWeightSha256:null,epoch:0,cursor:0,orderLength:1,orderSha256:sha(Buffer.alloc(8))}));
  const mismatch={...request,mode:'resume',device:'cuda',amp:true,input:checkpoint,output:join(root,'mismatch.pt')};
  await assert.rejects(nativeTrainingBatch(mismatch),/configuration differs/i);assert.equal(existsSync(mismatch.output),false);
  await assert.rejects(nativeTrainingBatch({...mismatch,amp:false,unobservedMask:1}),/configuration differs/i);
});
