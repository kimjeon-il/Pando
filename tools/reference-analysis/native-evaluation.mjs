import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {REFERENCE_BOUNDARY_CHANNELS as CHANNELS} from '../../plugins/pando-map-tools/lib/analysis/tiles.mjs';
import {verifyNativeTool} from '../native-tool.mjs';
import {reviewMasks} from './review-masks.mjs';
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
export async function evaluateBoundaries(prediction,annotation,{signal,workspace=root,directory=process.env.PANDO_MAP_EVALUATION_ARTIFACT||resolve(workspace,'build-native/map-evaluation/artifact'),reviewDirectory}={}){
  signal?.throwIfAborted();const width=annotation?.width,height=annotation?.height,size=width*height;
  if(!Buffer.isBuffer(prediction)||!Number.isSafeInteger(size)||prediction.length!==size||prediction.some(v=>v&~7))throw Error('Prediction must use original sheet pixels and three packed channels');
  const masks=await reviewMasks(annotation,{signal,workspace,directory:reviewDirectory});
  const lines=(annotation.lines||[]).filter(line=>CHANNELS.indexOf(line.kind)<3);
  let bytes=12+size*3;for(const line of lines)bytes+=16+line.points.length*8;
  if(bytes>64*1024*1024)throw Error('Boundary evaluation exceeds byte budget');
  const input=Buffer.alloc(bytes);let at=0;const u=value=>{input.writeUInt32BE(value,at);at+=4;},i=value=>{input.writeInt32BE(value,at);at+=4;};
  u(width);u(height);u(lines.length);for(const plane of [masks.targetBits,masks.knownBits,prediction]){plane.copy(input,at);at+=size;}
  for(const line of lines){u(CHANNELS.indexOf(line.kind));input.writeDoubleBE(Math.max(2,line.width/2),at);at+=8;u(line.points.length);
    for(const point of line.points){i(Math.trunc(point[0]));i(Math.trunc(point[1]));}}
  const executable=process.platform==='win32'?'pando-map-evaluation.exe':'pando-map-evaluation';
  const {binary}=verifyNativeTool({root:workspace,directory,target:'map-evaluation',executable,sourceFiles:evaluationSourceFiles});
  const result=await invoke(binary,input,signal);const metrics={};
  for(let c=0;c<3;c++){const [matchedPrediction,predicted,matchedReference,reference]=result.counts[c];
    metrics[CHANNELS[c]]={precision:predicted?matchedPrediction/predicted:null,recall:reference?matchedReference/reference:null,matchedPrediction,predicted,matchedReference,reference};}
  const confounders={};for(let k=3;k<7;k++){const group={};for(let c=0;c<3;c++){
    const [falsePositive,pixels]=result.confounderCounts[k-3][c];group[CHANNELS[c]]={falsePositive,pixels,rate:pixels?falsePositive/pixels:null};}confounders[CHANNELS[k]]=group;}
  return {counts:result.counts,metrics,confounders};
}
export async function evaluateIndependentSheet(prediction,annotation,{sheet,lineage,split='test',...options}={}){
  if(!sheet)throw Error('Independent evaluation requires source identity');
  assertEvaluationIndependence(lineage,[sheet],{split});
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
