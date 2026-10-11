import test from 'node:test';
import assert from 'node:assert/strict';
import { smallHistoricalWorld } from '../helpers/historical-world.mjs';
import { createEmptyTerritorialState, createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { createProjectRestore } from '../../assets/js/modules/app-project-restore.js';
import { createProjectSnapshots } from '../../assets/js/modules/app-project-snapshots.js';
const noop = () => {};
const methods = (...names) => Object.fromEntries(names.map(name => [name, noop]));
test('resetWorldPreservesHistoricalIntervals', async () => {
  const state = { ...createEmptyTerritorialState(), countryIndex: new Map(), geometryPreview: {}, audit: { revision: 0 } };
  const store = createTerritorialEntityStore({ getState: () => state }), entityRepository = createTerritorialEntityRepository({ entityStore: store });
  const snapshots = createProjectSnapshots(); snapshots.connect({ projectState: { state }, platformConfigurationA: { BASE_DATASET: 'fixture' } });
  const restore = createProjectRestore();
  restore.connect({
    projectState: { state }, territorialModel: { entityStore: store, entityRepository },
    workspaceUiA: methods('closeMobileSheets'), geometryPreview: { boundarySelectionAnalysisCache: new Map() },
    renderQuality: methods('cancelGpuMeshRebuild'), spatialQuery: { mapEditClient: methods('stop', 'invalidateBoundaryCache') },
    countryRecords: methods('resetCountryLabelAnchorRuntime', 'applyPristineLabelAnchors'),
    applicationConstantsA: { DISTRIBUTION_RENDER_MODES: { OVERLAP: 'overlap' } },
    geometryEditingCore: methods('clearGeometryPreview'), interactionStateCommands: methods('setHoverHit'),
    hydroModel: { normalizePhysicalSettings: () => ({}) }, projectSession: { normalizeLayerVisibility: () => ({}) },
    layerTree: { normalizeLayerItemState: () => ({}), normalizeLayerFolderState: () => ({}), pruneLayerItemVisibility: noop },
    modelValidation: { normalizeLayerPresentation: () => ({}) },
    countryEditingB: methods('resetBoundaryEditState', 'resetTerritorialUnitEditState', 'resetMergeState', 'resetTerritoryEditingState'),
    domains: { selectionDomain: methods('resetProject'), editingDomain: methods('setTool'), renderingDomain: methods('invalidateProject') },
    layers: methods('markLayerTreeDirty'), projectSnapshots: snapshots, countryValidation: methods('refreshCountryCentroids'),
    mapSettingsUi: methods('renderMapDisplaySettings', 'syncProjectionButtons'), platform: { $: id => id === 'selectionStatus' ? { textContent: '' } : null },
    domainControllers: { objectPropertyController: methods('show') }, mapLayers: {}, mapHostViewA: {}, mapHostViewC: {},
    mapHostViewB: methods('resizeMap'), mapView: methods('syncMapHostFromState'), spatialRecords: methods('scheduleMapObjectSpatialIndexRebuild'),
    lifecycleUi: { projectUi: methods('syncHistory') }, rendering: { gpuMapRenderer: {
      resetProjectRenderState: () => 1, invalidateHydroVisibility: noop,
      activateBuiltinMeshBaseline: async ({ onStaged }) => { onStaged(); return true; },
    } },
  });
  restore.initializeConfirmModalController();
  await restore.resetProjectInPlace({ prepared: { project: smallHistoricalWorld() } });
  assert.equal(state.autosaveMode, 'full');
  store.setTimelineCursor('2012-10');
  assert.deepEqual(state.territorialEntities.map(row => row.id), ['state:ukraine']);
  assert.equal(state.timelineRecords.lifetimes.length, 2);
});
test('cursorMovePreservesDirtyAndHistory', () => {
  const state = { ...createEmptyTerritorialState(), history: ['edited'], dirty: true };
  const store = createTerritorialEntityStore({ getState: () => state }); store.restoreProject(smallHistoricalWorld());
  const records = state.timelineRecords, archive = state.geometries;
  store.setTimelineCursor('2012-10'); store.setTimelineCursor('2026-10');
  assert.deepEqual(state.history, ['edited']); assert.equal(state.dirty, true);
  assert.equal(state.timelineRecords, records); assert.equal(state.geometries, archive);
});
