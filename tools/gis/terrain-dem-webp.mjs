// Native lossless WebP encoding and pixel verification for DEM tiles.
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
