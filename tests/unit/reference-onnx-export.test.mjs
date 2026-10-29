import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {loadOrtRuntime} from '../../plugins/pando-map-tools/lib/engine.mjs';

function protobufFields(bytes){
  let index=0;
  const readVarint=()=>{
    let value=0n,shift=0n;
    for(let count=0;count<10;count++){
      assert(index<bytes.length,'Truncated protobuf varint');
      const byte=bytes[index++];value|=BigInt(byte&127)<<shift;
      if(!(byte&128))return value;
      shift+=7n;
    }
    throw Error('Oversized protobuf varint');
  };
  const fields=[];
  while(index<bytes.length){
    const tag=Number(readVarint()),field=tag>>>3,wire=tag&7;
    assert(field>0,'Invalid protobuf field');
    if(wire===0)fields.push([field,readVarint()]);
    else if(wire===2){
      const length=Number(readVarint()),end=index+length;
      assert(Number.isSafeInteger(length)&&end<=bytes.length,'Truncated protobuf field');
      fields.push([field,bytes.subarray(index,end)]);index=end;
    }else throw Error(`Unexpected protobuf wire type ${wire}`);
  }
  return fields;
}

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
    const modelFields=protobufFields(bytes);
    assert.equal(modelFields.find(([field])=>field===1)?.[1],8n);
    const opsets=modelFields.filter(([field])=>field===8);
    assert.equal(opsets.length,1);
    const opset=protobufFields(opsets[0][1]);
    assert.equal(opset.find(([field])=>field===2)?.[1],17n);
    assert(!opset.some(([field,value])=>field===1&&value.length),'Unexpected ONNX operator domain');
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
