// Delegate source-pixel access to the installed native GDAL utility.
import {execFile} from 'node:child_process';
import {delimiter,dirname,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));

export async function sampleGdalDem({source,x,y,binary=process.env.PANDO_GDAL_LOCATIONINFO||'gdallocationinfo',signal}){
  signal?.throwIfAborted();
  if(typeof source!=='string'||!source||typeof binary!=='string'||!binary||
    ![x,y].every(value=>Number.isSafeInteger(value)&&value>=0))throw Error('Explicit DEM source and pixel coordinates required');
  const env={...process.env};if(isAbsolute(binary))env.PATH=dirname(binary)+delimiter+(env.PATH||'');
  const text=await new Promise((accept,reject)=>execFile(binary,['-valonly','-b','1',resolve(source),String(x),String(y)],
    {encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:65536,signal,env},
    (error,stdout,stderr)=>error?reject(new Error('GDAL DEM sample failed: '+error.message+' '+stderr,{cause:error})):accept(stdout.trim())));
  signal?.throwIfAborted();
  if(!/^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/.test(text)||!Number.isFinite(Number(text)))
    throw Error('GDAL DEM sample is not a finite numeric value');
  return Number(text);
}

export const terrainDemFillSources=Object.freeze(['tools/cpp/terrain-dem-fill/CMakeLists.txt','tools/cpp/terrain-dem-fill/fill.cpp']);

// The native GDAL operation consumes planar float32 RGB and returns planar RGB bytes.
export async function fillGdalDemTint({width,height,rgb,valid},
  {root=defaultRoot,directory=process.env.PANDO_TERRAIN_DEM_FILL_DIRECTORY||resolve(root,'build-native/terrain-dem-encode/fill-artifact'),signal}={}){
  signal?.throwIfAborted();const count=width*height;
  if(!Number.isSafeInteger(width)||width<1||width>30000||!Number.isSafeInteger(height)||height<1||height>16384||
    !Number.isSafeInteger(count)||count>12000000||!(rgb instanceof Float32Array)||rgb.length!==count*3||
    !(valid instanceof Uint8Array)||valid.length!==count)throw Error('Valid bounded planar tint grid required');
  if(!valid.some(value=>value!==0))throw Error('Tint has no valid land colours');
  for(let i=0;i<count;i++)if(valid[i])for(let c=0;c<3;c++)
    if(!Number.isFinite(rgb[c*count+i]))throw Error('Tint has non-finite valid land colours');
  const executable=process.platform==='win32'?'pando-terrain-dem-fill.exe':'pando-terrain-dem-fill';
  const {binary}=verifyNativeTool({root,directory,target:'terrain-dem-fill',executable,sourceFiles:terrainDemFillSources});
  const header=Buffer.alloc(16);header.write('PDTINT01');header.writeUInt32LE(width,8);header.writeUInt32LE(height,12);
  const env={...process.env},gdalBin=process.env.PANDO_TERRAIN_DEM_GDAL_BIN;
  if(gdalBin){if(!isAbsolute(gdalBin))throw Error('GDAL runtime directory must be absolute');env.PATH=gdalBin+delimiter+(env.PATH||'');}
  const output=await new Promise((accept,reject)=>{
    const child=execFile(binary,[],{encoding:'buffer',windowsHide:true,timeout:180000,maxBuffer:count*3+65536,signal,env},
      (error,stdout,stderr)=>error?reject(new Error('Native GDAL tint fill failed: '+error.message+' '+String(stderr||''),{cause:error})):accept(stdout));
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')child.kill();});
    child.stdin.write(header);child.stdin.write(Buffer.from(rgb.buffer,rgb.byteOffset,rgb.byteLength));child.stdin.end(valid);
  });
  signal?.throwIfAborted();if(output.length!==count*3)throw Error('Invalid native GDAL tint fill output length');
  return output;
}
