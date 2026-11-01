import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {diagnoseTrainingCorpus} from '../../tools/reference-analysis/native-diagnostic-preview.mjs';

test('diagnostics refuse an ONNX model from a different checkpoint before creating output',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-diagnostic-onnx-'));t.after(()=>rmSync(root,{recursive:true}));
  const corpus=join(root,'corpus.json'),checkpoint=join(root,'checkpoint.pt'),onnx=join(root,'model.onnx'),output=join(root,'output');
  writeFileSync(corpus,JSON.stringify({schemaVersion:1,trainingOnly:true,sheets:[{id:'fixture'}]}));writeFileSync(checkpoint,'checkpoint');
  writeFileSync(checkpoint+'.receipt.json','{}');writeFileSync(onnx,'model');
  writeFileSync(join(root,'model.manifest.json'),JSON.stringify({checkpointSha256:'0'.repeat(64),
    model:{url:'model.onnx',sha256:createHash('sha256').update('model').digest('hex'),bytes:5},
    trainingOnly:true,evaluationStatus:'pending',releaseApproved:false,optimizerUpdates:1}));
  await assert.rejects(diagnoseTrainingCorpus({corpus,checkpoint,onnx,output,device:'cpu',torchLibrary:root}),/ONNX.*checkpoint/i);
  assert.equal(existsSync(output),false);
});
