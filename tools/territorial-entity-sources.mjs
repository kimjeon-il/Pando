import fs from 'node:fs';
import {assertHistoricalDisplayChanges} from './gis/historical-display-review.mjs';
import {writeLibraryOutput} from './library-data.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {normalizeTerritorialLibraryEntity,normalizeTerritorialLineage,assertTerritorialIndexEntity} from "./gis/territorial-library.js";
import {territorialIndexEntry} from './gis/territorial-index-entry.js';

export const territorialDataRoot=fileURLToPath(new URL('../assets/data/territorial-entities/',import.meta.url));
export const territorialSourceRoot=process.env.PANDOLAB_LIBRARY_SOURCE_ROOT
  ? path.resolve(process.env.PANDOLAB_LIBRARY_SOURCE_ROOT) : path.join(territorialDataRoot,'source');
export const entityFileName=entityId=>{
  if(!/^[a-z]+:[A-Za-z0-9_-]+$/.test(entityId))throw new Error(`Unsafe entity ID: ${entityId}`);
  return `${entityId.replace(':','-')}.json`;
};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

export function readTerritorialLineages(root=territorialSourceRoot){
  const directory=path.join(root,'lineages');
  return fs.readdirSync(directory).filter(name=>name.endsWith('.json')).sort().map(name=>{
    const lineage=normalizeTerritorialLineage(read(path.join(directory,name)));
    if(name!==`${lineage.lineageId}.json`)throw new Error(`Lineage filename mismatch: ${name}`);
    return lineage;
  });
}
function validateMembership(lineages,byId){
  const membership=new Set();
  for(const lineage of lineages){
    for(const id of lineage.entityRefs){
      if(membership.has(id)||!byId.has(id)||byId.get(id).lineageId!==lineage.lineageId)throw new Error(`Invalid lineage membership: ${id}`);
      membership.add(id);
    }
    for(const relation of lineage.relations)if(!byId.has(relation.from)||!byId.has(relation.to))throw new Error('Missing lineage relation endpoint');
  }
  if(membership.size!==byId.size)throw new Error('Orphan country source');
  for(const entity of byId.values()){
    const visited=new Set([entity.entityId]);let parent=entity.parentEntityId;
    while(parent){
      if(!byId.has(parent)||visited.has(parent))throw new Error(`Invalid catalog parent: ${entity.entityId}`);
      visited.add(parent);parent=byId.get(parent).parentEntityId;
    }
  }
}
function assertIndexedSource(entity,{sourceIndex=null,chunkRoot=path.join(territorialDataRoot,'generated/v2')}={}){
  if(!sourceIndex)return;
  const entries=sourceIndex.entities.filter(row=>row.entityId===entity.entityId);
  if(!entries.length)throw new Error(`Missing indexed territorial source: ${entity.entityId}`);
  if(entries.length!==1)throw new Error(`Duplicate indexed territorial source: ${entity.entityId}`);
  const [entry]=entries;
  try{
    assertTerritorialIndexEntity(entry,entity);
    if(!isDeepStrictEqual(territorialIndexEntry(entity,entry),entry))throw new Error('Catalog projection differs');
  }catch(cause){throw new Error(`Territorial source index mismatch: ${entity.entityId}`,{cause});}
  // Preserve and verify the actual stored gzip identity. Recompression is not a
  // valid identity check: unchanged chunks may retain older valid gzip bytes.
  const stored=fs.readFileSync(path.join(chunkRoot,entry.file));
  if(createHash('sha256').update(stored).digest('hex')!==entry.sha256)throw new Error(`Territorial source chunk hash mismatch: ${entity.entityId}`);
  const decoded=gunzipSync(stored);
  if(stored.length!==entry.compressedBytes||decoded.length!==entry.decodedBytes
    ||!isDeepStrictEqual(JSON.parse(decoded),entity))throw new Error(`Territorial source/chunk mismatch: ${entity.entityId}`);
}
export function readTerritorialSource(entityId,root=territorialSourceRoot,options={}){
  const entity=normalizeTerritorialLibraryEntity(read(path.join(root,'countries',entityFileName(entityId))));
  if(entity.entityId!==entityId)throw new Error(`Country filename mismatch: ${entityId}`);
  assertIndexedSource(entity,options);
  return entity;
}
export function readTerritorialSources(root=territorialSourceRoot,options={}){
  const lineages=readTerritorialLineages(root),directory=path.join(root,'countries'),byId=new Map();
  for(const name of fs.readdirSync(directory).filter(name=>name.endsWith('.json')).sort()){
    const entity=normalizeTerritorialLibraryEntity(read(path.join(directory,name)));
    if(name!==entityFileName(entity.entityId)||byId.has(entity.entityId))throw new Error(`Country filename/identity mismatch: ${name}`);
    assertIndexedSource(entity,options);
    byId.set(entity.entityId,entity);
  }
  validateMembership(lineages,byId);
  return lineages.flatMap(lineage=>lineage.entityRefs.map(id=>byId.get(id)));
}
// One source object owns its coordinates; cross-object validation precedes writes.
export function updateTerritorialSource(entityId,update,root=territorialSourceRoot){
  const entities=readTerritorialSources(root),byId=new Map(entities.map(e=>[e.entityId,e]));
  if(!byId.has(entityId))throw new Error(`Missing source entity: ${entityId}`);
  const replacement=update(structuredClone(byId.get(entityId)));
  if(replacement.entityId!==entityId)throw new Error('Source update changed identity');
  assertHistoricalDisplayChanges(replacement,byId.get(entityId));
  const validated=normalizeTerritorialLibraryEntity(replacement);byId.set(entityId,validated);
  validateMembership(readTerritorialLineages(root),byId);
  writeLibraryOutput(path.join(root,'countries',entityFileName(entityId)),`${JSON.stringify(replacement,null,2)}\n`);
  return validated;
}
