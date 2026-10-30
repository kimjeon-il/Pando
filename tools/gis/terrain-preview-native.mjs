// Source-bound optional C++ terrain compositor; inputs and existing assets remain untouched.
import {execFile} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
export const terrainPreviewSources=Object.freeze(['tools/cpp/CMakeLists.txt','tools/cpp/terrain/preview.cpp']);
export async function composeNativeTerrainPreview({dem,tint,land,width,height,tintWidth,tintHeight,x,y,levelWidth,levelHeight},
  {root=defaultRoot,directory=resolve(root,'build-native/terrain-preview/artifact'),signal}={}){
  signal?.throwIfAborted();const dims=[width,height,tintWidth,tintHeight];
  if(dims.some(value=>!Number.isSafeInteger(value)||value<1||value>16384)||width*height>16777216||tintWidth*tintHeight>16777216||
    ![x,y,levelWidth,levelHeight].every(Number.isFinite)||levelWidth<=0||levelHeight<=0)throw Error('Invalid terrain preview dimensions');
  if(!(dem instanceof Uint8Array)||!(tint instanceof Uint8Array)||!(land instanceof Uint8Array)||
    dem.length!==width*height*4||tint.length!==tintWidth*tintHeight*3||land.length!==width*height)
    throw Error('Invalid terrain preview pixel buffers');
  const outputBytes=width*height*4;if(56+dem.length+tint.length+land.length>256*1024*1024)throw Error('Terrain preview exceeds input budget');
  const executable=process.platform==='win32'?'pando-terrain-preview.exe':'pando-terrain-preview';
  const {binary}=verifyNativeTool({root,directory,target:'terrain-preview',executable,sourceFiles:terrainPreviewSources});
  const header=Buffer.alloc(56);header.write('PDTERR01',0,'ascii');dims.forEach((value,i)=>header.writeUInt32LE(value,8+i*4));
  [x,y,levelWidth,levelHeight].forEach((value,i)=>header.writeDoubleLE(value,24+i*8));
  const input=[header,Buffer.from(dem),Buffer.from(tint),Buffer.from(land)];
  const output=await new Promise((accept,reject)=>{
    const child=execFile(binary,[],{encoding:'buffer',windowsHide:true,timeout:180000,maxBuffer:outputBytes+65536,signal},
      (error,stdout,stderr)=>error?reject(new Error('Native terrain preview failed: '+error.message+' '+String(stderr||''),{cause:error})):accept(stdout));
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')child.kill();});for(const part of input)child.stdin.write(part);child.stdin.end();
  });
  signal?.throwIfAborted();if(output.length!==outputBytes)throw Error('Native terrain preview returned an invalid pixel length');return output;
}
