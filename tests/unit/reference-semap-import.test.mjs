import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {encodeNativeGrayPng,readNativeTrainingMask} from '../../tools/map-image/native-resample.mjs';
import {prepareSemapCorpus} from '../../tools/reference-analysis/prepare-semap.mjs';
import {validateSemapTrainingCorpus} from '../../tools/reference-analysis/validate-semap.mjs';
import {inspectCombinedTrainingData,inspectSemapTrainingDataset} from '../../tools/reference-analysis/training-tiles.mjs';
import {verifyCombinedTrainingOrder,writeCombinedTrainingOrder} from '../../tools/reference-analysis/training-order.mjs';
import {prepareCombinedTrainingBatch,verifyTrainingSample,writeSemapTrainingSample} from '../../tools/reference-analysis/training-sample.mjs';

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
  if(process.env.PANDO_REFERENCE_BATCH_DIRECTORY&&process.env.PANDO_REFERENCE_TORCH_LIBRARY){
    const output=join(root,'mixed-order'),plan=await writeCombinedTrainingOrder({corpus:macroPath,auxiliary:first.manifest,macroOnly:false,
      verifyEvidence,epoch:0,seed:42,output,torchLibrary:process.env.PANDO_REFERENCE_TORCH_LIBRARY,directory:process.env.PANDO_REFERENCE_BATCH_DIRECTORY});
    assert.deepEqual(plan.counts,combined.counts);assert.equal(plan.lineageFingerprint,combined.lineageFingerprint);
    assert.deepEqual(plan.datasetLengths,[1,1]);assert.equal(plan.length,2);
    const order=await readFile(join(output,'order.u64'));assert.deepEqual([Number(order.readBigUInt64LE(0)),Number(order.readBigUInt64LE(8))],[0,1]);
    const weights=await readFile(join(output,'weights.f32'));assert.equal(sha(weights),plan.weightsSha256);
    const request={corpus:macroPath,auxiliary:first.manifest,orderDirectory:output,macroOnly:false,epoch:0,seed:42,verifyEvidence};
    assert.equal((await verifyCombinedTrainingOrder(request)).lineageFingerprint,plan.lineageFingerprint);
    const batch=await prepareCombinedTrainingBatch({...request,cursor:0,count:2,augment:false,output:join(root,'mixed-batch')});
    assert.deepEqual(batch.samples.map(row=>row.index),[0,1]);
    assert.deepEqual(batch.samples.map(row=>verifyTrainingSample(row.directory).sourceKind),['macro-pdf','semap-label']);
    await writeFile(join(output,'weights.f32'),Buffer.alloc(28));
    await assert.rejects(verifyCombinedTrainingOrder(request),/weight/i);
    await assert.rejects(prepareCombinedTrainingBatch({...request,cursor:0,count:1,augment:false,output:join(root,'changed-batch')}),/weight/i);
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
