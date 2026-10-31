// Source-bound GDAL read of an averaged DEM window, with wrap and polar gutters.
import {execFile} from 'node:child_process';
import {realpath,stat} from 'node:fs/promises';
import {endianness} from 'node:os';
import {delimiter,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
export const terrainDemRasterSources=Object.freeze(['tools/cpp/terrain-dem-raster/CMakeLists.txt','tools/cpp/terrain-dem-raster/source.cpp']);
export async function readNativeDemWindow({source,width,height,box,strict=true},
  {root=defaultRoot,directory=process.env.PANDO_TERRAIN_DEM_RASTER_DIRECTORY||resolve(root,'build-native/terrain-dem-raster/artifact'),signal}={}){
  signal?.throwIfAborted();
  if(endianness()!=='LE'||typeof source!=='string'||!source||typeof strict!=='boolean'||
    !Number.isSafeInteger(width)||width<1||width>50000||!Number.isSafeInteger(height)||height<1||height>25000||
    !Array.isArray(box)||box.length!==4||box.some(n=>!Number.isSafeInteger(n)||Math.abs(n)>1000000))throw Error('Explicit bounded DEM window required');
  const [x0,y0,x1,y1]=box,w=x1-x0,h=y1-y0;
  if(w<1||h<1||w>5000||h>5000||w*h>16777216||y0>=height||y1<=0)throw Error('DEM window exceeds bounds');
  const input=await realpath(source);if(!(await stat(input)).isFile())throw Error('DEM source must be a file');
  const executable=process.platform==='win32'?'pando-terrain-dem-raster.exe':'pando-terrain-dem-raster';
  const {binary}=verifyNativeTool({root,directory,target:'terrain-dem-raster',executable,sourceFiles:terrainDemRasterSources});
  const env={...process.env},bin=env.PANDO_TERRAIN_DEM_GDAL_BIN;
  if(bin){if(!isAbsolute(bin))throw Error('GDAL runtime directory must be absolute');env.PATH=bin+delimiter+(env.PATH||'');}
  const args=[input,String(width),String(height),...box.map(String),...(strict?['--strict-etopo']:[])];
  const output=await new Promise((accept,reject)=>execFile(binary,args,{encoding:'buffer',windowsHide:true,timeout:180000,maxBuffer:w*h*4+65536,signal,env},
    (error,stdout,stderr)=>error?reject(new Error('Native DEM window failed: '+error.message+' '+String(stderr),{cause:error})):accept(stdout)));
  signal?.throwIfAborted();if(output.length!==w*h*4)throw Error('Native DEM window length differs');
  for(let at=0;at<output.length;at+=4){const value=output.readFloatLE(at);if(!Number.isFinite(value)||value< -12000||value>53535)throw Error('Native DEM window elevation is invalid');}
  return output;
}
