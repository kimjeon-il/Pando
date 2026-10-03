import { normalizeTerritorialEntities } from './territorial-units.js';
import { createGeometrySnapshotPool } from './geometry-versions.js';
import { TERRAIN_RASTER_VERSION } from './terrain-manifest.js';
import { PROJECT_SCHEMA_VERSION, SOURCE_PROVENANCE_SCHEMA_VERSION, GENERIC_FEATURE_SCHEMA_VERSION,
  TERRITORIAL_MODEL_SCHEMA_VERSION, DISTRIBUTION_MODEL_SCHEMA_VERSION } from './version-contract.js';

function modelContracts({ genericFeatureSchemaVersion, distributionSchemaVersion, distributionModes }) {
  return {
    landObjectModel: { schemaVersion: genericFeatureSchemaVersion, coastlineAuthority: 'territorialEntities',
      purpose: 'lossless-fallback', directCreation: false, sourceProvenanceSchemaVersion: SOURCE_PROVENANCE_SCHEMA_VERSION,
      canonicalProperties: ['name','notes','color','locked','source'] },
    territorialModel: { schemaVersion: TERRITORIAL_MODEL_SCHEMA_VERSION, coastlineAuthority: 'territorialEntities',
      storage: 'territorialEntities', types: ['country','subunit','region'], coverageModes: ['partition','explicit'] },
    distributionModel: { schemaVersion: distributionSchemaVersion, sourceModes: [...distributionModes], valueKind: 'finite-number' },
  };
}
export function createProjectSerializer({ schemaVersion = PROJECT_SCHEMA_VERSION, appVersion, baseDataset,
  genericFeatureSchemaVersion = GENERIC_FEATURE_SCHEMA_VERSION, distributionSchemaVersion = DISTRIBUTION_MODEL_SCHEMA_VERSION,
  distributionModes, terrainDataset, hydroDataset, readSnapshot, now = () => new Date() }) {
  const copies = createGeometrySnapshotPool();
  const contracts = { genericFeatureSchemaVersion, distributionSchemaVersion, distributionModes };
  const header = snapshot => ({ schemaVersion, version: appVersion, savedAt: now().toISOString(),
    baseDataset: snapshot.fullAutosave ? 'external-territorial-entities' : baseDataset, ...modelContracts(contracts) });
  function buildProject(snapshot = readSnapshot(), clone = structuredClone) {
    return { format: 'pandolab-project-state', ...header(snapshot),
      ...clone(snapshot.projectFields || {}), territorialEntities: normalizeTerritorialEntities(snapshot.territorialEntities, { cloneGeometry: clone }),
      physicalSourceInfo: {
        terrain: { dataset: snapshot.terrainSourceInfo?.dataset || snapshot.terrainManifest?.dataset || terrainDataset,
          version: snapshot.terrainSourceInfo?.version || snapshot.terrainManifest?.version || TERRAIN_RASTER_VERSION },
        hydro: { dataset: snapshot.hydroManifest?.dataset || hydroDataset, version: snapshot.hydroManifest?.version || appVersion,
          coordinatePolicy: snapshot.hydroManifest?.coordinatePolicy || 'selected source coordinates retained without simplification',
          selection: structuredClone(snapshot.hydroManifest?.selection || {}) },
      } };
  }
  function buildAutosave() {
    const snapshot = readSnapshot();
    if (snapshot.fullAutosave) return { ...buildProject(snapshot, copies.clone), format: 'pandolab-autosave-full' };
    return { format: 'pandolab-autosave-delta', ...header(snapshot), ...copies.clone(snapshot.projectFields || {}),
      entityDelta: { changed: copies.clone(snapshot.entityDelta?.changed || []), removedIds: [...(snapshot.entityDelta?.removedIds || [])] } };
  }
  return Object.freeze({ buildProject, buildAutosave });
}
export function restoreEntitiesFromDelta(project, { base, clone = structuredClone }) {
  const delta = project.entityDelta;
  if (!Array.isArray(base) || !Array.isArray(delta?.changed) || !Array.isArray(delta?.removedIds)) throw new TypeError('영역 변경분 또는 기본 자료가 올바르지 않습니다.');
  const changes = new Map();
  const removed = new Set(delta.removedIds.map(String));
  for (const feature of delta.changed) {
    const id = String(feature.id);
    if (changes.has(id) || removed.has(id)) throw new Error('영역 변경 ID 중복: ' + id);
    changes.set(id, feature);
  }
  const entities = base.filter(feature => !removed.has(String(feature.id))).map(feature => {
    const replacement = changes.get(String(feature.id)); changes.delete(String(feature.id));
    return clone(replacement || feature);
  }).concat([...changes.values()].map(entity => clone(entity)));
  return normalizeTerritorialEntities(entities, { cloneGeometry: geometry => geometry });
}
