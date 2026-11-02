import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {access,copyFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {encodeNativeGrayPng,readNativeTrainingMask} from '../../tools/map-image/native-resample.mjs';
import {prepareSemapCorpus} from '../../tools/reference-analysis/prepare-semap.mjs';
import {validateSemapTrainingCorpus,validateSemapTrainingSheet} from '../../tools/reference-analysis/validate-semap.mjs';
import {indexTrainingDataset,inspectCombinedTrainingData,inspectSemapTrainingDataset} from '../../tools/reference-analysis/training-tiles.mjs';
import {verifyCombinedTrainingOrder,writeCombinedTrainingOrder} from '../../tools/reference-analysis/training-order.mjs';
import {prepareCombinedTrainingBatch,prepareTrainingBatch,verifyTrainingSample,writeSemapTrainingSample} from '../../tools/reference-analysis/training-sample.mjs';
import {nativeTrainingBatch,runCombinedTrainingBatch} from '../../tools/reference-analysis/native-training-batch.mjs';
import {writeTrainingSupervision,verifyTrainingSupervision} from '../../tools/reference-analysis/training-supervision.mjs';
import {writeTrainingOrder} from '../../tools/reference-analysis/training-order.mjs';

test('Semap importer preserves real originals, rejects changed outputs and never creates review truth',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-semap-import-'));t.after(()=>rm(root,{recursive:true}));
  const key='loc_000001-0_0_0',blank='loc_000001-1_0_0',image=await readFile('tests/fixtures/map-image/jpeg-read/rgb.jpg');
  const labels=await encodeNativeGrayPng({width:12,height:9,data:Buffer.alloc(108,4)}),empty=await encodeNativeGrayPng({width:12,height:9,data:Buffer.alloc(108)});
  const evidence={'partitions.zip':await readFile('tests/fixtures/reference-semap/partition.zip'),'license_images.md':Buffer.from('fixture rights'),'README.md':Buffer.from('fixture description')};
  const images=new Map([[`images/real/${key}.jpg`,image],[`images/real/${blank}.jpg`,image]]);
  const masks=new Map([[`labels/real/${key}.png`,labels],[`labels/real/${blank}.png`,empty]]);
  const archive=values=>({members:[...values.keys()].map(name=>({name})),async readMember(name,cached){
    const bytes=values.get(name);if(!bytes)throw Error('Missing fixture member');
    if(cached&&!Buffer.from(cached).equals(bytes))throw Error('Cached original differs from publisher ZIP CRC');return bytes;}});
  const source={async readEvidence(name){return evidence[name];},async openArchive(name){return archive(name==='images.zip'?images:masks);}};
  await assert.rejects(prepareSemapCorpus({output:resolve('tools/reference-analysis/forbidden-test-output'),perInstitution:1,maximumMaps:1,source}),/external/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(prepareSemapCorpus({output:root,perInstitution:1,maximumMaps:1,source,signal:controller.signal}));
  const first=await prepareSemapCorpus({output:root,perInstitution:1,maximumMaps:1,source});
  const manifest=JSON.parse(await readFile(first.manifest,'utf8'));assert.equal(manifest.trainingOnly,true);assert.equal(manifest.sheets.length,1);
  const sheet=manifest.sheets[0];assert.equal(sheet.id,'semap-'+key);assert.deepEqual(await readFile(join(root,sheet.image)),image);
  const annotation=JSON.parse(await readFile(join(root,sheet.annotations),'utf8'));assert.equal(annotation.reviewed,false);
  assert.equal(annotation.origin,'semap-human-mask-export');assert.deepEqual(annotation.observedChannels,['hydro','transport']);
  const verifyEvidence=(name,bytes)=>assert.deepEqual(bytes,evidence[name]);
  assert.equal((await validateSemapTrainingCorpus(manifest,root,{verifyEvidence})).valid,true);
  assert.deepEqual(await validateSemapTrainingSheet({root,sheet,annotation},{verifyEvidence}),
    {valid:true,sheets:1,trainingOnly:true,independentEvaluation:false});
  await assert.rejects(validateSemapTrainingSheet({root,sheet,annotation:{...annotation,authorPartition:'test'}},{verifyEvidence}),/annotation changed/i);
  const dataset=await inspectSemapTrainingDataset(first.manifest,{verifyEvidence});
  assert.deepEqual(dataset.counts,[[0,0],[0,0],[0,0],[108,108],[108,0],[0,0],[0,0]]);
  assert.deepEqual(dataset.tiles,[{sourceId:sheet.id,index:0,x:0,y:0,duplicateGroup:sheet.duplicateGroup}]);
  assert.equal(dataset.trainingOnly,true);assert.equal(dataset.releaseApproved,false);
  const samplePath=join(root,'semap-sample');
  const sample=await writeSemapTrainingSample({corpus:first.manifest,sourceId:sheet.id,tileIndex:14,localIndex:0,x:0,y:0,
    augment:false,epoch:0,output:samplePath,verifyEvidence});
  assert.equal(sample.sourceKind,'semap-label');assert.equal(sample.tileIndex,14);assert.equal(sample.augmentationIndex,0);
  assert.equal(verifyTrainingSample(samplePath).sourceEvidenceSha256,sample.sourceEvidenceSha256);
  await assert.rejects(writeSemapTrainingSample({corpus:first.manifest,sourceId:sheet.id,tileIndex:14,localIndex:1,x:0,y:0,
    augment:false,epoch:0,output:join(root,'invalid-sample'),verifyEvidence}),/index/i);
  const macroRoot=join(root,'macro');await mkdir(macroRoot);
  for(const name of ['map.png','raster.png','valid.png'])await copyFile('tests/fixtures/reference-training-raster/'+name,join(macroRoot,name));
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),pdf=Buffer.from('fixture PDF');await writeFile(join(macroRoot,'source.pdf'),pdf);
  const meta={id:'macro',familyId:'family',editionId:'edition',duplicateGroup:'macro-group',geographicScope:'world',scopeEvidence:'fixture',
    rightsReviewed:true,license:'CC0',materialKind:'published-macro-pdf',sha256:sha(pdf),url:'https://example.org/map.pdf',language:'eng',script:'Latin',mapKind:'color'};
  const metadata=Buffer.from(JSON.stringify(meta));await writeFile(join(macroRoot,'source.json'),metadata);
  const macroAnnotation={...JSON.parse(await readFile('tests/fixtures/reference-training-raster/label.json','utf8')),reviewed:false,
    supervisionQuality:'source-derived-weak',sourcePdf:'source.pdf',sourceSha256:meta.sha256,sourceMetadata:'source.json',sourceMetadataSha256:sha(metadata)};
  await writeFile(join(macroRoot,'label.json'),JSON.stringify(macroAnnotation));
  const macroPath=join(macroRoot,'corpus.json');await writeFile(macroPath,JSON.stringify({schemaVersion:1,trainingOnly:true,sheets:[{...meta,
    split:'train',image:'map.png',sha256:sha(await readFile(join(macroRoot,'map.png'))),annotations:'label.json',source:{url:meta.url,license:meta.license}}]}));
  await assert.rejects(inspectCombinedTrainingData({corpus:macroPath,auxiliary:first.manifest,macroOnly:true,verifyEvidence}),/macro/i);
  await assert.rejects(writeCombinedTrainingOrder({corpus:macroPath,auxiliary:first.manifest,macroOnly:true,verifyEvidence,
    epoch:0,seed:42,output:join(root,'mixed-order'),torchLibrary:root}),/macro/i);
  await assert.rejects(writeCombinedTrainingOrder({corpus:macroPath,auxiliary:first.manifest,macroOnly:false,verifyEvidence,
    epoch:0,seed:42,output:root,torchLibrary:root}),/exists/i);
  const combined=await inspectCombinedTrainingData({corpus:macroPath,auxiliary:first.manifest,macroOnly:false,verifyEvidence});
  assert.deepEqual(combined.counts,[[288,144],[288,144],[288,144],[396,252],[396,143],[288,147],[384,209]]);
  assert.deepEqual(combined.datasets.map(rows=>rows.map(row=>[row.index,row.localIndex])),[[[0,0]],[[1,0]]]);
  assert.equal(combined.trainingOnly,true);assert.equal(combined.releaseApproved,false);
  const publisherRoot=join(root,'publisher');await mkdir(publisherRoot);
  for(const name of ['map.png','raster.png','valid.png'])await copyFile('tests/fixtures/reference-training-raster/'+name,join(publisherRoot,name));
  await writeFile(join(publisherRoot,'source.pdf'),pdf);
  const publisherMeta={id:'publisher',familyId:'publisher-family',editionId:'edition',format:'pdf',rightsReviewed:true,
    license:'CC0',materialKind:'publisher-layered-pdf',sha256:sha(pdf),url:'https://example.org/publisher.pdf'};
  const publisherMetadata=Buffer.from(JSON.stringify(publisherMeta));await writeFile(join(publisherRoot,'source.json'),publisherMetadata);
  const publisherAnnotation={...JSON.parse(await readFile('tests/fixtures/reference-training-raster/label.json','utf8')),
    schemaVersion:1,origin:'publisher-layer-export',reviewed:false,sourcePdf:'source.pdf',sourceSha256:sha(pdf),
    sourceMetadata:'source.json',sourceMetadataSha256:sha(publisherMetadata),observedChannels:['international','administrative','coast','hydro','transport','text','frame'],
    producer:{script:'tools/reference-analysis/publisher.py',sha256:'65a08b347a886e7d18d3f84e07594ab56f822afb22f7e14d6d2febe27d2b2a07',renderer:'PyMuPDF',rendererVersion:'1.26.6'}};
  await writeFile(join(publisherRoot,'label.json'),JSON.stringify(publisherAnnotation));
  const publisherPath=join(publisherRoot,'corpus.json');await writeFile(publisherPath,JSON.stringify({schemaVersion:1,trainingOnly:true,sheets:[{
    id:'publisher',familyId:'publisher-family',editionId:'edition',duplicateGroup:'publisher-group',split:'train',language:'eng',script:'Latin',mapKind:'color',
    image:'map.png',sha256:sha(await readFile(join(publisherRoot,'map.png'))),annotations:'label.json',source:{url:publisherMeta.url,license:publisherMeta.license}}]}));
  const publisherCombined=await inspectCombinedTrainingData({corpus:publisherPath,auxiliary:first.manifest,macroOnly:false,verifyEvidence});
  assert.deepEqual(publisherCombined.datasets.map(rows=>rows.map(row=>row.sourceId)),[['publisher'],[sheet.id]]);
  assert.equal(publisherCombined.trainingOnly,true);assert.equal(publisherCombined.releaseApproved,false);
  await assert.rejects(indexTrainingDataset(publisherPath),/macro/i);
  await assert.rejects(indexTrainingDataset(publisherPath,{allowPublisher:'yes'}),/scope/i);
  const publisherSupervision=join(root,'publisher-supervision');
  await writeTrainingSupervision({corpus:publisherPath,output:publisherSupervision,publisher:true});
  assert.equal((await verifyTrainingSupervision({corpus:publisherPath,directory:publisherSupervision,publisher:true})).corpusSha256,sha(await readFile(publisherPath)));
  await assert.rejects(verifyTrainingSupervision({corpus:publisherPath,directory:publisherSupervision}),/supervision|source/i);
  const reviewedRoot=join(root,'reviewed');await mkdir(reviewedRoot);
  const reviewedImage=await readFile('tests/fixtures/map-image/png-read/orientation-6.png');
  await writeFile(join(reviewedRoot,'map.png'),reviewedImage);
  const reviewedAnnotation={schemaVersion:1,reviewed:true,width:9,height:12,known:{international:[[[0,0],[8,0],[8,11],[0,11]]]},
    lines:[{kind:'international',width:1,points:[[1,4],[6,4]]}],ignore:[],review:{kind:'agent',reviewer:'fixture',
      reviewedAt:'2026-10-30T00:00:00Z',sourceSha256:sha(reviewedImage),predictionBlind:true}};
  await writeFile(join(reviewedRoot,'label.json'),JSON.stringify(reviewedAnnotation));
  const reviewedPath=join(reviewedRoot,'corpus.json');await writeFile(reviewedPath,JSON.stringify({schemaVersion:1,sheets:[{
    id:'reviewed',familyId:'reviewed-family',editionId:'reviewed-edition',duplicateGroup:'reviewed-group',split:'train',language:'fas',script:'Arabic',mapKind:'monochrome',
    image:'map.png',sha256:sha(reviewedImage),annotations:'label.json',source:{url:'https://example.org/reviewed',license:'fixture'}}]}));
  const reviewedCombined=await inspectCombinedTrainingData({corpus:reviewedPath,auxiliary:first.manifest,macroOnly:false,verifyEvidence});
  assert.deepEqual(reviewedCombined.datasets.map(rows=>rows.map(row=>row.sourceKind||'semap-label')),[['reviewed'],['semap-label']]);
  await assert.rejects(indexTrainingDataset(reviewedPath),/training.only/i);
  const reviewedManifest=JSON.parse(await readFile(reviewedPath,'utf8'));
  await writeFile(reviewedPath,JSON.stringify({...reviewedManifest,sheets:[...reviewedManifest.sheets,{...reviewedManifest.sheets[0],
    id:'held-out',familyId:'held-out-family',editionId:'held-out-edition',duplicateGroup:'held-out-group',split:'test',image:'unreadable.png'}]}));
  await assert.rejects(inspectCombinedTrainingData({corpus:reviewedPath,auxiliary:first.manifest,macroOnly:false,verifyEvidence}),/only training sources/i);
  await writeFile(reviewedPath,JSON.stringify(reviewedManifest));
  if(process.env.PANDO_REFERENCE_BATCH_DIRECTORY&&process.env.PANDO_REFERENCE_TORCH_LIBRARY){
    const absent=join(root,'missing-runtime-order');
    await assert.rejects(writeCombinedTrainingOrder({corpus:macroPath,auxiliary:first.manifest,macroOnly:false,verifyEvidence,epoch:0,seed:42,
      output:absent,torchLibrary:join(root,'missing-torch'),directory:process.env.PANDO_REFERENCE_BATCH_DIRECTORY}));
    await assert.rejects(access(absent),{code:'ENOENT'});
    const output=join(root,'mixed-order'),plan=await writeCombinedTrainingOrder({corpus:macroPath,auxiliary:first.manifest,macroOnly:false,
      verifyEvidence,epoch:0,seed:42,output,torchLibrary:process.env.PANDO_REFERENCE_TORCH_LIBRARY,directory:process.env.PANDO_REFERENCE_BATCH_DIRECTORY});
    assert.deepEqual(plan.counts,combined.counts);assert.equal(plan.lineageFingerprint,combined.lineageFingerprint);
    assert.deepEqual(plan.datasetLengths,[1,1]);assert.equal(plan.length,2);
    const order=await readFile(join(output,'order.u64'));assert.deepEqual([Number(order.readBigUInt64LE(0)),Number(order.readBigUInt64LE(8))],[0,1]);
    const weights=await readFile(join(output,'weights.f32'));assert.equal(sha(weights),plan.weightsSha256);
    const request={corpus:macroPath,auxiliary:first.manifest,orderDirectory:output,macroOnly:false,epoch:0,seed:42,verifyEvidence};
    assert.equal((await verifyCombinedTrainingOrder(request)).lineageFingerprint,plan.lineageFingerprint);
    const previous=join(root,'previous.pt');await writeFile(previous,'checkpoint');
    await writeFile(previous+'.receipt.json',JSON.stringify({schemaVersion:1,trainingOnly:true,releaseApproved:false,lineageComplete:false,initialization:'weights-only-no-optimizer',
      checkpointSha256:sha('checkpoint'),device:'cpu',precision:'fp32',seed:42,freezeEpochs:2,learningRate:.0001,
      unobservedMask:plan.unobservedMask,positiveWeightSha256:plan.weightsSha256,epoch:0,cursor:0,orderLength:plan.length,orderSha256:plan.orderSha256,
      corpusSha256:sha(await readFile(macroPath)),auxiliarySha256:'0'.repeat(64),lineageFingerprint:plan.lineageFingerprint}));
    await assert.rejects(runCombinedTrainingBatch({...request,mode:'resume',input:previous,output:join(root,'wrong-corpus.pt'),
      sampleOutput:join(root,'wrong-corpus-samples'),count:1,augment:false,freezeEpochs:2,learningRate:.0001,device:'cpu',torchLibrary:root}),/corpus differs/i);
    await assert.rejects(access(join(root,'wrong-corpus-samples')),{code:'ENOENT'});
    const batch=await prepareCombinedTrainingBatch({...request,cursor:0,count:2,augment:false,output:join(root,'mixed-batch')});
    assert.deepEqual(batch.samples.map(row=>row.index),[0,1]);
    assert.deepEqual(batch.samples.map(row=>verifyTrainingSample(row.directory).sourceKind),['macro-pdf','semap-label']);
    const publisherOrder=join(root,'publisher-order');
    const publisherPlan=await writeCombinedTrainingOrder({corpus:publisherPath,auxiliary:first.manifest,macroOnly:false,verifyEvidence,
      epoch:0,seed:42,output:publisherOrder,torchLibrary:process.env.PANDO_REFERENCE_TORCH_LIBRARY,directory:process.env.PANDO_REFERENCE_BATCH_DIRECTORY});
    const publisherRequest={...request,corpus:publisherPath,orderDirectory:publisherOrder};
    const publisherBatch=await prepareCombinedTrainingBatch({...publisherRequest,cursor:0,count:2,augment:false,output:join(root,'publisher-batch')});
    assert.deepEqual(publisherBatch.samples.map(row=>verifyTrainingSample(row.directory).sourceKind),['publisher-pdf','semap-label']);
    const publisherSingleOrder=join(root,'publisher-single.u64');
    await writeTrainingOrder({corpus:publisherPath,supervision:publisherSupervision,publisher:true,epoch:0,seed:42,output:publisherSingleOrder,
      torchLibrary:process.env.PANDO_REFERENCE_TORCH_LIBRARY,directory:process.env.PANDO_REFERENCE_BATCH_DIRECTORY});
    const publisherSingle=await prepareTrainingBatch({corpus:publisherPath,order:publisherSingleOrder,publisher:true,cursor:0,count:1,epoch:0,augment:false,output:join(root,'publisher-single')});
    assert.equal(verifyTrainingSample(publisherSingle.samples[0].directory).sourceKind,'publisher-pdf');
    const reviewedOrder=join(root,'reviewed-order');
    const reviewedPlan=await writeCombinedTrainingOrder({corpus:reviewedPath,auxiliary:first.manifest,macroOnly:false,verifyEvidence,
      epoch:0,seed:42,output:reviewedOrder,torchLibrary:process.env.PANDO_REFERENCE_TORCH_LIBRARY,directory:process.env.PANDO_REFERENCE_BATCH_DIRECTORY});
    const reviewedBatch=await prepareCombinedTrainingBatch({...request,corpus:reviewedPath,orderDirectory:reviewedOrder,cursor:0,count:2,augment:false,output:join(root,'reviewed-batch')});
    assert.deepEqual(reviewedBatch.samples.map(row=>verifyTrainingSample(row.directory).sourceKind),['reviewed','semap-label']);
    const initializer=join(root,'initializer.bin');await writeFile(initializer,'weights');
    await writeFile(join(root,'transfer.json'),JSON.stringify({trainingOnly:true,evaluationStatus:'pending',releaseApproved:false,
      transfer:'weights-only-no-optimizer',weightsSha256:sha('weights')}));
    const reviewedReceiptPath=join(reviewedBatch.samples[0].directory,'sample.json'),reviewedReceipt=JSON.parse(await readFile(reviewedReceiptPath,'utf8'));
    await writeFile(reviewedReceiptPath,JSON.stringify({...reviewedReceipt,sourceEvidenceSha256:'0'.repeat(64)}));
    await assert.rejects(nativeTrainingBatch({...request,corpus:reviewedPath,orderDirectory:reviewedOrder,mode:'warm',input:initializer,
      output:join(root,'reviewed-model.pt'),order:join(reviewedOrder,'order.u64'),positiveWeights:join(reviewedOrder,'weights.f32'),
      unobservedMask:reviewedPlan.unobservedMask,freezeEpochs:2,learningRate:.0001,device:'cpu',torchLibrary:root,samples:reviewedBatch.samples}),/evidence differs/i);
    const publisherTraining={...publisherRequest,mode:'warm',input:initializer,output:join(root,'publisher-model.pt'),
      order:join(publisherOrder,'order.u64'),positiveWeights:join(publisherOrder,'weights.f32'),unobservedMask:publisherPlan.unobservedMask,
      freezeEpochs:2,learningRate:.0001,device:'cpu',torchLibrary:root,samples:publisherBatch.samples};
    const publisherReceiptPath=join(publisherBatch.samples[0].directory,'sample.json'),publisherReceipt=JSON.parse(await readFile(publisherReceiptPath,'utf8'));
    await writeFile(publisherReceiptPath,JSON.stringify({...publisherReceipt,sourceEvidenceSha256:'0'.repeat(64)}));
    await assert.rejects(nativeTrainingBatch(publisherTraining),/evidence/i);
    await writeFile(publisherReceiptPath,JSON.stringify(publisherReceipt));
    await assert.rejects(nativeTrainingBatch(publisherTraining),{code:'ENOENT'});
    await assert.rejects(access(join(root,'publisher-model.pt')),{code:'ENOENT'});
    const semapReceiptPath=join(batch.samples[1].directory,'sample.json'),semapReceipt=JSON.parse(await readFile(semapReceiptPath,'utf8'));
    semapReceipt.sourceEvidenceSha256='0'.repeat(64);await writeFile(semapReceiptPath,JSON.stringify(semapReceipt));
    await assert.rejects(nativeTrainingBatch({...request,mode:'warm',input:initializer,output:join(root,'invalid.pt'),
      order:join(output,'order.u64'),positiveWeights:join(output,'weights.f32'),unobservedMask:plan.unobservedMask,
      freezeEpochs:2,learningRate:.0001,device:'cpu',torchLibrary:root,samples:batch.samples}),/source evidence/i);
    await writeFile(join(output,'weights.f32'),Buffer.alloc(28));
    await assert.rejects(verifyCombinedTrainingOrder(request),/weight/i);
    await assert.rejects(prepareCombinedTrainingBatch({...request,cursor:0,count:1,augment:false,output:join(root,'changed-batch')}),/weight/i);
    await assert.rejects(runCombinedTrainingBatch({...request,mode:'warm',input:join(root,'weights'),output:join(root,'model.pt'),
      sampleOutput:join(root,'run-samples'),count:1,augment:false,freezeEpochs:2,learningRate:.0001,device:'cpu',torchLibrary:root}),/weight/i);
  }
  const target=await readFile(join(root,annotation.raster.path));const mask=await readNativeTrainingMask(target,annotation.raster.sha256);
  assert(mask.data.every(value=>value===8));
  await prepareSemapCorpus({output:root,perInstitution:1,maximumMaps:1,source});
  await writeFile(join(root,annotation.raster.path),empty);
  annotation.raster.sha256=createHash('sha256').update(empty).digest('hex');
  await writeFile(join(root,sheet.annotations),JSON.stringify(annotation));
  await assert.rejects(validateSemapTrainingCorpus(manifest,root,{verifyEvidence}),/conversion/i);
  await assert.rejects(inspectSemapTrainingDataset(first.manifest,{verifyEvidence}),/conversion/i);
  await assert.rejects(inspectCombinedTrainingData({corpus:macroPath,auxiliary:first.manifest,macroOnly:false,verifyEvidence}),/conversion/i);
  await assert.rejects(prepareSemapCorpus({output:root,perInstitution:1,maximumMaps:1,source}),/preserve/i);
  assert.deepEqual(await readFile(join(root,annotation.raster.path)),empty);
});
