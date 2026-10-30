// Binary boundary for native training-diagnostic overlay composition.
import {dirname,extname,resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {reportArgument} from '../report-paths.mjs';
import {composeNativeDiagnosticOverlays,encodeNativeJpeg,readNativeTrainingRaster} from '../map-image/native-resample.mjs';
import {drawNativePreviewLabels} from '../map-image/native-preview.mjs';
import {diagnosticPixelStatistics} from './native-evaluation.mjs';
import {nativeTrainingCheckpointInfer} from './native-training-validation.mjs';
import {readTrainingBounded,trainingFileIdentity} from './training-evidence.mjs';
import {verifiedMacroTrainingSource,recheckMacroTrainingSource} from './macro-training-source.mjs';
import {selectDiagnosticTile} from './diagnostic-selection.mjs';
import {prepareRasterTrainingTile} from './training-tiles.mjs';
import {resolveCorpusPath} from './corpus-path.mjs';

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

export async function diagnoseNativeTrainingTile({checkpoint,tile,overview,position,target,valid,original,device,torchLibrary},
  {signal,workspace,imageDirectory,evaluationDirectory,batchDirectory}={}){
  const inference=await nativeTrainingCheckpointInfer({checkpoint,tile,overview,position,device,torchLibrary,output:'probabilities',
    signal,root:workspace,directory:batchDirectory});
  const diagnostic=await summarizeDiagnosticTile({width:512,height:512,original,probability:inference.probabilities,target,valid},
    {signal,workspace,imageDirectory,evaluationDirectory});
  return {...diagnostic,probabilities:inference.probabilities,checkpointSha256:inference.checkpointSha256,toolRevision:inference.toolRevision};
}

export async function renderDiagnosticJpeg({original,panels},{signal,workspace,imageDirectory,previewDirectory}={}){
  signal?.throwIfAborted();const size=512*512*3;
  if(!(original instanceof Uint8Array)||original.length!==size||!Array.isArray(panels)||![2,3].includes(panels.length)||
    panels.some(panel=>!(panel instanceof Uint8Array)||panel.length!==size))throw Error('Original and diagnostic RGB panels required');
  const sources=[original,...panels],width=sources.length*512,height=540,data=Buffer.alloc(width*height*4,255);
  for(let panel=0;panel<sources.length;panel++)for(let y=0;y<512;y++){
    if((y&63)===0)signal?.throwIfAborted();
    for(let x=0;x<512;x++){const src=(y*512+x)*3,dst=((y+28)*width+panel*512+x)*4;
      data[dst]=sources[panel][src];data[dst+1]=sources[panel][src+1];data[dst+2]=sources[panel][src+2];}
  }
  const titles=['Real map input','Source training target',...(panels.length===3?['Before continuation']:[]),'Trained prediction (threshold 0.55)'];
  const labelled=await drawNativePreviewLabels({width,height,data},titles.map((text,i)=>({x:i*512+8,y:8,text})),
    {signal,workspace,directory:previewDirectory});
  return encodeNativeJpeg(labelled,{signal,workspace,directory:imageDirectory});
}

// Inspect one explicitly selected macro source; the result is training-only.
export async function diagnoseMacroTrainingSource({corpus,sourceId,checkpoint,device,torchLibrary},
  {signal,workspace,imageDirectory,previewDirectory,evaluationDirectory,batchDirectory}={}){
  signal?.throwIfAborted();
  if(!corpus||!checkpoint||typeof sourceId!=='string'||!sourceId||!torchLibrary||!['cpu','cuda'].includes(device))
    throw Error('Explicit macro source, checkpoint and device required');
  const corpusPath=resolve(corpus),root=dirname(corpusPath),checkpointPath=resolve(checkpoint),receiptPath=checkpointPath+'.receipt.json';
  const corpusHash=trainingFileIdentity(corpusPath),checkpointHash=trainingFileIdentity(checkpointPath),receiptHash=trainingFileIdentity(receiptPath);
  const manifest=JSON.parse(readTrainingBounded(corpusPath,32*1024*1024)),receipt=JSON.parse(readTrainingBounded(receiptPath,1024*1024));
  if(receipt.schemaVersion!==1||receipt.trainingOnly!==true||receipt.releaseApproved!==false||receipt.device!==device||
    receipt.checkpointSha256!==checkpointHash||receipt.corpusSha256!==corpusHash)throw Error('Checkpoint does not match this training corpus');
  const {sheet,annotation,checks}=await verifiedMacroTrainingSource(root,manifest,sourceId);recheckMacroTrainingSource(checks);
  const selected=await selectDiagnosticTile({root,annotation},{signal,workspace,imageDirectory});
  if(!selected)throw Error('Training source has no supervised diagnostic tile');
  const {x,y,index}=selected,path=await resolveCorpusPath(root,sheet.image),format=({'.png':'png','.jpg':'jpeg','.jpeg':'jpeg','.webp':'webp'})[extname(path).toLowerCase()];
  if(!format)throw Error('Supported training image required');
  const [tensors,image]=await Promise.all([
    prepareRasterTrainingTile({root,imagePath:sheet.image,sourceSha256:sheet.sha256,annotation,x,y,augment:false,epoch:0,index},{signal,workspace,imageDirectory}),
    readNativeTrainingRaster({path,format,expectedSha256:sheet.sha256,x,y},{signal,workspace,directory:imageDirectory})]);
  const original=Buffer.alloc(512*512*3);for(let i=0;i<512*512;i++){original[i*3]=image.tile[i*4];original[i*3+1]=image.tile[i*4+1];original[i*3+2]=image.tile[i*4+2];}
  const diagnostic=await diagnoseNativeTrainingTile({checkpoint:checkpointPath,...tensors,original,device,torchLibrary},
    {signal,workspace,imageDirectory,evaluationDirectory,batchDirectory});
  const preview=await renderDiagnosticJpeg({original,panels:diagnostic.panels},{signal,workspace,imageDirectory,previewDirectory});
  recheckMacroTrainingSource(checks);
  if(trainingFileIdentity(corpusPath)!==corpusHash||trainingFileIdentity(checkpointPath)!==checkpointHash||trainingFileIdentity(receiptPath)!==receiptHash)
    throw Error('Training inputs changed during diagnostic');
  return {sourceId,tileIndex:index,pixelOrigin:[x,y],channels:diagnostic.channels,jpeg:preview.data,checkpointSha256:checkpointHash,corpusSha256:corpusHash,
    trainingOnly:true,independentEvaluation:false,releaseApproved:false};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv[2]==='--macro-source'){
      const {values,positionals}=parseArgs({args:process.argv.slice(3),allowPositionals:true,options:{corpus:{type:'string'},source:{type:'string'},
        checkpoint:{type:'string'},output:{type:'string'},device:{type:'string'},'torch-library':{type:'string'}}});
      if(positionals.length||!values.corpus||!values.source||!values.checkpoint||!values.output||!values.device||!values['torch-library'])
        throw Error('Expected --macro-source --corpus MANIFEST --source ID --checkpoint PATH --output DIRECTORY --device cpu|cuda --torch-library DIRECTORY');
      const output=resolve(reportArgument(values.output,{access:'write'}));
      if(existsSync(output))throw Error('Diagnostic output exists; preserve prior evidence');
      const result=await diagnoseMacroTrainingSource({corpus:reportArgument(values.corpus,{access:'read',siblings:true}),sourceId:values.source,
        checkpoint:reportArgument(values.checkpoint,{access:'read'}),device:values.device,torchLibrary:values['torch-library']});
      const {jpeg,...diagnostic}=result;
      await mkdir(output);await writeFile(resolve(output,'preview.jpg'),jpeg,{flag:'wx'});
      await writeFile(resolve(output,'diagnostics.json'),JSON.stringify({...diagnostic,purpose:'training-set-diagnostic-only',previewFile:'preview.jpg'},null,2)+'\n',{flag:'wx'});
      process.stdout.write(JSON.stringify({output,sourceId:result.sourceId,purpose:'training-set-diagnostic-only',releaseApproved:false})+'\n');
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
