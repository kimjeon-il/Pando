// Binary boundary for native training-diagnostic overlay composition.
import {dirname,extname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {reportArgument} from '../report-paths.mjs';
import {composeNativeDiagnosticOverlays,encodeNativeJpeg,readNativeTrainingRaster} from '../map-image/native-resample.mjs';
import {drawNativePreviewLabels} from '../map-image/native-preview.mjs';
import {diagnosticPixelStatistics} from './native-evaluation.mjs';
import {nativeTrainingCheckpointInfer,nativeTrainingWeightsInfer} from './native-training-validation.mjs';
import {readTrainingBounded,trainingFileIdentity} from './training-evidence.mjs';
import {verifiedMacroTrainingSource,recheckMacroTrainingSource} from './macro-training-source.mjs';
import {selectDiagnosticTile} from './diagnostic-selection.mjs';
import {prepareRasterTrainingTile,prepareReviewedTrainingTile} from './training-tiles.mjs';
import {resolveCorpusPath} from './corpus-path.mjs';
import {validateReviewedCorpus} from './reviewed-corpus.mjs';

// The native model supplies probabilities; original RGB and the training
// tensors use the same channel-major ordering as the existing diagnostic.
export async function summarizeDiagnosticTile({width,height,original,probability,target,valid,baseline},
  {signal,workspace,imageDirectory,evaluationDirectory}={}){
  signal?.throwIfAborted();const pixels=width*height,values=pixels*7,hasBaseline=baseline!==undefined;
  if(![width,height].every(value=>Number.isSafeInteger(value)&&value>0&&value<=16384)||pixels>1048576||
    !(original instanceof Uint8Array)||original.length!==pixels*3||
    ![probability,target,valid,...(hasBaseline?[baseline]:[])].every(value=>value instanceof Uint8Array&&value.length===values*4))
    throw Error('Diagnostic tile tensors have invalid dimensions');
  const expected=Buffer.alloc(values),known=Buffer.alloc(values),predicted=Buffer.alloc(values),prior=hasBaseline?Buffer.alloc(values):null;
  const view=value=>Buffer.from(value.buffer,value.byteOffset,value.byteLength);
  const probabilities=view(probability),targets=view(target),validity=view(valid),baselineView=hasBaseline?view(baseline):null;
  for(let i=0;i<values;i++){
    if((i&65535)===0)signal?.throwIfAborted();
    const at=i*4,p=probabilities.readFloatLE(at),t=targets.readFloatLE(at),v=validity.readFloatLE(at),
      b=baselineView?baselineView.readFloatLE(at):null;
    if(!Number.isFinite(p)||p<0||p>1||!Number.isFinite(t)||!Number.isFinite(v)||
      (hasBaseline&&(!Number.isFinite(b)||b<0||b>1)))throw Error('Diagnostic tile contains invalid tensor values');
    expected[i]=Number(t>.5);known[i]=Number(v>.5);predicted[i]=Number(p>=.55);if(prior)prior[i]=Number(b>=.55);
  }
  const nativeOptions={signal,workspace,directory:evaluationDirectory};
  const [channels,baselineChannels,panels]=await Promise.all([
    diagnosticPixelStatistics({width,height,probability,target:expected,known},nativeOptions),
    hasBaseline?diagnosticPixelStatistics({width,height,probability:baseline,target:expected,known},nativeOptions):null,
    composeNativeDiagnosticOverlays({width,height,original,known,active:[expected,...(prior?[prior]:[]),predicted]},
      {signal,workspace,directory:imageDirectory})]);
  return {channels,baselineChannels,panels,trainingOnly:true,independentEvaluation:false,releaseApproved:false};
}

export async function diagnoseNativeTrainingTile({checkpoint,baselineWeights,tile,overview,position,target,valid,original,device,torchLibrary},
  {signal,workspace,imageDirectory,evaluationDirectory,batchDirectory}={}){
  if(baselineWeights!=null&&(typeof baselineWeights!=='string'||!baselineWeights))throw Error('Explicit baseline weights path required');
  const inference=await nativeTrainingCheckpointInfer({checkpoint,tile,overview,position,device,torchLibrary,output:'probabilities',
    signal,root:workspace,directory:batchDirectory});
  const baseline=baselineWeights!=null?await nativeTrainingWeightsInfer({weights:baselineWeights,tile,overview,position,device,torchLibrary,output:'probabilities',
    signal,root:workspace,directory:batchDirectory}):null;
  const diagnostic=await summarizeDiagnosticTile({width:512,height:512,original,probability:inference.probabilities,target,valid,
    ...(baseline?{baseline:baseline.probabilities}:{})},
    {signal,workspace,imageDirectory,evaluationDirectory});
  return {...diagnostic,probabilities:inference.probabilities,checkpointSha256:inference.checkpointSha256,
    baselineWeightsSha256:baseline?.weightsSha256??null,toolRevision:inference.toolRevision};
}

export async function renderDiagnosticJpeg({original,panels,reviewed=false},{signal,workspace,imageDirectory,previewDirectory}={}){
  signal?.throwIfAborted();const size=512*512*3;
  if(!(original instanceof Uint8Array)||original.length!==size||!Array.isArray(panels)||![2,3].includes(panels.length)||
    panels.some(panel=>!(panel instanceof Uint8Array)||panel.length!==size))throw Error('Original and diagnostic RGB panels required');
  const sources=[original,...panels],width=sources.length*512,height=540,data=Buffer.alloc(width*height*4,255);
  for(let panel=0;panel<sources.length;panel++)for(let y=0;y<512;y++){
    if((y&63)===0)signal?.throwIfAborted();
    for(let x=0;x<512;x++){const src=(y*512+x)*3,dst=((y+28)*width+panel*512+x)*4;
      data[dst]=sources[panel][src];data[dst+1]=sources[panel][src+1];data[dst+2]=sources[panel][src+2];}
  }
  const titles=['Real map input',reviewed?'Source review target':'Source training target',...(panels.length===3?['Before continuation']:[]),'Trained prediction (threshold 0.55)'];
  const labelled=await drawNativePreviewLabels({width,height,data},titles.map((text,i)=>({x:i*512+8,y:8,text})),
    {signal,workspace,directory:previewDirectory});
  return encodeNativeJpeg(labelled,{signal,workspace,directory:imageDirectory});
}

// Inspect one explicitly selected macro source; the result is training-only.
async function diagnoseSource({corpus,reviewCorpus,sourceId,checkpoint,baselineWeights,device,torchLibrary},
  {signal,workspace,imageDirectory,previewDirectory,evaluationDirectory,batchDirectory,reviewDirectory}={}){
  signal?.throwIfAborted();
  if(!corpus||!checkpoint||typeof sourceId!=='string'||!sourceId||!torchLibrary||!['cpu','cuda'].includes(device))
    throw Error('Explicit macro source, checkpoint and device required');
  const corpusPath=resolve(corpus),root=dirname(corpusPath),checkpointPath=resolve(checkpoint),receiptPath=checkpointPath+'.receipt.json';
  const corpusHash=trainingFileIdentity(corpusPath),checkpointHash=trainingFileIdentity(checkpointPath),receiptBytes=readTrainingBounded(receiptPath,1024*1024);
  const receiptHash=createHash('sha256').update(receiptBytes).digest('hex'),manifest=JSON.parse(readTrainingBounded(corpusPath,32*1024*1024)),receipt=JSON.parse(receiptBytes);
  if(receipt.schemaVersion!==1||receipt.trainingOnly!==true||receipt.releaseApproved!==false||receipt.device!==device||
    receipt.checkpointSha256!==checkpointHash||receipt.corpusSha256!==corpusHash)throw Error('Checkpoint does not match this training corpus');
  let baselinePath=null,baselineHash=null,transferPath=null,transferHash=null;
  if(baselineWeights!=null){
    if(typeof baselineWeights!=='string'||!baselineWeights)throw Error('Explicit baseline weights path required');
    baselinePath=resolve(baselineWeights);baselineHash=trainingFileIdentity(baselinePath);
    if(!receipt.initializationWeightsSha256||receipt.initializationWeightsSha256!==baselineHash)throw Error('Baseline does not match the checkpoint initializer');
    transferPath=resolve(dirname(baselinePath),'transfer.json');const transferBytes=readTrainingBounded(transferPath,1024*1024);
    transferHash=createHash('sha256').update(transferBytes).digest('hex');const transfer=JSON.parse(transferBytes);
    if(receipt.initializationSourceSha256!=null&&!/^[a-f0-9]{64}$/.test(receipt.initializationSourceSha256))throw Error('Invalid baseline original checkpoint identity');
    if(receipt.initializationSourceSha256!==null&&receipt.initializationSourceSha256!==undefined&&
      transfer.sourceCheckpointSha256!==receipt.initializationSourceSha256)throw Error('Baseline original checkpoint identity differs');
  }
  const reviewed=reviewCorpus!==undefined;let sheet,annotation,checks,reviewPath,reviewHash,verified;
  if(reviewed){
    reviewPath=resolve(reviewCorpus);const bytes=readTrainingBounded(reviewPath,32*1024*1024);
    reviewHash=createHash('sha256').update(bytes).digest('hex');const reviewManifest=JSON.parse(bytes);
    if(!Array.isArray(reviewManifest.sheets))throw Error('Reviewed corpus sheets required');
    const matches=reviewManifest.sheets.filter(value=>value?.id===sourceId);
    if(matches.length!==1)throw Error('Unique reviewed source required');
    await validateReviewedCorpus({...reviewManifest,sheets:matches},dirname(reviewPath),{signal,workspace,reviewDirectory,onVerified:value=>{verified=value;}});
    ({sheet,annotation}=verified);
  }else{
    ({sheet,annotation,checks}=await verifiedMacroTrainingSource(root,manifest,sourceId));recheckMacroTrainingSource(checks);
  }
  const selected=await selectDiagnosticTile({root:reviewed?dirname(reviewPath):root,annotation},{signal,workspace,imageDirectory,reviewDirectory});
  if(!selected)throw Error('Source has no supervised diagnostic tile');
  const {x,y,index}=selected,path=reviewed?verified.imagePath:await resolveCorpusPath(root,sheet.image),format=({'.png':'png','.jpg':'jpeg','.jpeg':'jpeg','.webp':'webp'})[extname(path).toLowerCase()];
  if(!format)throw Error('Supported training image required');
  const [tensors,image]=await Promise.all([
    reviewed?prepareReviewedTrainingTile({imagePath:path,sourceSha256:sheet.sha256,annotation,x,y,augment:false,epoch:0,index},{signal,workspace,imageDirectory,reviewDirectory}):
      prepareRasterTrainingTile({root,imagePath:sheet.image,sourceSha256:sheet.sha256,annotation,x,y,augment:false,epoch:0,index},{signal,workspace,imageDirectory}),
    readNativeTrainingRaster({path,format,expectedSha256:sheet.sha256,x,y},{signal,workspace,directory:imageDirectory})]);
  const original=Buffer.alloc(512*512*3);for(let i=0;i<512*512;i++){original[i*3]=image.tile[i*4];original[i*3+1]=image.tile[i*4+1];original[i*3+2]=image.tile[i*4+2];}
  const diagnostic=await diagnoseNativeTrainingTile({checkpoint:checkpointPath,baselineWeights:baselinePath,...tensors,original,device,torchLibrary},
    {signal,workspace,imageDirectory,evaluationDirectory,batchDirectory});
  const preview=await renderDiagnosticJpeg({original,panels:diagnostic.panels,reviewed},{signal,workspace,imageDirectory,previewDirectory});
  if(reviewed){
    if(trainingFileIdentity(reviewPath)!==reviewHash||trainingFileIdentity(verified.annotationPath)!==verified.annotationSha256||
      trainingFileIdentity(path,{maxBytes:Number.MAX_SAFE_INTEGER})!==sheet.sha256)
      throw Error('Reviewed inputs changed during diagnostic');
  }else recheckMacroTrainingSource(checks);
  if(trainingFileIdentity(corpusPath)!==corpusHash||trainingFileIdentity(checkpointPath)!==checkpointHash||trainingFileIdentity(receiptPath)!==receiptHash)
    throw Error('Training inputs changed during diagnostic');
  if(baselinePath&&(trainingFileIdentity(baselinePath)!==baselineHash||trainingFileIdentity(transferPath)!==transferHash))throw Error('Baseline changed during diagnostic');
  return {sourceId,tileIndex:index,pixelOrigin:[x,y],channels:diagnostic.channels,baselineChannels:diagnostic.baselineChannels,
    baselineWeightsSha256:diagnostic.baselineWeightsSha256,baselineOriginalCheckpointSha256:baselinePath?(receipt.initializationSourceSha256??null):null,
    jpeg:preview.data,checkpointSha256:checkpointHash,corpusSha256:corpusHash,...(reviewed?{reviewCorpusSha256:reviewHash,sourceSplit:sheet.split,diagnosticOnly:true}:{}),
    trainingOnly:true,independentEvaluation:false,releaseApproved:false};
}

export function diagnoseMacroTrainingSource(request,options){return diagnoseSource(request,options);}
export function diagnoseReviewedSource(request,options){
  if(!request.reviewCorpus)throw Error('Explicit reviewed corpus required');
  return diagnoseSource(request,options);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv[2]==='--macro-source'||process.argv[2]==='--reviewed-source'){
      const reviewed=process.argv[2]==='--reviewed-source';
      const {values,positionals}=parseArgs({args:process.argv.slice(3),allowPositionals:true,options:{corpus:{type:'string'},source:{type:'string'},
        'review-corpus':{type:'string'},checkpoint:{type:'string'},'baseline-weights':{type:'string'},output:{type:'string'},device:{type:'string'},'torch-library':{type:'string'}}});
      if(positionals.length||!values.corpus||!values.source||!values.checkpoint||!values.output||!values.device||!values['torch-library']||reviewed!==Boolean(values['review-corpus']))
        throw Error('Expected --macro-source or --reviewed-source, --corpus MANIFEST, --source ID, --checkpoint PATH, --output DIRECTORY, --device cpu|cuda and --torch-library DIRECTORY; reviewed sources also require --review-corpus MANIFEST');
      const output=resolve(reportArgument(values.output,{access:'write'}));
      if(existsSync(output))throw Error('Diagnostic output exists; preserve prior evidence');
      const result=await diagnoseSource({corpus:reportArgument(values.corpus,{access:'read',siblings:true}),...(reviewed?{reviewCorpus:reportArgument(values['review-corpus'],{access:'read',siblings:true})}:{}),sourceId:values.source,
        checkpoint:reportArgument(values.checkpoint,{access:'read',siblings:true}),baselineWeights:reportArgument(values['baseline-weights'],{access:'read',siblings:true}),
        device:values.device,torchLibrary:values['torch-library']});
      const {jpeg,...diagnostic}=result;
      await mkdir(output);await writeFile(resolve(output,'preview.jpg'),jpeg,{flag:'wx'});
      const purpose=reviewed?'source-reviewed-diagnostic':'training-set-diagnostic-only';
      await writeFile(resolve(output,'diagnostics.json'),JSON.stringify({...diagnostic,purpose,previewFile:'preview.jpg'},null,2)+'\n',{flag:'wx'});
      process.stdout.write(JSON.stringify({output,sourceId:result.sourceId,purpose,releaseApproved:false})+'\n');
      process.exitCode=0;
    }else{
    if(process.argv.length!==3||process.argv[2]!=='--overlay-stream')throw Error('Expected --overlay-stream');
    const chunks=[];let length=0;for await(const chunk of process.stdin){length+=chunk.length;if(length>64*1024*1024)throw Error('Diagnostic overlay input exceeds budget');chunks.push(chunk);}
    const input=Buffer.concat(chunks,length);
    if(input.length<20||input.toString('ascii',0,8)!=='PDPREV01')throw Error('Invalid diagnostic overlay header');
    const width=input.readUInt32BE(8),height=input.readUInt32BE(12),panels=input.readUInt32BE(16),pixels=width*height;
    if(!width||!height||width>16384||height>16384||pixels>1048576||panels<1||panels>3||input.length!==20+pixels*(3+7*(1+panels)))
      throw Error('Invalid diagnostic overlay dimensions or length');
    let at=20;const take=length=>{const part=input.subarray(at,at+length);at+=length;return part;};
    const original=take(pixels*3),known=take(pixels*7),active=Array.from({length:panels},()=>take(pixels*7));
    for(const panel of await composeNativeDiagnosticOverlays({width,height,original,known,active}))process.stdout.write(panel);
    }
  }catch(error){console.error('native-diagnostic-preview: '+error.message);process.exitCode=1;}
}
