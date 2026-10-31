// Source-bound GDAL read of averaged DEM windows, with wrap and polar gutters.
import {spawn} from 'node:child_process';
import {realpath,stat} from 'node:fs/promises';
import {endianness} from 'node:os';
import {delimiter,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
export const terrainDemRasterSources=Object.freeze(['tools/cpp/terrain-dem-raster/CMakeLists.txt','tools/cpp/terrain-dem-raster/source.cpp']);
export async function createNativeDemWindowReader({source,width,height,strict=true},
  {root=defaultRoot,directory=process.env.PANDO_TERRAIN_DEM_RASTER_DIRECTORY||resolve(root,'build-native/terrain-dem-raster/artifact'),signal}={}){
  signal?.throwIfAborted();
  if(endianness()!=='LE'||typeof source!=='string'||!source||typeof strict!=='boolean'||
    !Number.isSafeInteger(width)||width<1||width>50000||!Number.isSafeInteger(height)||height<1||height>25000)
    throw Error('Explicit bounded DEM source and level required');
  const input=await realpath(source);if(!(await stat(input)).isFile())throw Error('DEM source must be a file');
  const executable=process.platform==='win32'?'pando-terrain-dem-raster.exe':'pando-terrain-dem-raster';
  const {binary}=verifyNativeTool({root,directory,target:'terrain-dem-raster',executable,sourceFiles:terrainDemRasterSources});
  const env={...process.env},bin=env.PANDO_TERRAIN_DEM_GDAL_BIN;
  if(bin){if(!isAbsolute(bin))throw Error('GDAL runtime directory must be absolute');env.PATH=bin+delimiter+(env.PATH||'');}
  const args=['--stream',input,String(width),String(height),...(strict?['--strict-etopo']:[])];
  const child=spawn(binary,args,{stdio:['pipe','pipe','pipe'],windowsHide:true,signal,env});
  let failure='',closed=false,busy=false,pending=Buffer.alloc(0),offset=0;
  const done=new Promise((accept,reject)=>{
    child.stderr.on('data',chunk=>{if(failure.length<65536)failure+=chunk.toString('utf8');});
    child.once('error',reject);child.once('close',(code,reason)=>code===0&&!reason?accept():reject(Error('Native DEM window failed: '+failure)));
  });done.catch(()=>{});child.stdin.on('error',()=>{});const iterator=child.stdout[Symbol.asyncIterator]();
  async function take(size){const result=Buffer.allocUnsafe(size);let at=0;
    while(at<size){if(offset===pending.length){const next=await iterator.next();if(next.done)throw Error('Native DEM window ended early: '+failure);pending=next.value;offset=0;}
      const count=Math.min(size-at,pending.length-offset);pending.copy(result,at,offset,offset+count);at+=count;offset+=count;}
    return result;}
  return {
    async read(box){
      if(closed||busy)throw Error('DEM window reader is closed or busy');signal?.throwIfAborted();
      if(!Array.isArray(box)||box.length!==4||box.some(v=>!Number.isSafeInteger(v)||Math.abs(v)>1000000))throw Error('Explicit bounded DEM window required');
      const [x0,y0,x1,y1]=box,w=x1-x0,h=y1-y0;
      if(w<1||h<1||w>5000||h>5000||w*h>16777216||y0>=height||y1<=0)throw Error('DEM window exceeds bounds');
      const header=Buffer.alloc(24);header.write('PDEMWIN1');box.forEach((value,i)=>header.writeInt32LE(value,8+i*4));
      busy=true;let timer;
      try{
        await new Promise((accept,reject)=>child.stdin.write(header,error=>error?reject(error):accept()));
        const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{child.kill();reject(Error('Native DEM window timed out'));},180000);});
        const output=await Promise.race([take(w*h*4),timeout]);signal?.throwIfAborted();
        for(let at=0;at<output.length;at+=4){const value=output.readFloatLE(at);if(!Number.isFinite(value)||value< -12000||value>53535)throw Error('Native DEM window elevation is invalid');}
        return output;
      }finally{clearTimeout(timer);busy=false;}
    },
    async close(){if(closed)return done;if(busy)throw Error('Cannot close a busy DEM window reader');closed=true;child.stdin.end();return done;},
  };
}
export async function readNativeDemWindow({box,...input},options){
  const reader=await createNativeDemWindowReader(input,options);let failure;
  try{return await reader.read(box);}catch(error){failure=error;throw error;}
  finally{try{await reader.close();}catch(error){if(!failure)throw error;}}
}
