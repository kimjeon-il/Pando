// Actual trained-model ORT WASM/PyTorch parity in the existing Node runtime.
import {reportPath} from '../report-paths.mjs';
import {loadOrtRuntime,readModel} from '../../plugins/pando-map-tools/lib/engine.mjs';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {readTrainingBounded,trainingFileIdentity,verifyTrainingInitializer} from './training-evidence.mjs';

async function compareOnnxLogits({bytes,diagnostics,signal}){
const floats=name=>{const value=readFileSync(join(diagnostics,name));if(value.length%4)throw Error('Truncated Float32 diagnostic '+name);return new Float32Array(value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength));};
const ort=loadOrtRuntime(),inputs={};let session,outputs;
try {
  for(const [name,shape]of [['tile',[1,3,512,512]],['overview',[1,3,256,256]],['position',[1,4]]])inputs[name]=new ort.Tensor('float32',floats(name+'.f32'),shape);
  const expected=floats('expected-logits.f32'),started=performance.now();signal?.throwIfAborted();
  session=await ort.InferenceSession.create(bytes,{executionProviders:['wasm']});const loaded=performance.now();signal?.throwIfAborted();
  outputs=await session.run(inputs);const finished=performance.now(),logits=outputs.logits;signal?.throwIfAborted();
  if(!logits||logits.dims.join(',')!=='1,7,512,512'||logits.data.length!==expected.length)throw Error('Incorrect trained output shape');
  let maximumAbsoluteError=0,sum=0;
  for(let i=0;i<expected.length;i++){if(!Number.isFinite(logits.data[i])||!Number.isFinite(expected[i]))throw Error('Nonfinite trained output');const error=Math.abs(logits.data[i]-expected[i]);maximumAbsoluteError=Math.max(maximumAbsoluteError,error);sum+=error;}
  if(maximumAbsoluteError>.005)throw Error('Trained-model numerical parity failed: '+maximumAbsoluteError);
  return {provider:'onnxruntime-web-wasm-cpu',threads:1,outputShape:logits.dims,finite:true,
    maximumAbsoluteError,meanAbsoluteError:sum/expected.length,loadMilliseconds:loaded-started,inferenceMilliseconds:finished-loaded,inputBackend:'local-filesystem',nodeVersion:process.version,
    verifierSha256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex')};
} finally {for(const tensor of Object.values(inputs))tensor.dispose();for(const tensor of Object.values(outputs||{}))tensor.dispose();if(session)await session.release();}
}
export async function verifyTrainedOnnx({model,diagnostics,expectedCheckpointSha256,signal}){
  signal?.throwIfAborted();if(typeof model!=='string'||!model.endsWith('.onnx')||typeof diagnostics!=='string'||!diagnostics||
    expectedCheckpointSha256!==undefined&&!/^[a-f0-9]{64}$/.test(expectedCheckpointSha256))throw Error('Explicit trained ONNX and diagnostics required');
  const modelPath=resolve(model);diagnostics=resolve(diagnostics);
  const {manifest,bytes}=await readModel(modelPath.replace(/\.onnx$/,'.manifest.json'));
  if(manifest.model.url!==basename(modelPath)||resolve(dirname(modelPath),manifest.model.url)!==modelPath)throw Error('Manifest model identity differs from the selected file');
  if(manifest.releaseApproved!==false||manifest.evaluationStatus!=='pending'||manifest.trainingOnly!==true||!(manifest.optimizerUpdates>0))throw Error('Actual pending training-only manifest required');
  if(expectedCheckpointSha256!==undefined&&manifest.checkpointSha256!==expectedCheckpointSha256)throw Error('ONNX does not match the diagnostic checkpoint');
  const comparison=await compareOnnxLogits({bytes,diagnostics,signal});
  return {schemaVersion:1,purpose:'trained-model-execution-parity-only',releaseApproved:false,independentEvaluation:false,
    modelSha256:manifest.model.sha256,trainingBatches:manifest.trainingBatches,optimizerUpdates:manifest.optimizerUpdates,...comparison};
}
export function inspectTransferredWeightsOnnx({model,weights,signal}){
  signal?.throwIfAborted();if(typeof model!=='string'||!model.endsWith('.onnx')||!weights)
    throw Error('Explicit transferred weights and ONNX required');
  const modelPath=resolve(model),receiptPath=modelPath+'.export.json',receiptBytes=readTrainingBounded(receiptPath,1024*1024),
    receiptHash=createHash('sha256').update(receiptBytes).digest('hex'),receipt=JSON.parse(receiptBytes),initializer=verifyTrainingInitializer({path:weights}),
    bytes=readTrainingBounded(modelPath,64*1024*1024),modelSha256=createHash('sha256').update(bytes).digest('hex');
  if(initializer.initialization!=='weights-only-no-optimizer'||receipt.schemaVersion!==1||receipt.kind!=='transferred-weights-onnx-export'||
    receipt.opset!==17||receipt.model?.file!==basename(modelPath)||receipt.model?.sha256!==modelSha256||receipt.model?.bytes!==bytes.length||
    receipt.weightsSha256!==initializer.weightsSha256||receipt.sourceCheckpointSha256!==initializer.sourceCheckpointSha256||
    !/^[a-f0-9]{64}$/.test(receipt.sourceCheckpointSha256||'')||receipt.optimizerStateTransferred!==false||receipt.lineageComplete!==false||
    receipt.trainingOnly!==true||receipt.independentEvaluation!==false||receipt.releaseApproved!==false)
    throw Error('ONNX export receipt does not match transferred weights');
  return {modelPath,receiptPath,receiptHash,initializer,bytes,modelSha256};
}
export async function verifyTransferredWeightsOnnx({model,weights,diagnostics,signal}){
  signal?.throwIfAborted();if(typeof diagnostics!=='string'||!diagnostics)throw Error('Explicit diagnostic tensors required');
  const {modelPath,receiptPath,receiptHash,initializer,bytes,modelSha256}=inspectTransferredWeightsOnnx({model,weights,signal});
  const diagnosticRoot=resolve(diagnostics),inputs=['tile.f32','overview.f32','position.f32','expected-logits.f32']
    .map(name=>join(diagnosticRoot,name)),inputHashes=inputs.map(path=>trainingFileIdentity(path));
  const comparison=await compareOnnxLogits({bytes,diagnostics:diagnosticRoot,signal});
  const after=verifyTrainingInitializer({path:weights,expectedSha256:initializer.weightsSha256});
  if(after.recordHash!==initializer.recordHash||trainingFileIdentity(modelPath)!==modelSha256||trainingFileIdentity(receiptPath)!==receiptHash||
    inputs.some((path,index)=>trainingFileIdentity(path)!==inputHashes[index]))
    throw Error('Transferred model or export receipt changed during ONNX verification');
  return {schemaVersion:1,purpose:'transferred-weights-execution-parity-only',parityScope:'one-explicit-tile',
    weightsSha256:initializer.weightsSha256,sourceCheckpointSha256:initializer.sourceCheckpointSha256,modelSha256,
    trainingCorpusVerified:false,optimizerStateTransferred:false,lineageComplete:false,trainingOnly:true,releaseApproved:false,independentEvaluation:false,...comparison};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values}=parseArgs({options:{model:{type:'string'},diagnostics:{type:'string'},output:{type:'string'}}});
  if(!values.model?.endsWith('.onnx')||!values.diagnostics||!values.output)throw Error('--model <local.onnx> --diagnostics <local directory> --output <new report> required');
  const local=(path,access)=>path.startsWith('reports/')?reportPath(path,{access}):resolve(path);
  const result=await verifyTrainedOnnx({model:local(values.model,'read'),diagnostics:local(values.diagnostics,'read')});
  writeFileSync(local(values.output,'write'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
}
