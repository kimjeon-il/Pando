import assert from 'node:assert/strict';
import { loadWebOracle } from './web-oracle.mjs';
const { createLayerList } = await loadWebOracle('assets/js/modules/app-layer-list.js');
/** Test-only original Web history oracle. Never import a current C++ facade. */
export function historySnapshotFixture({ labels = [], labelSettings = {}, selectionDomain = { clear() {} }, implementation } = {}) {
  if (!implementation) throw new TypeError('An explicit pinned original Web history implementation is required for this oracle fixture.');
  const { initializeTestTerritorialState, createProjectSnapshots, createTerritorialEntityStore, createStaticTerritorialSnapshot,
    createTerritorialEntityRepository, applyProjectFields, pickProjectFields, createSaveStateController } = implementation;
  const state = {
    territorialEntities: [], sourceInfo: null, labels: structuredClone(labels), genericFeatures: [], hydroEdits: [],
    distributionLayers: [], distributionEntries: [],
    labelSettings: structuredClone(labelSettings), distributionSettings: { renderMode: 'overlap', activeLayerId: '', boundaryVisible: true },
    layerPresentation: {}, physicalSettings: { hiddenHydroIds: {} }, layerVisibility: {}, itemVisibility: {},
    projection: 'flat', view: {}, historyDirtyEntityIds: new Set(), autosaveMode: 'delta', layerFolders: {}, layerTreeRevision: 0,
    selectedDistributionLayerId: '', boundaryPreparation: null,
  };
  const owner = createProjectSnapshots();
  initializeTestTerritorialState(state);
  const entityStore = createTerritorialEntityStore({ getState: () => state });
  const entityRepository = createTerritorialEntityRepository({ entityStore });
  const layerTree = createLayerList();
  layerTree.connect({ projectState: { state }, territorialModel: { entityRepository },
    hydroPresentation: { activeLayerFolderKeys: () => [], HYDRO_LAYER_META: {} },
    countries: { builtinTerritorialScene: () => ({ labelById: new Map() }) },
    layerPresentation: { LAYER_GROUP_KEYS: ['countries','countryLabels','subunits','regions','distributions','hydro','genericFeatures','labels'] },
    domains: { selectionDomain } });
  const saveState = createSaveStateController();
  let searchRenders = 0, searchCancels = 0;
  const geometryChanges = [];
  const ownerBuiltinCountries = { canonicalCountryStore: null,
    materializePristineCountriesSync: () => ({ type: 'FeatureCollection', features: [] }) };
  owner.connect({
    projectState: { state }, projectSession: { saveState },
    applicationConstantsA: { DISTRIBUTION_RENDER_MODES: { SINGLE: 'single', OVERLAP: 'overlap' }, BUILTIN_TERRITORY_MERGES: [] },
    platformConfigurationA: { BASE_DATASET: 'fixture' }, objectDefinitions: { builtinSubunitSourceId: () => '' },
    projectServices: { pickProjectFields, applyProjectFields },
    platform: { deepClone: structuredClone, $: () => ({ textContent: '' }) },
    labelPresentation: { labelKey: (domain, id) => `${domain}:${id}` },
    rendering: { gpuMapRenderer: { invalidateHydroVisibility() {} } },
    hydroModel: { syncPhysicalControls() {}, normalizeHydroEditCollection: value => value || [] },
    builtinCountries: ownerBuiltinCountries,
    builtinBaseline: { get projectBaseline() { return { baseEntities: createStaticTerritorialSnapshot(ownerBuiltinCountries.materializePristineCountriesSync().features).territorialEntities }; } },
    geometryMutation: { reindexCountries: value => value }, geometryPreview: { rebuildBoundaryTopology() {} },
    countryRecords: { applyPristineLabelAnchors() {} },
    modelValidation: { normalizeGenericFeatureCollection: value => value || [], normalizeLayerPresentation: value => value || {} },
    distributionServices: { normalizeDistributionLayers: value => value || [], normalizeDistributionEntries: value => value || [],
      validateDistributionModel: () => ({ ok: true }) },
    territorialModel: { entityStore, entityRepository, normalizeTerritorialEntities: value => value || [] },
    presentation: { territorialRepository: { get: () => null } },
    layerTree, layers: { markLayerTreeDirty: layerTree.markLayerTreeDirty },
    countries: { scheduleCountryLabelAnchors() {} }, objectDisplay: { invalidateObjectPresentation() {} },
    domains: { selectionDomain, layerTreeController: {
      cancelSearch() { searchCancels += 1; }, render(force) { assert.equal(force, true); searchRenders += 1; },
    } },
    countryEditingB: { resetBoundaryEditState() {}, resetMergeState() {}, resetGenericFeatureMergeState() {},
      resetTerritorialUnitEditState() {}, resetTerritoryEditingState() {} },
    domainControllers: { objectPropertyController: { show() {} } },
    spatialQuery: { mapEditClient: { invalidateBoundaryCache() {} }, markCountryGeometriesChanged(ids) { geometryChanges.push([...ids]); } },
    taskUi: { updateModeButtons() {} },
  });
  return { owner, state, entityStore, entityRepository, saveState, geometryChanges, builtinCountries: ownerBuiltinCountries,
    searchRenders: () => searchRenders, searchCancels: () => searchCancels };
}
