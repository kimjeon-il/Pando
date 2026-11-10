import {createHash} from 'node:crypto';
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
  // Old published indexes may contain a geometry-less projection of the
  // source entity. That is not a reusable geometry receipt: fall back to the
  // canonical source reader instead of crashing during a full rebuild.
  const source=validateTerritorialSourceGeometry(version,descriptor.entityId);
  let verified;
  try { verified=validateTerritorialSourceGeometry(prior,descriptor.entityId); }
  catch { return null; }
  if(source.sha256!==verified.sha256||source.bytes!==verified.bytes||
    source.file!==verified.file||source.type!==verified.type||
    JSON.stringify(source.logicalRef)!==JSON.stringify(verified.logicalRef))return null;
 }
 const model={...descriptor};delete model.storageLayout;
 return Object.freeze({entity:model,bbox:Object.freeze([...previous.bbox])});
}

/** The build plan's only gate into full coordinate materialization.
 * Consumers can count readFull() calls to prove zero source-geometry reads
 * for metadata-only changes. */
export function selectTerritorialChunkSource(descriptor,previous,readFull){
 const metadata=metadataOnlyTerritorialProjection(descriptor,previous);
 if(metadata)return Object.freeze({descriptor,entity:metadata.entity,
   verifiedGeometryBounds:metadata.bbox,readsGeometry:false});
 if(typeof readFull!=='function')throw new TypeError('Changed geometry requires a source reader');
 const rebuilt=readFull();
 if(!rebuilt?.descriptor||!rebuilt.entity||!Array.isArray(rebuilt.entity.geometryVersions))
   throw new TypeError('Full source reader must return a complete geometry owner');
 return Object.freeze({...rebuilt,verifiedGeometryBounds:null,readsGeometry:true});
}

/** A metadata-only rebuild must have a verified previous descriptor receipt.
 * The large immutable geometry remains referenced by its prior content hash. */
export function assertIndexedTerritorialChunk(previous,stored){
 if(previous==null)return;
 if(!Buffer.isBuffer(stored)||stored.length!==previous.compressedBytes
   ||createHash('sha256').update(stored).digest('hex')!==previous.sha256)
   throw new Error('Previous territorial descriptor does not match its pinned index');
}
