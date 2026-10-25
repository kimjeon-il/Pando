// Actual trained-model ORT WASM/PyTorch parity in the existing Node runtime.
import {reportPath} from '../report-paths.mjs';
import {loadOrtRuntime,readModel} from '../../plugins/pando-map-tools/lib/engine.mjs';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {parseArgs} from 'node:util';

const {values}=parseArgs({options:{model:{type:'string'},diagnostics:{type:'string'},output:{type:'string'}}});
if(!values.model?.endsWith('.onnx')||!values.diagnostics||!values.output)throw Error('--model <local.onnx> --diagnostics <local directory> --output <new report> required');
const local=(path,access)=>path.startsWith('reports/')?reportPath(path,{access}):resolve(path);
const modelPath=local(values.model,'read'),diagnostics=local(values.diagnostics,'read');
const {manifest,bytes}=await readModel(modelPath.replace(/\.onnx$/,'.manifest.json'));
if(manifest.model.url!==basename(modelPath)||resolve(dirname(modelPath),manifest.model.url)!==modelPath)throw Error('Manifest model identity differs from the selected file');
if(manifest.releaseApproved!==false||manifest.evaluationStatus!=='pending'||manifest.trainingOnly!==true||!(manifest.optimizerUpdates>0))throw Error('Actual pending training-only manifest required');
const floats=name=>{const value=readFileSync(join(diagnostics,name));if(value.length%4)throw Error('Truncated Float32 diagnostic '+name);return new Float32Array(value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength));};
const ort=loadOrtRuntime(),inputs={};let session,outputs;
try {
  for(const [name,shape]of [['tile',[1,3,512,512]],['overview',[1,3,256,256]],['position',[1,4]]])inputs[name]=new ort.Tensor('float32',floats(name+'.f32'),shape);
  const expected=floats('expected-logits.f32'),started=performance.now();
  session=await ort.InferenceSession.create(bytes,{executionProviders:['wasm']});const loaded=performance.now();
  outputs=await session.run(inputs);const finished=performance.now(),logits=outputs.logits;
  if(logits.dims.join(',')!=='1,7,512,512'||logits.data.length!==expected.length)throw Error('Incorrect trained output shape');
  let maximumAbsoluteError=0,sum=0;
  for(let i=0;i<expected.length;i++){if(!Number.isFinite(logits.data[i])||!Number.isFinite(expected[i]))throw Error('Nonfinite trained output');const error=Math.abs(logits.data[i]-expected[i]);maximumAbsoluteError=Math.max(maximumAbsoluteError,error);sum+=error;}
  if(maximumAbsoluteError>.005)throw Error('Trained-model numerical parity failed: '+maximumAbsoluteError);
  const result={schemaVersion:1,purpose:'trained-model-execution-parity-only',releaseApproved:false,independentEvaluation:false,provider:'onnxruntime-web-wasm-cpu',threads:1,
    modelSha256:manifest.model.sha256,trainingBatches:manifest.trainingBatches,optimizerUpdates:manifest.optimizerUpdates,outputShape:logits.dims,finite:true,
    maximumAbsoluteError,meanAbsoluteError:sum/expected.length,loadMilliseconds:loaded-started,inferenceMilliseconds:finished-loaded,inputBackend:'local-filesystem',nodeVersion:process.version,
    verifierSha256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex')};
  writeFileSync(local(values.output,'write'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
} finally {for(const tensor of Object.values(inputs))tensor.dispose();for(const tensor of Object.values(outputs||{}))tensor.dispose();if(session)await session.release();}
