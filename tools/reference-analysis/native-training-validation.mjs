// Stream a selected source-reviewed validation corpus through a private native
// checkpoint; a diagnostic result is never an independent model approval.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,delimiter,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {isDeepStrictEqual,parseArgs} from 'node:util';
import {verifyNativeTool} from '../native-tool.mjs';
import {reportArgument} from '../report-paths.mjs';
import {matchingTorchLibrary,referenceBatchSourceFiles} from './native-infer.mjs';
import {validateReviewedCorpus} from './reviewed-corpus.mjs';
import {assertEvaluationIndependence} from './training-lineage.mjs';
import {readTrainingBounded,trainingFileIdentity,verifyTrainingInitializer} from './training-evidence.mjs';
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
async function inferPrivateModel({path,mode,tile,overview,position,device,output,torchLibrary,root,directory,signal}){
  signal?.throwIfAborted();
  if(!['win32','linux'].includes(process.platform)||!path||!torchLibrary||!['cpu','cuda'].includes(device))throw Error('Explicit native checkpoint inference inputs required');
  if(!['logits','probabilities'].includes(output))throw Error('Invalid checkpoint inference output');
  if(![tile,overview,position].every(value=>value instanceof Uint8Array)||tile.length!==3*512*512*4||overview.length!==3*256*256*4||position.length!==4*4)
    throw Error('Checkpoint inference tensors have invalid dimensions');
  const executable=process.platform==='win32'?'pando-reference-training-batch.exe':'pando-reference-training-batch';
  const {binary,manifest:tool}=verifyNativeTool({root,directory,target:'reference-training-batch',executable,sourceFiles:referenceBatchSourceFiles});
  const library=matchingTorchLibrary(torchLibrary,tool),env={...process.env,
    ...(process.platform==='win32'?{PATH:library+delimiter+process.env.PATH}:{LD_LIBRARY_PATH:library+delimiter+(process.env.LD_LIBRARY_PATH||'')}),CUBLAS_WORKSPACE_CONFIG:':4096:8'};
  const bytes=7*512*512*4,{child,done}=validator(binary,[mode,device,path,output],env,signal,{binaryOutput:true,maximum:bytes});
  let logits;try{[,logits]=await Promise.all([pipeline(Readable.from([tile,overview,position],{objectMode:false}),child.stdin,{signal}),done]);}
  catch(error){child.kill();await done.catch(()=>{});throw error;}
  signal?.throwIfAborted();if(logits.length!==bytes)throw Error('Native checkpoint logits have incorrect dimensions');
  for(let at=0;at<logits.length;at+=4){const value=logits.readFloatLE(at);
    if(!Number.isFinite(value)||(output==='probabilities'&&(value<0||value>1)))throw Error('Native checkpoint output contains invalid values');}
  return {[output]:logits,toolRevision:tool.revision,trainingOnly:true,releaseApproved:false};
}
export async function nativeTrainingCheckpointInfer({checkpoint,tile,overview,position,device='cpu',output='logits',torchLibrary,
  root=defaultRoot,directory=resolve(root,'build-native/reference-analysis/training-batch'),signal}){
  signal?.throwIfAborted();if(!checkpoint)throw Error('Explicit native checkpoint required');
  const path=resolve(checkpoint),receiptPath=path+'.receipt.json',checkpointHash=trainingFileIdentity(path),receiptBytes=readTrainingBounded(receiptPath,1024*1024),receiptHash=sha(receiptBytes),receipt=JSON.parse(receiptBytes);
  if(receipt.schemaVersion!==1||receipt.trainingOnly!==true||receipt.releaseApproved!==false||receipt.device!==device||receipt.checkpointSha256!==checkpointHash)
    throw Error('Private checkpoint receipt differs from its file');
  const result=await inferPrivateModel({path,mode:'infer',tile,overview,position,device,output,torchLibrary,root,directory,signal});
  if(trainingFileIdentity(path)!==checkpointHash||sha(readTrainingBounded(receiptPath,1024*1024))!==receiptHash)throw Error('Inference checkpoint changed during execution');
  return {...result,checkpointSha256:checkpointHash};
}
export async function nativeTrainingWeightsInfer({weights,tile,overview,position,device='cpu',output='logits',torchLibrary,
  root=defaultRoot,directory=resolve(root,'build-native/reference-analysis/training-batch'),signal}){
  signal?.throwIfAborted();if(!weights)throw Error('Explicit training initializer required');
  const path=resolve(weights),weightsHash=trainingFileIdentity(path);
  let verified;try{verified=verifyTrainingInitializer({path,expectedSha256:weightsHash});}
  catch(error){throw Error('Training initializer receipt differs from its weights',{cause:error});}
  const result=await inferPrivateModel({path,mode:'infer-weights',tile,overview,position,device,output,torchLibrary,root,directory,signal});
  const after=verifyTrainingInitializer({path,expectedSha256:weightsHash});
  if(after.recordHash!==verified.recordHash)throw Error('Initializer changed during execution');
  return {...result,weightsSha256:weightsHash};
}
// Compare semantic checkpoint state; serialized archive bytes can differ even
// when model, optimizer, sampling and RNG state are identical.
export async function compareNativeTrainingCheckpoints({first,second,device='cpu',torchLibrary,
  root=defaultRoot,directory=resolve(root,'build-native/reference-analysis/training-batch'),signal}){
  signal?.throwIfAborted();
  if(!['win32','linux'].includes(process.platform)||!first||!second||!torchLibrary||!['cpu','cuda'].includes(device))
    throw Error('Explicit native checkpoint comparison inputs required');
  const inputs=[first,second].map(value=>{const path=resolve(value),hash=trainingFileIdentity(path),receiptPath=path+'.receipt.json';
    const bytes=readTrainingBounded(receiptPath,1024*1024),receipt=JSON.parse(bytes);
    if(receipt.schemaVersion!==1||receipt.trainingOnly!==true||receipt.releaseApproved!==false||receipt.device!==device||receipt.checkpointSha256!==hash||
      !/^[a-f0-9]{64}$/.test(receipt.corpusSha256||'')||!['fp32','amp-fp16'].includes(receipt.precision)||
      (receipt.precision==='amp-fp16'&&(device!=='cuda'||!Number.isFinite(receipt.ampScale)||receipt.ampScale<=0||
        !Number.isInteger(receipt.ampGrowthTracker)||receipt.ampGrowthTracker<0||receipt.ampGrowthTracker>=2000))||
      (receipt.precision==='fp32'&&(receipt.ampScale!==null||receipt.ampGrowthTracker!==null))||
      !['epoch','cursor','orderLength','seed','freezeEpochs','attemptedBatches','optimizerUpdates','skippedUpdates'].every(key=>Number.isSafeInteger(receipt[key])&&receipt[key]>=0)||
      receipt.cursor>receipt.orderLength||receipt.optimizerUpdates+receipt.skippedUpdates!==receipt.attemptedBatches||
      !Number.isFinite(receipt.learningRate)||receipt.learningRate<=0||receipt.learningRate>.01||
      !Number.isInteger(receipt.unobservedMask)||receipt.unobservedMask<0||receipt.unobservedMask>127||
      !(receipt.positiveWeightSha256===null||/^[a-f0-9]{64}$/.test(receipt.positiveWeightSha256||'')))
      throw Error('Checkpoint comparison receipt differs from its file');
    return {path,hash,receipt,receiptPath,receiptHash:sha(bytes)};});
  const config=['precision','ampScale','ampGrowthTracker','epoch','cursor','orderLength','seed','freezeEpochs','learningRate',
    'unobservedMask','positiveWeightSha256','corpusSha256','auxiliarySha256','lineageFingerprint','orderSha256','attemptedBatches',
    'optimizerUpdates','skippedUpdates','initialization','initializationWeightsSha256','initializationSourceSha256','encoderInitialization'];
  if(config.some(key=>!isDeepStrictEqual(inputs[0].receipt[key],inputs[1].receipt[key]))||
    !isDeepStrictEqual(inputs[0].receipt.evidence?.[0]?.augment,inputs[1].receipt.evidence?.[0]?.augment))
    throw Error('Checkpoint comparison training configuration differs');
  const executable=process.platform==='win32'?'pando-reference-training-batch.exe':'pando-reference-training-batch';
  const {binary,manifest:tool}=verifyNativeTool({root,directory,target:'reference-training-batch',executable,sourceFiles:referenceBatchSourceFiles});
  const library=matchingTorchLibrary(torchLibrary,tool),env={...process.env,
    ...(process.platform==='win32'?{PATH:library+delimiter+process.env.PATH}:{LD_LIBRARY_PATH:library+delimiter+(process.env.LD_LIBRARY_PATH||'')}),CUBLAS_WORKSPACE_CONFIG:':4096:8'};
  const {child,done}=validator(binary,['compare',device,inputs[0].path,inputs[1].path],env,signal);child.stdin.end();
  const result=await done;signal?.throwIfAborted();
  if(result.equal!==true||!Number.isSafeInteger(result.optimizerStates)||result.optimizerStates<0||result.trainingOnly!==true||result.releaseApproved!==false||
    ['epoch','cursor','orderLength','seed'].some(key=>result[key]!==inputs[0].receipt[key]))
    throw Error('Invalid native checkpoint comparison result');
  for(const input of inputs)if(trainingFileIdentity(input.path)!==input.hash||trainingFileIdentity(input.receiptPath)!==input.receiptHash)
    throw Error('Checkpoint comparison input changed during execution');
  return {...result,firstSha256:inputs[0].hash,secondSha256:inputs[1].hash};
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
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{const {values,positionals}=parseArgs({allowPositionals:true,options:{compare:{type:'boolean',default:false},first:{type:'string'},second:{type:'string'},
      device:{type:'string'},'torch-library':{type:'string'},directory:{type:'string'}}});
    if(positionals.length||!values.compare||!values.first||!values.second||!values.device||!values['torch-library'])
      throw Error('Expected --compare with first, second, device and torch library');
    console.log(JSON.stringify(await compareNativeTrainingCheckpoints({first:reportArgument(values.first,{access:'read',siblings:true}),
      second:reportArgument(values.second,{access:'read',siblings:true}),device:values.device,torchLibrary:values['torch-library'],
      directory:values.directory,signal:controller.signal})));
  }catch(error){console.error('native-training-validation: '+error.message);process.exitCode=1;}
  finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
