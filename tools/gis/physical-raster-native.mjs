import {execFile,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {realpath,stat} from 'node:fs/promises';
import {delimiter,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
export const physicalRasterSources=Object.freeze(['tools/cpp/physical-raster/CMakeLists.txt','tools/cpp/physical-raster/source.cpp']);
function executable(directory){
  return verifyNativeTool({root,directory,target:'physical-raster',
    executable:process.platform==='win32'?'pando-physical-raster.exe':'pando-physical-raster',sourceFiles:physicalRasterSources}).binary;
}
function environment(){
  const env={...process.env},bin=env.PANDO_PHYSICAL_RASTER_GDAL_BIN;
  if(bin){if(!isAbsolute(bin))throw Error('GDAL runtime directory must be absolute');env.PATH=bin+delimiter+(env.PATH||'');}
  return env;
}
async function fileHash(path){
  const hash=createHash('sha256');for await(const data of createReadStream(path))hash.update(data);return hash.digest('hex');
}
export async function readPhysicalRaster(path,{directory=process.env.PANDO_PHYSICAL_RASTER_DIRECTORY||resolve(root,'build-native/physical-raster/artifact'),signal}={}){
  signal?.throwIfAborted();if(typeof path!=='string'||!path)throw Error('Physical TIFF path required');
  const source=await realpath(path),file=await stat(source);if(!file.isFile())throw Error('Physical TIFF must be a file');
  const binary=executable(directory),env=environment(),before=await fileHash(source);
  const info=await new Promise((accept,reject)=>execFile(binary,['inspect',source],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:65536,signal,env},
    (error,stdout,stderr)=>{
      if(error)return reject(new Error('Physical TIFF inspection failed: '+error.message+' '+stderr,{cause:error}));
      try{accept(JSON.parse(stdout));}catch(cause){reject(new Error('Invalid physical TIFF inspection response',{cause}));}
    }));
  const {width,height,mode}=info;
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>30000||height>16384||width*height>240000000||!['RGB','L'].includes(mode))
    throw Error('Invalid physical TIFF inspection response');
  const expected=width*height*3,pixels=Buffer.allocUnsafe(expected);
  await new Promise((accept,reject)=>{
    const child=spawn(binary,['read-rgb',source],{stdio:['ignore','pipe','pipe'],windowsHide:true,signal,env});
    let received=0,errors='',overflow=false,settled=false;
    const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):accept();};
    const timer=setTimeout(()=>{child.kill();finish(Error('Physical TIFF read timed out'));},1800000);
    child.on('error',finish);child.stderr.on('data',chunk=>{if(errors.length<65536)errors+=chunk.toString('utf8');});
    child.stdout.on('data',chunk=>{if(received+chunk.length>expected){overflow=true;child.kill();return;}chunk.copy(pixels,received);received+=chunk.length;});
    child.on('close',(code,reason)=>{if(code!==0||reason||overflow||received!==expected)
      return finish(Error('Physical TIFF read failed: '+errors));finish();});
  });
  signal?.throwIfAborted();const after=await fileHash(source);
  if(after!==before)throw Error('Physical TIFF source changed during read');
  return {width,height,mode,pixels,sha256:before};
}
