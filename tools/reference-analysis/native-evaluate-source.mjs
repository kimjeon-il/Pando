// Evaluate a selected reviewed source with a native training checkpoint.
// One source is never an admission decision or a model release.
import {createHash} from 'node:crypto';
import {existsSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual,parseArgs} from 'node:util';
import {reportArgument} from '../report-paths.mjs';
import {assembleEvaluationPrediction,evaluateBoundaries,summarizeEvaluation} from './native-evaluation.mjs';
import {nativeTrainingCheckpointInfer} from './native-training-validation.mjs';
import {validateCorpusMetadata,validateReviewedCorpus} from './reviewed-corpus.mjs';
import {assertEvaluationIndependence} from './training-lineage.mjs';
import {corpusFingerprint,readTrainingBounded,trainingFileIdentity} from './training-evidence.mjs';
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
    !Number.isSafeInteger(receipt.optimizerUpdates)||receipt.optimizerUpdates<1||!/^[a-f0-9]{64}$/.test(receipt.corpusSha256||''))
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
  return {sheetId:sheet.id,...result,coverage,reviewCoverage:annotation.review?.coverage??'unspecified',reviewKind:annotation.review?.kind??null,independence,diagnosticOnly,
    checkpointSha256:checkpointHash,corpusManifestSha256:corpusHash,trainingOnly:true,independentEvaluation:false,releaseApproved:false};
}

