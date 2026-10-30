import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';
import {encodeNativePng,resizeNativeRgba,resizeNativePdfThumbnail} from './native-resample.mjs';

export const mapPreviewSourceFiles=Object.freeze(['tools/cpp/map-preview/CMakeLists.txt','tools/cpp/map-preview/preview.cpp','tools/cpp/map-image/raster-draw.h',
  'tools/cpp/map-preview/PILLOW-LICENSE','tools/cpp/map-preview/FREETYPE-LICENSE']);
const root=fileURLToPath(new URL('../../',import.meta.url)),fontPath='tools/cpp/map-preview/aileron-subset.ttf';
const fontHash='69853909b940023570964e29cffe30da95aea8de3627736b5cd15ab30143169f';
const digest=value=>createHash('sha256').update(value).digest('hex');
function font(workspace){const bytes=readFileSync(resolve(workspace,fontPath));if(digest(bytes)!==fontHash)throw Error('Preview font identity mismatch');return bytes;}
function artifact(workspace,directory,platform){
  const executable=platform==='win32'?'pando-map-preview.exe':platform==='linux'?'pando-map-preview':null;
  if(!executable)throw Error('Unsupported native preview platform');
  return verifyNativeTool({root:workspace,directory,target:'map-preview',executable,sourceFiles:mapPreviewSourceFiles,platform,architecture:'x64'});
}
export function collectMapPreviewArtifacts({workspace=root,revision,
  linuxDirectory=process.env.PANDO_MAP_PREVIEW_LINUX_ARTIFACT||resolve(workspace,'build-native/map-preview/linux-x64'),
  windowsDirectory=process.env.PANDO_MAP_PREVIEW_WINDOWS_ARTIFACT||resolve(workspace,'build-native/map-preview',process.platform==='win32'?'artifact':'win32-x64')}={}){
  if(revision!==undefined&&!/^[a-f0-9]{40}$/.test(revision))throw Error('A full pinned source revision is required');
  if(revision&&digest(execFileSync('git',['show',revision+':'+fontPath],{cwd:workspace}))!==fontHash)throw Error('Pinned preview font differs');
  font(workspace);const entries=[];
  for(const [platform,directory] of [['linux',linuxDirectory],['win32',windowsDirectory]]){
    const {binary,manifest}=artifact(workspace,directory,platform);
    if(revision)for(const file of manifest.sourceFiles){const source=execFileSync('git',['show',revision+':'+file.path],{cwd:workspace,encoding:'utf8'});
      if(digest(source.replaceAll('\r\n','\n'))!==file.sha256)throw Error('Native preview artifact differs from pinned source: '+file.path);}
    const prefix=`build-native/map-preview/${platform}-x64/`;
    entries.push({path:prefix+'native-tool.manifest.json',data:readFileSync(resolve(directory,'native-tool.manifest.json'))},
      {path:prefix+(platform==='win32'?'pando-map-preview.exe':'pando-map-preview'),data:readFileSync(binary)});
  }
  return entries;
}
function targetSize(width,height){
  if(width<=2200&&height<=2200)return [width,height];const aspect=width/height;
  if(1>=aspect){const n=2200*aspect,candidates=[Math.floor(n),Math.ceil(n)];return [Math.max(1,candidates.reduce((a,b)=>Math.abs(aspect-b/2200)<Math.abs(aspect-a/2200)?b:a)),2200];}
  const n=2200/aspect,candidates=[Math.floor(n),Math.ceil(n)];
  return [2200,Math.max(1,candidates.reduce((a,b)=>(b?Math.abs(aspect-2200/b):0)<(a?Math.abs(aspect-2200/a):0)?b:a))];
}
function roundedMeters(value){
  if(typeof value!=='number'||!Number.isFinite(value))throw Error('Invalid preview residual');
  const negative=value<0||Object.is(value,-0),number=Math.abs(value),whole=Math.floor(number),fraction=number-whole;
  const rounded=fraction>.5||(fraction===.5&&whole%2===1)?whole+1:whole;
  return (negative?'-':'')+(rounded>=1e21?BigInt(rounded).toString():String(rounded));
}
function commands(job,width,height,originalWidth,originalHeight,selectedGeometry){
  const sx=width/originalWidth,sy=height/originalHeight,result=[];
  const point=(x,y)=>[x*sx,y*sy];
  const circle=(xy,color)=>{const [x,y]=point(...xy);result.push({type:2,color,values:[x-5,y-5,x+5,y+5]});};
  const selected=selectedGeometry!=null,paths=[];
  if(selected){
    if(!Array.isArray(selectedGeometry))throw Error('Invalid selected source-pixel geometry');
    for(const geometry of selectedGeometry){
      if(geometry?.type==='LineString')paths.push(geometry.coordinates);
      else if(geometry?.type==='Polygon'&&Array.isArray(geometry.coordinates))paths.push(...geometry.coordinates);
      else throw Error('Unsupported selected source-pixel geometry');
    }
    for(const path of paths){
      if(!Array.isArray(path)||path.length<2||path.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>typeof v!=='number'||!Number.isFinite(v))))
        throw Error('Invalid selected source-pixel geometry');
      result.push({type:1,color:0x16803c,values:path.flatMap(([x,y])=>point(x,y))});
    }
  }else for(const chain of job.graph?.chains||[]){if(chain.points.length<2)continue;const bits=chain.semanticBits||0;
    const color=(bits&3)===3?0xa94ddd:bits&1?0xe85530:bits&2?0x247bed:0x00b6bb;
    result.push({type:1,color,values:chain.points.flatMap(([x,y])=>point(x,y))});}
  const onSelection=p=>paths.some(path=>path.slice(1).some((b,i)=>{const a=path[i],dx=b[0]-a[0],dy=b[1]-a[1],squared=dx*dx+dy*dy;
    if(!squared)return false;const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/squared));
    return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)<=2;}));
  for(const item of job.graph?.unresolved||[])if(item.point&&(!selected||onSelection(item.point)))circle(item.point,0xffba00);
  const residuals=new Map((job.warp?.diagnostics?.residuals||[]).map(row=>[row.id,row.meters]));
  (job.warp?.controlPoints||[]).forEach((control,index)=>{
    const x=control.image[0]*(originalWidth-1)*sx,y=control.image[1]*(originalHeight-1)*sy;
    result.push({type:2,color:0x00aaff,values:[x-5,y-5,x+5,y+5]});
    let text=String(index+1);if(residuals.has(control.id))text+=': '+roundedMeters(residuals.get(control.id))+'m';
    result.push({type:5,color:0x0066aa,x:x+6,y:y-5,stroke:1,text});
  });
  const rect=job.source?.mapping?.rect;if(rect)result.push({type:3,color:0x00aaff,
    values:[rect.x*sx,rect.y*sy,(rect.x+rect.width-1)*sx,(rect.y+rect.height-1)*sy]});
  const banner=(selected?'REVIEWED SELECTION | green: selected geometry / yellow: unresolved | model provisional':
    'PROVISIONAL CANDIDATES | orange: border / blue: admin / purple: mixed / yellow: unresolved')+
    ' | georeference: '+(job.quality?.recommended?'recommended':'needs review');
  result.push({type:4,color:0xffffff,values:[0,0,width,24]},{type:5,color:0,x:5,y:5,stroke:0,text:banner});return result;
}
function request(width,height,pixels,typeface,rows){
  const parts=[];const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n>>>0);parts.push(b);};
  const i32=n=>{if(!Number.isFinite(n)||Math.abs(n)>1000000)throw Error('Invalid preview coordinate');const b=Buffer.alloc(4);b.writeInt32BE(Math.trunc(n));parts.push(b);};
  const f64=n=>{if(!Number.isFinite(n))throw Error('Invalid preview coordinate');const b=Buffer.alloc(8);b.writeDoubleBE(n);parts.push(b);};
  u32(width);u32(height);u32(typeface.length);u32(rows.length);parts.push(typeface,pixels);
  for(const row of rows){u32(row.type);u32(row.color);
    if(row.type===1){u32(row.values.length/2);for(const v of row.values)i32(v);}
    else if(row.type===5){f64(row.x);f64(row.y);u32(row.stroke);const text=Buffer.from(row.text,'ascii');u32(text.length);parts.push(text);}
    else for(const v of row.values)i32(v);
  }
  return Buffer.concat(parts);
}
function run(binary,input,expected,signal){return new Promise((accept,reject)=>{
  const child=spawn(binary,[],{stdio:['pipe','pipe','pipe'],windowsHide:true,signal:signal||undefined}),chunks=[],errors=[];
  let size=0,errorBytes=0,overflow=false,settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):accept(value);};
  const timer=setTimeout(()=>{child.kill();finish(Error('Native preview timed out'));},120000);
  child.on('error',e=>finish(e));child.stdin.on('error',()=>{});
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>expected){overflow=true;child.kill();}else chunks.push(chunk);});
  child.stderr.on('data',chunk=>{errorBytes+=chunk.length;if(errorBytes<=65536)errors.push(chunk);});
  child.on('close',(code,reason)=>code!==0||reason||overflow?finish(Error('Native preview failed: '+Buffer.concat(errors).toString('utf8'))):finish(null,Buffer.concat(chunks,size)));
  child.stdin.end(input);
});}
export async function drawNativePreviewLabels(image,labels,{signal,workspace=root,directory=process.env.PANDO_MAP_PREVIEW_ARTIFACT||
  resolve(workspace,'build-native/map-preview',existsSync(resolve(workspace,'.map-runtime.json'))?`${process.platform}-${process.arch}`:'artifact')}={}){
  signal?.throwIfAborted();const {width,height,data}=image||{};
  if(![width,height].every(value=>Number.isInteger(value)&&value>0&&value<=2200)||!(data instanceof Uint8Array)||data.length!==width*height*4||
    !Array.isArray(labels)||labels.length>32||labels.some(row=>!row||!Number.isFinite(row.x)||!Number.isFinite(row.y)||
      typeof row.text!=='string'||!row.text.length||row.text.length>512||!/^[\x20-\x7e]+$/.test(row.text)))
    throw Error('Bounded image and ASCII preview labels required');
  const {binary}=artifact(workspace,directory,process.platform);
  if(process.platform!=='win32'&&!process.env.PANDO_MAP_PREVIEW_ARTIFACT&&existsSync(resolve(workspace,'.map-runtime.json')))chmodSync(binary,0o755);
  const commands=labels.map(({x,y,text})=>({type:5,color:0,x,y,stroke:0,text}));
  const pixels=await run(binary,request(width,height,data,font(workspace),commands),width*height*4,signal);
  if(pixels.length!==data.length)throw Error('Native preview output length mismatch');
  return {width,height,data:pixels};
}
export async function renderNativePreview(image,job,{signal,workspace=root,selectedGeometry,sourceIsPdf=false,directory=process.env.PANDO_MAP_PREVIEW_ARTIFACT||
  resolve(workspace,'build-native/map-preview',existsSync(resolve(workspace,'.map-runtime.json'))?`${process.platform}-${process.arch}`:'artifact')}={}){
  signal?.throwIfAborted();const {binary}=artifact(workspace,directory,process.platform);
  if(process.platform!=='win32'&&!process.env.PANDO_MAP_PREVIEW_ARTIFACT&&existsSync(resolve(workspace,'.map-runtime.json')))chmodSync(binary,0o755);
  const [width,height]=targetSize(image.width,image.height);
  const resized=width===image.width&&height===image.height?image:await (sourceIsPdf?resizeNativePdfThumbnail:resizeNativeRgba)(image,[width,height],{signal,workspace});
  const data=await run(binary,request(width,height,resized.data,font(workspace),commands(job,width,height,image.width,image.height,selectedGeometry)),width*height*4,signal);
  if(data.length!==width*height*4)throw Error('Native preview output length mismatch');
  return encodeNativePng({width,height,data},{signal,workspace});
}
