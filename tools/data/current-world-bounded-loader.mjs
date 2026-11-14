import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {readTerritorialSource,readTerritorialSourceDescriptors,territorialSourceRoot} from './territorial-entity-sources.mjs';
import {visitCurrentWorldFeatures} from './territorial-current-world.mjs';

// The derived current world may exceed V8's maximum single-string length.
// Consumers need its selected, immutable geometries, not a 603 MB JSON string.
// Read only selected source versions; the preceding current-world --check gate
// verifies that the published GeoJSON has precisely these source contents.
const generatedCurrentWorld=fileURLToPath(new URL('../../assets/data/territorial-entities/generated/current-world.geojson',import.meta.url));

export function hashFileInChunks(filePath,{chunkBytes=256*1024}={}) {
  if(!Number.isSafeInteger(chunkBytes)||chunkBytes<=0||chunkBytes>4*1024*1024)
    throw new RangeError('Invalid file hash chunk size');
  const digest=createHash('sha256'),buffer=Buffer.allocUnsafe(chunkBytes);
  const fd=fs.openSync(filePath,'r');let bytes=0;
  try {
    for(;;){
      const count=fs.readSync(fd,buffer,0,buffer.length,null);
      if(!count)break;
      bytes+=count;digest.update(buffer.subarray(0,count));
    }
  } finally {fs.closeSync(fd);}
  return {sha256:digest.digest('hex'),bytes};
}

export function loadBoundedCurrentWorld(filePath) {
  if(path.resolve(filePath)!==path.resolve(generatedCurrentWorld)){
    // Other project sources retain their existing semantics. Never allow a
    // source larger than the V8 string limit through this legacy path.
    const size=fs.statSync(filePath).size;
    if(size>=0x1fffffe8)throw new RangeError('Nondefault world source requires a bounded feature reader');
    const raw=fs.readFileSync(filePath);
    return JSON.parse(filePath.endsWith('.gz')?gunzipSync(raw):raw);
  }
  const view=JSON.parse(fs.readFileSync(path.join(territorialSourceRoot,'views/world.json'),'utf8'));
  const ids=new Set(readTerritorialSourceDescriptors().map(row=>row.entityId));
  const features=[];
  const {metadata,bbox,count}=visitCurrentWorldFeatures({
    view,cloneGeometry:false,
    getEntity:id=>{
      if(!ids.has(id))throw new Error('Missing current world source descriptor: '+id);
      return readTerritorialSource(id);
    },
    visit:feature=>features.push(feature),
  });
  if(metadata.type!=='FeatureCollection' || features.length!==count
    || new Set(features.map(feature=>feature.id)).size!==count)
    throw new Error('Current world source identity: invalid collection or repeated feature ids');
  return {...metadata,features,bbox};
}
