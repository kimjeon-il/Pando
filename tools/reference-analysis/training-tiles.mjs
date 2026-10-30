// Prepare one source-coordinate training tile with the shared native owners.
import {extname} from 'node:path';
import {prepareNativeTrainingTile,readNativeImage} from '../map-image/native-resample.mjs';
import {reviewMasks} from './review-masks.mjs';
import {referenceImageTilePlan} from '../../plugins/pando-map-tools/lib/analysis/tiles.mjs';

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
