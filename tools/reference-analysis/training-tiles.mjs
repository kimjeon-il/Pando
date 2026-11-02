// Prepare one source-coordinate training tile with the shared native owners.
import {dirname,extname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {auditNativeTrainingMask,countNativeEncodedTrainingSupervision,countNativeTrainingSupervision,inspectNativeImageHeader,prepareNativeTrainingTilePieces,readNativeTrainingRaster,readNativeTrainingMaskWindow,scanNativeTrainingMaskTiles} from '../map-image/native-resample.mjs';
import {reviewMasks} from './review-masks.mjs';
import {REFERENCE_BOUNDARY_CHANNELS,referenceImageTilePlan} from '../../plugins/pando-map-tools/lib/analysis/tiles.mjs';
import {resolveCorpusPath} from './corpus-path.mjs';
import {assertTrainingCorpusScope,corpusFingerprint,readTrainingBounded,trainingFileIdentity} from './training-evidence.mjs';
import {verifiedMacroTrainingSource,recheckTrainingSources} from './macro-training-source.mjs';
import {validateSemapTrainingCorpus} from './validate-semap.mjs';
import {validateCorpusMetadata,validatePublisherProvenance,validateReviewedCorpus} from './reviewed-corpus.mjs';

const rasterOrigins=new Set(['publisher-layer-export','semap-human-mask-export','macro-vector-supervision']);
export function isRasterTrainingAnnotation(annotation){return rasterOrigins.has(annotation?.origin);}

// Validate one historical publisher source; its derived masks are not review truth.
export async function validatePublisherTrainingSource({root,corpus,sourceId},{signal,workspace,imageDirectory,rendererVersion='1.26.6'}={}){
  signal?.throwIfAborted();
  if(typeof root!=='string'||!root||typeof sourceId!=='string'||!sourceId)throw Error('Explicit publisher source and corpus root required');
  validateCorpusMetadata(corpus,{trainingOnly:true});
  const matches=corpus.sheets.filter(sheet=>sheet.id===sourceId);
  if(matches.length!==1)throw Error('Unique publisher training source required');
  const sheet=matches[0],annotationPath=await resolveCorpusPath(root,sheet.annotations),bytes=readTrainingBounded(annotationPath,64*1024*1024);
  const annotation=JSON.parse(bytes.toString('utf8')),annotationSha256=createHash('sha256').update(bytes).digest('hex');
  if(annotation.origin!=='publisher-layer-export')throw Error('Publisher training annotation required');
  await validatePublisherProvenance(annotation,sheet,root,{rendererVersion,signal});
  const imagePath=await resolveCorpusPath(root,sheet.image);
  if(trainingFileIdentity(imagePath)!==sheet.sha256)throw Error('Original image hash changed: '+sheet.id);
  const format=({'.png':'png','.jpg':'jpeg','.jpeg':'jpeg','.webp':'webp'})[extname(imagePath).toLowerCase()];
  const image=await inspectNativeImageHeader(readTrainingBounded(imagePath,300*1024*1024),format,{signal,workspace,directory:imageDirectory});
  if(image.encodedSize[0]!==annotation.width||image.encodedSize[1]!==annotation.height)throw Error('Publisher raster/image dimensions differ');
  await auditTrainingRasters({root,annotation},{signal,workspace,imageDirectory});
  const checks=[[annotationPath,annotationSha256],[imagePath,sheet.sha256]];
  for(const [field,expected] of [['sourcePdf',annotation.sourceSha256],['sourceMetadata',annotation.sourceMetadataSha256],
    ['raster',annotation.raster?.sha256],['validRaster',annotation.validRaster?.sha256]])
    checks.push([await resolveCorpusPath(root,typeof annotation[field]==='string'?annotation[field]:annotation[field]?.path),expected]);
  recheckTrainingSources(checks);
  return {sheet,annotation,annotationPath,annotationSha256,imagePath,checks,trainingOnly:true,independentEvaluation:false,releaseApproved:false};
}

export async function verifiedPrimaryTrainingSource(root,corpus,sourceId,{allowPublisher=false,allowReviewed=false,signal,workspace,imageDirectory,reviewDirectory}={}){
  if(typeof allowPublisher!=='boolean'||typeof allowReviewed!=='boolean')throw Error('Explicit training source scope required');
  if(allowReviewed&&corpus?.trainingOnly!==true){
    validateCorpusMetadata(corpus);
    if(!corpus.sheets.length||corpus.sheets.some(sheet=>sheet.split!=='train'))throw Error('Reviewed training corpus must contain only training sources');
    const matches=corpus.sheets.filter(sheet=>sheet.id===sourceId);if(matches.length!==1)throw Error('Unique reviewed training source required');
    let verified;await validateReviewedCorpus({...corpus,sheets:matches},root,{signal,workspace,reviewDirectory,onVerified:value=>{verified=value;}});
    const checks=[[verified.annotationPath,verified.annotationSha256],[verified.imagePath,verified.sheet.sha256]];recheckTrainingSources(checks);
    return {...verified,checks};
  }
  if(!allowPublisher)return verifiedMacroTrainingSource(root,corpus,sourceId);
  if(corpus?.schemaVersion!==1||corpus.trainingOnly!==true||!Array.isArray(corpus.sheets))throw Error('Explicit private training-only corpus required');
  const matches=corpus.sheets.filter(sheet=>sheet?.id===sourceId);
  if(matches.length!==1)throw Error('Unique training source identity required');
  const annotation=JSON.parse(readTrainingBounded(await resolveCorpusPath(root,matches[0].annotations),64*1024*1024));
  return annotation.origin==='publisher-layer-export'?validatePublisherTrainingSource({root,corpus,sourceId},{signal,workspace,imageDirectory}):
    verifiedMacroTrainingSource(root,corpus,sourceId);
}
// Combine verified primary sources and auxiliary Semap training inputs.
export async function inspectCombinedTrainingData({corpus,auxiliary,macroOnly,signal,verifyEvidence,workspace,imageDirectory}){
  signal?.throwIfAborted();
  if(!corpus||!auxiliary||typeof macroOnly!=='boolean')throw Error('Explicit primary, auxiliary and macro scope required');
  if(macroOnly)throw Error('Unreviewed Semap sources are not valid macro-only training inputs');
  const primaryPath=resolve(corpus),auxiliaryPath=resolve(auxiliary);
  const primaryManifest=JSON.parse(readTrainingBounded(primaryPath,32*1024*1024));
  const auxiliaryManifest=JSON.parse(readTrainingBounded(auxiliaryPath,32*1024*1024));
  if(!Array.isArray(primaryManifest.sheets)||!Array.isArray(auxiliaryManifest.sheets))throw Error('Both training corpora require sheets');
  assertTrainingCorpusScope(auxiliaryPath);
  if(primaryManifest.trainingOnly!==true){validateCorpusMetadata(primaryManifest);
    if(!primaryManifest.sheets.length||primaryManifest.sheets.some(sheet=>sheet.split!=='train'))throw Error('Reviewed training corpus must contain only training sources');}
  const fingerprint=await corpusFingerprint(primaryPath,auxiliaryPath);
  const ids=new Set(primaryManifest.sheets.map(sheet=>sheet.id));
  if(auxiliaryManifest.sheets.some(sheet=>ids.has(sheet.id)))throw Error('Duplicate sheet identity across training corpora');
  const options={signal,workspace,imageDirectory,allowPublisher:true,allowReviewed:true};
  const primary=await indexTrainingDataset(primaryPath,options),supervision=await trainingSupervision(primaryPath,options);
  if(primary.corpusSha256!==supervision.corpusSha256)throw Error('Primary training corpus changed during preparation');
  const extra=await inspectSemapTrainingDataset(auxiliaryPath,{...options,verifyEvidence});
  const counts=supervision.counts.map((pair,i)=>pair.map((value,j)=>{const sum=value+extra.counts[i][j];
    if(!Number.isSafeInteger(sum))throw Error('Training supervision count exceeds safe range');return sum;}));
  const datasets=[primary.tiles,extra.tiles].map((rows,corpusIndex)=>rows.map(tile=>({...tile,localIndex:tile.index,
    index:tile.index+(corpusIndex?primary.tiles.length:0)})));
  for(const row of primaryManifest.sheets){const {checks}=await verifiedPrimaryTrainingSource(dirname(primaryPath),primaryManifest,row.id,options);recheckTrainingSources(checks);}
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
export async function indexTrainingDataset(corpus,{signal,workspace,imageDirectory,reviewDirectory,allowPublisher=false,allowReviewed=false}={}){
  signal?.throwIfAborted();if(!corpus)throw Error('Explicit macro training corpus required');
  const path=resolve(corpus),root=dirname(path),bytes=readTrainingBounded(path,32*1024*1024),hash=value=>createHash('sha256').update(value).digest('hex');
  const corpusSha256=hash(bytes),manifest=JSON.parse(bytes);
  if(manifest.schemaVersion!==1||(!allowReviewed&&manifest.trainingOnly!==true)||!Array.isArray(manifest.sheets))throw Error('Explicit private training-only corpus required');
  if(allowReviewed&&manifest.trainingOnly!==true)validateCorpusMetadata(manifest);
  const tiles=[],seen=new Set();
  for(const row of manifest.sheets){signal?.throwIfAborted();if(!row?.id||seen.has(row.id))throw Error('Unique training source identity required');seen.add(row.id);
    if(row.split!=='train')throw Error('Training-only corpus cannot contain validation or test sheets');
    const {sheet,annotation,checks}=await verifiedPrimaryTrainingSource(root,manifest,row.id,{allowPublisher,allowReviewed,signal,workspace,imageDirectory,reviewDirectory});
    const reviewed=!isRasterTrainingAnnotation(annotation);
    const sourceTiles=reviewed?await listReviewedTrainingTiles(annotation,{fullSheetCoordinates:true,signal,workspace,reviewDirectory}):
      await listRasterTrainingTiles({root,annotation},{signal,workspace,imageDirectory});
    for(const tile of sourceTiles){
      if(tiles.length>=1000000)throw Error('Training tile count exceeds budget');
      tiles.push({sourceId:sheet.id,index:tiles.length,x:tile.x,y:tile.y,duplicateGroup:sheet.duplicateGroup,
        ...(allowPublisher||allowReviewed?{sourceKind:reviewed?'reviewed':annotation.origin==='publisher-layer-export'?'publisher-pdf':'macro-pdf'}:{})});
    }
    recheckTrainingSources(checks);
  }
  if(!tiles.length)throw Error('Corpus has no supervised macro training tiles');
  if(hash(readTrainingBounded(path,32*1024*1024))!==corpusSha256)throw Error('Training corpus changed during indexing');
  return {trainingOnly:true,releaseApproved:false,corpusSha256,tiles};
}
async function encodedTrainingRaster(root,annotation,field,options){
  if(!isRasterTrainingAnnotation(annotation))throw Error('Explicit raster training supervision required');
  const spec=annotation[field];if(!spec||typeof spec.path!=='string')throw Error('Source-bound raster path required');
  options.signal?.throwIfAborted();
  const path=await resolveCorpusPath(root,spec.path),bytes=readTrainingBounded(path,300*1024*1024);
  options.signal?.throwIfAborted();
  return {bytes,sha256:spec.sha256};
}
export async function auditTrainingRasters({root,annotation},{signal,workspace,imageDirectory}={}){
  signal?.throwIfAborted();const observed=annotation?.observedChannels;
  if(!Array.isArray(observed)||!observed.length||new Set(observed).size!==observed.length||
    observed.some(channel=>!REFERENCE_BOUNDARY_CHANNELS.includes(channel)))throw Error('Explicit observed publisher channels required');
  const allowed=observed.reduce((bits,channel)=>bits|(1<<REFERENCE_BOUNDARY_CHANNELS.indexOf(channel)),0);
  for(const field of ['raster','validRaster']){
    const mask=await encodedTrainingRaster(root,annotation,field,{signal});
    const result=await auditNativeTrainingMask(mask,{signal,workspace,directory:imageDirectory});
    if(result.width!==annotation.width||result.height!==annotation.height)throw Error('Publisher raster dimensions or mode differ');
    if(result.observedBits&~allowed)throw Error('Publisher raster contains unobserved channels');
  }
}
export async function countAnnotationTrainingSupervision({root,annotation},{signal,workspace,imageDirectory,reviewDirectory}={}){
  signal?.throwIfAborted();const {width,height}=annotation||{};
  if(![width,height].every(value=>Number.isInteger(value)&&value>0&&value<=65535)||width*height>600000000)
    throw Error('Bounded original supervision dimensions required');
  if(isRasterTrainingAnnotation(annotation)){
    if(!root)throw Error('Source-bound raster supervision root required');
    const options={signal,workspace,imageDirectory},[target,known]=await Promise.all([
      encodedTrainingRaster(root,annotation,'raster',options),encodedTrainingRaster(root,annotation,'validRaster',options)]);
    const result=await countNativeEncodedTrainingSupervision(target,known,{signal,workspace,directory:imageDirectory});
    if(result.width!==width||result.height!==height)throw Error('Training raster dimensions differ from original');return result.counts;
  }
  const counts=Array.from({length:7},()=>[0,0]);
  for(let y=0;y<height;y+=4096)for(let x=0;x<width;x+=4096){
    signal?.throwIfAborted();const w=Math.min(4096,width-x),h=Math.min(4096,height-y);
    const masks=await reviewMasks(annotation,{window:[x,y,w,h],fullSheetCoordinates:true,signal,workspace,directory:reviewDirectory});
    const part=await countNativeTrainingSupervision({width:w,height:h,data:masks.targetBits},{width:w,height:h,data:masks.knownBits},
      {signal,workspace,directory:imageDirectory});
    for(let i=0;i<7;i++)for(let j=0;j<2;j++){counts[i][j]+=part[i][j];if(!Number.isSafeInteger(counts[i][j]))throw Error('Training supervision count exceeds safe range');}
  }
  return counts;
}
async function trainingRaster(root,annotation,field,options){
  const {bytes,sha256}=await encodedTrainingRaster(root,annotation,field,options);
  const nativeOptions={signal:options.signal,workspace:options.workspace,directory:options.imageDirectory};
  if(!options.scanTiles&&!options.window)throw Error('Training mask access requires a window or tile scan');
  const mask=options.scanTiles?await scanNativeTrainingMaskTiles(bytes,sha256,nativeOptions):
    await readNativeTrainingMaskWindow(bytes,sha256,options.window,nativeOptions);
  if(mask.width!==annotation.width||mask.height!==annotation.height)throw Error('Training raster dimensions differ from original');return mask;
}
export async function trainingSupervision(corpus,{signal,workspace,imageDirectory,reviewDirectory,allowPublisher=false,allowReviewed=false}={}){
  signal?.throwIfAborted();if(!corpus)throw Error('Explicit macro training corpus required');
  const path=resolve(corpus),root=dirname(path),bytes=readTrainingBounded(path,32*1024*1024),hash=value=>createHash('sha256').update(value).digest('hex');
  const corpusSha256=hash(bytes),manifest=JSON.parse(bytes);
  if(manifest.schemaVersion!==1||(!allowReviewed&&manifest.trainingOnly!==true)||!Array.isArray(manifest.sheets)||!manifest.sheets.length)
    throw Error('Explicit private training-only corpus required');
  if(allowReviewed&&manifest.trainingOnly!==true)validateCorpusMetadata(manifest);
  const counts=Array.from({length:7},()=>[0,0]),seen=new Set(),sources=[],options={signal,workspace,imageDirectory,reviewDirectory};
  for(const row of manifest.sheets){signal?.throwIfAborted();if(!row?.id||seen.has(row.id))throw Error('Unique training source identity required');seen.add(row.id);
    if(row.split!=='train')throw Error('Training-only corpus cannot contain validation or test sheets');
    const {annotation,checks}=await verifiedPrimaryTrainingSource(root,manifest,row.id,{allowPublisher,allowReviewed,signal,workspace,imageDirectory,reviewDirectory});
    const sheetCounts=await countAnnotationTrainingSupervision({root,annotation},options);
    for(let i=0;i<7;i++)for(let j=0;j<2;j++){counts[i][j]+=sheetCounts[i][j];if(!Number.isSafeInteger(counts[i][j]))throw Error('Training supervision count exceeds safe range');}
    recheckTrainingSources(checks);
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

export async function listReviewedTrainingTiles(annotation,{supervisedOnly=true,fullSheetCoordinates=false,signal,workspace,reviewDirectory}={}){
  signal?.throwIfAborted();if(typeof supervisedOnly!=='boolean'||typeof fullSheetCoordinates!=='boolean')throw Error('Explicit training supervision mode required');
  const tiles=referenceImageTilePlan(annotation?.width,annotation?.height);if(!supervisedOnly)return tiles;
  const selected=[];for(const tile of tiles){signal?.throwIfAborted();
    const masks=await reviewMasks(annotation,{window:[tile.x,tile.y,512,512],fullSheetCoordinates,signal,workspace,directory:reviewDirectory});
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

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3||!['--index','--sample','--source-rgb','--supervision','--coverage','--audit-rasters'].includes(process.argv[2]))throw Error('Expected a training input operation');
    const chunks=[];let length=0;for await(const chunk of process.stdin){length+=chunk.length;if(length>64*1024*1024)throw Error('Training index request exceeds budget');chunks.push(chunk);}
    const request=JSON.parse(Buffer.concat(chunks,length).toString('utf8'));
    const {root,annotation}=request;
    if(process.argv[2]==='--audit-rasters'){
      if(typeof root!=='string'||!root)throw Error('Explicit training raster root required');
      await auditTrainingRasters({root,annotation});process.stdout.write(JSON.stringify({valid:true})+'\n');
    }else if(process.argv[2]==='--index'){
      const {width,height,supervisedOnly}=request;
      if(annotation?.width!==width||annotation?.height!==height||typeof supervisedOnly!=='boolean')throw Error('Training index dimensions or supervision differ');
      const tiles=isRasterTrainingAnnotation(annotation)?await listRasterTrainingTiles({root,annotation},{supervisedOnly}):
        await listReviewedTrainingTiles(annotation,{supervisedOnly,fullSheetCoordinates:true});
      process.stdout.write(JSON.stringify(tiles.map(({x,y})=>({x,y})))+'\n');
    }else if(process.argv[2]==='--coverage'){
      if(!annotation||typeof annotation!=='object'||Array.isArray(annotation))throw Error('Explicit reviewed annotation required');
      const {origin,...review}=annotation;
      const counts=await countAnnotationTrainingSupervision({annotation:{...review,lines:[],regions:[]}});
      process.stdout.write(JSON.stringify(counts.map(row=>row[0]))+'\n');
    }else if(process.argv[2]==='--supervision'){
      if(typeof root!=='string'||!root||!Array.isArray(request.sheets)||request.sheets.length>1000000)throw Error('Explicit training supervision sources required');
      const counts=Array.from({length:7},()=>[0,0]);
      for(const sheet of request.sheets){
        const path=await resolveCorpusPath(root,sheet?.annotations),bytes=readTrainingBounded(path,64*1024*1024),hash=createHash('sha256').update(bytes).digest('hex');
        const annotation=JSON.parse(bytes),part=await countAnnotationTrainingSupervision({root,annotation});
        if(createHash('sha256').update(readTrainingBounded(path,64*1024*1024)).digest('hex')!==hash)throw Error('Training annotation changed during supervision');
        for(let i=0;i<7;i++)for(let j=0;j<2;j++){counts[i][j]+=part[i][j];if(!Number.isSafeInteger(counts[i][j]))throw Error('Training supervision count exceeds safe range');}
      }
      process.stdout.write(JSON.stringify(counts)+'\n');
    }else if(process.argv[2]==='--sample'){
      const {sheet,x,y,augment,epoch,index}=request;
      if(typeof root!=='string'||!root||!sheet||typeof sheet.image!=='string')throw Error('Source-bound training image required');
      const inputs={sourceSha256:sheet.sha256,annotation,x,y,augment,epoch,index};
      const tensors=isRasterTrainingAnnotation(annotation)?await prepareRasterTrainingTile({...inputs,root,imagePath:sheet.image}):
        await prepareReviewedTrainingTile({...inputs,imagePath:await resolveCorpusPath(root,sheet.image)});
      for(const name of ['tile','overview','position','target','valid'])process.stdout.write(tensors[name]);
    }else{
      const {sheet,x,y}=request;
      if(typeof root!=='string'||!root||!sheet||typeof sheet.image!=='string')throw Error('Source-bound diagnostic image required');
      const path=await resolveCorpusPath(root,sheet.image),format=({'.png':'png','.jpg':'jpeg','.jpeg':'jpeg','.webp':'webp'})[extname(path).toLowerCase()];
      const image=await readNativeTrainingRaster({path,format,expectedSha256:sheet.sha256,x,y});
      if(annotation?.width!==image.width||annotation?.height!==image.height)throw Error('Annotations must use oriented original image dimensions');
      const rgb=Buffer.alloc(512*512*3);for(let i=0;i<512*512;i++)for(let channel=0;channel<3;channel++)rgb[i*3+channel]=image.tile[i*4+channel];
      process.stdout.write(rgb);
    }
  }catch(error){console.error('training-tiles: '+error.message);process.exitCode=1;}
}