export async function evaluateReviewedCheckpointCorpus({checkpoint,corpus,output,baselineReport,device,torchLibrary,diagnosticOnly=false},options={}){
  const {signal}=options;signal?.throwIfAborted();
  if(!checkpoint||!corpus||!output||!['cpu','cuda'].includes(device)||!torchLibrary||typeof diagnosticOnly!=='boolean')
    throw Error('Explicit frozen evaluation corpus, output and native checkpoint required');
  const target=resolve(output);if(existsSync(target))throw Error('Evaluation output already exists; preserve the frozen evidence');
  const corpusPath=resolve(corpus),checkpointPath=resolve(checkpoint),receiptPath=checkpointPath+'.receipt.json';
  const corpusBytes=readTrainingBounded(corpusPath,32*1024*1024),corpusManifestSha256=sha(corpusBytes),manifest=JSON.parse(corpusBytes);
  validateCorpusMetadata(manifest);const sheets=manifest.sheets.filter(sheet=>sheet.split==='test');if(!sheets.length)throw Error('Frozen final-test originals required');
  const corpusSha256=await corpusFingerprint(corpusPath);
  const checkpointSha256=trainingFileIdentity(checkpointPath),receiptBytes=readTrainingBounded(receiptPath,1024*1024),receiptSha256=sha(receiptBytes),receipt=JSON.parse(receiptBytes);
  if(!Number.isInteger(receipt.unobservedMask)||receipt.unobservedMask<0||receipt.unobservedMask>127)throw Error('Checkpoint supervision channels are required');
  const baselinePath=baselineReport?resolve(baselineReport):null,baselineBytes=baselinePath?readTrainingBounded(baselinePath,64*1024*1024):null;
  const baseline=baselineBytes?JSON.parse(baselineBytes):null,baselineSha256=baselineBytes?sha(baselineBytes):null;
  if(baselineBytes&&(!baseline||typeof baseline!=='object'||Array.isArray(baseline)))throw Error('Explicit baseline report object required');
  const groups={},perSheet={},confounders={},coverage={},reviewScopes={},reviewKinds=new Set(),independenceRows=[];
  for(const sheet of sheets){signal?.throwIfAborted();
    const result=await evaluateReviewedCheckpointSource({checkpoint:checkpointPath,corpus:corpusPath,sourceId:sheet.id,device,torchLibrary,diagnosticOnly},options);
    if(result.checkpointSha256!==checkpointSha256||result.corpusManifestSha256!==corpusManifestSha256)throw Error('Evaluation inputs differ across sources');
    const key=[sheet.mapKind,sheet.script,sheet.language].join('/');(groups[key]??=[]).push(result.counts);
    perSheet[sheet.id]=result.metrics;confounders[sheet.id]=result.confounders;coverage[sheet.id]=result.coverage;
    reviewScopes[sheet.id]=result.reviewCoverage;if(result.reviewKind)reviewKinds.add(result.reviewKind);independenceRows.push(result.independence);
  }
  if(baseline&&(baseline.corpusSha256!==corpusSha256||baseline.threshold!==.55||!isDeepStrictEqual(baseline.coverage,coverage)))
    throw Error('Baseline must use the exact frozen corpus, threshold and known-pixel scope');
  const summary=summarizeEvaluation({groups,perSheet,confounders,baseline,
    requiredChannels:channels.slice(0,3).filter((_,index)=>!(receipt.unobservedMask&(1<<index)))});
  const independence=independenceRows.every(row=>row.passed)?{passed:true}:{passed:false,reason:independenceRows.find(row=>!row.passed).reason};
  const complete=Object.values(reviewScopes).every(scope=>scope==='whole-readable-map'),admission=summary.admission;
  admission.passed=admission.passed&&summary.nonregression.passed&&independence.passed&&!diagnosticOnly&&complete;
  if(!complete)admission.failures.push({reason:'incomplete-source-map-review'});
  if(diagnosticOnly)admission.failures.push({reason:'diagnostic-baseline-is-not-qualification'});
  if(!summary.nonregression.passed)admission.failures.push({reason:'confounder-nonregression-not-passed'});
  if(trainingFileIdentity(checkpointPath)!==checkpointSha256||trainingFileIdentity(receiptPath)!==receiptSha256||trainingFileIdentity(corpusPath)!==corpusManifestSha256||
    await corpusFingerprint(corpusPath)!==corpusSha256||
    baselinePath&&trainingFileIdentity(baselinePath)!==baselineSha256)throw Error('Evaluation inputs changed during execution');
  const report={schemaVersion:1,metric:'full-sheet-source-pixel-euclidean-tolerance',tolerance:'max(2px, half annotated original stroke width)',
    corpusSha256,corpusManifestSha256,trainingCorpusSha256:receipt.lineageFingerprint??receipt.corpusSha256,trainingLineageFingerprint:receipt.lineageFingerprint??null,checkpointSha256,
    reviewKinds:[...reviewKinds].sort(),trainingOnly:true,evaluationStatus:'pending',groups:summary.groups,sheets:perSheet,threshold:.55,diagnosticOnly,independence,
    confounders,coverage,nonregression:summary.nonregression,reviewCoverage:{complete,sheets:reviewScopes},baselineReportSha256:baselineSha256,admission,
    releaseApproved:false,pending:['independent georeference region evaluation','all script/map-family coverage','Windows WebView2 and Android offline performance']};
  signal?.throwIfAborted();writeFileSync(target,JSON.stringify(report,null,2),{flag:'wx'});return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{const {values,positionals}=parseArgs({allowPositionals:true,options:{checkpoint:{type:'string'},corpus:{type:'string'},output:{type:'string'},
      device:{type:'string'},'torch-library':{type:'string'},'diagnostic-only':{type:'boolean',default:false},'baseline-report':{type:'string'}}});
    if(positionals.length||!values.checkpoint||!values.corpus||!values.output||!values.device||!values['torch-library'])
      throw Error('Explicit checkpoint, corpus, output, device and torch library required');
    const report=await evaluateReviewedCheckpointCorpus({checkpoint:reportArgument(values.checkpoint,{access:'read'}),
      corpus:reportArgument(values.corpus,{access:'read',siblings:true}),output:reportArgument(values.output,{access:'write'}),
      baselineReport:reportArgument(values['baseline-report'],{access:'read'}),device:values.device,torchLibrary:values['torch-library'],
      diagnosticOnly:values['diagnostic-only']},{signal:controller.signal});
    console.log(JSON.stringify({output:values.output,sheets:Object.keys(report.sheets).length,independence:report.independence,
      diagnosticOnly:report.diagnosticOnly,releaseApproved:false}));
  }catch(error){console.error('native-evaluate-source: '+error.message);process.exitCode=1;}
  finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
