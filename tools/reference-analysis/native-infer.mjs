// Run the source-bound native inference binary with an explicitly selected SDK.
import {execFile} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {delimiter,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {verifyNativeTool} from '../native-tool.mjs';

export const referenceSourceFiles=Object.freeze(['tools/cpp/CMakeLists.txt','tools/cpp/reference-analysis/reference-infer.cpp',
  'tools/cpp/reference-analysis/reference-model.cpp','tools/cpp/reference-analysis/reference-model.h',
  'tools/cpp/reference-analysis/reference-onnx.cpp','tools/cpp/reference-analysis/reference-onnx.h',
  'tools/cpp/reference-analysis/reference-io.cpp','tools/cpp/reference-analysis/reference-io.h',
  'tools/cpp/reference-analysis/safetensors.cpp','tools/cpp/reference-analysis/safetensors.h',
  'tools/cpp/reference-analysis/training-checkpoint.cpp','tools/cpp/reference-analysis/training-checkpoint.h',
  'tools/cpp/reference-analysis/boundary-loss.cpp','tools/cpp/reference-analysis/boundary-loss.h',
  'shared/core/src/losslessjson.cpp','shared/core/include/pandoeditor/losslessjson.h']);
export const referenceProofSourceFiles=Object.freeze([...referenceSourceFiles,'tools/cpp/reference-analysis/reference-training-proof.cpp']);
export const referenceOnnxTestSourceFiles=Object.freeze([...referenceSourceFiles,'tools/cpp/reference-analysis/reference-onnx-tests.cpp']);
export const referenceOnnxExportSourceFiles=Object.freeze([...referenceSourceFiles,'tools/cpp/reference-analysis/reference-onnx-export.cpp']);
const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
export function matchingTorchLibrary(torchLibrary,manifest){
  if(manifest.runtimeVersion!=='2.14.1')throw Error('Unexpected native LibTorch ABI version');
  const library=resolve(torchLibrary),versionFile=join(dirname(library),'version.py');
  const version=readFileSync(versionFile,'utf8').match(/^__version__\s*=\s*['"]([^'"]+)['"]/m)?.[1];
  if(!version||version.split('+')[0]!==manifest.runtimeVersion||!existsSync(join(library,'torch_cpu.dll'))||!existsSync(join(library,'c10.dll')))
    throw Error('The selected LibTorch runtime does not match the native tool');
  return library;
}
export async function nativeReferenceInfer({weights,tile,overview,position,output,device='cpu',torchLibrary,
  root=defaultRoot,directory=resolve(root,'build-native/reference-analysis/windows'),signal}){
  signal?.throwIfAborted();
  if(process.platform!=='win32'||!torchLibrary||!['cpu','cuda'].includes(device))throw Error('Windows native inference requires a CPU/CUDA device and LibTorch library directory');
  if(!weights||!tile||!overview||!position||!output)throw Error('Weights, three tensor inputs and a new output are required');
  if(existsSync(output))throw Error('Inference output already exists; preserve it');
  const {binary,manifest}=verifyNativeTool({root,directory,target:'reference-infer',executable:'pando-reference-infer.exe',sourceFiles:referenceSourceFiles});
  const library=matchingTorchLibrary(torchLibrary,manifest);
  const data=await new Promise((ok,fail)=>execFile(binary,[device,resolve(weights),resolve(tile),resolve(overview),resolve(position)],{
    encoding:'buffer',windowsHide:true,maxBuffer:8*1024**2,timeout:180000,signal,env:{...process.env,PATH:library+delimiter+process.env.PATH},
  },(error,stdout,stderr)=>error?fail(new Error('Native reference inference failed: '+error.message+' '+stderr.toString(),{cause:error})):ok(stdout)));
  signal?.throwIfAborted();
  if(data.length!==7*512*512*4)throw Error('Native reference output has an incorrect byte length');
  writeFileSync(resolve(output),data,{flag:'wx'});return {bytes:data.length,shape:[1,7,512,512],device,toolRevision:manifest.revision};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values}=parseArgs({options:{weights:{type:'string'},tile:{type:'string'},overview:{type:'string'},position:{type:'string'},output:{type:'string'},
      device:{type:'string',default:'cpu'},'torch-library':{type:'string'}}});
    console.log(JSON.stringify(await nativeReferenceInfer({...values,torchLibrary:values['torch-library']})));
  }catch(error){console.error('native-reference-infer: '+error.message);process.exitCode=1;}
}
