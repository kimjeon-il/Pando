import fs from 'node:fs';
import path from 'node:path';
import {readTerritorialSources,territorialSourceRoot} from './territorial-entity-sources.mjs';

export function buildCurrentWorld({ entities: sourceEntities = readTerritorialSources(),
  view = JSON.parse(fs.readFileSync(path.join(territorialSourceRoot,'views/world.json'),'utf8')) } = {}) {
  const entities=new Map(sourceEntities.map(e=>[e.entityId,e]));
  if(view.schemaVersion!==1 || Object.hasOwn(view,'referenceDate') || !Array.isArray(view.selections)
    || new Set(view.selections.map(row=>row.entityId)).size!==view.selections.length)throw new Error('Invalid world view');
  const {bbox,...metadata}=view.sourceInfo.collectionMetadata;
  return {...metadata,features:view.selections.map(({entityId:id,geometryVersionId})=>{
    const entity=entities.get(id);
    if(!entity || entity.entityKind!=='general' || !entity.sourceInfo.featureId)throw new Error(`Missing current source identity: ${id}`);
    const version=entity.geometryVersions.find(row=>row.versionId===geometryVersionId);
    if(!version)throw new Error(`Missing world view geometry version: ${id}/${geometryVersionId}`);
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
