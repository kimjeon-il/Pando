// Binary boundary for native training-diagnostic overlay composition.
import {dirname,extname,join,resolve} from 'node:path';
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
import {corpusFingerprint,readTrainingBounded,trainingFileIdentity} from './training-evidence.mjs';
import {verifiedMacroTrainingSource,recheckMacroTrainingSource} from './macro-training-source.mjs';
import {selectDiagnosticTile} from './diagnostic-selection.mjs';
import {prepareRasterTrainingTile,prepareReviewedTrainingTile} from './training-tiles.mjs';
import {resolveCorpusPath} from './corpus-path.mjs';
import {validatePublisherTrainingSource,validateReviewedCorpus} from './reviewed-corpus.mjs';
import {validateSemapTrainingCorpus} from './validate-semap.mjs';

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
async function diagnoseSource({corpus,auxiliaryCorpus,viewCorpus='primary',reviewCorpus,sourceId,checkpoint,baselineWeights,device,torchLibrary,captureParity=false},
  {signal,workspace,imageDirectory,previewDirectory,evaluationDirectory,batchDirectory,reviewDirectory}={},internalScope=null){
  signal?.throwIfAborted();
  if(!corpus||!checkpoint||typeof sourceId!=='string'||!sourceId||!torchLibrary||!['cpu','cuda'].includes(device))
    throw Error('Explicit macro source, checkpoint and device required');
  const corpusPath=resolve(corpus),root=dirname(corpusPath),checkpointPath=resolve(checkpoint),receiptPath=checkpointPath+'.receipt.json';
  const corpusHash=trainingFileIdentity(corpusPath),checkpointHash=trainingFileIdentity(checkpointPath),receiptBytes=readTrainingBounded(receiptPath,1024*1024);
  const receiptHash=createHash('sha256').update(receiptBytes).digest('hex'),manifest=JSON.parse(readTrainingBounded(corpusPath,32*1024*1024)),receipt=JSON.parse(receiptBytes);
  if(receipt.schemaVersion!==1||receipt.trainingOnly!==true||receipt.releaseApproved!==false||receipt.device!==device||
    receipt.checkpointSha256!==checkpointHash||receipt.corpusSha256!==corpusHash)throw Error('Checkpoint does not match this training corpus');
  const combined=Object.hasOwn(receipt,'auxiliarySha256')||Object.hasOwn(receipt,'lineageFingerprint');
  if(!['primary','auxiliary'].includes(viewCorpus)||(viewCorpus==='auxiliary'&&reviewCorpus!=null))throw Error('Invalid diagnostic corpus view');
  if(combined&&!auxiliaryCorpus)throw Error('Matching auxiliary corpus is required for this checkpoint');
  if(!combined&&auxiliaryCorpus)throw Error('Checkpoint does not match an auxiliary corpus');
  if(viewCorpus==='auxiliary'&&!combined)throw Error('Auxiliary corpus is required for auxiliary diagnostics');
  const auxiliaryPath=combined?resolve(auxiliaryCorpus):null;
  const auxiliaryHash=combined?trainingFileIdentity(auxiliaryPath):null;
  if(combined&&receipt.auxiliarySha256!==auxiliaryHash)throw Error('Auxiliary corpus does not match the checkpoint');
  const lineageFingerprint=combined?(internalScope?.corpusPath===corpusPath&&internalScope?.auxiliaryPath===auxiliaryPath&&
    internalScope.corpusHash===corpusHash&&internalScope.auxiliaryHash===auxiliaryHash?internalScope.lineageFingerprint:
    await corpusFingerprint(corpusPath,auxiliaryPath)):null;
  if(combined&&receipt.lineageFingerprint!==lineageFingerprint)throw Error('Combined corpus fingerprint differs from the checkpoint');
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
  const reviewed=reviewCorpus!=null,auxiliaryView=viewCorpus==='auxiliary';let sheet,annotation,checks,reviewPath,reviewHash,verified;
  if(reviewed){
    reviewPath=resolve(reviewCorpus);const bytes=readTrainingBounded(reviewPath,32*1024*1024);
    reviewHash=createHash('sha256').update(bytes).digest('hex');const reviewManifest=JSON.parse(bytes);
    if(!Array.isArray(reviewManifest.sheets))throw Error('Reviewed corpus sheets required');
    const matches=reviewManifest.sheets.filter(value=>value?.id===sourceId);
    if(matches.length!==1)throw Error('Unique reviewed source required');
    await validateReviewedCorpus({...reviewManifest,sheets:matches},dirname(reviewPath),{signal,workspace,reviewDirectory,onVerified:value=>{verified=value;}});
    ({sheet,annotation}=verified);
  }else if(auxiliaryView){
    const auxiliaryManifest=JSON.parse(readTrainingBounded(auxiliaryPath,32*1024*1024));
    const matches=auxiliaryManifest.sheets?.filter(value=>value?.id===sourceId);
    if(!Array.isArray(matches)||matches.length!==1)throw Error('Unique auxiliary source identity required');
    const validated=await validateSemapTrainingCorpus({...auxiliaryManifest,sheets:matches},dirname(auxiliaryPath),{signal});
    ({sheet,annotation,checks}=validated.sources[0]);
  }else{
    if(manifest.schemaVersion!==1||manifest.trainingOnly!==true||!Array.isArray(manifest.sheets))
      throw Error('Explicit private training-only corpus required');
    const matches=manifest.sheets?.filter(value=>value?.id===sourceId);
    if(!Array.isArray(matches)||matches.length!==1)throw Error('Unique training source identity required');
    const candidate=JSON.parse(readTrainingBounded(await resolveCorpusPath(root,matches[0].annotations),64*1024*1024));
    if(candidate.origin==='publisher-layer-export')
      ({sheet,annotation,checks}=await validatePublisherTrainingSource({root,corpus:manifest,sourceId},{signal,workspace,imageDirectory}));
    else ({sheet,annotation,checks}=await verifiedMacroTrainingSource(root,manifest,sourceId));
    recheckMacroTrainingSource(checks);
  }
  const sourceRoot=reviewed?dirname(reviewPath):auxiliaryView?dirname(auxiliaryPath):root;
  const selected=await selectDiagnosticTile({root:sourceRoot,annotation},{signal,workspace,imageDirectory,reviewDirectory});
  if(!selected)throw Error('Source has no supervised diagnostic tile');
  const {x,y,index}=selected,path=reviewed?verified.imagePath:await resolveCorpusPath(sourceRoot,sheet.image),format=({'.png':'png','.jpg':'jpeg','.jpeg':'jpeg','.webp':'webp'})[extname(path).toLowerCase()];
  if(!format)throw Error('Supported training image required');
  const [tensors,image]=await Promise.all([
    reviewed?prepareReviewedTrainingTile({imagePath:path,sourceSha256:sheet.sha256,annotation,x,y,augment:false,epoch:0,index},{signal,workspace,imageDirectory,reviewDirectory}):
      prepareRasterTrainingTile({root:sourceRoot,imagePath:sheet.image,sourceSha256:sheet.sha256,annotation,x,y,augment:false,epoch:0,index},{signal,workspace,imageDirectory}),
    readNativeTrainingRaster({path,format,expectedSha256:sheet.sha256,x,y},{signal,workspace,directory:imageDirectory})]);
  const original=Buffer.alloc(512*512*3);for(let i=0;i<512*512;i++){original[i*3]=image.tile[i*4];original[i*3+1]=image.tile[i*4+1];original[i*3+2]=image.tile[i*4+2];}
  const diagnostic=await diagnoseNativeTrainingTile({checkpoint:checkpointPath,baselineWeights:baselinePath,...tensors,original,device,torchLibrary},
    {signal,workspace,imageDirectory,evaluationDirectory,batchDirectory});
  let parity;
  if(captureParity){
    const inference=await nativeTrainingCheckpointInfer({checkpoint:checkpointPath,tile:tensors.tile,overview:tensors.overview,position:tensors.position,
      device,torchLibrary,output:'logits',signal,root:workspace,directory:batchDirectory});
    if(inference.checkpointSha256!==diagnostic.checkpointSha256)throw Error('Checkpoint changed while preparing ONNX inputs');
    parity={tile:tensors.tile,overview:tensors.overview,position:tensors.position,expectedLogits:inference.logits};
  }
  const preview=await renderDiagnosticJpeg({original,panels:diagnostic.panels,reviewed},{signal,workspace,imageDirectory,previewDirectory});
  if(reviewed){
    if(trainingFileIdentity(reviewPath)!==reviewHash||trainingFileIdentity(verified.annotationPath)!==verified.annotationSha256||
      trainingFileIdentity(path,{maxBytes:Number.MAX_SAFE_INTEGER})!==sheet.sha256)
      throw Error('Reviewed inputs changed during diagnostic');
  }else recheckMacroTrainingSource(checks);
  if(trainingFileIdentity(corpusPath)!==corpusHash||trainingFileIdentity(checkpointPath)!==checkpointHash||trainingFileIdentity(receiptPath)!==receiptHash)
    throw Error('Training inputs changed during diagnostic');
  if(combined&&(trainingFileIdentity(auxiliaryPath)!==auxiliaryHash||(!internalScope&&await corpusFingerprint(corpusPath,auxiliaryPath)!==lineageFingerprint)))
    throw Error('Combined training inputs changed during diagnostic');
  if(baselinePath&&(trainingFileIdentity(baselinePath)!==baselineHash||trainingFileIdentity(transferPath)!==transferHash))throw Error('Baseline changed during diagnostic');
  return {sourceId,tileIndex:index,pixelOrigin:[x,y],channels:diagnostic.channels,baselineChannels:diagnostic.baselineChannels,
    baselineWeightsSha256:diagnostic.baselineWeightsSha256,baselineOriginalCheckpointSha256:baselinePath?(receipt.initializationSourceSha256??null):null,
    jpeg:preview.data,checkpointSha256:checkpointHash,corpusSha256:corpusHash,...(combined?{auxiliaryCorpusSha256:auxiliaryHash,lineageFingerprint,viewCorpus}:{}),
    ...(reviewed?{reviewCorpusSha256:reviewHash,sourceSplit:sheet.split,diagnosticOnly:true}:{}),
    ...(parity?{parity}:{}),trainingOnly:true,independentEvaluation:false,releaseApproved:false};
}

