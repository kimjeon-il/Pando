import "../../shared/frontend/js/vendor/polygon-clipping.min.js";
import {initializeTestTerritorialState,testCoreProject} from './timeline-project.mjs';
import {createGisImportTransactionCommitter} from "../../apps/editor/frontend/js/modules/gis-import-transaction.js";
import {createLandRelations} from "../../apps/editor/frontend/js/modules/app-land-relations.js";
import {territorialRootId,TERRITORIAL_COVERAGE_MODES} from "../../shared/frontend/js/modules/territorial-units.js";
import {DISTRIBUTION_MODES} from "../../shared/frontend/js/modules/distribution-model.js";
import {applyImportedPackageAssets} from "../../apps/editor/frontend/js/modules/import-service.js";
import {createGenericFeatureService,normalizeGenericFeatureSemantics,GENERIC_FEATURE_SCHEMA_VERSION} from "../../apps/editor/frontend/js/modules/generic-feature-service.js";

/** Real C++ command/preview owner; only platform I/O, prompts and display hooks are test doubles. */
export async function createGisCoreFixture(territorialEntities=[],{fields={},runtime={},platformPorts={}}={}) {
  globalThis.window=globalThis;
  const state={territorialEntities,...fields},events=[],rootPatches=[];
  await initializeTestTerritorialState(state,null,{platformPorts:{appVersion:'fixture',
    onProjectChanged:()=>events.push('history'),persistence:{queueProject:()=>events.push('save'),cancelPending(){}},...platformPorts}});
  const owner=testCoreProject(state),land=createLandRelations();
  land.connect({territorialModel:{territorialRootId,TERRITORIAL_COVERAGE_MODES,DISTRIBUTION_MODES}});
  const committer=createGisImportTransactionCommitter({state,entityStore:owner.entityStore,
    territorialEntityRepository:owner.entityRepository,projectDomain:owner.project,DISTRIBUTION_MODES,
    planTransferLandDependents:land.planTransferLandDependents,applyImportedPackageAssets,
    genericFeatureService:createGenericFeatureService({documentModel:owner.documentModel,commandOwner:owner.project}),
    GENERIC_FEATURE_SCHEMA_VERSION,DEFAULT_GENERIC_FEATURE_COLOR:'#8c68d8',normalizeGenericFeatureSemantics,
    validateStructuredGeometry:()=>[],
    normalizePolygonGeometry:value=>value,deepClone:structuredClone,uid:()=> 'generated',
    polygonClipping:globalThis.polygonClipping,validateGisCountryCollection:async()=>({overlapAreaKm2:0}),
    markCountryGeometriesChanged:ids=>rootPatches.push([...ids]),invalidateObjectPresentation(){},setActionStatus(){},
    pruneLayerItemVisibility:async()=>{},scheduleCountryLabelAnchors(){},selectionUiController:{clear:async()=>{}},
    renderingDomain:{invalidateTerritorialPatch(){},invalidateCountryPatch(){}},
    createCancellationError:message=>Object.assign(new Error(message),{cancelled:true}),...runtime});
  return {...owner,state,committer,events,calls:events,rootPatches,repository:owner.entityRepository,store:owner.entityStore};
}
