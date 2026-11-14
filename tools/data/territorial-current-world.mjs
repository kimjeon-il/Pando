import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {readTerritorialSources,territorialSourceRoot} from "./territorial-entity-sources.mjs";

// Streaming consumers supply getEntity so only the selected current source
// versions are decoded. The object-returning API is preserved for callers
// that explicitly need a materialized GeoJSON FeatureCollection.
export function visitCurrentWorldFeatures({
  entities: sourceEntities = null, getEntity = null,
  view = JSON.parse(fs.readFileSync(path.join(territorialSourceRoot,'views/world.json'),'utf8')),
  currentWorld = null, visit, cloneGeometry = true,
} = {}) {
  if (typeof visit !== 'function') throw new TypeError('Current world feature visitor is required');
  const entities = sourceEntities === null && !getEntity
    ? new Map(readTerritorialSources().map(entity => [entity.entityId, entity]))
    : sourceEntities === null ? null : new Map(sourceEntities.map(entity => [entity.entityId, entity]));
  const resolveEntity = getEntity || (id => entities?.get(id));
  if (view.schemaVersion !== 1 || Object.hasOwn(view, 'referenceDate') || !Array.isArray(view.selections)
    || new Set(view.selections.map(row => row.entityId)).size !== view.selections.length)
    throw new Error('Invalid world view');
  let supplied = null;
  if (currentWorld !== null) {
    if (currentWorld.type !== 'FeatureCollection' || !Array.isArray(currentWorld.features))
      throw new Error('Current world source identity: expected FeatureCollection');
    supplied = new Map(currentWorld.features.map(feature => [feature.id, feature]));
    if (supplied.size !== currentWorld.features.length || supplied.size !== view.selections.length)
      throw new Error('Current world source identity: duplicate or missing selected feature');
  }
  const selectedFeatureIds = new Set();
  const {bbox,...metadata} = view.sourceInfo.collectionMetadata;
  for (const {entityId: id, geometryVersionId} of view.selections) {
    const entity = resolveEntity(id);
    if (!entity || entity.entityKind !== 'general' || !entity.sourceInfo.featureId)
      throw new Error('Missing current source identity: ' + id);
    const version = entity.geometryVersions.find(row => row.versionId === geometryVersionId);
    if (!version) throw new Error('Missing world view geometry version: ' + id + '/' + geometryVersionId);
    if (selectedFeatureIds.has(entity.sourceInfo.featureId))
      throw new Error('Current world source identity: duplicate canonical feature ' + entity.sourceInfo.featureId);
    selectedFeatureIds.add(entity.sourceInfo.featureId);
    if (supplied) {
      const feature = supplied.get(entity.sourceInfo.featureId);
      if (!feature || feature.type !== 'Feature' || feature.geometry?.type !== version.geometry.type
        || !isDeepStrictEqual(feature.geometry.coordinates, version.geometry.coordinates))
        throw new Error('Current world source mismatch: ' + id + '/' + geometryVersionId + ' (' + entity.sourceInfo.featureId
          + '); adopt geometry in the selected canonical source version before publication');
    }
    const properties = structuredClone(entity.sourceInfo.featureProperties);
    properties.name = entity.names.ko || entity.names.en || Object.values(entity.names)[0];
    const featureMetadata = properties.metadata && typeof properties.metadata === 'object' && !Array.isArray(properties.metadata)
      ? {...properties.metadata} : {};
    if (entity.metadata?.defaultFlagDataUrl) featureMetadata.flagDataUrl = entity.metadata.defaultFlagDataUrl;
    else delete featureMetadata.flagDataUrl;
    if (Object.keys(featureMetadata).length) properties.metadata = featureMetadata;
    else delete properties.metadata;
    visit({type:'Feature', id: entity.sourceInfo.featureId, properties,
      geometry: cloneGeometry ? structuredClone(version.geometry) : version.geometry}, {entityId:id,geometryVersionId});
  }
  return {metadata, bbox, count: view.selections.length};
}

export function buildCurrentWorld({
  entities = readTerritorialSources(),
  view = JSON.parse(fs.readFileSync(path.join(territorialSourceRoot,'views/world.json'),'utf8')),
  currentWorld = null,
} = {}) {
  const features = [];
  const {metadata,bbox} = visitCurrentWorldFeatures({
    entities, view, currentWorld, visit: feature => features.push(feature),
  });
  return {...metadata, features, bbox};
}
