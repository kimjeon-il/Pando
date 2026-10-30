// Prepare one source-coordinate training tile with the shared native owners.
import {dirname,extname,resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {countNativeTrainingSupervision,prepareNativeTrainingTile,readNativeImage,readNativeTrainingMask} from '../map-image/native-resample.mjs';
import {reviewMasks} from './review-masks.mjs';
import {REFERENCE_BOUNDARY_CHANNELS,referenceImageTilePlan} from '../../plugins/pando-map-tools/lib/analysis/tiles.mjs';
import {resolveCorpusPath} from './corpus-path.mjs';
import {readTrainingBounded} from './training-evidence.mjs';
import {verifiedMacroTrainingSource,recheckMacroTrainingSource} from './macro-training-source.mjs';

const rasterOrigins=new Set(['publisher-layer-export','semap-human-mask-export','macro-vector-supervision']);
export async function indexMacroTrainingDataset(corpus,{signal,workspace,imageDirectory}={}){
  signal?.throwIfAborted();if(!corpus)throw Error('Explicit macro training corpus required');
  const path=resolve(corpus),root=dirname(path),bytes=readTrainingBounded(path,32*1024*1024),hash=value=>createHash('sha256').update(value).digest('hex');
  const corpusSha256=hash(bytes),manifest=JSON.parse(bytes);
  if(manifest.schemaVersion!==1||manifest.trainingOnly!==true||!Array.isArray(manifest.sheets))throw Error('Explicit private training-only corpus required');
  const tiles=[],seen=new Set();
  for(const row of manifest.sheets){signal?.throwIfAborted();if(!row?.id||seen.has(row.id))throw Error('Unique training source identity required');seen.add(row.id);
    if(row.split!=='train')throw Error('Training-only corpus cannot contain validation or test sheets');
    const {sheet,annotation,checks}=await verifiedMacroTrainingSource(root,manifest,row.id);
    for(const tile of await listRasterTrainingTiles({root,annotation},{signal,workspace,imageDirectory})){
      if(tiles.length>=1000000)throw Error('Training tile count exceeds budget');
      tiles.push({sourceId:sheet.id,index:tiles.length,x:tile.x,y:tile.y,duplicateGroup:sheet.duplicateGroup});
    }
    recheckMacroTrainingSource(checks);
  }
  if(!tiles.length)throw Error('Corpus has no supervised macro training tiles');
  if(hash(readTrainingBounded(path,32*1024*1024))!==corpusSha256)throw Error('Training corpus changed during indexing');
  return {trainingOnly:true,releaseApproved:false,corpusSha256,tiles};
}
async function trainingRaster(root,annotation,field,options){
  if(!rasterOrigins.has(annotation?.origin))throw Error('Explicit raster training supervision required');
  const spec=annotation[field];if(!spec||typeof spec.path!=='string')throw Error('Source-bound raster path required');
  const path=await resolveCorpusPath(root,spec.path),bytes=await readFile(path,{signal:options.signal});
  const mask=await readNativeTrainingMask(bytes,spec.sha256,{signal:options.signal,workspace:options.workspace,directory:options.imageDirectory});
  if(mask.width!==annotation.width||mask.height!==annotation.height)throw Error('Training raster dimensions differ from original');return mask;
}
export async function macroTrainingSupervision(corpus,{signal,workspace,imageDirectory}={}){
  signal?.throwIfAborted();if(!corpus)throw Error('Explicit macro training corpus required');
  const path=resolve(corpus),root=dirname(path),bytes=readTrainingBounded(path,32*1024*1024),hash=value=>createHash('sha256').update(value).digest('hex');
  const corpusSha256=hash(bytes),manifest=JSON.parse(bytes);
  if(manifest.schemaVersion!==1||manifest.trainingOnly!==true||!Array.isArray(manifest.sheets)||!manifest.sheets.length)
    throw Error('Explicit private training-only corpus required');
  const counts=Array.from({length:7},()=>[0,0]),seen=new Set(),options={signal,workspace,imageDirectory};
  for(const row of manifest.sheets){signal?.throwIfAborted();if(!row?.id||seen.has(row.id))throw Error('Unique training source identity required');seen.add(row.id);
    if(row.split!=='train')throw Error('Training-only corpus cannot contain validation or test sheets');
    const {annotation,checks}=await verifiedMacroTrainingSource(root,manifest,row.id);
    const [target,known]=await Promise.all([trainingRaster(root,annotation,'raster',options),trainingRaster(root,annotation,'validRaster',options)]);
    const sheetCounts=await countNativeTrainingSupervision(target,known,{signal,workspace,directory:imageDirectory});
    for(let i=0;i<7;i++)for(let j=0;j<2;j++){counts[i][j]+=sheetCounts[i][j];if(!Number.isSafeInteger(counts[i][j]))throw Error('Training supervision count exceeds safe range');}
    recheckMacroTrainingSource(checks);
  }
  if(hash(readTrainingBounded(path,32*1024*1024))!==corpusSha256)throw Error('Training corpus changed during supervision');
  const positiveWeights=counts.map(([known,positive])=>Math.max(1,Math.min(64,(known-positive)/Math.max(positive,1))));
  const unobservedChannels=REFERENCE_BOUNDARY_CHANNELS.filter((_,i)=>counts[i][1]===0||counts[i][1]===counts[i][0]);
  return {trainingOnly:true,releaseApproved:false,corpusSha256,counts,positiveWeights,unobservedChannels};
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

export async function prepareReviewedTrainingTile({imagePath,sourceSha256,annotation,x,y,augment=false,epoch=0,index=0},
  {signal,workspace,imageDirectory,reviewDirectory}={}){
  signal?.throwIfAborted();
  const format=({'.png':'png','.jpg':'jpeg','.jpeg':'jpeg','.webp':'webp'})[extname(imagePath||'').toLowerCase()];
  if(!format||typeof sourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(sourceSha256))throw Error('Source-bound PNG, JPEG or WebP training image required');
  const image=await readNativeImage({path:imagePath,format,maxPixels:16777216,expectedSha256:sourceSha256},{signal,workspace,directory:imageDirectory});
  if(annotation?.width!==image.originalWidth||annotation.height!==image.originalHeight||image.width!==image.originalWidth||image.height!==image.originalHeight)
    throw Error('Annotations must use oriented original image dimensions');
  if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=image.width||y>=image.height)throw Error('Training tile must start inside original image');
  const masks=await reviewMasks(annotation,{window:[x,y,512,512],signal,workspace,directory:reviewDirectory});
  return prepareNativeTrainingTile({image,targetBits:masks.targetBits,knownBits:masks.knownBits,x,y,augment,epoch,index},{signal,workspace,directory:imageDirectory});
}
export async function prepareRasterTrainingTile({root,imagePath,sourceSha256,annotation,x,y,augment=false,epoch=0,index=0},
  {signal,workspace,imageDirectory}={}){
  signal?.throwIfAborted();const path=await resolveCorpusPath(root,imagePath),format=({'.png':'png','.jpg':'jpeg','.jpeg':'jpeg','.webp':'webp'})[extname(path).toLowerCase()];
  if(!format||typeof sourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(sourceSha256))throw Error('Source-bound PNG, JPEG or WebP training image required');
  const options={signal,workspace,imageDirectory},[image,target,known]=await Promise.all([
    readNativeImage({path,format,maxPixels:16777216,expectedSha256:sourceSha256},{signal,workspace,directory:imageDirectory}),
    trainingRaster(root,annotation,'raster',options),trainingRaster(root,annotation,'validRaster',options)]);
  if(annotation.width!==image.originalWidth||annotation.height!==image.originalHeight||image.width!==image.originalWidth||image.height!==image.originalHeight)
    throw Error('Annotations must use oriented original image dimensions');
  if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=image.width||y>=image.height)throw Error('Training tile must start inside original image');
  return prepareNativeTrainingTile({image,targetBits:maskWindow(target,x,y),knownBits:maskWindow(known,x,y),x,y,augment,epoch,index},{signal,workspace,directory:imageDirectory});
}
