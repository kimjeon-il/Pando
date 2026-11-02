// Evaluate a selected reviewed source with a native training checkpoint.
// One source is never an admission decision or a model release.
import {createHash} from 'node:crypto';
import {existsSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual,parseArgs} from 'node:util';
import {reportArgument} from '../report-paths.mjs';
import {assembleEvaluationPrediction,evaluateBoundaries,summarizeEvaluation} from './native-evaluation.mjs';
import {nativeTrainingCheckpointInfer,nativeTrainingWeightsInfer,verifyCheckpointReplayLineage} from './native-training-validation.mjs';
import {validateCorpusMetadata,validateReviewedCorpus} from './reviewed-corpus.mjs';
import {assertEvaluationIndependence} from './training-lineage.mjs';
import {corpusFingerprint,readTrainingBounded,trainingFileIdentity,verifyTrainingInitializer} from './training-evidence.mjs';
import {countAnnotationTrainingSupervision,prepareReviewedTrainingTile} from './training-tiles.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const channels=['international','administrative','coast','hydro','transport','text','frame'];
export function trainingCorpusIdentity({mode,receipt,replayedFingerprint=null}){
  if([replayedFingerprint,receipt.lineageFingerprint,receipt.trainingCorpusSha256].some(value=>value!=null&&!/^[a-f0-9]{64}$/.test(value)))
    throw Error('Invalid training corpus fingerprint');
  return {trainingCorpusSha256:replayedFingerprint??receipt.lineageFingerprint??(mode==='weights-only'?receipt.trainingCorpusSha256??null:null),
    trainingCorpusManifestSha256:receipt.corpusSha256??null};
}
export function finalizeReviewedEvaluation({groups,perSheet,confounders,baseline,requiredChannels,reviewScopes,independenceRows,diagnosticOnly}){
  if(!reviewScopes||typeof reviewScopes!=='object'||Array.isArray(reviewScopes)||!Object.keys(reviewScopes).length||
    !Array.isArray(independenceRows)||!independenceRows.length||independenceRows.some(row=>typeof row?.passed!=='boolean')||typeof diagnosticOnly!=='boolean')
    throw Error('Explicit reviewed evaluation scope and independence required');
  const summary=summarizeEvaluation({groups,perSheet,confounders,baseline,requiredChannels});
  const independence=independenceRows.every(row=>row.passed)?{passed:true}:{passed:false,reason:independenceRows.find(row=>!row.passed).reason};
  const complete=Object.values(reviewScopes).every(scope=>scope==='whole-readable-map'),admission=summary.admission;
  admission.passed=admission.passed&&summary.nonregression.passed&&independence.passed&&!diagnosticOnly&&complete;
  if(!complete)admission.failures.push({reason:'incomplete-source-map-review'});
  if(diagnosticOnly)admission.failures.push({reason:'diagnostic-baseline-is-not-qualification'});
  if(!summary.nonregression.passed)admission.failures.push({reason:'confounder-nonregression-not-passed'});
  return {...summary,admission,independence,reviewCoverage:{complete,sheets:reviewScopes}};
}
function evaluationModel({checkpoint,weights,device,diagnosticOnly}){
  if(Boolean(checkpoint)===Boolean(weights))throw Error('Choose one native checkpoint or transferred weights');
  const mode=weights?'weights-only':'checkpoint',path=resolve(weights||checkpoint),hash=trainingFileIdentity(path);
  const receiptPath=mode==='checkpoint'?path+'.receipt.json':resolve(dirname(path),'transfer.json');
  const receiptBytes=readTrainingBounded(receiptPath,1024*1024),receiptHash=sha(receiptBytes),receipt=JSON.parse(receiptBytes);
  if(mode==='checkpoint'){
    if(receipt.schemaVersion!==1||receipt.trainingOnly!==true||receipt.releaseApproved!==false||receipt.device!==device||receipt.checkpointSha256!==hash||
      !Number.isSafeInteger(receipt.optimizerUpdates)||receipt.optimizerUpdates<1||!/^[a-f0-9]{64}$/.test(receipt.corpusSha256||''))
      throw Error('Private checkpoint receipt differs from its file');
  }else{
    if(!diagnosticOnly)throw Error('Transferred weights require diagnostic-only evaluation');
    let verified;try{verified=verifyTrainingInitializer({path,expectedSha256:hash});}
    catch(error){throw Error('Transferred weights receipt differs from its file',{cause:error});}
    if(receipt.schemaVersion!==1||verified.recordHash!==receiptHash||
      (verified.initialization==='weights-only-no-optimizer'&&!/^[a-f0-9]{64}$/.test(verified.sourceCheckpointSha256||'')))
      throw Error('Transferred weights receipt differs from its file');
  }
  return {mode,path,hash,receiptPath,receiptHash,receipt,sourceCheckpointSha256:mode==='checkpoint'?hash:receipt.sourceCheckpointSha256??null};
}
async function replayedEvaluationLineage(model,lineageReplay,torchLibrary,signal){
  if(lineageReplay===undefined)return null;
  if(model.mode!=='checkpoint')throw Error('Native checkpoint required for replayed evaluation ancestry');
  return verifyCheckpointReplayLineage({checkpoint:model.path,checkpointSha256:model.hash,selectionCorpus:lineageReplay?.selectionCorpus,
    torchLibrary,lineageReplay,signal});
}
async function evaluateSource({checkpoint,weights,corpus,sourceId,device,torchLibrary,diagnosticOnly=false},
  {signal,workspace,imageDirectory,reviewDirectory,evaluationDirectory,batchDirectory}={},replayedLineage=null){
  signal?.throwIfAborted();
  if(!corpus||typeof sourceId!=='string'||!sourceId||!['cpu','cuda'].includes(device)||!torchLibrary||typeof diagnosticOnly!=='boolean')
    throw Error('Explicit reviewed evaluation source and native checkpoint required');
  const model=evaluationModel({checkpoint,weights,device,diagnosticOnly}),{receipt}=model,corpusPath=resolve(corpus),sourceRoot=dirname(corpusPath);
  const corpusBytes=readTrainingBounded(corpusPath,32*1024*1024),corpusHash=sha(corpusBytes),manifest=JSON.parse(corpusBytes);
  validateCorpusMetadata(manifest);const matches=manifest.sheets.filter(sheet=>sheet.id===sourceId&&sheet.split==='test');
  if(matches.length!==1)throw Error('Unique frozen final-test source required');
  let verified;await validateReviewedCorpus({...manifest,sheets:matches},sourceRoot,{signal,workspace,reviewDirectory,onVerified:value=>{verified=value;}});
  const {sheet,annotation,annotationPath,annotationSha256,imagePath}=verified;
  let independence={passed:false,reason:'incomplete-training-ancestry'};
  // A receipt is an input, not proof that its declared ancestry trained this model.
  const lineage=replayedLineage?.lineage??null;
  if(lineage){try{assertEvaluationIndependence(lineage,[sheet]);independence={passed:true};}
    catch(error){if(!diagnosticOnly)throw error;independence={passed:false,reason:error.message};}}
  else if(!diagnosticOnly)throw Error('Complete training ancestry is required for independent evaluation');
  const prediction=await assembleEvaluationPrediction({width:annotation.width,height:annotation.height,predictTile:async({x,y})=>{
    const index=Math.floor(y/448)*Math.ceil(annotation.width/448)+Math.floor(x/448);
    const tensors=await prepareReviewedTrainingTile({imagePath,sourceSha256:sheet.sha256,annotation,x,y,augment:false,epoch:0,index},
      {signal,workspace,imageDirectory,reviewDirectory});
    const common={tile:tensors.tile,overview:tensors.overview,position:tensors.position,device,torchLibrary,output:'probabilities',root:workspace,directory:batchDirectory,signal};
    const result=model.mode==='checkpoint'?await nativeTrainingCheckpointInfer({checkpoint:model.path,...common}):await nativeTrainingWeightsInfer({weights:model.path,...common});
    if((model.mode==='checkpoint'?result.checkpointSha256:result.weightsSha256)!==model.hash)throw Error('Evaluation model changed');
    return result.probabilities.subarray(0,3*512*512*4);
  }},{signal,workspace,directory:evaluationDirectory});
  const result=await evaluateBoundaries(prediction,annotation,{signal,workspace,directory:evaluationDirectory,reviewDirectory});
  const {origin,...review}=annotation,counts=await countAnnotationTrainingSupervision({annotation:{...review,lines:[],regions:[]}},{signal,workspace,imageDirectory,reviewDirectory});
  if(trainingFileIdentity(model.path)!==model.hash||trainingFileIdentity(model.receiptPath)!==model.receiptHash||trainingFileIdentity(corpusPath)!==corpusHash||
    trainingFileIdentity(annotationPath)!==annotationSha256||trainingFileIdentity(imagePath)!==sheet.sha256)throw Error('Evaluation inputs changed during execution');
  const coverage=Object.fromEntries(channels.map((name,index)=>[name,{knownPixels:counts[index][0],originalPixels:annotation.width*annotation.height}]));
  return {sheetId:sheet.id,...result,coverage,reviewCoverage:annotation.review?.coverage??'unspecified',reviewKind:annotation.review?.kind??null,independence,diagnosticOnly,
    checkpointSha256:model.sourceCheckpointSha256,modelSha256:model.hash,modelKind:model.mode,corpusManifestSha256:corpusHash,
    ...(model.mode==='weights-only'?{initialization:receipt.transfer}:{}),
    ...(replayedLineage?{trainingAncestry:'replayed-public-encoder'}:{}),trainingOnly:true,independentEvaluation:false,releaseApproved:false};
}
export async function evaluateReviewedCheckpointSource(request,options={}){
  const {lineageReplay,checkpoint,weights,device,diagnosticOnly=false,torchLibrary}=request;
  const lineage=lineageReplay===undefined?null:await replayedEvaluationLineage(evaluationModel({checkpoint,weights,device,diagnosticOnly}),lineageReplay,torchLibrary,options.signal);
  return evaluateSource(request,options,lineage);
}

