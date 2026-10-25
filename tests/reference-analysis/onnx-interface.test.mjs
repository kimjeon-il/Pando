import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadOrtRuntime} from '../../plugins/pando-map-tools/lib/engine.mjs';

test('diagnostic architecture runs its actual Node WASM interface without claiming trained accuracy',async()=>{
  const bytes=await readFile(new URL('../../build-native/reference-analysis/interface-smoke.onnx',import.meta.url));
  const ort=loadOrtRuntime(),session=await ort.InferenceSession.create(bytes,{executionProviders:['wasm']});
  const inputs={tile:new ort.Tensor('float32',new Float32Array(3*512*512),[1,3,512,512]),
    overview:new ort.Tensor('float32',new Float32Array(3*256*256),[1,3,256,256]),position:new ort.Tensor('float32',Float32Array.from([0,0,1,1]),[1,4])};
  let output;
  try {output=await session.run(inputs);assert.deepEqual(output.logits.dims,[1,7,512,512]);assert.ok(output.logits.data.every(Number.isFinite));}
  finally {for(const tensor of Object.values(inputs))tensor.dispose();for(const tensor of Object.values(output||{}))tensor.dispose();await session.release();}
});
