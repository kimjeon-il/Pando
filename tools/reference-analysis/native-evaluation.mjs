import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {REFERENCE_BOUNDARY_CHANNELS as CHANNELS} from '../../plugins/pando-map-tools/lib/analysis/tiles.mjs';
import {verifyNativeTool} from '../native-tool.mjs';
import {reviewMasks,validateReviewedAnnotation} from './review-masks.mjs';
import {assertEvaluationIndependence} from './training-lineage.mjs';

export const evaluationSourceFiles=Object.freeze(['tools/cpp/map-evaluation/CMakeLists.txt','tools/cpp/map-evaluation/evaluation.cpp',
  'tools/cpp/map-image/raster-draw.h','tools/cpp/map-preview/PILLOW-LICENSE']);
const root=fileURLToPath(new URL('../../',import.meta.url));
function invoke(binary,input,signal){return new Promise((accept,reject)=>{
  const child=spawn(binary,[],{stdio:['pipe','pipe','pipe'],windowsHide:true,signal:signal||undefined}),out=[],errors=[];
  let size=0,errorSize=0,done=false;const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):accept(value);};
  const timer=setTimeout(()=>{child.kill();finish(Error('Boundary evaluation timed out'));},120000);
  child.on('error',error=>finish(error));child.stdin.on('error',()=>{});
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>65536){child.kill();finish(Error('Boundary evaluation output exceeds budget'));}else out.push(chunk);});
  child.stderr.on('data',chunk=>{errorSize+=chunk.length;if(errorSize<=65536)errors.push(chunk);});
  child.on('close',(code,reason)=>{if(code!==0||reason)return finish(Error('Native boundary evaluation failed: '+Buffer.concat(errors).toString('utf8')));
    try{finish(null,JSON.parse(Buffer.concat(out).toString('utf8')));}catch(error){finish(error);}});
  child.stdin.end(input);
});}
export async function diagnosticPixelStatistics({width,height,probability,target,known},
  {signal,workspace=root,directory=process.env.PANDO_MAP_EVALUATION_ARTIFACT||resolve(workspace,'build-native/map-evaluation/artifact')}={}){
  signal?.throwIfAborted();const pixels=width*height,values=pixels*7;
  if(![width,height].every(value=>Number.isSafeInteger(value)&&value>0&&value<=16384)||values>11000000||
    !(probability instanceof Uint8Array)||probability.length!==values*4||
    ![target,known].every(value=>value instanceof Uint8Array&&value.length===values))
    throw Error('Explicit diagnostic tensors with matching dimensions are required');
  const header=Buffer.alloc(16);header.write('PDIAG001');header.writeUInt32BE(width,8);header.writeUInt32BE(height,12);
  const executable=process.platform==='win32'?'pando-map-evaluation.exe':'pando-map-evaluation';
  const {binary}=verifyNativeTool({root:workspace,directory,target:'map-evaluation',executable,sourceFiles:evaluationSourceFiles});
  const result=await invoke(binary,Buffer.concat([header,probability,target,known]),signal);
  if(!result||typeof result!=='object'||CHANNELS.some(name=>!result[name]||
    !['supervisedPixels','targetPixels','predictedPixels','overlapPixels','probabilityMin','probabilityMax'].every(key=>Number.isFinite(result[name][key]))))
    throw Error('Invalid native diagnostic statistics');
  return result;
}
async function evaluateWindow(prediction,annotation,{signal,workspace,directory,reviewDirectory,window,core}){
  const [originX,originY,width,height]=window??[0,0,annotation.width,annotation.height],size=width*height;
  const masks=await reviewMasks(annotation,{window:window??null,fullSheetCoordinates:Boolean(window),signal,workspace,directory:reviewDirectory});
  const lines=(annotation.lines||[]).filter(line=>CHANNELS.indexOf(line.kind)<3);
  let bytes=(core?36:12)+size*3;for(const line of lines)bytes+=16+line.points.length*8;
  if(bytes>64*1024*1024)throw Error('Boundary evaluation exceeds byte budget');
  const input=Buffer.alloc(bytes);let at=0;const u=value=>{input.writeUInt32BE(value,at);at+=4;},i=value=>{input.writeInt32BE(value,at);at+=4;};
  if(core){input.write('PEVAL002',at);at+=8;}
  u(width);u(height);u(lines.length);if(core)for(const value of core)u(value);
  for(const plane of [masks.targetBits,masks.knownBits]){plane.copy(input,at);at+=size;}
  for(let y=0;y<height;y++){prediction.copy(input,at,(originY+y)*annotation.width+originX,(originY+y)*annotation.width+originX+width);at+=width;}
  for(const line of lines){u(CHANNELS.indexOf(line.kind));input.writeDoubleBE(Math.max(2,line.width/2),at);at+=8;u(line.points.length);
    for(const point of line.points){i(Math.trunc(point[0])-originX);i(Math.trunc(point[1])-originY);}}
  const executable=process.platform==='win32'?'pando-map-evaluation.exe':'pando-map-evaluation';
  const {binary}=verifyNativeTool({root:workspace,directory,target:'map-evaluation',executable,sourceFiles:evaluationSourceFiles});
  return invoke(binary,input,signal);
}
function evaluationResult(result){
  const metrics=metricsFromCounts(result.counts);
  const confounders={};for(let k=3;k<7;k++){const group={};for(let c=0;c<3;c++){
    const [falsePositive,pixels]=result.confounderCounts[k-3][c];group[CHANNELS[c]]={falsePositive,pixels,rate:pixels?falsePositive/pixels:null};}confounders[CHANNELS[k]]=group;}
  return {counts:result.counts,metrics,confounders};
}
function checkPrediction(prediction,annotation){const width=annotation?.width,height=annotation?.height,size=width*height;
  if(![width,height].every(value=>Number.isInteger(value)&&value>0&&value<=65535)||!Buffer.isBuffer(prediction)||!Number.isSafeInteger(size)||
    size>600000000||prediction.length!==size||prediction.some(v=>v&~7))throw Error('Prediction must use original sheet pixels and three packed channels');}
