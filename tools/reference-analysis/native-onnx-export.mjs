// Export a verified private warm-start; this does not approve or publish a model.
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {basename,delimiter,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {verifyNativeTool} from '../native-tool.mjs';
import {reportArgument} from '../report-paths.mjs';
import {matchingTorchLibrary,referenceOnnxExportSourceFiles} from './native-infer.mjs';
import {assertPublicEncoderIdentity,trainingFileIdentity,verifyTrainingInitializer} from './training-evidence.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const classes=Object.freeze(['international','administrative','coast','hydro','transport','text','frame']);
function occupied(path){try{lstatSync(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
export function checkpointOnnxManifest({receipt,model}={}){
  if(!receipt||receipt.schemaVersion!==1||receipt.trainingOnly!==true||receipt.releaseApproved!==false||
    receipt.lineageComplete!==false||receipt.sourceReplayVerified!==false||!['weights-only-no-optimizer','public-encoder-no-optimizer'].includes(receipt.initialization)||
    !/^[a-f0-9]{64}$/.test(receipt.corpusSha256||'')||!/^[a-f0-9]{64}$/.test(receipt.checkpointSha256||'')||
    !Number.isSafeInteger(receipt.attemptedBatches)||receipt.attemptedBatches<1||
    !Number.isSafeInteger(receipt.optimizerUpdates)||receipt.optimizerUpdates<1||receipt.optimizerUpdates>receipt.attemptedBatches||
    !Number.isSafeInteger(receipt.unobservedMask)||receipt.unobservedMask<0||receipt.unobservedMask>127)
    throw Error('Complete private training receipt required for an ONNX manifest');
  if(receipt.initialization==='public-encoder-no-optimizer')assertPublicEncoderIdentity(receipt.encoderInitialization);
  const combined=Object.hasOwn(receipt,'auxiliarySha256')||Object.hasOwn(receipt,'lineageFingerprint');
  if(combined&&(!/^[a-f0-9]{64}$/.test(receipt.auxiliarySha256||'')||!/^[a-f0-9]{64}$/.test(receipt.lineageFingerprint||'')))
    throw Error('Complete auxiliary corpus identity required for an ONNX manifest');
  if(!model||typeof model.file!=='string'||!/^[\w.-]+\.onnx$/.test(model.file)||basename(model.file)!==model.file||
    !Number.isSafeInteger(model.bytes)||model.bytes<1||model.bytes>64*1024*1024||!/^[a-f0-9]{64}$/.test(model.sha256||''))
    throw Error('Valid local ONNX model identity required');
  return {schemaVersion:1,architecture:'mobilenetv3-unet-context-v1',classes:[...classes],tileSize:512,overlap:64,overviewSize:256,
    model:{url:model.file,sha256:model.sha256,bytes:model.bytes},corpusSha256:receipt.corpusSha256,
    ...(combined?{auxiliaryCorpusSha256:receipt.auxiliarySha256,lineageFingerprint:receipt.lineageFingerprint}:{}),
    evaluationStatus:'pending',releaseApproved:false,trainingOnly:true,checkpointSha256:receipt.checkpointSha256,
    lineageComplete:false,sourceReplayVerified:false,initialization:receipt.initialization,...(receipt.encoderInitialization?{encoderInitialization:receipt.encoderInitialization}:{}),trainingBatches:receipt.attemptedBatches,
    optimizerUpdates:receipt.optimizerUpdates,stepCountKind:'attempted-batches',
    unobservedChannels:classes.filter((_,index)=>(receipt.unobservedMask&(1<<index))!==0)};
}
async function runExport({args,output,torchLibrary,root,directory,signal,diagnostic,checkpoint=false}){
  const executable=process.platform==='win32'?'pando-reference-onnx-export.exe':'pando-reference-onnx-export';
  const {binary,manifest}=verifyNativeTool({root,directory,target:'reference-onnx-export',executable,sourceFiles:referenceOnnxExportSourceFiles});
  const library=matchingTorchLibrary(torchLibrary,manifest);
  const stdout=await new Promise((ok,fail)=>execFile(binary,[...args,resolve(output)],{encoding:'utf8',windowsHide:true,
    maxBuffer:1024**2,timeout:180000,signal,env:{...process.env,
      ...(process.platform==='win32'?{PATH:library+delimiter+(process.env.PATH||'')}:{LD_LIBRARY_PATH:library+delimiter+(process.env.LD_LIBRARY_PATH||'')}),
      CUBLAS_WORKSPACE_CONFIG:':4096:8'}},
  (error,text,stderr)=>error?fail(new Error('Native ONNX export failed: '+error.message+' '+stderr,{cause:error})):ok(text)));
  signal?.throwIfAborted();const receipt=JSON.parse(stdout),bytes=readFileSync(resolve(output));
  if(receipt.trainingOnly!==true||receipt.releaseApproved!==false||receipt.diagnostic!==diagnostic||receipt.checkpoint!==checkpoint||receipt.opset!==17||receipt.bytes!==bytes.length||!bytes.length)
    throw Error('Native ONNX export returned an invalid result');
  return {...receipt,modelSha256:sha256(bytes),toolRevision:manifest.revision,independentEvaluation:false};
}
export function transferredWeightsOnnxReceipt({initializer,model}={}){
  if(initializer?.initialization!=='weights-only-no-optimizer'||!/^[a-f0-9]{64}$/.test(initializer.weightsSha256||'')||
    !/^[a-f0-9]{64}$/.test(initializer.sourceCheckpointSha256||'')||!model||
    typeof model.file!=='string'||!/^[\w.-]+\.onnx$/.test(model.file)||basename(model.file)!==model.file||
    !Number.isSafeInteger(model.bytes)||model.bytes<1||model.bytes>64*1024*1024||!/^[a-f0-9]{64}$/.test(model.sha256||''))
    throw Error('Verified transferred weights and local ONNX identity required');
  return {schemaVersion:1,kind:'transferred-weights-onnx-export',model:{file:model.file,sha256:model.sha256,bytes:model.bytes},opset:17,
    weightsSha256:initializer.weightsSha256,sourceCheckpointSha256:initializer.sourceCheckpointSha256,
    optimizerStateTransferred:false,lineageComplete:false,trainingOnly:true,independentEvaluation:false,releaseApproved:false};
}
export async function nativeOnnxExport({weights,output,receiptOutput,torchLibrary,root=defaultRoot,
  directory=resolve(root,'build-native/reference-analysis/onnx-export'),signal}){
  signal?.throwIfAborted();
  if(!['win32','linux'].includes(process.platform)||!weights||!output||!torchLibrary)throw Error('ONNX export requires weights, a new output and a matching LibTorch runtime');
  if(occupied(output))throw Error('ONNX output exists; preserve the existing file');
  if(receiptOutput!==undefined&&(typeof receiptOutput!=='string'||!output.endsWith('.onnx')||resolve(receiptOutput)!==resolve(output+'.export.json')))
    throw Error('ONNX export receipt must be the matching .onnx.export.json');
  if(receiptOutput!==undefined&&occupied(receiptOutput))throw Error('ONNX export receipt exists; preserve the existing file');
  let initializer;try{initializer=verifyTrainingInitializer({path:weights});}
  catch(error){throw Error('Verified private warm-start weights are required',{cause:error});}
  if(initializer.initialization!=='weights-only-no-optimizer')throw Error('Verified private warm-start weights are required');
  if(receiptOutput!==undefined)transferredWeightsOnnxReceipt({initializer,model:{file:basename(output),bytes:1,sha256:'0'.repeat(64)}});
  const result=await runExport({args:[resolve(weights)],output,torchLibrary,root,directory,signal,diagnostic:false});
  const after=verifyTrainingInitializer({path:weights,expectedSha256:initializer.weightsSha256});
  if(after.recordHash!==initializer.recordHash)throw Error('Transferred weights or receipt changed during ONNX export');
  if(receiptOutput!==undefined){
    const receipt=transferredWeightsOnnxReceipt({initializer,model:{file:basename(output),bytes:result.bytes,sha256:result.modelSha256}});
    writeFileSync(receiptOutput,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  }
  return result;
}
export async function nativeOnnxDiagnostic({output,torchLibrary,root=defaultRoot,
  directory=resolve(root,'build-native/reference-analysis/onnx-export'),signal}){
  signal?.throwIfAborted();
  if(!['win32','linux'].includes(process.platform)||!output||!torchLibrary)throw Error('ONNX diagnostic requires a new output and a matching LibTorch runtime');
  if(occupied(output))throw Error('ONNX output exists; preserve the existing file');
  return runExport({args:['--diagnostic'],output,torchLibrary,root,directory,signal,diagnostic:true});
}
export async function nativeCheckpointOnnxExport({checkpoint,proof,output,manifestOutput,torchLibrary,root=defaultRoot,
  directory=resolve(root,'build-native/reference-analysis/onnx-export'),signal}){
  signal?.throwIfAborted();
  if(!['win32','linux'].includes(process.platform)||!checkpoint||!proof||!output||!torchLibrary)throw Error('Checkpoint ONNX export requires a checkpoint, its proof, a new output and a matching LibTorch runtime');
  if(occupied(output))throw Error('ONNX output exists; preserve the existing file');
  const proofPath=resolve(proof);if(statSync(proofPath).size>1024**2)throw Error('Training proof exceeds its size limit');
  const proofBytes=readFileSync(proofPath),proofHash=sha256(proofBytes),receipt=JSON.parse(proofBytes.toString('utf8'));
  if(statSync(resolve(checkpoint)).size>1024**3)throw Error('Training checkpoint exceeds its size limit');
  const checkpointHash=trainingFileIdentity(resolve(checkpoint));
  const proofReceipt=receipt.purpose==='real-input-resume-proof'&&receipt.independentEvaluation===false&&
    receipt.preprocessing==='rgb-brightness-then-imagenet-normalization'&&receipt.exactModelResume===true;
  const trainingReceipt=receipt.schemaVersion===1&&receipt.lineageComplete===false&&receipt.sourceReplayVerified===false&&
    ['weights-only-no-optimizer','public-encoder-no-optimizer'].includes(receipt.initialization)&&['fp32','amp-fp16'].includes(receipt.precision)&&
    (receipt.precision!=='amp-fp16'||receipt.device==='cuda')&&Number.isSafeInteger(receipt.epoch)&&receipt.epoch>=0&&
    Number.isSafeInteger(receipt.cursor)&&receipt.cursor>=0&&Number.isSafeInteger(receipt.orderLength)&&receipt.cursor<=receipt.orderLength;
  if((!proofReceipt&&!trainingReceipt)||receipt.trainingOnly!==true||receipt.releaseApproved!==false||!['cpu','cuda'].includes(receipt.device)||
    receipt.checkpointBytes!==statSync(resolve(checkpoint)).size||receipt.checkpointSha256!==checkpointHash)
    throw Error('A matching private checkpoint and resume proof are required');
  if(manifestOutput!==undefined){
    if(typeof manifestOutput!=='string'||!output.endsWith('.onnx')||resolve(manifestOutput)!==resolve(output.slice(0,-5)+'.manifest.json'))
      throw Error('ONNX manifest must use the matching model filename');
    if(occupied(manifestOutput))throw Error('ONNX manifest output exists; preserve the existing file');
    checkpointOnnxManifest({receipt,model:{file:basename(output),bytes:1,sha256:'0'.repeat(64)}});
  }
  const result=await runExport({args:['--checkpoint',receipt.device,resolve(checkpoint)],output,torchLibrary,root,directory,signal,diagnostic:false,checkpoint:true});
  if(trainingFileIdentity(resolve(checkpoint))!==checkpointHash||sha256(readFileSync(proofPath))!==proofHash)
    throw Error('Checkpoint or proof changed during ONNX export; preserve the output');
  if(manifestOutput!==undefined){
    const manifest=checkpointOnnxManifest({receipt,model:{file:basename(output),bytes:result.bytes,sha256:result.modelSha256}});
    writeFileSync(manifestOutput,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  }
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values}=parseArgs({options:{weights:{type:'string'},checkpoint:{type:'string'},proof:{type:'string'},output:{type:'string'},
      manifest:{type:'string'},receipt:{type:'string'},diagnostic:{type:'boolean',default:false},'torch-library':{type:'string'}}});
    if(Number(values.diagnostic)+Number(Boolean(values.weights))+Number(Boolean(values.checkpoint))!==1)throw Error('Choose exactly one of diagnostic, weights or checkpoint');
    if(values.manifest&&!values.checkpoint)throw Error('A checkpoint is required for its ONNX manifest');
    if(values.receipt&&!values.weights)throw Error('Transferred weights are required for an ONNX export receipt');
    const report=(name,access)=>values[name]===undefined?undefined:reportArgument(values[name],{access,siblings:true});
    const request={...values,weights:report('weights','read'),checkpoint:report('checkpoint','read'),proof:report('proof','read'),
      output:report('output','write'),manifestOutput:report('manifest','write'),receiptOutput:report('receipt','write'),torchLibrary:values['torch-library']};
    console.log(JSON.stringify(await (values.diagnostic?nativeOnnxDiagnostic(request):values.checkpoint?nativeCheckpointOnnxExport(request):nativeOnnxExport(request))));
  }catch(error){console.error('native-onnx-export: '+error.message);process.exitCode=1;}
}
