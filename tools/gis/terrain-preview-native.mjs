// Source-bound optional C++ terrain compositor; inputs and existing assets remain untouched.
import {execFile,spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
export const terrainPreviewSources=Object.freeze(['tools/cpp/terrain/CMakeLists.txt','tools/cpp/terrain/preview.cpp','tools/cpp/terrain/land-mask.cpp',
  'tools/cpp/map-image/resample.cpp','tools/cpp/map-image/resample.h',
  'tools/cpp/terrain/land-mask.h','tools/cpp/map-image/raster-draw.h','shared/core/include/pandoeditor/losslessjson.h','shared/core/src/losslessjson.cpp']);
function terrainBinary({root=defaultRoot,directory=process.env.PANDO_TERRAIN_PREVIEW_DIRECTORY||resolve(root,'build-native/terrain-preview/artifact')}={}){
  const executable=process.platform==='win32'?'pando-terrain-preview.exe':'pando-terrain-preview';
  return verifyNativeTool({root,directory,target:'terrain-preview',executable,sourceFiles:terrainPreviewSources}).binary;
}
async function runTerrainPreview(args,input,outputBytes,{signal,timeoutMs=180000,...options}={}){
  signal?.throwIfAborted();const binary=terrainBinary(options);
  const output=await new Promise((accept,reject)=>{
    const child=execFile(binary,args,{encoding:'buffer',windowsHide:true,timeout:timeoutMs,maxBuffer:outputBytes+65536,signal},
      (error,stdout,stderr)=>error?reject(new Error('Native terrain preview failed: '+error.message+' '+String(stderr||''),{cause:error})):accept(stdout));
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')child.kill();});for(const part of input)child.stdin.write(part);child.stdin.end();
  });
  signal?.throwIfAborted();if(output.length!==outputBytes)throw Error('Native terrain preview returned an invalid pixel length');return output;
}
export async function composeNativeTerrainPreview({dem,tint,land,width,height,tintWidth,tintHeight,x,y,levelWidth,levelHeight},
  options={}){
  options.signal?.throwIfAborted();const dims=[width,height,tintWidth,tintHeight];
  if(dims.some(value=>!Number.isSafeInteger(value)||value<1||value>16384)||width*height>16777216||tintWidth*tintHeight>16777216||
    ![x,y,levelWidth,levelHeight].every(Number.isFinite)||levelWidth<=0||levelHeight<=0)throw Error('Invalid terrain preview dimensions');
  if(!(dem instanceof Uint8Array)||!(tint instanceof Uint8Array)||!(land instanceof Uint8Array)||
    dem.length!==width*height*4||tint.length!==tintWidth*tintHeight*3||land.length!==width*height)
    throw Error('Invalid terrain preview pixel buffers');
  const outputBytes=width*height*4;if(56+dem.length+tint.length+land.length>256*1024*1024)throw Error('Terrain preview exceeds input budget');
  const header=Buffer.alloc(56);header.write('PDTERR01',0,'ascii');dims.forEach((value,i)=>header.writeUInt32LE(value,8+i*4));
  [x,y,levelWidth,levelHeight].forEach((value,i)=>header.writeDoubleLE(value,24+i*8));
  const input=[header,Buffer.from(dem),Buffer.from(tint),Buffer.from(land)];
  return runTerrainPreview([],input,outputBytes,options);
}
export async function rasterizeNativeTerrainLand({countries,x,y,width,height,levelWidth,levelHeight,fillHoles=false},options={}){
  options.signal?.throwIfAborted();
  if(typeof fillHoles!=='boolean'||!countries||typeof countries!=='object'||Array.isArray(countries)||!Number.isSafeInteger(width)||width<1||width>(fillHoles?30000:16384)||
    !Number.isSafeInteger(height)||height<1||height>16384||width*height>(fillHoles?240000000:16777216)||![x,y,levelWidth,levelHeight].every(Number.isFinite)||Math.abs(x)>1000000||Math.abs(y)>1000000||
    levelWidth<=0||levelHeight<=0||levelWidth>1000000||levelHeight>1000000)throw Error('Invalid terrain land mask inputs');
  const input=Buffer.from(JSON.stringify({countries,x,y,width,height,levelWidth,levelHeight,fillHoles}));
  if(input.length>256*1024*1024)throw Error('Terrain land mask exceeds input budget');
  const result=await runTerrainPreview(['mask'],[input],width*height,options);
  if(result.some(value=>fillHoles?value!==0&&value!==255:value>1))throw Error('Invalid native terrain land mask');return result;
}
async function resizePhysical({width,height,outputWidth,outputHeight,pixels},mask,options={}){
  const dims=[width,height,outputWidth,outputHeight];
  if(dims.some(v=>!Number.isSafeInteger(v)||v<1||v>30000)||height>16384||outputHeight>height||outputWidth>width||
    width*height>240000000||!(pixels instanceof Uint8Array)||pixels.length!==width*height*(mask?1:3))
    throw Error('Invalid physical resize input');
  const header=Buffer.alloc(24);header.write(mask?'PDPMSK01':'PDPRES01');dims.forEach((v,i)=>header.writeUInt32LE(v,8+i*4));
  return runTerrainPreview([mask?'physical-resize-mask':'physical-resize'],[header,pixels],outputWidth*outputHeight*(mask?1:3),{timeoutMs:1800000,...options});
}
export const resizeNativePhysicalRgb=(input,options)=>resizePhysical(input,false,options);
export const resizeNativePhysicalMask=(input,options)=>resizePhysical(input,true,options);
export async function convertNativePhysicalLuminance({width,height,pixels},options={}){
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>30000||height>16384||
    width*height>240000000||!(pixels instanceof Uint8Array)||pixels.length!==width*height*3)throw Error('Invalid physical luminance input');
  const header=Buffer.alloc(16);header.write('PDPLUM01');header.writeUInt32LE(width,8);header.writeUInt32LE(height,12);
  return runTerrainPreview(['physical-luminance'],[header,pixels],width*height,{timeoutMs:1800000,...options});
}
export function createNativePhysicalCompositor(options={}){
  const child=spawn(terrainBinary(options),['physical-composite-stream'],{stdio:['pipe','pipe','pipe'],windowsHide:true,signal:options.signal});
  let failure='',closed=false,busy=false,pending=Buffer.alloc(0),offset=0;
  const done=new Promise((accept,reject)=>{
    child.stderr.on('data',chunk=>{if(failure.length<65536)failure+=chunk.toString('utf8');});
    child.once('error',reject);child.once('close',(code,signal)=>code===0&&!signal?accept():reject(Error('Physical composite failed: '+failure)));
  });
  done.catch(()=>{});child.stdin.on('error',()=>{});
  const iterator=child.stdout[Symbol.asyncIterator]();
  async function take(size){
    const result=Buffer.allocUnsafe(size);let at=0;
    while(at<size){
      if(offset===pending.length){const next=await iterator.next();if(next.done)throw Error('Truncated physical composite output');pending=next.value;offset=0;}
      const n=Math.min(size-at,pending.length-offset);pending.copy(result,at,offset,offset+n);at+=n;offset+=n;
    }
    return result;
  }
  async function write(bytes){await new Promise((accept,reject)=>child.stdin.write(bytes,error=>error?reject(error):accept()));}
  return {
    async combine({width,height,box,land,ocean,mask,relief}){
      if(closed||busy)throw Error('Physical compositor unavailable or busy');
      if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>30000||height>16384||width*height>240000000||
        !Array.isArray(box)||box.length!==4||box.some(v=>!Number.isSafeInteger(v)))throw Error('Invalid physical composite bounds');
      const [left,top,right,bottom]=box,w=right-left,h=bottom-top;
      if(left<0||top<0||right>width||bottom>height||w<1||h<1||w>4096||h>4096||(w+2)*(h+2)>16777216||
        ![land,ocean].every(v=>v instanceof Uint8Array&&v.length===width*height*3)||
        ![mask,relief].every(v=>v instanceof Uint8Array&&v.length===width*height))throw Error('Invalid physical composite planes');
      const y0=Math.max(0,top-1),y1=Math.min(height,bottom+1),bandHeight=y1-y0;
      const header=Buffer.alloc(24);header.write('PDPCMP03');[w,h,Number(top>0),Number(bottom<height)].forEach((v,i)=>header.writeUInt32LE(v,8+4*i));
      busy=true;
      try{
        await write(header);
        for(const [plane,channels] of [[land,3],[ocean,3],[mask,1],[relief,1]]){
          const band=Buffer.allocUnsafe((w+2)*bandHeight*channels);let at=0;
          for(let y=y0;y<y1;y++){const start=(y*width+left)*channels;band.set(plane.subarray(start,start+w*channels),at);at+=w*channels;}
          for(const x of [(left+width-1)%width,right%width])for(let y=y0;y<y1;y++){
            const start=(y*width+x)*channels;band.set(plane.subarray(start,start+channels),at);at+=channels;
          }
          await write(band);
        }
        return await take((w+2)*(h+2)*4);
      }finally{busy=false;}
    },
    async close(){
      if(closed)return done;if(busy)throw Error('Cannot close a busy physical compositor');closed=true;child.stdin.end();
      if(offset!==pending.length)throw Error('Unexpected physical composite output');
      const tail=await iterator.next();if(!tail.done&&tail.value.length)throw Error('Unexpected physical composite output');
      await done;
    }
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length===3&&['--physical-composite-stream','--physical-resize'].includes(process.argv[2])){
      const child=spawn(terrainBinary(),[process.argv[2].slice(2)],{stdio:['pipe','pipe','inherit'],windowsHide:true});
      child.stdin.on('error',error=>{if(error.code!=='EPIPE')child.kill();});
      child.stdout.pipe(process.stdout,{end:false});process.stdin.pipe(child.stdin);
      await new Promise((accept,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>code===0&&!signal?accept():reject(Error('Native physical composite failed')));});
    }else{
    if(process.argv.length!==3||process.argv[2]!=='--physical-mask')throw Error('Expected --physical-mask');
    const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>256*1024*1024)throw Error('Terrain land mask exceeds input budget');chunks.push(chunk);}
    const request=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
    if(request.fillHoles!==true)throw Error('Explicit physical land mask required');
    process.stdout.write(await rasterizeNativeTerrainLand(request));
    }
  }catch(error){console.error('terrain-preview-native: '+error.message);process.exitCode=1;}
}
