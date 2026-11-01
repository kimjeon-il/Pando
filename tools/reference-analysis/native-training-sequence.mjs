// Execute a bounded, source-verified sequence of native macro training batches.
// This is an experimental checkpoint workflow, not model admission.
import {existsSync,mkdirSync,statfsSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual,parseArgs} from 'node:util';
import {withLibraryOutputs} from '../library-data.mjs';
import {reportArgument} from '../report-paths.mjs';
import {readTrainingBounded,trainingFileIdentity} from './training-evidence.mjs';
import {writeMacroTrainingOrder} from './training-order.mjs';
import {verifyMacroTrainingSupervision} from './training-supervision.mjs';
import {runMacroTrainingBatch} from './native-training-batch.mjs';
import {decideTrainingEpoch} from './training-progress.mjs';

const rootDefault=fileURLToPath(new URL('../../',import.meta.url));
export async function runMacroTrainingSequence({mode,input,output,corpus,supervision,epoch,seed,freezeEpochs,learningRate,
  device='cpu',amp=device==='cuda',torchLibrary,augment,batchSize,maxBatches,root=rootDefault,signal}={}){
  signal?.throwIfAborted();
  if(!['warm','resume'].includes(mode)||!input||!output||!corpus||!supervision||!torchLibrary||!['cpu','cuda'].includes(device)||
    typeof augment!=='boolean'||typeof amp!=='boolean'||(amp&&device!=='cuda')||
    ![epoch,seed,freezeEpochs].every(n=>Number.isSafeInteger(n)&&n>=0)||!Number.isFinite(learningRate)||learningRate<=0||learningRate>.01||
    !Number.isSafeInteger(batchSize)||batchSize<1||batchSize>16||!Number.isSafeInteger(maxBatches)||maxBatches<1||maxBatches>1000000)
    throw Error('Explicit bounded macro training configuration required');
  const target=resolve(output),initial=resolve(input);if(existsSync(target))throw Error('Training sequence output exists; preserve it');
  const inputHash=trainingFileIdentity(initial),checked=await verifyMacroTrainingSupervision({corpus,directory:supervision,signal});
  let cursor=0;
  if(mode==='warm'){
    if(epoch!==0)throw Error('Weights-only initialization starts at epoch zero');
    const transfer=JSON.parse(readTrainingBounded(join(dirname(initial),'transfer.json'),1024*1024));
    if(transfer.transfer!=='weights-only-no-optimizer'||transfer.weightsSha256!==inputHash||transfer.trainingOnly!==true||transfer.releaseApproved!==false)
      throw Error('Verified private weights-only initializer required');
  }else{
    const receipt=JSON.parse(readTrainingBounded(initial+'.receipt.json',1024*1024));
    if(receipt.checkpointSha256!==inputHash||receipt.trainingOnly!==true||receipt.releaseApproved!==false||receipt.corpusSha256!==checked.corpusSha256||
      !Number.isSafeInteger(receipt.cursor)||!Number.isSafeInteger(receipt.orderLength)||receipt.cursor<0||receipt.cursor>receipt.orderLength)
      throw Error('Matching training resume receipt required');
    if(receipt.epoch===epoch)cursor=receipt.cursor;
    else if(receipt.epoch+1!==epoch||receipt.cursor!==receipt.orderLength)throw Error('Resume checkpoint is not at the requested epoch');
  }
  return withLibraryOutputs({root,paths:[target]},async()=>{
    signal?.throwIfAborted();mkdirSync(target);
    const order=join(target,'order.u64');
    const plan=await writeMacroTrainingOrder({corpus,supervision,epoch,seed,output:order,torchLibrary,root,signal});
    if(cursor>=plan.length)throw Error('Training epoch is already complete; preserve its order');
    const batches=Math.min(maxBatches,Math.ceil((plan.length-cursor)/batchSize));
    const peak=batches*(256+32*batchSize)*1024*1024;
    if(peak>=1024**3){const space=statfsSync(target);if(Number(space.bavail)*Number(space.bsize)<peak+5*1024**3)
      throw Error('Insufficient space for batch checkpoints and 5 GiB headroom');}
    let current=initial,last=null,completed=0;
    while(cursor<plan.length&&completed<maxBatches){
      signal?.throwIfAborted();const count=Math.min(batchSize,plan.length-cursor),label=String(cursor+count).padStart(8,'0');
      const checkpoint=join(target,`checkpoint-${label}.pt`),sampleOutput=join(target,`samples-${label}`);
      last=await runMacroTrainingBatch({mode:completed===0?mode:'resume',input:current,output:checkpoint,corpus,supervision,order,epoch,seed,
        freezeEpochs,learningRate,device,amp,torchLibrary,count,sampleOutput,augment,root,signal});
      const receipt=JSON.parse(readTrainingBounded(checkpoint+'.receipt.json',1024*1024));
      if(receipt.cursor!==cursor+count||receipt.orderSha256!==plan.orderSha256||receipt.orderLength!==plan.length)
        throw Error('Training checkpoint cursor differs from the prepared order; preserve outputs');
      current=checkpoint;cursor=receipt.cursor;completed++;
    }
    const result={schemaVersion:1,trainingOnly:true,releaseApproved:false,independentEvaluation:false,lineageComplete:false,
      status:cursor===plan.length?'epoch-complete':'partial',epoch,cursor,orderLength:plan.length,batches:completed,
      checkpoint:current,checkpointSha256:last.checkpointSha256,orderSha256:plan.orderSha256};
    writeFileSync(join(target,'sequence.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});return result;
  });
}

// Multiple epochs remain provisional; training loss is not independent validation.
export async function runMacroTrainingCampaign({mode,input,output,corpus,supervision,previousCampaign,epoch,seed,freezeEpochs,learningRate,
  device='cpu',amp=device==='cuda',torchLibrary,augment,batchSize,maxBatches,epochs,root=rootDefault,signal}={}){
  signal?.throwIfAborted();
  if(!['warm','resume'].includes(mode)||!input||!output||!corpus||!supervision||!torchLibrary||!['cpu','cuda'].includes(device)||
    typeof augment!=='boolean'||typeof amp!=='boolean'||(amp&&device!=='cuda')||
    ![epoch,seed,freezeEpochs].every(n=>Number.isSafeInteger(n)&&n>=0)||!Number.isFinite(learningRate)||learningRate<=0||learningRate>.01||
    !Number.isSafeInteger(batchSize)||batchSize<1||batchSize>16||!Number.isSafeInteger(maxBatches)||maxBatches<1||maxBatches>1000000||
    !Number.isSafeInteger(epochs)||epochs<1||epochs>1000||epoch+epochs>Number.MAX_SAFE_INTEGER)
    throw Error('Explicit bounded training campaign configuration required');
  const target=resolve(output);if(existsSync(target))throw Error('Training campaign output exists; preserve it');
  const initial=resolve(input),inputHash=trainingFileIdentity(initial),corpusHash=trainingFileIdentity(resolve(corpus));
  const configuration={seed,freezeEpochs,learningRate,device,amp,augment,batchSize};let previous=null;
  if(previousCampaign!==undefined&&previousCampaign!==null){
    if(mode!=='resume'||typeof previousCampaign!=='string'||!previousCampaign)throw Error('Previous campaign requires explicit resume mode');
    previous=JSON.parse(readTrainingBounded(resolve(previousCampaign),8*1024*1024));
    if(previous.checkpointSha256!==inputHash||previous.corpusSha256!==corpusHash)throw Error('Previous campaign checkpoint or corpus differs');
    if(previous.schemaVersion!==1||previous.status!=='partial'||previous.trainingOnly!==true||previous.independentEvaluation!==false||
      previous.releaseApproved!==false||previous.lineageComplete!==false||previous.selectionMetric!=='trainingLoss'||
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
        decideTrainingEpoch(receipt,{patience:1}).trainingLoss!==row.trainingLoss)throw Error('Previous campaign epoch receipt differs');
    }
    if(completedRows.length){
      const best=completedRows.reduce((left,right)=>right.trainingLoss<left.trainingLoss?right:left);
      if(previous.bestCheckpoint!==best.checkpoint||previous.bestCheckpointSha256!==best.checkpointSha256||previous.bestScore!==best.trainingLoss||
        trainingFileIdentity(resolve(best.checkpoint))!==best.checkpointSha256)throw Error('Previous campaign best checkpoint differs');
    }else if(previous.bestCheckpoint!==null||previous.bestCheckpointSha256!==null||previous.bestScore!==null)
      throw Error('Previous campaign has no completed epoch to select');
  }
  withLibraryOutputs({root,paths:[target]},()=>{mkdirSync(dirname(target),{recursive:true});mkdirSync(target);});
  let current=initial,remaining=maxBatches,currentEpoch=epoch,completed=previous?.completedEpochs??0,
    bestScore=previous?.bestScore??null,bestCheckpoint=previous?.bestCheckpoint??null,bestCheckpointSha256=previous?.bestCheckpointSha256??null;
  const results=previous?[...previous.epochs]:[];
  while(completed<epochs&&remaining>0){
    signal?.throwIfAborted();const directory=join(target,`epoch-${String(currentEpoch).padStart(4,'0')}`);
    const result=await runMacroTrainingSequence({mode:results.length?'resume':mode,input:current,output:directory,corpus,supervision,
      epoch:currentEpoch,seed,freezeEpochs,learningRate,device,amp,torchLibrary,augment,batchSize,maxBatches:remaining,root,signal});
    remaining-=result.batches;current=result.checkpoint;
    const item={epoch:currentEpoch,status:result.status,cursor:result.cursor,orderLength:result.orderLength,batches:result.batches,
      checkpoint:result.checkpoint,checkpointSha256:result.checkpointSha256};
    if(result.status==='epoch-complete'){
      const receipt=JSON.parse(readTrainingBounded(current+'.receipt.json',1024*1024));
      if(receipt.checkpointSha256!==result.checkpointSha256||receipt.corpusSha256!==corpusHash)throw Error('Training epoch receipt differs');
      const decision=decideTrainingEpoch(receipt,{bestScore,patience:1});
      item.trainingLoss=decision.trainingLoss;if(decision.improved){bestScore=decision.bestScore;bestCheckpoint=current;bestCheckpointSha256=result.checkpointSha256;}
      completed++;currentEpoch++;
    }
    results.push(item);if(result.status!=='epoch-complete')break;
  }
  if(trainingFileIdentity(resolve(corpus))!==corpusHash)throw Error('Training corpus changed during campaign');
  const report={schemaVersion:1,status:completed===epochs?'complete':'partial',trainingOnly:true,independentEvaluation:false,
    releaseApproved:false,lineageComplete:false,selectionMetric:'trainingLoss',selectionScope:'campaign-completed-epochs',configuration,
    inputSha256:previous?.inputSha256??inputHash,corpusSha256:corpusHash,completedEpochs:completed,requestedEpochs:epochs,
    batches:(previous?.batches??0)+maxBatches-remaining,checkpoint:current,checkpointSha256:results.at(-1).checkpointSha256,
    bestCheckpoint,bestCheckpointSha256,bestScore,epochs:results};
  withLibraryOutputs({root,paths:[target]},()=>writeFileSync(join(target,'campaign.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'}));
  return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values,positionals}=parseArgs({allowPositionals:true,options:{mode:{type:'string'},input:{type:'string'},output:{type:'string'},
      corpus:{type:'string'},supervision:{type:'string'},epoch:{type:'string'},seed:{type:'string'},'freeze-epochs':{type:'string'},
      'learning-rate':{type:'string'},device:{type:'string'},precision:{type:'string'},'torch-library':{type:'string'},
      'batch-size':{type:'string'},'max-batches':{type:'string'},augment:{type:'boolean',default:false},
      campaign:{type:'boolean',default:false},epochs:{type:'string'},'previous-campaign':{type:'string'}}});
    const integer=name=>{if(!/^\d+$/.test(values[name]||''))throw Error('Explicit integer '+name+' required');return Number(values[name]);};
    if(positionals.length||!['fp32','amp-fp16'].includes(values.precision)||(!values.campaign&&(values.epochs!==undefined||values['previous-campaign']!==undefined)))
      throw Error('Explicit macro training sequence configuration required');
    const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
    try{const request={mode:values.mode,input:reportArgument(values.input,{access:'read'}),
      output:reportArgument(values.output,{access:'write'}),corpus:reportArgument(values.corpus,{access:'read',siblings:true}),
      supervision:reportArgument(values.supervision,{access:'read'}),epoch:integer('epoch'),seed:integer('seed'),freezeEpochs:integer('freeze-epochs'),
      learningRate:Number(values['learning-rate']),device:values.device,amp:values.precision==='amp-fp16',torchLibrary:values['torch-library'],
      batchSize:integer('batch-size'),maxBatches:integer('max-batches'),augment:values.augment,signal:controller.signal};
      console.log(JSON.stringify(await (values.campaign?runMacroTrainingCampaign({...request,epochs:integer('epochs'),
        previousCampaign:reportArgument(values['previous-campaign'],{access:'read'})}):runMacroTrainingSequence(request))));}
    finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
  }catch(error){console.error('native-training-sequence: '+error.message);process.exitCode=1;}
}
