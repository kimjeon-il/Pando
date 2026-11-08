import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {readTerritorialSources,territorialSourceRoot} from './territorial-entity-sources.mjs';

export function buildCurrentWorld({ entities: sourceEntities = readTerritorialSources(),
  view = JSON.parse(fs.readFileSync(path.join(territorialSourceRoot,'views/world.json'),'utf8')),
  currentWorld = null } = {}) {
  const entities=new Map(sourceEntities.map(e=>[e.entityId,e]));
  if(view.schemaVersion!==1 || Object.hasOwn(view,'referenceDate') || !Array.isArray(view.selections)
    || new Set(view.selections.map(row=>row.entityId)).size!==view.selections.length)throw new Error('Invalid world view');
  // A supplied projection is an assertion, never an independent geometry owner.
  // Presentation properties and GeoJSON key order do not identify a source version.
  let supplied=null;
  if(currentWorld!==null){
    if(currentWorld.type!=='FeatureCollection'||!Array.isArray(currentWorld.features))throw new Error('Current world source identity: expected FeatureCollection');
    supplied=new Map(currentWorld.features.map(feature=>[feature.id,feature]));
    if(supplied.size!==currentWorld.features.length||supplied.size!==view.selections.length)throw new Error('Current world source identity: duplicate or missing selected feature');
  }
  const selectedFeatureIds=new Set();
  const {bbox,...metadata}=view.sourceInfo.collectionMetadata;
  return {...metadata,features:view.selections.map(({entityId:id,geometryVersionId})=>{
    const entity=entities.get(id);
    if(!entity || entity.entityKind!=='general' || !entity.sourceInfo.featureId)throw new Error(`Missing current source identity: ${id}`);
    const version=entity.geometryVersions.find(row=>row.versionId===geometryVersionId);
    if(!version)throw new Error(`Missing world view geometry version: ${id}/${geometryVersionId}`);
    if(selectedFeatureIds.has(entity.sourceInfo.featureId))throw new Error(`Current world source identity: duplicate canonical feature ${entity.sourceInfo.featureId}`);
    selectedFeatureIds.add(entity.sourceInfo.featureId);
    if(supplied){
      const feature=supplied.get(entity.sourceInfo.featureId);
      if(!feature||feature.type!=='Feature'||feature.geometry?.type!==version.geometry.type
        ||!isDeepStrictEqual(feature.geometry.coordinates,version.geometry.coordinates))
        throw new Error(`Current world source mismatch: ${id}/${geometryVersionId} (${entity.sourceInfo.featureId}); adopt geometry in the selected canonical source version before publication`);
    }
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
