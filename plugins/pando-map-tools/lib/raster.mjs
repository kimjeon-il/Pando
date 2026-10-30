import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspace, workspaceModule } from './workspace.mjs';

export async function raster(spec, bytes=null, signal=null) {
  signal?.throwIfAborted();
  if(spec.action==='resize'||spec.action==='rotate'||spec.action==='encode'){
    const {resizeNativeRgba,rotateNativeRgba,encodeNativePng}=await workspaceModule('tools/map-image/native-resample.mjs');
    const image={width:spec.width,height:spec.height,data:bytes};
    return spec.action==='resize'?resizeNativeRgba(image,spec.size,{signal,workspace}):spec.action==='rotate'?
      rotateNativeRgba(image,spec.degrees,{signal,workspace}):encodeNativePng(image,{signal,workspace});
  }
  if(spec.action==='read'&&typeof spec.path==='string'&&!spec.path.toLowerCase().endsWith('.pdf')){
    const file=await open(spec.path,'r');let header;
    try{const bytes=Buffer.alloc(8),{bytesRead}=await file.read(bytes,0,8,0);header=bytes.subarray(0,bytesRead);}
    finally{await file.close();}
    signal?.throwIfAborted();
    if(header.equals(Buffer.from([137,80,78,71,13,10,26,10]))){
      const {readNativePng}=await workspaceModule('tools/map-image/native-resample.mjs');
      return readNativePng(spec,{signal,workspace});
    }
  }
  const child=spawn(process.env.PANDO_MAP_PYTHON || resolve(workspace,'build-native/python/Scripts/python.exe'),
    [fileURLToPath(new URL('./raster.py',import.meta.url))],{windowsHide:true,signal:signal || undefined,stdio:['pipe','pipe','pipe']});
  const chunks=[],errors=[];let size=0;
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>300*1024*1024) child.kill();else chunks.push(chunk);});
  child.stderr.on('data',chunk=>errors.push(chunk));
  const finished=new Promise((accept,reject)=>{child.on('error',reject);child.on('close',code=>code===0?accept():reject(new Error(`Raster adapter failed (${code}): ${Buffer.concat(errors).toString()}`)));});
  child.stdin.on('error',()=>{}); // close/error above owns subprocess failures
  child.stdin.write(JSON.stringify(spec)+'\n');child.stdin.end(bytes);
  await finished;signal?.throwIfAborted();
  const buffer=Buffer.concat(chunks),split=buffer.indexOf(10);
  if(split<0) throw new Error('Missing raster header');
  return {...JSON.parse(buffer.subarray(0,split).toString()),data:buffer.subarray(split+1)};
}
export function cropRaster(image,rect,size=null) {
  const width=size || rect.width,height=size || rect.height,data=Buffer.alloc(width*height*4,255);
  for(let y=0;y<rect.height;y++) image.data.copy(data,y*width*4,((rect.y+y)*image.width+rect.x)*4,((rect.y+y)*image.width+rect.x+rect.width)*4);
  return {width,height,data};
}
export const resizeRaster=(image,size,signal)=>raster({action:'resize',width:image.width,height:image.height,size},image.data,signal);
export const pngRaster=(image,signal)=>raster({action:'encode',width:image.width,height:image.height},image.data,signal).then(v=>v.data);
