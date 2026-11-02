import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {writeTrainingSupervision,verifyTrainingSupervision} from '../../tools/reference-analysis/training-supervision.mjs';
import {writeTrainingOrder} from '../../tools/reference-analysis/training-order.mjs';
import {prepareTrainingBatch,verifyTrainingSample} from '../../tools/reference-analysis/training-sample.mjs';

test('reviewed training prepares source-bound supervision, order and samples',{
  skip:!process.env.PANDO_REFERENCE_BATCH_DIRECTORY||!process.env.PANDO_REFERENCE_TORCH_LIBRARY,
},async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-reviewed-training-'));t.after(()=>rmSync(root,{recursive:true}));
  mkdirSync(join(root,'sources'));mkdirSync(join(root,'labels'));
  const image=readFileSync('tests/fixtures/map-image/png-read/orientation-6.png');
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');writeFileSync(join(root,'sources/map.png'),image);
  const annotation={schemaVersion:1,reviewed:true,width:9,height:12,known:{international:[[[0,0],[8,0],[8,11],[0,11]]]},
    lines:[{kind:'international',width:1,points:[[1,4],[6,4]]}],ignore:[],review:{kind:'agent',reviewer:'fixture',
      reviewedAt:'2026-10-30T00:00:00Z',sourceSha256:sha(image),predictionBlind:true}};
  writeFileSync(join(root,'labels/map.json'),JSON.stringify(annotation));
  const sheet={id:'reviewed',familyId:'family',editionId:'edition',duplicateGroup:'group',split:'train',image:'sources/map.png',
    annotations:'labels/map.json',sha256:sha(image),language:'fas',script:'Arabic',mapKind:'monochrome',source:{url:'https://example.org',license:'fixture'}};
  const corpus=join(root,'corpus.json');writeFileSync(corpus,JSON.stringify({schemaVersion:1,sheets:[sheet]}));
  const supervision=join(root,'supervision'),order=join(root,'order.u64');
  await assert.rejects(writeTrainingSupervision({corpus,output:supervision}),/training.only/i);
  const stored=await writeTrainingSupervision({corpus,output:supervision,reviewed:true});
  assert.deepEqual(stored.counts[0],[108,6]);
  assert.equal((await verifyTrainingSupervision({corpus,directory:supervision,reviewed:true})).corpusSha256,sha(readFileSync(corpus)));
  await assert.rejects(verifyTrainingSupervision({corpus,directory:supervision}),/training|supervision/i);
  await writeTrainingOrder({corpus,supervision,order:undefined,output:order,reviewed:true,epoch:0,seed:42,
    torchLibrary:process.env.PANDO_REFERENCE_TORCH_LIBRARY,directory:process.env.PANDO_REFERENCE_BATCH_DIRECTORY});
  const batch=await prepareTrainingBatch({corpus,order,cursor:0,count:1,epoch:0,augment:false,reviewed:true,output:join(root,'batch')});
  assert.equal(verifyTrainingSample(batch.samples[0].directory).sourceKind,'reviewed');
  const changed=JSON.parse(readFileSync(corpus));changed.sheets.push({...sheet,id:'test',familyId:'test-family',editionId:'test-edition',duplicateGroup:'test-group',split:'test',image:'missing.png'});
  writeFileSync(corpus,JSON.stringify(changed));
  await assert.rejects(writeTrainingSupervision({corpus,output:join(root,'other'),reviewed:true}),/training.only|only training/i);
  assert.equal(existsSync(join(root,'other')),false);
});
