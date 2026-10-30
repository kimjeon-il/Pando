// Stream a selected source-reviewed validation corpus through a private native
// checkpoint; a diagnostic result is never an independent model approval.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,delimiter,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {verifyNativeTool} from '../native-tool.mjs';
import {matchingTorchLibrary,referenceBatchSourceFiles} from './native-infer.mjs';
import {validateReviewedCorpus} from './reviewed-corpus.mjs';
import {assertEvaluationIndependence} from './training-lineage.mjs';
import {readTrainingBounded,trainingFileIdentity} from './training-evidence.mjs';
import {listReviewedTrainingTiles,prepareReviewedTrainingTile} from './training-tiles.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function validator(binary,args,env,signal,{binaryOutput=false,maximum=65536}={}){
  const child=spawn(binary,args,{stdio:['pipe','pipe','pipe'],windowsHide:true,env,signal}),out=[],errors=[];
  let outputBytes=0,errorBytes=0,settled=false;
  const done=new Promise((accept,reject)=>{
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):accept(value);};
    const timer=setTimeout(()=>{child.kill();finish(Error('Native validation timed out'));},30*60*1000);
    child.on('error',error=>finish(error));
    child.stdout.on('data',chunk=>{outputBytes+=chunk.length;if(outputBytes>maximum){child.kill();finish(Error('Native validation output exceeds budget'));}else out.push(chunk);});
    child.stderr.on('data',chunk=>{errorBytes+=chunk.length;if(errorBytes<=65536)errors.push(chunk);});
    child.on('close',(code,reason)=>{if(code!==0||reason)return finish(Error('Native validation failed: '+Buffer.concat(errors).toString('utf8')));
      try{const result=Buffer.concat(out,outputBytes);finish(null,binaryOutput?result:JSON.parse(result.toString('utf8')));}catch(error){finish(error);}});
  });
  done.catch(()=>{});return {child,done};
}
export async function nativeTrainingCheckpointInfer({checkpoint,tile,overview,position,device='cpu',torchLibrary,
  root=defaultRoot,directory=resolve(root,'build-native/reference-analysis/training-batch'),signal}){
  signal?.throwIfAborted();
  if(!['win32','linux'].includes(process.platform)||!checkpoint||!torchLibrary||!['cpu','cuda'].includes(device))throw Error('Explicit native checkpoint inference inputs required');
  if(![tile,overview,position].every(value=>value instanceof Uint8Array)||tile.length!==3*512*512*4||overview.length!==3*256*256*4||position.length!==4*4)
    throw Error('Checkpoint inference tensors have invalid dimensions');
  const path=resolve(checkpoint),receiptPath=path+'.receipt.json',checkpointHash=trainingFileIdentity(path),receiptBytes=readTrainingBounded(receiptPath,1024*1024),receiptHash=sha(receiptBytes),receipt=JSON.parse(receiptBytes);
  if(receipt.schemaVersion!==1||receipt.trainingOnly!==true||receipt.releaseApproved!==false||receipt.device!==device||receipt.checkpointSha256!==checkpointHash)
    throw Error('Private checkpoint receipt differs from its file');
  const executable=process.platform==='win32'?'pando-reference-training-batch.exe':'pando-reference-training-batch';
  const {binary,manifest:tool}=verifyNativeTool({root,directory,target:'reference-training-batch',executable,sourceFiles:referenceBatchSourceFiles});
  const library=matchingTorchLibrary(torchLibrary,tool),env={...process.env,
    ...(process.platform==='win32'?{PATH:library+delimiter+process.env.PATH}:{LD_LIBRARY_PATH:library+delimiter+(process.env.LD_LIBRARY_PATH||'')}),CUBLAS_WORKSPACE_CONFIG:':4096:8'};
  const bytes=7*512*512*4,{child,done}=validator(binary,['infer',device,path],env,signal,{binaryOutput:true,maximum:bytes});
  let logits;try{[,logits]=await Promise.all([pipeline(Readable.from([tile,overview,position],{objectMode:false}),child.stdin,{signal}),done]);}
  catch(error){child.kill();await done.catch(()=>{});throw error;}
  signal?.throwIfAborted();if(logits.length!==bytes)throw Error('Native checkpoint logits have incorrect dimensions');
  for(let at=0;at<logits.length;at+=4)if(!Number.isFinite(logits.readFloatLE(at)))throw Error('Native checkpoint logits contain nonfinite values');
  if(trainingFileIdentity(path)!==checkpointHash||sha(readTrainingBounded(receiptPath,1024*1024))!==receiptHash)throw Error('Inference checkpoint changed during execution');
  return {logits,checkpointSha256:checkpointHash,toolRevision:tool.revision,trainingOnly:true,releaseApproved:false};
}
export async function nativeTrainingValidation({checkpoint,corpus,device='cpu',diagnosticOnly=false,torchLibrary,
  root=defaultRoot,directory=resolve(root,'build-native/reference-analysis/training-batch'),signal}){
  signal?.throwIfAborted();
  if(!['win32','linux'].includes(process.platform)||!checkpoint||!corpus||!torchLibrary||!['cpu','cuda'].includes(device)||typeof diagnosticOnly!=='boolean')
    throw Error('Explicit native validation inputs are required');
  const checkpointPath=resolve(checkpoint),receiptPath=checkpointPath+'.receipt.json',checkpointHash=trainingFileIdentity(checkpointPath),receiptBytes=readTrainingBounded(receiptPath,1024*1024),receiptHash=sha(receiptBytes),receipt=JSON.parse(receiptBytes);
  if(receipt.schemaVersion!==1||receipt.trainingOnly!==true||receipt.releaseApproved!==false||receipt.device!==device||receipt.checkpointSha256!==checkpointHash)
    throw Error('Private checkpoint receipt differs from its file');
  if(receipt.lineageComplete!==true&&!diagnosticOnly)throw Error('Complete training ancestry is required for independent validation');
  const corpusPath=resolve(corpus),corpusBytes=readTrainingBounded(corpusPath,32*1024*1024),corpusHash=sha(corpusBytes),manifest=JSON.parse(corpusBytes),sourceRoot=dirname(corpusPath);
  if(manifest.trainingOnly)throw Error('Training-only corpus cannot be validation truth');
  if(!Array.isArray(manifest.sheets)||!manifest.sheets.length||manifest.sheets.some(row=>row.split!=='validation'))
    throw Error('Frozen validation corpus must contain only validation sheets');
  const verified=[];await validateReviewedCorpus(manifest,sourceRoot,{signal,onVerified:entry=>verified.push(entry)});
  let independence={passed:false,reason:'incomplete-training-ancestry'};
  if(receipt.lineageComplete===true){
    try{assertEvaluationIndependence(receipt.lineage,manifest.sheets,{split:'validation'});independence={passed:true};}
    catch(error){if(!diagnosticOnly)throw error;independence={passed:false,reason:error.message};}
  }
  const jobs=[],checks=[];
  for(const {sheet,annotation,annotationPath,annotationSha256,imagePath} of verified){signal?.throwIfAborted();const tiles=await listReviewedTrainingTiles(annotation,{signal});
    checks.push([annotationPath,annotationSha256],[imagePath,sheet.sha256]);
    for(const tile of tiles){jobs.push({sheet,annotation,imagePath,x:tile.x,y:tile.y});if(jobs.length>100000)throw Error('Validation tile count exceeds budget');}
  }
  if(!jobs.length)throw Error('Validation corpus has no known supervised pixels');
  const executable=process.platform==='win32'?'pando-reference-training-batch.exe':'pando-reference-training-batch';
  const {binary,manifest:tool}=verifyNativeTool({root,directory,target:'reference-training-batch',executable,sourceFiles:referenceBatchSourceFiles});
  const library=matchingTorchLibrary(torchLibrary,tool),env={...process.env,
    ...(process.platform==='win32'?{PATH:library+delimiter+process.env.PATH}:{LD_LIBRARY_PATH:library+delimiter+(process.env.LD_LIBRARY_PATH||'')}),CUBLAS_WORKSPACE_CONFIG:':4096:8'};
  const {child,done}=validator(binary,['validate',device,checkpointPath,String(jobs.length)],env,signal);
  async function* inputs(){for(const job of jobs){signal?.throwIfAborted();const tile=await prepareReviewedTrainingTile({imagePath:job.imagePath,sourceSha256:job.sheet.sha256,
      annotation:job.annotation,x:job.x,y:job.y,augment:false,epoch:0,index:0},{signal});
    for(const name of ['tile','overview','position','target','valid'])yield tile[name];}}
  let result;try{[,result]=await Promise.all([pipeline(Readable.from(inputs(),{objectMode:false}),child.stdin,{signal}),done]);}
  catch(error){child.kill();await done.catch(()=>{});throw error;}
  signal?.throwIfAborted();if(result.trainingOnly!==true||result.releaseApproved!==false||result.independentEvaluation!==false||result.samples!==jobs.length||!Number.isFinite(result.loss))
    throw Error('Native validation returned an invalid result');
  if(trainingFileIdentity(checkpointPath)!==checkpointHash||sha(readTrainingBounded(receiptPath,1024*1024))!==receiptHash||sha(readTrainingBounded(corpusPath,32*1024*1024))!==corpusHash)
    throw Error('Validation checkpoint or corpus changed during execution');
  for(const [path,expected] of checks)if(trainingFileIdentity(path)!==expected)throw Error('Validation source changed during execution');
  return {validationLoss:result.loss,samples:result.samples,device,diagnosticOnly,independence,trainingOnly:true,releaseApproved:false,
    checkpointSha256:checkpointHash,corpusSha256:corpusHash,toolRevision:tool.revision};
}
