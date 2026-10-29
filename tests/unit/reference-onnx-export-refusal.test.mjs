import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {nativeOnnxDiagnostic,nativeOnnxExport} from '../../tools/reference-analysis/native-onnx-export.mjs';

test('native exporter refuses missing arguments and existing output',{skip:!process.env.PANDO_REFERENCE_ONNX_EXPORT_BINARY},t=>{
  const directory=mkdtempSync(join(tmpdir(),'pando-onnx-cli-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const output=join(directory,'existing.onnx');writeFileSync(output,'preserve');
  for(const [args,reason] of [[[],/Usage/],[['weights',output],/output exists/]]){
    const result=spawnSync(process.env.PANDO_REFERENCE_ONNX_EXPORT_BINARY,args,{encoding:'utf8',timeout:15000});
    assert.equal(result.error,undefined);assert.equal(result.status,1);assert.match(result.stderr,reason);
  }
  assert.equal(readFileSync(output,'utf8'),'preserve');
});
test('ONNX export preserves existing output and refuses modified warm-start weights',{skip:process.platform!=='win32'},async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-onnx-refusal-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const weights=join(root,'weights.safetensors'),output=join(root,'model.onnx');
  writeFileSync(weights,'weights');writeFileSync(output,'existing model');
  const request={weights,output,torchLibrary:root};
  await assert.rejects(nativeOnnxExport(request),/output exists/);
  await assert.rejects(nativeOnnxDiagnostic({output,torchLibrary:root}),/output exists/);
  assert.equal(readFileSync(output,'utf8'),'existing model');
  const unused=join(root,'new.onnx');
  writeFileSync(join(root,'transfer.json'),JSON.stringify({trainingOnly:true,evaluationStatus:'pending',releaseApproved:false,
    transfer:'weights-only-no-optimizer',weightsSha256:createHash('sha256').update('original').digest('hex')}));
  await assert.rejects(nativeOnnxExport({...request,output:unused}),/warm-start weights/);
  assert.equal(existsSync(unused),false);
});
