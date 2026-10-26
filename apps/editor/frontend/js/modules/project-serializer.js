import {timelineObjectCatalog} from '../../../../../shared/frontend/js/modules/timeline-records.js';
import { normalizeTerritorialIdentities, TERRITORIAL_ENTITY_KINDS } from "../../../../../shared/frontend/js/modules/territorial-units.js";
import { normalizeTerritorialEntities } from "../../../../../shared/frontend/js/modules/territorial-units.js";
import { assertCurrentProjectSchema, assertProjectBaselineFingerprint } from "../../../../../shared/frontend/js/modules/project-state.js";
import { assertProjectReferenceIntegrity } from "../../../../../shared/frontend/js/modules/project-invariants.js";
import { restoreTimelineStorage } from "../../../../../shared/frontend/js/modules/timeline-storage.js";
import { createGeometrySnapshotPool } from "../../../../../shared/frontend/js/modules/geometry-versions.js";
import { PROJECT_SCHEMA_VERSION, SOURCE_PROVENANCE_SCHEMA_VERSION, GENERIC_FEATURE_SCHEMA_VERSION,
  TERRITORIAL_MODEL_SCHEMA_VERSION, DISTRIBUTION_MODEL_SCHEMA_VERSION } from "../../../../../shared/frontend/js/modules/version-contract.js";

function modelContracts({ genericFeatureSchemaVersion, distributionSchemaVersion, distributionModes }) {
  return {
    landObjectModel: { schemaVersion: genericFeatureSchemaVersion, coastlineAuthority: 'territorialEntities',
      purpose: 'lossless-fallback', directCreation: false, sourceProvenanceSchemaVersion: SOURCE_PROVENANCE_SCHEMA_VERSION,
      canonicalProperties: ['name','notes','color','locked','source'] },
    territorialModel: { schemaVersion: TERRITORIAL_MODEL_SCHEMA_VERSION, coastlineAuthority: 'territorialEntities',
      storage: 'territorialEntities', kinds: Object.values(TERRITORIAL_ENTITY_KINDS), coverageModes: ['partition','explicit'] },
    distributionModel: { schemaVersion: distributionSchemaVersion, sourceModes: [...distributionModes], valueKind: 'finite-number' },
  };
}
export function createProjectSerializer({ schemaVersion = PROJECT_SCHEMA_VERSION, appVersion, baseDataset,
  genericFeatureSchemaVersion = GENERIC_FEATURE_SCHEMA_VERSION, distributionSchemaVersion = DISTRIBUTION_MODEL_SCHEMA_VERSION,
  distributionModes, readSnapshot, now = () => new Date() }) {
  const copies = createGeometrySnapshotPool();
  const contracts = { genericFeatureSchemaVersion, distributionSchemaVersion, distributionModes };
  const header = snapshot => ({ schemaVersion,documentId:snapshot.documentId,physicalSourceInfo:structuredClone(snapshot.physicalSourceInfo || {}), version: appVersion, savedAt: now().toISOString(),
    baseDataset: snapshot.fullAutosave ? 'external-territorial-entities' : baseDataset, ...modelContracts(contracts) });
  function content(snapshot, clone) {
    const identities = normalizeTerritorialIdentities(snapshot.territorialEntities);
    const fields = snapshot.projectFields;
    const storage = restoreTimelineStorage({ schemaVersion: 1, records: fields?.timelineRecords,
      geometries: fields?.geometries }, timelineObjectCatalog({...fields,territorialEntities:identities}));
    const result = { ...clone(fields), territorialEntities: identities,
      timelineRecords: storage.records, geometries: storage.geometries.snapshot() };
    assertProjectReferenceIntegrity({ ...result, storageOnly: true });
    return result;
  }
  function buildProject(snapshot = readSnapshot(), clone = structuredClone) {
    const result = { format: 'pandolab-project-state', ...header(snapshot),
      ...content(snapshot, clone) };
    assertCurrentProjectSchema(result);
    return result;
  }
  function buildAutosave() {
    const snapshot = readSnapshot();
    if (snapshot.fullAutosave) return { ...buildProject(snapshot, copies.clone), format: 'pandolab-autosave-full' };
    assertProjectBaselineFingerprint(snapshot.baseDatasetFingerprint);
    const { territorialEntities, ...fields } = content(snapshot, copies.clone);
    assertCurrentProjectSchema({ format:'pandolab-project-state', ...header(snapshot), ...fields, territorialEntities });
    return { format: 'pandolab-autosave-delta', ...header(snapshot), ...fields, baseDatasetFingerprint: snapshot.baseDatasetFingerprint,
      entityDelta: { changed: normalizeTerritorialIdentities(snapshot.entityDelta?.changed || []), removedIds: [...(snapshot.entityDelta?.removedIds || [])] } };
  }
  return Object.freeze({ buildProject, buildAutosave });
}
/** Hash the canonical baseline, including every omitted identity and exact shape. */
export async function fingerprintProjectBaseline(features) {
  const stable = value => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
    return value;
  };
  const baseline = normalizeTerritorialEntities(features, { cloneGeometry: geometry => geometry })
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const bytes = new TextEncoder().encode(JSON.stringify(stable(baseline)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
