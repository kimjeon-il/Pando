/* global TextEncoder, Blob, crypto */
import {territorialSourceLayout} from '../../src/data/territorial-source-format.js';
// Preserved GIS data/core calculation contract after retired editor source removal.
// One catalog projection for both runtime source edits and publication tooling.
export function territorialIndexEntry(entity,{sha256,compressedBytes,decodedBytes,storageLayout=null,verifiedGeometryBounds=null}) {
 if(storageLayout!==null&&storageLayout!==territorialSourceLayout)throw Error('Unsupported territorial chunk layout');
 const bbox=verifiedGeometryBounds===null?[Infinity,Infinity,-Infinity,-Infinity]:[...verifiedGeometryBounds];
 if(verifiedGeometryBounds!==null&&(!Array.isArray(verifiedGeometryBounds)||verifiedGeometryBounds.length!==4
   ||verifiedGeometryBounds.some(value=>!Number.isFinite(value))||bbox[0]>bbox[2]||bbox[1]>bbox[3]))
   throw Error('Invalid verified territorial geometry bounds');
 function visit(value){
  if(typeof value[0]==='number'){
   if(!Number.isFinite(value[0])||!Number.isFinite(value[1]))throw new Error('Non-finite coordinate');
   bbox[0]=Math.min(bbox[0],value[0]);bbox[1]=Math.min(bbox[1],value[1]);
   bbox[2]=Math.max(bbox[2],value[0]);bbox[3]=Math.max(bbox[3],value[1]);
  }else for(const child of value)visit(child);
 }
 if(verifiedGeometryBounds===null)for(const v of entity.geometryVersions)visit(v.geometry.coordinates);
 const sourceFields={...entity};delete sourceFields.storageLayout;
 return {...sourceFields,geometryVersions:entity.geometryVersions.map(({geometry,...version})=>version),
  sourceInfo:{title:entity.sourceInfo?.title||'',license:entity.sourceInfo?.license||'',sourceId:entity.sourceInfo?.sourceId||''},
  file:`${entity.entityId.replace(':','-')}.json.gz`,validFrom:entity.lifetime.validFrom,validTo:entity.lifetime.validTo,
  compressedBytes,decodedBytes,sha256,bbox,geometryVersionCount:entity.geometryVersions.length,
  ...(storageLayout?{storageLayout}:{})};
}

export async function encodeTerritorialIndexEntry(entity) {
 const bytes=new TextEncoder().encode(`${JSON.stringify(entity,null,2)}\n`);
 const stream=new Blob([bytes]).stream().pipeThrough(new globalThis.CompressionStream('gzip'));
 const stored=await new Response(stream).arrayBuffer();
 const digest=await crypto.subtle.digest('SHA-256',stored);
 const sha256=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
 return territorialIndexEntry(entity,{sha256,compressedBytes:stored.byteLength,decodedBytes:bytes.byteLength});
}
