// Execute a bounded, source-verified sequence of native training batches.
// This is an experimental checkpoint workflow, not model admission.
import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,renameSync,statfsSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual,parseArgs} from 'node:util';
import {withLibraryOutputs} from '../library-data.mjs';
import {reportArgument} from '../report-paths.mjs';
import {assertTrainingCorpusScope,corpusFingerprint,readTrainingBounded,trainingFileIdentity,verifyTrainingInitializer} from './training-evidence.mjs';
import {writeCombinedTrainingOrder,writeTrainingOrder} from './training-order.mjs';
import {verifyTrainingSupervision} from './training-supervision.mjs';
import {runCombinedTrainingBatch,runTrainingBatch} from './native-training-batch.mjs';
import {decideTrainingEpoch} from './training-progress.mjs';
import {nativeTrainingValidation} from './native-training-validation.mjs';
import {validateReviewedCorpus} from './reviewed-corpus.mjs';
import {assertEvaluationIndependence,buildTrainingLineage} from './training-lineage.mjs';

const rootDefault=fileURLToPath(new URL('../../',import.meta.url));
function validateScope({auxiliary,macroOnly,supervision,reviewed=false,publisher=false}){
  if(typeof reviewed!=='boolean'||typeof publisher!=='boolean'||(reviewed&&publisher)||((reviewed||publisher)&&(auxiliary||macroOnly===true))||
    (auxiliary ? macroOnly!==false||supervision!=null : !supervision||macroOnly===false))
    throw Error('Explicit training corpus scope and matching supervision required');
}
export async function runTrainingSequence({mode,input,output,corpus,auxiliary,macroOnly,supervision,reviewed=false,publisher=false,epoch,seed,freezeEpochs,learningRate,
  device='cpu',amp=device==='cuda',torchLibrary,augment,batchSize,maxBatches,onBatch,root=rootDefault,signal}={}){
  signal?.throwIfAborted();
  if(!['warm','resume'].includes(mode)||!input||!output||!corpus||!torchLibrary||!['cpu','cuda'].includes(device)||
    typeof augment!=='boolean'||typeof amp!=='boolean'||(amp&&device!=='cuda')||
    ![epoch,seed,freezeEpochs].every(n=>Number.isSafeInteger(n)&&n>=0)||!Number.isFinite(learningRate)||learningRate<=0||learningRate>.01||
    !Number.isSafeInteger(batchSize)||batchSize<1||batchSize>16||!Number.isSafeInteger(maxBatches)||maxBatches<1||maxBatches>1000000||
    (onBatch!==undefined&&typeof onBatch!=='function'))
    throw Error('Explicit bounded macro training configuration required');
  validateScope({auxiliary,macroOnly,supervision,reviewed,publisher});
  const target=resolve(output),initial=resolve(input);if(existsSync(target))throw Error('Training sequence output exists; preserve it');
  const inputHash=trainingFileIdentity(initial);if(auxiliary){assertTrainingCorpusScope(corpus);assertTrainingCorpusScope(auxiliary);}
  const checked=auxiliary?
    {corpusSha256:trainingFileIdentity(resolve(corpus)),auxiliarySha256:trainingFileIdentity(resolve(auxiliary)),lineageFingerprint:await corpusFingerprint(corpus,auxiliary)}:
    await verifyTrainingSupervision({corpus,directory:supervision,reviewed,publisher,signal});
  let cursor=0;
  if(mode==='warm'){
    if(epoch!==0)throw Error('Weights-only initialization starts at epoch zero');
    verifyTrainingInitializer({path:initial,expectedSha256:inputHash});
  }else{
    const receipt=JSON.parse(readTrainingBounded(initial+'.receipt.json',1024*1024));
    if(receipt.checkpointSha256!==inputHash||receipt.trainingOnly!==true||receipt.releaseApproved!==false||receipt.corpusSha256!==checked.corpusSha256||
      (auxiliary?(receipt.auxiliarySha256!==checked.auxiliarySha256||receipt.lineageFingerprint!==checked.lineageFingerprint):Boolean(receipt.auxiliarySha256))||
      !Number.isSafeInteger(receipt.cursor)||!Number.isSafeInteger(receipt.orderLength)||receipt.cursor<0||receipt.cursor>receipt.orderLength)
      throw Error('Matching training resume receipt required');
    if(receipt.epoch===epoch)cursor=receipt.cursor;
    else if(receipt.epoch+1!==epoch||receipt.cursor!==receipt.orderLength)throw Error('Resume checkpoint is not at the requested epoch');
  }
  return withLibraryOutputs({root,paths:[target]},async()=>{
    signal?.throwIfAborted();mkdirSync(target);
    const orderDirectory=join(target,'order'),order=auxiliary?join(orderDirectory,'order.u64'):join(target,'order.u64');
    const plan=auxiliary?await writeCombinedTrainingOrder({corpus,auxiliary,macroOnly,epoch,seed,output:orderDirectory,torchLibrary,root,signal}):
      await writeTrainingOrder({corpus,supervision,reviewed,publisher,epoch,seed,output:order,torchLibrary,root,signal});
    if(auxiliary&&plan.lineageFingerprint!==checked.lineageFingerprint)throw Error('Combined training sources changed before sequence');
    if(cursor>=plan.length)throw Error('Training epoch is already complete; preserve its order');
    const batches=Math.min(maxBatches,Math.ceil((plan.length-cursor)/batchSize));
    const peak=batches*(256+32*batchSize)*1024*1024;
    if(peak>=1024**3){const space=statfsSync(target);if(Number(space.bavail)*Number(space.bsize)<peak+5*1024**3)
      throw Error('Insufficient space for batch checkpoints and 5 GiB headroom');}
    let current=initial,last=null,completed=0;
    while(cursor<plan.length&&completed<maxBatches){
      signal?.throwIfAborted();const count=Math.min(batchSize,plan.length-cursor),label=String(cursor+count).padStart(8,'0');
      const checkpoint=join(target,`checkpoint-${label}.pt`),sampleOutput=join(target,`samples-${label}`);
      const resuming=completed>0||mode==='resume',parentHash=resuming?trainingFileIdentity(current):null,
        parentReceiptHash=resuming?trainingFileIdentity(current+'.receipt.json'):null;
      const common={mode:completed===0?mode:'resume',input:current,output:checkpoint,corpus,epoch,seed,
        freezeEpochs,learningRate,device,amp,torchLibrary,count,sampleOutput,augment,root,signal};
      last=auxiliary?await runCombinedTrainingBatch({...common,auxiliary,macroOnly,orderDirectory}):
        await runTrainingBatch({...common,supervision,order,reviewed,publisher});
      const receipt=JSON.parse(readTrainingBounded(checkpoint+'.receipt.json',1024*1024));
      if(receipt.cursor!==cursor+count||receipt.orderSha256!==plan.orderSha256||receipt.orderLength!==plan.length)
        throw Error('Training checkpoint cursor differs from the prepared order; preserve outputs');
      if(receipt.parentCheckpointSha256!==parentHash||receipt.parentReceiptSha256!==parentReceiptHash)
        throw Error('Training checkpoint parent identity differs; preserve outputs');
      if(receipt.batchSourceReplayVerified!==true||!Array.isArray(receipt.evidence)||receipt.evidence.length!==count)
        throw Error('Training checkpoint batch evidence differs; preserve outputs');
      current=checkpoint;cursor=receipt.cursor;completed++;
      if(onBatch)await onBatch({epoch,cursor,orderLength:plan.length,batches:completed,checkpoint:current,
        checkpointSha256:last.checkpointSha256,status:cursor===plan.length?'epoch-complete':'partial'});
    }
    const result={schemaVersion:1,trainingOnly:true,releaseApproved:false,independentEvaluation:false,lineageComplete:false,
      status:cursor===plan.length?'epoch-complete':'partial',epoch,cursor,orderLength:plan.length,batches:completed,
      checkpoint:current,checkpointSha256:last.checkpointSha256,orderSha256:plan.orderSha256};
    signal?.throwIfAborted();writeFileSync(join(target,'sequence.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});return result;
  });
}

// Multiple epochs remain provisional; training loss is not independent validation.
export async function runTrainingCampaign({mode,input,output,corpus,auxiliary,macroOnly,supervision,reviewed=false,publisher=false,validationCorpus,diagnosticOnly,patience,previousCampaign,epoch,seed,freezeEpochs,learningRate,
  device='cpu',amp=device==='cuda',torchLibrary,augment,batchSize,maxBatches,epochs,onProgress,root=rootDefault,signal}={}){
  signal?.throwIfAborted();
  if(!['warm','resume'].includes(mode)||!input||!output||!corpus||!torchLibrary||!['cpu','cuda'].includes(device)||
    typeof augment!=='boolean'||typeof amp!=='boolean'||(amp&&device!=='cuda')||
    ![epoch,seed,freezeEpochs].every(n=>Number.isSafeInteger(n)&&n>=0)||!Number.isFinite(learningRate)||learningRate<=0||learningRate>.01||
    !Number.isSafeInteger(batchSize)||batchSize<1||batchSize>16||!Number.isSafeInteger(maxBatches)||maxBatches<1||maxBatches>1000000||
    !Number.isSafeInteger(epochs)||epochs<1||epochs>1000||epoch+epochs>Number.MAX_SAFE_INTEGER||
    (onProgress!==undefined&&typeof onProgress!=='function'))
    throw Error('Explicit bounded training campaign configuration required');
  validateScope({auxiliary,macroOnly,supervision,reviewed,publisher});
  if(validationCorpus?(diagnosticOnly!==true||!Number.isSafeInteger(patience)||patience<1):
    (diagnosticOnly!==undefined||patience!==undefined))throw Error('Explicit diagnostic validation scope and positive patience required');
  const target=resolve(output);if(existsSync(target))throw Error('Training campaign output exists; preserve it');
  const initial=resolve(input),inputHash=trainingFileIdentity(initial),corpusHash=trainingFileIdentity(resolve(corpus));
  if(auxiliary){assertTrainingCorpusScope(corpus);assertTrainingCorpusScope(auxiliary);}
  const auxiliaryHash=auxiliary?trainingFileIdentity(resolve(auxiliary)):null;
  const lineageFingerprint=auxiliary?await corpusFingerprint(corpus,auxiliary):null;
  let validationHash=null,validationFingerprint=null;
  if(validationCorpus){
    const path=resolve(validationCorpus),manifest=JSON.parse(readTrainingBounded(path,32*1024*1024));
    if(!Array.isArray(manifest.sheets)||!manifest.sheets.length||manifest.sheets.some(row=>row.split!=='validation'))
      throw Error('Frozen validation-only sources required');
    await validateReviewedCorpus(manifest,dirname(path),{signal});
    const training=JSON.parse(readTrainingBounded(resolve(corpus),32*1024*1024));
    const extra=auxiliary?JSON.parse(readTrainingBounded(resolve(auxiliary),32*1024*1024)).sheets:[];
    if(!Array.isArray(training.sheets)||!Array.isArray(extra))throw Error('Training corpus sources required');
    assertEvaluationIndependence(buildTrainingLineage([...training.sheets,...extra]),manifest.sheets,{split:'validation'});
    validationHash=trainingFileIdentity(path);validationFingerprint=await corpusFingerprint(path);
  }
  const selectionMetric=validationCorpus?'validationLoss':'trainingLoss';
  const configuration={seed,freezeEpochs,learningRate,device,amp,augment,batchSize,
    ...(reviewed?{sourceScope:'reviewed'}:publisher?{sourceScope:'publisher'}:{}),
    ...(validationCorpus?{validationSha256:validationHash,validationFingerprint,diagnosticOnly,patience}:{})};let previous=null;
  if(previousCampaign!==undefined&&previousCampaign!==null){
    if(mode!=='resume'||typeof previousCampaign!=='string'||!previousCampaign)throw Error('Previous campaign requires explicit resume mode');
    previous=JSON.parse(readTrainingBounded(resolve(previousCampaign),8*1024*1024));
    if(previous.checkpointSha256!==inputHash||previous.corpusSha256!==corpusHash||
      (auxiliary?(previous.auxiliarySha256!==auxiliaryHash||previous.lineageFingerprint!==lineageFingerprint):Boolean(previous.auxiliarySha256)))
      throw Error('Previous campaign checkpoint or corpus differs');
    if(previous.schemaVersion!==1||previous.status!=='partial'||previous.trainingOnly!==true||previous.independentEvaluation!==false||
      previous.releaseApproved!==false||previous.lineageComplete!==false||previous.selectionMetric!==selectionMetric||
      previous.selectionScope!=='campaign-completed-epochs'||previous.requestedEpochs!==epochs||!isDeepStrictEqual(previous.configuration,configuration)||
      !Number.isSafeInteger(previous.completedEpochs)||previous.completedEpochs<0||previous.completedEpochs>=epochs||
      !Number.isSafeInteger(previous.batches)||previous.batches<1||!/^[a-f0-9]{64}$/.test(previous.inputSha256||'')||
      !Array.isArray(previous.epochs)||!previous.epochs.length)
      throw Error('Invalid previous training campaign history');
    let total=0;
    for(let i=0;i<previous.epochs.length;i++){
      const row=previous.epochs[i],before=previous.epochs[i-1];
      if(!row||!Number.isSafeInteger(row.epoch)||row.epoch<0||!['partial','epoch-complete'].includes(row.status)||
        !Number.isSafeInteger(row.cursor)||!Number.isSafeInteger(row.orderLength)||row.orderLength<1||row.cursor<1||row.cursor>row.orderLength||
        (row.status==='epoch-complete')!==(row.cursor===row.orderLength)||!Number.isSafeInteger(row.batches)||row.batches<1||
        typeof row.checkpoint!=='string'||!row.checkpoint||!/^[a-f0-9]{64}$/.test(row.checkpointSha256||'')||
        (before&&(row.epoch!==(before.status==='epoch-complete'?before.epoch+1:before.epoch)||
          (before.status==='partial'&&(row.cursor<=before.cursor||row.orderLength!==before.orderLength)))))
        throw Error('Invalid previous training campaign epoch order');
      total+=row.batches;
    }
    if(!Number.isSafeInteger(total)||total!==previous.batches)throw Error('Previous campaign batch count differs');
    const last=previous.epochs.at(-1),expectedEpoch=last.status==='epoch-complete'?last.epoch+1:last.epoch;
    if(!Number.isSafeInteger(last.epoch)||!['partial','epoch-complete'].includes(last.status)||last.checkpointSha256!==inputHash||epoch!==expectedEpoch)
      throw Error('Previous campaign cursor or epoch differs');
    const completedRows=previous.epochs.filter(row=>row.status==='epoch-complete');
    if(completedRows.length!==previous.completedEpochs||completedRows.some(row=>!Number.isFinite(row.trainingLoss)))
      throw Error('Invalid previous campaign epoch losses');
    for(const row of completedRows){
      const receipt=JSON.parse(readTrainingBounded(resolve(row.checkpoint)+'.receipt.json',1024*1024));
      if(receipt.checkpointSha256!==row.checkpointSha256||receipt.corpusSha256!==corpusHash||receipt.epoch!==row.epoch||
        (auxiliary?(receipt.auxiliarySha256!==auxiliaryHash||receipt.lineageFingerprint!==lineageFingerprint):Boolean(receipt.auxiliarySha256))||
        decideTrainingEpoch(receipt,{patience:1}).trainingLoss!==row.trainingLoss)throw Error('Previous campaign epoch receipt differs');
      if(validationCorpus){
        if(typeof row.validationReceipt!=='string'||!/^[a-f0-9]{64}$/.test(row.validationReceiptSha256||'')||
          trainingFileIdentity(resolve(row.validationReceipt))!==row.validationReceiptSha256)throw Error('Previous validation receipt differs');
        const proof=JSON.parse(readTrainingBounded(resolve(row.validationReceipt),1024*1024));
        if(proof.checkpointSha256!==row.checkpointSha256||proof.corpusSha256!==validationHash||proof.sourceFingerprint!==validationFingerprint||
          proof.diagnosticOnly!==true||proof.independence?.passed!==false||proof.validationLoss!==row.validationLoss)
          throw Error('Previous validation evidence differs');
      }
    }
    if(completedRows.length){
      const best=completedRows.reduce((left,right)=>right[selectionMetric]<left[selectionMetric]?right:left);
      if(previous.bestCheckpoint!==best.checkpoint||previous.bestCheckpointSha256!==best.checkpointSha256||previous.bestScore!==best[selectionMetric]||
        trainingFileIdentity(resolve(best.checkpoint))!==best.checkpointSha256)throw Error('Previous campaign best checkpoint differs');
    }else if(previous.bestCheckpoint!==null||previous.bestCheckpointSha256!==null||previous.bestScore!==null)
      throw Error('Previous campaign has no completed epoch to select');
  }
  withLibraryOutputs({root,paths:[target]},()=>{mkdirSync(dirname(target),{recursive:true});mkdirSync(target);});
  let current=initial,remaining=maxBatches,currentEpoch=epoch,completed=previous?.completedEpochs??0,
    bestScore=previous?.bestScore??null,bestCheckpoint=previous?.bestCheckpoint??null,bestCheckpointSha256=previous?.bestCheckpointSha256??null;
  const results=previous?[...previous.epochs]:[];let report=null,stale=0,stop=false;
  if(validationCorpus){let score=null;for(const row of results.filter(row=>row.status==='epoch-complete')){
    if(!Number.isFinite(row.validationLoss))throw Error('Previous validation loss required');
    if(score===null||row.validationLoss<score){score=row.validationLoss;stale=0;}else stale++;
  }if(previous&&previous.staleEpochs!==stale)throw Error('Previous validation patience state differs');}
  while(completed<epochs&&remaining>0&&!stop){
    signal?.throwIfAborted();const activeEpoch=currentEpoch,directory=join(target,`epoch-${String(activeEpoch).padStart(4,'0')}`);
    const progressPath=join(directory,'campaign.json');let written=null,segmentBatches=0;
    const result=await runTrainingSequence({mode:results.length?'resume':mode,input:current,output:directory,corpus,auxiliary,macroOnly,supervision,reviewed,publisher,
      epoch:activeEpoch,seed,freezeEpochs,learningRate,device,amp,torchLibrary,augment,batchSize,maxBatches:remaining,root,signal,
      onBatch:async event=>{
        if(event.epoch!==activeEpoch||event.batches!==segmentBatches+1||remaining<1)throw Error('Training campaign batch order differs');
        const receipt=JSON.parse(readTrainingBounded(event.checkpoint+'.receipt.json',1024*1024));
        if(receipt.checkpointSha256!==event.checkpointSha256||receipt.corpusSha256!==corpusHash||receipt.epoch!==activeEpoch||
          (auxiliary?(receipt.auxiliarySha256!==auxiliaryHash||receipt.lineageFingerprint!==lineageFingerprint):Boolean(receipt.auxiliarySha256))||
          receipt.cursor!==event.cursor||receipt.orderLength!==event.orderLength)throw Error('Training campaign batch receipt differs');
        remaining--;current=event.checkpoint;
        const item={epoch:activeEpoch,status:event.status,cursor:event.cursor,orderLength:event.orderLength,batches:event.batches,
          checkpoint:event.checkpoint,checkpointSha256:event.checkpointSha256};
        if(event.status==='epoch-complete'){
          let validationLoss=null;
          if(validationCorpus){
            const checked=await nativeTrainingValidation({checkpoint:current,corpus:validationCorpus,device,diagnosticOnly:true,torchLibrary,root,signal});
            if(checked.checkpointSha256!==event.checkpointSha256||checked.corpusSha256!==validationHash||checked.independence.passed!==false||
              await corpusFingerprint(validationCorpus)!==validationFingerprint)throw Error('Validation inputs changed during campaign');
            const proof={...checked,sourceFingerprint:validationFingerprint};item.validationReceipt=join(directory,'validation.json');
            writeFileSync(item.validationReceipt,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
            item.validationReceiptSha256=trainingFileIdentity(item.validationReceipt);item.validationLoss=validationLoss=checked.validationLoss;
          }
          const decision=decideTrainingEpoch(receipt,{validationLoss,bestScore,stale,patience:validationCorpus?patience:1});item.trainingLoss=decision.trainingLoss;
          stale=decision.stale;stop=decision.stop;
          if(decision.improved){bestScore=decision.bestScore;bestCheckpoint=current;bestCheckpointSha256=event.checkpointSha256;}
          completed++;currentEpoch++;
        }
        if(segmentBatches===0)results.push(item);else results[results.length-1]=item;segmentBatches++;
        report={schemaVersion:1,status:completed===epochs?'complete':stop?'early-stop':'partial',trainingOnly:true,independentEvaluation:false,
          releaseApproved:false,lineageComplete:false,selectionMetric,selectionScope:'campaign-completed-epochs',configuration,
          ...(validationCorpus?{staleEpochs:stale}:{}),
          inputSha256:previous?.inputSha256??inputHash,corpusSha256:corpusHash,...(auxiliary?{auxiliarySha256:auxiliaryHash,lineageFingerprint}:{}),completedEpochs:completed,requestedEpochs:epochs,
          batches:(previous?.batches??0)+maxBatches-remaining,checkpoint:current,checkpointSha256:event.checkpointSha256,
          bestCheckpoint,bestCheckpointSha256,bestScore,epochs:results};
        const text=JSON.stringify(report,null,2)+'\n';
        if(written===null)writeFileSync(progressPath,text,{flag:'wx'});
        else{
          if(readTrainingBounded(progressPath,8*1024*1024).toString('utf8')!==written)throw Error('Training campaign progress changed');
          const temporary=progressPath+'.'+randomUUID()+'.tmp';let created=false;
          try{writeFileSync(temporary,text,{flag:'wx'});created=true;renameSync(temporary,progressPath);created=false;}
          finally{if(created)unlinkSync(temporary);}
        }
        written=text;if(onProgress)await onProgress(structuredClone(report),progressPath);
      }});
    signal?.throwIfAborted();
    if(!report||result.batches!==segmentBatches||result.checkpointSha256!==report.checkpointSha256)throw Error('Training campaign sequence differs');
    if(result.status!=='epoch-complete')break;
  }
  if(trainingFileIdentity(resolve(corpus))!==corpusHash||(auxiliary&&(trainingFileIdentity(resolve(auxiliary))!==auxiliaryHash||
    await corpusFingerprint(corpus,auxiliary)!==lineageFingerprint)))throw Error('Training corpus changed during campaign');
  if(validationCorpus&&(trainingFileIdentity(resolve(validationCorpus))!==validationHash||await corpusFingerprint(validationCorpus)!==validationFingerprint))
    throw Error('Validation corpus changed during campaign');
  withLibraryOutputs({root,paths:[target]},()=>writeFileSync(join(target,'campaign.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'}));
  return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values,positionals}=parseArgs({allowPositionals:true,options:{mode:{type:'string'},input:{type:'string'},output:{type:'string'},
      corpus:{type:'string'},auxiliary:{type:'string'},supervision:{type:'string'},reviewed:{type:'boolean',default:false},publisher:{type:'boolean',default:false},'allow-nonmacro-auxiliary':{type:'boolean',default:false},epoch:{type:'string'},seed:{type:'string'},'freeze-epochs':{type:'string'},
      'learning-rate':{type:'string'},device:{type:'string'},precision:{type:'string'},'torch-library':{type:'string'},
      'batch-size':{type:'string'},'max-batches':{type:'string'},augment:{type:'boolean',default:false},
      campaign:{type:'boolean',default:false},epochs:{type:'string'},'previous-campaign':{type:'string'},
      'validation-corpus':{type:'string'},'diagnostic-validation':{type:'boolean',default:false},patience:{type:'string'}}});
    const integer=name=>{if(!/^\d+$/.test(values[name]||''))throw Error('Explicit integer '+name+' required');return Number(values[name]);};
    if(positionals.length||!['fp32','amp-fp16'].includes(values.precision)||(!values.campaign&&(values.epochs!==undefined||values['previous-campaign']!==undefined||
      values['validation-corpus']!==undefined||values['diagnostic-validation']||values.patience!==undefined)))
      throw Error('Explicit macro training sequence configuration required');
    const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
    try{const request={mode:values.mode,input:reportArgument(values.input,{access:'read'}),
      output:reportArgument(values.output,{access:'write'}),corpus:reportArgument(values.corpus,{access:'read',siblings:true}),
      auxiliary:reportArgument(values.auxiliary,{access:'read',siblings:true}),macroOnly:values['allow-nonmacro-auxiliary']?false:undefined,reviewed:values.reviewed,publisher:values.publisher,
      supervision:reportArgument(values.supervision,{access:'read'}),epoch:integer('epoch'),seed:integer('seed'),freezeEpochs:integer('freeze-epochs'),
      learningRate:Number(values['learning-rate']),device:values.device,amp:values.precision==='amp-fp16',torchLibrary:values['torch-library'],
      batchSize:integer('batch-size'),maxBatches:integer('max-batches'),augment:values.augment,signal:controller.signal};
      console.log(JSON.stringify(await (values.campaign?runTrainingCampaign({...request,epochs:integer('epochs'),
        validationCorpus:reportArgument(values['validation-corpus'],{access:'read',siblings:true}),
        diagnosticOnly:values['diagnostic-validation']?true:undefined,patience:values.patience!==undefined?integer('patience'):undefined,
        previousCampaign:reportArgument(values['previous-campaign'],{access:'read'})}):runTrainingSequence(request))));}
    finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
  }catch(error){console.error('native-training-sequence: '+error.message);process.exitCode=1;}
}
