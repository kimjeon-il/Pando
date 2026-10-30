// Source-bound optional C++ terrain compositor; inputs and existing assets remain untouched.
import {execFile} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
export const terrainPreviewSources=Object.freeze(['tools/cpp/terrain/CMakeLists.txt','tools/cpp/terrain/preview.cpp','tools/cpp/terrain/land-mask.cpp',
  'tools/cpp/terrain/land-mask.h','tools/cpp/map-image/raster-draw.h','shared/core/include/pandoeditor/losslessjson.h','shared/core/src/losslessjson.cpp']);
async function runTerrainPreview(args,input,outputBytes,{root=defaultRoot,directory=resolve(root,'build-native/terrain-preview/artifact'),signal}={}){
  signal?.throwIfAborted();const executable=process.platform==='win32'?'pando-terrain-preview.exe':'pando-terrain-preview';
  const {binary}=verifyNativeTool({root,directory,target:'terrain-preview',executable,sourceFiles:terrainPreviewSources});
  const output=await new Promise((accept,reject)=>{
    const child=execFile(binary,args,{encoding:'buffer',windowsHide:true,timeout:180000,maxBuffer:outputBytes+65536,signal},
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
export async function rasterizeNativeTerrainLand({countries,x,y,width,height,levelWidth,levelHeight},options={}){
  options.signal?.throwIfAborted();
  if(!countries||typeof countries!=='object'||Array.isArray(countries)||![width,height].every(value=>Number.isSafeInteger(value)&&value>0&&value<=16384)||
    width*height>16777216||![x,y,levelWidth,levelHeight].every(Number.isFinite)||Math.abs(x)>1000000||Math.abs(y)>1000000||
    levelWidth<=0||levelHeight<=0||levelWidth>1000000||levelHeight>1000000)throw Error('Invalid terrain land mask inputs');
  const input=Buffer.from(JSON.stringify({countries,x,y,width,height,levelWidth,levelHeight}));
  if(input.length>256*1024*1024)throw Error('Terrain land mask exceeds input budget');
  const result=await runTerrainPreview(['mask'],[input],width*height,options);
  if(result.some(value=>value>1))throw Error('Invalid native terrain land mask');return result;
}
