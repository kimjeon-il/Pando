import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {REFERENCE_BOUNDARY_CHANNELS} from '../../plugins/pando-map-tools/lib/analysis/tiles.mjs';
import {verifyNativeTool} from '../native-tool.mjs';

export const reviewMaskSourceFiles=Object.freeze(['tools/cpp/map-review/CMakeLists.txt','tools/cpp/map-review/review-masks.cpp',
  'tools/cpp/map-image/raster-draw.h','tools/cpp/map-preview/PILLOW-LICENSE']);
const root=fileURLToPath(new URL('../../',import.meta.url));
function evenRound(value){const low=Math.floor(value),fraction=value-low;return fraction===.5?(low%2===0?low:low+1):Math.round(value);}
function encode(annotation,window){
  if(!annotation||!Number.isInteger(annotation.width)||!Number.isInteger(annotation.height)||annotation.width<1||annotation.height<1||annotation.width>65535||annotation.height>65535)
    throw Error('Original image dimensions required');
  if(!annotation.known||typeof annotation.known!=='object'||Array.isArray(annotation.known))throw Error('Explicit per-channel known regions required');
  const [x,y,width,height]=window??[0,0,annotation.width,annotation.height];
  if(![x,y,width,height].every(Number.isInteger)||Math.abs(x)>1000000||Math.abs(y)>1000000||width<1||height<1||width>16384||height>16384||width*height>16777216||
     x>=annotation.width||y>=annotation.height||x+width<=0||y+height<=0)throw Error('Invalid review window dimensions');
  const rows=[];let pointsCount=0;
  function shape(type,kind,points,lineWidth=0){
    const channel=kind===null?0:REFERENCE_BOUNDARY_CHANNELS.indexOf(kind);
    if(channel<0)throw Error('Unknown semantic annotation class');
    if(!Array.isArray(points)||points.length<(type===2?2:3))throw Error('Invalid review geometry');
    pointsCount+=points.length;if(pointsCount>1000000)throw Error('Review geometry exceeds point budget');
    const normalized=points.map(point=>{
      if(!Array.isArray(point)||point.length!==2||point.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw Error('Invalid review coordinate');
      const px=Math.trunc(point[0]-x),py=Math.trunc(point[1]-y);
      if(Math.abs(px)>1000000||Math.abs(py)>1000000)throw Error('Review coordinate exceeds budget');return [px,py];
    });
    rows.push({type,channel,width:lineWidth,points:normalized});
  }
  for(const [kind,polygons] of Object.entries(annotation.known)){
    if(!REFERENCE_BOUNDARY_CHANNELS.includes(kind))throw Error('Unknown semantic annotation class');
    if(!Array.isArray(polygons))throw Error('Invalid known regions');for(const polygon of polygons)shape(1,kind,polygon);
  }
  for(const line of annotation.lines||[]){
    if(typeof line.width!=='number'||!Number.isFinite(line.width))throw Error('Invalid line width');
    const lineWidth=Math.max(1,evenRound(line.width));if(lineWidth>65535)throw Error('Line width exceeds budget');
    shape(2,line.kind,line.points,lineWidth);
  }
  for(const region of annotation.regions||[])shape(3,region.kind,region.polygon);
  for(const polygon of annotation.ignore||[])shape(4,null,polygon);
  if(rows.length>1000000)throw Error('Review geometry exceeds command budget');
  const result=Buffer.alloc(28+rows.reduce((sum,row)=>sum+16+row.points.length*8,0));let offset=0;
  const u32=value=>{result.writeUInt32BE(value,offset);offset+=4;},i32=value=>{result.writeInt32BE(value,offset);offset+=4;};
  u32(annotation.width);u32(annotation.height);i32(x);i32(y);u32(width);u32(height);u32(rows.length);
  for(const row of rows){u32(row.type);u32(row.channel);u32(row.width);u32(row.points.length);for(const [px,py] of row.points){i32(px);i32(py);}}
  return {width,height,input:result};
}
function invoke(binary,input,expected,signal){return new Promise((accept,reject)=>{
  const child=spawn(binary,[],{stdio:['pipe','pipe','pipe'],windowsHide:true,signal:signal||undefined}),chunks=[],errors=[];
  let size=0,errorBytes=0,overflow=false,settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):accept(value);};
  const timer=setTimeout(()=>{child.kill();finish(Error('Review mask generation timed out'));},120000);
  child.on('error',e=>finish(e));child.stdin.on('error',()=>{});
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>expected){overflow=true;child.kill();}else chunks.push(chunk);});
  child.stderr.on('data',chunk=>{errorBytes+=chunk.length;if(errorBytes<=65536)errors.push(chunk);});
  child.on('close',(code,reason)=>code!==0||reason||overflow?finish(Error('Native review masks failed: '+Buffer.concat(errors).toString('utf8'))):finish(null,Buffer.concat(chunks,size)));
  child.stdin.end(input);
});}
export async function reviewMasks(annotation,{window=null,signal,workspace=root,directory=process.env.PANDO_MAP_REVIEW_ARTIFACT||resolve(workspace,'build-native/map-review/artifact')}={}){
  signal?.throwIfAborted();const {width,height,input}=encode(annotation,window);
  const executable=process.platform==='win32'?'pando-map-review.exe':'pando-map-review';
  const {binary}=verifyNativeTool({root:workspace,directory,target:'map-review',executable,sourceFiles:reviewMaskSourceFiles});
  const data=await invoke(binary,input,width*height*2,signal);if(data.length!==width*height*2)throw Error('Native review mask byte length mismatch');
  signal?.throwIfAborted();return {width,height,targetBits:data.subarray(0,width*height),knownBits:data.subarray(width*height)};
}
export async function validateReviewedAnnotation(annotation,sheet,options={}){
  if(annotation?.schemaVersion!==1||annotation.reviewed!==true)throw Error('Source-reviewed current annotations required');
  const review=annotation.review;
  if(!review||!['agent','human','source-published'].includes(review.kind)||!review.reviewer||
    typeof review.reviewedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T[^\s]+Z$/.test(review.reviewedAt))throw Error('Explicit source-review identity required');
  if(typeof sheet?.sha256!=='string'||!/^[a-f0-9]{64}$/.test(sheet.sha256)||review.sourceSha256!==sheet.sha256)
    throw Error('Review source hash differs from original image');
  if(review.predictionBlind!==true)throw Error('Prediction-blind source review required');
  const {width,height}=annotation;if(!Number.isInteger(width)||!Number.isInteger(height)||Math.min(width,height)<2)throw Error('Original image dimensions required');
  const points=(values,min)=>{
    if(!Array.isArray(values)||values.length<min||values.some(point=>!Array.isArray(point)||point.length!==2||
      point.some(value=>typeof value!=='number'||!Number.isFinite(value))||point[0]<0||point[0]>=width||point[1]<0||point[1]>=height))
      throw Error('Annotations must use finite original image pixels');
  };
  if(!annotation.known||typeof annotation.known!=='object'||Array.isArray(annotation.known)||!Object.keys(annotation.known).length)
    throw Error('Explicit per-channel known regions required');
  for(const [kind,polygons] of Object.entries(annotation.known)){
    if(!REFERENCE_BOUNDARY_CHANNELS.includes(kind)||!Array.isArray(polygons))throw Error('Invalid known semantic class');
    for(const polygon of polygons)points(polygon,3);
  }
  for(const line of annotation.lines||[]){
    if(!REFERENCE_BOUNDARY_CHANNELS.includes(line.kind)||typeof line.width!=='number'||!Number.isFinite(line.width)||line.width<=0)
      throw Error('Semantic class and measured positive stroke width required');
    points(line.points,2);
  }
  for(const region of annotation.regions||[]){if(!REFERENCE_BOUNDARY_CHANNELS.slice(3).includes(region.kind))throw Error('Boundary truth requires centerlines; regions describe confounders');points(region.polygon,3);}
  for(const polygon of annotation.ignore||[])points(polygon,3);
  const tile=width*height<=16777216&&width<=16384&&height<=16384?Math.max(width,height):2048;
  for(let y=0;y<height;y+=tile)for(let x=0;x<width;x+=tile){
    const window=[x,y,Math.min(tile,width-x),Math.min(tile,height-y)];
    const {targetBits,knownBits}=await reviewMasks({...annotation,ignore:[]},{...options,window});
    for(let i=0;i<targetBits.length;i++)if(targetBits[i]&~knownBits[i])throw Error('Positive labels extend outside explicitly known regions');
  }
}
