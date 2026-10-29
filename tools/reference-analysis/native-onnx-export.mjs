// Export a verified private warm-start; this does not approve or publish a model.
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {delimiter,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {verifyNativeTool} from '../native-tool.mjs';
import {matchingTorchLibrary,referenceOnnxExportSourceFiles} from './native-infer.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
async function runExport({args,output,torchLibrary,root,directory,signal,diagnostic,checkpoint=false}){
  const {binary,manifest}=verifyNativeTool({root,directory,target:'reference-onnx-export',executable:'pando-reference-onnx-export.exe',sourceFiles:referenceOnnxExportSourceFiles});
  const library=matchingTorchLibrary(torchLibrary,manifest);
  const stdout=await new Promise((ok,fail)=>execFile(binary,[...args,resolve(output)],{encoding:'utf8',windowsHide:true,
    maxBuffer:1024**2,timeout:180000,signal,env:{...process.env,PATH:library+delimiter+process.env.PATH,CUBLAS_WORKSPACE_CONFIG:':4096:8'}},
  (error,text,stderr)=>error?fail(new Error('Native ONNX export failed: '+error.message+' '+stderr,{cause:error})):ok(text)));
  signal?.throwIfAborted();const receipt=JSON.parse(stdout),bytes=readFileSync(resolve(output));
  if(receipt.trainingOnly!==true||receipt.releaseApproved!==false||receipt.diagnostic!==diagnostic||receipt.checkpoint!==checkpoint||receipt.opset!==17||receipt.bytes!==bytes.length||!bytes.length)
    throw Error('Native ONNX export returned an invalid result');
  return {...receipt,modelSha256:sha256(bytes),toolRevision:manifest.revision,independentEvaluation:false};
}
export async function nativeOnnxExport({weights,output,torchLibrary,root=defaultRoot,
  directory=resolve(root,'build-native/reference-analysis/onnx-export'),signal}){
  signal?.throwIfAborted();
  if(process.platform!=='win32'||!weights||!output||!torchLibrary)throw Error('Windows ONNX export requires weights, a new output and a matching LibTorch runtime');
  if(existsSync(output))throw Error('ONNX output exists; preserve the existing file');
  const transfer=JSON.parse(readFileSync(resolve(dirname(weights),'transfer.json'),'utf8'));
  if(transfer.trainingOnly!==true||transfer.evaluationStatus!=='pending'||transfer.releaseApproved!==false||
    transfer.transfer!=='weights-only-no-optimizer'||sha256(readFileSync(resolve(weights)))!==transfer.weightsSha256)
    throw Error('Verified private warm-start weights are required');
  return runExport({args:[resolve(weights)],output,torchLibrary,root,directory,signal,diagnostic:false});
}
export async function nativeOnnxDiagnostic({output,torchLibrary,root=defaultRoot,
  directory=resolve(root,'build-native/reference-analysis/onnx-export'),signal}){
  signal?.throwIfAborted();
  if(process.platform!=='win32'||!output||!torchLibrary)throw Error('Windows ONNX diagnostic requires a new output and a matching LibTorch runtime');
  if(existsSync(output))throw Error('ONNX output exists; preserve the existing file');
  return runExport({args:['--diagnostic'],output,torchLibrary,root,directory,signal,diagnostic:true});
}
export async function nativeCheckpointOnnxExport({checkpoint,proof,output,torchLibrary,root=defaultRoot,
  directory=resolve(root,'build-native/reference-analysis/onnx-export'),signal}){
  signal?.throwIfAborted();
  if(process.platform!=='win32'||!checkpoint||!proof||!output||!torchLibrary)throw Error('Checkpoint ONNX export requires a checkpoint, its proof, a new output and a matching LibTorch runtime');
  if(existsSync(output))throw Error('ONNX output exists; preserve the existing file');
  const receipt=JSON.parse(readFileSync(resolve(proof),'utf8'));
  if(statSync(resolve(checkpoint)).size>1024**3)throw Error('Training checkpoint exceeds its size limit');
  const bytes=readFileSync(resolve(checkpoint));
  if(receipt.purpose!=='real-input-resume-proof'||receipt.trainingOnly!==true||receipt.releaseApproved!==false||receipt.independentEvaluation!==false||
    receipt.exactModelResume!==true||!['cpu','cuda'].includes(receipt.device)||receipt.checkpointBytes!==bytes.length||receipt.checkpointSha256!==sha256(bytes))
    throw Error('A matching private checkpoint and resume proof are required');
  return runExport({args:['--checkpoint',receipt.device,resolve(checkpoint)],output,torchLibrary,root,directory,signal,diagnostic:false,checkpoint:true});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values}=parseArgs({options:{weights:{type:'string'},checkpoint:{type:'string'},proof:{type:'string'},output:{type:'string'},diagnostic:{type:'boolean',default:false},'torch-library':{type:'string'}}});
    if(Number(values.diagnostic)+Number(Boolean(values.weights))+Number(Boolean(values.checkpoint))!==1)throw Error('Choose exactly one of diagnostic, weights or checkpoint');
    const request={...values,torchLibrary:values['torch-library']};
    console.log(JSON.stringify(await (values.diagnostic?nativeOnnxDiagnostic(request):values.checkpoint?nativeCheckpointOnnxExport(request):nativeOnnxExport(request))));
  }catch(error){console.error('native-onnx-export: '+error.message);process.exitCode=1;}
}
