import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {corpusFingerprint,readTrainingBounded} from './training-evidence.mjs';
import {resolveCorpusPath} from './corpus-path.mjs';
import {verifiedMacroTrainingSource,recheckMacroTrainingSource} from './macro-training-source.mjs';
import {indexMacroTrainingDataset,inspectSemapTrainingDataset,listRasterTrainingTiles,prepareRasterTrainingTile} from './training-tiles.mjs';

export const TRAINING_TENSOR_NAMES=Object.freeze(['tile','overview','position','target','valid']);
const TRAINING_TENSOR_LIMITS=Object.freeze({tile:3*512*512*4,overview:3*256*256*4,position:4*4,target:7*512*512*4,valid:7*512*512*4});
export const trainingSha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function verifyTrainingSample(directory,{requireInternational=false}={}){
  const receiptPath=join(directory,'sample.json'),receiptInfo=statSync(receiptPath);
  if(!receiptInfo.isFile()||receiptInfo.size>1024*1024)throw Error('Training sample receipt exceeds its byte budget');
  const data=JSON.parse(readFileSync(receiptPath,'utf8'));
  if(data.trainingOnly!==true||data.releaseApproved!==false||typeof data.sourceId!=='string'||!data.sourceId||
    !Number.isInteger(data.tileIndex)||data.tileIndex<0||
    !Number.isInteger(data.augmentationIndex)||data.augmentationIndex<0||!['macro-pdf','semap-label'].includes(data.sourceKind)||
    (requireInternational&&(!(data.knownInternationalPixels>0)||!(data.positiveInternationalPixels>0)))||
    !['sourceEvidenceSha256','imageSha256','annotationSha256','maskSha256','validMaskSha256'].every(field=>/^[a-f0-9]{64}$/.test(data[field]||'')))
    throw Error('A source-bound training-only sample receipt is required');
  for(const name of TRAINING_TENSOR_NAMES){const path=join(directory,name+'.f32'),info=statSync(path);
    if(!info.isFile()||info.size<1||info.size>TRAINING_TENSOR_LIMITS[name])throw Error('Training sample tensor exceeds its byte budget: '+name);
    if(trainingSha256(readFileSync(path))!==data.tensorSha256?.[name])throw Error('Training sample tensor changed: '+name);
  }
  return data;
}

