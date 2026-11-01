// Native lossless WebP encoding and pixel verification for DEM tiles.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {encodeNativeWebpLossless,readNativeRawWebp} from '../map-image/native-resample.mjs';

export async function encodeDemWebp(image,options={}){
  options.signal?.throwIfAborted();
  if(!image||!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)||image.width<1||image.height<1||
     image.width>16384||image.height>16384||image.width*image.height>16777216||
     !(image.data instanceof Uint8Array)||image.data.length!==image.width*image.height*4)
    throw Error('Bounded RGBA DEM image dimensions and data length required');
  const encoded=await encodeNativeWebpLossless(image,options),decoded=await readNativeRawWebp(encoded.data,options);
  if(decoded.width!==image.width||decoded.height!==image.height||
     !decoded.data.equals(Buffer.from(image.data.buffer,image.data.byteOffset,image.data.byteLength)))
    throw Error('DEM WebP round-trip changed pixels');
  return encoded.data;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3||process.argv[2]!=='--stream')throw Error('Expected --stream');
    const chunks=[];let length=0;for await(const chunk of process.stdin){length+=chunk.length;
      if(length>16+16777216*4)throw Error('DEM WebP input exceeds bounds');chunks.push(chunk);}
    const input=Buffer.concat(chunks,length);
    if(length<16||input.toString('ascii',0,8)!=='PDWEBP01')throw Error('Invalid DEM WebP input header');
    const width=input.readUInt32LE(8),height=input.readUInt32LE(12);
    process.stdout.write(await encodeDemWebp({width,height,data:input.subarray(16)}));
  }catch(error){console.error('terrain-dem-webp: '+error.message);process.exitCode=1;}
}
