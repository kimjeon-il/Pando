// Native GDAL tint sampling; the caller owns and removes its temporary TIFF.
import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {realpath} from 'node:fs/promises';
import {delimiter,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';
import {fillGdalDemTint} from './terrain-dem-source.mjs';
const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
export const terrainDemTintSources=Object.freeze(['tools/cpp/terrain-dem-tint/CMakeLists.txt','tools/cpp/terrain-dem-tint/tint.cpp']);

export async function sampleNativeDemTint({source,ice,land,temporary,width,height},
  {signal,root=defaultRoot,directory=process.env.PANDO_TERRAIN_DEM_TINT_DIRECTORY||resolve(root,'build-native/terrain-dem-tint/artifact'),fillDirectory}={}){
  signal?.throwIfAborted();
  if(![source,ice,land,temporary].every(value=>typeof value==='string'&&value)||
    ![width,height].every(value=>Number.isSafeInteger(value)&&value>0)||width>30000||height>16384||width*height>12000000)
    throw Error('Explicit bounded tint sources and output dimensions are required');
  const originals=await Promise.all([source,ice,land].map(path=>realpath(path))),target=resolve(temporary);
  if(existsSync(target)||originals.includes(target))throw Error('Tint temporary TIFF exists or matches an original');
  const executable=process.platform==='win32'?'pando-terrain-dem-tint.exe':'pando-terrain-dem-tint';
  const {binary}=verifyNativeTool({root,directory,target:'terrain-dem-tint',executable,sourceFiles:terrainDemTintSources});
  const env={...process.env},bin=env.PANDO_TERRAIN_DEM_GDAL_BIN;
  if(bin){if(!isAbsolute(bin))throw Error('GDAL runtime directory must be absolute');env.PATH=bin+delimiter+(env.PATH||'');}
  const count=width*height;
  const output=await new Promise((accept,reject)=>execFile(binary,[...originals,target,String(width),String(height)],
    {encoding:'buffer',windowsHide:true,timeout:1800000,maxBuffer:16+count*13+65536,signal,env},
    (error,stdout,stderr)=>error?reject(new Error('Native DEM tint sampling failed: '+error.message+' '+String(stderr||''),{cause:error})):accept(stdout)));
  signal?.throwIfAborted();
  if(output.length!==16+count*13||output.toString('ascii',0,8)!=='PDTINT02'||output.readUInt32LE(8)!==width||output.readUInt32LE(12)!==height)
    throw Error('Invalid native DEM tint sampling receipt');
  const rgb=new Float32Array(count*3);Buffer.from(rgb.buffer).set(output.subarray(16,16+count*12));
  const valid=output.subarray(16+count*12),planar=await fillGdalDemTint({width,height,rgb,valid},
    {root,...(fillDirectory?{directory:fillDirectory}:{}),signal});
  const pixels=Buffer.alloc(count*3);for(let i=0;i<count;i++)for(let c=0;c<3;c++)pixels[i*3+c]=planar[c*count+i];
  const validCells=valid.reduce((total,value)=>total+Number(value!==0),0);
  return {width,height,rgb:pixels,validCells,regionalFillCells:count-validCells};
}