export async function evaluateReviewedCheckpointCorpus({checkpoint,weights,corpus,output,baselineReport,device,torchLibrary,diagnosticOnly=false,lineageReplay},options={}){
  const {signal}=options;signal?.throwIfAborted();
  if(!corpus||!output||!['cpu','cuda'].includes(device)||!torchLibrary||typeof diagnosticOnly!=='boolean')
    throw Error('Explicit frozen evaluation corpus, output and native checkpoint required');
  const target=resolve(output);if(existsSync(target))throw Error('Evaluation output already exists; preserve the frozen evidence');
  const corpusPath=resolve(corpus),model=evaluationModel({checkpoint,weights,device,diagnosticOnly}),{receipt}=model;
  const corpusBytes=readTrainingBounded(corpusPath,32*1024*1024),corpusManifestSha256=sha(corpusBytes),manifest=JSON.parse(corpusBytes);
  validateCorpusMetadata(manifest);const sheets=manifest.sheets.filter(sheet=>sheet.split==='test');if(!sheets.length)throw Error('Frozen final-test originals required');
  const corpusSha256=await corpusFingerprint(corpusPath);
  if(model.mode==='checkpoint'&&(!Number.isInteger(receipt.unobservedMask)||receipt.unobservedMask<0||receipt.unobservedMask>127))throw Error('Checkpoint supervision channels are required');
  const baselinePath=baselineReport?resolve(baselineReport):null,baselineBytes=baselinePath?readTrainingBounded(baselinePath,64*1024*1024):null;
  const baseline=baselineBytes?JSON.parse(baselineBytes):null,baselineSha256=baselineBytes?sha(baselineBytes):null;
  if(baselineBytes&&(!baseline||typeof baseline!=='object'||Array.isArray(baseline)))throw Error('Explicit baseline report object required');
  const replayedLineage=await replayedEvaluationLineage(model,lineageReplay,torchLibrary,signal);
  const groups={},perSheet={},confounders={},coverage={},reviewScopes={},reviewKinds=new Set(),independenceRows=[];
  for(const sheet of sheets){signal?.throwIfAborted();
    const result=await evaluateSource({checkpoint,weights,corpus:corpusPath,sourceId:sheet.id,device,torchLibrary,diagnosticOnly},options,replayedLineage);
    if(result.modelSha256!==model.hash||result.corpusManifestSha256!==corpusManifestSha256)throw Error('Evaluation inputs differ across sources');
    const key=[sheet.mapKind,sheet.script,sheet.language].join('/');(groups[key]??=[]).push(result.counts);
    perSheet[sheet.id]=result.metrics;confounders[sheet.id]=result.confounders;coverage[sheet.id]=result.coverage;
    reviewScopes[sheet.id]=result.reviewCoverage;if(result.reviewKind)reviewKinds.add(result.reviewKind);independenceRows.push(result.independence);
  }
  if(baseline&&(baseline.corpusSha256!==corpusSha256||baseline.threshold!==.55||!isDeepStrictEqual(baseline.coverage,coverage)))
    throw Error('Baseline must use the exact frozen corpus, threshold and known-pixel scope');
  const summary=finalizeReviewedEvaluation({groups,perSheet,confounders,baseline,reviewScopes,independenceRows,diagnosticOnly,
    requiredChannels:channels.slice(0,3).filter((_,index)=>model.mode==='weights-only'||!(receipt.unobservedMask&(1<<index)))});
  if(trainingFileIdentity(model.path)!==model.hash||trainingFileIdentity(model.receiptPath)!==model.receiptHash||trainingFileIdentity(corpusPath)!==corpusManifestSha256||
    await corpusFingerprint(corpusPath)!==corpusSha256||
    baselinePath&&trainingFileIdentity(baselinePath)!==baselineSha256)throw Error('Evaluation inputs changed during execution');
  const report={schemaVersion:1,metric:'full-sheet-source-pixel-euclidean-tolerance',tolerance:'max(2px, half annotated original stroke width)',
    corpusSha256,corpusManifestSha256,...trainingCorpusIdentity({mode:model.mode,receipt,replayedFingerprint:replayedLineage?.trainingCorpusFingerprint}),
    trainingLineageFingerprint:receipt.lineageFingerprint??null,
    checkpointSha256:model.sourceCheckpointSha256,modelSha256:model.hash,modelKind:model.mode,unobservedChannelsKnown:model.mode==='checkpoint',
    ...(model.mode==='weights-only'?{initialization:receipt.transfer}:{}),...(replayedLineage?{trainingAncestry:'replayed-public-encoder'}:{}),
    reviewKinds:[...reviewKinds].sort(),trainingOnly:true,evaluationStatus:'pending',groups:summary.groups,sheets:perSheet,threshold:.55,diagnosticOnly,independence:summary.independence,
    confounders,coverage,nonregression:summary.nonregression,reviewCoverage:summary.reviewCoverage,baselineReportSha256:baselineSha256,admission:summary.admission,
    releaseApproved:false,pending:['independent georeference region evaluation','all script/map-family coverage','Windows WebView2 and Android offline performance']};
  signal?.throwIfAborted();writeFileSync(target,JSON.stringify(report,null,2),{flag:'wx'});return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{const {values,positionals}=parseArgs({allowPositionals:true,options:{checkpoint:{type:'string'},weights:{type:'string'},corpus:{type:'string'},output:{type:'string'},
      device:{type:'string'},'torch-library':{type:'string'},'diagnostic-only':{type:'boolean',default:false},'baseline-report':{type:'string'},
      'replay-checkpoint':{type:'string',multiple:true},'replay-weights':{type:'string'},'replay-corpus':{type:'string'},
      'replay-auxiliary':{type:'string'},'replay-supervision':{type:'string'},'replay-selection':{type:'string'},'replay-scratch':{type:'string'},
      'replay-reviewed':{type:'boolean',default:false},'replay-publisher':{type:'boolean',default:false}}});
    if(positionals.length||Boolean(values.checkpoint)===Boolean(values.weights)||!values.corpus||!values.output||!values.device||!values['torch-library'])
      throw Error('One checkpoint or weights plus corpus, output, device and torch library required');
    const hasReplay=Object.entries(values).some(([key,value])=>key.startsWith('replay-')&&Boolean(value));
    if(hasReplay&&(!values.checkpoint||!values['replay-checkpoint']?.length||!values['replay-weights']||!values['replay-corpus']||
      !values['replay-selection']||!values['replay-scratch']||Boolean(values['replay-supervision'])===Boolean(values['replay-auxiliary'])||
      (values['replay-reviewed']&&values['replay-publisher'])||(values['replay-auxiliary']&&(values['replay-reviewed']||values['replay-publisher']))))
      throw Error('Explicit replay configuration with checkpoint chain, sources and scratch required');
    const lineageReplay=hasReplay?{checkpoints:values['replay-checkpoint'].map(path=>reportArgument(path,{access:'read',siblings:true})),
      weights:reportArgument(values['replay-weights'],{access:'read',siblings:true}),corpus:reportArgument(values['replay-corpus'],{access:'read',siblings:true}),
      auxiliary:reportArgument(values['replay-auxiliary'],{access:'read',siblings:true}),supervision:reportArgument(values['replay-supervision'],{access:'read',siblings:true}),
      selectionCorpus:reportArgument(values['replay-selection'],{access:'read',siblings:true}),scratch:reportArgument(values['replay-scratch'],{access:'write'}),
      reviewed:values['replay-reviewed'],publisher:values['replay-publisher']}:undefined;
    const report=await evaluateReviewedCheckpointCorpus({checkpoint:reportArgument(values.checkpoint,{access:'read',siblings:true}),
      weights:reportArgument(values.weights,{access:'read',siblings:true}),
      corpus:reportArgument(values.corpus,{access:'read',siblings:true}),output:reportArgument(values.output,{access:'write'}),
      baselineReport:reportArgument(values['baseline-report'],{access:'read'}),device:values.device,torchLibrary:values['torch-library'],
      diagnosticOnly:values['diagnostic-only'],lineageReplay},{signal:controller.signal});
    console.log(JSON.stringify({output:values.output,sheets:Object.keys(report.sheets).length,independence:report.independence,
      diagnosticOnly:report.diagnosticOnly,releaseApproved:false}));
  }catch(error){console.error('native-evaluate-source: '+error.message);process.exitCode=1;}
  finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
