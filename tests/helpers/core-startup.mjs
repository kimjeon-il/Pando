import { TIMELINE_RECORD_SCHEMA_VERSION } from "../../shared/frontend/js/modules/timeline-records.js";
import { createProjectSession } from "../../shared/frontend/js/modules/project-session.js";
import { normalizeLayerPresentation } from "../../shared/frontend/js/modules/layer-presentation.js";
import { createTerritorialEntityStore } from "../../shared/frontend/js/modules/territorial-entity-store.js";
import { createTerritorialEntityRepository } from "../../shared/frontend/js/modules/territorial-entity-repository.js";
import { createNodeCoreProject } from './core-project.mjs';
import { normalizeTerritorialIdentities,TERRITORIAL_IDENTITY_FIELDS } from "../../shared/frontend/js/modules/territorial-units.js";
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fingerprintProjectBaseline} from "../../apps/editor/frontend/js/modules/project-serializer.js";

const noop=() => {};
function emptySession() {
  const session=createProjectSession();
  session.connect({ readiness: { DATA_READINESS: { PREVIEW: 'preview' } },
    applicationConstantsA: { DISTRIBUTION_RENDER_MODES: { OVERLAP: 'overlap' } },
    modelValidation: { normalizeLayerPresentation },physicalConfig: { PHYSICAL_DATASET: 'fixture' },domains: {},
    applicationFactories: { createGeometryPreviewState: () => ({}) },
    uiFactoriesA: { createAtomicMapStateController: () => ({}) },
    uiFactoriesB: { createSaveStateController: () => ({}) },
    platformConfigurationA: { APP_VERSION: '0.34.0',BASE_DATASET: 'fixture',HYDRO_DATASET: 'fixture-hydro' },
    platformConfigurationB: { TERRAIN_DATASET: 'fixture-terrain' } });
  session.initializeMapWorkScheduler();
  return session;
}

/** Detached scenario input only. C++ performs admission, resolution and edits. */
export function startupDocument(features=[]) {
  const input=emptySession().initialDocument();
  input.savedAt='2026-10-04T00:00:00.000Z';
  input.territorialEntities=normalizeTerritorialIdentities(features.map(feature => ({ type:'Feature',id:feature.id,geometry:null,
    properties:Object.fromEntries(TERRITORIAL_IDENTITY_FIELDS.filter(key => Object.hasOwn(feature.properties,key))
      .map(key => [key,feature.properties[key]])) })));
  input.geometries=features.map(feature => ({ id:`startup:${feature.id}`,version:1,geojson:structuredClone(feature.geometry) }));
  input.timelineRecords={ schemaVersion:TIMELINE_RECORD_SCHEMA_VERSION,propertyBindings:[],
    lifetimes:features.map(feature => ({ id:`life:${feature.id}`,entityId:feature.id,validFrom:null,validTo:null })),
    geometryBindings:features.map(feature => ({ id:`shape:${feature.id}`,entityId:feature.id,validFrom:null,validTo:null,
      geometryRef:{ id:`startup:${feature.id}`,version:1 } })),
    parentRelations:features.map(feature => ({ id:`parent:${feature.id}`,entityId:feature.id,validFrom:null,validTo:null,
      parentId:feature.properties.parentId || '',coverageMode:feature.properties.coverageMode || 'explicit' })) };
  return input;
}

export function historicalStartupDocument(features) {
  const input=startupDocument(features);
  for(const rows of [input.timelineRecords.lifetimes,input.timelineRecords.geometryBindings,input.timelineRecords.parentRelations])
    for(const row of rows) {
      row.validFrom=row.entityId==='state:ukraine' ? '1991-08-24':'2026-10-01';
      row.validTo=row.entityId==='state:ukraine' ? '2014-03-17':'2026-10-31';
    }
  return input;
}

/** Tiny verified source facts with the same stored-gzip hash boundary as the loader. */
export async function startupBaseline(project,projectDomain,sourceMonth='2026-10',{kind='stored-asset'}={}) {
  const decoded=Buffer.from(JSON.stringify(project)),sourceBytes=gzipSync(decoded);
  let source={kind:'stored-asset',sourceBytes,encoding:'gzip',compressedBytes:sourceBytes.byteLength,decodedBytes:decoded.byteLength,
    sourceMonth,baseDataset:project.baseDataset,fingerprint:createHash('sha256').update(sourceBytes).digest('hex')};
  if(kind==='static-features') {
    const {territorialViews:features}=await projectDomain.inspectImport(project);
    source={kind,features,baseDataset:project.baseDataset,fingerprint:await fingerprintProjectBaseline(features)};
  }
  const receipt=await projectDomain.admitStorageBaseline(source);
  return Object.freeze({...source,baselineId:receipt.storageBaselineId});
}

export async function createCoreStartupState(t,{ startMonth='',...presentation }={}) {
  const session=emptySession();
  Object.assign(session.state,presentation);
  const owner=await createNodeCoreProject(session.initialDocument());
  const entityStore=createTerritorialEntityStore({ documentModel:owner.documentModel,commandOwner:owner.client });
  const entityRepository=createTerritorialEntityRepository({ entityStore });
  if(startMonth) await owner.client.setTimelineCursor(startMonth);
  session.installDocumentProjection({ documentModel:owner.documentModel,commandOwner:owner.client,entityStore });
  t.after(() => { entityStore.dispose();owner.dispose(); });
  return { ...owner,state:session.state,entityStore,entityRepository,saveState:session.saveState,noop };
}
