import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {readTrainingBounded} from './training-evidence.mjs';
import {verifiedMacroTrainingSource,recheckMacroTrainingSource} from './macro-training-source.mjs';
import {listRasterTrainingTiles,prepareRasterTrainingTile} from './training-tiles.mjs';

export const TRAINING_TENSOR_NAMES=Object.freeze(['tile','overview','position','target','valid']);
const TRAINING_TENSOR_LIMITS=Object.freeze({tile:3*512*512*4,overview:3*256*256*4,position:4*4,target:7*512*512*4,valid:7*512*512*4});
export const trainingSha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function verifyTrainingSample(directory,{requireInternational=false}={}){
  const receiptPath=join(directory,'sample.json'),receiptInfo=statSync(receiptPath);
  if(!receiptInfo.isFile()||receiptInfo.size>1024*1024)throw Error('Training sample receipt exceeds its byte budget');
  const data=JSON.parse(readFileSync(receiptPath,'utf8'));
  if(data.trainingOnly!==true||data.releaseApproved!==false||typeof data.sourceId!=='string'||!data.sourceId||
    !Number.isInteger(data.tileIndex)||data.tileIndex<0||
    (requireInternational&&(!(data.knownInternationalPixels>0)||!(data.positiveInternationalPixels>0)))||
    !['sourcePdfSha256','imageSha256','annotationSha256','maskSha256','validMaskSha256'].every(field=>/^[a-f0-9]{64}$/.test(data[field]||'')))
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
  const receipt={schemaVersion:1,trainingOnly:true,releaseApproved:false,sourceId,sourcePdfSha256:annotation.sourceSha256,imageSha256:sheet.sha256,
    annotationSha256,maskSha256:annotation.raster.sha256,validMaskSha256:annotation.validRaster.sha256,tileIndex,pixelOrigin:[x,y],
    positiveInternationalPixels,knownInternationalPixels,tensorSha256};
  signal?.throwIfAborted();mkdirSync(resolve(output));
  for(const name of TRAINING_TENSOR_NAMES)writeFileSync(join(output,name+'.f32'),tensors[name],{flag:'wx'});
  writeFileSync(join(output,'sample.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return receipt;
}
