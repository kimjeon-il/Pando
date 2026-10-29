import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {loadOrtRuntime} from '../../plugins/pando-map-tools/lib/engine.mjs';

test('native ONNX graph reproduces every C++ model output and refuses overwrite',async()=>{
  const binary=process.env.PANDO_REFERENCE_ONNX_TEST_BINARY;
  assert(binary,'PANDO_REFERENCE_ONNX_TEST_BINARY must identify the native test executable');
  const directory=mkdtempSync(join(tmpdir(),'pando-onnx-test-'));
  let session,outputs;
  const inputs={};
  try{
    const invoke=()=>spawnSync(binary,[directory],{encoding:'utf8',timeout:120000});
    const result=invoke();assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
    const bytes=readFileSync(join(directory,'model.onnx'));
    const floatFile=name=>{
      const data=readFileSync(join(directory,name+'.f32'));
      assert.equal(data.length%4,0);
      return new Float32Array(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));
    };
    const ort=loadOrtRuntime();
    session=await ort.InferenceSession.create(bytes,{executionProviders:['wasm']});
    assert.deepEqual(session.inputNames,['tile','overview','position']);
    assert.deepEqual(session.outputNames,['logits']);
    for(const [name,shape] of [['tile',[1,3,512,512]],['overview',[1,3,256,256]],['position',[1,4]]])
      inputs[name]=new ort.Tensor('float32',floatFile(name),shape);
    outputs=await session.run(inputs);
    assert.deepEqual(outputs.logits.dims,[1,7,512,512]);
    const expected=floatFile('expected'),actual=outputs.logits.data;
    assert.equal(actual.length,expected.length);
    let maximum=0;
    for(let i=0;i<expected.length;i++){
      assert(Number.isFinite(actual[i])&&Number.isFinite(expected[i]));
      maximum=Math.max(maximum,Math.abs(actual[i]-expected[i]));
    }
    assert(maximum<=0.005,`ONNX maximum absolute error ${maximum} exceeds 0.005`);
    const refused=invoke();assert.equal(refused.error,undefined);assert.notEqual(refused.status,0);
  }finally{
    for(const tensor of Object.values(inputs))tensor.dispose();
    for(const tensor of Object.values(outputs||{}))tensor.dispose();
    if(session)await session.release();
    rmSync(directory,{recursive:true,force:true});
  }
});
