// Export a verified private warm-start; this does not approve or publish a model.
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {delimiter,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {verifyNativeTool} from '../native-tool.mjs';
import {matchingTorchLibrary,referenceOnnxExportSourceFiles} from './native-infer.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
export async function nativeOnnxExport({weights,output,torchLibrary,root=defaultRoot,
  directory=resolve(root,'build-native/reference-analysis/onnx-export'),signal}){
  signal?.throwIfAborted();
  if(process.platform!=='win32'||!weights||!output||!torchLibrary)throw Error('Windows ONNX export requires weights, a new output and a matching LibTorch runtime');
  if(existsSync(output))throw Error('ONNX output exists; preserve the existing file');
  const transfer=JSON.parse(readFileSync(resolve(dirname(weights),'transfer.json'),'utf8'));
  const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
  if(transfer.trainingOnly!==true||transfer.evaluationStatus!=='pending'||transfer.releaseApproved!==false||
    transfer.transfer!=='weights-only-no-optimizer'||sha256(readFileSync(resolve(weights)))!==transfer.weightsSha256)
    throw Error('Verified private warm-start weights are required');
  const {binary,manifest}=verifyNativeTool({root,directory,target:'reference-onnx-export',executable:'pando-reference-onnx-export.exe',sourceFiles:referenceOnnxExportSourceFiles});
  const library=matchingTorchLibrary(torchLibrary,manifest);
  const stdout=await new Promise((ok,fail)=>execFile(binary,[resolve(weights),resolve(output)],{encoding:'utf8',windowsHide:true,
    maxBuffer:1024**2,timeout:180000,signal,env:{...process.env,PATH:library+delimiter+process.env.PATH}},
  (error,text,stderr)=>error?fail(new Error('Native ONNX export failed: '+error.message+' '+stderr,{cause:error})):ok(text)));
  signal?.throwIfAborted();const receipt=JSON.parse(stdout),bytes=readFileSync(resolve(output));
  if(receipt.trainingOnly!==true||receipt.releaseApproved!==false||receipt.opset!==17||receipt.bytes!==bytes.length||!bytes.length)
    throw Error('Native ONNX export returned an invalid result');
  return {...receipt,modelSha256:sha256(bytes),toolRevision:manifest.revision,independentEvaluation:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values}=parseArgs({options:{weights:{type:'string'},output:{type:'string'},'torch-library':{type:'string'}}});
    console.log(JSON.stringify(await nativeOnnxExport({...values,torchLibrary:values['torch-library']})));
  }catch(error){console.error('native-onnx-export: '+error.message);process.exitCode=1;}
}
