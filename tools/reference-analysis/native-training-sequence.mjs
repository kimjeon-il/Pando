// Execute a bounded, source-verified sequence of native macro training batches.
// This is an experimental checkpoint workflow, not model admission.
import {existsSync,mkdirSync,statfsSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {withLibraryOutputs} from '../library-data.mjs';
import {reportArgument} from '../report-paths.mjs';
import {readTrainingBounded,trainingFileIdentity} from './training-evidence.mjs';
import {writeMacroTrainingOrder} from './training-order.mjs';
import {verifyMacroTrainingSupervision} from './training-supervision.mjs';
import {runMacroTrainingBatch} from './native-training-batch.mjs';

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
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values,positionals}=parseArgs({allowPositionals:true,options:{mode:{type:'string'},input:{type:'string'},output:{type:'string'},
      corpus:{type:'string'},supervision:{type:'string'},epoch:{type:'string'},seed:{type:'string'},'freeze-epochs':{type:'string'},
      'learning-rate':{type:'string'},device:{type:'string'},precision:{type:'string'},'torch-library':{type:'string'},
      'batch-size':{type:'string'},'max-batches':{type:'string'},augment:{type:'boolean',default:false}}});
    const integer=name=>{if(!/^\d+$/.test(values[name]||''))throw Error('Explicit integer '+name+' required');return Number(values[name]);};
    if(positionals.length||!['fp32','amp-fp16'].includes(values.precision))throw Error('Explicit macro training sequence configuration required');
    const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
    try{console.log(JSON.stringify(await runMacroTrainingSequence({mode:values.mode,input:reportArgument(values.input,{access:'read'}),
      output:reportArgument(values.output,{access:'write'}),corpus:reportArgument(values.corpus,{access:'read',siblings:true}),
      supervision:reportArgument(values.supervision,{access:'read'}),epoch:integer('epoch'),seed:integer('seed'),freezeEpochs:integer('freeze-epochs'),
      learningRate:Number(values['learning-rate']),device:values.device,amp:values.precision==='amp-fp16',torchLibrary:values['torch-library'],
      batchSize:integer('batch-size'),maxBatches:integer('max-batches'),augment:values.augment,signal:controller.signal})));}
    finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
  }catch(error){console.error('native-training-sequence: '+error.message);process.exitCode=1;}
}
