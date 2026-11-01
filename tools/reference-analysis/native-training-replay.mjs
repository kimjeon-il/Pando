// Verify recorded source tensors and checkpoint links for selected corpora.
// This does not replay optimizer updates or establish independent evaluation.
import {createHash} from 'node:crypto';
import {statSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual,parseArgs} from 'node:util';
import {reportArgument} from '../report-paths.mjs';
import {assertPublicEncoderIdentity,corpusFingerprint,readTrainingBounded,trainingFileIdentity,verifyTrainingInitializer} from './training-evidence.mjs';
import {indexTrainingDataset} from './training-tiles.mjs';
import {verifyCombinedTrainingOrder,verifyTrainingOrder} from './training-order.mjs';
import {verifyCombinedTrainingEvidence,verifyTrainingEvidence} from './native-training-batch.mjs';
import {recheckTrainingSources} from './macro-training-source.mjs';

const SHA=/^[a-f0-9]{64}$/,sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const tensors=['tile','overview','position','target','valid'];
const sameFields=['initialization','initializationWeightsSha256','initializationSourceSha256','encoderInitialization',
  'corpusSha256','auxiliarySha256','lineageFingerprint','device','precision','seed','freezeEpochs','learningRate','unobservedMask','positiveWeightSha256'];
export function validateReplayReceiptChain(entries,{weightsSha256,corpusSha256,auxiliarySha256=null,lineageFingerprint=null}){
  const combined=auxiliarySha256!==null;
  if(!Array.isArray(entries)||!entries.length||entries.length>100000||!SHA.test(weightsSha256||'')||!SHA.test(corpusSha256||'')||
    (combined?(!SHA.test(auxiliarySha256||'')||!SHA.test(lineageFingerprint||'')):lineageFingerprint!==null))
    throw Error('Explicit bounded checkpoint chain and source identities required');
  let previous=null,totalSamples=0;
  for(let i=0;i<entries.length;i++){
    const {checkpointSha256,receiptSha256,receipt:r}=entries[i]||{};
    if(!SHA.test(checkpointSha256||'')||!SHA.test(receiptSha256||'')||!r||r.schemaVersion!==1||r.checkpointSha256!==checkpointSha256||
      r.trainingOnly!==true||r.releaseApproved!==false||r.lineageComplete!==false||r.sourceReplayVerified!==false||r.batchSourceReplayVerified!==true||
      r.initialization!=='public-encoder-no-optimizer'||r.initializationWeightsSha256!==weightsSha256||r.initializationSourceSha256!==null||r.corpusSha256!==corpusSha256||
      (combined?(r.auxiliarySha256!==auxiliarySha256||r.lineageFingerprint!==lineageFingerprint):
        (r.auxiliarySha256!==undefined||r.lineageFingerprint!==undefined))||
      !['cpu','cuda'].includes(r.device)||!['fp32','amp-fp16'].includes(r.precision)||(r.precision==='amp-fp16'&&r.device!=='cuda')||
      !Number.isSafeInteger(r.epoch)||r.epoch<0||!Number.isSafeInteger(r.seed)||r.seed<0||!Number.isSafeInteger(r.freezeEpochs)||r.freezeEpochs<0||
      !Number.isFinite(r.learningRate)||r.learningRate<=0||r.learningRate>.01||!Number.isInteger(r.unobservedMask)||r.unobservedMask<0||r.unobservedMask>127||
      !SHA.test(r.orderSha256||'')||!SHA.test(r.positiveWeightSha256||'')||!Number.isSafeInteger(r.orderLength)||r.orderLength<1||
      !Number.isSafeInteger(r.cursor)||r.cursor<1||r.cursor>r.orderLength||!Array.isArray(r.evidence)||!r.evidence.length||r.evidence.length>16||
      r.attemptedBatches!==i+1||!Number.isSafeInteger(r.optimizerUpdates)||!Number.isSafeInteger(r.skippedUpdates)||
      r.optimizerUpdates<0||r.skippedUpdates<0||r.optimizerUpdates+r.skippedUpdates!==r.attemptedBatches)
      throw Error('Invalid or incomplete source-replay checkpoint receipt');
    assertPublicEncoderIdentity(r.encoderInitialization);
    const start=previous?(r.epoch===previous.receipt.epoch?previous.receipt.cursor:0):0;
    if(!previous){if(r.epoch!==0||r.parentCheckpointSha256!==null||r.parentReceiptSha256!==null)throw Error('Checkpoint chain must start at the public encoder');}
    else{
      const prior=previous.receipt;
      if(r.parentCheckpointSha256!==previous.checkpointSha256||r.parentReceiptSha256!==previous.receiptSha256||
        sameFields.some(key=>!isDeepStrictEqual(r[key],prior[key]))||
        (r.epoch===prior.epoch?(r.orderSha256!==prior.orderSha256||r.orderLength!==prior.orderLength):
          r.epoch!==prior.epoch+1||prior.cursor!==prior.orderLength)||
        r.optimizerUpdates<prior.optimizerUpdates||r.skippedUpdates<prior.skippedUpdates)
        throw Error('Checkpoint parent or training configuration differs');
    }
    if(r.cursor!==start+r.evidence.length)throw Error('Checkpoint source cursor differs from batch evidence');
    for(const item of r.evidence){
      if(!item||typeof item.sourceId!=='string'||!item.sourceId||!['macro-pdf','publisher-pdf','reviewed',...(combined?['semap-label']:[])].includes(item.sourceKind)||
        !['imageSha256','annotationSha256','sourceEvidenceSha256',...(item.sourceKind==='reviewed'?[]:['maskSha256','validMaskSha256'])].every(key=>SHA.test(item[key]||''))||
        !Number.isSafeInteger(item.tileIndex)||item.tileIndex<0||!Number.isSafeInteger(item.augmentationIndex)||item.augmentationIndex<0||
        (!combined&&item.augmentationIndex!==item.tileIndex)||
        !Array.isArray(item.pixelOrigin)||item.pixelOrigin.length!==2||item.pixelOrigin.some(n=>!Number.isSafeInteger(n)||n<0)||typeof item.augment!=='boolean'||
        !item.tensorSha256||!tensors.every(name=>SHA.test(item.tensorSha256[name]||'')))throw Error('Incomplete source replay evidence');
    }
    if(r.evidence.some(item=>item.augment!==r.evidence[0].augment)||previous&&r.evidence[0].augment!==previous.receipt.evidence[0].augment)
      throw Error('Training augmentation differs across checkpoint chain');
    totalSamples+=r.evidence.length;previous=entries[i];
  }
  return {batches:entries.length,samples:totalSamples};
}

