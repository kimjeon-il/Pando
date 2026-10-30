import { open } from 'node:fs/promises';
import { workspace, workspaceModule } from './workspace.mjs';

export async function raster(spec, bytes=null, signal=null) {
  signal?.throwIfAborted();
  if(spec.action==='preview'){
    const image=await raster({action:'read',path:spec.path,page:spec.page,maxPixels:16777216},null,signal);
    const {renderNativePreview}=await workspaceModule('tools/map-image/native-preview.mjs');
    return renderNativePreview(image,spec.job,{signal,workspace,selectedGeometry:spec.selectedGeometry,sourceIsPdf:spec.path.toLowerCase().endsWith('.pdf')});
  }
  if(spec.action==='read'&&typeof spec.path==='string'&&spec.path.toLowerCase().endsWith('.pdf')){
    const {readNativePdf}=await workspaceModule('tools/map-image/native-pdf.mjs');
    return readNativePdf(spec,{signal,workspace});
  }
  if(spec.action==='resize'||spec.action==='rotate'||spec.action==='encode'){
    const {resizeNativeRgba,rotateNativeRgba,encodeNativePng}=await workspaceModule('tools/map-image/native-resample.mjs');
    const image={width:spec.width,height:spec.height,data:bytes};
    return spec.action==='resize'?resizeNativeRgba(image,spec.size,{signal,workspace}):spec.action==='rotate'?
      rotateNativeRgba(image,spec.degrees,{signal,workspace}):encodeNativePng(image,{signal,workspace});
  }
  if(spec.action==='read'&&typeof spec.path==='string'&&!spec.path.toLowerCase().endsWith('.pdf')){
    const file=await open(spec.path,'r');let header;
    try{const bytes=Buffer.alloc(12),{bytesRead}=await file.read(bytes,0,12,0);header=bytes.subarray(0,bytesRead);}
    finally{await file.close();}
    signal?.throwIfAborted();
    const format=header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':header.length>=2&&header[0]===255&&header[1]===216?'jpeg':
      header.length>=12&&header.toString('ascii',0,4)==='RIFF'&&header.toString('ascii',8,12)==='WEBP'?'webp':null;
    if(format){
      const {readNativeImage}=await workspaceModule('tools/map-image/native-resample.mjs');
      return readNativeImage({...spec,format},{signal,workspace});
    }
  }
  if(spec.action==='read')throw Error('Expected PNG, JPEG, WebP or PDF');
  throw Error('Unknown raster operation');
}
export function cropRaster(image,rect,size=null) {
  const width=size || rect.width,height=size || rect.height,data=Buffer.alloc(width*height*4,255);
  for(let y=0;y<rect.height;y++) image.data.copy(data,y*width*4,((rect.y+y)*image.width+rect.x)*4,((rect.y+y)*image.width+rect.x+rect.width)*4);
  return {width,height,data};
}
export const resizeRaster=(image,size,signal)=>raster({action:'resize',width:image.width,height:image.height,size},image.data,signal);
export const pngRaster=(image,signal)=>raster({action:'encode',width:image.width,height:image.height},image.data,signal).then(v=>v.data);