export async function evaluateBoundaries(prediction,annotation,{signal,workspace=root,directory=process.env.PANDO_MAP_EVALUATION_ARTIFACT||resolve(workspace,'build-native/map-evaluation/artifact'),reviewDirectory}={}){
  signal?.throwIfAborted();checkPrediction(prediction,annotation);
  return evaluationResult(await evaluateWindow(prediction,annotation,{signal,workspace,directory,reviewDirectory}));
}
export async function evaluateBoundariesTiled(prediction,annotation,{signal,workspace=root,directory=process.env.PANDO_MAP_EVALUATION_ARTIFACT||resolve(workspace,'build-native/map-evaluation/artifact'),reviewDirectory}={}){
  signal?.throwIfAborted();checkPrediction(prediction,annotation);const {width,height}=annotation;
  const radii=(annotation.lines||[]).filter(line=>CHANNELS.indexOf(line.kind)>=0&&CHANNELS.indexOf(line.kind)<3).map(line=>Math.max(2,line.width/2));
  if(radii.some(radius=>!Number.isFinite(radius)||radius<2))throw Error('Invalid evaluation tolerance');
  const halo=Math.ceil(radii.reduce((maximum,value)=>Math.max(maximum,value),2));if(halo>2046)throw Error('Evaluation tolerance exceeds bounded-window limit');
  const step=Math.min(1024,4094-2*halo),counts=Array.from({length:3},()=>[0,0,0,0]),confounderCounts=Array.from({length:4},()=>Array.from({length:3},()=>[0,0]));
  for(let y=0;y<height;y+=step)for(let x=0;x<width;x+=step){
    signal?.throwIfAborted();const cw=Math.min(step,width-x),ch=Math.min(step,height-y),left=Math.max(0,x-halo),top=Math.max(0,y-halo);
    const right=Math.min(width,x+cw+halo),bottom=Math.min(height,y+ch+halo);
    const part=await evaluateWindow(prediction,annotation,{signal,workspace,directory,reviewDirectory,window:[left,top,right-left,bottom-top],core:[x-left,y-top,cw,ch]});
    for(let c=0;c<3;c++)for(let i=0;i<4;i++)counts[c][i]+=part.counts[c][i];
    for(let k=0;k<4;k++)for(let c=0;c<3;c++)for(let i=0;i<2;i++)confounderCounts[k][c][i]+=part.confounderCounts[k][c][i];
  }
  return evaluationResult({counts,confounderCounts});
}
export function metricsFromCounts(counts){
  if(!Array.isArray(counts)||counts.length!==3||counts.some(row=>!Array.isArray(row)||row.length!==4||
    row.some(value=>!Number.isSafeInteger(value)||value<0)||row[0]>row[1]||row[2]>row[3]))throw Error('Invalid boundary evaluation counts');
  const metrics={};for(let c=0;c<3;c++){const [matchedPrediction,predicted,matchedReference,reference]=counts[c];
    metrics[CHANNELS[c]]={precision:predicted?matchedPrediction/predicted:null,recall:reference?matchedReference/reference:null,matchedPrediction,predicted,matchedReference,reference};}
  return metrics;
}
export async function evaluateIndependentSheet(prediction,annotation,{sheet,lineage,split='test',...options}={}){
  if(!sheet)throw Error('Independent evaluation requires source identity');
  assertEvaluationIndependence(lineage,[sheet],{split});
  await validateReviewedAnnotation(annotation,sheet,{signal:options.signal,workspace:options.workspace,directory:options.reviewDirectory});
  return evaluateBoundaries(prediction,annotation,options);
}
export function boundaryAdmission(perSheet,{requiredChannels=[]}={}){
  const macro={},failures=[];
  for(const kind of CHANNELS.slice(0,3)){
    const rows=[];for(const [sheet,values] of Object.entries(perSheet)){const row=values[kind];
      if(row.reference){const precision=row.precision||0,recall=row.recall||0;rows.push([precision,recall]);if(precision<.90||recall<.75)failures.push({sheet,channel:kind,reason:'per-map-floor'});}
      else if(row.predicted)failures.push({sheet,channel:kind,reason:'false-positive-in-known-negative-area'});}
    const precision=rows.length?rows.reduce((sum,row)=>sum+row[0],0)/rows.length:null,recall=rows.length?rows.reduce((sum,row)=>sum+row[1],0)/rows.length:null;
    macro[kind]={precision,recall,positiveMaps:rows.length};
    if(rows.length&&(precision<.95||recall<.85))failures.push({channel:kind,reason:'map-macro-threshold'});
    if(!rows.length&&requiredChannels.includes(kind))failures.push({channel:kind,reason:'missing-independent-positive-truth'});
  }
  if(!Object.values(macro).some(row=>row.positiveMaps))failures.push({reason:'no-independent-positive-truth'});
  return {passed:!failures.length,macro,failures,mapCount:Object.keys(perSheet).length,thresholds:{macroPrecision:.95,macroRecall:.85,mapPrecision:.90,mapRecall:.75}};
}
function sameKeys(a,b){return b&&typeof b==='object'&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k));}
export function confounderNonregression(candidate,baseline){
  const failures=[];let measured=0;
  if(!sameKeys(candidate,baseline))return {passed:false,measured:0,failures:[{reason:'missing-or-different-baseline-scope'}]};
  for(const [sheet,groups] of Object.entries(candidate)){
    if(!sameKeys(groups,baseline[sheet])){failures.push({sheet,reason:'confounder-scope-differs'});continue;}
    for(const [kind,channels] of Object.entries(groups)){
      if(!sameKeys(channels,baseline[sheet][kind])){failures.push({sheet,channel:kind,reason:'boundary-channel-scope-differs'});continue;}
      for(const [channel,row] of Object.entries(channels)){const previous=baseline[sheet][kind][channel];
        if(row.pixels!==previous.pixels)failures.push({sheet,confounder:kind,channel,reason:'known-pixel-scope-differs'});
        else if(row.pixels){measured++;if(row.falsePositive>previous.falsePositive)failures.push({sheet,confounder:kind,channel,reason:'confounder-false-positive-regression'});}}
    }
  }
  if(!measured)failures.push({reason:'no-known-confounder-evidence'});return {passed:!failures.length,measured,failures};
}
export function summarizeEvaluation({groups,perSheet,confounders,baseline,requiredChannels}){
  if(!groups||typeof groups!=='object'||Array.isArray(groups)||!perSheet||typeof perSheet!=='object'||Array.isArray(perSheet)||
    !confounders||typeof confounders!=='object'||Array.isArray(confounders)||!Array.isArray(requiredChannels)||
    requiredChannels.some(name=>!CHANNELS.slice(0,3).includes(name)))throw Error('Explicit evaluation summary inputs required');
  const groupMetrics={};for(const [key,matrices] of Object.entries(groups)){
    if(!Array.isArray(matrices)||!matrices.length)throw Error('Evaluation group requires counts');
    const total=Array.from({length:3},()=>[0,0,0,0]);
    for(const matrix of matrices){metricsFromCounts(matrix);for(let c=0;c<3;c++)for(let i=0;i<4;i++){
      total[c][i]+=matrix[c][i];if(!Number.isSafeInteger(total[c][i]))throw Error('Evaluation count exceeds safe range');}}
    groupMetrics[key]=metricsFromCounts(total);
  }
  return {groups:groupMetrics,nonregression:confounderNonregression(confounders,baseline?.confounders??null),
    admission:boundaryAdmission(perSheet,{requiredChannels})};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3||!['--diagnostic-stream','--sheet-stream','--summary-stream'].includes(process.argv[2]))throw Error('Expected an evaluation stream operation');
    const chunks=[];let length=0;
    for await(const chunk of process.stdin){length+=chunk.length;if(length>65*1024*1024)throw Error('Evaluation input exceeds budget');chunks.push(chunk);}
    const bytes=Buffer.concat(chunks,length);
    if(process.argv[2]==='--summary-stream'){
      process.stdout.write(JSON.stringify(summarizeEvaluation(JSON.parse(bytes.toString('utf8'))))+'\n');
    }else if(process.argv[2]==='--sheet-stream'){
      if(bytes.length<4)throw Error('Truncated sheet evaluation request');
      const headerLength=bytes.readUInt32BE(0);if(!headerLength||headerLength>16*1024*1024||bytes.length<4+headerLength)throw Error('Invalid sheet evaluation header');
      const annotation=JSON.parse(bytes.subarray(4,4+headerLength).toString('utf8')),pixels=annotation?.width*annotation?.height;
      if(!Number.isSafeInteger(pixels)||pixels<1||pixels>16777216||bytes.length!==4+headerLength+pixels*3)throw Error('Invalid sheet prediction length');
      const planes=bytes.subarray(4+headerLength),prediction=Buffer.alloc(pixels);
      for(let i=0;i<pixels;i++){const a=planes[i],b=planes[pixels+i],c=planes[2*pixels+i];
        if(a>1||b>1||c>1)throw Error('Sheet prediction must be binary');prediction[i]=a|(b<<1)|(c<<2);}
      process.stdout.write(JSON.stringify(await evaluateBoundaries(prediction,annotation))+'\n');
    }else{
    if(bytes.length<16||bytes.toString('ascii',0,8)!=='PDIAG001')throw Error('Invalid diagnostic input');
    const width=bytes.readUInt32BE(8),height=bytes.readUInt32BE(12),values=width*height*7;
    if(!Number.isSafeInteger(values)||values>11000000||bytes.length!==16+values*6)throw Error('Invalid diagnostic input length');
    const probability=bytes.subarray(16,16+values*4),target=bytes.subarray(16+values*4,16+values*5),known=bytes.subarray(16+values*5);
    process.stdout.write(JSON.stringify(await diagnosticPixelStatistics({width,height,probability,target,known}))+'\n');
    }
  }catch(error){console.error('native-evaluation: '+error.message);process.exitCode=1;}
}
