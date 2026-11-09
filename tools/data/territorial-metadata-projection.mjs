import {validateTerritorialSourceGeometry,territorialSourceLayout}
  from '../../src/data/territorial-source-format.js';

// A trusted, previously published indexed geometry fingerprint proves that a
// metadata edit did not change an immutable resource. No coordinate payload,
// polygon normalization or gzip of coordinates is needed in this branch.
export function metadataOnlyTerritorialProjection(descriptor,previous){
 if(!previous||descriptor?.storageLayout!==territorialSourceLayout||
   previous.storageLayout!==territorialSourceLayout||
   descriptor.entityId!==previous.entityId||
   !Array.isArray(descriptor.geometryVersions)||
   !Array.isArray(previous.geometryVersions)||
   descriptor.geometryVersions.length!==previous.geometryVersions.length||
   !Array.isArray(previous.bbox)||previous.bbox.length!==4||
   previous.bbox.some(value=>!Number.isFinite(value)))return null;
 const old=new Map(previous.geometryVersions.map(row=>[row.versionId,row]));
 if(old.size!==previous.geometryVersions.length)return null;
 for(const version of descriptor.geometryVersions){
  const prior=old.get(version.versionId);
  if(!prior)return null;
  const source=validateTerritorialSourceGeometry(version,descriptor.entityId);
  const verified=validateTerritorialSourceGeometry(prior,descriptor.entityId);
  if(source.sha256!==verified.sha256||source.bytes!==verified.bytes||
    source.file!==verified.file||source.type!==verified.type||
    JSON.stringify(source.logicalRef)!==JSON.stringify(verified.logicalRef))return null;
 }
 const {storageLayout,...model}=descriptor;
 return Object.freeze({entity:model,bbox:Object.freeze([...previous.bbox])});
}
