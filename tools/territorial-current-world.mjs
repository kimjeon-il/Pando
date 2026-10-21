import fs from 'node:fs';
import path from 'node:path';
import {readTerritorialSources,territorialSourceRoot} from './territorial-entity-sources.mjs';
import {selectGeometryVersion} from '../assets/js/modules/territorial-library.js';

export function buildCurrentWorld({ entities: sourceEntities = readTerritorialSources(),
  snapshot = JSON.parse(fs.readFileSync(path.join(territorialSourceRoot,'snapshots/current-world.json'),'utf8')) } = {}) {
  const entities=new Map(sourceEntities.map(e=>[e.entityId,e]));
  if(snapshot.schemaVersion!==1 || new Set(snapshot.entityRefs).size!==snapshot.entityRefs.length)throw new Error('Invalid current snapshot');
  const {bbox,...metadata}=snapshot.sourceInfo.collectionMetadata;
  return {...metadata,features:snapshot.entityRefs.map(id=>{
    const entity=entities.get(id);
    if(!entity || entity.entityKind!=='general' || !entity.sourceInfo.featureId)throw new Error(`Missing current source identity: ${id}`);
    const version=selectGeometryVersion(entity,snapshot.referenceDate);
    if(!version)throw new Error(`No current geometry at ${snapshot.referenceDate}: ${id}`);
    const properties=structuredClone(entity.sourceInfo.featureProperties);
    properties.name=entity.names.ko || entity.names.en || Object.values(entity.names)[0];
    const metadata=properties.metadata && typeof properties.metadata==='object' && !Array.isArray(properties.metadata)
      ? {...properties.metadata} : {};
    if(entity.metadata?.defaultFlagDataUrl)metadata.flagDataUrl=entity.metadata.defaultFlagDataUrl;
    else delete metadata.flagDataUrl;
    if(Object.keys(metadata).length)properties.metadata=metadata;
    else delete properties.metadata;
    return {type:'Feature',id:entity.sourceInfo.featureId,properties,geometry:structuredClone(version.geometry)};
  }),bbox};
}
