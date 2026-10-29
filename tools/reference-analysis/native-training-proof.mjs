// Private one-tile resume verification; never promotes a training checkpoint.
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {delimiter,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {verifyNativeTool} from '../native-tool.mjs';
import {matchingTorchLibrary,referenceProofSourceFiles} from './native-infer.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
export async function nativeTrainingProof({weights,sample,checkpoint,device='cpu',torchLibrary,
  root=defaultRoot,directory=resolve(root,'build-native/reference-analysis/training-proof'),signal}){
  signal?.throwIfAborted();
  if(process.platform!=='win32'||!weights||!sample||!checkpoint||!torchLibrary||!['cpu','cuda'].includes(device))throw Error('Windows proof requires weights, a verified sample, a new checkpoint and a matching LibTorch runtime');
  if(existsSync(checkpoint))throw Error('Checkpoint exists; preserve the previous file');
  const data=JSON.parse(readFileSync(join(sample,'sample.json'),'utf8'));
  if(data.trainingOnly!==true||data.releaseApproved!==false||!Number.isInteger(data.tileIndex)||data.tileIndex<0||
    !['sourcePdfSha256','imageSha256','annotationSha256','maskSha256','validMaskSha256'].every(field=>/^[a-f0-9]{64}$/.test(data[field]||'')))
    throw Error('A source-bound training-only sample receipt is required');
  const {binary,manifest}=verifyNativeTool({root,directory,target:'reference-training-proof',executable:'pando-reference-training-proof.exe',sourceFiles:referenceProofSourceFiles});
  const library=matchingTorchLibrary(torchLibrary,manifest),args=[device,resolve(weights),...['tile','overview','position','target','valid'].map(name=>resolve(sample,name+'.f32')),resolve(checkpoint),String(data.tileIndex)];
  const stdout=await new Promise((ok,fail)=>execFile(binary,args,{encoding:'utf8',windowsHide:true,maxBuffer:1024**2,signal,
    env:{...process.env,PATH:library+delimiter+process.env.PATH,CUBLAS_WORKSPACE_CONFIG:':4096:8'}},
  (error,text,stderr)=>error?fail(new Error('Native training proof failed: '+stderr,{cause:error})):ok(text)));
  signal?.throwIfAborted();const result=JSON.parse(stdout);
  if(result.purpose!=='real-input-resume-proof'||result.trainingOnly!==true||result.releaseApproved!==false||result.exactModelResume!==true||result.tileIndex!==data.tileIndex)
    throw Error('Native training proof returned an invalid result');
  const bytes=readFileSync(resolve(checkpoint));
  return {...result,device,sourceId:data.sourceId,sourcePdfSha256:data.sourcePdfSha256,checkpointBytes:bytes.length,
    checkpointSha256:createHash('sha256').update(bytes).digest('hex'),toolRevision:manifest.revision,independentEvaluation:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values}=parseArgs({options:{weights:{type:'string'},sample:{type:'string'},checkpoint:{type:'string'},device:{type:'string',default:'cpu'},'torch-library':{type:'string'}}});
    console.log(JSON.stringify(await nativeTrainingProof({...values,torchLibrary:values['torch-library']})));
  }catch(error){console.error('native-training-proof: '+error.message);process.exitCode=1;}
}
