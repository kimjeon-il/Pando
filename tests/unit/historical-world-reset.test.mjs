import {initializeTestTerritorialState,testCoreProject,executeTerritorialTestCommand} from '../helpers/timeline-project.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { smallHistoricalWorld } from '../helpers/historical-world.mjs';
import { createEmptyTerritorialState } from "../../shared/frontend/js/modules/territorial-entity-store.js";
import { createProjectRestore } from "../../apps/editor/frontend/js/modules/app-project-restore.js";
import { createProjectSnapshots } from "../../apps/editor/frontend/js/modules/app-project-snapshots.js";
const noop = () => {};
const methods = (...names) => Object.fromEntries(names.map(name => [name, noop]));
test('resetWorldPreservesHistoricalIntervals', async () => {
  const state = { ...createEmptyTerritorialState(), countryIndex: new Map(), geometryPreview: {}, audit: { revision: 0 } };
  await initializeTestTerritorialState(state,null,{project:smallHistoricalWorld()});
  const owner=testCoreProject(state),store=owner.entityStore,entityRepository=owner.entityRepository;
  const snapshots = createProjectSnapshots(); snapshots.connect({ projectState: { state }, platformConfigurationA: { BASE_DATASET: 'fixture' } });
  const restore = createProjectRestore();
  restore.connect({
    projectState: { state }, territorialModel: { entityStore: store, entityRepository },
    platformConfigurationA:{BASE_DATASET:'fixture'},countries:methods('scheduleCountryLabelAnchors'),
    workspaceUiA: methods('closeMobileSheets'), geometryPreview: { boundarySelectionAnalysisCache: new Map() },
    renderQuality: methods('cancelGpuMeshRebuild'), spatialQuery: { mapEditClient: methods('stop', 'invalidateBoundaryCache') },
    countryRecords: methods('resetCountryLabelAnchorRuntime', 'applyPristineLabelAnchors'),
    applicationConstantsA: { DISTRIBUTION_RENDER_MODES: { OVERLAP: 'overlap' } },
    geometryEditingCore: methods('clearGeometryPreview'), interactionStateCommands: methods('setHoverHit'),
    hydroModel: { normalizePhysicalSettings: () => ({}) }, projectSession: { setViewingPresentation: noop },
    objectCatalogView: { pruneLayerItemVisibility: noop },
    modelValidation: { normalizeLayerPresentation: () => ({}) },
    countryEditingB: methods('resetBoundaryEditState', 'resetTerritorialUnitEditState', 'resetMergeState', 'resetTerritoryEditingState'),
    domains: {projectDomain:owner.project,selectionDomain:methods('resetProject'),editingDomain:methods('setTool','cancelActiveGesture'),renderingDomain:methods('invalidateProject')},
    objectDisplay: methods('invalidateObjectPresentation'), projectSnapshots: snapshots, countryValidation: methods('refreshCountryCentroids'),
    readinessUi: methods('syncStatusBar'), mapSettingsUi: methods('renderMapDisplaySettings'), platform: { $: id => id === 'selectionStatus' ? { textContent: '' } : null },
    domainControllers: { objectPropertyController: methods('show') }, mapLayers: {}, mapHostViewA: {}, mapHostViewC: {},
    mapHostViewB: methods('resizeMap'), mapView: methods('syncMapHostFromState'), spatialRecords: methods('scheduleMapObjectSpatialIndexRebuild'),
    lifecycleUi: { projectUi: methods('syncHistory') }, rendering: { gpuMapRenderer: {
      resetProjectRenderState: () => 1, invalidateHydroVisibility: noop,
      activateBuiltinMeshBaseline: async ({ onStaged }) => { onStaged(); return true; },
    } },
  });
  restore.initializeConfirmModalController();
  await restore.resetProjectInPlace({ prepared: { project: owner.project.snapshot() } });
  assert.equal(state.autosaveMode, 'full');
  await store.setTimelineCursor('2012-10');
  assert.deepEqual(state.territorialEntities.map(row => row.id), ['state:ukraine']);
  assert.equal(state.timelineRecords.lifetimes.length, 2);
});
test('cursorMovePreservesDirtyAndHistory', async () => {
  const state={...createEmptyTerritorialState()};
  await initializeTestTerritorialState(state,null,{project:smallHistoricalWorld()});
  const owner=testCoreProject(state),store=owner.entityStore;
  const id=store.snapshot()[0].id;
  await executeTerritorialTestCommand(state,'territorial.metadata',{id,field:'notes',valuePresent:true,value:'edited'});
  const before=owner.client.state();
  const records = state.timelineRecords, archive = state.geometries;
  await store.setTimelineCursor('2012-10'); await store.setTimelineCursor('2026-10');
  assert.equal(owner.client.state().checkpoint,before.checkpoint);assert.equal(owner.client.state().canUndo,true);
  assert.equal(owner.client.state().dirty,true);assert.equal(owner.client.state().stateRevision,before.stateRevision);
  assert.equal(state.timelineRecords, records); assert.equal(state.geometries, archive);
});
