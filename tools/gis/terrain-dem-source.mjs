// Delegate source-pixel access to the installed native GDAL utility.
import {execFile} from 'node:child_process';
import {delimiter,dirname,isAbsolute,resolve} from 'node:path';

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