export async function verifyTrainingSourceReplay({checkpoints,weights,corpus,auxiliary,supervision,reviewed=false,publisher=false},{signal}={}){
  signal?.throwIfAborted();
  if(!Array.isArray(checkpoints)||!checkpoints.length||checkpoints.length>100000||checkpoints.some(path=>typeof path!=='string'||!path)||
    new Set(checkpoints.map(path=>resolve(path))).size!==checkpoints.length||!weights||!corpus||typeof reviewed!=='boolean'||
    typeof publisher!=='boolean'||reviewed&&publisher||(auxiliary?(supervision||reviewed||publisher):!supervision))
    throw Error('Explicit distinct checkpoint chain and matching corpus scope required');
  const initializer=verifyTrainingInitializer({path:weights});
  if(initializer.initialization!=='public-encoder-no-optimizer')throw Error('Source replay starts at the verified public encoder');
  const corpusPath=resolve(corpus),corpusBytes=readTrainingBounded(corpusPath,32*1024*1024),corpusHash=sha(corpusBytes),manifest=JSON.parse(corpusBytes),root=dirname(corpusPath);
  const auxiliaryPath=auxiliary?resolve(auxiliary):null,auxiliaryHash=auxiliaryPath?trainingFileIdentity(auxiliaryPath):null,
    lineageFingerprint=auxiliaryPath?await corpusFingerprint(corpusPath,auxiliaryPath):null;
  const entries=checkpoints.map(value=>{const path=resolve(value),bytes=readTrainingBounded(path+'.receipt.json',1024*1024),receipt=JSON.parse(bytes);
    const checkpointSha256=trainingFileIdentity(path);if(!Number.isSafeInteger(receipt.checkpointBytes)||statSync(path).size!==receipt.checkpointBytes)
      throw Error('Checkpoint size differs from its receipt');
    return {path,receipt,checkpointSha256,receiptSha256:sha(bytes)};});
  const totals=validateReplayReceiptChain(entries,{weightsSha256:initializer.weightsSha256,corpusSha256:corpusHash,auxiliarySha256:auxiliaryHash,lineageFingerprint});
  if(!isDeepStrictEqual(entries[0].receipt.encoderInitialization,initializer.encoderInitialization))throw Error('Public encoder provenance differs');
  const supervisionPaths=auxiliaryPath?[]:['supervision.json','weights.f32'].map(name=>resolve(supervision,name));
  const supervisionHashes=supervisionPaths.map(path=>trainingFileIdentity(path));
  const dataset=auxiliaryPath?null:await indexTrainingDataset(corpusPath,{allowReviewed:reviewed,allowPublisher:publisher,signal});
  if(dataset&&dataset.corpusSha256!==corpusHash)throw Error('Training corpus changed before source replay');
  const orders=new Map(),sourceChecks=new Map();let previous=null;
  for(const entry of entries){
    signal?.throwIfAborted();const r=entry.receipt,orderDirectory=auxiliaryPath?join(dirname(entry.path),'order'):dirname(entry.path),orderPath=join(orderDirectory,'order.u64');
    if(!orders.has(orderPath)){
      const verified=auxiliaryPath?await verifyCombinedTrainingOrder({corpus:corpusPath,auxiliary:auxiliaryPath,orderDirectory,macroOnly:false,epoch:r.epoch,seed:r.seed,signal}):
        await verifyTrainingOrder({corpus:corpusPath,order:orderPath,supervision,reviewed,publisher,epoch:r.epoch,seed:r.seed,signal});
      const orderReceiptPath=auxiliaryPath?join(orderDirectory,'order.json'):orderPath+'.receipt.json';
      const bytes=readTrainingBounded(orderPath,8000000),receiptHash=trainingFileIdentity(orderReceiptPath);
      const weightsPath=auxiliaryPath?join(orderDirectory,'weights.f32'):null;
      orders.set(orderPath,{verified,bytes,orderReceiptPath,receiptHash,weightsPath,tiles:auxiliaryPath?verified.datasets.flat():null});
    }
    const {verified,bytes,tiles}=orders.get(orderPath);
    if(verified.orderSha256!==r.orderSha256||verified.length!==r.orderLength||verified.weightsSha256!==r.positiveWeightSha256||
      verified.unobservedMask!==r.unobservedMask||(auxiliaryPath&&verified.lineageFingerprint!==lineageFingerprint))
      throw Error('Recorded training order or weights differ');
    const start=previous&&r.epoch===previous.epoch?previous.cursor:0;
    for(let i=0;i<r.evidence.length;i++){
      const item=r.evidence[i],orderIndex=bytes.readBigUInt64LE((start+i)*8);
      if(orderIndex!==BigInt(item.tileIndex))throw Error('Replayed sample differs from its recorded order');
      const tile=auxiliaryPath?tiles[item.tileIndex]:dataset.tiles[item.tileIndex];
      if(!tile||tile.index!==item.tileIndex||tile.sourceId!==item.sourceId||tile.x!==item.pixelOrigin[0]||tile.y!==item.pixelOrigin[1]||
        (auxiliaryPath&&tile.localIndex!==item.augmentationIndex))
        throw Error('Replayed sample differs from its source tile');
      const evidence=auxiliaryPath?await verifyCombinedTrainingEvidence(root,manifest,dirname(auxiliaryPath),verified,
        {index:item.tileIndex,augment:item.augment},item,{epoch:r.epoch,signal}):
        await verifyTrainingEvidence(root,manifest,{augment:item.augment},item,{epoch:r.epoch,signal,allowPublisher:publisher,allowReviewed:reviewed});
      recheckTrainingSources(evidence.checks);
      for(const [path,hash] of evidence.checks){if(sourceChecks.has(path)&&sourceChecks.get(path)!==hash)throw Error('Training source identity differs across batches');sourceChecks.set(path,hash);}
    }
    previous=r;
  }
  recheckTrainingSources([...sourceChecks]);
  if(trainingFileIdentity(corpusPath)!==corpusHash||verifyTrainingInitializer({path:weights}).recordHash!==initializer.recordHash||
    supervisionPaths.some((path,index)=>trainingFileIdentity(path)!==supervisionHashes[index])||
    auxiliaryPath&&(trainingFileIdentity(auxiliaryPath)!==auxiliaryHash||await corpusFingerprint(corpusPath,auxiliaryPath)!==lineageFingerprint)||
    [...orders].some(([path,order])=>trainingFileIdentity(path)!==order.verified.orderSha256||trainingFileIdentity(order.orderReceiptPath)!==order.receiptHash||
      order.weightsPath&&trainingFileIdentity(order.weightsPath)!==order.verified.weightsSha256)||
    entries.some(entry=>trainingFileIdentity(entry.path)!==entry.checkpointSha256||trainingFileIdentity(entry.path+'.receipt.json')!==entry.receiptSha256))
    throw Error('Training replay inputs changed during verification');
  return {schemaVersion:1,sourceReplayVerified:true,checkpointLinksVerified:true,optimizerUpdatesReplayed:false,lineageComplete:false,
    independentEvaluation:false,releaseApproved:false,...totals,corpusSha256:corpusHash,
    ...(auxiliaryPath?{auxiliaryCorpusSha256:auxiliaryHash,lineageFingerprint}:{}),checkpointSha256:entries.at(-1).checkpointSha256};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const {values,positionals}=parseArgs({allowPositionals:true,options:{weights:{type:'string'},corpus:{type:'string'},auxiliary:{type:'string'},supervision:{type:'string'},
      reviewed:{type:'boolean',default:false},publisher:{type:'boolean',default:false},'allow-nonmacro-auxiliary':{type:'boolean',default:false}}});
    if(!values.weights||!values.corpus||!positionals.length||Boolean(values.auxiliary)!==Boolean(values['allow-nonmacro-auxiliary'])||
      (values.auxiliary?Boolean(values.supervision)||values.reviewed||values.publisher:!values.supervision))
      throw Error('Explicit weights, matching corpus scope and ordered checkpoints required');
    console.log(JSON.stringify(await verifyTrainingSourceReplay({weights:reportArgument(values.weights,{access:'read',siblings:true}),
      corpus:reportArgument(values.corpus,{access:'read',siblings:true}),auxiliary:reportArgument(values.auxiliary,{access:'read',siblings:true}),
      supervision:reportArgument(values.supervision,{access:'read',siblings:true}),
      reviewed:values.reviewed,publisher:values.publisher,checkpoints:positionals.map(path=>reportArgument(path,{access:'read',siblings:true}))})));
  }catch(error){console.error('native-training-replay: '+error.message);process.exitCode=1;}
}
