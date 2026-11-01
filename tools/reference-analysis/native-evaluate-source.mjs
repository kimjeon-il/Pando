// Evaluate a selected reviewed source with a native training checkpoint.
// One source is never an admission decision or a model release.
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {assembleEvaluationPrediction,evaluateBoundaries} from './native-evaluation.mjs';
import {nativeTrainingCheckpointInfer} from './native-training-validation.mjs';
import {validateCorpusMetadata,validateReviewedCorpus} from './reviewed-corpus.mjs';
import {assertEvaluationIndependence} from './training-lineage.mjs';
import {readTrainingBounded,trainingFileIdentity} from './training-evidence.mjs';
import {countAnnotationTrainingSupervision,prepareReviewedTrainingTile} from './training-tiles.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const channels=['international','administrative','coast','hydro','transport','text','frame'];
export async function evaluateReviewedCheckpointSource({checkpoint,corpus,sourceId,device,torchLibrary,diagnosticOnly=false},
  {signal,workspace,imageDirectory,reviewDirectory,evaluationDirectory,batchDirectory}={}){
  signal?.throwIfAborted();
  if(!checkpoint||!corpus||typeof sourceId!=='string'||!sourceId||!['cpu','cuda'].includes(device)||!torchLibrary||typeof diagnosticOnly!=='boolean')
    throw Error('Explicit reviewed evaluation source and native checkpoint required');
  const checkpointPath=resolve(checkpoint),receiptPath=checkpointPath+'.receipt.json',corpusPath=resolve(corpus),sourceRoot=dirname(corpusPath);
  const checkpointHash=trainingFileIdentity(checkpointPath),receiptBytes=readTrainingBounded(receiptPath,1024*1024),receiptHash=sha(receiptBytes),receipt=JSON.parse(receiptBytes);
  if(receipt.schemaVersion!==1||receipt.trainingOnly!==true||receipt.releaseApproved!==false||receipt.device!==device||receipt.checkpointSha256!==checkpointHash||
    !Number.isSafeInteger(receipt.optimizerUpdates)||receipt.optimizerUpdates<1)
    throw Error('Private checkpoint receipt differs from its file');
  const corpusBytes=readTrainingBounded(corpusPath,32*1024*1024),corpusHash=sha(corpusBytes),manifest=JSON.parse(corpusBytes);
  validateCorpusMetadata(manifest);const matches=manifest.sheets.filter(sheet=>sheet.id===sourceId&&sheet.split==='test');
  if(matches.length!==1)throw Error('Unique frozen final-test source required');
  let verified;await validateReviewedCorpus({...manifest,sheets:matches},sourceRoot,{signal,workspace,reviewDirectory,onVerified:value=>{verified=value;}});
  const {sheet,annotation,annotationPath,annotationSha256,imagePath}=verified;
  let independence={passed:false,reason:'incomplete-training-ancestry'};
  if(receipt.lineageComplete===true){try{assertEvaluationIndependence(receipt.lineage,[sheet]);independence={passed:true};}
    catch(error){if(!diagnosticOnly)throw error;independence={passed:false,reason:error.message};}}
  else if(!diagnosticOnly)throw Error('Complete training ancestry is required for independent evaluation');
  const prediction=await assembleEvaluationPrediction({width:annotation.width,height:annotation.height,predictTile:async({x,y})=>{
    const index=Math.floor(y/448)*Math.ceil(annotation.width/448)+Math.floor(x/448);
    const tensors=await prepareReviewedTrainingTile({imagePath,sourceSha256:sheet.sha256,annotation,x,y,augment:false,epoch:0,index},
      {signal,workspace,imageDirectory,reviewDirectory});
    const result=await nativeTrainingCheckpointInfer({checkpoint:checkpointPath,tile:tensors.tile,overview:tensors.overview,position:tensors.position,
      device,torchLibrary,output:'probabilities',root:workspace,directory:batchDirectory,signal});
    if(result.checkpointSha256!==checkpointHash)throw Error('Evaluation checkpoint changed');return result.probabilities.subarray(0,3*512*512*4);
  }},{signal,workspace,directory:evaluationDirectory});
  const result=await evaluateBoundaries(prediction,annotation,{signal,workspace,directory:evaluationDirectory,reviewDirectory});
  const {origin,...review}=annotation,counts=await countAnnotationTrainingSupervision({annotation:{...review,lines:[],regions:[]}},{signal,workspace,imageDirectory,reviewDirectory});
  if(trainingFileIdentity(checkpointPath)!==checkpointHash||trainingFileIdentity(receiptPath)!==receiptHash||trainingFileIdentity(corpusPath)!==corpusHash||
    trainingFileIdentity(annotationPath)!==annotationSha256||trainingFileIdentity(imagePath)!==sheet.sha256)throw Error('Evaluation inputs changed during execution');
  const coverage=Object.fromEntries(channels.map((name,index)=>[name,{knownPixels:counts[index][0],originalPixels:annotation.width*annotation.height}]));
  return {sheetId:sheet.id,...result,coverage,reviewCoverage:annotation.review?.coverage??'unspecified',independence,diagnosticOnly,
    checkpointSha256:checkpointHash,corpusSha256:corpusHash,trainingOnly:true,independentEvaluation:false,releaseApproved:false};
}