// A single private sample; its caller owns dataset ordering and epoch orchestration.
export async function writeMacroTrainingSample({corpus,sourceId,tileIndex,x,y,augment,epoch,output,signal}){
  signal?.throwIfAborted();
  if(!corpus||!sourceId||!output||typeof augment!=='boolean'||![tileIndex,x,y,epoch].every(value=>Number.isSafeInteger(value)&&value>=0))
    throw Error('Explicit macro training sample inputs required');
  if(existsSync(output))throw Error('Training sample output exists; preserve it');
  const corpusPath=resolve(corpus),root=dirname(corpusPath),corpusBytes=readTrainingBounded(corpusPath,32*1024*1024),corpusHash=trainingSha256(corpusBytes);
  const {sheet,annotation,annotationSha256,checks}=await verifiedMacroTrainingSource(root,JSON.parse(corpusBytes),sourceId);
  const tiles=await listRasterTrainingTiles({root,annotation},{signal});
  if(!tiles.some(tile=>tile.x===x&&tile.y===y))throw Error('Sample must select a supervised source tile');
  const tensors=await prepareRasterTrainingTile({root,imagePath:sheet.image,sourceSha256:sheet.sha256,annotation,x,y,augment,epoch,index:tileIndex},{signal});
  recheckMacroTrainingSource(checks);
  if(trainingSha256(readTrainingBounded(corpusPath,32*1024*1024))!==corpusHash)throw Error('Training corpus changed during sample preparation');
  const tensorSha256=Object.fromEntries(TRAINING_TENSOR_NAMES.map(name=>[name,trainingSha256(tensors[name])]));
  let knownInternationalPixels=0,positiveInternationalPixels=0;
  for(let offset=0;offset<512*512*4;offset+=4)if(tensors.valid.readFloatLE(offset)>0){knownInternationalPixels++;if(tensors.target.readFloatLE(offset)>0)positiveInternationalPixels++;}
  const receipt={schemaVersion:1,trainingOnly:true,releaseApproved:false,sourceId,sourceKind:'macro-pdf',sourceEvidenceSha256:annotation.sourceSha256,
    augmentationIndex:tileIndex,imageSha256:sheet.sha256,
    annotationSha256,maskSha256:annotation.raster.sha256,validMaskSha256:annotation.validRaster.sha256,tileIndex,pixelOrigin:[x,y],
    positiveInternationalPixels,knownInternationalPixels,tensorSha256};
  signal?.throwIfAborted();mkdirSync(resolve(output));
  for(const name of TRAINING_TENSOR_NAMES)writeFileSync(join(output,name+'.f32'),tensors[name],{flag:'wx'});
  writeFileSync(join(output,'sample.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return receipt;
}

export async function writeSemapTrainingSample({corpus,sourceId,tileIndex,localIndex,x,y,augment,epoch,output,signal,verifyEvidence}){
  signal?.throwIfAborted();
  if(!corpus||!sourceId||!output||typeof augment!=='boolean'||![tileIndex,localIndex,x,y,epoch].every(value=>Number.isSafeInteger(value)&&value>=0))
    throw Error('Explicit Semap training sample inputs required');
  if(existsSync(output))throw Error('Training sample output exists; preserve it');
  const corpusPath=resolve(corpus),root=dirname(corpusPath),data=await inspectSemapTrainingDataset(corpusPath,{signal,verifyEvidence});
  const tile=data.tiles[localIndex],source=data.sources.find(row=>row.sheet.id===sourceId);
  if(!source||!tile||tile.sourceId!==sourceId||tile.x!==x||tile.y!==y||tileIndex<localIndex)throw Error('Semap source tile index differs');
  const {sheet,annotation,checks}=source,labelName=basename(annotation.originalImageMember,'.jpg')+'.png';
  const label=annotation.sourceFiles.find(file=>basename(file.path)===labelName);
  if(!label)throw Error('Semap source label identity required');
  const annotationPath=await resolveCorpusPath(root,sheet.annotations),annotationSha256=trainingSha256(readTrainingBounded(annotationPath,16*1024*1024));
  const tensors=await prepareRasterTrainingTile({root,imagePath:sheet.image,sourceSha256:sheet.sha256,annotation,x,y,augment,epoch,index:localIndex},{signal});
  for(const [path,expected] of checks)if(trainingSha256(readTrainingBounded(path,16*1024*1024))!==expected)throw Error('Semap source changed during sample preparation');
  if(await corpusFingerprint(corpusPath)!==data.lineageFingerprint)throw Error('Training corpus changed during sample preparation');
  const tensorSha256=Object.fromEntries(TRAINING_TENSOR_NAMES.map(name=>[name,trainingSha256(tensors[name])]));
  const receipt={schemaVersion:1,trainingOnly:true,releaseApproved:false,sourceId,sourceKind:'semap-label',sourceEvidenceSha256:label.sha256,
    imageSha256:sheet.sha256,annotationSha256,maskSha256:annotation.raster.sha256,validMaskSha256:annotation.validRaster.sha256,
    tileIndex,augmentationIndex:localIndex,pixelOrigin:[x,y],positiveInternationalPixels:0,knownInternationalPixels:0,tensorSha256};
  signal?.throwIfAborted();mkdirSync(resolve(output));
  for(const name of TRAINING_TENSOR_NAMES)writeFileSync(join(output,name+'.f32'),tensors[name],{flag:'wx'});
  writeFileSync(join(output,'sample.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return receipt;
}

export async function prepareMacroTrainingBatch({corpus,order,cursor,count,epoch,augment,output,signal}){
  signal?.throwIfAborted();
  if(!corpus||!order||!output||typeof augment!=='boolean'||![cursor,count,epoch].every(Number.isSafeInteger)||cursor<0||count<1||count>16||epoch<0)
    throw Error('Explicit bounded macro training batch inputs required');
  if(existsSync(output))throw Error('Training batch output exists; preserve it');
  const orderPath=resolve(order),orderBytes=readTrainingBounded(orderPath,8000000),orderSha256=trainingSha256(orderBytes);
  if(!orderBytes.length||orderBytes.length%8||cursor+count>orderBytes.length/8)throw Error('Invalid training order or cursor');
  const dataset=await indexMacroTrainingDataset(corpus,{signal}),selected=[];
  for(let i=0;i<count;i++){const index=orderBytes.readBigUInt64LE((cursor+i)*8);
    if(index>=BigInt(dataset.tiles.length))throw Error('Training order contains an invalid sample index');selected.push(dataset.tiles[Number(index)]);}
  if(trainingSha256(readTrainingBounded(orderPath,8000000))!==orderSha256)throw Error('Training order changed during sample preparation');
  signal?.throwIfAborted();mkdirSync(resolve(output));const samples=[];
  for(let i=0;i<selected.length;i++){const tile=selected[i],directory=resolve(output,'sample-'+String(i).padStart(2,'0'));
    await writeMacroTrainingSample({corpus,sourceId:tile.sourceId,tileIndex:tile.index,x:tile.x,y:tile.y,augment,epoch,output:directory,signal});
    samples.push({index:tile.index,directory,augment});}
  if(trainingSha256(readTrainingBounded(orderPath,8000000))!==orderSha256)throw Error('Training order changed during sample preparation');
  if(trainingSha256(readTrainingBounded(resolve(corpus),32*1024*1024))!==dataset.corpusSha256)throw Error('Training corpus changed during sample preparation');
  return {trainingOnly:true,releaseApproved:false,corpusSha256:dataset.corpusSha256,orderSha256,cursor,samples};
}
