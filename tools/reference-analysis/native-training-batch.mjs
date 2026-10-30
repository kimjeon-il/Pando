// Private, source-bound experimental batch execution. This does not admit a
// model or replace the training CLI until all dataset validation is migrated.
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {delimiter,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';
import {resolveCorpusPath} from './corpus-path.mjs';
import {matchingTorchLibrary,referenceBatchSourceFiles} from './native-infer.mjs';
import {prepareRasterTrainingTile} from './training-tiles.mjs';
import {TRAINING_TENSOR_NAMES,trainingSha256,verifyTrainingSample} from './training-sample.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function identity(path){const info=statSync(path);if(!info.isFile()||info.size>1024**3)throw Error('Expected bounded checkpoint or evidence file');return sha(readFileSync(path));}
function readOrder(path){const bytes=readFileSync(path);if(!bytes.length||bytes.length%8||bytes.length>8000000)throw Error('Invalid bounded training order');
  const order=[];for(let at=0;at<bytes.length;at+=8){const n=bytes.readBigUInt64LE(at);if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Invalid training order index');order.push(Number(n));}
  return {order,hash:sha(bytes)};
}
function positiveWeight(path){if(!path)return {argument:'none',hash:null};const bytes=readFileSync(path);
  if(bytes.length!==28||Array.from({length:7},(_,i)=>bytes.readFloatLE(i*4)).some(v=>!Number.isFinite(v)||v<1||v>64))throw Error('Positive weights must contain seven values in 1..64');
  return {argument:resolve(path),hash:sha(bytes)};
}
async function verifyEvidence(root,corpus,sample,data,{epoch,signal}){
  const rows=corpus.sheets.filter(row=>row.id===data.sourceId);if(rows.length!==1)throw Error('Unique training source identity required');const sheet=rows[0];
  if(sheet.split!=='train'||!['world','continent','country'].includes(sheet.geographicScope)||!sheet.scopeEvidence||sheet.sha256!==data.imageSha256||
    ['familyId','editionId','duplicateGroup'].some(key=>typeof sheet[key]!=='string'||!sheet[key])||!sheet.source?.url||!sheet.source?.license)
    throw Error('Verified macro training source required');
  const annotationPath=await resolveCorpusPath(root,sheet.annotations),annotationBytes=readFileSync(annotationPath);
  if(sha(annotationBytes)!==data.annotationSha256)throw Error('Training annotation hash changed');const annotation=JSON.parse(annotationBytes);
  if(annotation.origin!=='macro-vector-supervision'||annotation.reviewed!==false||annotation.supervisionQuality!=='source-derived-weak'||
    annotation.sourceSha256!==data.sourcePdfSha256||annotation.raster?.sha256!==data.maskSha256||annotation.validRaster?.sha256!==data.validMaskSha256)
    throw Error('Source-derived macro training evidence differs');
  const metadataPath=await resolveCorpusPath(root,annotation.sourceMetadata),metadataBytes=readFileSync(metadataPath);
  if(sha(metadataBytes)!==annotation.sourceMetadataSha256)throw Error('Training source metadata hash changed');const metadata=JSON.parse(metadataBytes);
  if(metadata.rightsReviewed!==true||!metadata.license||metadata.materialKind!=='published-macro-pdf'||metadata.sha256!==annotation.sourceSha256||
    ['id','familyId','editionId','duplicateGroup','geographicScope','scopeEvidence'].some(key=>metadata[key]!==sheet[key])||
    metadata.url!==sheet.source?.url||metadata.license!==sheet.source?.license)throw Error('Verified macro source provenance required');
  const sourcePdf=await resolveCorpusPath(root,annotation.sourcePdf);if(identity(sourcePdf)!==data.sourcePdfSha256)throw Error('Training source PDF hash changed');
  const imagePath=await resolveCorpusPath(root,sheet.image),maskPath=await resolveCorpusPath(root,annotation.raster.path),validPath=await resolveCorpusPath(root,annotation.validRaster.path);
  if(!Array.isArray(data.pixelOrigin)||data.pixelOrigin.length!==2||data.pixelOrigin.some(v=>!Number.isInteger(v)||v<0)||typeof sample.augment!=='boolean')
    throw Error('Training sample position and augmentation must be explicit');
  const [x,y]=data.pixelOrigin,rebuilt=await prepareRasterTrainingTile({root,imagePath:sheet.image,sourceSha256:sheet.sha256,annotation,x,y,
    augment:sample.augment,epoch,index:data.tileIndex},{signal});
  for(const name of TRAINING_TENSOR_NAMES)if(trainingSha256(rebuilt[name])!==data.tensorSha256[name])throw Error('Training tensor differs from source: '+name);
  return {record:{sourceId:data.sourceId,imageSha256:data.imageSha256,annotationSha256:data.annotationSha256,sourcePdfSha256:data.sourcePdfSha256,
    tileIndex:data.tileIndex,pixelOrigin:data.pixelOrigin,augment:sample.augment},checks:[[sourcePdf,data.sourcePdfSha256],[metadataPath,annotation.sourceMetadataSha256],
      [annotationPath,data.annotationSha256],[imagePath,data.imageSha256],[maskPath,data.maskSha256],[validPath,data.validMaskSha256]]};
}
export async function nativeTrainingBatch({mode,input,output,corpus,order,epoch,seed,freezeEpochs,learningRate,positiveWeights,
  samples,device='cpu',torchLibrary,root=defaultRoot,directory=resolve(root,'build-native/reference-analysis/training-batch'),signal}){
  signal?.throwIfAborted();
  if(process.platform!=='win32'||!['warm','resume'].includes(mode)||!input||!output||!corpus||!order||!torchLibrary||!['cpu','cuda'].includes(device)||
    ![epoch,seed,freezeEpochs].every(v=>Number.isSafeInteger(v)&&v>=0)||!Number.isFinite(learningRate)||learningRate<=0||learningRate>.01||
    !Array.isArray(samples)||samples.length<1||samples.length>16)throw Error('Explicit Windows training batch inputs and configuration required');
  const target=resolve(output),receiptPath=target+'.receipt.json';if(existsSync(target)||existsSync(receiptPath))throw Error('Checkpoint or receipt already exists; preserve existing output');
  const inputPath=resolve(input),inputHash=identity(inputPath),orderData=readOrder(resolve(order)),weights=positiveWeight(positiveWeights);
  let previous=null,cursor=0;
  if(mode==='warm'){
    if(epoch!==0)throw Error('A weights-only warm start begins at epoch zero');
    const transfer=JSON.parse(readFileSync(join(dirname(inputPath),'transfer.json'),'utf8'));
    if(transfer.trainingOnly!==true||transfer.evaluationStatus!=='pending'||transfer.releaseApproved!==false||transfer.transfer!=='weights-only-no-optimizer'||transfer.weightsSha256!==inputHash)
      throw Error('Verified private weights-only warm start required');
  }else{
    previous=JSON.parse(readFileSync(inputPath+'.receipt.json','utf8'));
    if(previous.schemaVersion!==1||previous.trainingOnly!==true||previous.releaseApproved!==false||previous.lineageComplete!==false||
      previous.checkpointSha256!==inputHash||previous.device!==device||previous.seed!==seed||previous.freezeEpochs!==freezeEpochs||
      previous.learningRate!==learningRate||previous.positiveWeightSha256!==weights.hash)throw Error('Checkpoint receipt or training configuration differs');
    if(epoch===previous.epoch){if(previous.orderSha256!==orderData.hash||previous.orderLength!==orderData.order.length)throw Error('Training order differs from checkpoint receipt');cursor=previous.cursor;}
    else if(epoch===previous.epoch+1&&previous.cursor===previous.orderLength)cursor=0;
    else throw Error('Checkpoint is not at the requested epoch boundary');
  }
  if(!Number.isSafeInteger(cursor)||cursor<0||cursor+samples.length>orderData.order.length)throw Error('Training cursor exceeds sample order');
  const checked=samples.map((sample,i)=>{if(!sample||!Number.isSafeInteger(sample.index)||sample.index!==orderData.order[cursor+i]||!sample.directory)
    throw Error('Training samples differ from the saved order');return verifyTrainingSample(sample.directory);});
  const corpusPath=resolve(corpus),corpusBytes=readFileSync(corpusPath),corpusHash=sha(corpusBytes),manifest=JSON.parse(corpusBytes);
  if(manifest.schemaVersion!==1||manifest.trainingOnly!==true||!Array.isArray(manifest.sheets))throw Error('Explicit private training-only corpus required');
  if(previous&&previous.corpusSha256!==corpusHash)throw Error('Training corpus differs from checkpoint receipt');
  const sourceRoot=dirname(corpusPath),evidence=[];for(let i=0;i<samples.length;i++)evidence.push(await verifyEvidence(sourceRoot,manifest,samples[i],checked[i],{epoch,signal}));
  const {binary,manifest:tool}=verifyNativeTool({root,directory,target:'reference-training-batch',executable:'pando-reference-training-batch.exe',sourceFiles:referenceBatchSourceFiles});
  const library=matchingTorchLibrary(torchLibrary,tool),args=[device,mode,inputPath,target,String(epoch),String(seed),String(freezeEpochs),String(learningRate),resolve(order),weights.argument];
  for(const sample of samples)args.push(String(sample.index),resolve(sample.directory));
  const stdout=await new Promise((ok,fail)=>execFile(binary,args,{encoding:'utf8',windowsHide:true,maxBuffer:1024**2,timeout:300000,signal,
    env:{...process.env,PATH:library+delimiter+process.env.PATH,CUBLAS_WORKSPACE_CONFIG:':4096:8'}},
    (error,text,stderr)=>error?fail(new Error('Native training batch failed: '+error.message+' '+stderr,{cause:error})):ok(text)));
  signal?.throwIfAborted();const result=JSON.parse(stdout),info=statSync(target);
  if(result.trainingOnly!==true||result.releaseApproved!==false||result.precision!=='fp32'||result.epoch!==epoch||result.cursor!==cursor+samples.length||
    result.batch!==samples.length||!Number.isFinite(result.loss)||result.checkpointBytes!==info.size)throw Error('Native training batch returned an invalid result; preserve its checkpoint');
  if(identity(inputPath)!==inputHash||sha(readFileSync(corpusPath))!==corpusHash||readOrder(resolve(order)).hash!==orderData.hash||positiveWeight(positiveWeights).hash!==weights.hash)
    throw Error('Training inputs changed during execution; preserve its checkpoint');
  for(const sample of samples)verifyTrainingSample(sample.directory);
  for(const item of evidence)for(const [path,expected] of item.checks)if(identity(path)!==expected)throw Error('Training source changed during execution; preserve its checkpoint');
  const receipt={schemaVersion:1,trainingOnly:true,releaseApproved:false,lineageComplete:false,sourceReplayVerified:false,precision:'fp32',
    initialization:previous?previous.initialization:'weights-only-no-optimizer',device,corpusSha256:corpusHash,epoch,cursor:result.cursor,
    orderSha256:orderData.hash,orderLength:orderData.order.length,seed,freezeEpochs,learningRate,positiveWeightSha256:weights.hash,
    checkpointSha256:identity(target),checkpointBytes:info.size,toolRevision:tool.revision,evidence:evidence.map(item=>item.record)};
  writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return {...result,receiptPath,checkpointSha256:receipt.checkpointSha256,lineageComplete:false};
}
