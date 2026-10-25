import fs from 'node:fs';
import {writeLibraryOutput} from './library-data.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeTerritorialLibraryEntity,normalizeTerritorialLineage} from "../apps/editor/frontend/js/modules/territorial-library.js";

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
export function readTerritorialSource(entityId,root=territorialSourceRoot){
  const entity=normalizeTerritorialLibraryEntity(read(path.join(root,'countries',entityFileName(entityId))));
  if(entity.entityId!==entityId)throw new Error(`Country filename mismatch: ${entityId}`);
  return entity;
}
export function readTerritorialSources(root=territorialSourceRoot){
  const lineages=readTerritorialLineages(root),directory=path.join(root,'countries'),byId=new Map();
  for(const name of fs.readdirSync(directory).filter(name=>name.endsWith('.json')).sort()){
    const entity=normalizeTerritorialLibraryEntity(read(path.join(directory,name)));
    if(name!==entityFileName(entity.entityId)||byId.has(entity.entityId))throw new Error(`Country filename/identity mismatch: ${name}`);
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
  const validated=normalizeTerritorialLibraryEntity(replacement);byId.set(entityId,validated);
  validateMembership(readTerritorialLineages(root),byId);
  writeLibraryOutput(path.join(root,'countries',entityFileName(entityId)),`${JSON.stringify(replacement,null,2)}\n`);
  return validated;
}
