import {createHash} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';

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
