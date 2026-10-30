import {execFile} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';

const rootDefault=fileURLToPath(new URL('../../',import.meta.url));
export const terrainDemEncodeSources=Object.freeze(['tools/cpp/terrain-dem-encode/CMakeLists.txt','tools/cpp/terrain-dem-encode/encode.cpp']);
export async function encodeNativeDemElevation({width,height,levelWidth,levelHeight,north,elevation},
  {root=rootDefault,directory=resolve(root,'build-native/terrain-dem-encode/artifact'),signal}={}){
  signal?.throwIfAborted();
  if(![width,height].every(value=>Number.isSafeInteger(value)&&value>0&&value<=16384)||width*height>16777216||
    ![levelWidth,levelHeight].every(value=>Number.isSafeInteger(value)&&value>0&&value<=1000000)||
    !Number.isSafeInteger(north)||Math.abs(north)>1000000||!(elevation instanceof Uint8Array)||elevation.length!==width*height*4)
    throw Error('Explicit bounded float32 DEM elevation grid required');
  const header=Buffer.alloc(28);header.write('PDEMENC1');[width,height,levelWidth,levelHeight].forEach((value,i)=>header.writeUInt32LE(value,8+i*4));
  header.writeInt32LE(north,24);
  const executable=process.platform==='win32'?'pando-terrain-dem-encode.exe':'pando-terrain-dem-encode';
  const {binary}=verifyNativeTool({root,directory,target:'terrain-dem-encode',executable,sourceFiles:terrainDemEncodeSources});
  const output=await new Promise((accept,reject)=>{
    const child=execFile(binary,[],{encoding:'buffer',windowsHide:true,timeout:180000,maxBuffer:width*height*5+65536,signal},
      (error,stdout,stderr)=>error?reject(new Error('Native DEM encoding failed: '+error.message+' '+String(stderr||''),{cause:error})):accept(stdout));
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')child.kill();});child.stdin.write(header);child.stdin.end(elevation);
  });
  signal?.throwIfAborted();const pixels=width*height;if(output.length!==pixels*5)throw Error('Invalid native DEM encoding output length');
  return {shade:output.subarray(0,pixels),rgba:output.subarray(pixels)};
}
