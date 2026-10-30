// Binary boundary for native training-diagnostic overlay composition.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {composeNativeDiagnosticOverlays,encodeNativeJpeg} from '../map-image/native-resample.mjs';
import {drawNativePreviewLabels} from '../map-image/native-preview.mjs';
import {diagnosticPixelStatistics} from './native-evaluation.mjs';
import {nativeTrainingCheckpointInfer} from './native-training-validation.mjs';

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

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
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
  }catch(error){console.error('native-diagnostic-preview: '+error.message);process.exitCode=1;}
}
