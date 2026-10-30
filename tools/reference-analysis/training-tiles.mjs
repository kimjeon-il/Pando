// Prepare one source-coordinate training tile with the shared native owners.
import {dirname,extname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {countNativeEncodedTrainingSupervision,prepareNativeTrainingTilePieces,readNativeTrainingRaster,readNativeTrainingMaskWindow,scanNativeTrainingMaskTiles} from '../map-image/native-resample.mjs';
import {reviewMasks} from './review-masks.mjs';
import {REFERENCE_BOUNDARY_CHANNELS,referenceImageTilePlan} from '../../plugins/pando-map-tools/lib/analysis/tiles.mjs';
import {resolveCorpusPath} from './corpus-path.mjs';
import {corpusFingerprint,readTrainingBounded} from './training-evidence.mjs';
import {verifiedMacroTrainingSource,recheckMacroTrainingSource} from './macro-training-source.mjs';
import {validateSemapTrainingCorpus} from './validate-semap.mjs';

const rasterOrigins=new Set(['publisher-layer-export','semap-human-mask-export','macro-vector-supervision']);
// Combine independently verified primary macro and auxiliary Semap training inputs.
export async function inspectCombinedTrainingData({corpus,auxiliary,macroOnly,signal,verifyEvidence,workspace,imageDirectory}){
  signal?.throwIfAborted();
  if(!corpus||!auxiliary||typeof macroOnly!=='boolean')throw Error('Explicit primary, auxiliary and macro scope required');
  if(macroOnly)throw Error('Unreviewed Semap sources are not valid macro-only training inputs');
  const primaryPath=resolve(corpus),auxiliaryPath=resolve(auxiliary),fingerprint=await corpusFingerprint(primaryPath,auxiliaryPath);
  const primaryManifest=JSON.parse(readTrainingBounded(primaryPath,32*1024*1024));
  const auxiliaryManifest=JSON.parse(readTrainingBounded(auxiliaryPath,32*1024*1024));
  if(!Array.isArray(primaryManifest.sheets)||!Array.isArray(auxiliaryManifest.sheets))throw Error('Both training corpora require sheets');
  const ids=new Set(primaryManifest.sheets.map(sheet=>sheet.id));
  if(auxiliaryManifest.sheets.some(sheet=>ids.has(sheet.id)))throw Error('Duplicate sheet identity across training corpora');
  const options={signal,workspace,imageDirectory};
  const primary=await indexMacroTrainingDataset(primaryPath,options),supervision=await macroTrainingSupervision(primaryPath,options);
  if(primary.corpusSha256!==supervision.corpusSha256)throw Error('Primary training corpus changed during preparation');
  const extra=await inspectSemapTrainingDataset(auxiliaryPath,{...options,verifyEvidence});
  const counts=supervision.counts.map((pair,i)=>pair.map((value,j)=>{const sum=value+extra.counts[i][j];
    if(!Number.isSafeInteger(sum))throw Error('Training supervision count exceeds safe range');return sum;}));
  const datasets=[primary.tiles,extra.tiles].map((rows,corpusIndex)=>rows.map(tile=>({...tile,localIndex:tile.index,
    index:tile.index+(corpusIndex?primary.tiles.length:0)})));
  for(const row of primaryManifest.sheets){const {checks}=await verifiedMacroTrainingSource(dirname(primaryPath),primaryManifest,row.id);recheckMacroTrainingSource(checks);}
  if(await corpusFingerprint(primaryPath,auxiliaryPath)!==fingerprint)throw Error('Training sources changed during combined preparation');
  return {trainingOnly:true,releaseApproved:false,independentEvaluation:false,lineageFingerprint:fingerprint,counts,datasets,auxiliarySources:extra.sources};
}
// Semap is auxiliary training data; it is never promoted to reviewed macro scope.
export async function inspectSemapTrainingDataset(corpus,{signal,verifyEvidence,workspace,imageDirectory}={}){
  signal?.throwIfAborted();if(!corpus)throw Error('Explicit Semap training corpus required');
  const path=resolve(corpus),root=dirname(path),hash=value=>createHash('sha256').update(value).digest('hex');
  const bytes=readTrainingBounded(path,32*1024*1024),corpusSha256=hash(bytes),manifest=JSON.parse(bytes);
  const lineageFingerprint=await corpusFingerprint(path);
  const validated=await validateSemapTrainingCorpus(manifest,root,{signal,verifyEvidence});
  const tiles=[],counts=Array.from({length:7},()=>[0,0]);
  for(const {sheet,annotation,counts:sourceCounts} of validated.sources){
    for(let i=0;i<7;i++)for(let j=0;j<2;j++){counts[i][j]+=sourceCounts[i][j];
      if(!Number.isSafeInteger(counts[i][j]))throw Error('Training supervision count exceeds safe range');}
    for(const tile of await listRasterTrainingTiles({root,annotation},{signal,workspace,imageDirectory})){
      if(tiles.length>=1000000)throw Error('Training tile count exceeds budget');
      tiles.push({sourceId:sheet.id,index:tiles.length,x:tile.x,y:tile.y,duplicateGroup:sheet.duplicateGroup});
    }
  }
  if(!tiles.length)throw Error('Corpus has no supervised Semap training tiles');
  for(const {checks} of validated.sources)for(const [source,expected] of checks){signal?.throwIfAborted();
    if(hash(readTrainingBounded(source,16*1024*1024))!==expected)throw Error('Semap source changed during indexing');}
  if(hash(readTrainingBounded(path,32*1024*1024))!==corpusSha256||await corpusFingerprint(path)!==lineageFingerprint)
    throw Error('Training corpus changed during indexing');
  return {trainingOnly:true,releaseApproved:false,independentEvaluation:false,corpusSha256,lineageFingerprint,counts,tiles,sources:validated.sources};
}
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
async function encodedTrainingRaster(root,annotation,field,options){
  if(!rasterOrigins.has(annotation?.origin))throw Error('Explicit raster training supervision required');
  const spec=annotation[field];if(!spec||typeof spec.path!=='string')throw Error('Source-bound raster path required');
  options.signal?.throwIfAborted();
  const path=await resolveCorpusPath(root,spec.path),bytes=readTrainingBounded(path,300*1024*1024);
  options.signal?.throwIfAborted();
  return {bytes,sha256:spec.sha256};
}
async function trainingRaster(root,annotation,field,options){
  const {bytes,sha256}=await encodedTrainingRaster(root,annotation,field,options);
  const nativeOptions={signal:options.signal,workspace:options.workspace,directory:options.imageDirectory};
  if(!options.scanTiles&&!options.window)throw Error('Training mask access requires a window or tile scan');
  const mask=options.scanTiles?await scanNativeTrainingMaskTiles(bytes,sha256,nativeOptions):
    await readNativeTrainingMaskWindow(bytes,sha256,options.window,nativeOptions);
  if(mask.width!==annotation.width||mask.height!==annotation.height)throw Error('Training raster dimensions differ from original');return mask;
}
export async function macroTrainingSupervision(corpus,{signal,workspace,imageDirectory}={}){
  signal?.throwIfAborted();if(!corpus)throw Error('Explicit macro training corpus required');
  const path=resolve(corpus),root=dirname(path),bytes=readTrainingBounded(path,32*1024*1024),hash=value=>createHash('sha256').update(value).digest('hex');
  const corpusSha256=hash(bytes),manifest=JSON.parse(bytes);
  if(manifest.schemaVersion!==1||manifest.trainingOnly!==true||!Array.isArray(manifest.sheets)||!manifest.sheets.length)
    throw Error('Explicit private training-only corpus required');
  const counts=Array.from({length:7},()=>[0,0]),seen=new Set(),sources=[],options={signal,workspace,imageDirectory};
  for(const row of manifest.sheets){signal?.throwIfAborted();if(!row?.id||seen.has(row.id))throw Error('Unique training source identity required');seen.add(row.id);
    if(row.split!=='train')throw Error('Training-only corpus cannot contain validation or test sheets');
    const {annotation,checks}=await verifiedMacroTrainingSource(root,manifest,row.id);
    const [target,known]=await Promise.all([encodedTrainingRaster(root,annotation,'raster',options),encodedTrainingRaster(root,annotation,'validRaster',options)]);
    const supervision=await countNativeEncodedTrainingSupervision(target,known,{signal,workspace,directory:imageDirectory});
    if(supervision.width!==annotation.width||supervision.height!==annotation.height)throw Error('Training raster dimensions differ from original');
    const sheetCounts=supervision.counts;
    for(let i=0;i<7;i++)for(let j=0;j<2;j++){counts[i][j]+=sheetCounts[i][j];if(!Number.isSafeInteger(counts[i][j]))throw Error('Training supervision count exceeds safe range');}
    recheckMacroTrainingSource(checks);
    sources.push({id:row.id,hashes:checks.map(([,expected])=>expected)});
  }
  if(hash(readTrainingBounded(path,32*1024*1024))!==corpusSha256)throw Error('Training corpus changed during supervision');
  const positiveWeights=counts.map(([known,positive])=>Math.max(1,Math.min(64,(known-positive)/Math.max(positive,1))));
  const unobservedChannels=REFERENCE_BOUNDARY_CHANNELS.filter((_,i)=>counts[i][1]===0||counts[i][1]===counts[i][0]);
  return {trainingOnly:true,releaseApproved:false,corpusSha256,counts,positiveWeights,unobservedChannels,sources};
}
export async function listRasterTrainingTiles({root,annotation},{supervisedOnly=true,signal,workspace,imageDirectory}={}){
  if(typeof supervisedOnly!=='boolean')throw Error('Explicit training supervision mode required');
  const options={signal,workspace,imageDirectory,scanTiles:true},mask=await trainingRaster(root,annotation,'validRaster',options);
  const tiles=referenceImageTilePlan(mask.width,mask.height);if(!supervisedOnly)return tiles;
  return tiles.filter((_,index)=>mask.tiles[index]!==0);
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
  const image=await readNativeTrainingRaster({path:imagePath,format,expectedSha256:sourceSha256,x,y},{signal,workspace,directory:imageDirectory});
  if(annotation?.width!==image.width||annotation.height!==image.height)throw Error('Annotations must use oriented original image dimensions');
  const masks=await reviewMasks(annotation,{window:[x,y,512,512],signal,workspace,directory:reviewDirectory});
  return prepareNativeTrainingTilePieces({image,targetBits:masks.targetBits,knownBits:masks.knownBits,x,y,augment,epoch,index},{signal,workspace,directory:imageDirectory});
}
export async function prepareRasterTrainingTile({root,imagePath,sourceSha256,annotation,x,y,augment=false,epoch=0,index=0},
  {signal,workspace,imageDirectory}={}){
  signal?.throwIfAborted();const path=await resolveCorpusPath(root,imagePath),format=({'.png':'png','.jpg':'jpeg','.jpeg':'jpeg','.webp':'webp'})[extname(path).toLowerCase()];
  if(!format||typeof sourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(sourceSha256))throw Error('Source-bound PNG, JPEG or WebP training image required');
  const options={signal,workspace,imageDirectory,window:{x,y}},[image,target,known]=await Promise.all([
    readNativeTrainingRaster({path,format,expectedSha256:sourceSha256,x,y},{signal,workspace,directory:imageDirectory}),
    trainingRaster(root,annotation,'raster',options),trainingRaster(root,annotation,'validRaster',options)]);
  if(annotation.width!==image.width||annotation.height!==image.height)
    throw Error('Annotations must use oriented original image dimensions');
  if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=image.width||y>=image.height)throw Error('Training tile must start inside original image');
  return prepareNativeTrainingTilePieces({image,targetBits:target.data,knownBits:known.data,x,y,augment,epoch,index},{signal,workspace,directory:imageDirectory});
}