export function diagnoseMacroTrainingSource(request,options){return diagnoseSource(request,options);}
export function diagnoseReviewedSource(request,options){
  if(!request.reviewCorpus)throw Error('Explicit reviewed corpus required');
  return diagnoseSource(request,options);
}

// Diagnostic only: no ONNX parity, held-out evaluation, or model admission is implied.
export async function diagnoseTrainingCorpus({corpus,auxiliaryCorpus,viewCorpus='primary',reviewCorpus,checkpoint,baselineWeights,output,device,torchLibrary,maximumPreviews=24},options={}){
  const {signal}=options;signal?.throwIfAborted();
  if(!corpus||!checkpoint||!output||!torchLibrary||!['cpu','cuda'].includes(device)||
    !Number.isSafeInteger(maximumPreviews)||maximumPreviews<0||maximumPreviews>1024)
    throw Error('Explicit bounded corpus diagnostic inputs required');
  if(!['primary','auxiliary'].includes(viewCorpus)||(viewCorpus==='auxiliary'&&reviewCorpus!=null))throw Error('Invalid diagnostic corpus view');
  if(viewCorpus==='auxiliary'&&!auxiliaryCorpus)throw Error('Auxiliary corpus required for auxiliary diagnostics');
  const target=resolve(output);if(existsSync(target))throw Error('Diagnostic output exists; preserve prior evidence');
  const viewPath=resolve(reviewCorpus||(viewCorpus==='auxiliary'?auxiliaryCorpus:corpus)),viewBytes=readTrainingBounded(viewPath,32*1024*1024);
  const viewHash=createHash('sha256').update(viewBytes).digest('hex'),view=JSON.parse(viewBytes);
  if(!Array.isArray(view.sheets)||!view.sheets.length||view.sheets.length>100000)throw Error('Nonempty bounded diagnostic sources required');
  if(!reviewCorpus&&view.trainingOnly!==true)throw Error('Training-only corpus required');
  const ids=view.sheets.map(sheet=>sheet?.id);
  if(ids.some(id=>typeof id!=='string'||!id||id.length>512||id==='.'||id==='..'||/[\\/\u0000-\u001f]/u.test(id)))
    throw Error('Safe diagnostic source identifiers required');
  if(new Set(ids).size!==ids.length)throw Error('Unique diagnostic sources required');
  const checkpointPath=resolve(checkpoint),receiptPath=checkpointPath+'.receipt.json',corpusPath=resolve(corpus);
  const checkpointHash=trainingFileIdentity(checkpointPath),receiptHash=trainingFileIdentity(receiptPath),corpusHash=trainingFileIdentity(corpusPath);
  const rows=[];let created=false,internalScope=null;
  for(const sourceId of ids){
    signal?.throwIfAborted();
    const result=await diagnoseSource({corpus,auxiliaryCorpus,viewCorpus,...(reviewCorpus?{reviewCorpus}:{}),checkpoint,baselineWeights,sourceId,device,torchLibrary,
      captureParity:rows.length===0},options,internalScope||(auxiliaryCorpus?{}:null));
    if(result.checkpointSha256!==checkpointHash||result.corpusSha256!==corpusHash||
      (reviewCorpus&&result.reviewCorpusSha256!==viewHash))throw Error('Diagnostic inputs differ across sources');
    if(auxiliaryCorpus&&!internalScope)internalScope={corpusPath,auxiliaryPath:resolve(auxiliaryCorpus),corpusHash,
      auxiliaryHash:result.auxiliaryCorpusSha256,lineageFingerprint:result.lineageFingerprint};
    const {jpeg,parity,...row}=result,previewFile=rows.length<maximumPreviews?`preview-${String(rows.length+1).padStart(4,'0')}.jpg`:null;
    if(!created){await mkdir(target);created=true;}
    if(parity){for(const [name,bytes] of Object.entries({'tile.f32':parity.tile,'overview.f32':parity.overview,
      'position.f32':parity.position,'expected-logits.f32':parity.expectedLogits}))await writeFile(join(target,name),bytes,{flag:'wx',signal});}
    if(previewFile)await writeFile(join(target,previewFile),jpeg,{flag:'wx',signal});
    rows.push({...row,previewFile});
  }
  if(trainingFileIdentity(viewPath)!==viewHash||trainingFileIdentity(corpusPath)!==corpusHash||
    trainingFileIdentity(checkpointPath)!==checkpointHash||trainingFileIdentity(receiptPath)!==receiptHash)
    throw Error('Diagnostic checkpoint or corpus changed during execution');
  if(internalScope&&(trainingFileIdentity(internalScope.auxiliaryPath)!==internalScope.auxiliaryHash||
    await corpusFingerprint(corpusPath,internalScope.auxiliaryPath)!==internalScope.lineageFingerprint))
    throw Error('Combined training inputs changed during diagnostic');
  const report={schemaVersion:1,purpose:reviewCorpus?'source-reviewed-diagnostic':'training-set-diagnostic-only',
    trainingOnly:true,independentEvaluation:false,releaseApproved:false,onnxParityVerified:false,
    checkpointSha256:rows[0].checkpointSha256,corpusSha256:rows[0].corpusSha256,
    ...(internalScope?{auxiliaryCorpusSha256:internalScope.auxiliaryHash,lineageFingerprint:internalScope.lineageFingerprint,viewCorpus}:{}),
    ...(reviewCorpus?{reviewCorpusSha256:viewHash}:{}),sheets:rows};
  await writeFile(join(target,'diagnostics.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',signal});return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const controller=new AbortController(),abort=()=>controller.abort();
  if(['--macro-source','--reviewed-source','--corpus-sources'].includes(process.argv[2])){
    process.once('SIGINT',abort);process.once('SIGTERM',abort);
  }
  try{
    if(['--macro-source','--reviewed-source','--corpus-sources'].includes(process.argv[2])){
      const batch=process.argv[2]==='--corpus-sources',reviewed=process.argv[2]==='--reviewed-source';
      const {values,positionals}=parseArgs({args:process.argv.slice(3),allowPositionals:true,options:{corpus:{type:'string'},source:{type:'string'},
        'auxiliary-corpus':{type:'string'},'view-corpus':{type:'string'},
        'review-corpus':{type:'string'},checkpoint:{type:'string'},'baseline-weights':{type:'string'},output:{type:'string'},device:{type:'string'},
        'torch-library':{type:'string'},'maximum-previews':{type:'string'}}});
      if(positionals.length||!values.corpus||(!batch&&!values.source)||(batch&&values.source)||!values.checkpoint||!values.output||!values.device||!values['torch-library']||
        (!batch&&reviewed!==Boolean(values['review-corpus']))||(!batch&&values['maximum-previews']!==undefined))
        throw Error('Expected --macro-source, --reviewed-source or --corpus-sources with explicit corpus, checkpoint, output, device and LibTorch; single-source modes require --source');
      const output=resolve(reportArgument(values.output,{access:'write'}));
      if(existsSync(output))throw Error('Diagnostic output exists; preserve prior evidence');
      if(batch){
        const count=values['maximum-previews']??'24';if(!/^\d+$/.test(count))throw Error('Invalid preview budget');
        const result=await diagnoseTrainingCorpus({corpus:reportArgument(values.corpus,{access:'read',siblings:true}),
          auxiliaryCorpus:reportArgument(values['auxiliary-corpus'],{access:'read',siblings:true}),viewCorpus:values['view-corpus']||'primary',
          reviewCorpus:reportArgument(values['review-corpus'],{access:'read',siblings:true}),checkpoint:reportArgument(values.checkpoint,{access:'read',siblings:true}),
          baselineWeights:reportArgument(values['baseline-weights'],{access:'read',siblings:true}),output,device:values.device,
          torchLibrary:values['torch-library'],maximumPreviews:Number(count)},{signal:controller.signal});
        process.stdout.write(JSON.stringify({output,sheets:result.sheets.length,purpose:result.purpose,releaseApproved:false,onnxParityVerified:false})+'\n');
      }else{
      const result=await diagnoseSource({corpus:reportArgument(values.corpus,{access:'read',siblings:true}),
        auxiliaryCorpus:reportArgument(values['auxiliary-corpus'],{access:'read',siblings:true}),viewCorpus:values['view-corpus']||'primary',
        ...(reviewed?{reviewCorpus:reportArgument(values['review-corpus'],{access:'read',siblings:true})}:{}),sourceId:values.source,
        checkpoint:reportArgument(values.checkpoint,{access:'read',siblings:true}),baselineWeights:reportArgument(values['baseline-weights'],{access:'read',siblings:true}),
        device:values.device,torchLibrary:values['torch-library']},{signal:controller.signal});
      const {jpeg,...diagnostic}=result;
      await mkdir(output);await writeFile(resolve(output,'preview.jpg'),jpeg,{flag:'wx'});
      const purpose=reviewed?'source-reviewed-diagnostic':'training-set-diagnostic-only';
      await writeFile(resolve(output,'diagnostics.json'),JSON.stringify({...diagnostic,purpose,previewFile:'preview.jpg'},null,2)+'\n',{flag:'wx'});
      process.stdout.write(JSON.stringify({output,sourceId:result.sourceId,purpose,releaseApproved:false})+'\n');
      process.exitCode=0;
      }
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
  finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
