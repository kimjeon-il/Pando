// Private, source-bound experimental batch execution. This does not admit a
// model or replace the training CLI until all dataset validation is migrated.
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,statSync,writeFileSync} from 'node:fs';
import {basename,delimiter,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {verifyNativeTool} from '../native-tool.mjs';
import {verifiedMacroTrainingSource,recheckMacroTrainingSource} from './macro-training-source.mjs';
import {matchingTorchLibrary,referenceBatchSourceFiles} from './native-infer.mjs';
import {prepareRasterTrainingTile} from './training-tiles.mjs';
import {TRAINING_TENSOR_NAMES,trainingSha256,verifyTrainingSample,prepareMacroTrainingBatch,prepareCombinedTrainingBatch} from './training-sample.mjs';
import {accumulateEpochLoss} from './training-progress.mjs';
import {verifyCombinedTrainingOrder,verifyMacroTrainingOrder} from './training-order.mjs';
import {corpusFingerprint,readTrainingBounded as readBounded,trainingFileIdentity as identity} from './training-evidence.mjs';
import {resolveCorpusPath} from './corpus-path.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function readOrder(path){const bytes=readBounded(path,8000000);if(!bytes.length||bytes.length%8)throw Error('Invalid bounded training order');
  const order=[];for(let at=0;at<bytes.length;at+=8){const n=bytes.readBigUInt64LE(at);if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Invalid training order index');order.push(Number(n));}
  return {order,hash:sha(bytes)};
}
function positiveWeight(path){if(!path)return {argument:'none',hash:null};const bytes=readBounded(path,28);
  if(bytes.length!==28||Array.from({length:7},(_,i)=>bytes.readFloatLE(i*4)).some(v=>!Number.isFinite(v)||v<1||v>64))throw Error('Positive weights must contain seven values in 1..64');
  return {argument:resolve(path),hash:sha(bytes)};
}
function trainingStart({mode,inputPath,inputHash,epoch,seed,freezeEpochs,learningRate,device,precision,unobservedMask,weights,orderData}){
  if(mode==='warm'){
    if(epoch!==0)throw Error('A weights-only warm start begins at epoch zero');
    const transfer=JSON.parse(readBounded(join(dirname(inputPath),'transfer.json'),1024*1024).toString('utf8'));
    if(transfer.trainingOnly!==true||transfer.evaluationStatus!=='pending'||transfer.releaseApproved!==false||transfer.transfer!=='weights-only-no-optimizer'||transfer.weightsSha256!==inputHash)
      throw Error('Verified private weights-only warm start required');
    return {previous:null,cursor:0};
  }
  const previous=JSON.parse(readBounded(inputPath+'.receipt.json',1024*1024).toString('utf8'));
  if(previous.schemaVersion!==1||previous.trainingOnly!==true||previous.releaseApproved!==false||previous.lineageComplete!==false||
    previous.checkpointSha256!==inputHash||previous.device!==device||previous.precision!==precision||previous.seed!==seed||previous.freezeEpochs!==freezeEpochs||
    previous.learningRate!==learningRate||previous.unobservedMask!==unobservedMask||previous.positiveWeightSha256!==weights.hash)throw Error('Checkpoint receipt or training configuration differs');
  if(epoch===previous.epoch){if(previous.orderSha256!==orderData.hash||previous.orderLength!==orderData.order.length)throw Error('Training order differs from checkpoint receipt');
    return {previous,cursor:previous.cursor};}
  if(epoch===previous.epoch+1&&previous.cursor===previous.orderLength)return {previous,cursor:0};
  throw Error('Checkpoint is not at the requested epoch boundary');
}
async function verifyEvidence(root,corpus,sample,data,{epoch,signal}){
  const {sheet,annotation,annotationSha256,checks}=await verifiedMacroTrainingSource(root,corpus,data.sourceId);
  if(data.sourceKind!=='macro-pdf'||data.augmentationIndex!==data.tileIndex||sheet.sha256!==data.imageSha256||annotationSha256!==data.annotationSha256||annotation.sourceSha256!==data.sourceEvidenceSha256||
    annotation.raster.sha256!==data.maskSha256||annotation.validRaster.sha256!==data.validMaskSha256)
    throw Error('Source-derived macro training evidence differs');
  if(!Array.isArray(data.pixelOrigin)||data.pixelOrigin.length!==2||data.pixelOrigin.some(v=>!Number.isInteger(v)||v<0)||typeof sample.augment!=='boolean')
    throw Error('Training sample position and augmentation must be explicit');
  const [x,y]=data.pixelOrigin,rebuilt=await prepareRasterTrainingTile({root,imagePath:sheet.image,sourceSha256:sheet.sha256,annotation,x,y,
    augment:sample.augment,epoch,index:data.tileIndex},{signal});
  for(const name of TRAINING_TENSOR_NAMES)if(trainingSha256(rebuilt[name])!==data.tensorSha256[name])throw Error('Training tensor differs from source: '+name);
  return {record:{sourceId:data.sourceId,sourceKind:data.sourceKind,imageSha256:data.imageSha256,annotationSha256:data.annotationSha256,sourceEvidenceSha256:data.sourceEvidenceSha256,
    tileIndex:data.tileIndex,pixelOrigin:data.pixelOrigin,augment:sample.augment},checks};
}
async function verifyCombinedEvidence(primaryRoot,manifest,auxiliaryRoot,plan,sample,data,{epoch,signal}){
  const tile=plan.datasets.flat()[sample.index];
  if(!tile||tile.index!==sample.index||data.sourceId!==tile.sourceId||data.augmentationIndex!==tile.localIndex||
    !Array.isArray(data.pixelOrigin)||data.pixelOrigin[0]!==tile.x||data.pixelOrigin[1]!==tile.y)
    throw Error('Combined source sample differs from its indexed tile');
  if(tile.index<plan.datasets[0].length)return verifyEvidence(primaryRoot,manifest,sample,data,{epoch,signal});
  const source=plan.auxiliarySources.find(row=>row.sheet.id===tile.sourceId);
  if(!source||data.sourceKind!=='semap-label'||typeof sample.augment!=='boolean')throw Error('Verified Semap sample required');
  const {sheet,annotation,checks}=source,labelName=basename(annotation.originalImageMember,'.jpg')+'.png';
  const label=annotation.sourceFiles.find(file=>basename(file.path)===labelName);
  const annotationHash=identity(await resolveCorpusPath(auxiliaryRoot,sheet.annotations));
  if(!label||label.sha256!==data.sourceEvidenceSha256||sheet.sha256!==data.imageSha256||annotationHash!==data.annotationSha256||
    annotation.raster.sha256!==data.maskSha256||annotation.validRaster.sha256!==data.validMaskSha256)throw Error('Semap sample source evidence differs');
  const rebuilt=await prepareRasterTrainingTile({root:auxiliaryRoot,imagePath:sheet.image,sourceSha256:sheet.sha256,annotation,x:tile.x,y:tile.y,
    augment:sample.augment,epoch,index:tile.localIndex},{signal});
  for(const name of TRAINING_TENSOR_NAMES)if(trainingSha256(rebuilt[name])!==data.tensorSha256[name])throw Error('Training tensor differs from source: '+name);
  return {record:{sourceId:data.sourceId,sourceKind:data.sourceKind,imageSha256:data.imageSha256,annotationSha256:data.annotationSha256,
    sourceEvidenceSha256:data.sourceEvidenceSha256,tileIndex:data.tileIndex,augmentationIndex:data.augmentationIndex,pixelOrigin:data.pixelOrigin,augment:sample.augment},checks};
}
export async function nativeTrainingBatch({mode,input,output,corpus,auxiliary,orderDirectory,macroOnly,verifyEvidence:verifySourceEvidence,order,epoch,seed,freezeEpochs,learningRate,positiveWeights,unobservedMask,
  samples,device='cpu',amp=device==='cuda',torchLibrary,root=defaultRoot,directory=resolve(root,'build-native/reference-analysis/training-batch'),signal}){
  signal?.throwIfAborted();
  if(!['win32','linux'].includes(process.platform)||!['warm','resume'].includes(mode)||!input||!output||!corpus||!order||!torchLibrary||!['cpu','cuda'].includes(device)||
    ![epoch,seed,freezeEpochs].every(v=>Number.isSafeInteger(v)&&v>=0)||!Number.isFinite(learningRate)||learningRate<=0||learningRate>.01||
    typeof amp!=='boolean'||(amp&&device!=='cuda')||!Number.isInteger(unobservedMask)||unobservedMask<0||unobservedMask>127||
    !Array.isArray(samples)||samples.length<1||samples.length>16)throw Error('Explicit native training batch inputs and configuration required');
  const precision=amp?'amp-fp16':'fp32';
  const target=resolve(output),receiptPath=target+'.receipt.json';if(existsSync(target)||existsSync(receiptPath))throw Error('Checkpoint or receipt already exists; preserve existing output');
  const inputPath=resolve(input),inputHash=identity(inputPath),orderData=readOrder(resolve(order)),weights=positiveWeight(positiveWeights);
  const {previous,cursor}=trainingStart({mode,inputPath,inputHash,epoch,seed,freezeEpochs,learningRate,device,precision,unobservedMask,weights,orderData});
  if(!Number.isSafeInteger(cursor)||cursor<0||cursor+samples.length>orderData.order.length)throw Error('Training cursor exceeds sample order');
  const checked=samples.map((sample,i)=>{if(!sample||!Number.isSafeInteger(sample.index)||sample.index!==orderData.order[cursor+i]||!sample.directory)
    throw Error('Training samples differ from the saved order');const data=verifyTrainingSample(sample.directory);
    if(data.tileIndex!==sample.index)throw Error('Training sample index differs from its tensor receipt');return data;});
  const corpusPath=resolve(corpus),corpusBytes=readBounded(corpusPath,32*1024*1024),corpusHash=sha(corpusBytes),manifest=JSON.parse(corpusBytes);
  if(manifest.schemaVersion!==1||manifest.trainingOnly!==true||!Array.isArray(manifest.sheets))throw Error('Explicit private training-only corpus required');
  if(previous&&previous.corpusSha256!==corpusHash)throw Error('Training corpus differs from checkpoint receipt');
  const combined=auxiliary?await verifyCombinedTrainingOrder({corpus,auxiliary,orderDirectory,macroOnly,epoch,seed,signal,verifyEvidence:verifySourceEvidence}):null;
  if(!auxiliary&&orderDirectory)throw Error('Auxiliary corpus required for combined training order');
  const auxiliaryHash=combined?sha(readBounded(resolve(auxiliary),32*1024*1024)):null;
  if(combined&&(resolve(order)!==resolve(orderDirectory,'order.u64')||resolve(positiveWeights||'')!==resolve(orderDirectory,'weights.f32')||
    combined.orderSha256!==orderData.hash||combined.weightsSha256!==weights.hash||combined.unobservedMask!==unobservedMask))
    throw Error('Combined training configuration differs from the verified order');
  if(previous&&(combined?(previous.auxiliarySha256!==auxiliaryHash||previous.lineageFingerprint!==combined.lineageFingerprint):Boolean(previous.auxiliarySha256)))
    throw Error('Training corpus scope differs from checkpoint receipt');
  const sourceRoot=dirname(corpusPath),evidence=[];
  for(let i=0;i<samples.length;i++)evidence.push(combined?
    await verifyCombinedEvidence(sourceRoot,manifest,dirname(resolve(auxiliary)),combined,samples[i],checked[i],{epoch,signal}):
    await verifyEvidence(sourceRoot,manifest,samples[i],checked[i],{epoch,signal}));
  const ampScale=amp?(previous?previous.ampScale:65536):1,ampGrowth=amp?(previous?previous.ampGrowthTracker:0):0;
  if(!Number.isFinite(ampScale)||ampScale<=0||!Number.isInteger(ampGrowth)||ampGrowth<0||ampGrowth>=2000)throw Error('Checkpoint AMP state is invalid');
  const executable=process.platform==='win32'?'pando-reference-training-batch.exe':'pando-reference-training-batch';
  const {binary,manifest:tool}=verifyNativeTool({root,directory,target:'reference-training-batch',executable,sourceFiles:referenceBatchSourceFiles});
  const library=matchingTorchLibrary(torchLibrary,tool),args=[device,mode,inputPath,target,String(epoch),String(seed),String(freezeEpochs),String(learningRate),resolve(order),weights.argument,precision,String(ampScale),String(ampGrowth),String(unobservedMask)];
  for(const sample of samples)args.push(String(sample.index),resolve(sample.directory));
  const stdout=await new Promise((ok,fail)=>execFile(binary,args,{encoding:'utf8',windowsHide:true,maxBuffer:1024**2,timeout:300000,signal,
    env:{...process.env,...(process.platform==='win32'?{PATH:library+delimiter+process.env.PATH}:{LD_LIBRARY_PATH:library+delimiter+(process.env.LD_LIBRARY_PATH||'')}),CUBLAS_WORKSPACE_CONFIG:':4096:8'}},
    (error,text,stderr)=>error?fail(new Error('Native training batch failed: '+error.message+' '+stderr,{cause:error})):ok(text)));
  signal?.throwIfAborted();const result=JSON.parse(stdout),info=statSync(target);
  if(result.trainingOnly!==true||result.releaseApproved!==false||result.precision!==precision||result.epoch!==epoch||result.cursor!==cursor+samples.length||
    result.batch!==samples.length||!Number.isFinite(result.loss)||typeof result.applied!=='boolean'||result.checkpointBytes!==info.size||
    (amp&&(!Number.isFinite(result.ampScale)||result.ampScale<=0||!Number.isInteger(result.ampGrowthTracker)||result.ampGrowthTracker<0||result.ampGrowthTracker>=2000))||
    (!amp&&(result.ampScale!==null||result.ampGrowthTracker!==null||result.applied!==true)))throw Error('Native training batch returned an invalid result; preserve its checkpoint');
  if(identity(inputPath)!==inputHash||sha(readBounded(corpusPath,32*1024*1024))!==corpusHash||readOrder(resolve(order)).hash!==orderData.hash||positiveWeight(positiveWeights).hash!==weights.hash)
    throw Error('Training inputs changed during execution; preserve its checkpoint');
  if(combined&&(sha(readBounded(resolve(auxiliary),32*1024*1024))!==auxiliaryHash||await corpusFingerprint(corpus,auxiliary)!==combined.lineageFingerprint))
    throw Error('Combined training sources changed during execution; preserve its checkpoint');
  for(const sample of samples)verifyTrainingSample(sample.directory);
  for(const item of evidence)recheckMacroTrainingSource(item.checks);
  const count=(key,increment)=>previous?(Number.isSafeInteger(previous[key])?previous[key]+increment:null):increment;
  const receipt={schemaVersion:1,trainingOnly:true,releaseApproved:false,lineageComplete:false,sourceReplayVerified:false,precision,
    initialization:previous?previous.initialization:'weights-only-no-optimizer',device,corpusSha256:corpusHash,
    ...(combined?{auxiliarySha256:auxiliaryHash,lineageFingerprint:combined.lineageFingerprint}:{}),epoch,cursor:result.cursor,
    orderSha256:orderData.hash,orderLength:orderData.order.length,seed,freezeEpochs,learningRate,unobservedMask,positiveWeightSha256:weights.hash,
    ampScale:result.ampScale,ampGrowthTracker:result.ampGrowthTracker,attemptedBatches:count('attemptedBatches',1),
    optimizerUpdates:count('optimizerUpdates',result.applied?1:0),skippedUpdates:count('skippedUpdates',result.applied?0:1),
    ...accumulateEpochLoss(previous,epoch,result.loss),checkpointSha256:identity(target),checkpointBytes:info.size,toolRevision:tool.revision,evidence:evidence.map(item=>item.record)};
  writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return {...result,receiptPath,checkpointSha256:receipt.checkpointSha256,lineageComplete:false};
}

// Select and reconstruct one batch directly from two validated source corpora.
export async function runCombinedTrainingBatch({count,sampleOutput,augment,...options}){
  const {mode,input,output,corpus,auxiliary,orderDirectory,macroOnly,epoch,seed,freezeEpochs,learningRate,
    device='cpu',amp=device==='cuda',signal,verifyEvidence}=options;
  signal?.throwIfAborted();
  if(!['warm','resume'].includes(mode)||!input||!output||!corpus||!auxiliary||!orderDirectory||!sampleOutput||!options.torchLibrary||
    typeof macroOnly!=='boolean'||typeof augment!=='boolean'||!['cpu','cuda'].includes(device)||typeof amp!=='boolean'||(amp&&device!=='cuda')||
    ![epoch,seed,freezeEpochs].every(value=>Number.isSafeInteger(value)&&value>=0)||!Number.isFinite(learningRate)||learningRate<=0||learningRate>.01||
    !Number.isSafeInteger(count)||count<1||count>16)throw Error('Explicit native combined batch configuration required');
  if(existsSync(output)||existsSync(resolve(output)+'.receipt.json')||existsSync(sampleOutput))throw Error('Checkpoint, receipt or sample output exists; preserve it');
  const plan=await verifyCombinedTrainingOrder({corpus,auxiliary,orderDirectory,macroOnly,epoch,seed,signal,verifyEvidence});
  const order=resolve(orderDirectory,'order.u64'),positiveWeights=resolve(orderDirectory,'weights.f32'),unobservedMask=plan.unobservedMask;
  const inputPath=resolve(input),inputHash=identity(inputPath),orderData=readOrder(order),weights=positiveWeight(positiveWeights);
  const {previous,cursor}=trainingStart({mode,inputPath,inputHash,epoch,seed,freezeEpochs,learningRate,device,precision:amp?'amp-fp16':'fp32',unobservedMask,weights,orderData});
  if(previous&&(previous.corpusSha256!==sha(readBounded(resolve(corpus),32*1024*1024))||
    previous.auxiliarySha256!==sha(readBounded(resolve(auxiliary),32*1024*1024))||previous.lineageFingerprint!==plan.lineageFingerprint))
    throw Error('Combined training corpus differs from checkpoint receipt');
  const prepared=await prepareCombinedTrainingBatch({corpus,auxiliary,orderDirectory,macroOnly,epoch,seed,cursor,count,augment,output:sampleOutput,signal,verifyEvidence});
  if(prepared.lineageFingerprint!==plan.lineageFingerprint||prepared.orderSha256!==orderData.hash||identity(inputPath)!==inputHash)
    throw Error('Combined training inputs changed before execution; preserve the samples');
  return nativeTrainingBatch({...options,device,amp,order,positiveWeights,unobservedMask,samples:prepared.samples});
}

// Select and reconstruct one batch directly from its validated source corpus.
export async function runMacroTrainingBatch({count,sampleOutput,augment,supervision,...options}){
  const {mode,input,output,corpus,order,epoch,seed,freezeEpochs,learningRate,device='cpu',amp=device==='cuda',signal}=options;
  signal?.throwIfAborted();
  if(!['warm','resume'].includes(mode)||!input||!output||!corpus||!order||!sampleOutput||!supervision||!options.torchLibrary||typeof augment!=='boolean'||
    !['cpu','cuda'].includes(device)||typeof amp!=='boolean'||(amp&&device!=='cuda')||
    ![epoch,seed,freezeEpochs].every(value=>Number.isSafeInteger(value)&&value>=0)||!Number.isFinite(learningRate)||learningRate<=0||learningRate>.01||
    !Number.isSafeInteger(count)||count<1||count>16)throw Error('Explicit native macro batch configuration required');
  if(existsSync(output)||existsSync(resolve(output)+'.receipt.json')||existsSync(sampleOutput))throw Error('Checkpoint, receipt or sample output exists; preserve it');
  const checkedOrder=await verifyMacroTrainingOrder({corpus,order,supervision,epoch,seed,signal});
  const positiveWeights=checkedOrder.weightsPath,unobservedMask=checkedOrder.unobservedMask;
  const inputPath=resolve(input),inputHash=identity(inputPath),orderData=readOrder(resolve(order)),weights=positiveWeight(positiveWeights);
  const {previous,cursor}=trainingStart({mode,inputPath,inputHash,epoch,seed,freezeEpochs,learningRate,device,precision:amp?'amp-fp16':'fp32',unobservedMask,weights,orderData});
  const corpusHash=sha(readBounded(resolve(corpus),32*1024*1024));
  if(previous&&previous.corpusSha256!==corpusHash)throw Error('Training corpus differs from checkpoint receipt');
  const prepared=await prepareMacroTrainingBatch({corpus,order,cursor,count,epoch,augment,output:sampleOutput,signal});
  const afterPreparation=await verifyMacroTrainingOrder({corpus,order,supervision,epoch,seed,signal});
  if(prepared.orderSha256!==orderData.hash||orderData.hash!==checkedOrder.orderSha256||prepared.corpusSha256!==corpusHash||identity(inputPath)!==inputHash)
    throw Error('Training inputs changed before batch execution');
  if(afterPreparation.sourcesSha256!==checkedOrder.sourcesSha256||afterPreparation.weightsSha256!==checkedOrder.weightsSha256||afterPreparation.orderSha256!==checkedOrder.orderSha256)
    throw Error('Training source changed during batch preparation');
  return nativeTrainingBatch({...options,device,amp,positiveWeights,unobservedMask,samples:prepared.samples});
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values,positionals}=parseArgs({allowPositionals:true,options:{mode:{type:'string'},input:{type:'string'},output:{type:'string'},
      corpus:{type:'string'},auxiliary:{type:'string'},order:{type:'string'},'order-directory':{type:'string'},epoch:{type:'string'},seed:{type:'string'},'freeze-epochs':{type:'string'},
      'learning-rate':{type:'string'},supervision:{type:'string'},device:{type:'string'},precision:{type:'string'},
      'torch-library':{type:'string'},count:{type:'string'},'sample-output':{type:'string'},augment:{type:'boolean',default:false},
      'allow-nonmacro-auxiliary':{type:'boolean',default:false}}});
    const integer=name=>{const value=values[name];if(!/^\d+$/.test(value||''))throw Error('Explicit integer '+name+' required');return Number(value);};
    if(positionals.length||!['cpu','cuda'].includes(values.device)||!['fp32','amp-fp16'].includes(values.precision))throw Error('Explicit macro batch configuration required');
    if(values.auxiliary&&(!values['allow-nonmacro-auxiliary']||values.order||values.supervision))throw Error('Combined corpus requires explicit nonmacro auxiliary scope and an order directory');
    if(!values.auxiliary&&(values['allow-nonmacro-auxiliary']||values['order-directory']))throw Error('Auxiliary corpus required for combined scope');
    const common={mode:values.mode,input:values.input,output:values.output,corpus:values.corpus,
      epoch:integer('epoch'),seed:integer('seed'),freezeEpochs:integer('freeze-epochs'),learningRate:Number(values['learning-rate']),
      device:values.device,amp:values.precision==='amp-fp16',torchLibrary:values['torch-library'],
      count:integer('count'),sampleOutput:values['sample-output'],augment:values.augment};
    const result=values.auxiliary?await runCombinedTrainingBatch({...common,auxiliary:values.auxiliary,orderDirectory:values['order-directory'],macroOnly:false}):
      await runMacroTrainingBatch({...common,order:values.order,supervision:values.supervision});
    console.log(JSON.stringify(result));
  }catch(error){console.error('native-training-batch: '+error.message);process.exitCode=1;}
}
