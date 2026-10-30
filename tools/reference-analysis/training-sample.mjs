import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

export const TRAINING_TENSOR_NAMES=Object.freeze(['tile','overview','position','target','valid']);
export const trainingSha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function verifyTrainingSample(directory,{requireInternational=false}={}){
  const data=JSON.parse(readFileSync(join(directory,'sample.json'),'utf8'));
  if(data.trainingOnly!==true||data.releaseApproved!==false||typeof data.sourceId!=='string'||!data.sourceId||
    !Number.isInteger(data.tileIndex)||data.tileIndex<0||
    (requireInternational&&(!(data.knownInternationalPixels>0)||!(data.positiveInternationalPixels>0)))||
    !['sourcePdfSha256','imageSha256','annotationSha256','maskSha256','validMaskSha256'].every(field=>/^[a-f0-9]{64}$/.test(data[field]||'')))
    throw Error('A source-bound training-only sample receipt is required');
  for(const name of TRAINING_TENSOR_NAMES)if(trainingSha256(readFileSync(join(directory,name+'.f32')))!==data.tensorSha256?.[name])
    throw Error('Training sample tensor changed: '+name);
  return data;
}
