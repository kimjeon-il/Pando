import {createHash} from 'node:crypto';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// Only an identical selected geometry+hierarchy scene can reuse prepared bytes.
// This checks the immutable compressed asset hash without decoding or repacking it.
export function reusePreparedSceneReceipt({spec,identity,source,referenceMonth,algorithmVersion,readStored}={}){
 if(!spec||spec.encoding!=='gzip'||spec.referenceMonth!==referenceMonth
  ||spec.algorithmVersion!==algorithmVersion||!same(spec.identity,identity)
  ||spec.source?.countryPacket!==source?.countryPacket
  ||spec.source?.canonicalMesh!==source?.canonicalMesh
  ||!/^world\/objects\/country-scene-sha256-[a-f0-9]{64}\.bin\.gz$/.test(spec.url||'')
  ||spec.url.slice(-71,-7)!==spec.sha256
  ||!Number.isSafeInteger(spec.compressedBytes)||spec.compressedBytes<1
  ||!Number.isSafeInteger(spec.decodedBytes)||spec.decodedBytes<1
  ||typeof readStored!=='function')return null;
 let bytes;
 try{bytes=readStored(spec.url);}catch{return null;}
 if(!Buffer.isBuffer(bytes)||bytes.length!==spec.compressedBytes||digest(bytes)!==spec.sha256)
  throw new Error('Previously published immutable prepared scene failed SHA-256 verification');
 return Object.freeze({spec:Object.freeze({...spec,source:{...source}})});
}
