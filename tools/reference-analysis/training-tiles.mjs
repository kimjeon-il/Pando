// Prepare one source-coordinate training tile with the shared native owners.
import {extname} from 'node:path';
import {readFile} from 'node:fs/promises';
import {prepareNativeTrainingTile,readNativeImage,readNativeTrainingMask} from '../map-image/native-resample.mjs';
import {reviewMasks} from './review-masks.mjs';
import {referenceImageTilePlan} from '../../plugins/pando-map-tools/lib/analysis/tiles.mjs';
import {resolveCorpusPath} from './corpus-path.mjs';

const rasterOrigins=new Set(['publisher-layer-export','semap-human-mask-export','macro-vector-supervision']);
async function trainingRaster(root,annotation,field,options){
  if(!rasterOrigins.has(annotation?.origin))throw Error('Explicit raster training supervision required');
  const spec=annotation[field];if(!spec||typeof spec.path!=='string')throw Error('Source-bound raster path required');
  const path=await resolveCorpusPath(root,spec.path),bytes=await readFile(path,{signal:options.signal});
  const mask=await readNativeTrainingMask(bytes,spec.sha256,{signal:options.signal,workspace:options.workspace,directory:options.imageDirectory});
  if(mask.width!==annotation.width||mask.height!==annotation.height)throw Error('Training raster dimensions differ from original');return mask;
}
function maskWindow(mask,x,y){
  const result=Buffer.alloc(512*512),width=Math.min(512,mask.width-x),height=Math.min(512,mask.height-y);
  for(let row=0;row<height;row++)mask.data.copy(result,row*512,(y+row)*mask.width+x,(y+row)*mask.width+x+width);return result;
}
export async function listRasterTrainingTiles({root,annotation},{supervisedOnly=true,signal,workspace,imageDirectory}={}){
  if(typeof supervisedOnly!=='boolean')throw Error('Explicit training supervision mode required');
  const options={signal,workspace,imageDirectory},mask=await trainingRaster(root,annotation,'validRaster',options);
  const tiles=referenceImageTilePlan(mask.width,mask.height);if(!supervisedOnly)return tiles;
  return tiles.filter(tile=>{for(let y=tile.y;y<tile.y+tile.height;y++)for(let x=tile.x;x<tile.x+tile.width;x++)if(mask.data[y*mask.width+x])return true;return false;});
}

export async function listReviewedTrainingTiles(annotation,{supervisedOnly=true,signal,workspace,reviewDirectory}={}){
  signal?.throwIfAborted();if(typeof supervisedOnly!=='boolean')throw Error('Explicit training supervision mode required');
  const tiles=referenceImageTilePlan(annotation?.width,annotation?.height);if(!supervisedOnly)return tiles;
  const selected=[];for(const tile of tiles){signal?.throwIfAborted();
    const masks=await reviewMasks(annotation,{window:[tile.x,tile.y,512,512],signal,workspace,directory:reviewDirectory});
    if(masks.knownBits.some(value=>value!==0))selected.push(tile);
  }
  return selected;
}

export async function prepareReviewedTrainingTile({imagePath,annotation,x,y,augment=false,epoch=0,index=0},
  {signal,workspace,imageDirectory,reviewDirectory}={}){
  signal?.throwIfAborted();
  const format=({'.png':'png','.jpg':'jpeg','.jpeg':'jpeg','.webp':'webp'})[extname(imagePath||'').toLowerCase()];
  if(!format)throw Error('Supported original PNG, JPEG or WebP training image required');
  const image=await readNativeImage({path:imagePath,format,maxPixels:16777216},{signal,workspace,directory:imageDirectory});
  if(annotation?.width!==image.originalWidth||annotation.height!==image.originalHeight||image.width!==image.originalWidth||image.height!==image.originalHeight)
    throw Error('Annotations must use oriented original image dimensions');
  if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=image.width||y>=image.height)throw Error('Training tile must start inside original image');
  const masks=await reviewMasks(annotation,{window:[x,y,512,512],signal,workspace,directory:reviewDirectory});
  return prepareNativeTrainingTile({image,targetBits:masks.targetBits,knownBits:masks.knownBits,x,y,augment,epoch,index},{signal,workspace,directory:imageDirectory});
}
export async function prepareRasterTrainingTile({root,imagePath,annotation,x,y,augment=false,epoch=0,index=0},
  {signal,workspace,imageDirectory}={}){
  signal?.throwIfAborted();const path=await resolveCorpusPath(root,imagePath),format=({'.png':'png','.jpg':'jpeg','.jpeg':'jpeg','.webp':'webp'})[extname(path).toLowerCase()];
  if(!format)throw Error('Supported original PNG, JPEG or WebP training image required');
  const options={signal,workspace,imageDirectory},[image,target,known]=await Promise.all([
    readNativeImage({path,format,maxPixels:16777216},{signal,workspace,directory:imageDirectory}),
    trainingRaster(root,annotation,'raster',options),trainingRaster(root,annotation,'validRaster',options)]);
  if(annotation.width!==image.originalWidth||annotation.height!==image.originalHeight||image.width!==image.originalWidth||image.height!==image.originalHeight)
    throw Error('Annotations must use oriented original image dimensions');
  if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=image.width||y>=image.height)throw Error('Training tile must start inside original image');
  return prepareNativeTrainingTile({image,targetBits:maskWindow(target,x,y),knownBits:maskWindow(known,x,y),x,y,augment,epoch,index},{signal,workspace,directory:imageDirectory});
}
