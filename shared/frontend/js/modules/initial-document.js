import { pickProjectFields, PROJECT_STATE_FIELDS } from './project-state.js';
import { normalizeLayerPresentation } from './layer-presentation.js';
import { createEmptyTerritorialState } from './territorial-entity-store.js';
import { PROJECT_SCHEMA_VERSION, LAND_OBJECT_SCHEMA_VERSION, SOURCE_PROVENANCE_SCHEMA_VERSION,
  TERRITORIAL_MODEL_SCHEMA_VERSION, DISTRIBUTION_MODEL_SCHEMA_VERSION } from './version-contract.js';

export const BASE_DATASET = 'Natural Earth 5.1.1 · Admin 0 Countries · 1:10m · de facto';

/** Detached startup input shared by both products; C++ is the admission owner. */
export function createInitialDocument({ appVersion, baseDataset = BASE_DATASET, state = {}, physicalSourceInfo = {} } = {}) {
  const empty = createEmptyTerritorialState();
  const defaults = Object.fromEntries(PROJECT_STATE_FIELDS.filter(field => !(field.name in empty) && field.name!=='projectSetup')
    .map(field => [field.name, field.fallback()]));
  const now=new Date(),initialMonth=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  const input = {projectSetup:{initialMonth,timelineRange:null,initialMapBounds:null,sourceMode:'builtin'}, ...defaults, ...empty, layerPresentation: normalizeLayerPresentation(), ...state };
  return { format: 'pandolab-project-state', schemaVersion: PROJECT_SCHEMA_VERSION,
    documentId: state.documentId || crypto.randomUUID(),
    version: appVersion, savedAt: new Date().toISOString(), baseDataset,
    landObjectModel: { schemaVersion: LAND_OBJECT_SCHEMA_VERSION, coastlineAuthority: 'territorialEntities',
      purpose: 'lossless-fallback', directCreation: false, sourceProvenanceSchemaVersion: SOURCE_PROVENANCE_SCHEMA_VERSION,
      canonicalProperties: ['name','notes','color','locked','source'] },
    territorialModel: { schemaVersion: TERRITORIAL_MODEL_SCHEMA_VERSION, coastlineAuthority: 'territorialEntities',
      storage: 'territorialEntities', kinds: ['general','regional'], coverageModes: ['partition','explicit'] },
    distributionModel: { schemaVersion: DISTRIBUTION_MODEL_SCHEMA_VERSION, sourceModes: ['territorial','geometry'], valueKind: 'finite-number' },
    territorialEntities: [], ...pickProjectFields(input), physicalSourceInfo,
    projectSetup: structuredClone(input.projectSetup) };
}
