/* PandoLab v0.31.0
 * GitHub Pages-ready static map editor.
 * Rendering: bundled D3 v3 + Natural Earth 5.1.1 Admin 0 Countries 1:10m.
 * The full 1:10m geometry remains canonical; rendering and editing use lossless source data.
 * Source: naturalearthdata.com (public domain), default de facto boundary viewpoint.
 */

const moduleRevision = new URL(import.meta.url).searchParams.get('v') || globalThis.PANDOLAB_BUILD_META?.assetRevision || '';
const versionedModuleUrl = relativePath => {
  const url = new URL(relativePath, import.meta.url);
  url.searchParams.set('v', moduleRevision);
  return url.href;
};
await import(versionedModuleUrl('./modules/country-geometry.js'));
const countryGeometry = globalThis.PandoLabCountryGeometry;
if (!countryGeometry) throw new Error('국가 지오메트리 정규화 모듈을 불러오지 못했습니다.');

const [projectStateModule, countryEditTransactionModule, territorialUnitsModule, distributionModelModule, surfaceControllerModule, toolControllerModule, mapInputControllerModule, gpuMapRendererModule, territorialGeometryModule, selectControllerModule, startupReadinessModule, boundaryTopologyModule, geometryMetricsModule, geometryPreviewModule, geometryValidationModule, labelLayoutModule, mapStateTransitionModule, objectRefModule, layerPresentationModule, saveStateModule, colorAdapterModule, projectSerializerModule, persistenceServiceModule, physicalLayerServiceModule, territorialServiceModule, distributionServiceModule, genericFeatureServiceModule, tooltipControllerModule, layerTreeControllerModule, historyServiceModule, mapEditWorkerClientModule, mapObjectSpatialIndexModule, surfaceTabsControllerModule] = await Promise.all([
  import(versionedModuleUrl('./modules/project-state.js')),
  import(versionedModuleUrl('./modules/country-edit-transaction.js')),
  import(versionedModuleUrl('./modules/territorial-units.js')),
  import(versionedModuleUrl('./modules/distribution-model.js')),
  import(versionedModuleUrl('./modules/surface-controller.js')),
  import(versionedModuleUrl('./modules/tool-controller.js')),
  import(versionedModuleUrl('./modules/map-input-controller.js')),
  import(versionedModuleUrl('./modules/gpu-map-renderer.js')),
  import(versionedModuleUrl('./modules/territorial-geometry.js')),
  import(versionedModuleUrl('./modules/select-controller.js')),
  import(versionedModuleUrl('./modules/startup-readiness.js')),
  import(versionedModuleUrl('./modules/boundary-topology.js')),
  import(versionedModuleUrl('./modules/geometry-metrics.js')),
  import(versionedModuleUrl('./modules/geometry-preview.js')),
  import(versionedModuleUrl('./modules/geometry-validation.js')),
  import(versionedModuleUrl('./modules/label-layout.js')),
  import(versionedModuleUrl('./modules/map-state-transition.js')),
  import(versionedModuleUrl('./modules/object-selection-controller.js')),
  import(versionedModuleUrl('./modules/layer-presentation.js')),
  import(versionedModuleUrl('./modules/save-state-controller.js')),
  import(versionedModuleUrl('./modules/color-adapter.js')),
  import(versionedModuleUrl('./modules/project-serializer.js')),
  import(versionedModuleUrl('./modules/persistence-service.js')),
  import(versionedModuleUrl('./modules/physical-layer-service.js')),
  import(versionedModuleUrl('./modules/territorial-service.js')),
  import(versionedModuleUrl('./modules/distribution-service.js')),
  import(versionedModuleUrl('./modules/generic-feature-service.js')),
  import(versionedModuleUrl('./modules/tooltip-controller.js')),
  import(versionedModuleUrl('./modules/layer-tree-controller.js')),
  import(versionedModuleUrl('./modules/history-service.js')),
  import(versionedModuleUrl('./modules/map-edit-worker-client.js')),
  import(versionedModuleUrl('./modules/map-object-spatial-index.js')),
  import(versionedModuleUrl('./modules/surface-tabs-controller.js')),
]);
const { createSemanticIcon } = await import(versionedModuleUrl('./modules/icon-utils.js'));
const { pruneCountryOverrides } = await import(versionedModuleUrl('./modules/country-feature.js'));
const {
  PROJECT_SCHEMA_VERSION,
  applyProjectFields,
  assertCurrentProjectSchema,
  createProjectObjectId,
  pickProjectFields,
} = projectStateModule;
const { COLOR_DOMAINS, normalizeColorValue, readDomainColor, writeDomainColor } = colorAdapterModule;
const { createProjectSerializer, restoreCountriesFromDelta } = projectSerializerModule;
const { createBrowserProjectStorage, createPersistenceService } = persistenceServiceModule;
const { createHydroService, createTerrainService } = physicalLayerServiceModule;
const { createTerritorialApplicationService } = territorialServiceModule;
const { createDistributionService } = distributionServiceModule;
const {
  GENERIC_FEATURE_ROLE_RULES,
  GENERIC_FEATURE_ROLE_LABELS,
  GENERIC_FEATURE_SCHEMA_VERSION,
  createGenericFeatureService,
  genericFeatureGeometryKind,
  genericFeatureLandBinding,
  genericFeatureRole,
  normalizeGenericFeatureCollection,
  normalizeGenericFeatureSemantics,
} = genericFeatureServiceModule;
const { createTooltipController } = tooltipControllerModule;
const { createAppLayerTreeController } = layerTreeControllerModule;
const { setScopedItemVisibility } = await import(versionedModuleUrl('./modules/layer-list-model.js'));
const { createHistoryService } = historyServiceModule;
const { createMapEditWorkerClient } = mapEditWorkerClientModule;
const { createMapObjectSpatialIndex } = mapObjectSpatialIndexModule;
const { createSurfaceTabsController } = surfaceTabsControllerModule;
const mapObjectCategoriesModule = await import(versionedModuleUrl('./modules/map-object-categories.js'));
const {
  MAP_OBJECT_CATEGORIES,
  MAP_OBJECT_CATEGORY_ORDER,
  MAP_OBJECT_TYPES,
} = mapObjectCategoriesModule;
const reliabilityCoreModule = await import(versionedModuleUrl('./modules/reliability-core.js'));
const projectInvariantsModule = await import(versionedModuleUrl('./modules/project-invariants.js'));
const selectionStyleModule = await import(versionedModuleUrl('./modules/selection-style.js'));
const selectionStrokeGeometryModule = await import(versionedModuleUrl('./modules/selection-stroke-geometry.js'));
const selectionPassModule = await import(versionedModuleUrl('./modules/selection-pass.js'));
const selectionPacketModule = await import(versionedModuleUrl('./modules/selection-packet.js'));
const selectionPerformanceBaselineModule = await import(versionedModuleUrl('./modules/selection-performance-baseline.js'));
const renderSceneModule = await import(versionedModuleUrl('./modules/render-scene.js'));
const adaptiveRenderQualityModule = await import(versionedModuleUrl('./modules/adaptive-render-quality.js'));
const editPreviewControllerModule = await import(versionedModuleUrl('./modules/edit-preview-controller.js'));
const mapHostModule = await import(versionedModuleUrl('./modules/map-host.js'));
const legacyMapHostModule = await import(versionedModuleUrl('./modules/legacy-map-host.js'));
const mapInteractionGateModule = await import(versionedModuleUrl('./modules/map-interaction-gate.js'));
const mapInteractionStyleModule = await import(versionedModuleUrl('./modules/map-interaction-style.js'));
const graticuleGeometryModule = await import(versionedModuleUrl('./modules/graticule-geometry.js'));
const userPreferencesModule = await import(versionedModuleUrl('./modules/user-preferences.js'));
const { applyAppAccent } = await import(versionedModuleUrl('./modules/app-accent.js'));
const notificationCopyModule = await import(versionedModuleUrl('./modules/notification-copy.js'));
const countryFlagsModule = await import(versionedModuleUrl('./modules/country-flags.js'));
const mapLayoutMetricsModule = await import(versionedModuleUrl('./modules/map-layout-metrics.js'));
const mapVisualFrameModule = await import(versionedModuleUrl('./modules/map-visual-frame.js'));
const { createRingHitTester } = await import(versionedModuleUrl('./modules/ring-hit-test.js'));
// Domain boundaries are loaded independently of the legacy bootstrap body.
// Their factories are wired once, after the existing services are ready, so
// the migration does not duplicate project data or create import cycles.
const projectDomainModule = await import(versionedModuleUrl('./modules/project-domain.js'));
const projectCommandPipelineModule = await import(versionedModuleUrl('./modules/project-command-pipeline.js'));
const selectionDomainModule = await import(versionedModuleUrl('./modules/selection-domain.js'));
const renderingDomainModule = await import(versionedModuleUrl('./modules/rendering-domain.js'));
const gisDomainModule = await import(versionedModuleUrl('./modules/gis-domain.js'));
const editingDomainModule = await import(versionedModuleUrl('./modules/editing-domain.js'));
const selectionUiControllerModule = await import(versionedModuleUrl('./modules/selection-ui-controller.js'));
const countryPropertyControllerModule = await import(versionedModuleUrl('./modules/country-property-controller.js'));
const objectPropertyControllerModule = await import(versionedModuleUrl('./modules/object-property-controller.js'));
const { effectiveCountryFlagUrl } = countryFlagsModule;
const { createProjectDomain } = projectDomainModule;
const { createProjectCommandPipeline } = projectCommandPipelineModule;
const { createSelectionDomain } = selectionDomainModule;
const { createRenderingDomain } = renderingDomainModule;
const { createGisDomain } = gisDomainModule;
const { createEditingDomain } = editingDomainModule;
const { createSelectionUiController } = selectionUiControllerModule;
const { createCountryPropertyController } = countryPropertyControllerModule;
const { createObjectPropertyController } = objectPropertyControllerModule;

const { createProjectUiBridge } = await import(versionedModuleUrl('./modules/project-ui-bridge.js'));
const { createPropertyEditorBindings } = await import(versionedModuleUrl('./modules/property-editor-bindings.js'));
const { createMapInputPresentation } = await import(versionedModuleUrl('./modules/map-input-presentation.js'));
const { createGisWorkflowController } = await import(versionedModuleUrl('./modules/gis-workflow-controller.js'));
const { createMapDebugController } = await import(versionedModuleUrl('./modules/map-debug-controller.js'));
const { createApplicationLifecycle } = await import(versionedModuleUrl('./modules/application-lifecycle.js'));

let modalRuntimePromise = null;
let gisRuntimePromise = null;
let historicalRuntimePromise = null;
let gisIoRuntimePromise = null;
let gisExportControllerPromise = null;
let gisExportController = null;
let createConfirmModalController;
let createCoastReconciliationController;
let importServiceModule;
let appendImportedSourceInfo;
let applyImportedPackageAssets;
let importedCountryOverrides;
let createGisImportWizardController;
let buildTerritorialImportTransactionPlan;
let resolveImportedCountryId;
let identityResolutionSummary;
let materializeResolvedCountries;
let resolveCountryIdentities;
let analyzeAdminCountryCoast;
let normalizeCoastDecision;
let planCoastReconciliations;
let validateCoastReplacement;
let planDrawnTerritoryAnnex;
let buildRiverTerritoryPartitions;
let composeRiverBoundaryTerritoryComponents;
let RIVER_TERRITORY_PARTITION_ALGORITHM_REVISION;
let RIVER_TERRITORY_PARTITION_CONFIG;
let riverTerritoryPartitionConfigFingerprint;
let historicalLibraryServiceModule;
let historicalLibraryControllerModule;
let LIBRARY_ENTITY_TYPES;
let selectGeometryVersion;

const recordLazyRuntime = (metric, startedAt) => {
  const metrics = window.__PANDOLAB_STARTUP_METRICS__;
  if (metrics && metrics[metric] == null) metrics[metric] = performance.now() - startedAt;
};
const recordLazyRuntimeError = () => {
  const metrics = window.__PANDOLAB_STARTUP_METRICS__;
  if (metrics) metrics.lazyModuleLoadErrorCount = Number(metrics.lazyModuleLoadErrorCount || 0) + 1;
};

async function ensureModalRuntime() {
  if (modalRuntimePromise) return modalRuntimePromise;
  const startedAt = performance.now();
  modalRuntimePromise = Promise.all([
    window.PANDOLAB_ENSURE_MODAL_STYLES?.() || Promise.resolve(),
    import(versionedModuleUrl('./modules/confirm-modal-controller.js')),
    import(versionedModuleUrl('./modules/coast-reconciliation-controller.js')),
  ]).then(([, confirmModule, coastControllerModule]) => {
    createConfirmModalController = confirmModule.createConfirmModalController;
    createCoastReconciliationController = coastControllerModule.createCoastReconciliationController;
    recordLazyRuntime('lazyModalLoadedMs', startedAt);
    return { confirmModule, coastControllerModule };
  }).catch(error => {
    modalRuntimePromise = null;
    recordLazyRuntimeError();
    throw error;
  });
  return modalRuntimePromise;
}

async function ensureGisRuntime() {
  if (gisRuntimePromise) return gisRuntimePromise;
  const startedAt = performance.now();
  gisRuntimePromise = Promise.all([
    import(versionedModuleUrl('./modules/import-service.js')),
    import(versionedModuleUrl('./modules/territorial-import-plan.js')),
    import(versionedModuleUrl('./modules/country-import-identity.js')),
    import(versionedModuleUrl('./modules/coast-reconciliation.js')),
    import(versionedModuleUrl('./modules/annex-geometry.js')),
    import(versionedModuleUrl('./modules/river-territory-partition.js')),
    import(versionedModuleUrl('./modules/gis-import-wizard-controller.js')),
  ]).then(([imports, territorial, countryIdentity, coast, annex, river, wizardController]) => {
    importServiceModule = imports;
    createGisImportWizardController = wizardController.createGisImportWizardController;
    ({ buildTerritorialImportTransactionPlan, resolveImportedCountryId } = territorial);
    ({ identityResolutionSummary, materializeResolvedCountries, resolveCountryIdentities } = countryIdentity);
    ({ analyzeAdminCountryCoast, normalizeCoastDecision, planCoastReconciliations, validateCoastReplacement } = coast);
    ({ planDrawnTerritoryAnnex } = annex);
    ({
      buildRiverTerritoryPartitions,
      composeRiverBoundaryTerritoryComponents,
      RIVER_TERRITORY_PARTITION_ALGORITHM_REVISION,
      RIVER_TERRITORY_PARTITION_CONFIG,
      riverTerritoryPartitionConfigFingerprint,
    } = river);
    recordLazyRuntime('lazyGisLoadedMs', startedAt);
    return { imports, territorial, countryIdentity, coast, annex, river };
  }).catch(error => {
    gisRuntimePromise = null;
    recordLazyRuntimeError();
    throw error;
  });
  return gisRuntimePromise;
}

function loadClassicRuntime(relativePath) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = versionedModuleUrl(relativePath);
    script.async = false;
    script.addEventListener('load', () => resolve(script), { once: true });
    script.addEventListener('error', () => reject(new Error(`${relativePath}을(를) 불러오지 못했습니다.`)), { once: true });
    document.head.appendChild(script);
  });
}

async function ensureGisIoRuntime() {
  if (window.PandoLabGIS) return window.PandoLabGIS;
  if (!gisIoRuntimePromise) {
    gisIoRuntimePromise = loadClassicRuntime('./gis-adapters.js')
      .then(() => loadClassicRuntime('./gis-io.js'))
      .then(() => {
        if (!window.PandoLabGIS) throw new Error('GIS 입출력 runtime을 초기화하지 못했습니다.');
        return window.PandoLabGIS;
      })
      .catch(error => {
        gisIoRuntimePromise = null;
        recordLazyRuntimeError();
        throw error;
      });
  }
  return gisIoRuntimePromise;
}

async function ensureHistoricalRuntime() {
  if (historicalRuntimePromise) return historicalRuntimePromise;
  const startedAt = performance.now();
  historicalRuntimePromise = Promise.all([
    window.PANDOLAB_ENSURE_MODAL_STYLES?.() || Promise.resolve(),
    import(versionedModuleUrl('./modules/historical-library.js')),
    import(versionedModuleUrl('./modules/historical-library-service.js')),
    import(versionedModuleUrl('./modules/historical-library-controller.js')),
  ]).then(([, library, service, controller]) => {
    historicalLibraryServiceModule = service;
    historicalLibraryControllerModule = controller;
    ({ LIBRARY_ENTITY_TYPES, selectGeometryVersion } = library);
    recordLazyRuntime('lazyHistoricalLoadedMs', startedAt);
    return { library, service, controller };
  }).catch(error => {
    historicalRuntimePromise = null;
    recordLazyRuntimeError();
    throw error;
  });
  return historicalRuntimePromise;
}
const {
  RELIABILITY_ERROR_CATEGORIES,
  createCancellationError,
  createDiagnosticLog,
  createOperationalError,
  fetchWithRetry,
  isAbortError,
} = reliabilityCoreModule;
const { assertProjectReferenceIntegrity } = projectInvariantsModule;
const { SELECTION_STYLE, setSelectionColor, setInteractionStyle: setSelectionInteractionStyle } = selectionStyleModule;
const { buildSelectionBoundarySegments } = selectionStrokeGeometryModule;
const { createSelectionPass } = selectionPassModule;
const { createSelectionPacket } = selectionPacketModule;
const { createSelectionPerformanceBaseline } = selectionPerformanceBaselineModule;
const { createRenderSceneBuilder } = renderSceneModule;
const { createAdaptiveRenderQualityController } = adaptiveRenderQualityModule;
const { createEditPreviewController } = editPreviewControllerModule;
const { MAP_HOST_KINDS, normalizeMapSurfaceDragDelta } = mapHostModule;
const { createLegacyMapHost } = legacyMapHostModule;
const { buildGraticuleStrokeGeometryPacket } = graticuleGeometryModule;
const { createMapInteractionGate } = mapInteractionGateModule;
const { resolveMapInteractionStyle } = mapInteractionStyleModule;
const { loadUserPreferences, saveUserPreferences, effectiveTheme, defaultUserPreferences } = userPreferencesModule;
const { compactNotificationMessage } = notificationCopyModule;
const {
  DEFAULT_SAFE_INSETS,
  createMapLayoutMetricsSnapshot,
  equirectangularCenterForAnchor,
} = mapLayoutMetricsModule;
const { createMapVisualFrame } = mapVisualFrameModule;
const { createSelectController } = selectControllerModule;
const { DATA_READINESS, READINESS_EVENTS, canMutateProject, transitionDataReadiness } = startupReadinessModule;
const { runCountryEditTransaction } = countryEditTransactionModule;
const {
  TERRITORIAL_COVERAGE_MODES,
  TERRITORIAL_UNIT_TYPES,
  changeParent,
  changeSovereign,
  changeUnitType,
  createTerritorialFeature,
  createTerritorialRepository,
  normalizeTerritorialRelations,
  normalizeTerritorialUnits,
  territorialChildren,
  territorialSiblings,
} = territorialUnitsModule;
const {
  DISTRIBUTION_SCHEMA_VERSION,
  DISTRIBUTION_MODES,
  DISTRIBUTION_RENDER_MODES,
  DISTRIBUTION_TYPES,
  createDistributionEntry,
  createDistributionLayer,
  distributionEntriesForLayer,
  dominantDistributionEntries,
  normalizeDistributionEntries,
  normalizeDistributionLayers,
  validateDistributionModel,
} = distributionModelModule;
const TERRITORIAL_TYPE_LABELS = Object.freeze({
  [TERRITORIAL_UNIT_TYPES.COUNTRY]: MAP_OBJECT_TYPES.country.label,
  [TERRITORIAL_UNIT_TYPES.TERRITORY]: MAP_OBJECT_TYPES.territory.label,
  [TERRITORIAL_UNIT_TYPES.ADMIN]: MAP_OBJECT_TYPES.admin.label,
  [TERRITORIAL_UNIT_TYPES.REGION]: MAP_OBJECT_TYPES.region.label,
});
const territorialTypeLabel = unitType => TERRITORIAL_TYPE_LABELS[unitType] || '영역';
const createPartitionTerritorialFeature = options => createTerritorialFeature({
  id: options.id,
  unitType: options.unitType,
  parentId: options.parentId || options.sovereignId || '',
  sovereignId: options.sovereignId || '',
  isRemainder: options.isRemainder === true,
  coverageMode: TERRITORIAL_COVERAGE_MODES.PARTITION,
  adminLevel: options.adminLevel,
  name: options.name,
  color: options.color,
  notes: options.notes,
  metadata: options.metadata,
  sourceFolderId: options.sourceFolderId,
  geometry: options.geometry,
});
const { createSurfaceController } = surfaceControllerModule;
const { createEditorWorkspacePresentation } = await import(versionedModuleUrl('./modules/editor-workspace-presentation.js'));
const { describeTool, dispatchTool, isSpecialTool, toolCursorMode, toolDraftDefinition, toolLabel } = toolControllerModule;
const { createMapInputController } = mapInputControllerModule;
const { createGpuMapRenderer } = gpuMapRendererModule;
const { createTerritorialGeometryKernel, snapLineEndpointsToBoundary } = territorialGeometryModule;
const {
  buildBoundaryTopology: buildSharedBoundaryTopology,
  buildTerritorialInternalBoundarySegments,
  planCoastEdit,
  planSharedBoundaryEdit,
} = boundaryTopologyModule;
const {
  formatArea,
  geometryAreaKm2: sphericalGeometryAreaKm2,
} = geometryMetricsModule;
const {
  beginGeometryPreview,
  buildRenderableStrokeFeature,
  buildGeometryPreview,
  clearGeometryPreview,
  createGeometryPreviewState,
  hasAreaGeometry,
  previewIsCurrent,
} = geometryPreviewModule;
const { validateGeometry: validateStructuredGeometry, validateTerritorialGeometry } = geometryValidationModule;
const { LABEL_PRIORITIES, automaticLabelSettings, labelKey, layoutLabels, normalizeLabelSettings } = labelLayoutModule;
const { createAtomicMapStateController } = mapStateTransitionModule;
const { normalizeObjectRef } = objectRefModule;
const { OVERLAY_GROUPS, layerStyle, normalizeLayerPresentation } = layerPresentationModule;
const { AUTOSAVE_STATES, createSaveStateController } = saveStateModule;
const {
  ensureClosedRing,
  hasCanonicalCountryWinding,
  normalizeCountryGeometry,
  orientRing,
  ringSignedArea,
} = countryGeometry;

(() => {
  'use strict';

  const d3 = window.d3;
  let projectUi;
  let propertyEditorUi;
  let mapInputPresentation;
  let gisWorkflow;
  let mapDebug;
  const territorialGeometry = createTerritorialGeometryKernel(window.polygonClipping);

  const APP_VERSION = String(globalThis.PANDOLAB_BUILD_META?.appVersion || '');
  const HYDRO_DATA_VERSION = '0.13.0';
  // The flat map is intentionally equirectangular. Keep this contract
  // explicit so no host or transport implementation can change Pando's
  // rendered scene and interaction coordinates accidentally.
  const FLAT_PROJECTION_KIND = 'equirectangular';
  const FLAT_LATITUDE_LIMIT = 89.999;
  const ASSET_REVISION = String(window.PANDOLAB_ASSET_REVISION || globalThis.PANDOLAB_BUILD_META?.assetRevision || '');
  const DATA_REVISION = String(window.PANDOLAB_DATA_REVISION || globalThis.PANDOLAB_BUILD_META?.dataRevision || `data-${APP_VERSION}`);
  if (!APP_VERSION || !ASSET_REVISION) throw new Error('빌드 메타데이터가 불완전합니다.');
  const PANDOLAB_ASSET_BASE_URL = window.PANDOLAB_ASSET_BASE_URL || new URL('./assets/js/', location.href).href;
  const PHYSICAL_DATA_BASE_URL = new URL('../data/', PANDOLAB_ASSET_BASE_URL);
  const HISTORICAL_LIBRARY_DATA_URL = new URL('historical-library-pilot.json', PHYSICAL_DATA_BASE_URL);
  HISTORICAL_LIBRARY_DATA_URL.searchParams.set('v', ASSET_REVISION);
  const PHYSICAL_DATASET = 'HydroRIVERS 1.0 · Natural Earth 5.0.0 호수 · raster 3.2.0';
  const TERRAIN_DATASET = 'Natural Earth raster 3.2.0 1:10m';
  const HYDRO_DATASET = 'HydroRIVERS 1.0 · Natural Earth 5.0.0 1:10m lakes';

  const STORAGE_KEY = 'pandolab-editor-project';
  const AUTOSAVE_DB_NAME = 'pandolab-editor';
  const AUTOSAVE_STORE_NAME = 'projects';
  const AUTOSAVE_RECORD_KEY = 'active-project';
  const AUTOSAVE_VIEW_KEY = 'active-view';
  const BASE_DATASET = 'Natural Earth 5.1.1 · Admin 0 Countries · 1:10m · de facto';
  const DARK_DEFAULT_COLOR = '#63758a';
  const LIGHT_DEFAULT_COLOR = '#cccccc';
  const DEFAULT_GENERIC_FEATURE_COLOR = '#8c68d8';
  const COLOR_PRESETS = Object.freeze([
    '#000000', '#4b5563', '#9ca3af', '#ffffff', '#7f1d1d', '#dc2626',
    '#f97316', '#f59e0b', '#facc15', '#166534', '#22c55e', '#14b8a6',
    '#0ea5e9', '#2563eb', '#4338ca', '#7c3aed', '#a855f7', '#db2777',
    '#f43f5e', '#8b5e3c', '#cda95d', '#63758a', '#cccccc', '#8c68d8',
  ]);
  const COLOR_PALETTE_TONES = Object.freeze(['아주 밝음', '밝음', '기본', '어두움', '아주 어두움']);
  const COLOR_PALETTE_NEUTRALS = Object.freeze([
    Object.freeze({ color: '#ffffff', label: '흰색' }),
    Object.freeze({ color: '#e5e7eb', label: '연회색' }),
    Object.freeze({ color: '#9ca3af', label: '회색' }),
    Object.freeze({ color: '#4b5563', label: '진회색' }),
    Object.freeze({ color: '#1f2937', label: '먹색' }),
    Object.freeze({ color: '#000000', label: '검정' }),
  ]);
  const COLOR_PALETTE_HUES = Object.freeze([
    Object.freeze({ name: '빨강', colors: Object.freeze(['#fee2e2', '#fca5a5', '#ef4444', '#b91c1c', '#7f1d1d']) }),
    Object.freeze({ name: '주황', colors: Object.freeze(['#ffedd5', '#fdba74', '#f97316', '#c2410c', '#7c2d12']) }),
    Object.freeze({ name: '황금', colors: Object.freeze(['#fef3c7', '#fcd34d', '#f59e0b', '#b45309', '#78350f']) }),
    Object.freeze({ name: '노랑', colors: Object.freeze(['#fef9c3', '#fde047', '#eab308', '#a16207', '#713f12']) }),
    Object.freeze({ name: '연두', colors: Object.freeze(['#ecfccb', '#bef264', '#84cc16', '#4d7c0f', '#365314']) }),
    Object.freeze({ name: '초록', colors: Object.freeze(['#dcfce7', '#86efac', '#22c55e', '#15803d', '#14532d']) }),
    Object.freeze({ name: '청록', colors: Object.freeze(['#ccfbf1', '#5eead4', '#14b8a6', '#0f766e', '#134e4a']) }),
    Object.freeze({ name: '시안', colors: Object.freeze(['#cffafe', '#67e8f9', '#06b6d4', '#0e7490', '#164e63']) }),
    Object.freeze({ name: '파랑', colors: Object.freeze(['#dbeafe', '#93c5fd', '#3b82f6', '#1d4ed8', '#1e3a8a']) }),
    Object.freeze({ name: '인디고', colors: Object.freeze(['#e0e7ff', '#a5b4fc', '#6366f1', '#4338ca', '#312e81']) }),
    Object.freeze({ name: '보라', colors: Object.freeze(['#ede9fe', '#c4b5fd', '#8b5cf6', '#6d28d9', '#4c1d95']) }),
    Object.freeze({ name: '분홍', colors: Object.freeze(['#fce7f3', '#f9a8d4', '#ec4899', '#be185d', '#831843']) }),
  ]);
  const COLOR_PALETTE_COLORS = Object.freeze(COLOR_PALETTE_TONES.flatMap((tone, toneIndex) => (
    COLOR_PALETTE_HUES.map(hue => Object.freeze({
      color: hue.colors[toneIndex],
      label: `${hue.name} ${tone}`,
      family: hue.name,
      tone,
    }))
  )));
  const ZOOM_LIMITS = Object.freeze({
    globe: Object.freeze({ min: 0.72, max: 32 }),
    flat: Object.freeze({ min: 0.75, max: 64 }),
  });
  const HYDRO_TOOL_CONFIG = Object.freeze({
    river: Object.freeze({ geometry: 'LineString', category: 'river', label: '강', color: '#3b82c4', prefix: 'river' }),
    lake: Object.freeze({ geometry: 'Polygon', category: 'lake', label: '호수', color: '#5aa9d6', prefix: 'lake' }),
  });
  const HYDRO_LAYER_META = Object.freeze({
    rivers_hydro: Object.freeze({ label: '강', shortLabel: '강', sourceLabel: 'HydroRIVERS', category: 'river', color: '#3b82c4' }),
    lakes_natural_earth: Object.freeze({ label: '호수', shortLabel: '호수', sourceLabel: 'Natural Earth', category: 'lake', color: '#5aa9d6' }),
  });
  const TERRAIN_OCEAN_REPRESENTATIVE = '#6aa8d2';
  const MAX_HISTORY = 30;
  const CUT_ENDPOINT_SNAP_DISTANCE = Object.freeze({ mouse: 10, touch: 18 });
  const LAYOUT_QUERIES = {
    mobile: window.matchMedia('(max-width: 799px)'),
    compact: window.matchMedia('(min-width: 800px) and (max-width: 1199px)'),
  };

  const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  let systemTheme = systemThemeQuery.matches ? 'dark' : 'light';
  let userPreferences = loadUserPreferences();
  let runtimeReady = false;
  document.documentElement.dataset.systemTheme = systemTheme;
  document.documentElement.dataset.theme = effectiveTheme(userPreferences, systemTheme === 'dark');
  const MAP_LABEL_FONT_STACKS = Object.freeze({
    default: 'var(--ui-font-family)',
    gothic: '"Pretendard Variable", Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", sans-serif',
    serif: '"Noto Serif KR", "Nanum Myeongjo", "AppleMyungjo", serif',
  });
  function applyMapLabelPreferences() {
    const root = document.documentElement.style;
    const labels = userPreferences.labels;
    root.setProperty('--country-label-font-family', MAP_LABEL_FONT_STACKS[labels.country.font] || MAP_LABEL_FONT_STACKS.default);
    root.setProperty('--place-label-font-family', MAP_LABEL_FONT_STACKS[labels.place.font] || MAP_LABEL_FONT_STACKS.default);
    if (labels.country.color) root.setProperty('--country-label-color', labels.country.color);
    else root.removeProperty('--country-label-color');
    if (labels.place.color) root.setProperty('--place-label-color', labels.place.color);
    else root.removeProperty('--place-label-color');
    if (labels.place.pointColor) root.setProperty('--place-label-point-color', labels.place.pointColor);
    else root.removeProperty('--place-label-point-color');
  }
  applyMapLabelPreferences();
  let resolvedAccentColor = applyAppAccent(document, userPreferences.appearance.accentColor);
  function resolveCurrentInteractionStyle() {
    const theme = effectiveTheme(userPreferences, systemTheme === 'dark');
    const computed = getComputedStyle(document.documentElement);
    return resolveMapInteractionStyle({
      theme,
      selectionColor: resolvedAccentColor,
      outlineVisible: true,
      fillStrength: 0.35,
      tokens: {
        accent: computed.getPropertyValue('--accent').trim(),
        textStrong: computed.getPropertyValue('--text-strong').trim(),
      },
    });
  }
  let resolvedInteractionStyle = resolveCurrentInteractionStyle();
  document.documentElement.style.setProperty('--map-selection-halo', resolvedInteractionStyle.selection.color);
  setSelectionColor(resolvedInteractionStyle.selection.color);
  setSelectionInteractionStyle(resolvedInteractionStyle);
  window.__PANDOLAB_THEME__ = effectiveTheme(userPreferences, systemTheme === 'dark');

  function enableKeyboardNavigation(event) {
    if (event.key === 'Tab') document.documentElement.classList.add('keyboard-navigation');
  }

  function disableKeyboardNavigation() {
    document.documentElement.classList.remove('keyboard-navigation');
  }

  document.addEventListener('keydown', enableKeyboardNavigation, true);
  if ('PointerEvent' in window) document.addEventListener('pointerdown', disableKeyboardNavigation, true);
  else {
    document.addEventListener('mousedown', disableKeyboardNavigation, true);
    document.addEventListener('touchstart', disableKeyboardNavigation, { capture: true, passive: true });
  }

  function mapTheme() {
    const terrainVisible = state?.physicalSettings?.terrainVisible !== false;
    const terrainStyle = state?.physicalSettings?.terrainStyle || 'political';
    const terrainStrength = clamp(Number(state?.physicalSettings?.terrainStrength ?? 0.32), 0, 1);
    const terrainFillAlpha = terrainVisible
      ? (terrainStyle === 'physical' ? 0.22 : 1 - terrainStrength)
      : null;
    const countryStyle = state?.layerPresentation ? layerStyle(state.layerPresentation, 'countries') : { opacity: 1, boundaryVisible: true, boundaryWidth: 1 };
    const riverStyle = state?.layerPresentation ? layerStyle(state.layerPresentation, 'rivers') : { opacity: 1, boundaryVisible: true, boundaryWidth: 1 };
    const lakeStyle = state?.layerPresentation ? layerStyle(state.layerPresentation, 'lakes') : { opacity: 1, boundaryVisible: true, boundaryWidth: 1 };
    const base = (document.documentElement.dataset.theme || window.__PANDOLAB_THEME__ || systemTheme) === 'light'
      ? { defaultLand: LIGHT_DEFAULT_COLOR, fillAlpha: terrainFillAlpha ?? 1, border: '#ffffff', borderGpu: [1, 1, 1], borderAlpha: 1, ocean: '#ffffff', oceanGpu: [1, 1, 1] }
      : { defaultLand: DARK_DEFAULT_COLOR, fillAlpha: terrainFillAlpha ?? 0.74, border: '#323c46', borderGpu: [0.196, 0.235, 0.275], borderAlpha: 0.92, ocean: '#0d2837', oceanGpu: [0.051, 0.157, 0.216] };
    base.fillAlpha *= countryStyle.opacity;
    base.fillAlphaByte = Math.round(base.fillAlpha * 255);
    base.borderAlpha = countryStyle.boundaryVisible ? base.borderAlpha * countryStyle.opacity : 0;
    base.borderWidth = countryStyle.boundaryWidth;
    base.riverOpacity = riverStyle.opacity;
    base.riverWidth = riverStyle.boundaryWidth;
    base.lakeOpacity = lakeStyle.opacity;
    base.lakeBoundaryVisible = lakeStyle.boundaryVisible;
    base.lakeBoundaryWidth = lakeStyle.boundaryWidth;
    return base;
  }

  function defaultCountryColor() {
    return mapTheme().defaultLand;
  }

  function applySystemTheme(matchesDark) {
    const nextTheme = matchesDark ? 'dark' : 'light';
    if (nextTheme === systemTheme && userPreferences.appearance.theme !== 'system') return;
    systemTheme = nextTheme;
    document.documentElement.dataset.systemTheme = systemTheme;
    document.documentElement.dataset.theme = effectiveTheme(userPreferences, systemTheme === 'dark');
    window.__PANDOLAB_THEME__ = effectiveTheme(userPreferences, systemTheme === 'dark');
    resolvedAccentColor = applyAppAccent(document, userPreferences.appearance.accentColor);
    syncResolvedInteractionStyle();
    gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'system-theme');
    gpuMapRenderer.invalidatePhysicalStyle('system-theme');
    if (state?.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) {
      const id = String(state.selected.id);
      const feature = countryFeatureById(id);
      const color = readDomainColor(COLOR_DOMAINS.COUNTRY, { feature, override: state.countryOverrides[id] }, { fallback: defaultCountryColor() });
      if (color.isDefault && $('countryColorInput')) $('countryColorInput').value = color.value;
      syncColorPicker('country', {
        value: color.value,
        defaultColor: defaultCountryColor(),
        isDefault: color.isDefault,
      });
    }
    if (svg) {
      markLayerTreeDirty();
      layerTreeController?.render();
      renderingDomain?.invalidateBaseScene?.('system-theme');
    }
  }

  const $ = (id) => document.getElementById(id);

  function createEmptyState(title, description, { tag = 'div', compact = false } = {}) {
    const empty = document.createElement(tag);
    empty.className = `ui-empty-state${compact ? ' ui-empty-state--compact' : ''}`;
    const heading = document.createElement('strong');
    const text = document.createElement('p');
    heading.textContent = title;
    text.textContent = description;
    empty.append(heading, text);
    return empty;
  }
  const selectController = createSelectController({ document, window });
  selectController.enhanceAll();
  const tooltipController = createTooltipController({
    document,
    window,
    tooltip: $('uiTooltip'),
    clamp: (value, minimum, maximum) => clamp(value, minimum, maximum),
  });
  const bindUiTooltips = () => tooltipController.bind();

  function syncSearchClearButton(input, button) {
    button?.classList.toggle('hidden', !String(input?.value || '').length);
  }

  function runtimeAssetUrl(relativePath) {
    const url = new URL(relativePath, PANDOLAB_ASSET_BASE_URL);
    url.searchParams.set('v', ASSET_REVISION);
    return url;
  }
  const REQUIRED_UI_IDS = Object.freeze([
    'app', 'map', 'statusView', 'projectionStatus', 'statusPrimary', 'statusSelection', 'projectSaveStatus', 'projectSaveStatusText', 'uiTooltip',
    'mapPanelTabs', 'mapLayersTabBtn', 'mapViewTabBtn', 'layerSection', 'mapViewSection', 'mapViewProjectionSlot', 'projectionControl',
    'globeBtn', 'flatBtn', 'countriesVisible', 'territoriesVisible', 'administrativeVisible', 'regionsVisible', 'languagesVisible', 'ethnicitiesVisible', 'religionsVisible', 'riversVisible', 'lakesVisible', 'genericFeaturesVisible', 'labelsVisible', 'basemapLabelsVisible', 'distributionLayerModeInput', 'distributionBoundaryVisibleInput',
    'resetViewBtn', 'terrainVisible', 'terrainPoliticalRadio', 'terrainPhysicalRadio', 'terrainStrengthControl', 'terrainStrengthInput', 'terrainStrengthValue', 'countryNameInput', 'countryColorInput', 'capitalInput', 'notesInput',
    'debugMapPanel', 'countryAreaValue',
    'flagUploadBtn', 'flagFileInput', 'flagRemoveBtn',
    'genericFeatureNameInput', 'genericFeatureColorInput', 'genericFeatureNotesInput',
    'genericFeatureLandRelationSection', 'genericFeatureOwnerField', 'genericFeatureOwnerInput', 'genericFeatureParentField', 'genericFeatureParentInput', 'genericFeatureLandBindingField', 'genericFeatureLandBindingInput', 'genericFeatureRoleHelp',
    'genericFeatureLandActionsSection', 'splitGenericFeatureBtn', 'mergeGenericFeatureBtn', 'syncGenericFeatureCoastBtn', 'editGenericFeatureCoastBtn', 'applyGenericFeatureToCountryBtn', 'promoteGenericFeatureToCountryBtn', 'genericFeatureRoleValue', 'genericFeatureTopologyValue',
    'labelNameInput', 'labelKindInput', 'labelNotesInput', 'labelPositionValue',
    'editorScrollBody', 'editorObjectHeader', 'editorObjectStatus', 'emptyProperties', 'propertyTitle', 'propertyTypeLabel', 'editorTabBtn', 'actionsTabBtn', 'relationTabBtn', 'objectLockBtn', 'objectDeleteBtn', 'objectActionsMenu',
    'countryProperties', 'territoryProperties', 'administrativeProperties', 'regionProperties', 'distributionProperties', 'territoryNameConflict', 'administrativeNameConflict', 'regionNameConflict', 'regionNameInput', 'regionCountryInput', 'regionParentInput', 'regionColorInput', 'regionValidFromInput', 'regionValidToInput', 'regionNotesInput', 'distributionNameInput', 'distributionTypeValue', 'distributionColorInput', 'distributionParentInput', 'distributionRenderModeInput', 'distributionEntryList', 'distributionTerritorialUnitInput', 'distributionShareInput', 'addTerritorialDistributionBtn', 'addGeometryDistributionBtn', 'genericFeatureProperties', 'labelProperties', 'hydroProperties',
    'editBorderBtn', 'editCoastBtn', 'changeCountryTypeBtn', 'changeTerritoryTypeBtn', 'changeAdministrativeTypeBtn', 'reconcileAdministrativeCoastBtn', 'territorialTypeModal', 'territorialTypeTitle', 'territorialTypeContext', 'territorialTypeInput', 'territorialTypeSovereignRow', 'territorialTypeSovereignInput', 'territorialTypeParentRow', 'territorialTypeParentInput', 'territorialTypeImpact', 'territorialTypeImpactSummary', 'territorialTypeImpactList', 'territorialTypeCancelBtn', 'territorialTypeConfirmBtn',
    'countryCodeInput', 'genericFeatureIdInput', 'hydroCategoryValue', 'hydroIdLabel', 'hydroIdValue', 'hydroSystemRow', 'hydroSystemValue', 'hydroTributaryValue', 'hydroSourceValue', 'hydroBuiltinHelp', 'hydroEditFields', 'hydroNameInput', 'hydroColorInput', 'hydroNotesInput', 'copyHydroBtn',
    'undoBtn', 'redoBtn', 'rightPanel',
    'mapTopContextSlot', 'modeEditingContext', 'modeEditingHud', 'modeTaskWindowContent', 'modeTaskMinimizeBtn', 'modeTaskCloseBtn', 'modeActionBar', 'modeTaskName', 'modeTaskStage', 'modeTaskInstruction',
    'modeMethodSwitch', 'modeLineMethodBtn', 'modePolygonMethodBtn', 'modeComponentsMethodBtn', 'modeRiverBoundaryOption', 'modeRiverBoundaryInput', 'modeDraftActions', 'modeDraftRedrawBtn', 'modeDraftRemoveLastBtn', 'modeDraftDeleteBtn', 'geometryPreviewSummary', 'modePrimaryBtn', 'modeCancelBtn',
    'multiSelectionBar', 'multiSelectionCount', 'multiSelectionModeBtn', 'multiPropertiesVisibilityInput', 'multiCountryActions', 'multiBorderEditBtn', 'multiBorderEditHelp',
    'saveProjectBtn', 'openGisBtn', 'gisFileInput', 'newProjectBtn', 'dataExportBtn', 'preferencesBtn', 'preferencesModal', 'preferencesThemeInput', 'preferencesApplyBtn', 'preferencesResetBtn', 'preferencesCancelBtn', 'preferencesCloseBtn',
    'createBuildTabBtn', 'createLibraryTabBtn', 'createBuildPanel', 'createLibraryPanel', 'addCountryBtn', 'addTerritoryBtn', 'addAdministrativeBtn', 'addRegionBtn', 'territorialCreateModal', 'territorialCreateTitle', 'territorialCreateContext', 'territorialCreateMethod', 'territorialCreateCancelBtn', 'territorialCreateConfirmBtn',
    'gisTargetCountry', 'gisParentUnit', 'gisExportModal', 'gisExportConfirmBtn', 'confirmModalChoiceRow', 'confirmModalChoice',
    'coastReconciliationModal', 'coastReconciliationTitle', 'coastReconciliationMessage', 'coastReconciliationImpact', 'coastReconciliationImpactList', 'coastReconciliationCountryBtn', 'coastReconciliationAdminBtn', 'coastReconciliationIndependentBtn', 'coastReconciliationCancelBtn',
    'layerSearchInput', 'layerSearchClearBtn', 'addFromLibraryBtn', 'historicalLibraryModal', 'historicalLibraryCloseBtn', 'historicalLibrarySearchInput', 'historicalLibrarySearchClearBtn', 'historicalLibraryTypeInput', 'historicalLibraryStatusInput', 'historicalLibraryYearInput', 'historicalLibraryGeographicRegionInput', 'historicalLibraryResults', 'historicalLibraryPreview', 'historicalLibrarySnapshotInput', 'historicalLibrarySnapshotBtn', 'historicalLibraryChildDepthInput', 'historicalLibraryAddBtn',
  ]);
  const CACHE_MISMATCH_MESSAGE = '화면 파일과 스크립트 버전이 다릅니다. 페이지를 강력 새로고침하세요. PC에서는 Ctrl+F5를 사용할 수 있습니다.';

  function assertRuntimeCompatibility() {
    const htmlVersion = $('app')?.dataset.appVersion;
    const bootstrapVersion = window.PANDOLAB_APP_VERSION;
    if (htmlVersion !== APP_VERSION || bootstrapVersion !== APP_VERSION) throw new Error(CACHE_MISMATCH_MESSAGE);
    const missingIds = REQUIRED_UI_IDS.filter(id => !$(id));
    const missingSelectors = ['.workspace'].filter(selector => !document.querySelector(selector));
    if (missingIds.length || missingSelectors.length) throw new Error(CACHE_MISMATCH_MESSAGE);
  }

  const deepClone = (obj) => JSON.parse(JSON.stringify(obj));
  const reliabilityDiagnostic = createDiagnosticLog({ limit: 250 });
  window.__PANDOLAB_RELIABILITY_LOG__ = reliabilityDiagnostic;
  // 내장 원본은 읽기 전용 기준 지도다. 렌더링 메시와 편집 사본을 분리해 원본 좌표를 보존한다.
  let pristineCountriesFallback = window.PANDOLAB_COUNTRIES || { type: 'FeatureCollection', features: [] };
  let canonicalCountryStore = null;
  let builtinCountryIds = new Set(pristineCountriesFallback.features.map(feature => String(feature.id)));
  const PRISTINE_LABEL_ANCHORS = window.PANDOLAB_LABEL_ANCHORS || {};

  function installCanonicalCountryStore(store) {
    if (!store || typeof store.materializeCollectionSync !== 'function'
        || typeof store.materializeFeature !== 'function' || typeof store.geometryEquals !== 'function') {
      throw new Error('무손실 국가 packet store가 올바르지 않습니다.');
    }
    canonicalCountryStore = store;
    builtinCountryIds = new Set(store.ids());
    pristineCountriesFallback = null;
  }

  function materializePristineCountriesSync() {
    return canonicalCountryStore?.materializeCollectionSync?.()
      || deepClone(pristineCountriesFallback || { type: 'FeatureCollection', features: [] });
  }

  async function materializePristineCountries() {
    if (!canonicalCountryStore?.materializeCollection) return materializePristineCountriesSync();
    const result = await canonicalCountryStore.materializeCollection({
      budgetMs: 4,
      coordinateBudget: 4096,
      waitForQuiet: async () => {},
      yieldFrame: () => new Promise(resolve => requestAnimationFrame(resolve)),
    });
    return result.collection;
  }

  function freshPristineCountries(applyOverrides = true) {
    const countries = reindexCountries(materializePristineCountriesSync(), applyOverrides, { assumeCanonical: !!canonicalCountryStore });
    applyPristineLabelAnchors(countries);
    return countries;
  }
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const hydroToolConfig = tool => HYDRO_TOOL_CONFIG[tool] || null;
  const draftToolConfig = tool => toolDraftDefinition(tool, state);
  const isPolygonDraftTool = tool => draftToolConfig(tool)?.shape === 'polygon';
  const isGenericFeatureDraftTool = tool => !!draftToolConfig(tool);
  const clampViewZooms = view => {
    if (!view) return view;
    view.globeZoom = clamp(Number(view.globeZoom) || 1, ZOOM_LIMITS.globe.min, ZOOM_LIMITS.globe.max);
    view.flatZoom = clamp(Number(view.flatZoom) || 1, ZOOM_LIMITS.flat.min, ZOOM_LIMITS.flat.max);
    return view;
  };
  const uid = () => createProjectObjectId();
  const detectLayoutMode = () => LAYOUT_QUERIES.mobile.matches ? 'mobile' : LAYOUT_QUERIES.compact.matches ? 'compact' : 'wide';
  let layoutMode = detectLayoutMode();
  let mapPanelView = 'layers';
  const isMobile = () => layoutMode === 'mobile';
  let lastOverlayTrigger = null;
  let fileMenuTrigger = null;
  let createMenuTrigger = null;
  let createMenuRoute = 'build';
  const surfaceController = createSurfaceController({ getElement: $, getLayout: () => layoutMode, document });
  const surfaceState = surfaceController.state;
  const editorWorkspacePresentation = createEditorWorkspacePresentation({
    document, getLayout: () => layoutMode,
    panel: $('rightPanel'), task: $('modeEditingContext'),
    dockSlot: $('editorTaskSlot'), floatingSlot: $('mapTopContextSlot'),
    content: $('modeTaskWindowContent'), minimize: $('modeTaskMinimizeBtn'),
    isEditorOpen: () => surfaceController.isOpen('editor'),
    openEditor: () => { surfaceController.open('editor'); surfaceController.render(); },
    closeEditor: () => { surfaceController.close('editor'); surfaceController.render(); },
    onLayoutChange: () => queueMapResize('editor-task-layout'),
  });
  let mapSurfaceTabs = null;
  let createSurfaceTabs = null;
  let editorSurfaceTabs = null;
  // Keep these values in sync with the UI v2 sheet tokens. CSS cannot be read
  // reliably during boot, so the controller owns the numeric snap contract.
  const MOBILE_SHEET_SNAP_COLLAPSED_PX = 84;
  const MOBILE_SHEET_EDITOR_RATIOS = Object.freeze({ half: 0.48, expanded: 0.86 });
  const MOBILE_SHEET_MAP_RATIOS = Object.freeze({ half: 0.52, expanded: 0.88 });
  const SHEET_SNAP_RATIOS = Object.freeze([0, MOBILE_SHEET_EDITOR_RATIOS.half, MOBILE_SHEET_EDITOR_RATIOS.expanded]);
  const SHEET_SNAP_LABELS = Object.freeze(['접힌 상태', '중간 높이', '확장']);
  const SHEET_SNAP_DEFAULTS = Object.freeze({ layers: 1, create: 1, edit: 1 });
  const MOBILE_SHEET_DEFAULT_SNAP = 1;
  const MOBILE_SHEET_IDS = Object.freeze({ map: 'leftPanel', create: 'createMenu', edit: 'rightPanel' });
  const sheetSnapIndex = new Map(Object.values(MOBILE_SHEET_IDS).map(id => [id, MOBILE_SHEET_DEFAULT_SNAP]));
  const sheetSnapTouched = new Set();
  let activeSheetDrag = null;
  let mapModeContextWasActive = false;
  const MOBILE_SHEET_HISTORY_KEY = '__atlaswrightMobileSheet';
  let ignoreNextMobileSheetPopstate = false;

  const mobileViewportHeight = () => window.visualViewport?.height || window.innerHeight;

  function mobileSheetNavHeight() {
    const nav = document.querySelector('.adaptive-nav');
    const height = nav?.getBoundingClientRect().height || 0;
    return height > 0 ? height : 64;
  }

  function mobileSheetAvailableHeight() {
    const topbarHeight = document.querySelector('.topbar')?.getBoundingClientRect().height || 60;
    return Math.max(180, mobileViewportHeight() - topbarHeight - mobileSheetNavHeight());
  }

  function mobileSheetKind(panelOrKind) {
    if (typeof panelOrKind === 'string') return panelOrKind;
    const panelId = panelOrKind?.id;
    return Object.entries(MOBILE_SHEET_IDS).find(([, id]) => id === panelId)?.[0] || 'edit';
  }

  function mobileSheetSnapHeight(index, panelOrKind = 'edit') {
    const safeIndex = clamp(Number(index) || 0, 0, SHEET_SNAP_RATIOS.length - 1);
    const kind = mobileSheetKind(panelOrKind);
    if (safeIndex === 0) return Math.min(mobileSheetAvailableHeight(), MOBILE_SHEET_SNAP_COLLAPSED_PX);
    const ratios = kind === 'edit' ? MOBILE_SHEET_EDITOR_RATIOS : MOBILE_SHEET_MAP_RATIOS;
    const ratio = safeIndex === 1 ? ratios.half : ratios.expanded;
    return Math.min(mobileSheetAvailableHeight(), mobileViewportHeight() * ratio);
  }

  function mobileSheetPanel(kind) {
    return $(MOBILE_SHEET_IDS[kind]);
  }

  function mobileSheetHistoryKind() {
    return window.history.state?.[MOBILE_SHEET_HISTORY_KEY] || null;
  }

  function trackMobileSheetHistory(kind) {
    if (!isMobile() || !kind) return;
    const currentState = window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
    const nextState = { ...currentState, [MOBILE_SHEET_HISTORY_KEY]: kind };
    if (mobileSheetHistoryKind()) window.history.replaceState(nextState, '', window.location.href);
    else window.history.pushState(nextState, '', window.location.href);
  }

  function releaseMobileSheetHistory() {
    if (!mobileSheetHistoryKind()) return;
    ignoreNextMobileSheetPopstate = true;
    window.history.back();
  }

  function setMobileSheetHeight(panel, index, temporaryHeight = null) {
    if (!panel) return 0;
    const safeIndex = clamp(Number(index) || 0, 0, SHEET_SNAP_RATIOS.length - 1);
    const maxHeight = mobileSheetSnapHeight(SHEET_SNAP_RATIOS.length - 1, panel);
    const minHeight = mobileSheetSnapHeight(0, panel);
    const height = temporaryHeight == null
      ? mobileSheetSnapHeight(safeIndex, panel)
      : clamp(temporaryHeight, Math.max(128, minHeight * 0.62), maxHeight);
    panel.style.setProperty('--sheet-height', `${Math.round(height)}px`);
    if (temporaryHeight == null) {
      sheetSnapIndex.set(panel.id, safeIndex);
      panel.dataset.sheetSnap = String(safeIndex);
      const handle = panel.querySelector('[data-sheet-handle]');
      handle?.setAttribute('aria-valuenow', String(safeIndex));
      handle?.setAttribute('aria-valuetext', SHEET_SNAP_LABELS[safeIndex]);
    }
    return height;
  }

  function resetMobileSheetSession(panel, { applyHeight = true } = {}) {
    if (!panel) return;
    sheetSnapTouched.delete(panel.id);
    const defaultSnap = SHEET_SNAP_DEFAULTS[mobileSheetKind(panel)] ?? MOBILE_SHEET_DEFAULT_SNAP;
    sheetSnapIndex.set(panel.id, defaultSnap);
    if (applyHeight) setMobileSheetHeight(panel, defaultSnap);
  }


  function refreshMapSheetMetrics() {
    const panels = Object.values(MOBILE_SHEET_IDS).map(id => $(id)).filter(Boolean);
    if (!isMobile()) {
      panels.forEach(panel => panel.style.removeProperty('--sheet-height'));
      document.body.classList.remove('map-sheet-dragging');
      return;
    }
    panels.forEach(panel => {
      if (activeSheetDrag?.panel !== panel) setMobileSheetHeight(panel, sheetSnapIndex.get(panel.id) ?? MOBILE_SHEET_DEFAULT_SNAP);
    });
  }

  function syncEditorPanelControls() {
    const headerToggle = $('mobileCloseRightBtn');
    if (!headerToggle) return;
    const label = layoutMode === 'wide' ? '편집창 접기' : '편집창 닫기';
    headerToggle.setAttribute('aria-label', label);
    headerToggle.dataset.tooltip = label;
  }

  function applyLayoutMode({ initial = false } = {}) {
    const previous = layoutMode;
    layoutMode = detectLayoutMode();
    const app = $('app');
    if (app) app.dataset.layout = layoutMode;
    document.body.dataset.layout = layoutMode;
    surfaceController.syncLayout(previous);
    if (previous === 'mobile' && layoutMode !== 'mobile') releaseMobileSheetHistory();
    else if (layoutMode === 'mobile' && previous !== 'mobile' && surfaceController.activeMobileSheet) {
      trackMobileSheetHistory(surfaceController.activeMobileSheet);
    }
    const fileOpen = !!document.querySelector('.top-actions')?.classList.contains('mobile-open');
    surfaceController.render({ fileOpen });
    editorWorkspacePresentation.sync();
    if (fileOpen) requestAnimationFrame(syncFileMenuNotificationOffset);
    refreshMapSheetMetrics();
    syncEditorPanelControls();
    syncMobileNavigation();
    requestAnimationFrame(syncMapHudBounds);
    if (isCreateMenuOpen()) positionLayerCreateMenu();
    if (!initial && previous !== layoutMode) queueMapResize('layout-mode-change');
    return previous !== layoutMode;
  }

  function syncOverlayState() {
    const fileOpen = !!document.querySelector('.top-actions')?.classList.contains('mobile-open');
    const view = surfaceController.render({ fileOpen });
    editorWorkspacePresentation.sync();
    syncEditorPanelControls();
    refreshMapSheetMetrics();
    syncMobileNavigation();
    requestAnimationFrame(syncMapHudBounds);
    if (view.createOpen) positionLayerCreateMenu();
    if (fileOpen) requestAnimationFrame(syncFileMenuNotificationOffset);
    else $('app')?.style.removeProperty('--file-menu-notification-top');
    queueMapResize('panel-layout');
    return view;
  }

  function syncFileMenuNotificationOffset() {
    const app = $('app');
    const menu = document.querySelector('.top-actions.mobile-open');
    if (!app || layoutMode !== 'mobile' || !menu) {
      app?.style.removeProperty('--file-menu-notification-top');
      return;
    }
    app.style.setProperty('--file-menu-notification-top', `${Math.ceil(menu.getBoundingClientRect().bottom)}px`);
  }

  function closeFileMenu({ restoreFocus = false } = {}) {
    const menu = document.querySelector('.top-actions');
    if (!menu?.classList.contains('mobile-open')) return;
    const trigger = fileMenuTrigger;
    fileMenuTrigger = null;
    menu.classList.remove('mobile-open');
    syncOverlayState();
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  function isCreateMenuOpen() {
    return surfaceController.isOpen('create');
  }

  function closeCreateMenu({ restoreFocus = false } = {}) {
    if (!isCreateMenuOpen()) return;
    closeSurface('create', { restoreFocus });
  }

  function activeCreateMenuItems() {
    const panel = $(`create${createMenuRoute === 'library' ? 'Library' : 'Build'}Panel`);
    return panel ? [...panel.querySelectorAll('.create-menu-item:not([disabled])')] : [];
  }

  function syncCreateMenuRoute(route = createMenuRoute, { focus = false } = {}) {
    createMenuRoute = route === 'library' ? 'library' : 'build';
    if ($('createBuildPanel')) $('createBuildPanel').hidden = createMenuRoute !== 'build';
    if ($('createLibraryPanel')) $('createLibraryPanel').hidden = createMenuRoute !== 'library';
    createSurfaceTabs?.sync(createMenuRoute, { focus });
    syncMapObjectCategoryLabels();
  }

  function toggleCreateMenu(trigger) {
    toggleSurface('create', trigger);
  }

  function positionLayerCreateMenu() {
    if (isMobile()) return;
    const menu = $('createMenu');
    const trigger = $('createMenuBtn');
    if (!menu || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0;
    const top = viewport?.offsetTop || 0;
    const width = viewport?.width || window.innerWidth;
    const height = viewport?.height || window.innerHeight;
    menu.style.setProperty('--layer-create-left', `${Math.max(left + 8, Math.min(rect.left, left + width - menu.getBoundingClientRect().width - 8))}px`);
    menu.style.setProperty('--layer-create-bottom', `${Math.max(8, window.innerHeight - rect.top + 8)}px`);
    menu.style.setProperty('--layer-create-height', `${Math.max(80, Math.min(height - 16, rect.top - top - 16))}px`);
  }

  function closeActiveMobileSheet({ restoreFocus = false, syncHistory = true } = {}) {
    if (!isMobile() || !surfaceController.activeMobileSheet) return;
    const kind = surfaceController.activeMobileSheet;
    const surface = { map: 'layers', create: 'create', edit: 'editor' }[kind];
    const panel = mobileSheetPanel(kind);
    surfaceController.close(surface);
    resetMobileSheetSession(panel);
    syncOverlayState();
    if (syncHistory) releaseMobileSheetHistory();
    if (restoreFocus && lastOverlayTrigger?.isConnected) lastOverlayTrigger.focus({ preventScroll: true });
    if (restoreFocus) lastOverlayTrigger = null;
  }

  function closeMobileSheets(except = null, { restoreFocus = false } = {}) {
    if (isMobile()) {
      const exceptKind = except === 'left' ? 'map' : except === 'right' ? 'edit' : except === 'create' ? 'create' : null;
      if (surfaceController.activeMobileSheet && surfaceController.activeMobileSheet !== exceptKind) closeActiveMobileSheet({ restoreFocus });
      return;
    }
    if (except !== 'left') surfaceController.close('layers');
    if (except !== 'right') surfaceController.close('editor');
    if (except !== 'create') surfaceController.close('create');
    syncOverlayState();
    if (restoreFocus && lastOverlayTrigger?.isConnected) lastOverlayTrigger.focus({ preventScroll: true });
    if (restoreFocus) lastOverlayTrigger = null;
  }

  function toggleFileMenu() {
    closeCreateMenu();
    const menu = document.querySelector('.top-actions');
    if (!menu) return;
    const willOpen = !menu.classList.contains('mobile-open');
    if (willOpen) fileMenuTrigger = $('mobileFileBtn');
    menu.classList.toggle('mobile-open', willOpen);
    syncOverlayState();
    if (willOpen) requestAnimationFrame(() => menu.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true }));
  }

  function nearestSheetSnapIndex(height, panel) {
    let nearest = 0;
    let distance = Infinity;
    SHEET_SNAP_RATIOS.forEach((_, index) => {
      const nextDistance = Math.abs(height - mobileSheetSnapHeight(index, panel));
      if (nextDistance < distance) {
        distance = nextDistance;
        nearest = index;
      }
    });
    return nearest;
  }

  const mobileSheetSettlement = new WeakMap();

  function clearMobileSheetDragPresentation(panel) {
    if (!panel) return;
    const pending = mobileSheetSettlement.get(panel);
    if (pending?.timer) clearTimeout(pending.timer);
    mobileSheetSettlement.delete(panel);
    panel.classList.remove('is-sheet-dragging', 'is-sheet-settling');
    panel.style.removeProperty('--sheet-drag-height');
    panel.style.removeProperty('--sheet-drag-offset');
  }

  function applyMobileSheetDragPreview(panel, height) {
    const maxHeight = mobileSheetSnapHeight(SHEET_SNAP_RATIOS.length - 1, panel);
    const minHeight = mobileSheetSnapHeight(0, panel);
    const visibleHeight = clamp(Number(height) || 0, Math.max(128, minHeight * 0.62), maxHeight);
    panel.style.setProperty('--sheet-drag-height', `${Math.round(maxHeight)}px`);
    panel.style.setProperty('--sheet-drag-offset', `${Math.round(maxHeight - visibleHeight)}px`);
    return { visibleHeight, maxHeight };
  }

  function finalizeMobileSheetSettlement(panel) {
    const settlement = mobileSheetSettlement.get(panel);
    if (!settlement) return false;
    if (settlement.timer) clearTimeout(settlement.timer);
    mobileSheetSettlement.delete(panel);
    const { dismiss, restoreFocus } = settlement;
    panel.classList.remove('is-sheet-dragging', 'is-sheet-settling');
    panel.style.removeProperty('--sheet-drag-height');
    panel.style.removeProperty('--sheet-drag-offset');
    if (dismiss) {
      closeActiveMobileSheet({ restoreFocus });
      return true;
    }
    refreshMapSheetMetrics();
    requestAnimationFrame(syncMapHudBounds);
    queueMapResize('panel-layout');
    return true;
  }

  function settleMobileSheetDrag(panel, { targetIndex = null, dismiss = false, restoreFocus = false } = {}) {
    if (!panel) return;
    const previous = mobileSheetSettlement.get(panel);
    if (previous?.timer) clearTimeout(previous.timer);
    const maxHeight = mobileSheetSnapHeight(SHEET_SNAP_RATIOS.length - 1, panel);
    let targetOffset = maxHeight;
    if (!dismiss) {
      const safeTarget = clamp(Number(targetIndex) || 0, 0, SHEET_SNAP_RATIOS.length - 1);
      const targetHeight = setMobileSheetHeight(panel, safeTarget);
      targetOffset = Math.max(0, maxHeight - targetHeight);
    }
    const settlement = { dismiss, restoreFocus, timer: 0 };
    mobileSheetSettlement.set(panel, settlement);
    panel.classList.remove('is-sheet-dragging');
    panel.classList.add('is-sheet-settling');
    panel.style.setProperty('--sheet-drag-height', `${Math.round(maxHeight)}px`);
    requestAnimationFrame(() => {
      if (mobileSheetSettlement.get(panel) !== settlement) return;
      panel.style.setProperty('--sheet-drag-offset', `${Math.round(targetOffset)}px`);
    });
    settlement.timer = setTimeout(() => finalizeMobileSheetSettlement(panel), 280);
  }

  function beginMobileSheetDrag(panel, source, pointerId, clientY) {
    if (!isMobile() || !panel || activeSheetDrag) return false;
    clearMobileSheetDragPresentation(panel);
    const currentHeight = Number.parseFloat(getComputedStyle(panel).height)
      || setMobileSheetHeight(panel, sheetSnapIndex.get(panel.id) ?? MOBILE_SHEET_DEFAULT_SNAP);
    const preview = applyMobileSheetDragPreview(panel, currentHeight);
    panel.classList.add('is-sheet-dragging');
    activeSheetDrag = {
      panel,
      source,
      pointerId,
      startY: clientY,
      startHeight: currentHeight,
      previewHeight: preview.visibleHeight,
      maxHeight: preview.maxHeight,
      startIndex: sheetSnapIndex.get(panel.id) ?? MOBILE_SHEET_DEFAULT_SNAP,
      startTime: performance.now(),
      moved: false,
    };
    document.body.classList.add('map-sheet-dragging');
    return true;
  }

  function moveMobileSheetDrag(panel, source, pointerId, clientY) {
    const drag = activeSheetDrag;
    if (!drag || drag.panel !== panel || drag.source !== source || drag.pointerId !== pointerId) return false;
    const deltaY = clientY - drag.startY;
    if (Math.abs(deltaY) > 6) drag.moved = true;
    const preview = applyMobileSheetDragPreview(panel, drag.startHeight - deltaY);
    drag.previewHeight = preview.visibleHeight;
    drag.maxHeight = preview.maxHeight;
    return true;
  }

  function finishMobileSheetDrag(panel, source, pointerId, clientY, { cancelled = false } = {}) {
    const drag = activeSheetDrag;
    if (!drag || drag.panel !== panel || drag.source !== source || drag.pointerId !== pointerId) return null;
    const deltaY = clientY - drag.startY;
    const currentHeight = Number(drag.previewHeight || drag.startHeight);
    const elapsed = Math.max(1, performance.now() - drag.startTime);
    const velocity = deltaY / elapsed;
    activeSheetDrag = null;
    document.body.classList.remove('map-sheet-dragging');
    const dismissDistance = Math.min(180, drag.startHeight * 0.3);
    if (!cancelled && deltaY > 64 && (deltaY >= dismissDistance || velocity > 0.65)) {
      settleMobileSheetDrag(panel, { dismiss: true, restoreFocus: true });
    } else {
      let targetIndex = cancelled ? drag.startIndex : nearestSheetSnapIndex(currentHeight, panel);
      if (!cancelled && drag.moved && Math.abs(deltaY) > 24 && Math.abs(velocity) > 0.45) {
        targetIndex = clamp(drag.startIndex + (deltaY < 0 ? 1 : -1), 0, SHEET_SNAP_RATIOS.length - 1);
      }
      if (!cancelled) sheetSnapTouched.add(panel.id);
      settleMobileSheetDrag(panel, { targetIndex });
    }
    return drag;
  }

  function bindSheetDragHandle(handle) {
    const panel = $(handle?.dataset?.sheetHandle);
    if (!handle || !panel) return;
    handle.addEventListener('click', event => {
      if (!isMobile()) return;
      if (handle.dataset.dragged === 'true') {
        handle.dataset.dragged = 'false';
        event.preventDefault();
        return;
      }
      const current = sheetSnapIndex.get(panel.id) ?? MOBILE_SHEET_DEFAULT_SNAP;
      const target = current === SHEET_SNAP_RATIOS.length - 1 ? 0 : SHEET_SNAP_RATIOS.length - 1;
      sheetSnapTouched.add(panel.id);
      setMobileSheetHeight(panel, target);
      syncOverlayState();
    });
    handle.addEventListener('keydown', event => {
      if (!isMobile()) return;
      const current = sheetSnapIndex.get(panel.id) ?? MOBILE_SHEET_DEFAULT_SNAP;
      let target;
      if (event.key === 'ArrowUp' || event.key === 'PageUp') target = Math.min(SHEET_SNAP_RATIOS.length - 1, current + 1);
      else if (event.key === 'ArrowDown' || event.key === 'PageDown') target = Math.max(0, current - 1);
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = SHEET_SNAP_RATIOS.length - 1;
      else if (event.key === 'Escape') {
        closeActiveMobileSheet({ restoreFocus: true });
        event.preventDefault();
        return;
      } else return;
      sheetSnapTouched.add(panel.id);
      setMobileSheetHeight(panel, target);
      refreshMapSheetMetrics();
      event.preventDefault();
    });
    handle.addEventListener('pointerdown', event => {
      if (!isMobile() || event.button > 0) return;
      if (!beginMobileSheetDrag(panel, handle, event.pointerId, event.clientY)) return;
      try { handle.setPointerCapture?.(event.pointerId); } catch (_) {}
      event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
      if (moveMobileSheetDrag(panel, handle, event.pointerId, event.clientY)) event.preventDefault();
    });
    const finish = (event, cancelled = false) => {
      const drag = finishMobileSheetDrag(panel, handle, event.pointerId, event.clientY, { cancelled });
      if (!drag) return;
      handle.dataset.dragged = String(drag.moved);
      try { handle.releasePointerCapture?.(event.pointerId); } catch (_) {}
    };
    handle.addEventListener('pointerup', event => finish(event));
    handle.addEventListener('pointercancel', event => finish(event, true));
  }

  function bindMobileSheetSurface(panel) {
    if (!panel) return;
    const header = panel.querySelector('.surface-header');
    const handle = panel.querySelector('[data-sheet-handle]');
    if (handle) bindSheetDragHandle(handle);

    if (header) {
      header.addEventListener('pointerdown', event => {
        if (!isMobile() || event.button > 0 || event.target.closest('[data-sheet-handle], button, input, textarea, select')) return;
        if (!beginMobileSheetDrag(panel, header, event.pointerId, event.clientY)) return;
        try { header.setPointerCapture?.(event.pointerId); } catch (_) {}
        event.preventDefault();
      });
      header.addEventListener('pointermove', event => {
        if (moveMobileSheetDrag(panel, header, event.pointerId, event.clientY)) event.preventDefault();
      });
      const finishHeader = (event, cancelled = false) => {
        const drag = finishMobileSheetDrag(panel, header, event.pointerId, event.clientY, { cancelled });
        if (!drag) return;
        try { header.releasePointerCapture?.(event.pointerId); } catch (_) {}
      };
      header.addEventListener('pointerup', event => finishHeader(event));
      header.addEventListener('pointercancel', event => finishHeader(event, true));
    }
    panel.addEventListener('transitionend', event => {
      if (event.target !== panel || !['height', 'width', 'transform'].includes(event.propertyName)) return;
      queueMapResize('panel-layout');
    });
  }

  function openSelectionEditor() {
    const panel = $('rightPanel');
    if (!panel) return;
    if (layoutMode !== 'wide' || !surfaceState.editorManuallyCollapsed) openSurface('editor', { automatic: true });
    if (panel.classList.contains('mobile-open')) $('editorScrollBody')?.scrollTo?.({ top: 0, behavior: 'instant' });
    syncMobileNavigation();
    if (layoutMode === 'wide') queueMapResize('panel-layout');
  }


  function openSurface(surface, { trigger = null, automatic = false } = {}) {
    if (!['layers', 'create', 'editor'].includes(surface)) return;
    closeFileMenu();
    const activeTrigger = trigger instanceof HTMLElement ? trigger : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (surface === 'create' && !isMobile()) createMenuTrigger = activeTrigger;
    if (isMobile()) lastOverlayTrigger = activeTrigger;
    surfaceController.open(surface, { automatic });
    if (isMobile()) {
      const kind = { layers: 'map', create: 'create', editor: 'edit' }[surface];
      const panel = mobileSheetPanel(kind);
      resetMobileSheetSession(panel);
      trackMobileSheetHistory(kind);
    }
    syncOverlayState();
    if (surface === 'create' && layoutMode === 'wide') {
      requestAnimationFrame(() => activeCreateMenuItems()[0]?.focus({ preventScroll: true }));
    }
  }

  function closeSurface(surface, { manual = false, restoreFocus = false, syncHistory = true } = {}) {
    if (surface === 'editor' && editorWorkspacePresentation.isDocked()) return;
    const mobileKind = isMobile() ? { layers: 'map', create: 'create', editor: 'edit' }[surface] : null;
    const mobilePanel = mobileKind ? mobileSheetPanel(mobileKind) : null;
    if (!surfaceController.close(surface, { manual, selected: !!state?.selected })) return;
    if (mobilePanel) resetMobileSheetSession(mobilePanel);
    if (surface === 'editor') closeAllColorPickers();
    syncOverlayState();
    if (mobilePanel && syncHistory) releaseMobileSheetHistory();
    const trigger = surface === 'create' && !isMobile() ? createMenuTrigger : lastOverlayTrigger;
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
    if (restoreFocus) lastOverlayTrigger = null;
    if (surface === 'create') createMenuTrigger = null;
  }

  function returnToMapAfterMobileAction(started, { fromCreate = false } = {}) {
    if (!started) return false;
    if (fromCreate && isCreateMenuOpen()) closeCreateMenu();
    if (isMobile()) {
      closeActiveMobileSheet();
      requestAnimationFrame(() => $('map')?.focus({ preventScroll: true }));
    }
    return true;
  }

  function toggleSurface(surface, trigger = null) {
    if (surfaceController.isOpen(surface) && !(surface === 'layers' && layoutMode === 'wide')) {
      closeSurface(surface, { manual: surface === 'editor', restoreFocus: true });
    } else {
      openSurface(surface, { trigger });
    }
  }


  function syncMobileNavigation() {
    const adding = state?.tool === 'new-country' || !!hydroToolConfig(state?.tool) || state?.labelPlacementMode || state?.tool === 'label';
    $('createMenuBtn')?.classList.toggle('active', !!adding);
    $('addCountryBtn')?.classList.toggle('active', state?.tool === 'new-country');
    $('addLabelBtn')?.classList.toggle('active', !!state?.labelPlacementMode || state?.tool === 'label');
    $('addRiverBtn')?.classList.toggle('active', state?.tool === 'river');
    $('addLakeBtn')?.classList.toggle('active', state?.tool === 'lake');
    $('mobileEditBtn')?.classList.toggle('needs-attention', !!state?.selected && !surfaceState.editorOpen);
  }

  const mapWorkScheduler = (() => {
    let interactionActive = false;
    const jobs = new Map();
    function cancel(key) {
      const job = jobs.get(key);
      if (!job) return;
      clearTimeout(job.timer);
      if (job.idleId && typeof cancelIdleCallback === 'function') cancelIdleCallback(job.idleId);
      jobs.delete(key);
    }
    function scheduleIdle(key, task, delay = 0) {
      cancel(key);
      const job = { task, delay, timer: 0, idleId: 0 };
      const queue = () => {
        if (interactionActive) {
          job.timer = setTimeout(queue, 180);
          return;
        }
        const run = () => {
          if (jobs.get(key) !== job || interactionActive) return queue();
          jobs.delete(key);
          task();
        };
        if (typeof requestIdleCallback === 'function') job.idleId = requestIdleCallback(run, { timeout: 1800 });
        else job.timer = setTimeout(run, 0);
      };
      job.timer = setTimeout(queue, delay);
      jobs.set(key, job);
    }
    function setInteractionActive(active) {
      interactionActive = !!active;
    }
    return { scheduleIdle, cancel, setInteractionActive, isInteractionActive: () => interactionActive };
  })();

  const DEFAULT_LAYER_VISIBILITY = Object.freeze({
    countries: true,
    territories: true,
    administrative: true,
    regions: true,
    languages: true,
    ethnicities: true,
    religions: true,
    rivers: true,
    lakes: true,
    genericFeatures: true,
    labels: true,
    basemapLabels: true,
  });

  function normalizeLayerVisibility(value = {}, current = DEFAULT_LAYER_VISIBILITY) {
    const source = value && typeof value === 'object' ? value : {};
    const fallback = current && typeof current === 'object' ? current : DEFAULT_LAYER_VISIBILITY;
    const legacyHydroVisible = source.hydro !== false;
    return Object.fromEntries(Object.keys(DEFAULT_LAYER_VISIBILITY).map(key => {
      if (Object.hasOwn(source, key)) return [key, source[key] !== false];
      if ((key === 'rivers' || key === 'lakes') && Object.hasOwn(source, 'hydro')) return [key, legacyHydroVisible];
      return [key, fallback[key] !== false];
    }));
  }

  const state = {
    dataReadiness: DATA_READINESS.PREVIEW,
    geometryProgress: 0,
    meshProgress: 0,
    countriesData: null,
    auditPreviewCountries: null,
    countryVisualPhase: 'preview',
    countryIndex: new Map(),
    countryOverrides: {},
    sourceInfo: null,
    labels: [],
    labelSettings: {},
    genericFeatures: [],
    hydroEdits: [],
    territorialUnits: [],
    territorialRelations: [],
    distributionLayers: [],
    distributionEntries: [],
    distributionSettings: { renderMode: DISTRIBUTION_RENDER_MODES.DOMINANT, boundaryVisible: true },
    selectedDistributionLayerId: '',
    layerPresentation: normalizeLayerPresentation(),
    selected: null,
    addSelectionMode: false,
    projection: 'globe',
    layerVisibility: normalizeLayerVisibility(),
    physicalSettings: {
      terrainVisible: true,
      terrainStyle: 'political',
      terrainStrength: 0.32,
      hydroLayers: {
        rivers_hydro: true,
        lakes_natural_earth: true,
      },
      hiddenHydroIds: {},
      dataset: PHYSICAL_DATASET,
    },
    hydroCollections: {},
    hydroFeatureCache: new Map(),
    hydroFeatureByFid: new Map(),
    hydroFragmentsByLogicalId: new Map(),
    hydroManifest: null,
    terrainManifest: null,
    physicalLoadState: { terrain: 'idle', hydro: 'idle', hydroCache: 'idle', hydroCachePercent: 0 },
    itemVisibility: {
      countries: {},
      territories: {},
      administrative: {},
      regions: {},
      languages: {},
      ethnicities: {},
      religions: {},
      hydro: {},
      genericFeatures: {},
      labels: {},
      countryLabels: {},
    },
    layerFolders: {
      countries: false,
      territories: false,
      administrative: false,
      regions: false,
      languages: false,
      ethnicities: false,
      religions: false,
      terrain: false,
      hydro: false,
      genericFeatures: false,
      labels: false,
      countryLabels: false,
    },
    layerSearch: '',
    tool: 'select',
    labelPlacementMode: false,
    coastEditCountryId: null,
    coastEditScopeGenericFeatureId: null,
    coastEditReturnSelection: null,
    boundaryEditCountryIds: [],
    boundaryEditPhase: null,
    boundaryEditInitialSelection: null,
    boundaryEditSeedCountryId: null,
    mergeSourceCountryId: null,
    mergeTargetCountryIds: [],
    genericFeatureMergeSourceId: null,
    genericFeatureMergeTargetIds: [],
    genericFeatureSplitSourceId: null,
    distributionDraft: null,
    territorialUnitMergeSourceId: null,
    territorialUnitMergeTargetIds: [],
    territorialUnitSplitSourceId: null,
    territorialUnitSplitVirtualSource: null,
    territorialUnitRedrawSourceId: null,
    territorialCreateContext: null,
    annexTargetCountryId: null,
    annexDonorCountryIds: [],
    annexPhase: null,
    annexComponentIndex: null,
    annexCandidates: [],
    annexSelectedCandidateIndex: null,
    annexSelectedComponentKeys: [],
    annexSelectionMethod: 'line',
    annexUseRiverBoundaries: false,
    annexSourceGeometry: null,
    annexRiverPartitionStatus: 'idle',
    annexRiverPartitionCandidates: [],
    annexRiverPartitionDonorResults: [],
    annexHoveredComponentKey: null,
    newCountryPhase: null,
    newCountrySourceIds: [],
    newCountryCandidates: [],
    newCountrySelectedCandidateIndex: null,
    newCountrySelectedComponentKeys: [],
    newCountrySelectionMethod: 'line',
    newCountrySourceGeometry: null,
    boundaryTopology: { edges: new Map(), nodes: new Map() },
    sharedBoundaryTopology: { segments: new Map(), nodes: new Map() },
    spatialIndex: [],
    mapMoving: false,
    historyDirtyCountryIds: new Set(),
    pendingCountryRenderIds: new Set(),
    sessionBaseCountriesJson: null,
    geometryPreview: createGeometryPreviewState(),
    modeProcessing: false,
    modeTaskMinimized: false,
    audit: { status: 'idle', revision: 0, report: null, selectedIssueId: null },
    stateRevision: 0,
    transitionRevision: 0,
    spacePanActive: false,
    suppressNextMapClick: null,
    history: [],
    future: [],
    historyMeta: [],
    futureMeta: [],
    lastSavedAt: null,
    contentToken: 'content:0',
    view: {
      globeRotation: [-15, -25, 0],
      globeZoom: 1,
      flatCenter: [0, 20],
      flatZoom: 1,
    },
    size: { width: 1000, height: 700 },
    layerTreeRevision: 1,
  };

  const atomicMapStateController = createAtomicMapStateController({
    applySnapshot: snapshot => {
      if (snapshot.projection) state.projection = snapshot.projection;
      if (snapshot.view) state.view = clampViewZooms({ ...state.view, ...snapshot.view });
      state.transitionRevision = Number(snapshot.stateRevision || state.transitionRevision || 0);
    },
  });

  const saveState = createSaveStateController({ onChange: (...args) => projectUi.syncSaveStatus(...args) });

  let objectChooserCandidates = [];

  function countryObjectRef(id) {
    return normalizeObjectRef({ domain: 'territorial', type: TERRITORIAL_UNIT_TYPES.COUNTRY, id: String(id) });
  }

  function layerItemObjectRef(group, id) {
    const key = String(id);
    if (group === 'countries' || group === 'countryLabels') return normalizeObjectRef({ domain: 'territorial', type: TERRITORIAL_UNIT_TYPES.COUNTRY, id: key });
    if (group === 'territories' || group === 'administrative' || group === 'regions') {
      const fallback = group === 'administrative' ? TERRITORIAL_UNIT_TYPES.ADMIN : group === 'regions' ? TERRITORIAL_UNIT_TYPES.REGION : TERRITORIAL_UNIT_TYPES.TERRITORY;
      return normalizeObjectRef({ domain: 'territorial', type: territorialUnitById(key)?.properties?.unitType || fallback, id: key });
    }
    if (DISTRIBUTION_GROUP_TYPES[group]) return normalizeObjectRef({ domain: 'distribution', type: distributionLayerById(key)?.type || DISTRIBUTION_GROUP_TYPES[group], id: key });
    if (group === 'hydro' && hydroEditById(key)) return normalizeObjectRef({ domain: 'hydro', type: hydroEditById(key)?.properties?.category || 'river', id: key });
    if (group === 'genericFeatures') return normalizeObjectRef({ domain: 'generic', type: 'feature', id: key });
    if (group === 'labels') return normalizeObjectRef({ domain: 'label', type: state.labels.find(item => String(item.id) === key)?.kind || 'label', id: key });
    return null;
  }

  function objectRefExists(value) {
    const ref = normalizeObjectRef(value);
    if (!ref) return false;
    if (ref.domain === 'territorial') return ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY ? !!countryFeatureById(ref.id) : !!territorialUnitById(ref.id);
    if (ref.domain === 'distribution') return !!distributionLayerById(ref.id);
    if (ref.domain === 'generic') return state.genericFeatures.some(item => String(item.id) === ref.id);
    if (ref.domain === 'hydro') return !!hydroFeatureById(ref.id);
    if (ref.domain === 'label') return state.labels.some(item => String(item.id) === ref.id);
    return false;
  }

  function objectDisplayInfo(value) {
    const ref = normalizeObjectRef(value);
    if (!ref) return { name: '알 수 없는 객체', type: '' };
    if (ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY) {
      const feature = countryFeatureById(ref.id);
      return { name: feature ? countryName(feature) : ref.id, type: '국가', detail: feature?.properties?.name || '' };
    }
    if (ref.domain === 'territorial') {
      const feature = territorialUnitById(ref.id);
      const type = territorialTypeLabel(ref.type);
      const context = ref.type === TERRITORIAL_UNIT_TYPES.REGION ? '' : territorialUnitCountryName(feature);
      return { name: feature ? territorialUnitName(feature) : ref.id, type, detail: [context, ref.type === TERRITORIAL_UNIT_TYPES.ADMIN ? `${Number(feature?.properties?.adminLevel) || 1}급` : ''].filter(Boolean).join(' · ') };
    }
    if (ref.domain === 'distribution') {
      const layer = distributionLayerById(ref.id);
      return { name: layer?.name || ref.id, type: DISTRIBUTION_TYPE_LABELS[layer?.type || ref.type] || '분포', detail: `${distributionEntriesForLayer(state.distributionEntries, ref.id).length}개 분포` };
    }
    if (ref.domain === 'generic') {
      const feature = state.genericFeatures.find(item => String(item.id) === ref.id);
      return { name: feature ? genericFeatureName(feature) : ref.id, type: feature ? genericFeatureRoleLabel(feature) : '기타 객체', detail: '' };
    }
    if (ref.domain === 'hydro') {
      const feature = hydroFeatureById(ref.id);
      const category = hydroCategoryKey(feature?.properties?.category || ref.type);
      return { name: hydroEditorName(feature?.properties?.name, hydroFallbackName(category)), type: hydroCategoryLabel(category), detail: hydroSourceLabel(category, { builtin: !hydroEditById(ref.id) }) };
    }
    const label = state.labels.find(item => String(item.id) === ref.id);
    const labelKind = { capital: '수도', city: '도시', town: '마을', region: '지역명', mountain: '산', water: '수역', custom: '기타' };
    return { name: label?.name || ref.id, type: '지명', detail: labelKind[label?.kind] || '지명' };
  }


  function focusObjectRef(value, { announce = true } = {}) {
    const ref = normalizeObjectRef(value);
    if (!ref) return false;
    let feature = null;
    if (ref.domain === 'territorial') feature = ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY ? countryFeatureById(ref.id) : territorialUnitById(ref.id);
    else if (ref.domain === 'generic') feature = state.genericFeatures.find(item => String(item.id) === ref.id);
    else if (ref.domain === 'hydro') feature = hydroFeatureById(ref.id);
    else if (ref.domain === 'distribution') {
      const features = distributionEntriesForLayer(state.distributionEntries, ref.id).map(entry => {
        const geometry = entry.mode === DISTRIBUTION_MODES.TERRITORIAL ? territorialRepository.get(entry.territorialUnitId)?.geometry : entry.geometry;
        return geometry ? { type: 'Feature', properties: {}, geometry } : null;
      }).filter(Boolean);
      if (features.length) feature = { type: 'FeatureCollection', features };
    } else if (ref.domain === 'label') {
      const label = state.labels.find(item => String(item.id) === ref.id);
      if (label) {
        focusCoordinate(label.coordinates);
        if (announce) setActionStatus(`${label.name} 위치로 이동했습니다.`, 'success', 2200);
        return true;
      }
    }
    if (!feature?.geometry && feature?.type !== 'FeatureCollection') return false;
    const runtimeAnchor = ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY
      ? countryLabelAnchors.get(String(feature?.id || ''))
      : null;
    const preferredAnchor = validLabelAnchor(runtimeAnchor)
      ? runtimeAnchor
      : null;
    focusCountry(feature, { maxZoom: isMobile() ? 12 : 10, preferredAnchor });
    if (announce) setActionStatus(`${objectDisplayInfo(ref).name} 위치로 이동했습니다.`, 'success', 2200);
    return true;
  }

  function layerGroupForObjectRef(value) {
    const ref = normalizeObjectRef(value);
    if (!ref) return '';
    if (ref.domain === 'territorial') return ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY ? 'countries' : ref.type === TERRITORIAL_UNIT_TYPES.ADMIN ? 'administrative' : ref.type === TERRITORIAL_UNIT_TYPES.REGION ? 'regions' : 'territories';
    if (ref.domain === 'distribution') return DISTRIBUTION_TYPE_GROUPS[ref.type] || '';
    if (ref.domain === 'hydro' && hydroEditById(ref.id)) return 'hydro';
    if (ref.domain === 'generic') return 'genericFeatures';
    if (ref.domain === 'label') return 'labels';
    return '';
  }

  function objectBatchCapabilities(value) {
    const ref = normalizeObjectRef(value);
    if (!ref) return new Set();
    if (ref.domain === 'hydro' && !hydroEditById(ref.id)) return new Set();
    const values = new Set(['visible']);
    if (ref.domain === 'territorial') {
      values.add('color');
      values.add('lock');
      if (ref.type !== TERRITORIAL_UNIT_TYPES.COUNTRY && !territorialChildren(state.territorialUnits, ref.id).length) values.add('delete');
    } else if (ref.domain === 'distribution') {
      values.add('color'); values.add('lock'); values.add('delete');
    } else if (ref.domain === 'generic' || ref.domain === 'hydro') {
      values.add('color'); values.add('lock'); values.add('delete');
    } else if (ref.domain === 'label') values.add('delete');
    return values;
  }

  function commonBatchCapabilities(refs = selectionDomain.snapshot().selection.items) {
    if (!refs.length) return new Set();
    const common = objectBatchCapabilities(refs[0]);
    for (const ref of refs.slice(1)) for (const capability of [...common]) if (!objectBatchCapabilities(ref).has(capability)) common.delete(capability);
    if (refs.some(ref => ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY)
      && !refs.every(ref => ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) {
      common.delete('lock');
    }
    return common;
  }

  function isCountryLocked(id) {
    return state.countryOverrides?.[String(id)]?.locked === true;
  }

  function setCountryLockedState(id, locked) {
    const key = String(id || '');
    if (!key || !countryFeatureById(key)) return false;
    const override = { ...(state.countryOverrides[key] || {}) };
    if (locked) override.locked = true;
    else delete override.locked;
    if (Object.keys(override).length) state.countryOverrides[key] = override;
    else delete state.countryOverrides[key];
    return true;
  }

  function lockedCountryIds(ids = []) {
    return [...new Set(ids.map(String).filter(Boolean))].filter(isCountryLocked);
  }

  function requireCountriesUnlocked(ids, action = '편집') {
    const lockedIds = lockedCountryIds(ids);
    if (!lockedIds.length) return true;
    const names = lockedIds.slice(0, 3).map(id => countryFeatureById(id)).filter(Boolean).map(countryName);
    const suffix = lockedIds.length > names.length ? ` 외 ${lockedIds.length - names.length}개국` : '';
    setActionStatus(`${names.join(', ')}${suffix} 잠금을 해제한 뒤 ${action}할 수 있습니다.`, 'error', 3800);
    return false;
  }

  function objectRefLocked(value) {
    const ref = normalizeObjectRef(value);
    if (!ref) return false;
    if (ref.domain === 'territorial') return ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY ? isCountryLocked(ref.id) : territorialUnitById(ref.id)?.properties?.locked === true;
    if (ref.domain === 'distribution') return distributionLayerById(ref.id)?.locked === true;
    if (ref.domain === 'generic') return state.genericFeatures.find(item => String(item.id) === ref.id)?.properties?.locked === true;
    if (ref.domain === 'hydro') return hydroEditById(ref.id)?.properties?.locked === true;
    return false;
  }

  function objectRefVisible(value) {
    const ref = normalizeObjectRef(value);
    const group = layerGroupForObjectRef(ref);
    return !!(ref && group && isLayerItemVisible(group, ref.id));
  }

  function syncBatchBooleanInput(input, values, enabled) {
    if (!input) return;
    const activeCount = values.filter(Boolean).length;
    input.disabled = !enabled;
    input.checked = enabled && values.length > 0 && activeCount === values.length;
    input.indeterminate = enabled && activeCount > 0 && activeCount < values.length;
    input.setAttribute('aria-checked', input.indeterminate ? 'mixed' : String(input.checked));
    const option = input.closest('.multi-property-option');
    if (option) {
      if (enabled) delete option.dataset.tooltip;
      else option.dataset.tooltip = '선택한 모든 객체에 공통으로 적용할 수 없습니다.';
    }
  }

  function syncBatchActionAvailability(selection = selectionDomain.snapshot().selection) {
    const refs = selection.items || [];
    const capabilities = commonBatchCapabilities(refs);
    syncBatchBooleanInput($('multiPropertiesVisibilityInput'), refs.map(objectRefVisible), capabilities.has('visible'));
    if ($('multiPropertiesColorInput')) $('multiPropertiesColorInput').disabled = !capabilities.has('color');
    if ($('multiPropertiesColorTrigger')) $('multiPropertiesColorTrigger').disabled = !capabilities.has('color');
    const countryOnly = refs.length >= 2 && refs.every(ref => ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY);
    $('multiCountryActions')?.classList.toggle('hidden', !countryOnly);
    const borderButton = $('multiBorderEditBtn');
    const borderHelp = $('multiBorderEditHelp');
    if (countryOnly) {
      const analysis = boundaryEditSelectionAnalysis(refs.map(ref => ref.id));
      const lockedIds = refs.map(ref => ref.id).filter(isCountryLocked);
      if (borderButton) {
        borderButton.disabled = lockedIds.length > 0;
        borderButton.dataset.tooltip = lockedIds.length
          ? '잠긴 국가를 해제한 뒤 국경을 조정하세요.'
          : (analysis.message || '선택 후 공유국경을 확인합니다.');
      }
      if (borderHelp) {
        const message = lockedIds.length
          ? `잠긴 국가 ${lockedIds.length}개를 해제해야 국경을 조정할 수 있습니다.`
          : (analysis.message || '국경 조정 시작 시 공유국경을 확인합니다.');
        borderHelp.textContent = message;
        borderHelp.classList.toggle('hidden', !message);
      }
    } else {
      if (borderButton) {
        borderButton.disabled = true;
        delete borderButton.dataset.tooltip;
      }
      if (borderHelp) {
        borderHelp.textContent = '';
        borderHelp.classList.add('hidden');
      }
    }
    syncObjectActionsMenu();
  }

  function batchSetVisibility(nextVisible = null) {
    const refs = selectionDomain.snapshot().selection.items;
    if (!refs.length || !commonBatchCapabilities(refs).has('visible')) return;
    const allVisible = refs.every(ref => isLayerItemVisible(layerGroupForObjectRef(ref), ref.id));
    const visible = typeof nextVisible === 'boolean' ? nextVisible : !allVisible;
    if (refs.every(ref => objectRefVisible(ref) === visible)) return;
    for (const ref of refs) {
      const group = layerGroupForObjectRef(ref);
      if (!group) continue;
      state.itemVisibility[group] ||= {};
      if (visible) delete state.itemVisibility[group][ref.id];
      else state.itemVisibility[group][ref.id] = false;
    }
    if (refs.some(ref => ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) {
      gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'batch-country-visibility');
    }
    markLayerTreeDirty();
    renderingDomain?.invalidateBaseScene?.('batch-country-visibility');
    projectDomain.queuePresentationAutosave();
    syncBatchActionAvailability();
  }

  function batchSetLocked(nextLocked = null) {
    const refs = selectionDomain.snapshot().selection.items;
    if (!refs.length || !commonBatchCapabilities(refs).has('lock')) return;
    const locked = typeof nextLocked === 'boolean' ? nextLocked : !refs.every(objectRefLocked);
    if (refs.every(ref => objectRefLocked(ref) === locked)) return;
    projectDomain.recordHistory({ type: 'batch-lock', description: `${refs.length}개 객체 ${locked ? '잠금' : '잠금 해제'}`, affectedIds: refs.map(ref => ref.id) });
    for (const ref of refs) {
      if (ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY) setCountryLockedState(ref.id, locked);
      else if (ref.domain === 'territorial') territorialUnitById(ref.id).properties.locked = locked;
      else if (ref.domain === 'distribution') distributionLayerById(ref.id).locked = locked;
      else if (ref.domain === 'generic') {
        const feature = state.genericFeatures.find(item => String(item.id) === ref.id);
        if (feature) feature.properties.locked = locked;
      } else if (ref.domain === 'hydro') {
        const feature = hydroEditById(ref.id);
        if (feature) feature.properties.locked = locked;
      }
    }
    layerTreeController?.syncLocks(refs);
    renderingDomain?.invalidateSelection?.('batch-lock');
    projectDomain.queueAutosave();
    const primary = selectionDomain.primary();
    if (primary) selectionUiController.presentPrimary({ refreshOnly: true });
    syncBatchActionAvailability();
  }

  function batchToggleLocked() {
    return batchSetLocked();
  }

  let objectActionsMenuTrigger = null;

  function closeObjectActionsMenu({ restoreFocus = false } = {}) {
    const menu = $('objectActionsMenu');
    if (!menu) return;
    const wasOpen = !menu.classList.contains('hidden');
    const trigger = objectActionsMenuTrigger;
    menu.classList.add('hidden');
    menu.style.removeProperty('left');
    menu.style.removeProperty('top');
    trigger?.setAttribute('aria-expanded', 'false');
    objectActionsMenuTrigger = null;
    if (restoreFocus && wasOpen && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  function syncObjectActionsMenu() {
    const refs = selectionDomain.snapshot().selection.items;
    const primary = selectionDomain.primary();
    const capabilities = commonBatchCapabilities(refs);
    const locked = refs.length > 0 && refs.every(objectRefLocked);
    const canLock = refs.length > 0 && capabilities.has('lock');
    const canDelete = refs.length > 1
      ? capabilities.has('delete')
      : !!primary && (primary.domain !== 'hydro' || !!hydroEditById(primary.id));
    const deleteDisabled = !canDelete || !!(primary && objectRefLocked(primary));
    const lockLabel = locked ? '잠금 해제' : refs.length > 1 ? '모두 잠금' : '잠금';
    const status = $('editorObjectStatus');
    if (status) {
      const lockedCount = refs.filter(objectRefLocked).length;
      const statusText = refs.length > 1
        ? (lockedCount === refs.length ? '모두 잠김' : lockedCount ? '일부 잠김' : '')
        : (primary && objectRefLocked(primary) ? '잠김' : '');
      status.textContent = statusText;
      status.classList.toggle('hidden', !statusText);
    }
    const focusButton = $('focusSelectedObjectBtn');
    if (focusButton) focusButton.classList.toggle('hidden', refs.length !== 1 || !primary);
    const lockButton = $('objectLockBtn');
    if (lockButton) {
      lockButton.disabled = !canLock;
      lockButton.setAttribute('aria-pressed', String(locked));
      lockButton.setAttribute('aria-label', lockLabel);
      lockButton.dataset.tooltip = lockLabel;
      $('objectLockIcon')?.setAttribute('href', locked ? '#icon-lock-closed' : '#icon-lock-open');
    }
    const deleteButton = $('objectDeleteBtn');
    if (deleteButton) {
      deleteButton.disabled = deleteDisabled;
      deleteButton.dataset.tooltip = deleteDisabled && canDelete ? '잠금 해제 후 삭제' : '삭제';
      deleteButton.setAttribute('aria-label', deleteButton.dataset.tooltip);
    }
    const menuFocus = $('objectFocusMenuBtn');
    if (menuFocus) menuFocus.disabled = refs.length !== 1 || !primary;
  }

  function positionObjectActionsMenu(trigger) {
    const menu = $('objectActionsMenu');
    if (!menu || !trigger?.isConnected || menu.classList.contains('hidden')) return;
    const rootStyle = getComputedStyle(document.documentElement);
    const edge = Number.parseFloat(rootStyle.getPropertyValue('--ui-popover-screen-edge')) || 8;
    const gap = Number.parseFloat(rootStyle.getPropertyValue('--ui-space-1')) || 4;
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportRight = viewportLeft + (viewport?.width || window.innerWidth);
    const viewportBottom = viewportTop + (viewport?.height || window.innerHeight);
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const minLeft = viewportLeft + edge;
    const maxLeft = Math.max(minLeft, viewportRight - menuRect.width - edge);
    const left = clamp(triggerRect.right - menuRect.width, minLeft, maxLeft);
    const belowTop = triggerRect.bottom + gap;
    const aboveTop = triggerRect.top - gap - menuRect.height;
    const preferredTop = belowTop + menuRect.height <= viewportBottom - edge || aboveTop < viewportTop + edge
      ? belowTop
      : aboveTop;
    const minTop = viewportTop + edge;
    const maxTop = Math.max(minTop, viewportBottom - menuRect.height - edge);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(clamp(preferredTop, minTop, maxTop))}px`;
  }

  function openObjectActionsMenu(trigger) {
    const menu = $('objectActionsMenu');
    if (!menu || !trigger || !selectionDomain.primary()) return;
    const toggleClosed = objectActionsMenuTrigger === trigger && !menu.classList.contains('hidden');
    closeObjectActionsMenu();
    if (toggleClosed) return;
    syncObjectActionsMenu();
    objectActionsMenuTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    menu.classList.remove('hidden');
    positionObjectActionsMenu(trigger);
    requestAnimationFrame(() => menu.querySelector('[role="menuitem"]:not(.hidden):not(:disabled)')?.focus());
  }

  function deleteSelectedFromObjectMenu() {
    closeObjectActionsMenu();
    const primary = selectionDomain.primary();
    if (selectionDomain.size() > 1) requestBatchDelete();
    else if (primary?.domain === 'territorial' && primary.type === TERRITORIAL_UNIT_TYPES.COUNTRY) requestDeleteCountry(primary.id);
    else if (primary?.domain === 'territorial') requestTerritorialUnitDivisionRemoval(primary.id);
    else {
      if (!primary) return;
      const info = objectDisplayInfo(primary);
      openConfirmModal({
        title: `${info.type} 삭제`,
        message: `${info.name} 객체를 지도에서 삭제합니다. 실행취소로 복구할 수 있습니다.`,
        impacts: [`${info.type} 1개 삭제`, '연결된 표시·설정 정리'],
        confirmText: '삭제',
        danger: true,
        onConfirm: deleteSelected,
      });
    }
  }

  function batchSetColor(color) {
    const refs = selectionDomain.snapshot().selection.items;
    if (!refs.length || !commonBatchCapabilities(refs).has('color')) return;
    const normalizedColor = normalizeEditorColor(color, DEFAULT_GENERIC_FEATURE_COLOR);
    projectDomain.recordHistory({ type: 'batch-color', description: `${refs.length}개 객체 색상 변경`, affectedIds: refs.map(ref => ref.id) });
    for (const ref of refs) {
      if (ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY) {
        state.countryOverrides[ref.id] ||= {};
        writeDomainColor(COLOR_DOMAINS.COUNTRY, {
          feature: countryFeatureById(ref.id), override: state.countryOverrides[ref.id],
        }, normalizedColor, { fallback: defaultCountryColor() });
      } else if (ref.domain === 'territorial') {
        const feature = territorialUnitById(ref.id);
        if (feature) writeDomainColor(COLOR_DOMAINS.TERRITORIAL, { feature }, normalizedColor, { fallback: DEFAULT_GENERIC_FEATURE_COLOR });
      } else if (ref.domain === 'distribution') {
        const layer = distributionLayerById(ref.id);
        if (layer) writeDomainColor(COLOR_DOMAINS.DISTRIBUTION, { layer }, normalizedColor, { fallback: DEFAULT_GENERIC_FEATURE_COLOR });
      } else if (ref.domain === 'generic') {
        const feature = state.genericFeatures.find(item => String(item.id) === ref.id);
        if (feature) writeDomainColor(COLOR_DOMAINS.GENERIC, { feature }, normalizedColor, { fallback: defaultGenericFeatureColor(feature) });
      } else if (ref.domain === 'hydro') {
        const feature = hydroEditById(ref.id);
        if (feature) feature.properties.color = normalizedColor;
      }
    }
    if (refs.some(ref => ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) {
      gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'batch-country-color');
    }
    markLayerTreeDirty();
    renderingDomain?.invalidateBaseScene?.('batch-country-color');
    projectDomain.queueAutosave();
    syncBatchActionAvailability();
  }

  function requestBatchDelete() {
    const refs = selectionDomain.snapshot().selection.items;
    if (!refs.length || !commonBatchCapabilities(refs).has('delete')) return;
    const typeCounts = new Map();
    for (const ref of refs) {
      const type = objectDisplayInfo(ref).type;
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    }
    openConfirmModal({
      title: `${refs.length}개 객체 삭제`,
      message: '선택한 객체와 직접 연결된 데이터가 함께 삭제됩니다. 한 번의 실행취소로 복구할 수 있습니다.',
      impacts: [...typeCounts].map(([type, count]) => `${type} ${count}개 삭제`),
      confirmText: '선택 객체 삭제',
      danger: true,
      onConfirm: () => {
        projectDomain.recordHistory({ type: 'batch-delete', description: `${refs.length}개 객체 삭제`, affectedIds: refs.map(ref => ref.id) });
        const removedDistributionIds = new Set(refs.filter(ref => ref.domain === 'distribution').map(ref => ref.id));
        const removedHydroEditIds = new Set(refs.filter(ref => ref.domain === 'hydro').map(ref => ref.id));
        const removedGenericFeatureIds = new Set(refs.filter(ref => ref.domain === 'generic').map(ref => ref.id));
        const removedLabelIds = new Set(refs.filter(ref => ref.domain === 'label').map(ref => ref.id));
        const removedUnitIds = new Set(refs.filter(ref => ref.domain === 'territorial' && ref.type !== TERRITORIAL_UNIT_TYPES.COUNTRY).map(ref => ref.id));
        let expanded = true;
        while (expanded) {
          expanded = false;
          for (const feature of state.territorialUnits) {
            if (!removedUnitIds.has(String(feature.properties?.parentId)) || removedUnitIds.has(String(feature.id))) continue;
            removedUnitIds.add(String(feature.id));
            expanded = true;
          }
        }
        state.distributionLayers = state.distributionLayers.filter(layer => !removedDistributionIds.has(String(layer.id)));
        state.distributionEntries = state.distributionEntries.filter(entry => !removedDistributionIds.has(String(entry.layerId))
          && (entry.mode !== DISTRIBUTION_MODES.TERRITORIAL || !removedUnitIds.has(String(entry.territorialUnitId))));
        const restoredHydroSourceIds = state.hydroEdits.filter(feature => removedHydroEditIds.has(String(feature.id))).map(feature => String(feature.properties?.sourceFeatureId || '')).filter(Boolean);
        state.hydroEdits = state.hydroEdits.filter(feature => !removedHydroEditIds.has(String(feature.id)));
        for (const sourceId of restoredHydroSourceIds) {
          if (!state.hydroEdits.some(feature => String(feature.properties?.sourceFeatureId || '') === sourceId)) delete state.physicalSettings.hiddenHydroIds[sourceId];
        }
        if (restoredHydroSourceIds.length) gpuMapRenderer.invalidateHydroVisibility();
        for (const layer of state.distributionLayers) if (removedDistributionIds.has(String(layer.parentId))) layer.parentId = '';
        reassignGenericFeatureParents([...removedGenericFeatureIds]);
        state.genericFeatures = state.genericFeatures.filter(feature => !removedGenericFeatureIds.has(String(feature.id)));
        state.labels = state.labels.filter(label => !removedLabelIds.has(String(label.id)));
        for (const id of removedLabelIds) delete state.labelSettings[labelKey('label', id)];
        state.territorialUnits = state.territorialUnits.filter(feature => !removedUnitIds.has(String(feature.id)));
        state.territorialRelations = state.territorialRelations.filter(relation => !removedUnitIds.has(String(relation.unitId)) && !removedUnitIds.has(String(relation.parentId)));
        selectionDomain.clear({ reason: 'batch-delete-clear' });
        state.addSelectionMode = false;
        objectPropertyController?.show(null);
        markLayerTreeDirty();
        renderingDomain?.invalidateOverlayGeometry?.('batch', 'batch-delete');
        renderingDomain?.invalidateSelection?.('batch-delete');
        renderingDomain?.invalidateLabels?.('batch-delete');
        projectDomain.queueAutosave();
        setActionStatus(`${refs.length}개 객체를 삭제했습니다.`, 'success', 2800);
      },
    });
  }

  let baseSvg;
  let flatOceanLayer;
  let svg;
  let interactionSvg;
  let root;
  let shadowLayer;
  let oceanLayer;
  let graticuleLayer;
  let countryLayer;
  let previewLayer;
  let hoverLayer;
  let selectionLayer;
  let selectionPass = null;
  // Domain facades are initialized after all legacy services/functions have
  // been declared.  Keeping the references nullable lets early bootstrap
  // callbacks safely report invalidation while the migration is in flight.
  let projectDomain = null;
  let selectionDomain = null;
  let renderingDomain = null;
  let gisDomain = null;
  let editingDomain = null;
  let selectionUiController = null;
  let countryPropertyController = null;
  let objectPropertyController = null;
  let layerTreeController = null;
  const emptyDraftSession = Object.freeze({
    coords: Object.freeze([]), hover: null, inputPhase: 'draw', selectedVertexIndex: null,
    insertTarget: null, dragging: false, issues: Object.freeze([]), historyCount: 0,
    futureCount: 0, strokeActive: false, cutAssessment: null, activeSnap: null,
  });
  const editingDraftSnapshot = () => editingDomain?.snapshot?.().draft || emptyDraftSession;
  const editingDraftCoordinates = () => editingDraftSnapshot().coords;
  const dispatchEditingInteraction = (type, detail = {}) => {
    const currentPacket = editingDomain?.createRenderPacket?.();
    if (!currentPacket) return false;
    return editingDomain.handleInteraction({
      type,
      projectGeneration: currentPacket.projectGeneration,
      packetRevision: currentPacket.revision,
      ...detail,
    });
  };
  const renderQualityController = createAdaptiveRenderQualityController({
    mobile: isMobile(),
    deviceMemory: navigator.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
    saveData: navigator.connection?.saveData === true,
  });
  let currentRenderQuality = renderQualityController.profile();
  let renderQualityApplyQueued = false;
  const renderSceneBuilder = createRenderSceneBuilder({
    triangulate: (...args) => window.earcut(...args),
    cacheByteBudget: currentRenderQuality.renderPacketCacheBudgetBytes,
  });
  const interactionSceneBuilder = createRenderSceneBuilder({ triangulate: (...args) => window.earcut(...args), cacheLimit: 256 });
  const editPreviewController = createEditPreviewController();
  const editPipelineMetrics = {
    commitCount: 0,
    rollbackCount: 0,
    lastCommitMs: 0,
    lastCommitDomain: '',
    commitP95Ms: 0,
    commitP99Ms: 0,
  };
  const gpuSceneDomains = new Map();
  const gpuSceneDirtyDomains = new Set();
  const gpuSceneBuiltDomainKeys = new Map();
  let currentRenderScene = null;
  let renderSceneRevision = 0;
  let renderSceneGeometryRevision = 0;
  let renderSceneStyleRevision = 0;
  let renderSceneOrderRevision = 0;
  let currentSelectionPacket = null;
  let currentGpuInteractionFillItems = [];
  let currentGpuPreviewPackets = [];
  let currentGpuEditPreviewPackets = [];
  let currentGpuDraftPackets = [];
  let gpuInteractionPacketRevision = 0;
  const gpuInteractionPacketSignatures = { preview: '', draft: '' };
  const gpuSceneResourceObjectKeys = new Map();
  let validationLayer;
  let snapLayer;
  let boundaryEditLayer;
  let overlayStackLayer;
  let territorialBoundaryLayer;
  let territorialOperationLayer;
  let territorialUnitLayer;
  let distributionLayer;
  let genericFeatureLayer;
  let hydroLakeLayer;
  let hydroRiverLayer;
  let hydroEditLayer;
  let countryLabelLayer;
  let labelLayer;
  let vertexLayer;
  let draftLayer;
  let mapInteractionLayer;
  const boundarySelectionAnalysisCache = new Map();
  const boundarySelectionAnalysisMetrics = { builds: 0, cacheHits: 0, cacheMisses: 0, buildMs: 0 };
  // Territorial units are still mutated by a few import/edit paths that use
  // push() or replace a geometry without going through the repository's
  // revision setter.  Keep a session-only identity token for each geometry so
  // the internal-boundary cache cannot reuse a batch from the previous unit
  // collection after those in-place mutations.
  const territorialBoundaryGeometryTokens = new WeakMap();
  let territorialBoundaryGeometryTokenSequence = 0;
  let mapResizeObserver = null;
  let mapResizeFrame = 0;
  let mapResizeSignature = '';
  const mapResizeReasons = new Set();
  let mapLayoutMetricsSnapshot = null;
  let mapLayoutMetricsRefreshCount = 0;
  let resolutionQuery = null;
  let viewRevision = 0;
  let visualProjectionRevision = 0;
  let lastVisualProjectionKind = '';
  let renderedViewSignature = '';
  let editInteractionRevision = 0;
  let mapInputController = null;
  let mapHost = null;
  let mapHostReadyPromise = Promise.resolve(false);
  const mapInteractionGate = createMapInteractionGate();
  let geometryBoundsCache = new WeakMap();
  let countryOutlineCache = new WeakMap();
  let genericFeatureLandClipCache = new WeakMap();
  const mapObjectSpatialIndex = createMapObjectSpatialIndex();
  const mapObjectDistributionRowCache = new Map();
  const mapObjectSpatialIndexSources = new Map();
  const mapObjectGeometryRevisions = { label: 0, generic: 0, territorial: 0, hydro: 0 };
  let distributionVisibilityRevision = 0;
  let distributionRenderRowCache = {
    layers: null,
    entries: null,
    countries: null,
    countryGeometryRevision: -1,
    territorialUnits: null,
    renderMode: '',
    selectedLayerId: '',
    visibilityRevision: -1,
    rows: [],
    rebuildCount: 0,
    buildMs: 0,
  };
  let labelLayoutMetrics = {};
  const viewportCullingMetrics = {
    queryCount: 0,
    candidateCount: 0,
    finalVisibleCount: 0,
    projectedVerificationCount: 0,
    projectedVerificationMs: 0,
    lastByDomain: {},
  };
  const selectionPerformanceMetrics = {
    inputToPresentMs: 0,
    handlerMs: 0,
    transactionMs: 0,
    controllerMs: 0,
    summaryMs: 0,
    selectionUiSyncCount: 0,
    selectionUiCoalescedCount: 0,
    boundaryAnalysisBuildCount: 0,
    boundaryAnalysisCacheHitCount: 0,
    boundaryAnalysisCacheMissCount: 0,
    boundaryAnalysisMs: 0,
    selectionCountryBatchCount: 0,
    selectionGenericBatchCount: 0,
    selectionStrokeDrawCallCount: 0,
    propertyPanelMs: 0,
    propertyFieldsMs: 0,
    editorOpenMs: 0,
    indexQueryMs: 0,
    indexedCandidateCount: 0,
    exactHitTestCount: 0,
    fullScanCount: 0,
    gpuPickMs: 0,
    pickCacheHit: false,
    direct: false,
  };
  const selectionPerformanceBaseline = createSelectionPerformanceBaseline({ mobile: isMobile() });
  const selectionPerfEnabled = new URLSearchParams(location.search).has('perf');
  let selectionLongTaskCount = 0;
  if (selectionPerfEnabled && typeof globalThis.PerformanceObserver === 'function') {
    try {
      const observer = new globalThis.PerformanceObserver(list => {
        selectionLongTaskCount += list.getEntries().filter(entry => entry.duration >= 50).length;
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch (_) {}
  }

  function selectionPerformanceCounterSnapshot() {
    if (!selectionPerfEnabled) return null;
    const gpu = gpuMapRenderer?.getStats?.() || {};
    const selectionGpu = selectionPass?.stats?.() || {};
    const render = renderingDomain?.getStats?.() || {};
    return {
      selectionBufferBuildCount: Number(selectionGpu.bufferBuildCount || 0),
      selectionUploadBytes: Number(selectionGpu.bufferUploadBytes || 0),
      selectionDrawCount: Number(selectionGpu.viewDrawCount || 0),
      mainDrawCount: Number(render.fullRenderCount || 0) + Number(render.viewRenderCount || 0),
      hydroUploadBytes: Number(gpu.hydroUploadBytes || 0),
      longTaskCount: selectionLongTaskCount,
    };
  }

  function publishSelectionPerformanceSample(inputStartedAt, before, scenario = 'selection') {
    selectionPerformanceMetrics.inputToPresentMs = performance.now() - inputStartedAt;
    if (!selectionPerfEnabled) return;
    const after = selectionPerformanceCounterSnapshot();
    const gpu = gpuMapRenderer?.getStats?.() || {};
    const selectionGpu = selectionPass?.stats?.() || {};
    selectionPerformanceBaseline.record({
      scenario,
      inputToPresentMs: selectionPerformanceMetrics.inputToPresentMs,
      baselineInputToPresentMs: selectionPerformanceMetrics.inputToPresentMs,
      handlerMs: selectionPerformanceMetrics.handlerMs,
      mainGpuFrameMs: Number(gpu.p95CpuSubmitMs || 0),
      selectionGpuDrawMs: Number(selectionGpu.lastDrawMs || 0),
      selectionBufferRebuilds: after.selectionBufferBuildCount - before.selectionBufferBuildCount,
      selectionUploadBytes: after.selectionUploadBytes - before.selectionUploadBytes,
      mainDrawCount: after.mainDrawCount - before.mainDrawCount,
      selectionDrawCount: after.selectionDrawCount - before.selectionDrawCount,
      svgFallbackCount: Number(renderingDomain?.getSelectionRenderStats?.().fallbackCount || 0),
      longTaskCount: after.longTaskCount - before.longTaskCount,
      worldMeshUploadCount: 0,
      hydroUploadBytes: after.hydroUploadBytes - before.hydroUploadBytes,
      activeCanvasCount: gpuMapRenderer?.getRenderDevice?.() ? 1 : 0,
      activeContextCount: Number(gpuMapRenderer?.getRuntimeState?.()?.activeWebGlContextCount || 0),
    });
  }
  let countryLandRevision = 0;
  const pendingCountryLabelAnchors = new Set();
  const countryLabelAnchorVersions = new Map();
  const countryLabelAnchors = new Map();
  const countryLabelScreenAreas = new Map();
  let countryDisplaySource = null;
  let countryDisplayIndex = new Map();
  let hoverPickFrame = 0;
  let pendingHoverPick = null;
  let lastHoverPickPoint = null;
  let lastHoverPickViewRevision = -1;
  let lastHoverHit = null;
  let countryLabelAnchorWorker = null;
  let countryLabelAnchorTimer = 0;
  let countryLabelAnchorRequestId = 0;
  let countryLabelAnchorFlight = null;
  let geometryValidationWorker = null;
  let geometryValidationRequestId = 0;
  let riverPartitionGeneration = 0;
  const riverPartitionCache = new Map();
  let activeGeometryPreviewApply = null;
  let activeGeometryPreviewDiscard = null;
  let snapCandidateCache = { key: '', candidates: [] };

  const globeProjection = d3.geo.orthographic().clipAngle(90).precision(isMobile() ? 0.9 : 0.35);
  const flatProjection = d3.geo.equirectangular().precision(isMobile() ? 0.7 : 0.25);
  const path = d3.geo.path().pointRadius(5);
  const graticule = d3.geo.graticule();



  const gpuMapRenderer = createGpuMapRenderer({
    APP_VERSION,
    ASSET_REVISION,
    DATA_REVISION,
    PHYSICAL_DATA_BASE_URL,
    activeProjection,
    countryColor,
    countryFeatureById,
    countryOutlineFeature,
    d3,
    deepClone,
    defaultCountryColor,
    flatProjection,
    getSystemTheme: () => document.documentElement.dataset.theme || window.__PANDOLAB_THEME__ || systemTheme,
    globeProjection,
    hydroDisplayColor,
    hydroFeatureById,
    hydroVisibilityThreshold,
    isCountryVisibleById,
    isHydroFeatureVisible,
    isLayerItemVisible,
    isMobile,
    isSafeKoreanErrorMessage,
    mapTheme,
    mapWorkScheduler,
    prepareHydroFeature,
    queueMapResize,
    renderPendingCountryOverlays,
    renderViewFrame: () => renderingDomain?.invalidateView?.('render-view') || false,
    reportOperationError,
    rendererUi: {
      createCanvas: () => document.createElement('canvas'),
      getMapElement: () => $('map'),
      setEngineStatus: text => {
        (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = text;
      },
      onContextStateChange: phase => renderingDomain?.invalidateGpuContext?.(phase) || false,
      requestHostRepaint: reason => mapHost?.requestRepaint?.(reason) || false,
    },
    runtimeAssetUrl,
    scheduleGpuFrame: reason => renderingDomain?.invalidateGpuFrame?.(reason) || false,
    scheduleGpuInteractionFrame: reason => renderingDomain?.invalidateGpuInteraction?.(reason) || false,
    scheduleGpuMeshRebuild,
    setActionStatus,
    state,
  });
  gpuMapRenderer.setRenderQuality?.(currentRenderQuality);

  function applyAdaptiveRenderQuality({ refreshScene = false, reason = 'adaptive-render-quality' } = {}) {
    currentRenderQuality = renderQualityController.profile();
    const gpuQuality = gpuMapRenderer.getRuntimeState?.() || {};
    if (gpuQuality.canonicalMeshReady) {
      // Background LOD is allowed to be coarse only while the initial
      // preview is visible.  After canonical promotion, interaction may
      // throttle work but must not replace visible geometry with preview LOD.
      currentRenderQuality = Object.freeze({
        ...currentRenderQuality,
        backgroundLod: 'high',
        countryMeshQuality: 'canonical',
        terrainResolutionScale: 1,
      });
    }
    renderSceneBuilder.setCacheByteBudget(currentRenderQuality.renderPacketCacheBudgetBytes);
    gpuMapRenderer.setRenderQuality?.(currentRenderQuality);
    mapHost?.setRenderPixelRatio?.(Math.min(
      currentMapDevicePixelRatio(),
      Math.max(1, Number(currentRenderQuality.dprCap || 1)),
    ));
    if (refreshScene) renderingDomain?.invalidateQuality?.(reason);
    return currentRenderQuality;
  }

  function queueAdaptiveRenderQualityRefresh(reason = 'adaptive-render-quality') {
    if (renderQualityApplyQueued) return;
    renderQualityApplyQueued = true;
    mapWorkScheduler.scheduleIdle('adaptive-render-quality', () => {
      renderQualityApplyQueued = false;
      applyAdaptiveRenderQuality({ refreshScene: true, reason });
    }, 80);
  }

  function syncResolvedInteractionStyle({ redraw = false } = {}) {
    resolvedInteractionStyle = resolveCurrentInteractionStyle();
    setSelectionInteractionStyle(resolvedInteractionStyle);
    selectionPass?.updateStyle?.(resolvedInteractionStyle);
    gpuMapRenderer.setInteractionStyle?.(resolvedInteractionStyle);
    document.documentElement.style.setProperty('--map-selection-halo', resolvedInteractionStyle.selection.color);
    window.__PANDOLAB_INTERACTION_STYLE__ = resolvedInteractionStyle;
    if (redraw) {
      renderingDomain?.invalidateSelectionStyle?.('selection-style');
    }
    return resolvedInteractionStyle;
  }

  let gpuRebuildTimer = null;
  function scheduleGpuMeshRebuild(delay = 80) {
    clearTimeout(gpuRebuildTimer);
    gpuRebuildTimer = setTimeout(() => {
      mapEditClient.rebase(state.countriesData?.features || []);
      gpuMapRenderer.rebuildFromCountries(state.countriesData?.features || []);
    }, delay);
  }

  function cpuCountryAtCoordinate(coord) {
    if (!coord) return null;
    const candidates = state.spatialIndex || [];
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const item = candidates[i];
      const b = item.bounds;
      if (coord[0] < b[0] || coord[0] > b[2] || coord[1] < b[1] || coord[1] > b[3]) continue;
      const feature = item.feature;
      if (!isLayerItemVisible('countries', feature?.id || '')) continue;
      if (pointInCountryFeature(coord, feature)) return feature;
    }
    return null;
  }

  function countryAtScreenPoint(screenPoint, coord, { verify = true } = {}) {
    // Bounds from the spatial index already narrow the CPU test. Rebuilding a
    // full-resolution GPU ID framebuffer after every camera change made the
    // first hover/click stall while still requiring CPU geometry verification.
    void screenPoint;
    void verify;
    return cpuCountryAtCoordinate(coord);
  }

  function cancelCountryHoverPick({ clear = false } = {}) {
    if (hoverPickFrame) clearTimeout(hoverPickFrame);
    hoverPickFrame = 0;
    pendingHoverPick = null;
    lastHoverPickPoint = null;
    lastHoverPickViewRevision = -1;
    if (clear && selectionDomain.snapshot().hover) {
      lastHoverHit = null;
      selectionDomain.setHover(null);
    }
  }

  function queueCountryHoverPick(screenPoint, coord) {
    if (!screenPoint || !coord || state.mapMoving || editingDraftSnapshot().dragging || state.tool !== 'select') return;
    if (lastHoverPickPoint && Math.hypot(screenPoint[0] - lastHoverPickPoint[0], screenPoint[1] - lastHoverPickPoint[1]) < 3) return;
    pendingHoverPick = { screenPoint: [...screenPoint], coord: [...coord] };
    if (hoverPickFrame) return;
    hoverPickFrame = setTimeout(() => {
      hoverPickFrame = 0;
      const pending = pendingHoverPick;
      pendingHoverPick = null;
      if (!pending || state.mapMoving || editingDraftSnapshot().dragging || state.tool !== 'select') return;
      lastHoverPickPoint = pending.screenPoint;
      lastHoverPickViewRevision = viewRevision;
      const hoveredCountry = state.layerVisibility.countries
        ? countryAtScreenPoint(pending.screenPoint, pending.coord, { verify: false })
        : null;
      const nextId = hoveredCountry ? String(hoveredCountry?.id || '') : '';
      const nextRef = hoveredCountry ? countryObjectRef(nextId) : null;
      if ((selectionDomain.snapshot().hover?.key || '') === (nextRef?.key || '')) return;
      lastHoverHit = hoveredCountry ? { ref: nextRef, feature: hoveredCountry } : null;
      selectionDomain.setHover(nextRef);
    }, 50);
  }

  function hydroLineParts(geometry) {
    if (geometry?.type === 'LineString') return [geometry.coordinates || []];
    if (geometry?.type === 'MultiLineString') return geometry.coordinates || [];
    return [];
  }

  async function hydroAtScreenPoint(screenPoint, coord) {
    const hydroCategoryVisible = state.layerVisibility.rivers || state.layerVisibility.lakes;
    if (!hydroCategoryVisible || state.tool !== 'select') return null;
    for (const feature of [...state.hydroEdits].reverse()) {
      if (!isHydroFeatureVisible(feature) || !geometryHitsScreenPoint(feature.geometry, coord, screenPoint, isMobile() ? 14 : 8)) continue;
      return feature;
    }
    const picked = gpuMapRenderer.pickHydro(screenPoint) || await gpuMapRenderer.pickHydroAsync(screenPoint);
    if (picked && isHydroFeatureVisible(picked) && hydroFeatureInView(picked)) return picked;
    const projection = activeProjection();
    const toleranceDegrees = 9 / Math.max(1, projection.scale()) * 180 / Math.PI;
    let nearest = null;
    for (const feature of allBuiltInHydroFeatures()) {
      if (!feature.geometry) continue;
      if (!hydroFeatureInView(feature)) continue;
      const bounds = feature.__awBounds || [-180, -90, 180, 90];
      const category = feature.properties?.category;
      if (category === 'lake') {
        if (coord[0] >= bounds[0] && coord[0] <= bounds[2] && coord[1] >= bounds[1] && coord[1] <= bounds[3] && pointInCountryFeature(coord, feature)) return feature;
        continue;
      }
      if (coord[1] < bounds[1] - toleranceDegrees || coord[1] > bounds[3] + toleranceDegrees) continue;
      for (const line of hydroLineParts(feature.geometry)) {
        for (let index = 0; index < line.length - 1; index += 1) {
          if (!isCoordVisible(line[index]) && !isCoordVisible(line[index + 1])) continue;
          const a = projection(line[index]);
          const b = projection(line[index + 1]);
          if (!a || !b || Math.hypot(b[0] - a[0], b[1] - a[1]) > state.size.width * 0.7) continue;
          const vx = b[0] - a[0], vy = b[1] - a[1];
          const length2 = vx * vx + vy * vy;
          const t = length2 ? clamp(((screenPoint[0] - a[0]) * vx + (screenPoint[1] - a[1]) * vy) / length2, 0, 1) : 0;
          const distance = Math.hypot(screenPoint[0] - (a[0] + vx * t), screenPoint[1] - (a[1] + vy * t));
          if (distance <= 7 && (!nearest || distance < nearest.distance)) nearest = { feature, distance };
        }
      }
    }
    return nearest?.feature || null;
  }


  function mapNavigationEnabled() {
    return !state.labelPlacementMode
      && (editingDomain?.draftInputActive?.() || ['select', 'move', 'country-border', 'country-coast', 'merge-country', 'merge-generic-feature', 'new-country', 'annex-territory'].includes(state.tool));
  }

  function featureNearCoordinate(feature, coordinate, margin) {
    if (!feature?.geometry) return false;
    const bounds = geometryBounds(feature.geometry);
    return coordinate[0] >= bounds[0] - margin && coordinate[0] <= bounds[2] + margin
      && coordinate[1] >= bounds[1] - margin && coordinate[1] <= bounds[3] + margin;
  }

  function activeSnapOwnerIds() {
    if (state.tool === 'country-border') return state.boundaryEditCountryIds.map(String);
    if (state.coastEditCountryId) return [String(state.coastEditCountryId)];
    if ((state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) return [String(state.selected.id)];
    if ((state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY)) return [String(state.selected.id)];
    if (state.selected?.domain === 'generic') return [String(state.selected.id)];
    if (state.selected?.domain === 'hydro' && hydroEditById(state.selected.id)) return [String(state.selected.id)];
    return [];
  }

  function appendLocalGeometryCandidates(output, geometry, coordinate, margin, {
    ownerId = '', segmentKind = 'edge', maxCandidates = 1800,
  } = {}) {
    const ownerIds = ownerId ? [String(ownerId)] : [];
    const nodeKeys = new Set(output.filter(candidate => candidate.nodeKey).map(candidate => candidate.nodeKey));
    geometryPolygonSets(geometry).forEach((polygon, polygonIndex) => {
      (polygon || []).forEach((ring, ringIndex) => {
        const count = Math.max(0, (ring?.length || 0) - 1);
        for (let segmentIndex = 0; segmentIndex < count && output.length < maxCandidates; segmentIndex += 1) {
          const a = ring[segmentIndex];
          const b = ring[segmentIndex + 1];
          if (Math.max(a[0], b[0]) < coordinate[0] - margin || Math.min(a[0], b[0]) > coordinate[0] + margin
            || Math.max(a[1], b[1]) < coordinate[1] - margin || Math.min(a[1], b[1]) > coordinate[1] + margin) continue;
          for (const vertex of [a, b]) {
            const nodeKey = coordKey(vertex);
            if (nodeKeys.has(nodeKey)) continue;
            nodeKeys.add(nodeKey);
            output.push({ kind: 'vertex', coordinate: vertex, ownerIds, nodeKey });
          }
          output.push({
            kind: segmentKind,
            a, b, ownerIds,
            segmentKey: `${ownerId || 'geometry'}:${polygonIndex}:${ringIndex}:${segmentIndex}`,
          });
        }
      });
    });
    return output;
  }

  function localSnapCandidates(coordinate) {
    if (!coordinate) return [];
    const projectionScale = Math.max(1, activeProjection().scale());
    const margin = clamp(26 * 180 / (Math.PI * projectionScale), 0.03, 4);
    const tileSize = margin;
    const cacheKey = [
      state.stateRevision, countryLandRevision, state.tool, state.selected?.type || '', state.selected?.id || '', state.boundaryEditCountryIds.join('|'),
      state.territorialUnits.length, state.genericFeatures.length, state.hydroEdits.length, margin.toFixed(4),
      Math.floor(coordinate[0] / tileSize), Math.floor(coordinate[1] / tileSize),
    ].join(':');
    if (snapCandidateCache.key === cacheKey) return snapCandidateCache.candidates;
    const bounds = [coordinate[0] - margin, coordinate[1] - margin, coordinate[0] + margin, coordinate[1] + margin];
    const countryFeatures = spatialFeatures(bounds);
    const nearbyUnits = state.territorialUnits.filter(feature => featureNearCoordinate(feature, coordinate, margin)).slice(0, 32);
    const nearbyGenericFeatures = state.genericFeatures.filter(feature => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)
      && featureNearCoordinate(feature, coordinate, margin)).slice(0, 24);
    const activeOwners = new Set(activeSnapOwnerIds());
    const candidates = [];
    for (const feature of [...countryFeatures, ...nearbyUnits, ...nearbyGenericFeatures]) {
      const ownerId = String(feature?.id || '');
      const segmentKind = activeOwners.size && !activeOwners.has(ownerId) ? 'neighbor' : 'edge';
      appendLocalGeometryCandidates(candidates, feature.geometry, coordinate, margin * 2, { ownerId, segmentKind });
      if (candidates.length >= 1800) break;
    }
    const sourceGeometry = activeCutDraftSourceGeometry();
    if (sourceGeometry) appendLocalGeometryCandidates(candidates, sourceGeometry, coordinate, margin * 2, {
      ownerId: activeSnapOwnerIds()[0] || 'source', segmentKind: 'boundary', maxCandidates: 2200,
    });
    const segments = candidates.filter(candidate => candidate.a && candidate.b).slice(0, 80);
    for (let left = 0; left < segments.length; left += 1) {
      for (let right = left + 1; right < segments.length; right += 1) {
        if (segments[left].segmentKey === segments[right].segmentKey) continue;
        const intersection = segmentIntersectionDetail(segments[left].a, segments[left].b, segments[right].a, segments[right].b);
        if (!intersection || intersection.overlap || intersection.lineT <= 1e-7 || intersection.lineT >= 1 - 1e-7
          || intersection.boundaryT <= 1e-7 || intersection.boundaryT >= 1 - 1e-7) continue;
        candidates.push({ kind: 'intersection', coordinate: intersection.coord, ownerIds: [...new Set([...(segments[left].ownerIds || []), ...(segments[right].ownerIds || [])])] });
        if (candidates.length >= 240) {
          snapCandidateCache = { key: cacheKey, candidates };
          return candidates;
        }
      }
    }
    snapCandidateCache = { key: cacheKey, candidates };
    return candidates;
  }

  function mapClickBlocked(event = d3.event) {
    if (event?.defaultPrevented) {
      event.stopPropagation?.();
      return true;
    }
    const suppression = state.suppressNextMapClick;
    if (!suppression) return false;
    const eventPoint = Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)
      ? [event.clientX, event.clientY]
      : null;
    if (suppression.point && eventPoint && Math.hypot(eventPoint[0] - suppression.point[0], eventPoint[1] - suppression.point[1]) > 18) {
      return false;
    }
    state.suppressNextMapClick = null;
    clearTimeout(suppressNextMapClick._timer);
    event?.preventDefault?.();
    event?.stopPropagation?.();
    return true;
  }

  function suppressNextMapClick(point = null, timeout = 450) {
    state.suppressNextMapClick = {
      point: Array.isArray(point) ? [Number(point[0]), Number(point[1])] : null,
    };
    clearTimeout(suppressNextMapClick._timer);
    suppressNextMapClick._timer = setTimeout(() => {
      state.suppressNextMapClick = null;
    }, timeout);
  }

  function invalidateEditInteraction() {
    editInteractionRevision += 1;
    mapInputController?.cancel();
    state.mapMoving = false;
    $('map')?.classList.remove('dragging');
  }

  function dragLegacyMapViewBy(dx, dy) {
    const [dragX, dragY] = normalizeMapSurfaceDragDelta(dx, dy);
    if (dragX === 0 && dragY === 0) return false;
    if (state.projection === 'globe') {
      const sensitivity = 0.22 / Math.max(0.75, Math.sqrt(state.view.globeZoom));
      state.view.globeRotation[0] += dragX * sensitivity;
      state.view.globeRotation[1] -= dragY * sensitivity;
      state.view.globeRotation[1] = clamp(state.view.globeRotation[1], -89, 89);
      return true;
    }
    const scale = flatProjection.scale();
    state.view.flatCenter[0] -= dragX * 180 / (Math.PI * scale);
    state.view.flatCenter[1] += dragY * 180 / (Math.PI * scale);
    state.view.flatCenter[1] = clamp(state.view.flatCenter[1], -FLAT_LATITUDE_LIMIT, FLAT_LATITUDE_LIMIT);
    state.view.flatCenter[0] = ((state.view.flatCenter[0] + 540) % 360) - 180;
    return true;
  }

  function dragMapBy(dx, dy) {
    if (mapHost?.isReady?.() && typeof mapHost.dragBy === 'function') {
      return mapHost.dragBy(dx, dy, { animate: false });
    }
    return dragLegacyMapViewBy(dx, dy);
  }

  function wrappedLongitudeDelta(value) {
    return ((Number(value || 0) + 540) % 360) - 180;
  }

  function setMapZoomValue(value) {
    if (state.projection === 'globe') {
      const next = clamp(Number(value || state.view.globeZoom), ZOOM_LIMITS.globe.min, ZOOM_LIMITS.globe.max);
      const changed = Math.abs(next - state.view.globeZoom) > 1e-9;
      state.view.globeZoom = next;
      return changed;
    }
    const next = clamp(Number(value || state.view.flatZoom), ZOOM_LIMITS.flat.min, ZOOM_LIMITS.flat.max);
    const changed = Math.abs(next - state.view.flatZoom) > 1e-9;
    state.view.flatZoom = next;
    return changed;
  }

  function alignGeographicAnchor(coordinate, screenPoint) {
    if (!coordinate || !screenPoint) return false;
    if (state.projection === 'flat') {
      const layout = projectionLayoutMetrics();
      const nextCenter = equirectangularCenterForAnchor({
        coordinate,
        screenPoint,
        translate: [layout.centerX, layout.centerY],
        scale: layout.flatBaseScale * state.view.flatZoom,
        latitudeLimit: FLAT_LATITUDE_LIMIT,
      });
      if (!nextCenter) return false;
      const changed = Math.abs(wrappedLongitudeDelta(nextCenter[0] - state.view.flatCenter[0])) > 1e-9
        || Math.abs(nextCenter[1] - state.view.flatCenter[1]) > 1e-9;
      if (changed) state.view.flatCenter = nextCenter;
      updateProjection();
      return changed;
    }

    let changed = false;
    // Orthographic projection needs a bounded correction because longitude
    // and latitude are coupled near the horizon. Flat equirectangular view
    // alignment above is exact and never enters this iterative path.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      updateProjection();
      const projected = activeProjection()(coordinate);
      if (projected && Math.hypot(projected[0] - screenPoint[0], projected[1] - screenPoint[1]) < 0.1) break;
      const targetCoordinate = screenToGeo(screenPoint);
      if (!targetCoordinate) return changed;
      const longitudeDelta = wrappedLongitudeDelta(coordinate[0] - targetCoordinate[0]);
      const latitudeDelta = Number(coordinate[1]) - Number(targetCoordinate[1]);
      if (Math.abs(longitudeDelta) < 1e-7 && Math.abs(latitudeDelta) < 1e-7) break;
      state.view.globeRotation[0] -= longitudeDelta;
      state.view.globeRotation[1] = clamp(state.view.globeRotation[1] - latitudeDelta, -89, 89);
      changed = true;
    }
    updateProjection();
    return changed;
  }

  function transformMapView({ zoom, fromPoint, toPoint }) {
    const source = Array.isArray(fromPoint) ? fromPoint : null;
    const target = Array.isArray(toPoint) ? toPoint : source;
    updateProjection();
    const anchor = source ? screenToGeo(source) : null;
    let changed = setMapZoomValue(zoom);
    if (anchor && target) {
      changed = alignGeographicAnchor(anchor, target) || changed;
    } else if (source && target && (source[0] !== target[0] || source[1] !== target[1])) {
      dragMapBy(target[0] - source[0], target[1] - source[1]);
      updateProjection();
      changed = true;
    } else {
      updateProjection();
    }
    return changed;
  }

  function setCurrentTool(name) {
    const currentName = name || '선택·편집';
    if ($('currentToolStatus')) $('currentToolStatus').textContent = currentName;
    syncStatusBar();
  }

  function shouldShowCoordinates() {
    if (state.labelPlacementMode || state.tool === 'label' || state.tool === 'point') return true;
    if (['country-border', 'country-coast'].includes(state.tool) || isGenericFeatureDraftTool(state.tool)) return true;
    if (state.tool === 'new-country') return state.newCountryPhase === 'line';
    if (state.tool === 'annex-territory') return ['line', 'polygon'].includes(state.annexPhase);
    return false;
  }

  function syncStatusBar() {
    const showCoordinates = shouldShowCoordinates();
    const showTask = state.tool !== 'select' || state.labelPlacementMode;
    const selectedText = $('selectionStatus')?.textContent?.trim() || '';
    const showSelection = !!state.selected && !!selectedText;
    const projectionLabel = state.projection === 'flat' ? '평면지도' : '지구본';
    if ($('projectionStatus')) $('projectionStatus').textContent = `투영 ${projectionLabel}`;
    $('coordStatus')?.classList.toggle('hidden', !showCoordinates);
    $('statusView')?.classList.toggle('coordinates-active', showCoordinates);
    $('statusPrimary')?.classList.toggle('hidden', !showTask);
    $('statusSelection')?.classList.toggle('hidden', !showSelection);
  }

  function clearNotification() {
    clearTimeout(setActionStatus._timer);
    const notice = $('actionStatus');
    if (!notice) return;
    notice.classList.add('hidden');
    notice.classList.remove('working', 'success', 'error', 'info', 'warning');
    notice.classList.add('ready');
    notice.setAttribute('role', 'status');
    document.body.classList.remove('notification-visible');
  }

  function clearErrorNotification() {
    if ($('actionStatus')?.classList.contains('error')) clearNotification();
  }

  function setActionStatus(message, tone = 'success', timeout = 1800) {
    const notice = $('actionStatus');
    if (!notice) return;
    const fullMessage = String(message ?? '').replace(/\s+/g, ' ').trim();
    const visibleMessage = isMobile()
      ? compactNotificationMessage(fullMessage, { tone, maxLength: 22 })
      : fullMessage;
    clearTimeout(setActionStatus._timer);
    notice.classList.remove('hidden');
    notice.classList.remove('ready', 'working', 'success', 'error', 'info', 'warning');
    notice.classList.add(tone);
    notice.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    notice.setAttribute('aria-label', fullMessage);
    if (visibleMessage !== fullMessage) notice.dataset.tooltip = fullMessage;
    else delete notice.dataset.tooltip;
    const strong = notice.querySelector('strong');
    if (strong) strong.textContent = visibleMessage;
    document.body.classList.add('notification-visible');
    if (tone === 'error' || timeout <= 0) return;
    setActionStatus._timer = setTimeout(clearNotification, timeout);
  }

  const CANONICAL_CONTROL_SELECTOR = [
    '#createMenu .create-menu-item',
    '#rightPanel input', '#rightPanel select', '#rightPanel textarea',
    '#rightPanel button:not(.sheet-close-btn):not(#focusSelectedObjectBtn)',
    '.top-actions button', '.top-actions input',
    '#undoBtn', '#redoBtn',
    '.layer-child-menu', '.layer-folder-lock', '.layer-style-toggle',
    '[data-layer-style-opacity]', '[data-layer-style-boundary]', '[data-layer-style-blend-mode]',
    '.layer-folder input[type="checkbox"]', '#labelsVisible', '#basemapLabelsVisible',
  ].join(',');

  const READINESS_INDEPENDENT_CONTROL_SELECTOR = [
    '.layer-visibility-toggle',
    '.layer-style-toggle',
    '[data-layer-style-opacity]',
    '[data-layer-style-boundary]',
    '[data-layer-style-blend-mode]',
    '#terrainVisible',
    'input[name="terrainStyle"]',
    '#terrainStrengthInput',
    '#labelsVisible',
    '#basemapLabelsVisible',
  ].join(',');

  function isReadinessIndependentControl(element) {
    return !!element?.matches?.(READINESS_INDEPENDENT_CONTROL_SELECTOR);
  }

  function syncLayerVisibilityToggle(input) {
    if (!input?.classList?.contains('layer-visibility-toggle')) return;
    const label = input.dataset.visibilityLabel || '레이어';
    input.dataset.tooltip = input.checked ? `${label} 숨기기` : `${label} 표시`;
  }

  function syncLayerVisibilityToggles(scope = document) {
    scope?.querySelectorAll?.('input.layer-visibility-toggle').forEach(syncLayerVisibilityToggle);
  }

  const canonicalControls = new Set();
  const canonicalControlReadiness = new WeakMap();
  let canonicalControlsRegistered = false;
  function syncCanonicalControls(scope = document) {
    const unavailable = !canMutateProject(state.dataReadiness);
    if (!canonicalControlsRegistered || scope !== document) {
      for (const element of scope.querySelectorAll(CANONICAL_CONTROL_SELECTOR)) canonicalControls.add(element);
      canonicalControlsRegistered = true;
    }
    $('app')?.setAttribute('data-readiness', state.dataReadiness);
    document.body.dataset.mapReadiness = state.dataReadiness;
    for (const element of canonicalControls) {
      if (!element.isConnected) { canonicalControls.delete(element); continue; }
      if (canonicalControlReadiness.get(element) === unavailable) continue;
      canonicalControlReadiness.set(element, unavailable);
      if (isReadinessIndependentControl(element)) continue;
      if (unavailable) {
        if (!Object.hasOwn(element.dataset, 'readinessDisabled')) {
          element.dataset.readinessDisabled = String('disabled' in element && element.disabled);
          element.dataset.readinessAriaDisabled = element.hasAttribute('aria-disabled')
            ? String(element.getAttribute('aria-disabled'))
            : '';
        }
        if ('disabled' in element) element.disabled = true;
        element.setAttribute('aria-disabled', 'true');
        continue;
      }
      if (Object.hasOwn(element.dataset, 'readinessDisabled')) {
        if ('disabled' in element) element.disabled = element.dataset.readinessDisabled === 'true';
        const previousAria = element.dataset.readinessAriaDisabled;
        if (previousAria) element.setAttribute('aria-disabled', previousAria);
        else element.removeAttribute('aria-disabled');
        delete element.dataset.readinessDisabled;
        delete element.dataset.readinessAriaDisabled;
      }
    }
    syncLayerVisibilityToggles($('layerSection'));
  }

  function setDataReadiness(value) {
    state.dataReadiness = Object.values(DATA_READINESS).includes(value) ? value : DATA_READINESS.PREVIEW;
    syncCanonicalControls();
  }

  function applyDataReadinessEvent(event) {
    setDataReadiness(transitionDataReadiness(state.dataReadiness, event));
  }

  function requireCanonicalData() {
    if (canMutateProject(state.dataReadiness)) return true;
    const message = state.dataReadiness === DATA_READINESS.ERROR
      ? '편집 데이터를 불러오지 못했습니다. 새로고침하세요.'
      : `편집 데이터 준비 중 · ${Math.round(state.geometryProgress || 0)}%`;
    setActionStatus(message, state.dataReadiness === DATA_READINESS.ERROR ? 'error' : 'working', 2600);
    return false;
  }

  function blockUnavailableCanonicalAction(event) {
    if (canMutateProject(state.dataReadiness)) return;
    const target = event.target instanceof window.Element ? event.target.closest(CANONICAL_CONTROL_SELECTOR) : null;
    if (!target || isReadinessIndependentControl(target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    requireCanonicalData();
  }

  document.addEventListener('click', blockUnavailableCanonicalAction, true);
  document.addEventListener('change', blockUnavailableCanonicalAction, true);

  function isSafeKoreanErrorMessage(error) {
    const message = String(error?.message || '');
    if (!/[가-힣]/.test(message)) return false;
    return !/(Cannot read|undefined|null is not|is not a function|TypeError|ReferenceError|SyntaxError|RangeError|failed\b|\bat\s+\S+\s*\()/i.test(message);
  }

  function reportOperationError(error, fallbackMessage, code, timeout = 4400) {
    console.error(`[${code}]`, error);
    const detail = isSafeKoreanErrorMessage(error) ? String(error.message).trim() : '';
    const hasRecoveryAction = /(선택|확인|입력|이동|조정|해제|새로고침|다시 시도|다시 그리)하세요\.$/.test(detail);
    const fallbackSummary = String(fallbackMessage || '').split(/(?<=[.!?])\s+/u)[0];
    const message = detail
      ? (hasRecoveryAction ? detail : `${detail} · ${code}`)
      : `${fallbackSummary} · ${code}`;
    setActionStatus(message, 'error', timeout);
  }

  function createGisImportError(userMessage, {
    category = RELIABILITY_ERROR_CATEGORIES.TRANSACTION,
    objectIds = [],
    technicalMessage = '',
    cause = null,
    code = 'PL-GIS-001',
  } = {}) {
    return createOperationalError({
      code,
      category,
      userMessage,
      technicalMessage: technicalMessage || cause?.message || userMessage,
      objectIds,
      operationType: 'gis-import',
      cause,
    });
  }

  function reportGisImportError(error, { rollback = '' } = {}) {
    const code = String(error?.code || 'PL-GIS-001');
    const objectIds = [...new Set((error?.objectIds || []).map(String).filter(Boolean))];
    const technicalMessage = String(error?.message || error || 'GIS import failed');
    console.error(`[${code}]`, {
      operation: error?.operationType || 'gis-import',
      objectIds,
      rollback,
    }, error);
    reliabilityDiagnostic.push({
      category: error?.category || 'gis',
      operation: error?.operationType || 'gis-import',
      objectIds,
      result: 'failed',
      errorCode: code,
      technicalMessage,
      stack: error?.stack || '',
      rollback,
    });
    const hasSpecificUserMessage = !!String(error?.userMessage || '').trim() || isSafeKoreanErrorMessage(error);
    const userMessage = String(error?.userMessage || '').trim()
      || (isSafeKoreanErrorMessage(error) ? technicalMessage.trim() : '파일을 불러오지 못했습니다. 파일 형식과 구성을 확인하세요.');
    setActionStatus(hasSpecificUserMessage ? userMessage : `${userMessage} · ${code}`, 'error', 5600);
  }

  function showFatalError(error) {
    if (isAbortError(error)) return;
    console.error('[PL-RUNTIME-001]', error);
    const message = isSafeKoreanErrorMessage(error)
      ? String(error.message).trim()
      : '내부 오류로 판도연구소를 시작할 수 없습니다. 오류 코드 PL-RUNTIME-001을 확인하세요.';
    let box = document.getElementById('fatalErrorBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'fatalErrorBox';
      box.className = 'fatal-runtime-message';
      document.body.appendChild(box);
    }
    box.textContent = `판도연구소를 시작할 수 없습니다.\n${message}\n\n페이지를 새로고침하세요. 문제가 계속되면 오류 코드를 확인하세요.`;
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = '실행 오류';
  }

  function handleUnexpectedRuntimeError(error) {
    if (isAbortError(error)) return;
    if (!runtimeReady) {
      showFatalError(error);
      return;
    }
    console.error('[PL-RUNTIME-001]', error);
    setActionStatus('작업 실패 · PL-RUNTIME-001', 'error', 0);
  }

  window.addEventListener('error', event => {
    const error = event.error || event.message;
    if (isAbortError(error)) {
      event.preventDefault();
      return;
    }
    handleUnexpectedRuntimeError(error);
  });
  window.addEventListener('unhandledrejection', event => {
    if (isAbortError(event.reason)) {
      event.preventDefault();
      return;
    }
    handleUnexpectedRuntimeError(event.reason);
  });

  function featureCountryId(feature, index) {
    return String(feature?.id || `country_${index}`);
  }

  function featureCountryName(feature) {
    const p = feature.properties || {};
    return p.name || '이름 없는 국가';
  }

  function reindexCountries(fc, applyOverrides = true, { assumeCanonical = false } = {}) {
    const out = fc?.type === 'FeatureCollection' ? fc : { type: 'FeatureCollection', features: [] };
    state.countryIndex.clear();
    out.features.forEach((feature, index) => {
      if (!assumeCanonical && !hasCanonicalCountryWinding(feature.geometry)) {
        const normalizedGeometry = normalizeCountryGeometry(feature.geometry);
        if (normalizedGeometry) feature.geometry = normalizedGeometry;
      }
      feature.properties = feature.properties || {};
      const id = featureCountryId(feature, index);
      feature.id = id;
      feature.properties = {
        name: featureCountryName(feature),
        ...(feature.properties.validFrom ? { validFrom: String(feature.properties.validFrom) } : {}),
        ...(feature.properties.validTo ? { validTo: String(feature.properties.validTo) } : {}),
      };
      state.countryIndex.set(id, index);
    });
    rebuildSpatialIndex(out.features);
    markLayerTreeDirty();
    return out;
  }

  function validLabelAnchor(value) {
    return Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
  }

  function applyPristineLabelAnchors(collection, onlyIds = null) {
    const filter = onlyIds ? new Set([...onlyIds].map(String)) : null;
    for (const feature of collection?.features || []) {
      const id = String(feature?.id || '');
      if (filter && !filter.has(id)) continue;
      const anchor = PRISTINE_LABEL_ANCHORS[id];
      if (!validLabelAnchor(anchor)) continue;
      countryLabelAnchors.set(id, [Number(anchor[0]), Number(anchor[1])]);
      pendingCountryLabelAnchors.delete(id);
    }
  }

  function largestCountryComponentFeature(feature) {
    const geometry = feature?.geometry;
    if (!geometry) return null;
    if (geometry.type === 'Polygon') return { type: 'Feature', properties: feature.properties || {}, geometry: deepClone(geometry) };
    if (geometry.type !== 'MultiPolygon') return null;
    let bestCoordinates = null;
    let bestArea = -Infinity;
    for (const coordinates of geometry.coordinates || []) {
      let area = 0;
      try { area = d3.geo.area({ type: 'Polygon', coordinates }); } catch (_) {}
      if (area > bestArea) { bestArea = area; bestCoordinates = coordinates; }
    }
    return bestCoordinates
      ? { type: 'Feature', properties: feature.properties || {}, geometry: { type: 'Polygon', coordinates: deepClone(bestCoordinates) } }
      : null;
  }

  function fallbackCountryLabelAnchor(feature) {
    const primary = largestCountryComponentFeature(feature) || feature;
    try {
      const centroid = d3.geo.centroid(primary);
      if (validLabelAnchor(centroid)) return centroid;
    } catch (_) {}
    const ring = primary?.geometry?.coordinates?.[0] || [];
    return ringRepresentativePoint(ring);
  }

  const labelFallbackQueue = new Map();
  function queueCountryLabelFallback(id) {
    if (validLabelAnchor(countryLabelAnchors.get(id))) return;
    labelFallbackQueue.set(id, { generation: projectDomain.getGeneration(), version: countryLabelAnchorVersions.get(id) });
    mapWorkScheduler.scheduleIdle('country-label-fallback', drainCountryLabelFallback, 20);
  }
  function drainCountryLabelFallback() {
    if (state.mapMoving || document.hidden || navigator.scheduling?.isInputPending?.()) {
      mapWorkScheduler.scheduleIdle('country-label-fallback', drainCountryLabelFallback, 100); return;
    }
    const start = performance.now();
    let changed = false;
    for (const [id, task] of labelFallbackQueue) {
      labelFallbackQueue.delete(id);
      if (task.generation !== projectDomain.getGeneration() || task.version !== countryLabelAnchorVersions.get(id)) continue;
      const feature = countryFeatureById(id);
      if (feature && !validLabelAnchor(countryLabelAnchors.get(id))) { countryLabelAnchors.set(id, fallbackCountryLabelAnchor(feature)); changed = true; }
      if (performance.now() - start >= 4) break;
    }
    if (changed) renderingDomain?.invalidateLabels?.('country-label-fallback');
    if (labelFallbackQueue.size) mapWorkScheduler.scheduleIdle('country-label-fallback', drainCountryLabelFallback, 20);
  }

  function ensureCountryLabelAnchorWorker() {
    if (countryLabelAnchorWorker) return countryLabelAnchorWorker;
    const worker = new Worker(runtimeAssetUrl('workers/label-anchor-worker.js'), {
      name: 'pandolab-label-anchors',
    });
    worker.onmessage = event => {
      const message = event.data || {};
      const flight = countryLabelAnchorFlight;
      if (!flight || message.requestId !== flight.requestId) return;
      countryLabelAnchorFlight = null;
      if (flight.generation !== projectDomain.getGeneration()) return;
      mapWorkScheduler.scheduleIdle('country-label-anchor-batch', flushCountryLabelAnchorQueue, 20);
      if (message.type === 'error') {
        console.warn('Country label anchor worker failed', message.message);
        for (const { id } of flight.items) {
          const feature = countryFeatureById(id);
          if (feature) queueCountryLabelFallback(id);
          pendingCountryLabelAnchors.delete(id);
        }
        renderingDomain?.invalidateLabels?.('country-label-anchor-fallback');
        return;
      }
      if (message.type !== 'anchors') return;
      for (const result of message.results || []) {
        const id = String(result.id || '');
        if (countryLabelAnchorVersions.get(id) !== Number(result.version || 0)) continue;
        const feature = countryFeatureById(id);
        if (feature && validLabelAnchor(result.anchor)) countryLabelAnchors.set(id, [Number(result.anchor[0]), Number(result.anchor[1])]);
        else if (feature) queueCountryLabelFallback(id);
        pendingCountryLabelAnchors.delete(id);
      }
      renderingDomain?.invalidateLabels?.('country-label-anchor-ready');
    };
    worker.onerror = event => {
      console.warn('Country label anchor worker error', event.message || event);
      countryLabelAnchorFlight = null;
      countryLabelAnchorWorker?.terminate();
      countryLabelAnchorWorker = null;
      for (const id of [...pendingCountryLabelAnchors]) {
        const feature = countryFeatureById(id);
        if (feature) queueCountryLabelFallback(id);
        pendingCountryLabelAnchors.delete(id);
      }
      renderingDomain?.invalidateLabels?.('country-label-anchor-error');
    };
    countryLabelAnchorWorker = worker;
    return worker;
  }

  function resetCountryLabelAnchorRuntime() {
    labelFallbackQueue.clear();
    mapWorkScheduler.cancel('country-label-fallback');
    countryLabelAnchorFlight = null;
    mapWorkScheduler.cancel('country-label-anchor-batch');
    clearTimeout(countryLabelAnchorTimer);
    countryLabelAnchorTimer = 0;
    countryLabelAnchorWorker?.terminate();
    countryLabelAnchorWorker = null;
    pendingCountryLabelAnchors.clear();
    countryLabelAnchorVersions.clear();
    countryLabelAnchors.clear();
    countryLabelAnchorRequestId += 1;
  }

  function flushCountryLabelAnchorQueue() {
    countryLabelAnchorTimer = 0;
    if (countryLabelAnchorFlight) return;
    if (state.mapMoving || document.hidden || navigator.scheduling?.isInputPending?.()) {
      mapWorkScheduler.scheduleIdle('country-label-anchor-batch', flushCountryLabelAnchorQueue, 100);
      return;
    }
    const batchStartedAt = performance.now();
    const items = [];
    for (const id of pendingCountryLabelAnchors) {
      const feature = countryFeatureById(id);
      if (!feature?.geometry) continue;
      items.push({
        id,
        version: countryLabelAnchorVersions.get(id) || 0,
        geometry: feature.geometry,
      });
      if (items.length >= 4 || performance.now() - batchStartedAt >= 4) break;
    }
    if (!items.length) return;
    try {
      countryLabelAnchorFlight = { requestId: ++countryLabelAnchorRequestId, generation: projectDomain.getGeneration(), items };
      ensureCountryLabelAnchorWorker().postMessage(countryLabelAnchorFlight);
    } catch (error) {
      console.warn('Country label anchor request failed', error);
      countryLabelAnchorFlight = null;
      countryLabelAnchorWorker = null;
      for (const item of items) {
        const feature = countryFeatureById(item.id);
        if (feature) queueCountryLabelFallback(item.id);
        pendingCountryLabelAnchors.delete(item.id);
      }
    }
  }

  function scheduleCountryLabelAnchors(ids = null, delay = 30) {
    const requested = ids ? new Set([...ids].map(String)) : null;
    for (const feature of state.countriesData?.features || []) {
      const id = String(feature?.id || '');
      if (requested && !requested.has(id)) continue;
      if (!requested && validLabelAnchor(countryLabelAnchors.get(id))) continue;
      countryLabelAnchors.delete(id);
      countryLabelAnchorVersions.set(id, (countryLabelAnchorVersions.get(id) || 0) + 1);
      pendingCountryLabelAnchors.add(id);
    }
    if (!pendingCountryLabelAnchors.size) return;
    markLayerTreeDirty();
    clearTimeout(countryLabelAnchorTimer);
    countryLabelAnchorTimer = setTimeout(flushCountryLabelAnchorQueue, delay);
  }


  function countryFeatureById(id) {
    const idx = state.countryIndex.get(String(id));
    return idx === undefined ? null : state.countriesData?.features?.[idx] || null;
  }

  function geometryBounds(geometry) {
    if (!geometry || typeof geometry !== 'object') return [Infinity, Infinity, -Infinity, -Infinity];
    const cached = geometryBoundsCache.get(geometry);
    if (cached) return cached;
    const bounds = coordinateBounds(geometry.coordinates);
    geometryBoundsCache.set(geometry, bounds);
    return bounds;
  }

  function geometryMayIntersectViewport(geometry, overscan = 48) {
    const bounds = geometryBounds(geometry);
    if (!bounds.every(Number.isFinite)) return true;
    const longitudeSpan = bounds[2] - bounds[0];
    const latitudeSpan = bounds[3] - bounds[1];
    // The spatial tier query already removes large objects that cannot meet the
    // current view. Keep the exact projected test conservative for the remaining
    // large/date-line candidates so culling never creates a visible false negative.
    if (longitudeSpan > 40 || latitudeSpan > 40 || longitudeSpan < 0) return true;
    const samples = [
      [bounds[0], bounds[1]], [bounds[0], bounds[3]],
      [bounds[2], bounds[1]], [bounds[2], bounds[3]],
      [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
    ];
    const projected = samples
      .filter(coordinate => state.projection !== 'globe' || isCoordVisible(coordinate))
      .map(coordinate => activeProjection()(coordinate))
      .filter(Boolean);
    if (!projected.length) return false;
    const xs = projected.map(point => point[0]);
    const ys = projected.map(point => point[1]);
    return Math.max(...xs) >= -overscan && Math.min(...xs) <= state.size.width + overscan
      && Math.max(...ys) >= -overscan && Math.min(...ys) <= state.size.height + overscan;
  }

  function sameSourceParts(left = [], right = []) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  function replaceSpatialDomain(domain, sourceParts, buildRecords) {
    const previous = mapObjectSpatialIndexSources.get(domain);
    if (previous && sameSourceParts(previous, sourceParts)) return false;
    mapObjectSpatialIndex.clearDomain(domain);
    for (const record of buildRecords()) mapObjectSpatialIndex.upsert(record);
    mapObjectSpatialIndexSources.set(domain, sourceParts.slice());
    return true;
  }

  function visibleFlatGeographicBounds(overscan = 64) {
    const width = Math.max(1, Number(state.size.width || 1));
    const height = Math.max(1, Number(state.size.height || 1));
    const center = screenToGeo([width / 2, height / 2]) || state.view.flatCenter || [0, 0];
    const samples = [
      [-overscan, -overscan], [width / 2, -overscan], [width + overscan, -overscan],
      [-overscan, height / 2], [width / 2, height / 2], [width + overscan, height / 2],
      [-overscan, height + overscan], [width / 2, height + overscan], [width + overscan, height + overscan],
    ].map(screenToGeo).filter(Boolean);
    if (!samples.length) return [-180, -90, 180, 90];
    const longitudes = samples.map(coordinate => {
      let longitude = Number(coordinate[0]);
      while (longitude - center[0] > 180) longitude -= 360;
      while (longitude - center[0] < -180) longitude += 360;
      return longitude;
    });
    const latitudes = samples.map(coordinate => Number(coordinate[1]));
    return [Math.min(...longitudes), Math.max(-90, Math.min(...latitudes)), Math.max(...longitudes), Math.min(90, Math.max(...latitudes))];
  }

  function visibleMapObjectCandidates(domains) {
    rebuildMapObjectSpatialIndex();
    const started = performance.now();
    const records = state.projection === 'globe'
      ? mapObjectSpatialIndex.querySphericalCap({
          center: [-Number(state.view.globeRotation?.[0] || 0), -Number(state.view.globeRotation?.[1] || 0)],
          radius: 91,
          domains,
        })
      : mapObjectSpatialIndex.query(visibleFlatGeographicBounds(), { domains });
    viewportCullingMetrics.queryCount += 1;
    viewportCullingMetrics.candidateCount = records.length;
    viewportCullingMetrics.queryMs = performance.now() - started;
    viewportCullingMetrics.lastByDomain[domains.join(',')] = {
      candidateCount: records.length,
      queryMs: viewportCullingMetrics.queryMs,
    };
    return records;
  }

  function pointBounds(coordinate) {
    const longitude = Number(coordinate?.[0]);
    const latitude = Number(coordinate?.[1]);
    return Number.isFinite(longitude) && Number.isFinite(latitude)
      ? [longitude, latitude, longitude, latitude]
      : null;
  }

  function rebuildMapObjectSpatialIndex(force = false) {
    if (force) mapObjectSpatialIndexSources.clear();
    let changed = false;
    changed = replaceSpatialDomain('label', [state.labels, state.labels?.length || 0, mapObjectGeometryRevisions.label], () => (state.labels || []).flatMap(label => {
      const bounds = pointBounds(label.coordinates);
      return bounds ? [{
        key: `label:${label.id}`, domain: 'label', type: label.kind || 'label', id: label.id, bounds,
      }] : [];
    })) || changed;
    changed = replaceSpatialDomain('generic', [state.genericFeatures, state.genericFeatures?.length || 0, mapObjectGeometryRevisions.generic], () => (state.genericFeatures || []).flatMap(feature => feature?.geometry ? [{
        key: `generic:${feature.id}`, domain: 'generic', type: 'feature', id: feature.id,
        bounds: geometryBounds(feature.geometry),
      }] : [])) || changed;
    changed = replaceSpatialDomain('territorial', [state.territorialUnits, state.territorialUnits?.length || 0, mapObjectGeometryRevisions.territorial], () => (state.territorialUnits || []).flatMap(feature => feature?.geometry ? [{
        key: `territorial:${feature.id}`, domain: 'territorial', type: feature.properties?.unitType || TERRITORIAL_UNIT_TYPES.TERRITORY, id: feature.id,
        bounds: geometryBounds(feature.geometry),
      }] : [])) || changed;
    const distributionRows = renderingDomain?.getDistributionRenderRows?.() || [];
    if (force || mapObjectSpatialIndexSources.get('distribution')?.[0] !== distributionRows) mapObjectDistributionRowCache.clear();
    changed = replaceSpatialDomain('distribution', [distributionRows], () => distributionRows.map(row => {
      mapObjectDistributionRowCache.set(String(row.id), row);
      return {
        key: `distribution:${row.id}`, domain: 'distribution', type: row.layer.type, id: row.id,
        bounds: row.bounds,
      };
    })) || changed;
    changed = replaceSpatialDomain('hydro', [state.hydroEdits, state.hydroEdits?.length || 0, mapObjectGeometryRevisions.hydro], () => (state.hydroEdits || []).flatMap(feature => feature?.geometry ? [{
        key: `hydro:${feature.id}`, domain: 'hydro', type: feature.properties?.category || 'river', id: feature.id,
        bounds: geometryBounds(feature.geometry),
      }] : [])) || changed;
    return changed;
  }

  function scheduleMapObjectSpatialIndexRebuild() {
    mapWorkScheduler.scheduleIdle('map-object-spatial-index', () => rebuildMapObjectSpatialIndex(), 40);
  }

  function selectionQueryBounds(screenPoint, tolerance = 8) {
    const center = screenToGeo(screenPoint);
    if (!center) return null;
    const samples = [[0, 0], [-tolerance, 0], [tolerance, 0], [0, -tolerance], [0, tolerance],
      [-tolerance, -tolerance], [tolerance, -tolerance], [-tolerance, tolerance], [tolerance, tolerance]]
      .map(([dx, dy]) => screenToGeo([screenPoint[0] + dx, screenPoint[1] + dy]))
      .filter(Boolean);
    if (!samples.length) return [center[0], center[1], center[0], center[1]];
    const longitudes = samples.map(coordinate => {
      let value = Number(coordinate[0]);
      while (value - center[0] > 180) value -= 360;
      while (value - center[0] < -180) value += 360;
      return value;
    });
    const latitudes = samples.map(coordinate => Number(coordinate[1]));
    return [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)];
  }

  function indexedMapObjectCandidates(screenPoint) {
    rebuildMapObjectSpatialIndex();
    const bounds = selectionQueryBounds(screenPoint, isMobile() ? 18 : 11);
    if (!bounds) return [];
    const startedAt = performance.now();
    const candidates = mapObjectSpatialIndex.query(bounds);
    selectionPerformanceMetrics.indexQueryMs = performance.now() - startedAt;
    selectionPerformanceMetrics.indexedCandidateCount = candidates.length;
    return candidates;
  }

  function indexedDistributionRow(id) {
    return mapObjectDistributionRowCache.get(String(id)) || null;
  }

  function rebuildSpatialIndex(features = state.countriesData?.features || []) {
    state.spatialIndex = (features || []).map(feature => ({
      id: String(feature?.id || ''),
      feature,
      bounds: geometryBounds(feature.geometry),
    }));
  }

  function spatialFeatures(bounds, excludeIds = null) {
    const excluded = excludeIds ? new Set([...excludeIds].map(String)) : null;
    return (state.spatialIndex || [])
      .filter(item => (!excluded || !excluded.has(item.id)) && boundsOverlap(bounds, item.bounds))
      .map(item => item.feature);
  }

  function invalidateGeometryCaches(ids = []) {
    const wanted = new Set([...ids].map(String));
    for (const feature of state.countriesData?.features || []) {
      if (!wanted.size || wanted.has(String(feature?.id || ''))) {
        geometryBoundsCache.delete(feature.geometry);
        ringHitTester.invalidate(feature.geometry);
        countryOutlineCache.delete(feature.geometry);
      }
    }
    if (!wanted.size) rebuildSpatialIndex();
    else for (const item of state.spatialIndex || []) {
      if (!wanted.has(item.id)) continue;
      const feature = countryFeatureById(item.id);
      if (feature) { item.feature = feature; item.bounds = geometryBounds(feature.geometry); }
    }
  }

  function markCountryGeometriesChanged(ids = []) {
    const changed = new Set();
    for (const rawId of ids) {
      const id = String(rawId || '');
      if (!id) continue;
      changed.add(id);
      state.historyDirtyCountryIds.add(id);
      state.pendingCountryRenderIds.add(id);
    }
    const currentFeatures = new Map((state.countriesData?.features || []).map(feature => [
      String(feature?.id || ''),
      feature,
    ]));
    const features = [];
    const removedIds = [];
    for (const id of changed) {
      const feature = currentFeatures.get(id);
      if (feature) features.push(feature);
      else removedIds.push(id);
    }
    invalidateGeometryCaches(changed);
    if (changed.size) {
      state.stateRevision += 1;
    }
    countryLandRevision += 1;
    boundarySelectionAnalysisCache.clear();
    genericFeatureLandClipCache = new WeakMap();
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    gpuMapRenderer.applyCountryPatch({ ids: [...changed], features, removedIds });
    if (!applyingMapEditWorkerResult) mapEditClient.syncPatch(changed);
  }

  let applyingMapEditWorkerResult = false;

  const mapEditClient = createMapEditWorkerClient({
    createWorker: () => new Worker(runtimeAssetUrl('workers/map-edit-worker.js'), { name: 'pandolab-map-edit' }),
    getFeatures: () => state.countriesData?.features || [],
    getFeatureById: countryFeatureById,
    getTargetRevision: () => state.stateRevision,
  });

  function assertCurrentProjectReferences() {
    return assertProjectReferenceIntegrity({
      countries: state.countriesData?.features || [],
      countryOverrides: state.countryOverrides || {},
      territorialUnits: state.territorialUnits || [],
      territorialRelations: state.territorialRelations || [],
      distributionLayers: state.distributionLayers || [],
      distributionEntries: state.distributionEntries || [],
      labels: state.labels || [],
      genericFeatures: state.genericFeatures || [],
      itemVisibility: state.itemVisibility || {},
      labelSettings: state.labelSettings || {},
    });
  }

  function transactCountryEdit({ operation, payload, snapshot, applyResult, onSuccess, onError }) {
    return runCountryEditTransaction({
      client: mapEditClient,
      operation,
      payload,
      snapshot,
      applyResult,
      validateCanonical: assertCurrentProjectReferences,
      commitHistory: (...args) => projectDomain.commitHistorySnapshot(...args),
      restore: (editableSnapshot, { rebaseWorker }) => {
        restoreCountryEditSnapshot(editableSnapshot);
        if (rebaseWorker) mapEditClient.rebase(state.countriesData?.features || []);
      },
      queueAutosave: (...args) => projectDomain.queueAutosave(...args),
      diagnostic: reliabilityDiagnostic,
      onSuccess,
      onError,
    });
  }

  function geometryPolygonSets(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return [geometry.coordinates || []];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates || [];
    return [];
  }

  function countryRingForVertex(feature, vertex) {
    if (!feature?.geometry || !vertex) return null;
    if (feature.geometry.type === 'Polygon') return feature.geometry.coordinates?.[vertex.ringIndex] || null;
    if (feature.geometry.type === 'MultiPolygon') return feature.geometry.coordinates?.[vertex.polygonIndex]?.[vertex.ringIndex] || null;
    return null;
  }

  function setCountryVertexCoord(feature, vertex, coord) {
    const ring = countryRingForVertex(feature, vertex);
    if (!ring || vertex.index < 0 || vertex.index >= ring.length - 1) return false;
    // 배열 객체를 교체하지 않고 값만 바꿔 토폴로지 세그먼트 참조가 드래그 중에도 유지되게 한다.
    ring[vertex.index][0] = coord[0];
    ring[vertex.index][1] = coord[1];
    if (vertex.index === 0) {
      ring[ring.length - 1][0] = coord[0];
      ring[ring.length - 1][1] = coord[1];
    }
    return true;
  }

  function coordKey(coord, precision = 7) {
    return `${Number(coord?.[0] || 0).toFixed(precision)},${Number(coord?.[1] || 0).toFixed(precision)}`;
  }

  function edgeKey(a, b, precision = 7) {
    const ka = coordKey(a, precision), kb = coordKey(b, precision);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  }

  function coordNear(a, b, tolerance = 0.00008) {
    if (!a || !b) return false;
    let dx = Math.abs(a[0] - b[0]);
    dx = Math.min(dx, Math.abs(dx - 360));
    return dx <= tolerance && Math.abs(a[1] - b[1]) <= tolerance;
  }

  /*
   * 국가 폴리곤을 '육상 공유국경 / 해안선 / 다국가 접경점'으로 분류하는 경량 토폴로지 인덱스.
   * 같은 선분을 2개 이상의 국가가 소유하면 육상국경, 1개 국가만 소유하면 해안선이다.
   * 이 데이터는 렌더링/편집용 캐시이며 프로젝트 파일에는 저장하지 않고 geometry에서 매번 재구성한다.
   */
  function rebuildBoundaryTopology(targetCountryIds = state.coastEditCountryId) {
    const edges = new Map();
    const nodes = new Map();
    const targetIds = [...new Set((Array.isArray(targetCountryIds) ? targetCountryIds : [targetCountryIds]).map(String).filter(Boolean))];
    const targets = targetIds.map(countryFeatureById).filter(Boolean);
    if (!targets.length) {
      state.boundaryTopology = { edges, nodes };
      state.sharedBoundaryTopology = { segments: new Map(), nodes: new Map() };
      return;
    }
    const margin = 0.0002;
    const nearby = new Map();
    for (const target of targets) {
      const targetBounds = geometryBounds(target.geometry);
      const queryBounds = [targetBounds[0] - margin, targetBounds[1] - margin, targetBounds[2] + margin, targetBounds[3] + margin];
      for (const feature of spatialFeatures(queryBounds)) nearby.set(String(feature?.id || ''), feature);
    }
    const features = [...nearby.values()];

    for (const feature of features) {
      const countryId = String(feature?.id || '');
      const polygons = geometryPolygonSets(feature.geometry);
      polygons.forEach((polygon, polygonIndex) => {
        polygon.forEach((ring, ringIndex) => {
          const count = Math.max(0, (ring?.length || 0) - 1);
          if (count < 2) return;
          for (let index = 0; index < count; index += 1) {
            const a = ring[index];
            const b = ring[(index + 1) % count];
            const eKey = edgeKey(a, b);
            if (!edges.has(eKey)) edges.set(eKey, { key: eKey, refs: [], countryIds: new Set(), kind: 'coast' });
            const edge = edges.get(eKey);
            edge.refs.push({ countryId, feature, polygonIndex, ringIndex, index, a, b });
            edge.countryIds.add(countryId);

            const nKey = coordKey(a);
            if (!nodes.has(nKey)) nodes.set(nKey, { key: nKey, coord: a, refs: [], countryIds: new Set() });
            const node = nodes.get(nKey);
            node.refs.push({
              countryId, feature,
              vertex: { key: `${polygonIndex}:${ringIndex}:${index}`, polygonIndex, ringIndex, index, coord: a },
              prevEdgeKey: edgeKey(ring[(index - 1 + count) % count], a),
              nextEdgeKey: eKey,
            });
            node.countryIds.add(countryId);
          }
        });
      });
    }

    for (const edge of edges.values()) edge.kind = edge.countryIds.size >= 2 ? 'land' : 'coast';
    for (const node of nodes.values()) {
      for (const ref of node.refs) {
        ref.prevKind = edges.get(ref.prevEdgeKey)?.kind || 'coast';
        ref.nextKind = edges.get(ref.nextEdgeKey)?.kind || 'coast';
      }
    }

    state.boundaryTopology = { edges, nodes };
    state.sharedBoundaryTopology = buildSharedBoundaryTopology(features);
  }

  function boundaryEditSelectionAnalysis(countryIds = state.boundaryEditCountryIds, { rebuild = false } = {}) {
    const ids = [...new Set(countryIds.map(String).filter(id => countryFeatureById(id)))];
    const cacheKey = `${countryLandRevision}:${ids.slice().sort().join('|')}`;
    const cached = boundarySelectionAnalysisCache.get(cacheKey);
    if (cached) {
      boundarySelectionAnalysisMetrics.cacheHits += 1;
      return cached;
    }
    if (!rebuild) {
      boundarySelectionAnalysisMetrics.cacheMisses += 1;
      return {
        selectedIds: ids,
        segmentKeys: new Set(),
        isolatedIds: [],
        valid: ids.length >= 2,
        analyzed: false,
        message: ids.length >= 2 ? '국경 조정 시작 시 공유국경을 확인합니다.' : '접경국을 하나 이상 더 선택하세요.',
      };
    }
    boundarySelectionAnalysisMetrics.cacheMisses += 1;
    const startedAt = performance.now();
    rebuildBoundaryTopology(ids);
    const plan = planSharedBoundaryEdit(state.sharedBoundaryTopology, ids);
    const names = plan.isolatedIds.map(id => countryName(countryFeatureById(id)) || id);
    let message = '';
    if (ids.length < 2) message = '접경국을 하나 이상 더 선택하세요.';
    else if (!plan.segmentKeys.size) message = '선택 국가 사이에 편집할 공유국경이 없습니다.';
    else if (names.length) message = `${names.join(', ')}은(는) 다른 선택 국가와 접하지 않습니다.`;
    const result = { ...plan, message, analyzed: true };
    boundarySelectionAnalysisCache.set(cacheKey, result);
    boundarySelectionAnalysisMetrics.builds += 1;
    boundarySelectionAnalysisMetrics.buildMs += performance.now() - startedAt;
    while (boundarySelectionAnalysisCache.size > 64) boundarySelectionAnalysisCache.delete(boundarySelectionAnalysisCache.keys().next().value);
    return result;
  }

  async function beginWorkerGeometryPreview({
    operation,
    payload,
    snapshot,
    transferredGeometry = null,
    applyResult,
    onSuccess = () => {},
    onError = () => {},
  }) {
    discardActiveGeometryPreview({ announce: false });
    const baseDataRevision = state.stateRevision;
    setActionStatus('변경 미리보기 계산 중…', 'working', 0);
    let requestId = 0;
    try {
      const response = await mapEditClient.execute(operation, payload);
      requestId = response.requestId;
      if (state.stateRevision !== baseDataRevision) {
        mapEditClient.discard(requestId);
        throw Object.assign(new Error('계산 중 지도 상태가 바뀌어 미리보기를 폐기했습니다.'), { cancelled: true });
      }
      const result = response.result;
      const affectedIds = new Set((result.affectedIds || []).map(String));
      const removedIds = new Set((result.removedIds || []).map(String));
      const beforeFeatures = [...affectedIds].map(countryFeatureById).filter(Boolean).map(deepClone);
      const patchById = new Map((result.features || []).map(feature => [String(feature?.id || ''), deepClone(feature)]));
      const afterFeatures = [...affectedIds].filter(id => !removedIds.has(id))
        .map(id => patchById.get(id) || countryFeatureById(id))
        .filter(Boolean).map(deepClone);
      const proposedFeatures = (state.countriesData?.features || [])
        .filter(feature => !affectedIds.has(String(feature?.id || '')))
        .map(feature => feature)
        .concat(afterFeatures);
      const baselineIssues = validateTerritorialGeometry(state.countriesData?.features || [], {
        clipper: window.polygonClipping,
        affectedIds,
      });
      const baselineIssueKeys = new Set(baselineIssues.map(issue => `${issue.kind}:${[...(issue.entityRefs || [])].sort().join('|')}`));
      const validationIssues = validateTerritorialGeometry(proposedFeatures, {
        clipper: window.polygonClipping,
        affectedIds,
      }).filter(issue => !baselineIssueKeys.has(`${issue.kind}:${[...(issue.entityRefs || [])].sort().join('|')}`));
      const preview = buildGeometryPreview({
        operation,
        beforeFeatures,
        afterFeatures,
        removedIds: [...removedIds],
        clipper: window.polygonClipping,
        transferredGeometry,
      });
      const session = beginGeometryPreview(state.geometryPreview, {
        operation,
        baseDataRevision,
        workerRequestId: requestId,
        affectedIds: [...affectedIds],
        beforeFeatures,
        afterFeatures,
        removedIds: [...removedIds],
        ...preview,
        validation: {
          issues: validationIssues,
          blocking: validationIssues.some(issue => issue.severity !== 'warning'),
        },
      });
      activeGeometryPreviewDiscard = () => mapEditClient.discard(requestId);
      activeGeometryPreviewApply = async () => {
        if (!previewIsCurrent(state.geometryPreview, session.sessionId, baseDataRevision) || state.stateRevision !== baseDataRevision) {
          mapEditClient.discard(requestId);
          clearGeometryPreview(state.geometryPreview);
          activeGeometryPreviewApply = null;
          activeGeometryPreviewDiscard = null;
          renderingDomain?.invalidateGpuInteraction?.('geometry-preview-cancelled');
          updateModeButtons();
          setActionStatus('지도가 바뀌어 미리보기를 취소했습니다.', 'error', 3800);
          return false;
        }
        if (session.validation?.blocking) {
          setActionStatus('미리보기 형상을 수정하세요.', 'error', 3400);
          return false;
        }
        clearGeometryPreview(state.geometryPreview);
        activeGeometryPreviewApply = null;
        activeGeometryPreviewDiscard = null;
        try {
          await applyResult(result);
          assertCurrentProjectReferences();
          mapEditClient.commit(requestId);
          projectDomain.commitHistorySnapshot(snapshot);
          projectDomain.queueAutosave();
          onSuccess(result);
          renderingDomain?.invalidateCountryPatch?.('country-geometry-preview-applied');
          updateModeButtons();
          return true;
        } catch (error) {
          mapEditClient.discard(requestId);
          restoreCountryEditSnapshot(snapshot);
          onError(error);
          return false;
        }
      };
      renderingDomain?.invalidateGpuInteraction?.('geometry-preview-ready');
      updateModeButtons();
      const blockingIssue = validationIssues.find(issue => issue.severity !== 'warning');
      setModeBanner(blockingIssue?.message || '변경 결과를 확인한 뒤 적용하세요.');
      if (blockingIssue) $('modeTaskInstruction')?.classList.add('cut-invalid');
      setActionStatus(validationIssues.length
        ? `미리보기에서 geometry 문제 ${validationIssues.length}건을 찾았습니다.`
        : '변경 결과 미리보기를 준비했습니다.', validationIssues.length ? 'error' : 'success', 3600);
      return true;
    } catch (error) {
      if (requestId) mapEditClient.discard(requestId);
      if (!error?.cancelled) onError(error);
      else setActionStatus('지도 작업을 취소했습니다.', 'success', 2200);
      return false;
    }
  }

  function beginLocalGeometryPreview({
    operation,
    beforeFeatures = [],
    afterFeatures = [],
    removedIds = [],
    transferredGeometry = null,
    snapshot = snapshotEditable(),
    applyResult,
    successMessage = '변경을 적용했습니다.',
    errorMessage = '변경을 적용하지 못했습니다.',
  }) {
    discardActiveGeometryPreview({ announce: false });
    const baseDataRevision = state.stateRevision;
    const issues = afterFeatures.flatMap(feature => validateStructuredGeometry(feature));
    const preview = buildGeometryPreview({ operation, beforeFeatures, afterFeatures, removedIds, clipper: window.polygonClipping, transferredGeometry });
    const session = beginGeometryPreview(state.geometryPreview, {
      operation,
      baseDataRevision,
      affectedIds: [...new Set([...beforeFeatures, ...afterFeatures].map(feature => String(feature?.id || '')).filter(Boolean))],
      beforeFeatures,
      afterFeatures,
      removedIds,
      ...preview,
      validation: { issues, blocking: issues.some(issue => issue.severity !== 'warning') },
    });
    activeGeometryPreviewDiscard = null;
    activeGeometryPreviewApply = async () => {
      if (!previewIsCurrent(state.geometryPreview, session.sessionId, baseDataRevision) || state.stateRevision !== baseDataRevision) {
        clearGeometryPreview(state.geometryPreview);
        activeGeometryPreviewApply = null;
        renderingDomain?.invalidateGpuInteraction?.('local-geometry-preview-cancelled');
        updateModeButtons();
        setActionStatus('지도가 바뀌어 미리보기를 취소했습니다.', 'error', 3600);
        return false;
      }
      if (session.validation?.blocking) {
        setActionStatus('미리보기 형상을 수정하세요.', 'error', 3400);
        return false;
      }
      clearGeometryPreview(state.geometryPreview);
      activeGeometryPreviewApply = null;
      activeGeometryPreviewDiscard = null;
      try {
        await applyResult();
        assertCurrentProjectReferences();
        state.stateRevision += 1;
        projectDomain.queueAutosave();
        renderingDomain?.invalidateGenericPatch?.('local-geometry-preview-applied');
        updateModeButtons();
        setActionStatus(successMessage, 'success', 3600);
        return true;
      } catch (error) {
        restoreCountryEditSnapshot(snapshot);
        reportOperationError(error, errorMessage, 'PL-PREVIEW-001', 4400);
        return false;
      }
    };
    renderingDomain?.invalidateGpuInteraction?.('local-geometry-preview-ready');
    updateModeButtons();
    const blockingIssue = issues.find(issue => issue.severity !== 'warning');
    setModeBanner(blockingIssue?.message || '변경 결과를 확인한 뒤 적용하세요.');
    if (blockingIssue) $('modeTaskInstruction')?.classList.add('cut-invalid');
    return true;
  }

  async function applyActiveGeometryPreview() {
    if (!activeGeometryPreviewApply) return false;
    return activeGeometryPreviewApply();
  }

  function discardActiveGeometryPreview({ announce = true } = {}) {
    if (!state.geometryPreview.session) return false;
    activeGeometryPreviewDiscard?.();
    activeGeometryPreviewApply = null;
    activeGeometryPreviewDiscard = null;
    clearGeometryPreview(state.geometryPreview);
    renderingDomain?.invalidateGpuInteraction?.('geometry-preview-discard');
    updateModeButtons();
    if (announce) setActionStatus('미리보기를 닫았습니다.', 'success', 2600);
    return true;
  }

  function activeCountryBoundaryPlan() {
    if (state.tool === 'country-border' && state.boundaryEditPhase === 'editing') {
      return { mode: 'border', ...planSharedBoundaryEdit(state.sharedBoundaryTopology, state.boundaryEditCountryIds) };
    }
    if (state.tool === 'country-coast' && state.coastEditCountryId) {
      return { mode: 'coast', ...planCoastEdit(state.sharedBoundaryTopology, state.coastEditCountryId) };
    }
    return null;
  }

  function getCountryBoundaryHandles() {
    const plan = activeCountryBoundaryPlan();
    if (!plan) return [];
    const allowedIds = new Set(plan.mode === 'border' ? state.boundaryEditCountryIds.map(String) : [String(state.coastEditCountryId)]);
    const scope = state.coastEditScopeGenericFeatureId
      ? state.genericFeatures.find(item => String(item.id) === String(state.coastEditScopeGenericFeatureId))
      : null;
    const handles = [];
    const nodeKeys = new Set([...plan.editableNodeKeys, ...plan.fixedNodeKeys]);
    for (const nodeKey of nodeKeys) {
      const node = state.sharedBoundaryTopology?.nodes?.get?.(nodeKey);
      if (!node) continue;
      const ref = node.refs.find(item => allowedIds.has(String(item.featureId)))
        || node.virtualRefs?.find(item => allowedIds.has(String(item.featureId)));
      if (!ref) continue;
      if (scope && !pointInGenericFeature(node.coordinate, genericFeatureDisplayFeature(scope))) continue;
      handles.push({
        key: `${ref.polygonIndex}:${ref.ringIndex}:${ref.vertexIndex ?? ref.segmentIndex}`,
        polygonIndex: ref.polygonIndex,
        ringIndex: ref.ringIndex,
        index: ref.vertexIndex ?? ref.segmentIndex,
        nodeKey: node.key,
        coord: node.coordinate,
        boundaryKind: node.kind === 'coast' ? 'coast' : 'shared',
        ownerIds: [...node.ownerIds],
        fixed: plan.fixedNodeKeys.has(node.key),
      });
    }
    return handles;
  }

  function getCountryBoundarySegments() {
    const plan = activeCountryBoundaryPlan();
    if (!plan) return [];
    const result = [];
    for (const segmentKey of plan.segmentKeys) {
      const edge = state.sharedBoundaryTopology?.segments?.get?.(segmentKey);
      if (!edge) continue;
      result.push({
        key: edge.key,
        kind: plan.mode === 'border' ? 'shared' : 'coast',
        geometry: { type: 'LineString', coordinates: [edge.a, edge.b] },
      });
    }
    return result;
  }

  function geometryMultiCoordinates(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return [geometry.coordinates || []];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates || [];
    return [];
  }

  function multiPolygonPlanarArea(multiPolygon) {
    return (multiPolygon || []).reduce((total, polygon) => {
      if (!polygon?.length) return total;
      const exterior = Math.abs(ringSignedArea(ensureClosedRing(polygon[0])));
      const holes = polygon.slice(1).reduce((sum, ring) => sum + Math.abs(ringSignedArea(ensureClosedRing(ring))), 0);
      return total + Math.max(0, exterior - holes);
    }, 0);
  }

  function territoryComponentKey(countryId, polygonIndex) {
    return `component:${String(countryId)}:${Number(polygonIndex)}`;
  }

  function territoryComponentContext() {
    if (state.tool === 'annex-territory') {
      const donorIds = new Set(state.annexDonorCountryIds.map(String));
      return {
        selectedKeys: state.annexSelectedComponentKeys,
        features: (state.countriesData?.features || []).filter(feature => donorIds.has(String(feature?.id || ''))),
      };
    }
    if (state.tool === 'new-country') {
      const sourceIds = new Set(state.newCountrySourceIds.map(String));
      return {
        selectedKeys: state.newCountrySelectedComponentKeys,
        features: (state.countriesData?.features || []).filter(feature => sourceIds.has(String(feature?.id || ''))),
      };
    }
    return { selectedKeys: [], features: [] };
  }

  function territoryBaseComponentItems(context = territoryComponentContext()) {
    const items = [];
    for (const feature of context.features) {
      const countryId = String(feature?.id || '');
      geometryPolygonSets(feature.geometry).forEach((polygon, polygonIndex) => {
        const geometry = normalizeClippedLandGeometry([deepClone(polygon)]);
        if (!geometry) return;
        const key = territoryComponentKey(countryId, polygonIndex);
        const areaKm2 = Math.max(0, d3.geo.area(geometry) * 6371.0088 * 6371.0088);
        items.push({
          key, countryId, polygonIndex, componentKey: `${countryId}:${polygonIndex}`, geometry, areaKm2,
          countryName: countryName(feature),
        });
      });
    }
    return items;
  }

  function annexRiverBoundaryComposition(baseItems = territoryBaseComponentItems()) {
    return composeRiverBoundaryTerritoryComponents({
      components: baseItems,
      candidates: state.annexRiverPartitionCandidates,
      donorResults: state.annexRiverPartitionDonorResults,
    });
  }

  function territoryComponentItems() {
    const context = territoryComponentContext();
    const selected = new Set(context.selectedKeys);
    const baseItems = territoryBaseComponentItems(context);
    let items = baseItems;
    if (state.tool === 'annex-territory' && state.annexUseRiverBoundaries) {
      if (state.annexRiverPartitionStatus !== 'ready') return [];
      const baseByComponent = new Map(baseItems.map(item => [item.componentKey, item]));
      items = annexRiverBoundaryComposition(baseItems).items.map(item => {
        const base = baseByComponent.get(item.componentKey);
        const geometry = item.geometry;
        const areaKm2 = Number.isFinite(Number(item.areaKm2))
          ? Number(item.areaKm2)
          : Number.isFinite(Number(item.areaM2))
            ? Math.max(0, Number(item.areaM2) / 1e6)
            : Math.max(0, d3.geo.area(geometry) * 6371.0088 * 6371.0088);
        return {
          ...item,
          key: String(item.key),
          countryName: item.countryName || base?.countryName || countryName(countryFeatureById(item.countryId)),
          areaKm2,
          usesRiverBoundary: item.partitionKind === 'river',
          riverBoundarySegments: item.riverBoundarySegments || [],
        };
      });
    }
    return items.map(item => ({ ...item, selected: selected.has(item.key) }));
  }

  function selectedTerritoryComponentItems() {
    return territoryComponentItems().filter(item => item.selected);
  }

  function selectedTerritoryComponentGeometry() {
    const clipper = window.polygonClipping;
    if (!clipper?.union) throw new Error('영토 조각 결합 엔진을 불러오지 못했습니다.');
    const selected = selectedTerritoryComponentItems();
    if (!selected.length) throw new Error('영토 조각을 하나 이상 선택하세요.');
    const union = clipper.union(...selected.map(item => geometryMultiCoordinates(item.geometry)));
    const geometry = normalizeClippedLandGeometry(union);
    if (!geometry) throw new Error('선택한 영토 조각을 결합할 수 없습니다.');
    return geometry;
  }

  function formatTerritoryArea(areaKm2) {
    const area = Math.max(0, Number(areaKm2) || 0);
    const maximumFractionDigits = area < 10 ? 2 : area < 100 ? 1 : 0;
    return `${area.toLocaleString('ko-KR', { maximumFractionDigits })} km²`;
  }

  function countryUnionFromFeatures(features, ids) {
    const clipper = window.polygonClipping;
    const wanted = new Set([...ids].map(String));
    const pieces = (features || [])
      .filter(feature => wanted.has(String(feature?.id || '')))
      .map(feature => feature.geometry?.coordinates)
      .filter(Boolean);
    if (!pieces.length) return [];
    return clipper.union(...pieces);
  }

  function unwrapRingLongitudes(rawRing) {
    const ring = ensureClosedRing(rawRing);
    if (!ring.length) return [];
    const out = [[ring[0][0], ring[0][1]]];
    for (let i = 1; i < ring.length; i += 1) {
      let lon = ring[i][0];
      const previous = out[i - 1][0];
      while (lon - previous > 180) lon -= 360;
      while (lon - previous < -180) lon += 360;
      out.push([lon, ring[i][1]]);
    }
    return out;
  }

  function orientation2d(a, b, c) {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }

  function segmentsProperlyIntersect(a, b, c, d, epsilon = 1e-10) {
    const abC = orientation2d(a, b, c);
    const abD = orientation2d(a, b, d);
    const cdA = orientation2d(c, d, a);
    const cdB = orientation2d(c, d, b);
    return ((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon)) &&
      ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon));
  }

  function ringHasSelfIntersection(rawRing) {
    const ring = unwrapRingLongitudes(rawRing);
    const segmentCount = Math.max(0, ring.length - 1);
    if (segmentCount < 4) return false;
    const segments = [];
    for (let index = 0; index < segmentCount; index += 1) {
      const a = ring[index], b = ring[index + 1];
      segments.push({
        index, a, b,
        minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]),
        minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]),
      });
    }
    segments.sort((a, b) => a.minX - b.minX || a.minY - b.minY || a.index - b.index);
    let active = [];
    for (const segment of segments) {
      active = active.filter(other => other.maxX >= segment.minX);
      for (const other of active) {
        if (Math.abs(segment.index - other.index) <= 1 ||
            (Math.min(segment.index, other.index) === 0 && Math.max(segment.index, other.index) === segmentCount - 1)) continue;
        if (other.maxY < segment.minY || other.minY > segment.maxY) continue;
        if (segmentsProperlyIntersect(segment.a, segment.b, other.a, other.b)) return true;
      }
      active.push(segment);
    }
    return false;
  }

  function countryGeometryIsValid(geometry) {
    const polygons = geometryMultiCoordinates(geometry);
    if (!polygons.length) return false;
    return polygons.every(polygon => polygon?.length && polygon.every(ring => {
      const closed = ensureClosedRing(ring);
      const unique = new Set(closed.slice(0, -1).map(coord => coordKey(coord, 8)));
      return closed.length >= 4 && unique.size >= 3 &&
        coordNear(closed[0], closed[closed.length - 1], 1e-9) &&
        Math.abs(ringSignedArea(closed)) > 1e-14 &&
        !ringHasSelfIntersection(closed);
    }));
  }

  function snapGeometryToGrid(geometry, precision = 7) {
    if (!geometry?.coordinates) return geometry;
    const factor = 10 ** precision;
    const snap = value => {
      if (Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
        return [Math.round(Number(value[0]) * factor) / factor, Math.round(Number(value[1]) * factor) / factor];
      }
      return Array.isArray(value) ? value.map(snap) : value;
    };
    return { ...geometry, coordinates: snap(geometry.coordinates) };
  }

  function validateCountryGeometryEdit(affectedIds, baselineOrUnion = null, { featureOverrides = null } = {}) {
    const clipper = window.polygonClipping;
    const affected = new Set([...affectedIds].map(String));
    const baseline = baselineOrUnion?.union
      ? baselineOrUnion
      : { union: baselineOrUnion, overlaps: new Map(), boundaryLength: 0 };
    const areaTolerance = Math.max(1e-8, Number(baseline.boundaryLength || 0) * 2e-7);
    const overrideMap = featureOverrides instanceof Map ? featureOverrides : new Map();
    const features = (state.countriesData?.features || []).map(feature => (
      overrideMap.get(String(feature?.id || '')) || feature
    ));
    const ids = features.map(feature => String(feature?.id || ''));
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) {
      return { ok: false, message: '국가 ID가 비어 있거나 중복되었습니다.' };
    }
    for (const feature of features) {
      const id = String(feature?.id || '');
      if (affected.has(id) && !countryGeometryIsValid(feature.geometry)) {
        return { ok: false, message: `${countryName(feature)}의 경계가 유효하지 않습니다.` };
      }
    }

    const tested = new Set();
    for (const feature of features) {
      const id = String(feature?.id || '');
      if (!affected.has(id)) continue;
      const bounds = geometryBounds(feature.geometry);
      const nearby = overrideMap.size
        ? features.filter(other => boundsOverlap(bounds, geometryBounds(other.geometry)))
        : spatialFeatures(bounds);
      for (const other of nearby) {
        const otherId = String(other?.id || '');
        if (id === otherId) continue;
        const pairKey = id < otherId ? `${id}|${otherId}` : `${otherId}|${id}`;
        if (tested.has(pairKey)) continue;
        tested.add(pairKey);
        const overlapArea = multiPolygonPlanarArea(clipper.intersection(feature.geometry.coordinates, other.geometry.coordinates));
        const previousArea = Number(baseline.overlaps?.get(pairKey) || 0);
        if (overlapArea > previousArea + areaTolerance) {
          return { ok: false, message: `${countryName(feature)}과(와) ${countryName(other)} 사이에 ${(overlapArea - previousArea).toExponential(3)}deg²의 새 중첩이 생겼습니다. 편입 영역을 줄이거나 국경선을 다시 지정하세요.` };
        }
      }
    }

    if (baseline.union) {
      const unionAfter = countryUnionFromFeatures(features, affected);
      const changedArea = multiPolygonPlanarArea(clipper.xor(baseline.union, unionAfter));
      if (changedArea > areaTolerance) return { ok: false, message: `편집 영역에 ${changedArea.toExponential(3)}deg²의 새 빈틈 또는 면적 변화가 생겼습니다. 편입선을 다시 지정하세요.` };
    }
    return { ok: true };
  }

  function captureCountryGeometryValidationBaseline(affectedIds) {
    const ids = new Set([...affectedIds].map(String));
    const features = state.countriesData?.features || [];
    const clipper = window.polygonClipping;
    const overlaps = new Map();
    let boundaryLength = 0;
    for (const feature of features) {
      const id = String(feature?.id || '');
      if (!ids.has(id)) continue;
      for (const polygon of geometryPolygonSets(feature.geometry)) for (const ring of polygon || []) {
        for (let index = 0; index < ring.length - 1; index += 1) boundaryLength += Math.hypot(ring[index + 1][0] - ring[index][0], ring[index + 1][1] - ring[index][1]);
      }
      for (const other of spatialFeatures(geometryBounds(feature.geometry))) {
        const otherId = String(other?.id || '');
        if (!otherId || otherId === id) continue;
        const pairKey = id < otherId ? `${id}|${otherId}` : `${otherId}|${id}`;
        if (overlaps.has(pairKey)) continue;
        overlaps.set(pairKey, multiPolygonPlanarArea(clipper.intersection(feature.geometry.coordinates, other.geometry.coordinates)));
      }
    }
    return { union: countryUnionFromFeatures(features, ids), overlaps, boundaryLength };
  }

  function structuredGeometryIssueKey(issue = {}) {
    const entityRefs = [...(issue.entityRefs || [])].map(String).sort().join('|');
    return [
      issue.kind || 'geometry',
      entityRefs,
      issue.polygonIndex ?? '',
      issue.ringIndex ?? '',
      issue.vertexIndex ?? '',
      issue.segmentIndex ?? '',
    ].join(':');
  }

  function restoreCountryEditSnapshot(snapshot) {
    const changedIds = new Set(state.historyDirtyCountryIds);
    applySharedProjectFields(snapshot, 'history');
    restoreCountriesFromSnapshot(snapshot);
    normalizeProjectObjects();
    const restoredDirtyIds = new Set(state.historyDirtyCountryIds);
    for (const id of state.historyDirtyCountryIds) changedIds.add(String(id));
    markCountryGeometriesChanged(changedIds);
    state.historyDirtyCountryIds = restoredDirtyIds;
    rebuildBoundaryTopology(state.tool === 'country-border' ? state.boundaryEditCountryIds : state.coastEditCountryId);
    renderingDomain?.invalidateCountryPatch?.('country-edit-snapshot-restored');
  }

  function interpolateCoordinate(a, b, t) {
    let targetLon = b[0];
    while (targetLon - a[0] > 180) targetLon -= 360;
    while (targetLon - a[0] < -180) targetLon += 360;
    let lon = a[0] + (targetLon - a[0]) * t;
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;
    return [lon, a[1] + (b[1] - a[1]) * t];
  }

  function refreshCountryCentroids(ids = null) {
    const filter = ids ? new Set([...ids].map(String)) : null;
    scheduleCountryLabelAnchors(filter, 20);
  }

  function pointOnSegment(point, a, b, tolerance = 1e-7) {
    const cross = (point[1] - a[1]) * (b[0] - a[0]) - (point[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(cross) > tolerance) return false;
    const dot = (point[0] - a[0]) * (point[0] - b[0]) + (point[1] - a[1]) * (point[1] - b[1]);
    return dot <= tolerance;
  }

  const ringHitTester = createRingHitTester(ensureClosedRing);
  function pointInRing(point, rawRing) {
    return ringHitTester.contains(point, rawRing);
  }

  function pointInPolygonSet(point, polygon) {
    if (!polygon?.length || !pointInRing(point, polygon[0])) return false;
    for (let i = 1; i < polygon.length; i += 1) if (pointInRing(point, polygon[i])) return false;
    return true;
  }

  function pointInCountryFeature(point, feature) {
    return geometryPolygonSets(feature?.geometry).some(polygon => pointInPolygonSet(point, polygon));
  }

  function pointInGenericFeature(point, feature) {
    return geometryPolygonSets(feature?.geometry).some(polygon => pointInPolygonSet(point, polygon));
  }

  function partitionGroupMatches(feature, { unitType, sovereignId, parentId = '', adminLevel = null }) {
    const expectedParentId = String(parentId || sovereignId || '');
    return feature.properties?.unitType === unitType
      && String(feature.properties?.sovereignId || '') === String(sovereignId || '')
      && String(feature.properties?.parentId || '') === expectedParentId
      && (unitType !== TERRITORIAL_UNIT_TYPES.ADMIN || Number(feature.properties?.adminLevel || 1) === Number(adminLevel || 1));
  }

  function addUnassignedTerritorialUnitGeometry(context, geometry) {
    const clipper = window.polygonClipping;
    const normalized = normalizeClippedLandGeometry(geometry?.coordinates || geometry);
    if (!normalized) return null;
    let target = state.territorialUnits.find(feature => partitionGroupMatches(feature, context)
      && feature.properties?.isRemainder === true);
    if (target) {
      target.geometry = normalizeClippedLandGeometry(clipper.union(target.geometry.coordinates, normalized.coordinates)) || target.geometry;
      return target;
    }
    target = createPartitionTerritorialFeature({
      id: uid(context.unitType === TERRITORIAL_UNIT_TYPES.ADMIN ? 'administrative' : 'territory'),
      ...context,
      isRemainder: true,
      geometry: normalized,
    });
    state.territorialUnits.push(target);
    return target;
  }

  function reconcileTerritorialUnitCompleteness(countryIds, { preserveIds = [] } = {}) {
    const clipper = window.polygonClipping;
    if (!clipper?.intersection || !clipper?.difference || !clipper?.union) return;
    const wanted = new Set([...countryIds].map(String));
    const preserved = new Set(preserveIds.map(String));
    state.territorialUnits = state.territorialUnits.flatMap(feature => {
      const countryId = String(feature.properties?.sovereignId || '');
      if (!wanted.has(countryId)) return [feature];
      if (preserved.has(String(feature.id))) return [feature];
      const container = territorialUnitContainer(feature);
      if (!container?.geometry) return [];
      const clipped = normalizeClippedLandGeometry(clipper.intersection(feature.geometry.coordinates, container.geometry.coordinates));
      if (!clipped) return [];
      feature.geometry = clipped;
      return [feature];
    });

    for (const countryId of wanted) {
      const country = countryFeatureById(countryId);
      if (!country) continue;
      const territoryGroup = state.territorialUnits.filter(feature => partitionGroupMatches(feature, {
        unitType: TERRITORIAL_UNIT_TYPES.TERRITORY, sovereignId: countryId,
      }));
      if (territoryGroup.length) {
        const covered = clipper.union(...territoryGroup.map(feature => feature.geometry.coordinates));
        const remainder = normalizeClippedLandGeometry(clipper.difference(country.geometry.coordinates, covered));
        if (remainder) addUnassignedTerritorialUnitGeometry({ unitType: TERRITORIAL_UNIT_TYPES.TERRITORY, sovereignId: countryId, parentId: '', adminLevel: null }, remainder);
      }
    }

    const groupContexts = new Map();
    for (const feature of state.territorialUnits) {
      if (feature.properties?.unitType !== TERRITORIAL_UNIT_TYPES.ADMIN || !wanted.has(String(feature.properties?.sovereignId || ''))) continue;
      const context = {
        unitType: TERRITORIAL_UNIT_TYPES.ADMIN,
        sovereignId: String(feature.properties.sovereignId || ''),
        parentId: String(feature.properties.parentId || ''),
        adminLevel: Number(feature.properties.adminLevel) || 1,
      };
      groupContexts.set(`${context.sovereignId}|${context.parentId}|${context.adminLevel}`, context);
    }
    for (const context of [...groupContexts.values()].sort((left, right) => left.adminLevel - right.adminLevel)) {
      const parent = context.parentId ? territorialUnitById(context.parentId) : countryFeatureById(context.sovereignId);
      if (!parent?.geometry) continue;
      const siblings = state.territorialUnits.filter(feature => partitionGroupMatches(feature, context));
      const covered = clipper.union(...siblings.map(feature => feature.geometry.coordinates));
      const remainder = normalizeClippedLandGeometry(clipper.difference(parent.geometry.coordinates, covered));
      if (remainder) addUnassignedTerritorialUnitGeometry(context, remainder);
    }
    state.territorialUnits = normalizeTerritorialUnits(state.territorialUnits, { countryExists: id => !!countryFeatureById(id) });
  }

  function syncHardLandDependents(ownerId, _ownerBeforeGeometry, _ownerAfterGeometry, _changedAnchor = null) {
    const beforeIds = new Set(state.territorialUnits.map(feature => String(feature.id)));
    reconcileTerritorialUnitCompleteness([ownerId]);
    markLayerTreeDirty();
    return state.territorialUnits.filter(feature => !beforeIds.has(String(feature.id))).map(feature => String(feature.id));
  }

  function transferLandDependents(transferredGeometry, sourceOwnerIds, targetOwnerId) {
    const clipper = window.polygonClipping;
    if (!transferredGeometry || !clipper?.difference) return [];
    const sources = new Set(sourceOwnerIds.map(String));
    const changedIds = [];
    state.territorialUnits = state.territorialUnits.flatMap(feature => {
      if (!sources.has(String(feature.properties?.sovereignId || ''))) return [feature];
      const remainder = normalizeClippedLandGeometry(clipper.difference(feature.geometry.coordinates, transferredGeometry.coordinates));
      changedIds.push(String(feature.id));
      if (!remainder) return [];
      feature.geometry = remainder;
      return [feature];
    });
    const targetHasTerritories = state.territorialUnits.some(feature => partitionGroupMatches(feature, {
      unitType: TERRITORIAL_UNIT_TYPES.TERRITORY, sovereignId: targetOwnerId,
    }));
    if (targetHasTerritories) addUnassignedTerritorialUnitGeometry({
      unitType: TERRITORIAL_UNIT_TYPES.TERRITORY, sovereignId: String(targetOwnerId), parentId: '', adminLevel: null,
    }, transferredGeometry);
    reconcileTerritorialUnitCompleteness([...sources, String(targetOwnerId)]);
    markLayerTreeDirty();
    return changedIds;
  }

  function reassignLandDependents(removedOwnerIds, targetOwnerId) {
    const removed = new Set(removedOwnerIds.map(String));
    for (const feature of state.territorialUnits) {
      if (!removed.has(String(feature.properties?.sovereignId || ''))) continue;
      feature.properties.sovereignId = String(targetOwnerId);
      if (removed.has(String(feature.properties?.parentId || ''))) feature.properties.parentId = String(targetOwnerId);
    }
    for (const relation of state.territorialRelations) {
      if (removed.has(String(relation.sovereignId || ''))) relation.sovereignId = String(targetOwnerId);
      if (removed.has(String(relation.parentId || ''))) relation.parentId = String(targetOwnerId);
    }
    for (const entry of state.distributionEntries) {
      if (entry.mode === DISTRIBUTION_MODES.TERRITORIAL && removed.has(String(entry.territorialUnitId))) entry.territorialUnitId = String(targetOwnerId);
    }
    state.territorialUnits = normalizeTerritorialUnits(state.territorialUnits, { countryExists: id => !!countryFeatureById(id) });
    reconcileTerritorialUnitCompleteness([targetOwnerId]);
    markLayerTreeDirty();
  }

  function reassignGenericFeatureParents(removedGenericFeatureIds, replacementId = '') {
    const removed = new Set(removedGenericFeatureIds.map(String));
    for (const feature of state.genericFeatures) {
      if (!removed.has(String(feature.properties?.parentId || ''))) continue;
      feature.properties.parentId = String(replacementId || '');
    }
  }

  function coordinateBounds(value, bounds = [Infinity, Infinity, -Infinity, -Infinity]) {
    if (!Array.isArray(value)) return bounds;
    if (value.length >= 2 && !Array.isArray(value[0]) && !Array.isArray(value[1])
      && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
      const x = Number(value[0]);
      const y = Number(value[1]);
      bounds[0] = Math.min(bounds[0], x);
      bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x);
      bounds[3] = Math.max(bounds[3], y);
      return bounds;
    }
    value.forEach(item => coordinateBounds(item, bounds));
    return bounds;
  }

  function boundsOverlap(a, b) {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
  }

  function normalizeClippedLandGeometry(multiPolygon) {
    return normalizeCountryGeometry(multiPolygon);
  }



  function pointOnRingBoundary(point, rawRing, tolerance = 1e-7) {
    const ring = ensureClosedRing(rawRing);
    for (let i = 0; i < ring.length - 1; i += 1) {
      if (pointOnSegment(point, ring[i], ring[i + 1], tolerance)) return true;
    }
    return false;
  }

  function pointInPolygonSetInterior(point, polygon) {
    if (!polygon?.length || pointOnRingBoundary(point, polygon[0])) return false;
    if (!pointInRing(point, polygon[0])) return false;
    for (let i = 1; i < polygon.length; i += 1) {
      if (pointOnRingBoundary(point, polygon[i]) || pointInRing(point, polygon[i])) return false;
    }
    return true;
  }

  function segmentsIntersectOrTouch(a, b, c, d, tolerance = 1e-9) {
    return segmentsProperlyIntersect(a, b, c, d, tolerance) ||
      pointOnSegment(a, c, d, tolerance) || pointOnSegment(b, c, d, tolerance) ||
      pointOnSegment(c, a, b, tolerance) || pointOnSegment(d, a, b, tolerance);
  }

  function lineHasSelfIntersection(coords) {
    const segmentCount = Math.max(0, (coords?.length || 0) - 1);
    for (let i = 0; i < segmentCount; i += 1) {
      for (let j = i + 1; j < segmentCount; j += 1) {
        if (Math.abs(i - j) <= 1) continue;
        if (segmentsIntersectOrTouch(coords[i], coords[i + 1], coords[j], coords[j + 1])) return true;
      }
    }
    return false;
  }


  function unwrapLongitudeNear(longitude, reference) {
    let value = Number(longitude);
    while (value - reference > 180) value -= 360;
    while (value - reference < -180) value += 360;
    return value;
  }

  function segmentIntersectionDetail(a, b, c, d, epsilon = 1e-10) {
    const p = [Number(a[0]), Number(a[1])];
    const q = [unwrapLongitudeNear(c[0], p[0]), Number(c[1])];
    const bLon = unwrapLongitudeNear(b[0], p[0]);
    let dLon = unwrapLongitudeNear(d[0], q[0]);
    const lineMid = (p[0] + bLon) / 2;
    while ((q[0] + dLon) / 2 - lineMid > 180) { q[0] -= 360; dLon -= 360; }
    while ((q[0] + dLon) / 2 - lineMid < -180) { q[0] += 360; dLon += 360; }
    const r = [bLon - p[0], Number(b[1]) - p[1]];
    const s = [dLon - q[0], Number(d[1]) - q[1]];
    const cross = (u, v) => u[0] * v[1] - u[1] * v[0];
    const qp = [q[0] - p[0], q[1] - p[1]];
    const denominator = cross(r, s);
    if (Math.abs(denominator) <= epsilon) {
      if (Math.abs(cross(qp, r)) > epsilon) return null;
      const length2 = r[0] * r[0] + r[1] * r[1];
      if (length2 <= epsilon) return null;
      const t0 = (qp[0] * r[0] + qp[1] * r[1]) / length2;
      const qd = [q[0] + s[0] - p[0], q[1] + s[1] - p[1]];
      const t1 = (qd[0] * r[0] + qd[1] * r[1]) / length2;
      const overlapStart = Math.max(0, Math.min(t0, t1));
      const overlapEnd = Math.min(1, Math.max(t0, t1));
      return overlapEnd - overlapStart > epsilon ? { overlap: true } : null;
    }
    const lineT = cross(qp, s) / denominator;
    const boundaryT = cross(qp, r) / denominator;
    if (lineT < -epsilon || lineT > 1 + epsilon || boundaryT < -epsilon || boundaryT > 1 + epsilon) return null;
    const t = clamp(lineT, 0, 1);
    return {
      overlap: false,
      lineT: t,
      boundaryT: clamp(boundaryT, 0, 1),
      coord: interpolateCoordinate(a, b, t),
    };
  }

  function coordinateAtPathPosition(rawLine, position) {
    const maxPosition = Math.max(0, rawLine.length - 1);
    const bounded = clamp(position, 0, maxPosition);
    if (bounded >= maxPosition) return rawLine[rawLine.length - 1].slice();
    const segmentIndex = Math.floor(bounded);
    return interpolateCoordinate(rawLine[segmentIndex], rawLine[segmentIndex + 1], bounded - segmentIndex);
  }

  function interiorComponentIndex(point, polygons) {
    for (let index = 0; index < polygons.length; index += 1) {
      if (pointInPolygonSetInterior(point, polygons[index])) return index;
    }
    return null;
  }

  function activeCutDraftSourceGeometry() {
    if (state.tool === 'split-generic-feature') {
      return state.genericFeatures.find(item => String(item.id) === String(state.genericFeatureSplitSourceId))?.geometry || null;
    }
    if (state.tool === 'split-territorial-unit') {
      return (territorialUnitById(state.territorialUnitSplitSourceId) || state.territorialUnitSplitVirtualSource)?.geometry || null;
    }
    if (state.tool === 'annex-territory' && state.annexPhase === 'line') return state.annexSourceGeometry;
    if (state.tool === 'new-country' && state.newCountryPhase === 'line') return state.newCountrySourceGeometry;
    return null;
  }

  function cutEndpointSnapDistance() {
    const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches;
    return coarsePointer ? CUT_ENDPOINT_SNAP_DISTANCE.touch : CUT_ENDPOINT_SNAP_DISTANCE.mouse;
  }

  function snapCutDraftLine(rawLine, sourceGeometry) {
    return snapLineEndpointsToBoundary(rawLine, sourceGeometry, {
      project: coordinate => activeProjection()(coordinate),
      maxDistance: cutEndpointSnapDistance(),
      isVisible: isCoordVisible,
      maxSegmentLength: Math.max(1, state.size.width * 0.7),
    });
  }

  function cutDraftErrorMessage(line, sourceGeometry, originalError) {
    const fallback = String(originalError?.message || '경계선을 사용할 수 없습니다.');
    if (!Array.isArray(line) || line.length < 2) return '경계선을 만들려면 점을 두 개 이상 입력하세요.';
    const polygons = geometryPolygonSets(sourceGeometry);
    if (!polygons.length) return fallback;
    let events;
    try { events = collectCutBoundaryEvents(line, polygons); }
    catch (_) { return fallback; }
    if (events.length > 2) return '경계를 여러 번 가로지릅니다. 한 번만 관통하세요.';
    const startInside = interiorComponentIndex(line[0], polygons) !== null;
    const endInside = interiorComponentIndex(line[line.length - 1], polygons) !== null;
    if (startInside && endInside) return '시작점과 끝점을 영역 밖에 놓으세요.';
    if (startInside) return '시작점을 영역 밖에 놓으세요.';
    if (endInside) return '끝점을 영역 밖에 놓으세요.';
    if (events.length === 0) return '영역을 통과하지 않습니다. 양쪽 경계를 가로지르세요.';
    if (events.length === 1) return '한쪽 경계만 연결됐습니다. 반대쪽 경계까지 그리세요.';
    return fallback;
  }

  function draftSelfIntersectionIssue(coords, closed = false) {
    const points = (coords || []).map(coord => coord.slice());
    if (closed && points.length >= 3) points.push(points[0].slice());
    const segmentCount = Math.max(0, points.length - 1);
    for (let left = 0; left < segmentCount; left += 1) {
      for (let right = left + 1; right < segmentCount; right += 1) {
        if (Math.abs(left - right) <= 1 || (closed && left === 0 && right === segmentCount - 1)) continue;
        const detail = segmentIntersectionDetail(points[left], points[left + 1], points[right], points[right + 1]);
        if (!detail) continue;
        return {
          kind: detail.overlap ? 'segment-overlap' : 'self-intersection',
          coordinate: detail.coord || interpolateCoordinate(points[left], points[left + 1], 0.5),
          segmentIndex: left,
        };
      }
    }
    return null;
  }

  function cutDraftIssues(line, sourceGeometry, originalError) {
    if (!Array.isArray(line) || line.length < 2) return [];
    const message = cutDraftErrorMessage(line, sourceGeometry, originalError);
    const issues = [];
    for (let index = 1; index < line.length; index += 1) {
      if (!coordNear(line[index - 1], line[index], 1e-9)) continue;
      issues.push({ kind: 'duplicate-vertex', coordinate: line[index].slice(), vertexIndex: index, segmentIndex: index - 1, message });
      return issues;
    }
    const selfIntersection = draftSelfIntersectionIssue(line, false);
    if (selfIntersection) {
      issues.push({ ...selfIntersection, message });
      return issues;
    }
    const polygons = geometryPolygonSets(sourceGeometry);
    if (!polygons.length) return [{ kind: 'invalid-cut', coordinate: line[Math.floor((line.length - 1) / 2)].slice(), message }];
    const startInside = interiorComponentIndex(line[0], polygons) !== null;
    const endInside = interiorComponentIndex(line[line.length - 1], polygons) !== null;
    if (startInside) issues.push({ kind: 'endpoint-inside', coordinate: line[0].slice(), vertexIndex: 0, message });
    if (endInside) issues.push({ kind: 'endpoint-inside', coordinate: line[line.length - 1].slice(), vertexIndex: line.length - 1, message });
    if (issues.length) return issues;
    let events;
    try { events = collectCutBoundaryEvents(line, polygons); }
    catch (_) {
      return [{
        kind: 'boundary-overlap',
        coordinate: interpolateCoordinate(line[0], line[1], 0.5),
        segmentIndex: 0,
        message,
      }];
    }
    if (events.length > 2) {
      return events.slice(2).map(event => ({
        kind: 'extra-boundary-crossing',
        coordinate: event.coord.slice(),
        segmentIndex: Math.min(line.length - 2, Math.max(0, Math.floor(event.position))),
        message,
      }));
    }
    if (events.length === 1) {
      const event = events[0];
      const distanceToStart = Math.abs(event.position);
      const distanceToEnd = Math.abs((line.length - 1) - event.position);
      const vertexIndex = distanceToStart > distanceToEnd ? 0 : line.length - 1;
      return [{ kind: 'missing-boundary-connection', coordinate: line[vertexIndex].slice(), vertexIndex, message }];
    }
    if (events.length === 2) {
      const middlePosition = (events[0].position + events[1].position) / 2;
      const middle = coordinateAtPathPosition(line, middlePosition);
      const componentIndex = interiorComponentIndex(middle, polygons);
      if (componentIndex !== null) {
        const component = polygons[componentIndex];
        for (let index = 1; index < line.length - 1; index += 1) {
          if (pointInPolygonSetInterior(line[index], component)) continue;
          return [{ kind: 'intermediate-outside', coordinate: line[index].slice(), vertexIndex: index, message }];
        }
        for (let index = 0; index < line.length - 1; index += 1) {
          const a = line[index], b = line[index + 1];
          const projectedA = activeProjection()(a);
          const projectedB = activeProjection()(b);
          const screenLength = projectedA && projectedB ? Math.hypot(projectedB[0] - projectedA[0], projectedB[1] - projectedA[1]) : 120;
          const samples = clamp(Math.ceil(screenLength / 8), 12, 80);
          for (let sample = 1; sample < samples; sample += 1) {
            const coordinate = interpolateCoordinate(a, b, sample / samples);
            if (pointInPolygonSetInterior(coordinate, component)) continue;
            return [{ kind: 'segment-outside', coordinate, segmentIndex: index, message }];
          }
        }
      }
    }
    const middleSegmentIndex = Math.max(0, Math.min(line.length - 2, Math.floor((line.length - 2) / 2)));
    return [{
      kind: events.length ? 'invalid-cut' : 'no-boundary-crossing',
      coordinate: interpolateCoordinate(line[middleSegmentIndex], line[middleSegmentIndex + 1], 0.5),
      segmentIndex: middleSegmentIndex,
      message,
    }];
  }

  function prepareCutDraft(rawLine, sourceGeometry) {
    const snapped = snapCutDraftLine(rawLine, sourceGeometry);
    try {
      const extracted = extractSingleInteriorCut(snapped.line, sourceGeometry);
      validateAnnexCutLine(extracted.cutLine, extracted.component);
      return { ...snapped, extracted };
    } catch (error) {
      throw new Error(cutDraftErrorMessage(snapped.line, sourceGeometry, error), { cause: error });
    }
  }

  function assessCutDraft(rawLine, sourceGeometry) {
    const snapped = snapCutDraftLine(rawLine, sourceGeometry);
    if (snapped.line.length < 2) {
      return { ...snapped, status: 'pending', valid: false, message: '', issues: [] };
    }
    try {
      const extracted = extractSingleInteriorCut(snapped.line, sourceGeometry);
      validateAnnexCutLine(extracted.cutLine, extracted.component);
      return { ...snapped, extracted, status: 'valid', valid: true, message: '', issues: [] };
    } catch (error) {
      const message = cutDraftErrorMessage(snapped.line, sourceGeometry, error);
      return {
        ...snapped,
        status: 'invalid',
        valid: false,
        message,
        issues: cutDraftIssues(snapped.line, sourceGeometry, error),
      };
    }
  }

  function collectCutBoundaryEvents(rawLine, polygons) {
    const events = [];
    for (let lineIndex = 0; lineIndex < rawLine.length - 1; lineIndex += 1) {
      const a = rawLine[lineIndex], b = rawLine[lineIndex + 1];
      if (coordNear(a, b, 1e-10)) continue;
      polygons.forEach((polygon, polygonIndex) => {
        polygon.forEach((rawRing, ringIndex) => {
          const ring = ensureClosedRing(rawRing);
          for (let boundarySegmentIndex = 0; boundarySegmentIndex < ring.length - 1; boundarySegmentIndex += 1) {
            const detail = segmentIntersectionDetail(a, b, ring[boundarySegmentIndex], ring[boundarySegmentIndex + 1]);
            if (!detail) continue;
            if (detail.overlap) throw new Error('국경선을 기존 경계와 겹쳐 그릴 수 없습니다.');
            events.push({
              position: lineIndex + detail.lineT,
              coord: detail.coord,
              ref: { polygonIndex, ringIndex, boundarySegmentIndex, boundaryT: detail.boundaryT },
            });
          }
        });
      });
    }
    events.sort((a, b) => a.position - b.position);
    const unique = [];
    for (const event of events) {
      const previous = unique[unique.length - 1];
      if (previous && Math.abs(previous.position - event.position) <= 1e-7 && coordNear(previous.coord, event.coord, 1e-7)) {
        previous.refs.push(event.ref);
      } else {
        unique.push({ position: event.position, coord: event.coord.slice(), refs: [event.ref] });
      }
    }
    return unique;
  }

  function extractSingleInteriorCut(rawLine, sourceGeometry) {
    const line = (rawLine || []).map(coord => [Number(coord[0]), Number(coord[1])]);
    if (line.length < 2) throw new Error('새 국경선에는 두 점 이상이 필요합니다.');
    const polygons = geometryPolygonSets(sourceGeometry);
    if (!polygons.length) throw new Error('분할할 영토를 찾을 수 없습니다.');
    const events = collectCutBoundaryEvents(line, polygons);
    if (events.length !== 2) {
      throw new Error('국경선은 선택 영토의 한 연결 조각을 정확히 한 번만 관통해야 합니다.');
    }
    const [entry, exit] = events;
    if (exit.position - entry.position <= 1e-7) throw new Error('국경선의 내부 구간이 너무 짧습니다.');
    const middle = coordinateAtPathPosition(line, (entry.position + exit.position) / 2);
    const componentIndex = interiorComponentIndex(middle, polygons);
    if (componentIndex === null) throw new Error('두 국경 교차점 사이에 유효한 내부 구간이 없습니다.');
    if (entry.position > 1e-7) {
      const before = coordinateAtPathPosition(line, entry.position / 2);
      if (interiorComponentIndex(before, polygons) !== null) throw new Error('국경선은 선택 영토 밖이나 경계에서 시작하세요.');
    }
    const maxPosition = line.length - 1;
    if (exit.position < maxPosition - 1e-7) {
      const after = coordinateAtPathPosition(line, (exit.position + maxPosition) / 2);
      if (interiorComponentIndex(after, polygons) !== null) throw new Error('국경선은 선택 영토 밖이나 경계에서 끝내세요.');
    }
    const entryRef = entry.refs.find(ref => ref.polygonIndex === componentIndex && ref.ringIndex === 0);
    const exitRef = exit.refs.find(ref => ref.polygonIndex === componentIndex && ref.ringIndex === 0);
    if (!entryRef || !exitRef) throw new Error('국경선은 같은 영토 조각의 외곽 경계를 관통해야 합니다.');

    const cutLine = [entry.coord.slice()];
    for (let vertexIndex = 1; vertexIndex < line.length - 1; vertexIndex += 1) {
      if (vertexIndex > entry.position + 1e-7 && vertexIndex < exit.position - 1e-7) cutLine.push(line[vertexIndex].slice());
    }
    if (!coordNear(cutLine[cutLine.length - 1], exit.coord, 1e-9)) cutLine.push(exit.coord.slice());
    return {
      polygons,
      componentIndex,
      component: polygons[componentIndex],
      cutLine,
      firstEndpoint: {
        coord: entry.coord.slice(), segmentIndex: entryRef.boundarySegmentIndex, t: entryRef.boundaryT,
      },
      lastEndpoint: {
        coord: exit.coord.slice(), segmentIndex: exitRef.boundarySegmentIndex, t: exitRef.boundaryT,
      },
    };
  }

  function augmentedRingWithCutEndpoints(rawRing, firstEndpoint, lastEndpoint) {
    const open = ensureClosedRing(rawRing).slice(0, -1).map(coord => coord.slice());
    const insertions = new Map();
    for (const endpoint of [firstEndpoint, lastEndpoint]) {
      if (endpoint.t <= 0.002 || endpoint.t >= 0.998) continue;
      if (!insertions.has(endpoint.segmentIndex)) insertions.set(endpoint.segmentIndex, []);
      insertions.get(endpoint.segmentIndex).push({ t: endpoint.t, coord: endpoint.coord.slice() });
    }
    const augmented = [];
    for (let i = 0; i < open.length; i += 1) {
      augmented.push(open[i].slice());
      const additions = (insertions.get(i) || []).sort((a, b) => a.t - b.t);
      for (const addition of additions) {
        if (!coordNear(augmented[augmented.length - 1], addition.coord, 1e-9)) augmented.push(addition.coord.slice());
      }
    }
    const firstIndex = augmented.findIndex(coord => coordNear(coord, firstEndpoint.coord, 1e-7));
    const lastIndex = augmented.findIndex(coord => coordNear(coord, lastEndpoint.coord, 1e-7));
    if (firstIndex < 0 || lastIndex < 0 || firstIndex === lastIndex) {
      throw new Error('편입선의 양 끝점을 영토를 가져올 국가의 경계에서 구분할 수 없습니다.');
    }
    return { ring: augmented, firstIndex, lastIndex };
  }

  function walkRingArc(ring, startIndex, endIndex, step) {
    const result = [ring[startIndex].slice()];
    let index = startIndex;
    let guard = 0;
    while (index !== endIndex && guard++ <= ring.length + 1) {
      index = (index + step + ring.length) % ring.length;
      result.push(ring[index].slice());
    }
    if (index !== endIndex) throw new Error('영토를 가져올 국가의 경계 경로를 만들 수 없습니다.');
    return result;
  }

  function validateAnnexCutLine(cutLine, component) {
    if (!Array.isArray(cutLine) || cutLine.length < 2) throw new Error('새 국경선에는 두 점 이상이 필요합니다.');
    const unique = new Set(cutLine.map(coord => coordKey(coord, 8)));
    if (unique.size < 2 || cutLine.some((coord, index) => index > 0 && coordNear(coord, cutLine[index - 1], 1e-9))) {
      throw new Error('서로 다른 위치를 연결하세요.');
    }
    if (lineHasSelfIntersection(cutLine)) throw new Error('새 국경선이 자기 자신과 교차합니다.');
    for (let i = 1; i < cutLine.length - 1; i += 1) {
      if (!pointInPolygonSetInterior(cutLine[i], component)) {
        throw new Error('중간 국경점은 영토를 가져올 국가의 내부에 놓아야 합니다.');
      }
    }
    for (let i = 0; i < cutLine.length - 1; i += 1) {
      const a = cutLine[i], b = cutLine[i + 1];
      const projectedA = activeProjection()(a);
      const projectedB = activeProjection()(b);
      const screenLength = projectedA && projectedB ? Math.hypot(projectedB[0] - projectedA[0], projectedB[1] - projectedA[1]) : 120;
      const samples = clamp(Math.ceil(screenLength / 5), 24, 160);
      for (let sample = 1; sample < samples; sample += 1) {
        const point = interpolateCoordinate(a, b, sample / samples);
        if (!pointInPolygonSetInterior(point, component)) {
          throw new Error('새 국경선은 영토를 가져올 국가의 밖이나 호수·구멍을 통과할 수 없습니다.');
        }
      }
      for (const ring of component) {
        const closed = ensureClosedRing(ring);
        for (let j = 0; j < closed.length - 1; j += 1) {
          if (segmentsProperlyIntersect(a, b, closed[j], closed[j + 1])) {
            throw new Error('새 국경선이 영토를 가져올 국가의 경계를 중간에서 가로지릅니다.');
          }
        }
      }
    }
  }

  function buildCutSplitCandidates(sourceGeometry, rawLine) {
    const clipper = window.polygonClipping;
    if (!clipper?.intersection || !clipper?.union || !clipper?.xor) throw new Error('영토 편입 엔진을 불러오지 못했습니다.');
    if (!sourceGeometry || !['Polygon', 'MultiPolygon'].includes(sourceGeometry.type)) throw new Error('분할할 영토를 찾을 수 없습니다.');
    const { extracted } = prepareCutDraft(rawLine, sourceGeometry);
    const { component, componentIndex, cutLine, firstEndpoint, lastEndpoint } = extracted;
    if (coordNear(firstEndpoint.coord, lastEndpoint.coord, 1e-7)) throw new Error('국경선의 양 끝점이 너무 가깝습니다.');
    validateAnnexCutLine(cutLine, component);

    const augmented = augmentedRingWithCutEndpoints(component[0], firstEndpoint, lastEndpoint);
    const forwardArc = walkRingArc(augmented.ring, augmented.firstIndex, augmented.lastIndex, 1);
    const backwardArc = walkRingArc(augmented.ring, augmented.firstIndex, augmented.lastIndex, -1);
    const candidateRings = [forwardArc, backwardArc].map(arc =>
      ensureClosedRing([...cutLine.map(coord => coord.slice()), ...arc.slice(1, -1).reverse().map(coord => coord.slice())])
    );
    if (candidateRings.some(ring => Math.abs(ringSignedArea(ring)) <= 1e-14 || ringHasSelfIntersection(ring))) {
      throw new Error('새 국경선으로 유효한 두 영토를 만들 수 없습니다.');
    }

    const candidates = candidateRings.map(ring => normalizeClippedLandGeometry(clipper.intersection([ring], component)));
    if (candidates.some(candidate => !candidate)) throw new Error('새 국경선 한쪽에 유효한 영토가 없습니다.');
    const componentArea = multiPolygonPlanarArea([component]);
    const areas = candidates.map(candidate => multiPolygonPlanarArea(geometryMultiCoordinates(candidate)));
    const tolerance = Math.max(1e-10, componentArea * 1e-10);
    if (areas.some(area => area <= tolerance)) throw new Error('새 국경선 한쪽 영토가 너무 작거나 비어 있습니다.');
    const overlapArea = multiPolygonPlanarArea(clipper.intersection(candidates[0].coordinates, candidates[1].coordinates));
    const combined = clipper.union(candidates[0].coordinates, candidates[1].coordinates);
    const missingArea = multiPolygonPlanarArea(clipper.xor(component, combined));
    if (overlapArea > tolerance || missingArea > tolerance) throw new Error('새 국경선이 영토를 가져올 국가를 정확히 두 영역으로 나누지 못했습니다.');

    return {
      componentIndex,
      cutLine,
      candidates: candidates.map((geometry, index) => ({ geometry, area: areas[index] })),
    };
  }

  function selectedCountryUnionGeometry(sourceIds) {
    const ids = new Set((sourceIds || []).map(String));
    if (!ids.size) throw new Error('영토를 가져올 국가를 하나 이상 선택하세요.');
    const union = countryUnionFromFeatures(state.countriesData?.features || [], ids);
    const geometry = normalizeClippedLandGeometry(union);
    if (!geometry) throw new Error('선택 국가의 영토 합집합을 만들 수 없습니다.');
    return geometry;
  }



  function applyWorkerCountryPatches(result) {
    const updates = new Map((result.features || []).map(feature => {
      const next = deepClone(feature);
      const normalizedGeometry = normalizeCountryGeometry(next.geometry);
      if (!normalizedGeometry) throw new Error(`${countryName(next)}의 편집 결과가 유효하지 않습니다.`);
      next.geometry = normalizedGeometry;
      return [String(next.id || ''), next];
    }));
    const removed = new Set((result.removedIds || []).map(String));
    state.countriesData.features = state.countriesData.features.flatMap(feature => {
      const id = String(feature.id || '');
      if (removed.has(id)) {
        delete state.countryOverrides[id];
        return [];
      }
      if (updates.has(id)) {
        const next = updates.get(id);
        updates.delete(id);
        return [next];
      }
      return [feature];
    });
    for (const feature of updates.values()) state.countriesData.features.push(feature);
    reindexCountries(state.countriesData, true);
    applyingMapEditWorkerResult = true;
    try {
      markCountryGeometriesChanged(new Set(result.affectedIds || [...updates.keys(), ...removed]));
    } finally {
      applyingMapEditWorkerResult = false;
    }
  }

  function ringRepresentativePoint(ring) {
    if (!ring?.length) return [0, 0];
    let x = 0, y = 0, n = Math.max(1, ring.length - 1);
    for (let i = 0; i < n; i += 1) { x += ring[i][0]; y += ring[i][1]; }
    return [x / n, y / n];
  }


  function activeProjection() {
    return state.projection === 'globe' ? globeProjection : flatProjection;
  }

  function readMapSafeInsets() {
    const workspace = document.querySelector('.workspace');
    if (!workspace) return DEFAULT_SAFE_INSETS;
    const styles = getComputedStyle(workspace);
    const read = name => Math.max(0, Number.parseFloat(styles.getPropertyValue(name)) || 0);
    return {
      left: read('--projection-safe-left'),
      right: read('--projection-safe-right'),
      top: read('--projection-safe-top'),
      bottom: Math.max(26, read('--projection-safe-bottom')),
    };
  }

  function readObjectFitInsets(mapRect, safe) {
    const insets = { ...safe };
    if (!mapRect?.width || !mapRect?.height) return insets;
    const panel = $('rightPanel');
    const panelOpen = panel?.classList.contains('mobile-open') && getComputedStyle(panel).visibility !== 'hidden';
    if (!panelOpen) return insets;
    const panelRect = panel.getBoundingClientRect();
    const edge = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-map-edge')) || 12;
    const overlapLeft = Math.max(mapRect.left, panelRect.left);
    const overlapRight = Math.min(mapRect.right, panelRect.right);
    const overlapTop = Math.max(mapRect.top, panelRect.top);
    const overlapBottom = Math.min(mapRect.bottom, panelRect.bottom);
    if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) return insets;
    if (layoutMode === 'mobile') {
      insets.bottom = Math.max(insets.bottom, mapRect.bottom - panelRect.top + edge);
    } else if (panelRect.left >= mapRect.left + mapRect.width / 2) {
      insets.right = Math.max(insets.right, mapRect.right - panelRect.left + edge);
    } else {
      insets.left = Math.max(insets.left, panelRect.right - mapRect.left + edge);
    }
    insets.left = clamp(insets.left, 0, mapRect.width - 96);
    insets.right = clamp(insets.right, 0, mapRect.width - insets.left - 96);
    insets.top = clamp(insets.top, 0, mapRect.height - 96);
    insets.bottom = clamp(insets.bottom, 0, mapRect.height - insets.top - 96);
    return insets;
  }

  function refreshMapLayoutMetrics(reason = 'layout') {
    const mapElement = $('map');
    const bounds = mapElement?.getBoundingClientRect?.();
    const width = Math.max(1, bounds?.width || mapElement?.clientWidth || state.size.width || 900);
    const height = Math.max(1, bounds?.height || mapElement?.clientHeight || state.size.height || 650);
    const safe = readMapSafeInsets();
    mapLayoutMetricsRefreshCount += 1;
    mapLayoutMetricsSnapshot = createMapLayoutMetricsSnapshot({
      width,
      height,
      dpr: Math.max(1, Number(window.devicePixelRatio || 1)),
      safeInsets: safe,
      fitInsets: readObjectFitInsets(bounds, safe),
      mobile: isMobile(),
      revision: mapLayoutMetricsRefreshCount,
      reason,
    });
    return mapLayoutMetricsSnapshot;
  }

  function projectionLayoutMetrics() {
    if (!mapLayoutMetricsSnapshot) {
      mapLayoutMetricsSnapshot = createMapLayoutMetricsSnapshot({
        width: state.size.width,
        height: state.size.height,
        dpr: Math.max(1, Number(window.devicePixelRatio || 1)),
        safeInsets: DEFAULT_SAFE_INSETS,
        mobile: isMobile(),
      });
    }
    return mapLayoutMetricsSnapshot;
  }

  function currentMapSafeInsets() {
    return projectionLayoutMetrics().safe;
  }

  function updateProjection() {
    const {
      width,
      height,
      safe,
      centerX,
      centerY,
      globeBaseScale,
      flatBaseScale,
    } = projectionLayoutMetrics();
    if (state.projection === 'globe') {
      globeProjection
        .translate([centerX, centerY])
        .scale(globeBaseScale * state.view.globeZoom)
        .rotate(state.view.globeRotation)
        .clipAngle(90);
      path.projection(globeProjection);
    } else {
      flatProjection
        .translate([centerX, centerY])
        .scale(flatBaseScale * state.view.flatZoom)
        .center(state.view.flatCenter)
        .rotate([0, 0, 0])
        .clipExtent([[safe.left, safe.top], [width - safe.right, height - safe.bottom]]);
      path.projection(flatProjection);
    }
  }

  function projectVisibleCoordinate(coord, frameContext = null) {
    if (!coord) return null;
    if (typeof frameContext?.projectVisibleCoordinate === 'function') {
      return frameContext.projectVisibleCoordinate(coord);
    }
    const p = activeProjection()(coord);
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    if (state.projection === 'globe') {
      const r = frameContext?.rotation || state.view.globeRotation;
      const center = [-r[0], -r[1]];
      return d3.geo.distance(coord, center) <= Math.PI / 2 + 0.005 ? p : null;
    }
    const width = Number(frameContext?.size?.width || state.size.width);
    const height = Number(frameContext?.size?.height || state.size.height);
    return p[0] >= -30 && p[0] <= width + 30 && p[1] >= -30 && p[1] <= height + 30 ? p : null;
  }

  function isCoordVisible(coord) {
    return !!projectVisibleCoordinate(coord);
  }

  function screenToGeo(screenPoint) {
    const projection = activeProjection();
    if (state.projection === 'globe') {
      const c = projection.translate();
      const s = projection.scale();
      const dx = screenPoint[0] - c[0];
      const dy = screenPoint[1] - c[1];
      if ((dx * dx + dy * dy) > s * s) return null;
    }
    const coord = projection.invert(screenPoint);
    if (!coord || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return null;
    let lon = ((coord[0] + 540) % 360) - 180;
    let lat = clamp(coord[1], -89.999, 89.999);
    return [lon, lat];
  }

  function defaultGenericFeatureColor(feature) {
    return DEFAULT_GENERIC_FEATURE_COLOR;
  }

  function genericFeatureColor(feature) {
    return readDomainColor(COLOR_DOMAINS.GENERIC, { feature }, { fallback: defaultGenericFeatureColor(feature) }).value;
  }

  function genericFeatureRoleLabel(feature) {
    return GENERIC_FEATURE_ROLE_RULES[feature?.properties?.role]?.label || '기타 객체';
  }

  function genericFeatureRoleHelp(feature) {
    return '사용자 정의 객체는 육지 결합 방식을 직접 선택할 수 있습니다.';
  }

  function genericFeatureDisplayFeature(feature) {
    if (genericFeatureGeometryKind(feature) !== 'polygon' || genericFeatureLandBinding(feature) === 'none') return feature;
    const cached = genericFeatureLandClipCache.get(feature);
    const ownerId = String(feature.properties?.ownerId || '');
    if (cached && cached.revision === countryLandRevision && cached.geometry === feature.geometry && cached.ownerId === ownerId) return cached.feature;
    const clipper = window.polygonClipping;
    if (!clipper?.intersection) return feature;
    const bounds = geometryBounds(feature.geometry);
    const countries = ownerId && countryFeatureById(ownerId)
      ? [countryFeatureById(ownerId)]
      : spatialFeatures(bounds);
    const pieces = [];
    for (const country of countries) {
      if (!country?.geometry || !boundsOverlap(bounds, geometryBounds(country.geometry))) continue;
      const clipped = clipper.intersection(feature.geometry.coordinates, country.geometry.coordinates);
      if (clipped?.length) pieces.push(...clipped);
    }
    const geometry = normalizeClippedLandGeometry(pieces);
    const display = geometry ? { ...feature, geometry } : { ...feature, geometry: null };
    genericFeatureLandClipCache.set(feature, { revision: countryLandRevision, geometry: feature.geometry, ownerId, feature: display });
    return display;
  }

  function genericFeatureName(feature) {
    return feature.properties?.name || `이름 없는 ${genericFeatureRoleLabel(feature)} ${String(feature.id || '').slice(0, 8)}`;
  }

  let territorialRepository;
  let territorialApplicationService;
  let distributionService;
  let genericFeatureService;
  let projectCommandPipeline;
  const runTerritorialUnitTransaction = options => territorialApplicationService.runGeometryTransaction(options);
  const validateTerritorialUnitRelations = (units, options) => territorialApplicationService.validateRelations(units, options);

  function territorialUnitById(id) {
    return territorialApplicationService.get(id);
  }

  function territorialStyleColor(feature) {
    return readDomainColor(COLOR_DOMAINS.TERRITORIAL, { feature }).explicit;
  }

  function setTerritorialStyleColor(feature, color) {
    if (!feature?.properties) return '';
    return writeDomainColor(COLOR_DOMAINS.TERRITORIAL, { feature }, color, { clear: !color, fallback: DEFAULT_GENERIC_FEATURE_COLOR });
  }

  function territorialUnitName(feature) {
    const properties = feature?.properties || {};
    if (properties.name) return properties.name;
    if (properties.unitType === TERRITORIAL_UNIT_TYPES.REGION) return '이름 없는 지방';
    return properties.isRemainder === true
      ? (properties.unitType === TERRITORIAL_UNIT_TYPES.ADMIN ? '미지정 행정구역' : '미지정 권역')
      : (properties.unitType === TERRITORIAL_UNIT_TYPES.ADMIN ? '이름 없는 행정구역' : '이름 없는 권역');
  }

  function territorialUnitColor(feature) {
    const country = countryFeatureById(feature?.properties?.sovereignId);
    return readDomainColor(COLOR_DOMAINS.TERRITORIAL, { feature }, {
      inherited: country ? countryColor(country) : '',
      fallback: DEFAULT_GENERIC_FEATURE_COLOR,
    }).value;
  }

  function territorialUnitCountryName(feature) {
    const country = countryFeatureById(feature?.properties?.sovereignId);
    return country ? countryName(country) : '소속 국가 미지정';
  }

  function countryColor(feature) {
    const id = String(feature?.id || '');
    return readDomainColor(COLOR_DOMAINS.COUNTRY, { feature, override: state.countryOverrides[id] }, { fallback: defaultCountryColor() }).value;
  }

  function distributionColor(layer) {
    return readDomainColor(COLOR_DOMAINS.DISTRIBUTION, { layer }, { fallback: DEFAULT_GENERIC_FEATURE_COLOR }).value;
  }

  function countryName(feature) {
    return state.countryOverrides[String(feature?.id || '')]?.name || feature?.properties?.name || '국가';
  }

  function hydroCategoryKey(value) {
    return value === 'lake' ? 'lake' : 'river';
  }

  function hydroCategoryLabel(value) {
    return hydroCategoryKey(value) === 'lake' ? '호수' : '강';
  }

  function hydroFallbackName(value) {
    return `이름 없는 ${hydroCategoryLabel(value)}`;
  }

  function hydroSourceLabel(value, { builtin = false } = {}) {
    return `${builtin ? '내장 ' : '사용자 '}${hydroCategoryLabel(value)}`;
  }

  function hydroAccusativeLabel(value) {
    return hydroCategoryKey(value) === 'lake' ? '호수를' : '강을';
  }


  const DISTRIBUTION_GROUP_TYPES = Object.freeze({
    languages: DISTRIBUTION_TYPES.LANGUAGE,
    ethnicities: DISTRIBUTION_TYPES.ETHNICITY,
    religions: DISTRIBUTION_TYPES.RELIGION,
  });
  const DISTRIBUTION_TYPE_GROUPS = Object.freeze(Object.fromEntries(Object.entries(DISTRIBUTION_GROUP_TYPES).map(([group, type]) => [type, group])));
  const DISTRIBUTION_TYPE_LABELS = Object.freeze({ language: '언어', ethnicity: '민족', religion: '종교' });

  const LAYER_GROUP_KEYS = Object.freeze([...new Set([
    ...MAP_OBJECT_CATEGORIES.territorial.layerGroups,
    ...MAP_OBJECT_CATEGORIES.distribution.layerGroups,
    'hydro',
    'genericFeatures',
    ...MAP_OBJECT_CATEGORIES.features.viewGroups,
  ])]);
  const LAYER_SEARCH_GROUP_KEYS = LAYER_GROUP_KEYS.filter(group => group !== 'countryLabels');
  const layerGroupNames = Object.freeze({
    ...Object.fromEntries(Object.values(MAP_OBJECT_TYPES)
      .filter(type => type.layerGroup)
      .map(type => [type.layerGroup, type.label])),
    languages: '언어',
    ethnicities: '민족',
    religions: '종교',
    hydro: '강·호수',
    countryLabels: '국가명',
  });
  function syncMapObjectCategoryLabels() {
    document.querySelectorAll('[data-map-category]').forEach(node => {
      const category = MAP_OBJECT_CATEGORIES[node.dataset.mapCategory];
      if (!category) return;
      const title = node.querySelector('.create-menu-group-title');
      if (title) title.textContent = category.label;
    });
    const buildContent = $('createBuildPanel');
    if (buildContent) {
      MAP_OBJECT_CATEGORY_ORDER.forEach(categoryKey => {
        const categoryNode = buildContent.querySelector(`.create-menu-category[data-map-category="${categoryKey}"]`);
        const category = MAP_OBJECT_CATEGORIES[categoryKey];
        if (!categoryNode || !category) return;
        buildContent.appendChild(categoryNode);
        const heading = categoryNode.querySelector('.create-menu-group') || document.createElement('div');
        heading.className = 'create-menu-group';
        const headingText = heading.querySelector('.create-menu-group-title') || document.createElement('span');
        headingText.className = 'create-menu-group-title';
        headingText.textContent = category.label;
        if (!headingText.parentElement) heading.appendChild(headingText);
        categoryNode.prepend(heading);
        category.createItems.forEach(type => {
          const item = categoryNode.querySelector(`[data-map-object-type="${type}"]`);
          if (!item) return;
          const metadata = MAP_OBJECT_TYPES[type];
          const label = item.querySelector('strong');
          const icon = item.querySelector('.create-menu-icon use');
          if (metadata) {
            if (label) label.textContent = metadata.label;
            if (icon) icon.setAttribute('href', `#${metadata.icon}`);
          }
          categoryNode.appendChild(item);
        });
      });
    }
  }
  const layerNameCollator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
  const expandedLayerStyleGroups = new Set();



  function currentMapDevicePixelRatio() {
    const devicePixelRatio = mapLayoutMetricsSnapshot?.dpr ?? Math.max(1, Number(window.devicePixelRatio || 1));
    return Math.min(isMobile() ? 2 : 3, devicePixelRatio);
  }
  function activeLayerFolderKeys() {
    return ['countries', 'rivers', 'lakes'];
  }

  function normalizePhysicalSettings(value) {
    const previousLayers = value?.hydroLayers || {};
    const mergeVisibility = ids => {
      const defined = ids.filter(id => typeof previousLayers[id] === 'boolean');
      return defined.length ? defined.some(id => previousLayers[id] !== false) : true;
    };
    const hydroLayers = {
      rivers_hydro: mergeVisibility(['rivers_hydro', 'rivers_base', 'rivers_europe', 'rivers_north_america', 'rivers_australia']),
      lakes_natural_earth: mergeVisibility(['lakes_natural_earth', 'lakes_hydro', 'lakes_base', 'lakes_europe', 'lakes_north_america', 'lakes_australia']),
    };
    const hiddenHydroIds = Object.fromEntries(Object.entries(value?.hiddenHydroIds || {}).filter(([id, hidden]) => (
      hidden === true && !String(id).startsWith('rivers_base:') && !String(id).startsWith('hydro-lake:')
    )));
    return {
      terrainVisible: value?.terrainVisible !== false,
      terrainStyle: value?.terrainStyle === 'physical' ? 'physical' : 'political',
      terrainStrength: clamp(Number(value?.terrainStrength ?? 0.32), 0, 1),
      hydroLayers,
      userFeaturesVisible: value?.userFeaturesVisible !== false,
      hiddenHydroIds,
      dataset: PHYSICAL_DATASET,
    };
  }

  function syncRangeProgress(input) {
    if (!input) return;
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const value = Number(input.value || min);
    const progress = max > min ? clamp(((value - min) / (max - min)) * 100, 0, 100) : 0;
    input.style.setProperty('--ui-range-progress', `${progress}%`);
  }

  function syncPhysicalControls() {
    const terrainVisible = state.physicalSettings.terrainVisible !== false;
    if ($('terrainVisible')) {
      $('terrainVisible').checked = terrainVisible;
      $('terrainVisible').setAttribute('aria-expanded', String(terrainVisible));
    }
    if ($('terrainDisplayOptions')) $('terrainDisplayOptions').hidden = !terrainVisible;
    if ($('terrainPoliticalRadio')) $('terrainPoliticalRadio').checked = state.physicalSettings.terrainStyle === 'political';
    if ($('terrainPhysicalRadio')) $('terrainPhysicalRadio').checked = state.physicalSettings.terrainStyle === 'physical';
    if ($('terrainStrengthInput')) $('terrainStrengthInput').value = String(Math.round(state.physicalSettings.terrainStrength * 100));
    if ($('terrainStrengthValue')) $('terrainStrengthValue').textContent = `${Math.round(state.physicalSettings.terrainStrength * 100)}%`;
    if ($('terrainStrengthControl')) $('terrainStrengthControl').hidden = !terrainVisible || state.physicalSettings.terrainStyle !== 'political';
    syncRangeProgress($('terrainStrengthInput'));
  }

  function parseHexRgb(value, fallback = TERRAIN_OCEAN_REPRESENTATIVE) {
    const match = /^#([0-9a-f]{6})$/i.exec(String(value || '')) || /^#([0-9a-f]{6})$/i.exec(fallback);
    const packed = Number.parseInt(match[1], 16);
    return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255];
  }

  function formatHexRgb(rgb) {
    return `#${rgb.map(value => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')).join('')}`;
  }

  function automaticWaterColor(gpu = false) {
    if (state.physicalSettings.terrainVisible && state.physicalSettings.terrainStyle === 'physical') {
      const representative = state.terrainManifest?.displayColors?.oceanRepresentative || TERRAIN_OCEAN_REPRESENTATIVE;
      let rgb = parseHexRgb(representative);
      if ((document.documentElement.dataset.theme || systemTheme) === 'dark') rgb = rgb.map((value, index) => value * [0.808, 0.8464, 0.8848][index]);
      return gpu ? rgb.map(value => value / 255) : formatHexRgb(rgb);
    }
    const theme = mapTheme();
    return gpu ? theme.oceanGpu : theme.ocean;
  }

  function hydroDisplayColor(_category, gpu = false) {
    return automaticWaterColor(gpu);
  }

  function normalizeHydroEdit(feature) {
    if (!feature?.geometry || !Array.isArray(feature.geometry.coordinates) || !feature.geometry.coordinates.length) return null;
    feature.properties ||= {};
    const geometryKind = genericFeatureGeometryKind(feature);
    const category = feature.properties.category === 'lake' && geometryKind === 'polygon' ? 'lake'
      : feature.properties.category === 'river' && geometryKind === 'line' ? 'river'
        : geometryKind === 'polygon' ? 'lake'
          : geometryKind === 'line' ? 'river' : '';
    if (!category) return null;
    feature.id = String(feature.id || '').trim();
    if (!feature.id) throw new Error('편집 강/호수 ID가 비어 있습니다.');
    feature.properties = {
      ...feature.properties,
      category,
      pandolab_domain: 'hydro',
      pandolab_schema_version: 1,
      pandolab_id: feature.id,
      name: String(feature.properties.name || ''),
      notes: String(feature.properties.notes || ''),
      editorColor: normalizeEditorColor(feature.properties.editorColor, HYDRO_TOOL_CONFIG[category].color),
    };
    delete feature.properties.visible;
    return feature;
  }

  function normalizeHydroEditCollection(value) {
    const output = [];
    const seen = new Set();
    for (const feature of Array.isArray(value) ? value : []) {
      const normalized = normalizeHydroEdit(feature);
      if (!normalized) throw new Error('편집 강/호수 형식이 올바르지 않습니다.');
      if (seen.has(normalized.id)) throw new Error(`편집 강/호수 ID가 중복되었습니다: ${normalized.id}`);
      seen.add(normalized.id);
      output.push(normalized);
    }
    return output;
  }

  function hydroEditById(id) {
    const key = String(id);
    return state.hydroEdits.find(feature => String(feature.id) === key) || null;
  }

  function isHydroEditFeature(feature) {
    return !!feature && (feature.properties?.pandolab_domain === 'hydro' || state.hydroEdits.includes(feature));
  }

  function hydroLayerVisible(layerId) {
    const category = hydroCategoryKey(HYDRO_LAYER_META[layerId]?.category);
    return state.layerVisibility[category === 'lake' ? 'lakes' : 'rivers'] !== false
      && state.physicalSettings.hydroLayers?.[layerId] !== false;
  }

  function isHydroFeatureVisible(feature) {
    const id = String(feature?.properties?.pandolab_id || feature?.id || '');
    if (isHydroEditFeature(feature)) {
      const category = hydroCategoryKey(feature.properties?.category);
      return state.layerVisibility[category === 'lake' ? 'lakes' : 'rivers'] !== false && isLayerItemVisible('hydro', id);
    }
    return hydroLayerVisible(feature?.properties?.layer_id) && state.physicalSettings.hiddenHydroIds?.[id] !== true;
  }

  function allBuiltInHydroFeatures() {
    const tiled = state.hydroFeatureCache instanceof Map ? [...state.hydroFeatureCache.values()] : [];
    const legacy = Object.values(state.hydroCollections || {}).flatMap(collection => collection?.features || []);
    return [...tiled, ...legacy];
  }

  function builtInHydroFeatureById(id) {
    const key = String(id);
    if (state.hydroFeatureCache instanceof Map && state.hydroFeatureCache.has(key)) return state.hydroFeatureCache.get(key);
    for (const feature of allBuiltInHydroFeatures()) {
      if (String(feature.properties?.pandolab_id || feature.id || '') === key) return feature;
    }
    return null;
  }

  function hydroFeatureById(id) {
    return hydroEditById(id) || builtInHydroFeatureById(id);
  }

  function normalizeLayerItemState(value) {
    const output = {};
    for (const group of LAYER_GROUP_KEYS) {
      const source = value?.[group];
      output[group] = source && typeof source === 'object' && !Array.isArray(source) ? { ...source } : {};
    }
    return output;
  }

  function normalizeLayerFolderState(value) {
    return Object.fromEntries(activeLayerFolderKeys().map(key => [key, !!value?.[key]]));
  }

  function markLayerTreeDirty() {
    state.layerTreeRevision += 1;
  }

  function isLayerItemVisible(group, id) {
    if (group === 'hydro' && HYDRO_LAYER_META[String(id)]) {
      return state.physicalSettings.hydroLayers?.[String(id)] !== false;
    }
    return state.itemVisibility?.[group]?.[String(id)] !== false;
  }

  function isCountryVisibleById(id) {
    return !!state.layerVisibility.countries && isLayerItemVisible('countries', id);
  }

  function setLayerItemsVisibility(items, visible) {
    const byGroup = new Map();
    for (const item of items) {
      if (!LAYER_GROUP_KEYS.includes(item.layerGroup)) continue;
      const ids = byGroup.get(item.layerGroup) || [];
      ids.push(String(item.id)); byGroup.set(item.layerGroup, ids);
    }
    for (const [group, ids] of byGroup) {
      if (group === 'hydro') {
        // Preserve the effective visibility of *both* built-in sources and user edits
        // before lifting a legacy river/lake master switch.
        for (const category of ['river', 'lake']) {
          const categoryItems = layerTreeItems('hydro').filter(item => item.hydroCategory === category);
          const targets = categoryItems.filter(item => ids.includes(item.id));
          if (!targets.length) continue;
          const master = category === 'river' ? 'rivers' : 'lakes';
          if (state.layerVisibility[master] === false) {
            state.itemVisibility.hydro ||= {};
            for (const item of categoryItems) {
              if (item.isBuiltin) state.physicalSettings.hydroLayers[item.id] = false;
              else state.itemVisibility.hydro[item.id] = false;
            }
            state.layerVisibility[master] = true;
          }
          for (const item of targets) {
            if (item.isBuiltin) state.physicalSettings.hydroLayers[item.id] = !!visible;
            else {
              state.itemVisibility.hydro ||= {};
              if (visible) delete state.itemVisibility.hydro[item.id];
              else state.itemVisibility.hydro[item.id] = false;
            }
          }
        }
        gpuMapRenderer.invalidateHydroVisibility();
      } else {
        setScopedItemVisibility({
          layerVisibility: state.layerVisibility, itemVisibility: state.itemVisibility,
          group, allIds: layerTreeItems(group).map(item => item.id), ids, visible,
        });
        if (DISTRIBUTION_GROUP_TYPES[group]) distributionVisibilityRevision += 1;
        if (group === 'countries') gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'country-item-visibility');
      }
    }
    if (!byGroup.size) return;
    // Existing presentation fields are saved once for the whole bundle operation.
    for (const [group] of byGroup) {
      const masters = group === 'hydro' ? ['rivers', 'lakes'] : [group];
      for (const master of masters) { const input = $(master + 'Visible'); if (input) input.checked = state.layerVisibility[master] !== false; }
    }
    markLayerTreeDirty();
    renderingDomain?.invalidateOverlayStyle?.('layer-item-visibility');
    projectDomain.queuePresentationAutosave();
  }

  function setLayerItemVisibility(group, id, visible) {
    setLayerItemsVisibility([{ layerGroup: group, id }], visible);
  }

  function isLayerListItemVisible(group, id) {
    const master = group === 'hydro'
      ? (hydroCategoryKey(HYDRO_LAYER_META[id]?.category || hydroEditById(id)?.properties?.category) === 'lake' ? 'lakes' : 'rivers')
      : group;
    return state.layerVisibility[master] !== false && isLayerItemVisible(group, id);
  }

  function layerTreeItems(group) {
    if (group === 'countries' || group === 'countryLabels') {
      return (state.countriesData?.features || []).map(feature => {
        const id = String(feature.id || '');
        return {
          id,
          name: countryName(feature),
          color: countryColor(feature),
          searchText: id,
          meta: group === 'countryLabels' && pendingCountryLabelAnchors.has(id) ? '계산 중' : '',
          selected: (state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) && state.selected.id === id,
        };
      });
    }
    if (group === 'territories' || group === 'administrative' || group === 'regions') {
      const kind = group === 'territories'
        ? TERRITORIAL_UNIT_TYPES.TERRITORY
        : group === 'administrative'
          ? TERRITORIAL_UNIT_TYPES.ADMIN
          : TERRITORIAL_UNIT_TYPES.REGION;
      return state.territorialUnits.filter(feature => feature.properties?.unitType === kind).map(feature => {
        const countryLabel = territorialUnitCountryName(feature);
        const levelLabel = kind === TERRITORIAL_UNIT_TYPES.ADMIN ? `${Number(feature.properties?.adminLevel) || 1}급` : '';
        return {
          id: String(feature.id),
          name: territorialUnitName(feature),
          color: territorialUnitColor(feature),
          meta: levelLabel,
          searchText: `${countryLabel} ${levelLabel}`,
          folderName: kind === TERRITORIAL_UNIT_TYPES.ADMIN
            ? `행정구역 · ${countryLabel} · ${levelLabel}`
            : kind === TERRITORIAL_UNIT_TYPES.REGION
            ? `지방${feature.properties?.sovereignId ? ` · ${countryLabel}` : ''}`
            : `권역 · ${countryLabel}`,
          countryId: String(feature.properties?.sovereignId || ''),
          level: Number(feature.properties?.adminLevel) || null,
          selected: (state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && state.selected.id === String(feature.id),
        };
      });
    }
    if (DISTRIBUTION_GROUP_TYPES[group]) {
      const type = DISTRIBUTION_GROUP_TYPES[group];
      return state.distributionLayers.filter(layer => layer.type === type).map(layer => ({
        id: layer.id,
        name: layer.name,
        color: distributionColor(layer),
        folderName: layerGroupNames[group],
        selected: state.selected?.domain === 'distribution' && state.selected.id === layer.id,
      }));
    }
    if (group === 'hydro') {
      const builtIns = Object.entries(HYDRO_LAYER_META).map(([id, meta]) => ({
          id,
          name: meta.sourceLabel,
          searchText: `${meta.label} ${meta.sourceLabel}`,
          title: `${meta.sourceLabel} 상태 보기`,
          color: hydroDisplayColor(meta.category),
          folderName: meta.label,
          hydroCategory: hydroCategoryKey(meta.category),
          layerGroup: 'hydro',
          isBuiltin: true,
          selected: false,
        }));
      const userItems = state.hydroEdits.map(feature => ({
        id: String(feature.id),
        name: hydroEditorName(feature.properties?.name, hydroFallbackName(feature.properties?.category)),
        color: feature.properties?.editorColor || HYDRO_TOOL_CONFIG[feature.properties?.category || 'river'].color,
        meta: `${hydroCategoryLabel(feature.properties?.category)} · 사용자`,
        folderName: hydroCategoryLabel(feature.properties?.category),
        hydroCategory: hydroCategoryKey(feature.properties?.category),
        layerGroup: 'hydro',
        isBuiltin: false,
        selected: state.selected?.domain === 'hydro' && state.selected.id === String(feature.id),
      }));
      return [...builtIns, ...userItems];
    }
    if (group === 'genericFeatures') {
      return state.genericFeatures.map(feature => ({
        id: String(feature.id),
        name: genericFeatureName(feature),
        color: genericFeatureColor(feature),
        meta: `${genericFeatureRoleLabel(feature)} · 사용자`,
        layerGroup: 'genericFeatures',
        selected: state.selected?.domain === 'generic' && state.selected.id === String(feature.id),
      }));
    }
    return state.labels.map(label => ({
      id: String(label.id),
      name: label.name || '이름 없는 지명',
      icon: 'place',
      meta: label.kind || '지명',
      selected: state.selected?.domain === 'label' && state.selected.id === String(label.id),
    }));
  }

  function pruneLayerItemVisibility() {
    const valid = {
      countries: new Set((state.countriesData?.features || []).map(feature => String(feature.id || ''))),
      countryLabels: new Set((state.countriesData?.features || []).map(feature => String(feature.id || ''))),
      territories: new Set(state.territorialUnits.filter(feature => feature.properties?.unitType === TERRITORIAL_UNIT_TYPES.TERRITORY).map(feature => String(feature.id))),
      administrative: new Set(state.territorialUnits.filter(feature => feature.properties?.unitType === TERRITORIAL_UNIT_TYPES.ADMIN).map(feature => String(feature.id))),
      regions: new Set(state.territorialUnits.filter(feature => feature.properties?.unitType === TERRITORIAL_UNIT_TYPES.REGION).map(feature => String(feature.id))),
      languages: new Set(state.distributionLayers.filter(layer => layer.type === DISTRIBUTION_TYPES.LANGUAGE).map(layer => layer.id)),
      ethnicities: new Set(state.distributionLayers.filter(layer => layer.type === DISTRIBUTION_TYPES.ETHNICITY).map(layer => layer.id)),
      religions: new Set(state.distributionLayers.filter(layer => layer.type === DISTRIBUTION_TYPES.RELIGION).map(layer => layer.id)),
      hydro: new Set([...Object.keys(HYDRO_LAYER_META), ...state.hydroEdits.map(feature => String(feature.id))]),
      genericFeatures: new Set(state.genericFeatures.map(feature => String(feature.id))),
      labels: new Set(state.labels.map(label => String(label.id))),
    };
    for (const group of LAYER_GROUP_KEYS) {
      state.itemVisibility[group] ||= {};
      for (const id of Object.keys(state.itemVisibility[group])) if (!valid[group].has(id)) delete state.itemVisibility[group][id];
    }

    selectionDomain?.prune?.(null, { reason: 'prune-invalid-selection' });
  }



  function currentMapZoom() {
    return state.projection === 'globe' ? state.view.globeZoom : state.view.flatZoom;
  }

  function countryOutlineFeature(feature) {
    const geometry = feature?.geometry;
    if (geometry && countryOutlineCache.has(geometry)) return countryOutlineCache.get(geometry);
    const outline = buildRenderableStrokeFeature(feature);
    if (geometry) countryOutlineCache.set(geometry, outline);
    return outline;
  }

  function refreshCountryDisplayIndex() {
    const source = state.auditPreviewCountries;
    if (source === countryDisplaySource) return;
    countryDisplaySource = source;
    countryDisplayIndex = new Map((source?.features || []).map(feature => [
      String(feature.id || ''),
      feature,
    ]));
  }

  function countryDisplayFeature(feature) {
    if (state.countryVisualPhase === 'canonical') return feature;
    const id = String(feature?.id || '');
    if (!id) return feature;
    refreshCountryDisplayIndex();
    return countryDisplayIndex.get(id) || feature;
  }

  function applyUserPreferences(nextPreferences, { persist = true, rerender = true } = {}) {
    const previousTheme = effectiveTheme(userPreferences, systemTheme === 'dark');
    const previousAccent = resolvedAccentColor;
    userPreferences = persist ? saveUserPreferences(nextPreferences) : nextPreferences;
    const resolvedTheme = effectiveTheme(userPreferences, systemTheme === 'dark');
    document.documentElement.dataset.theme = resolvedTheme;
    resolvedAccentColor = applyAppAccent(document, userPreferences.appearance.accentColor);
    applyMapLabelPreferences();
    window.__PANDOLAB_THEME__ = resolvedTheme;
    const themeChanged = previousTheme !== resolvedTheme;
    if (themeChanged || previousAccent !== resolvedAccentColor) syncResolvedInteractionStyle({ redraw: rerender });
    if (themeChanged) {
      gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'user-preferences');
      gpuMapRenderer.invalidatePhysicalStyle('user-preferences');
    }
    if (themeChanged && rerender && svg) {
      markLayerTreeDirty();
      layerTreeController?.render();
      renderingDomain?.invalidateBaseScene?.('user-preferences');
    }
    return userPreferences;
  }

  function countryLabelScreenMetrics(feature, fontSize = isMobile() ? 8 : 9, projectedExtent = null, labelFeature = feature) {
    let width = Number(projectedExtent?.width);
    let height = Number(projectedExtent?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      const geometry = feature?.geometry;
      const bounds = geometry ? geometryBounds(geometry) : null;
      const scale = Math.max(1, Number(activeProjection()?.scale?.()) || 1);
      const lonSpan = bounds?.every(Number.isFinite)
        ? Math.max(0, Math.min(360, Number(bounds[2]) - Number(bounds[0]))) * Math.PI / 180
        : 0;
      const latSpan = bounds?.every(Number.isFinite)
        ? Math.max(0, Math.min(180, Number(bounds[3]) - Number(bounds[1]))) * Math.PI / 180
        : 0;
      if (state.projection === 'globe') {
        const centerLatitude = bounds?.every(Number.isFinite)
          ? Math.max(-89.999, Math.min(89.999, (Number(bounds[1]) + Number(bounds[3])) / 2)) * Math.PI / 180
          : 0;
        width = Math.min(scale * 2, scale * lonSpan * Math.max(0.08, Math.abs(Math.cos(centerLatitude))));
        height = Math.min(scale * 2, scale * latSpan);
      } else {
        width = scale * lonSpan;
        height = scale * latSpan;
      }
    }
    const textWidth = Math.max(20, [...countryName(labelFeature)].length * fontSize * 1.02 + 8);
    return {
      width: Number.isFinite(width) ? width : 0,
      height: Number.isFinite(height) ? height : 0,
      area: Number.isFinite(width * height) ? width * height : 0,
      textWidth,
      textHeight: fontSize * 1.65 + 4,
    };
  }

  function shouldShowCountryLabel(feature, metrics = countryLabelScreenMetrics(feature)) {
    if (!state.layerVisibility.basemapLabels) return false;
    const id = String(feature.id || '');
    if (!isLayerItemVisible('countryLabels', id) || pendingCountryLabelAnchors.has(id)) return false;
    if ((state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) && state.selected.id === id) return true;
    const widthFit = metrics.width >= Math.min(34, metrics.textWidth * (isMobile() ? 0.48 : 0.42));
    const heightFit = metrics.height >= metrics.textHeight * 0.52;
    const areaFit = metrics.area >= Math.max(isMobile() ? 72 : 58, metrics.textWidth * metrics.textHeight * 0.32);
    return widthFit && heightFit && areaFit;
  }

  function renderPendingCountryOverlays() {
    if (!countryLayer) return;
    const pending = state.layerVisibility.countries && state.pendingCountryRenderIds?.size
      ? [...state.pendingCountryRenderIds]
        .map(countryFeatureById)
        .filter(feature => feature && isCountryVisibleById(String(feature.id || '')))
      : [];
    const patchFill = countryLayer.selectAll('path.country-patch-preview-fill')
      .data(pending, feature => feature.id);
    patchFill.enter().append('path').attr('class', 'country-patch-preview country-patch-preview-fill');
    countryLayer.selectAll('path.country-patch-preview-fill')
      .attr('d', feature => path(feature))
      .attr('data-gpu-scene-key', feature => `pending-country-fill:${feature.id}`)
      .style('fill', countryColor)
      .style('fill-opacity', mapTheme().fillAlpha)
      .style('stroke', 'none');
    patchFill.exit().remove();
    const patchOutline = countryLayer.selectAll('path.country-patch-preview-outline')
      .data(pending, feature => feature.id);
    patchOutline.enter().append('path').attr('class', 'country-patch-preview country-patch-preview-outline');
    countryLayer.selectAll('path.country-patch-preview-outline')
      .attr('d', feature => path(countryOutlineFeature(feature)))
      .attr('data-gpu-scene-key', feature => `pending-country-outline:${feature.id}`)
      .style('fill', 'none')
      .style('stroke', mapTheme().border)
      .style('stroke-opacity', mapTheme().borderAlpha);
    patchOutline.exit().remove();
  }

  function visibleLabelLayout() {
    const candidates = [];
    const indexedLabelIds = state.layerVisibility.labels
      ? new Set(visibleMapObjectCandidates(['label']).map(record => String(record.id)))
      : new Set();
    countryLabelScreenAreas.clear();
    const zoom = currentMapZoom();
    if (state.layerVisibility.basemapLabels) for (const feature of state.countriesData?.features || []) {
      const id = String(feature.id || '');
      if (!isLayerItemVisible('countryLabels', id) || pendingCountryLabelAnchors.has(id)) continue;
      const settings = automaticLabelSettings('country', state.labelSettings[labelKey('country', id)] || {});
      if (zoom < Number(settings.minZoom ?? -Infinity) || zoom > Number(settings.maxZoom ?? Infinity)) continue;
      const anchor = countryLabelAnchors.get(id);
      const coordinate = settings.pinned && settings.manualPosition ? settings.manualPosition : anchor;
      if (!Array.isArray(coordinate)) continue;
      const point = projectVisibleCoordinate(coordinate);
      if (!point) continue;
      const selected = (state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) && state.selected.id === id;
      const displayFeature = countryDisplayFeature(feature);
      const baseMetrics = countryLabelScreenMetrics(displayFeature, isMobile() ? 8 : 9, null, feature);
      const fontSize = baseMetrics.area >= (isMobile() ? 3200 : 2200) ? (isMobile() ? 10 : 12) : isMobile() ? 8 : 9;
      const metrics = countryLabelScreenMetrics(displayFeature, fontSize, baseMetrics, feature);
      countryLabelScreenAreas.set(id, metrics.area);
      if (!selected && !shouldShowCountryLabel(feature, metrics)) continue;
      candidates.push({
        key: labelKey('country', id), sourceType: 'country', source: feature, point,
        width: metrics.textWidth, height: metrics.textHeight,
        priority: settings.priority ?? LABEL_PRIORITIES.country, minZoom: settings.minZoom, maxZoom: settings.maxZoom,
        pinned: settings.pinned, collisionGroup: settings.collisionGroup,
        selected,
      });
    }
    if (state.layerVisibility.labels) for (const label of state.labels) {
      const selected = state.selected?.domain === 'label' && String(state.selected.id) === String(label.id);
      if (!selected && !indexedLabelIds.has(String(label.id))) continue;
      const settings = automaticLabelSettings(label.kind, state.labelSettings[labelKey('label', label.id)] || {});
      if (zoom < Number(settings.minZoom ?? -Infinity) || zoom > Number(settings.maxZoom ?? Infinity)) continue;
      const coordinate = settings.pinned && settings.manualPosition ? settings.manualPosition : label.coordinates;
      const point = projectVisibleCoordinate(coordinate);
      if (!point) continue;
      const priority = settings.priority ?? (label.kind === 'capital' ? LABEL_PRIORITIES.capital : label.kind === 'city' ? LABEL_PRIORITIES.majorCity : label.kind === 'region' ? LABEL_PRIORITIES.administrative : LABEL_PRIORITIES.place);
      candidates.push({
        key: labelKey('label', label.id), sourceType: 'label', source: label, point,
        width: Math.max(22, [...String(label.name || '')].length * 9 + 16), height: 19,
        priority, minZoom: settings.minZoom, maxZoom: settings.maxZoom,
        pinned: settings.pinned, collisionGroup: settings.collisionGroup,
        selected,
      });
    }
    const labelDensity = Math.max(0.25, Math.min(1, Number(currentRenderQuality.labelDensity) || 1));
    const viewportArea = Math.max(1, Number(state.size.width || 1) * Number(state.size.height || 1));
    const backgroundLimit = labelDensity >= 0.99
      ? Number.POSITIVE_INFINITY
      : Math.max(labelDensity < 0.6 ? 42 : 72, Math.floor(viewportArea / 8_500 * labelDensity));
    const protectedCandidates = candidates.filter(candidate => candidate.selected || candidate.pinned);
    const protectedCandidateKeys = new Set(protectedCandidates.map(candidate => candidate.key));
    const backgroundCandidates = candidates.filter(candidate => !protectedCandidateKeys.has(candidate.key))
      .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0));
    const qualityCandidates = Number.isFinite(backgroundLimit)
      ? [...protectedCandidates, ...backgroundCandidates.slice(0, backgroundLimit)]
      : candidates;
    const nextLabelLayoutMetrics = {
      qualityTier: currentRenderQuality.tier,
      qualityCandidateCount: qualityCandidates.length,
      qualityCulledCount: Math.max(0, candidates.length - qualityCandidates.length),
    };
    const placed = layoutLabels(qualityCandidates, { zoom, padding: isMobile() ? 5 : 3, metrics: nextLabelLayoutMetrics });
    const placedCountryLabels = placed.filter(item => item.sourceType === 'country');
    const placedUserLabels = placed.filter(item => item.sourceType === 'label');
    labelLayoutMetrics = nextLabelLayoutMetrics;
    if (viewportCullingMetrics.lastByDomain.label) viewportCullingMetrics.lastByDomain.label.finalVisibleCount = placedUserLabels.length;
    return {
      countryLabels: placedCountryLabels.map(item => item.source),
      userLabels: placedUserLabels.map(item => item.source),
      countryLabelPoints: new Map(placedCountryLabels.map(item => [String(item.source?.id || ''), item.point])),
      userLabelPoints: new Map(placedUserLabels.map(item => [String(item.source?.id || ''), item.point])),
      countryScreenAreas: new Map(countryLabelScreenAreas),
      candidateCount: candidates.length,
    };
  }

  function prepareHydroFeature(feature) {
    const bounds = coordinateBounds(feature?.geometry?.coordinates);
    feature.__awBounds = bounds.every(Number.isFinite) ? bounds : [-180, -90, 180, 90];
    try { feature.__awCentroid = d3.geo.centroid(feature); }
    catch (_) { feature.__awCentroid = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]; }
    feature.__awRadius = Math.min(180, Math.hypot(bounds[2] - bounds[0], bounds[3] - bounds[1]) / 2);
    return feature;
  }

  const terrainService = createTerrainService({
    fetchWithRetry,
    manifestUrl: () => {
      const url = new URL('terrain/v0.12.6/manifest.json', PHYSICAL_DATA_BASE_URL);
      url.searchParams.set('v', DATA_REVISION);
      return url;
    },
    getLoadState: () => state.physicalLoadState.terrain,
    onLoading: () => {
      state.physicalLoadState.terrain = 'loading';
      state.physicalLoadState.terrainManifest = 'loading';
      markLayerTreeDirty();
      layerTreeController?.render();
    },
    onRetry: (_operation, attempt) => reliabilityDiagnostic.push({
      category: 'asset', operation: 'terrain-manifest', result: `retry-${attempt}`,
    }),
    acceptManifest: manifest => {
      state.terrainManifest = manifest;
      state.physicalLoadState.terrainManifest = 'ready';
      state.physicalLoadState.terrain = 'ready';
      gpuMapRenderer.setTerrainManifest(manifest);
      markLayerTreeDirty();
      layerTreeController?.render();
      renderingDomain?.invalidateBaseScene?.('terrain-manifest-ready');
    },
    onFailure: error => {
      state.physicalLoadState.terrainManifest = 'error';
      state.physicalLoadState.terrain = 'error';
      reliabilityDiagnostic.push({ category: 'asset', operation: 'terrain-manifest', result: 'failed', errorCode: 'PL-TERRAIN-001' });
      markLayerTreeDirty();
      layerTreeController?.render();
      console.warn('Terrain load failed', error);
      reportOperationError(error, '지형 음영을 불러오지 못했습니다. 국가 지도는 계속 사용할 수 있습니다. 잠시 후 다시 시도하세요.', 'PL-TERRAIN-001', 0);
    },
  });

  async function loadTerrainManifest(force = false) {
    return terrainService.load(force);
  }

  const hydroService = createHydroService({
    fetchWithRetry,
    dataVersion: HYDRO_DATA_VERSION,
    manifestUrl: () => {
      const manifestUrl = new URL(`hydro/v${HYDRO_DATA_VERSION}/manifest.json`, PHYSICAL_DATA_BASE_URL);
      manifestUrl.searchParams.set('v', DATA_REVISION);
      return manifestUrl;
    },
    getLoadState: () => state.physicalLoadState.hydro,
    onLoading: () => {
      state.physicalLoadState.hydro = 'loading';
      state.physicalLoadState.hydroManifest = 'loading';
      state.physicalLoadState.hydroWorker = 'starting';
      state.physicalLoadState.hydroView = 'idle';
      markLayerTreeDirty();
      layerTreeController?.render();
    },
    onRetry: (_operation, attempt) => reliabilityDiagnostic.push({
      category: 'asset', operation: 'hydro-manifest', result: `retry-${attempt}`,
    }),
    acceptManifest: async (manifest, manifestUrl) => {
      state.hydroManifest = manifest;
      state.hydroCollections = {};
      state.hydroFeatureCache = new Map();
      state.hydroFeatureByFid = new Map();
      state.hydroFragmentsByLogicalId = new Map();
      state.physicalLoadState.hydroManifest = 'ready';
      state.physicalLoadState.hydroCache = 'idle';
      state.physicalLoadState.hydroCachePercent = 0;
      const workerReady = await gpuMapRenderer.setHydroManifest(manifest, manifestUrl);
      if (!workerReady) return false;
      state.physicalLoadState.hydroWorker = 'ready';
      state.physicalLoadState.hydro = 'ready';
      markLayerTreeDirty();
      layerTreeController?.render();
      renderingDomain?.renderHydro?.();
      return true;
    },
    onFailure: error => {
      if (state.physicalLoadState.hydroManifest !== 'ready') state.physicalLoadState.hydroManifest = 'error';
      state.physicalLoadState.hydroWorker = 'error';
      state.physicalLoadState.hydro = 'error';
      reliabilityDiagnostic.push({ category: 'asset', operation: 'hydro-init', result: 'failed', errorCode: 'PL-WATER-001' });
      markLayerTreeDirty();
      layerTreeController?.render();
      console.warn('Hydro load failed', error);
      reportOperationError(error, '강·호수 목록을 불러오지 못했습니다. 국가 지도는 계속 사용할 수 있습니다. 페이지를 새로고침하거나 잠시 후 다시 시도하세요.', 'PL-WATER-001', 0);
    },
  });

  async function loadHydroData(force = false) {
    return hydroService.load(force);
  }

  function loadPhysicalData() {
    loadTerrainManifest();
    loadHydroData();
  }

  function hydroVisibilityThreshold() {
    return 2.4 + Math.log2(Math.max(1, currentMapZoom())) * 2.05;
  }

  function hydroFeatureInView(feature) {
    if (!isHydroFeatureVisible(feature)) return false;
    const minZoom = Number(feature.properties?.min_zoom ?? feature.properties?.scale_rank ?? 10);
    if (minZoom > hydroVisibilityThreshold()) return false;
    const bounds = feature.__awBounds || [-180, -90, 180, 90];
    if (state.projection === 'flat') {
      const scale = flatProjection.scale();
      const halfLon = state.size.width / Math.max(1, scale) * 90 / Math.PI;
      const halfLat = state.size.height / Math.max(1, scale) * 90 / Math.PI;
      const centerLon = (bounds[0] + bounds[2]) / 2;
      const centerLat = (bounds[1] + bounds[3]) / 2;
      const deltaLon = Math.abs((((centerLon - state.view.flatCenter[0]) + 540) % 360) - 180);
      return deltaLon <= halfLon + Math.abs(bounds[2] - bounds[0]) / 2 + 2
        && Math.abs(centerLat - state.view.flatCenter[1]) <= halfLat + Math.abs(bounds[3] - bounds[1]) / 2 + 2;
    }
    const center = [-Number(state.view.globeRotation?.[0] || 0), -Number(state.view.globeRotation?.[1] || 0)];
    const radius = Math.asin(Math.min(1, Math.hypot(state.size.width, state.size.height) * 0.5 / Math.max(1, globeProjection.scale())));
    return d3.geo.distance(center, feature.__awCentroid || [0, 0]) <= radius + Number(feature.__awRadius || 0) * Math.PI / 180 + 0.04;
  }

  function hydroRenderGroups(category) {
    const groups = new Map();
    const addFeature = (layerId, width, feature) => {
      const widthBucket = category === 'river' ? Math.round(width * 10) / 10 : 1;
      const key = `${layerId}:${widthBucket}`;
      if (!groups.has(key)) groups.set(key, { key, layerId, width: widthBucket, features: [] });
      groups.get(key).features.push(feature);
    };
    for (const feature of allBuiltInHydroFeatures()) {
      if (!feature.geometry) continue;
      const layerId = feature.properties?.layer_id;
      if (HYDRO_LAYER_META[layerId]?.category !== category || !hydroLayerVisible(layerId) || !hydroFeatureInView(feature)) continue;
      if (category !== 'river') {
        addFeature(layerId, 1, feature);
        continue;
      }
      const parts = hydroLineParts(feature.geometry);
      const widthProfiles = feature.properties?.stroke_widths || [];
      const fallbackWidth = Math.max(0.55, Math.min(2.6, Number(feature.properties?.stroke_width || 0.8)));
      for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
        const part = parts[partIndex];
        const widths = widthProfiles[partIndex] || [];
        for (let index = 0; index < part.length - 1; index += 1) {
          const startWidth = Number(widths[index] ?? fallbackWidth);
          const endWidth = Number(widths[index + 1] ?? startWidth);
          addFeature(layerId, (startWidth + endWidth) / 2, {
            type: 'Feature',
            properties: feature.properties,
            geometry: { type: 'LineString', coordinates: [part[index], part[index + 1]] },
          });
        }
      }
    }
    return [...groups.values()].map(group => ({ ...group, collection: { type: 'FeatureCollection', features: group.features } }));
  }

  function hydroEditColor(feature) {
    const category = feature?.properties?.category === 'lake' ? 'lake' : 'river';
    return feature?.properties?.editorColor || HYDRO_TOOL_CONFIG[category].color;
  }



  function territorialBoundaryGeometryToken(geometry) {
    if (!geometry || typeof geometry !== 'object') return 'none';
    let token = territorialBoundaryGeometryTokens.get(geometry);
    if (!token) {
      token = String(++territorialBoundaryGeometryTokenSequence);
      territorialBoundaryGeometryTokens.set(geometry, token);
    }
    return token;
  }

  function presentationGroupForTerritorialFeature(feature) {
    return feature?.properties?.unitType === TERRITORIAL_UNIT_TYPES.ADMIN
      ? 'administrative'
      : feature?.properties?.unitType === TERRITORIAL_UNIT_TYPES.REGION
        ? 'regions'
        : 'territories';
  }

  function applyOverlayStackOrder() {
    if (!overlayStackLayer) return;
    const order = state.layerPresentation?.overlayOrder || OVERLAY_GROUPS;
    const groupForDatum = datum => datum?.layer
      ? DISTRIBUTION_TYPE_GROUPS[datum.layer.type]
      : datum?.properties?.unitType
        ? presentationGroupForTerritorialFeature(datum)
        : 'genericFeatures';
    overlayStackLayer.selectAll('[data-presentation-group]').sort((left, right) => {
      const leftGroup = groupForDatum(left);
      const rightGroup = groupForDatum(right);
      const leftIndex = order.indexOf(leftGroup);
      const rightIndex = order.indexOf(rightGroup);
      return (rightIndex < 0 ? order.length : rightIndex) - (leftIndex < 0 ? order.length : leftIndex);
    });
  }


  function defaultDraftInstruction() {
    const draft = editingDraftSnapshot();
    if (draft.inputPhase === 'refine' && draft.coords.length) {
      return '꼭짓점을 드래그해 미세조정한 뒤 완료하세요.';
    }
    const inputHint = isMobile() ? '한 손가락으로 그리세요.' : '드래그하거나 클릭해 그리세요.';
    const hydro = hydroToolConfig(state.tool);
    if (hydro) return `${hydro.label}의 ${isPolygonDraftTool(state.tool) ? '경계를' : '흐름을'} 따라 ${inputHint}`;
    if (state.tool === 'split-generic-feature') {
      return '영역을 가로질러 경계를 그리세요.';
    }
    if (state.tool === 'split-territorial-unit') {
      return '영역을 가로질러 경계를 그리세요.';
    }
    if (state.tool === 'redraw-territorial-unit') return '부모 영역 안에 새 영역을 그리세요.';
    if (state.tool === 'draw-territorial-unit') return '추가할 영역을 그리세요.';
    if (state.tool === 'annex-territory' && state.annexPhase === 'polygon') return '편입할 영역을 지도에서 지정하세요.';
    if ((state.tool === 'new-country' && state.newCountryPhase === 'line') || (state.tool === 'annex-territory' && state.annexPhase === 'line')) {
      return '선택한 영토를 가로질러 새 경계를 완성하세요.';
    }
    if (state.distributionDraft && isPolygonDraftTool(state.tool)) return '분포 영역을 지도에서 지정하세요.';
    return inputHint;
  }

  function syncGenericDraftFeedback() {
    if (!editingDomain?.draftInputActive?.() || activeCutDraftSourceGeometry()) return;
    const issue = editingDraftSnapshot().issues[0];
    setModeBanner(issue?.message || defaultDraftInstruction());
    if (issue) $('modeTaskInstruction')?.classList.add('cut-invalid');
  }

  function gpuInteractionColor(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text || text === 'none' || text === 'transparent') return null;
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text);
    if (hex) {
      const raw = hex[1];
      const expanded = raw.length === 3 ? raw.split('').map(part => `${part}${part}`).join('') : raw;
      return {
        color: `#${expanded.slice(0, 6)}`,
        alpha: expanded.length === 8 ? Number.parseInt(expanded.slice(6), 16) / 255 : 1,
      };
    }
    const rgb = /^rgba?\((.+)\)$/i.exec(text);
    if (rgb) {
      const parts = rgb[1].replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean);
      if (parts.length >= 3) {
        const channel = part => Math.max(0, Math.min(255, part.endsWith('%') ? Number.parseFloat(part) * 2.55 : Number.parseFloat(part)));
        const values = parts.slice(0, 3).map(channel);
        if (values.every(Number.isFinite)) {
          return {
            color: `#${values.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`,
            alpha: Math.max(0, Math.min(1, Number.parseFloat(parts[3] ?? '1'))),
          };
        }
      }
    }
    const srgb = /^color\(srgb\s+(.+)\)$/i.exec(text);
    if (srgb) {
      const parts = srgb[1].replace(/\//g, ' ').split(/\s+/).filter(Boolean).map(Number);
      if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
        return {
          color: `#${parts.slice(0, 3).map(value => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0')).join('')}`,
          alpha: Math.max(0, Math.min(1, Number.isFinite(parts[3]) ? parts[3] : 1)),
        };
      }
    }
    return null;
  }

  function gpuInteractionGeometry(datum) {
    const geometry = datum?.type === 'Feature'
      ? datum.geometry
      : datum?.type === 'FeatureCollection'
        ? null
        : datum?.geometry?.type
          ? datum.geometry
          : ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(datum?.type)
            ? datum
            : null;
    return ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(geometry?.type) ? geometry : null;
  }

  function gpuInteractionStyle(node, role) {
    const computed = getComputedStyle(node);
    const opacity = Math.max(0, Math.min(1, Number.parseFloat(computed.opacity || '1')));
    const source = gpuInteractionColor(role === 'fill' ? computed.fill : computed.stroke);
    if (!source) return null;
    const roleOpacity = Math.max(0, Math.min(1, Number.parseFloat(role === 'fill' ? computed.fillOpacity : computed.strokeOpacity) || 0));
    const alpha = source.alpha * opacity * roleOpacity;
    if (alpha <= 0.0001) return null;
    if (role === 'fill') {
      return {
        color: source.color,
        alpha,
        fillAlpha: alpha,
        blendMode: computed.mixBlendMode === 'multiply' ? 'multiply' : 'normal',
      };
    }
    const dash = String(computed.strokeDasharray || '').toLowerCase() === 'none'
      ? [0, 0]
      : String(computed.strokeDasharray || '').split(/[\s,]+/).filter(Boolean).slice(0, 2).map(value => Math.max(0, Number.parseFloat(value) || 0));
    return {
      color: source.color,
      alpha,
      width: Math.max(0, Number.parseFloat(computed.strokeWidth || '0')),
      cap: computed.strokeLinecap === 'butt' ? 'butt' : 'round',
      join: ['round', 'bevel', 'miter'].includes(computed.strokeLinejoin) ? computed.strokeLinejoin : 'round',
      dash: dash.length === 2 ? dash : [0, 0],
      miterLimit: Math.max(1, Number.parseFloat(computed.strokeMiterlimit || '4') || 4),
      blendMode: computed.mixBlendMode === 'multiply' ? 'multiply' : 'normal',
    };
  }

  function buildGpuInteractionLayerPackets(domain, layer) {
    const polygons = [];
    const strokes = [];
    const nodes = layer?.selectAll?.('path')?.nodes?.() || [];
    nodes.forEach((node, index) => {
      if (node.classList.contains('draft-segment-hit') || node.closest('.draft-issue-marker')) return;
      const geometry = gpuInteractionGeometry(node.__data__);
      if (!geometry) return;
      const objectKey = `interaction:${domain}:${index}`;
      const revision = selectionGeometryRevision(objectKey, domain, featureFromGeometry(geometry));
      const resourceKeys = [];
      const fillStyle = ['Polygon', 'MultiPolygon'].includes(geometry.type) ? gpuInteractionStyle(node, 'fill') : null;
      if (fillStyle) {
        const key = `${objectKey}:fill`;
        resourceKeys.push(key);
        polygons.push({ key, geometry, geometryRevision: revision, order: index * 2, style: fillStyle, blendMode: fillStyle.blendMode });
      }
      const strokeStyle = gpuInteractionStyle(node, 'stroke');
      if (strokeStyle?.width > 0) {
        const key = `${objectKey}:stroke`;
        resourceKeys.push(key);
        strokes.push({ key, geometry, geometryRevision: revision, order: index * 2 + 1, style: strokeStyle, blendMode: strokeStyle.blendMode });
      }
      if (resourceKeys.length) node.setAttribute('data-gpu-interaction-keys', resourceKeys.join(' '));
    });
    const scene = interactionSceneBuilder.build({
      revision: ++gpuInteractionPacketRevision,
      polygons,
      strokes,
    });
    return [
      ...scene.polygons.map(packet => ({ kind: 'polygon', packet })),
      ...scene.strokes.map(packet => ({ kind: 'stroke', packet })),
    ].sort((left, right) => Number(left.packet.order || 0) - Number(right.packet.order || 0));
  }

  function syncGpuInteractionLayer(domain, layer) {
    const packets = buildGpuInteractionLayerPackets(domain, layer);
    const signature = packets.map(({ kind, packet }) => `${kind}:${packet.key}:${packet.geometryRevision}:${JSON.stringify(packet.style)}`).join('|');
    if (gpuInteractionPacketSignatures[domain] === signature) return false;
    gpuInteractionPacketSignatures[domain] = signature;
    if (domain === 'preview') currentGpuPreviewPackets = packets;
    else currentGpuDraftPackets = packets;
    syncGpuInteractionState();
    renderingDomain?.invalidateGpuInteraction?.(`gpu-${domain}-packets`);
    return true;
  }

  function selectTerritoryCandidate(candidateIndex) {
    const index = Number(candidateIndex);
    if (state.tool === 'annex-territory' && state.annexPhase === 'side' && state.annexCandidates[index]?.geometry) {
      state.annexSelectedCandidateIndex = index;
      setModeBanner('편입할 영역을 선택하세요.', 'annex-mode');
    } else if (state.tool === 'new-country' && state.newCountryPhase === 'side' && state.newCountryCandidates[index]?.geometry) {
      state.newCountrySelectedCandidateIndex = index;
      setModeBanner('신생국으로 만들 영역을 선택하세요.', 'add-country-mode');
    } else {
      return;
    }
    renderingDomain?.invalidateEditingOverlays?.('territory-candidate-selection');
    updateModeButtons();
  }

  function updateTerritoryComponentSelectionFeedback() {
    if (state.tool === 'annex-territory' && state.annexPhase === 'components') {
      const count = state.annexSelectedComponentKeys.length;
      const prefix = state.annexUseRiverBoundaries ? '하천을 경계로 나눈 영토 조각을' : '편입할 영토 조각을';
      const invalidIds = new Set(state.annexRiverPartitionDonorResults
        .filter(result => result.status === 'invalid')
        .map(result => String(result.donorCountryId)));
      const invalidNames = state.annexDonorCountryIds
        .map(countryFeatureById)
        .filter(feature => feature && invalidIds.has(String(feature.id)))
        .map(countryName);
      const suffix = state.annexUseRiverBoundaries && invalidNames.length
        ? ` ${invalidNames.join(', ')}은(는) 분할 오류로 제외됨.`
        : '';
      setModeBanner(count ? `${prefix} 선택하세요. ${count}개 조각 선택됨.${suffix}` : `${prefix} 클릭해 선택하세요.${suffix}`);
    } else if (state.tool === 'new-country' && state.newCountryPhase === 'components') {
      setModeBanner('새 국가로 만들 영토 조각을 클릭해 선택하세요.');
    }
  }

  function toggleAnnexRiverBoundaries(enabled) {
    if (state.tool !== 'annex-territory' || state.annexPhase !== 'components') return;
    const next = enabled === true;
    if (state.annexUseRiverBoundaries === next) return;
    state.annexUseRiverBoundaries = next;
    state.annexSelectedComponentKeys = [];
    state.annexHoveredComponentKey = null;
    resetRiverPartitionState();
    if (next) void prepareRiverPartitionCandidates();
    else {
      updateTerritoryComponentSelectionFeedback();
      updateModeButtons();
      renderingDomain?.invalidateSelection?.('territory-component-mode');
    }
  }

  function toggleTerritoryComponentSelection(componentKey) {
    const available = new Set(territoryComponentItems().map(item => item.key));
    if (!available.has(componentKey)) return;
    let selected;
    if (state.tool === 'annex-territory' && state.annexPhase === 'components') {
      selected = new Set(state.annexSelectedComponentKeys);
      if (selected.has(componentKey)) selected.delete(componentKey); else selected.add(componentKey);
      state.annexSelectedComponentKeys = [...selected];
    } else if (state.tool === 'new-country' && state.newCountryPhase === 'components') {
      selected = new Set(state.newCountrySelectedComponentKeys);
      if (selected.has(componentKey)) selected.delete(componentKey); else selected.add(componentKey);
      state.newCountrySelectedComponentKeys = [...selected];
    } else {
      return;
    }
    updateTerritoryComponentSelectionFeedback();
    renderingDomain?.invalidateEditingOverlays?.('territory-component-selection');
    updateModeButtons();
  }

  function updatePandoGlobeShell(frameContext = null) {
    const projectionKind = frameContext?.projection || state.projection;
    const globe = projectionKind === 'globe';
    const translate = Array.isArray(frameContext?.cssTranslate || frameContext?.translate)
      ? (frameContext.cssTranslate || frameContext.translate)
      : activeProjection().translate();
    const radius = Math.max(0, Number(frameContext?.cssScale || frameContext?.scale || activeProjection().scale() || 0));
    const width = Math.max(1, Number(frameContext?.size?.width || state.size.width));
    const height = Math.max(1, Number(frameContext?.size?.height || state.size.height));
    const frameSignature = `${Number(frameContext?.revision || viewRevision)}:${projectionKind}:${translate[0]}:${translate[1]}:${radius}`;

    baseSvg?.classed('flat-projection', !globe)
      .attr('data-shell-frame-signature', frameSignature);
    flatOceanLayer?.attr('display', globe ? 'none' : null)
      .attr('x', 0).attr('y', 0).attr('width', width).attr('height', height);
    oceanLayer?.attr('display', globe ? null : 'none')
      .attr('cx', translate[0]).attr('cy', translate[1]).attr('r', radius);
    shadowLayer?.attr('display', globe ? null : 'none')
      .attr('cx', translate[0]).attr('cy', translate[1]).attr('r', radius);
  }


  function featureFromGeometry(geometry, properties = {}) {
    return geometry ? { type: 'Feature', properties, geometry } : null;
  }

  function mapFeatureForObjectRef(value) {
    const ref = normalizeObjectRef(value);
    if (!ref) return null;
    if (ref.domain === 'territorial') return ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY ? countryFeatureById(ref.id) : territorialUnitById(ref.id);
    if (ref.domain === 'generic') {
      const genericFeature = state.genericFeatures.find(feature => String(feature.id) === ref.id) || null;
      return genericFeature ? genericFeatureDisplayFeature(genericFeature) : null;
    }
    if (ref.domain === 'hydro') return hydroFeatureById(ref.id);
    if (ref.domain === 'distribution') {
      const features = distributionEntriesForLayer(state.distributionEntries, ref.id).map(entry => {
        const geometry = entry.mode === DISTRIBUTION_MODES.TERRITORIAL ? territorialRepository.get(entry.territorialUnitId)?.geometry : entry.geometry;
        return geometry ? featureFromGeometry(geometry) : null;
      }).filter(Boolean);
      return features.length ? { type: 'FeatureCollection', features } : null;
    }
    return null;
  }

  function selectionGeometryRevision(key, role = 'outline', feature = null) {
    // Geometry revisions are advanced at the canonical mutation boundary.
    // Avoid serializing multipart geometry in the selection hot path; callers
    // still use the geometry object itself for exact rendering when a revision
    // changes.
    void feature;
    return `${key}:${role}:state-${state.stateRevision}:country-${countryLandRevision}`;
  }

  function gpuSceneOrder(group, offset = 0) {
    const order = state.layerPresentation?.overlayOrder || OVERLAY_GROUPS;
    const index = order.indexOf(group);
    return (index < 0 ? order.length : index) * 1000 + Number(offset || 0);
  }

  function replaceGpuSceneDomain(domain, { polygons = [], strokes = [] } = {}) {
    const independentLod = ['base-graticule', 'generic-features', 'distributions'].includes(String(domain));
    const normalizeItem = item => Object.freeze({
      ...item,
      chunkKey: String(item?.chunkKey || `${domain}:${item?.key || ''}`),
      lodPolicy: String(item?.lodPolicy || (independentLod ? 'independent' : 'exact')),
      priority: Number(item?.priority ?? (item?.protected ? 100 : 0)),
    });
    const normalizedPolygons = polygons.filter(item => item?.key && item?.geometry).map(normalizeItem);
    const normalizedStrokes = strokes.filter(item => item?.key && (item?.geometry || item?.startsEnds)).map(normalizeItem);
    const geometrySignature = [...normalizedPolygons, ...normalizedStrokes]
      .map(item => [item.key, item.geometryRevision, item.objectKey || '', item.chunkKey,
        item.lodPolicy, item.priority, item.protected === true].join(':')).join('|');
    const styleSignature = [...normalizedPolygons, ...normalizedStrokes]
      .map(item => `${item.key}:${JSON.stringify(item.style || {})}:${item.order}:${item.blendMode || ''}`).join('|');
    const previous = gpuSceneDomains.get(domain);
    if (previous?.geometrySignature === geometrySignature && previous?.styleSignature === styleSignature) return false;
    if (previous?.geometrySignature !== geometrySignature) renderSceneGeometryRevision += 1;
    if (previous?.styleSignature !== styleSignature) renderSceneStyleRevision += 1;
    gpuSceneDomains.set(domain, {
      geometrySignature,
      styleSignature,
      polygons: normalizedPolygons,
      strokes: normalizedStrokes,
    });
    gpuSceneDirtyDomains.add(String(domain));
    for (const item of [...normalizedPolygons, ...normalizedStrokes]) {
      if (item.objectKey) gpuSceneResourceObjectKeys.set(String(item.key), String(item.objectKey));
    }
    return true;
  }

  function syncGpuRenderScene({ selectionPacket = currentSelectionPacket, interactionFillItems = currentGpuInteractionFillItems } = {}) {
    const overlayOrderSignature = JSON.stringify(state.layerPresentation?.overlayOrder || OVERLAY_GROUPS);
    if (syncGpuRenderScene.overlayOrderSignature !== overlayOrderSignature) {
      syncGpuRenderScene.overlayOrderSignature = overlayOrderSignature;
      renderSceneOrderRevision += 1;
    }
    currentSelectionPacket = selectionPacket || null;
    currentGpuInteractionFillItems = interactionFillItems || [];
    const qualitySignature = `${currentRenderQuality.revision}:${currentRenderQuality.backgroundLod}:${state.projection}`;
    if (syncGpuRenderScene.qualitySignature !== qualitySignature) {
      syncGpuRenderScene.qualitySignature = qualitySignature;
      renderSceneGeometryRevision += 1;
      for (const domainName of ['base-graticule', 'generic-features', 'distributions']) {
        if (gpuSceneDomains.has(domainName)) gpuSceneDirtyDomains.add(domainName);
      }
    }
    renderSceneBuilder.setCacheByteBudget(currentRenderQuality.renderPacketCacheBudgetBytes);
    const sceneInput = {
      revision: ++renderSceneRevision,
      revisions: {
        geometry: renderSceneGeometryRevision,
        style: renderSceneStyleRevision,
        overlayOrder: renderSceneOrderRevision,
        countryState: `${countryLandRevision}:${state.pendingCountryRenderIds?.size || 0}`,
        selection: currentSelectionPacket?.revision || 0,
        editPreview: state.geometryPreview?.revision || 0,
        view: viewRevision,
      },
      country: {
        visible: state.layerVisibility.countries !== false,
        meshRevision: countryLandRevision,
        overrideRevision: [...(state.pendingCountryRenderIds || [])].sort().join(','),
      },
      physical: {
        terrainVisible: !!state.physicalSettings.terrainVisible,
        terrainStyle: state.physicalSettings.terrainStyle,
        hydroVisibilityRevision: state.physicalSettings.hiddenHydroIds ? Object.keys(state.physicalSettings.hiddenHydroIds).length : 0,
        hydroStyleRevision: `${state.layerVisibility.rivers}:${state.layerVisibility.lakes}:${state.stateRevision}`,
      },
      renderQuality: currentRenderQuality,
      projection: state.projection,
      interaction: {
        selectionPacket: currentSelectionPacket,
        genericFillItems: currentGpuInteractionFillItems,
        previewPackets: [...currentGpuPreviewPackets, ...currentGpuEditPreviewPackets],
        draftPackets: currentGpuDraftPackets,
      },
    };
    if (currentRenderScene && gpuSceneDirtyDomains.size) {
      const polygons = [];
      const strokes = [];
      const removePolygonKeys = new Set();
      const removeStrokeKeys = new Set();
      for (const domainName of gpuSceneDirtyDomains) {
        const previousKeys = gpuSceneBuiltDomainKeys.get(domainName);
        for (const key of previousKeys?.polygons || []) removePolygonKeys.add(key);
        for (const key of previousKeys?.strokes || []) removeStrokeKeys.add(key);
        const domain = gpuSceneDomains.get(domainName);
        if (!domain) {
          gpuSceneBuiltDomainKeys.delete(domainName);
          continue;
        }
        polygons.push(...domain.polygons);
        strokes.push(...domain.strokes);
        gpuSceneBuiltDomainKeys.set(domainName, {
          polygons: new Set(domain.polygons.map(item => String(item.key))),
          strokes: new Set(domain.strokes.map(item => String(item.key))),
        });
      }
      currentRenderScene = renderSceneBuilder.patch(currentRenderScene, {
        ...sceneInput,
        polygons,
        strokes,
        removePolygonKeys,
        removeStrokeKeys,
      });
    } else if (!currentRenderScene) {
      const polygons = [];
      const strokes = [];
      for (const [domainName, domain] of gpuSceneDomains) {
        polygons.push(...domain.polygons);
        strokes.push(...domain.strokes);
        gpuSceneBuiltDomainKeys.set(domainName, {
          polygons: new Set(domain.polygons.map(item => String(item.key))),
          strokes: new Set(domain.strokes.map(item => String(item.key))),
        });
      }
      currentRenderScene = renderSceneBuilder.build({ ...sceneInput, polygons, strokes });
    } else {
      currentRenderScene = renderSceneBuilder.patch(currentRenderScene, sceneInput);
    }
    gpuSceneDirtyDomains.clear();
    gpuMapRenderer.setRenderScene?.(currentRenderScene);
    return currentRenderScene;
  }

  function syncGpuInteractionState({ selectionPacket = currentSelectionPacket, interactionFillItems = currentGpuInteractionFillItems } = {}) {
    currentSelectionPacket = selectionPacket || null;
    currentGpuInteractionFillItems = interactionFillItems || [];
    gpuMapRenderer.setInteractionState?.({
      selectionPacket: currentSelectionPacket,
      genericFillItems: currentGpuInteractionFillItems,
      previewPackets: [...currentGpuPreviewPackets, ...currentGpuEditPreviewPackets],
      draftPackets: currentGpuDraftPackets,
    });
  }

  function syncActiveEditPreview(reason = 'edit-preview') {
    const packet = editPreviewController.packet();
    currentGpuEditPreviewPackets = packet ? [packet] : [];
    syncGpuInteractionState();
    renderingDomain?.invalidateGpuInteraction?.(reason);
  }

  function beginActiveEditPreview({ key, segments, style }) {
    editPreviewController.begin({ key, segments, style, order: 25_000 });
    syncActiveEditPreview('edit-preview-start');
  }

  function updateActiveEditPreview(segments) {
    if (!editPreviewController.update(segments)) return false;
    syncActiveEditPreview('edit-preview-move');
    return true;
  }

  function clearActiveEditPreview(reason = 'edit-preview-clear') {
    if (!editPreviewController.clear() && !currentGpuEditPreviewPackets.length) return false;
    currentGpuEditPreviewPackets = [];
    syncGpuInteractionState();
    renderingDomain?.invalidateGpuInteraction?.(reason);
    return true;
  }

  function gpuPolygonResourceKeysForObject(objectKey) {
    const normalizedKey = String(objectKey || '');
    if (!normalizedKey) return [];
    return (currentRenderScene?.polygons || [])
      .map(packet => String(packet.key || ''))
      .filter(key => gpuSceneResourceObjectKeys.get(key) === normalizedKey);
  }

  function buildGpuInteractionFillItems(requests = []) {
    const items = [];
    const resourcesByObject = new Map();
    for (const request of requests) {
      const objectKey = String(request?.objectKey || '');
      if (!objectKey) continue;
      const resourceKeys = gpuPolygonResourceKeysForObject(objectKey);
      if (!resourceKeys.length || (request.singleResourceOnly && resourceKeys.length !== 1)) continue;
      resourcesByObject.set(objectKey, resourceKeys);
      for (const key of resourceKeys) {
        items.push({ key, style: request.style, blendMode: 'normal' });
      }
    }
    return { items, resourcesByObject };
  }

  function applyGpuSceneCoverage(frameResult) {
    const webGlReady = ['webgl2', 'webgl1'].includes(gpuMapRenderer.getRuntimeState?.()?.renderer);
    if (!webGlReady) {
      svg?.selectAll?.('[data-gpu-scene-key]')?.classed('gpu-scene-hit-proxy', false);
      return;
    }
    const rendered = new Set(frameResult?.baseResult?.overlayRenderedKeys || []);
    const missing = new Set(frameResult?.baseResult?.overlayMissingKeys || []);
    if (!rendered.size && !missing.size) return;
    svg?.selectAll?.('[data-gpu-scene-key]')?.classed('gpu-scene-hit-proxy', function() {
      const key = this.getAttribute('data-gpu-scene-key') || '';
      return webGlReady && rendered.has(key) && !missing.has(key);
    });
  }

  function applyGpuInteractionCoverage(frameResult) {
    const webGlReady = ['webgl2', 'webgl1'].includes(gpuMapRenderer.getRuntimeState?.()?.renderer);
    const results = [
      ...(frameResult?.interactionResult?.previewResults || []),
      ...(frameResult?.interactionResult?.draftResults || []),
    ];
    const rendered = new Set(results.flatMap(result => result?.renderedKeys || []));
    const missing = new Set(results.flatMap(result => result?.missingKeys || []));
    interactionSvg?.selectAll?.('[data-gpu-interaction-keys]')?.classed('gpu-interaction-hit-proxy', function() {
      const keys = String(this.getAttribute('data-gpu-interaction-keys') || '').split(/\s+/).filter(Boolean);
      return webGlReady && keys.length > 0 && keys.every(key => rendered.has(key) && !missing.has(key));
    });
  }

  function setMapHover(type, id, feature, ref = null) {
    if (isMobile() || state.tool !== 'select' || state.mapMoving) return;
    void type;
    void id;
    const nextRef = feature?.geometry ? normalizeObjectRef(ref) : null;
    if ((selectionDomain.snapshot().hover?.key || '') === (nextRef?.key || '')) return;
    lastHoverHit = nextRef ? { ref: nextRef, feature } : null;
    selectionDomain.setHover(nextRef);
  }

  function issueCoordinate(issue) {
    if (Array.isArray(issue?.coordinate) && issue.coordinate.length >= 2) return issue.coordinate;
    const bounds = issue?.bounds;
    return Array.isArray(bounds) && bounds.length >= 4
      ? [(Number(bounds[0]) + Number(bounds[2])) / 2, (Number(bounds[1]) + Number(bounds[3])) / 2]
      : null;
  }




  function renderMapAuditPanel() {
    mapDebug.renderPanel();
  }

  function ensureGeometryValidationWorker() {
    if (geometryValidationWorker) return geometryValidationWorker;
    geometryValidationWorker = new Worker(runtimeAssetUrl('workers/geometry-validation-worker.js'), { name: 'atlaswright-geometry-validation' });
    geometryValidationWorker.onmessage = event => {
      const message = event.data || {};
      if (message.type !== 'result' || Number(message.requestId) !== geometryValidationRequestId) return;
      if (!message.ok) {
        state.audit.status = 'error';
        renderMapAuditPanel();
        reportOperationError(new Error(String(message.message || '')), '지도 검사에 실패했습니다. 검사할 레이어를 확인한 뒤 다시 시도하세요.', 'PL-AUDIT-001', 4200);
        return;
      }
      state.audit.status = 'ready';
      state.audit.report = message.report;
      state.audit.selectedIssueId = null;
      renderMapAuditPanel();
      renderingDomain?.renderValidation?.();
      setActionStatus(message.report.issues.length
        ? `지도 검사에서 ${message.report.issues.length.toLocaleString('ko-KR')}건을 찾았습니다.`
        : '지도 검사에서 오류를 찾지 못했습니다.', message.report.issues.length ? 'error' : 'success', 3600);
    };
    geometryValidationWorker.onerror = () => {
      state.audit.status = 'error';
      renderMapAuditPanel();
    };
    return geometryValidationWorker;
  }

  function runFullMapAudit() {
    geometryValidationRequestId += 1;
    state.audit = { status: 'running', revision: geometryValidationRequestId, report: null, selectedIssueId: null };
    renderMapAuditPanel();
    renderingDomain?.renderValidation?.();
    const worker = ensureGeometryValidationWorker();
    worker.postMessage({
      type: 'audit',
      requestId: geometryValidationRequestId,
      revision: state.stateRevision,
      payload: {
        countries: state.countriesData?.features || [],
        coarseCountries: state.countryVisualPhase === 'preview' ? state.auditPreviewCountries?.features || [] : [],
        preciseAffectedIds: [...state.historyDirtyCountryIds],
        units: state.territorialUnits || [],
        distributionEntries: state.distributionEntries || [],
      },
    });
  }

  function clearMapAudit() {
    if (state.audit.status === 'running') geometryValidationWorker?.postMessage({ type: 'cancel', requestId: geometryValidationRequestId });
    geometryValidationRequestId += 1;
    state.audit = { status: 'idle', revision: geometryValidationRequestId, report: null, selectedIssueId: null };
    renderMapAuditPanel();
    renderingDomain?.renderValidation?.();
  }

  function focusAuditIssue(issueId) {
    const issue = state.audit.report?.issues?.find(item => item.id === issueId);
    if (!issue) return;
    state.audit.selectedIssueId = issue.id;
    renderMapAuditPanel();
    if (issue.geometry) focusCountry(featureFromGeometry(issue.geometry), { maxZoom: isMobile() ? 12 : 10 });
    else {
      const coordinate = issueCoordinate(issue);
      if (coordinate) focusCoordinate(coordinate);
    }
    renderingDomain?.renderValidation?.();
  }

  function projectionViewSnapshot() {
    const projection = activeProjection();
    const translate = projection.translate().map(Number);
    const center = screenToGeo(translate);
    return {
      projection: state.projection,
      flatProjectionKind: FLAT_PROJECTION_KIND,
      size: { width: state.size.width, height: state.size.height },
      dpr: currentMapDevicePixelRatio(),
      safeInset: currentMapSafeInsets(),
      translate,
      scale: Number(projection.scale()),
      rotation: state.projection === 'globe' ? state.view.globeRotation.map(Number) : null,
      projectionCenter: state.projection === 'flat' ? state.view.flatCenter.map(Number) : null,
      flatCenter: state.view.flatCenter.map(Number),
      globeRotation: state.view.globeRotation.map(Number),
      flatZoom: Number(state.view.flatZoom),
      globeZoom: Number(state.view.globeZoom),
      geographicCenter: center ? center.map(Number) : null,
      zoom: state.projection === 'globe' ? Number(state.view.globeZoom) : Number(state.view.flatZoom),
    };
  }

  function syncViewRevision() {
    const snapshot = projectionViewSnapshot();
    const signature = JSON.stringify(snapshot);
    if (signature !== renderedViewSignature) {
      renderedViewSignature = signature;
      viewRevision += 1;
    }
    window.__PANDOLAB_VIEW_REVISION__ = viewRevision;
    const viewState = { ...snapshot, revision: viewRevision };
    window.__PANDOLAB_VIEW_STATE__ = viewState;
    return viewState;
  }

  // LegacyMapHost is the sole navigation authority.  Programmatic view
  // updates already mutate `state.view`, so there is no external camera to
  // synchronize back into the Pando state.
  function syncMapHostFromState() {
    return false;
  }

  function handleRenderFrameComplete(sample) {
    const gpuStats = gpuMapRenderer.getRuntimeState?.() || {};
    const startupMetrics = window.__PANDOLAB_STARTUP_METRICS__;
    if (startupMetrics) {
      startupMetrics.firstCanonicalFrameMs = gpuStats.firstCanonicalFrameMs ?? startupMetrics.firstCanonicalFrameMs;
      startupMetrics.canonicalFrameFallbackCount = Number(gpuStats.canonicalFrameFallbackCount || 0);
    }
    // Startup/full-scene work is intentionally expensive and is not an
    // interaction performance sample. Feeding it into the adaptive window
    // caused an immediate post-load downgrade and another scene refresh.
    const shouldSampleInteractionBudget = sample.interactionActive || (!sample.full && sample.viewFrame === true);
    const changed = shouldSampleInteractionBudget && renderQualityController.recordFrame(sample.durationMs, {
      interaction: sample.interactionActive,
    });
    if (changed) queueAdaptiveRenderQualityRefresh('frame-budget-quality-change');
  }

  function visualProjectionForSnapshot(viewState) {
    if (viewState.projection === 'globe') {
      return d3.geo.orthographic()
        .translate(viewState.translate)
        .scale(viewState.scale)
        .rotate(viewState.rotation || [0, 0, 0])
        .clipAngle(90)
        .precision(isMobile() ? 0.9 : 0.35);
    }
    const safe = viewState.safeInset || DEFAULT_SAFE_INSETS;
    return d3.geo.equirectangular()
      .translate(viewState.translate)
      .scale(viewState.scale)
      .center(viewState.projectionCenter || [0, 0])
      .rotate([0, 0, 0])
      .clipExtent([
        [safe.left, safe.top],
        [viewState.size.width - safe.right, viewState.size.height - safe.bottom],
      ])
      .precision(isMobile() ? 0.7 : 0.25);
  }



  function legacyHostOptions() {
    return {
      getProjectionKind: () => state.projection,
      setProjectionKind: kind => {
        state.projection = kind === 'globe' ? 'globe' : 'flat';
        updateProjection();
        return true;
      },
      getViewState: () => projectionViewSnapshot(),
      setViewState: view => {
        if (view?.projection) state.projection = view.projection === 'globe' ? 'globe' : 'flat';
        if (view?.view) state.view = deepClone(view.view);
        updateProjection();
        return true;
      },
      getViewportSize: () => {
        const layout = projectionLayoutMetrics();
        return { width: layout.width, height: layout.height, dpr: layout.dpr };
      },
      project: coordinate => activeProjection()(coordinate),
      unproject: point => screenToGeo(point),
      requestRepaint: reason => renderingDomain?.invalidateGpuFrame?.(reason || 'legacy-host-repaint'),
      resize: () => gpuMapRenderer.resize(),
      dragBy: dragLegacyMapViewBy,
      getDebugState: () => ({ viewRevision }),
    };
  }

  function createPreferredMapHost(mapEl) {
    const legacy = createLegacyMapHost(legacyHostOptions());
    legacy.attach(mapEl);
    return legacy;
  }

  async function activateLegacyMapHost(reason = '') {
    const mapEl = $('map');
    mapHost?.destroy?.();
    // Reuse the Pando canvas created by initSvg when host initialization is
    // retried. Creating another canvas here would create a second visible
    // surface and, after a context failure, leave stale pixels underneath it.
    const gpuCanvas = mapEl?.querySelector('.gpu-map-canvas') || document.createElement('canvas');
    if (!gpuCanvas.parentNode) {
      const overlay = mapEl?.querySelector('.map-overlay-svg');
      if (overlay) mapEl.insertBefore(gpuCanvas, overlay);
      else mapEl?.appendChild(gpuCanvas);
    }
    gpuMapRenderer.attach(gpuCanvas);
    mapHost = createLegacyMapHost(legacyHostOptions());
    mapHost.attach(mapEl);
    await mapHost.initialize();
    document.body.dataset.mapHost = MAP_HOST_KINDS.LEGACY;
    window.__PANDOLAB_MAP_HOST__ = mapHost;
    if (reason) console.warn('[map-host]', reason);
    return false;
  }

  async function initializeMapHost() {
    if (!mapHost) return activateLegacyMapHost('MapHost가 초기화되지 않았습니다.');
    try {
      await mapHost.initialize();
      applyAdaptiveRenderQuality({ refreshScene: false, reason: 'map-host-ready' });
      document.body.dataset.mapHost = MAP_HOST_KINDS.LEGACY;
      window.__PANDOLAB_MAP_HOST__ = mapHost;
      return true;
    } catch (error) {
      return activateLegacyMapHost(error?.message || String(error));
    }
  }

  function initSvg() {
    const mapEl = $('map');
    const map = d3.select(mapEl);
    mapHost?.destroy?.();
    mapHost = null;
    mapHostReadyPromise = Promise.resolve(false);
    gpuMapRenderer.setSelectionPass?.(null);
    selectionPass = null;
    map.selectAll('*').remove();
    mapDebug.installViewFacade();

    baseSvg = map.append('svg')
      .attr('class', 'map-base-svg')
      .attr('aria-hidden', 'true')
      .attr('focusable', 'false');
    const baseRoot = baseSvg.append('g').attr('class', 'map-base-root');
    flatOceanLayer = baseRoot.append('rect').attr('class', 'map-ocean map-ocean-flat');
    oceanLayer = baseRoot.append('circle').attr('class', 'map-ocean map-ocean-globe');
    shadowLayer = baseRoot.append('circle').attr('class', 'globe-shadow');

    mapHost = createPreferredMapHost(mapEl);
    const gpuCanvas = document.createElement('canvas');
    gpuCanvas.className = 'gpu-map-canvas';
    mapEl.appendChild(gpuCanvas);
    gpuMapRenderer.attach(gpuCanvas);

    svg = map.append('svg').attr('class', 'map-svg map-overlay-svg');
    const handleSelectionRenderError = ({ stage = 'selection-overlay-render', channel = '', error } = {}) => {
      if (renderingDomain?.recordSelectionRenderError) {
        renderingDomain.recordSelectionRenderError({ stage, error });
      } else {
        reliabilityDiagnostic.push({
          category: 'render',
          operation: 'selection-overlay-render',
          result: 'recovered',
          channel,
          technicalMessage: String(error?.message || error || stage),
          stack: error?.stack || '',
        });
      }
    };
    selectionPass = createSelectionPass({
      projectionForView: () => activeProjection(),
      onRenderError: handleSelectionRenderError,
    });
    gpuMapRenderer.setSelectionPass?.(selectionPass);
    syncResolvedInteractionStyle();
    interactionSvg = map.append('svg').attr('class', 'map-interaction-svg');
    const interactionRoot = interactionSvg.append('g').attr('class', 'map-interaction-root');
    root = svg.append('g').attr('class', 'map-root');
    mapInteractionLayer = root.append('rect').attr('class', 'map-hit-area').attr('x', 0).attr('y', 0);
    graticuleLayer = root.append('path').attr('class', 'map-graticule');
    countryLayer = root.append('g').attr('class', 'countries-layer');
    hydroLakeLayer = root.append('g').attr('class', 'hydro-lakes-layer');
    hydroRiverLayer = root.append('g').attr('class', 'hydro-rivers-layer');
    hydroEditLayer = root.append('g').attr('class', 'hydro-edit-layer');
    boundaryEditLayer = root.append('g').attr('class', 'boundary-edit-layer');
    overlayStackLayer = root.append('g').attr('class', 'overlay-stack-layer');
    territorialBoundaryLayer = root.append('g').attr('class', 'territorial-boundary-layer');
    territorialUnitLayer = overlayStackLayer;
    distributionLayer = overlayStackLayer;
    genericFeatureLayer = overlayStackLayer;
    hoverLayer = root.append('g').attr('class', 'hover-overlay-layer');
    selectionLayer = root.append('g').attr('class', 'selection-overlay-layer');
    previewLayer = root.append('g').attr('class', 'geometry-preview-layer');
    validationLayer = root.append('g').attr('class', 'validation-overlay-layer');
    vertexLayer = root.append('g').attr('class', 'vertices-layer');
    draftLayer = root.append('g').attr('class', 'draft-layer');
    snapLayer = root.append('g').attr('class', 'snap-indicator-layer');
    territorialOperationLayer = interactionRoot.append('g').attr('class', 'territorial-operation-layer');
    countryLabelLayer = root.append('g').attr('class', 'country-label-layer');
    labelLayer = root.append('g').attr('class', 'labels-layer');
    [previewLayer, validationLayer, vertexLayer, draftLayer, snapLayer, countryLabelLayer, labelLayer]
      .forEach(layer => interactionRoot.node().appendChild(layer.node()));

    mapInputController = mapInputPresentation.bindSvg(svg);
  }



  function queueMapResize(reason = 'layout') {
    mapResizeReasons.add(String(reason || 'layout'));
    if (mapResizeFrame) return;
    mapResizeFrame = requestAnimationFrame(() => {
      mapResizeFrame = 0;
      const reasons = [...mapResizeReasons].sort();
      mapResizeReasons.clear();
      refreshMapLayoutMetrics(reasons.join(',') || 'layout');
      resizeMap();
    });
  }

  function watchDevicePixelRatio() {
    if (resolutionQuery) {
      if (typeof resolutionQuery.removeEventListener === 'function') resolutionQuery.removeEventListener('change', watchDevicePixelRatio);
      else resolutionQuery.removeListener?.(watchDevicePixelRatio);
    }
    resolutionQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) || null;
    if (typeof resolutionQuery?.addEventListener === 'function') resolutionQuery.addEventListener('change', watchDevicePixelRatio, { once: true });
    else resolutionQuery?.addListener?.(watchDevicePixelRatio);
    queueMapResize('dpr-change');
  }

  function startMapResizeObserver() {
    mapResizeObserver?.disconnect?.();
    if (typeof ResizeObserver === 'function') {
      mapResizeObserver = new ResizeObserver(() => queueMapResize('resize-observer'));
      mapResizeObserver.observe($('map'));
    }
    window.visualViewport?.addEventListener?.('resize', () => {
      refreshMapSheetMetrics();
      queueMapResize('visual-viewport-resize');
    });
    watchDevicePixelRatio();
  }

  function resizeMap() {
    const layout = mapLayoutMetricsRefreshCount > 0
      ? projectionLayoutMetrics()
      : refreshMapLayoutMetrics('initial-resize');
    const { width, height } = layout;
    const signature = layout.projectionSignature;
    if (signature === mapResizeSignature) {
      syncMapHudBounds();
      return false;
    }
    mapResizeSignature = signature;
    state.size.width = width;
    state.size.height = height;
    const viewBox = `0 0 ${state.size.width} ${state.size.height}`;
    [baseSvg, svg].forEach(layer => {
      layer?.attr('width', state.size.width)
        .attr('height', state.size.height)
        .attr('viewBox', viewBox)
        .attr('preserveAspectRatio', 'none');
    });
    mapInteractionLayer
      ?.attr('width', state.size.width)
      .attr('height', state.size.height);
    mapHost?.resize?.();
    gpuMapRenderer.resize();
    renderingDomain?.invalidateViewport?.('resize');
    syncMapHudBounds();
    requestAnimationFrame(() => gpuMapRenderer.verifyLayout());
    return true;
  }

  function syncCountryActionButtons() {
    const selectedId = (state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) ? state.selected.id : null;
    const borderActive = state.tool === 'country-border' && state.boundaryEditCountryIds.includes(String(selectedId));
    const coastActive = state.tool === 'country-coast' && state.coastEditCountryId === selectedId;
    const mergeActive = state.tool === 'merge-country' && state.mergeSourceCountryId === selectedId;
    const annexActive = state.tool === 'annex-territory' && state.annexTargetCountryId === selectedId;
    const borderBtn = $('editBorderBtn');
    const coastBtn = $('editCoastBtn');
    const mergeBtn = $('mergeCountryBtn');
    const annexBtn = $('annexTerritoryBtn');
    if (borderBtn) borderBtn.classList.toggle('active', borderActive);
    if (coastBtn) {
      coastBtn.classList.toggle('active', coastActive);
    }
    if (mergeBtn) mergeBtn.classList.toggle('active', mergeActive);
    if (annexBtn) annexBtn.classList.toggle('active', annexActive);
  }

  function setModeBanner(text = '') {
    const instruction = $('modeTaskInstruction');
    if (!instruction) return;
    if (instruction.textContent !== text) instruction.textContent = text;
    instruction.classList.remove('cut-valid', 'cut-invalid', 'cut-pending');
    instruction.classList.toggle('hidden', !text);
    syncStatusBar();
  }

  function syncCutDraftFeedback(assessment, preview = false) {
    const instruction = $('modeTaskInstruction');
    if (!instruction || !assessment?.line?.length) {
      instruction?.classList.remove('cut-valid', 'cut-invalid', 'cut-pending');
      return;
    }
    let message;
    if (assessment.valid) {
      message = preview
        ? '이 위치에 놓으면 유효한 경계가 됩니다. 경계 근처 끝점은 자동으로 연결됩니다.'
        : '유효한 경계입니다. 영역 나누기를 눌러 완료하세요.';
    } else if (assessment.status === 'pending') {
      message = '선택 영역을 가로질러 반대쪽까지 그리세요.';
    } else {
      message = assessment.message;
    }
    const className = `cut-${assessment.status}`;
    if (instruction.textContent === message && instruction.classList.contains(className)) return;
    setModeBanner(message);
    instruction.classList.add(className);
  }

  function activeModeTaskDescriptor() {
    return describeTool(state.tool, state, { labelPlacement: state.labelPlacementMode });
  }

  function syncGeometryPreviewSummary() {
    const element = $('geometryPreviewSummary');
    if (!element) return;
    const session = state.geometryPreview.session;
    const blocking = session?.validation?.blocking === true;
    element.classList.toggle('hidden', !session || blocking);
    if (!session || blocking) {
      element.textContent = '';
      element.removeAttribute('aria-label');
      return;
    }
    const metrics = session.metrics || {};
    const fragments = [];
    if (metrics.transferredAreaKm2 > 0) fragments.push(`이동 ${formatArea(metrics.transferredAreaKm2)}`);
    if (metrics.finalAreaKm2 > 0) fragments.push(`최종 ${formatArea(metrics.finalAreaKm2)}`);
    const text = fragments.length ? fragments.join(' · ') : '변경 결과를 확인하세요.';
    element.textContent = text;
    element.setAttribute('aria-label', text);
  }

  function mapModeContextActive() {
    const labelMode = state.labelPlacementMode || state.tool === 'label';
    return !!(labelMode || hydroToolConfig(state.tool) || state.geometryPreview.session || isSpecialTool(state.tool) || editingDomain?.draftInputActive?.());
  }

  function elementHasLayout(element) {
    if (!element || element.classList.contains('hidden')) return false;
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0;
  }

  function syncMapHudBounds() {
    if (layoutMode === 'wide') return;
    const slot = $('mapTopContextSlot');
    const map = $('map');
    if (!slot || !map) return;
    const bounds = map.getBoundingClientRect();
    if (!bounds.width) return;
    const edge = 12;
    let left = edge;
    let right = bounds.width - edge;
    const view = document.querySelector('.map-view-toolbar');
    if (elementHasLayout(view)) right = Math.min(right, view.getBoundingClientRect().left - bounds.left - 8);
    if (right <= left) {
      left = edge;
      right = bounds.width - edge;
    }
    slot.style.setProperty('--map-context-center', `${Math.round((left + right) / 2)}px`);
    slot.style.setProperty('--map-context-width', `${Math.max(0, Math.floor(right - left))}px`);
  }

  function syncMapContextSurfaces() {
    const editing = mapModeContextActive();
    if (editing && !mapModeContextWasActive && isMobile()) {
      const inspector = $('rightPanel');
      mapModeContextWasActive = editing;
      if (inspector?.classList.contains('mobile-open')) {
        setMobileSheetHeight(inspector, 0);
        syncOverlayState();
      }
    }
    mapModeContextWasActive = editing;
    const selectionCount = selectionDomain.size();
    const showSelection = selectionCount > 0;
    if (!editing) state.modeTaskMinimized = false;
    const minimized = editing && state.modeTaskMinimized === true;
    const context = $('modeEditingContext');
    const content = $('modeTaskWindowContent');
    const minimize = $('modeTaskMinimizeBtn');
    context?.classList.toggle('hidden', !editing);
    context?.classList.toggle('is-minimized', minimized);
    if (content) content.hidden = minimized;
    if (minimize) {
      minimize.setAttribute('aria-expanded', String(!minimized));
      minimize.setAttribute('aria-label', minimized ? '지도 작업창 복원' : '지도 작업창 최소화');
      minimize.dataset.tooltip = minimized ? '복원' : '최소화';
      minimize.querySelector('use')?.setAttribute('href', minimized ? '#icon-chevron-down' : '#icon-minus');
    }
    $('multiSelectionBar')?.classList.toggle('hidden', !showSelection);
    editorWorkspacePresentation.sync({ active: editing, minimized });
    requestAnimationFrame(syncMapHudBounds);
  }

  function toggleMapTaskWindow() {
    if (!mapModeContextActive()) return;
    state.modeTaskMinimized = !state.modeTaskMinimized;
    syncMapContextSurfaces();
  }

  function syncMapCursorMode() {
    const map = $('map');
    if (!map) return;
    const mode = toolCursorMode(state.tool, state, { labelPlacement: state.labelPlacementMode });
    map.classList.toggle('country-pick-mode', mode.country);
    map.classList.toggle('generic-feature-mode', mode.generic);
    map.classList.toggle('candidate-pick-mode', mode.candidate);
    map.classList.toggle('select-mode', mode.select);
  }

  function updateModeButtons() {
    const draft = editingDraftSnapshot();
    const annexLineMode = state.tool === 'annex-territory' && state.annexPhase === 'line';
    const annexPolygonMode = state.tool === 'annex-territory' && state.annexPhase === 'polygon';
    const annexPolygonPreviewMode = state.tool === 'annex-territory' && state.annexPhase === 'polygon-preview';
    const annexSideMode = state.tool === 'annex-territory' && state.annexPhase === 'side';
    const annexComponentsMode = state.tool === 'annex-territory' && state.annexPhase === 'components';
    const annexDonorMode = state.tool === 'annex-territory' && state.annexPhase === 'donor';
    const newCountrySourceMode = state.tool === 'new-country' && state.newCountryPhase === 'sources';
    const newCountryLineMode = state.tool === 'new-country' && state.newCountryPhase === 'line';
    const newCountrySideMode = state.tool === 'new-country' && state.newCountryPhase === 'side';
    const newCountryComponentsMode = state.tool === 'new-country' && state.newCountryPhase === 'components';
    const mergeTargetMode = state.tool === 'merge-country' && !!state.mergeSourceCountryId;
    const genericFeatureMergeMode = state.tool === 'merge-generic-feature' && !!state.genericFeatureMergeSourceId;
    const genericFeatureSplitMode = state.tool === 'split-generic-feature' && !!state.genericFeatureSplitSourceId;
    const territorialUnitMergeMode = state.tool === 'merge-territorial-unit' && !!state.territorialUnitMergeSourceId;
    const territorialUnitSplitMode = state.tool === 'split-territorial-unit' && !!(state.territorialUnitSplitSourceId || state.territorialUnitSplitVirtualSource);
    const territorialUnitRedrawMode = state.tool === 'redraw-territorial-unit' && !!state.territorialUnitRedrawSourceId;
    const territorialUnitCreateMode = state.tool === 'draw-territorial-unit' && !!state.territorialCreateContext;
    const boundarySelectMode = state.tool === 'country-border' && state.boundaryEditPhase === 'selecting';
    const boundaryEditMode = state.tool === 'country-border' && state.boundaryEditPhase === 'editing';
    const boundarySelectionReady = !boundarySelectMode || boundaryEditSelectionAnalysis(state.boundaryEditCountryIds).valid;
    const methodSwitchAvailable = annexLineMode || annexPolygonMode || annexPolygonPreviewMode || annexSideMode || annexComponentsMode
      || newCountryLineMode || newCountrySideMode || newCountryComponentsMode;
    const activeMethod = state.tool === 'annex-territory'
      ? state.annexSelectionMethod
      : state.newCountrySelectionMethod;
    const labelMode = state.labelPlacementMode || state.tool === 'label';
    const terrainMode = !!hydroToolConfig(state.tool);
    const draftMode = editingDomain?.draftInputActive?.();
    const previewMode = !!state.geometryPreview.session;
    const specialMode = labelMode || terrainMode || previewMode || isSpecialTool(state.tool) || draftMode;
    const cutLineMode = genericFeatureSplitMode || territorialUnitSplitMode || annexLineMode || newCountryLineMode;
    const cutLineReady = !cutLineMode || draft.cutAssessment?.valid === true;
    const task = activeModeTaskDescriptor();
    const bar = $('modeActionBar');
    const methodSwitch = $('modeMethodSwitch');
    const lineMethod = $('modeLineMethodBtn');
    const polygonMethod = $('modePolygonMethodBtn');
    const componentsMethod = $('modeComponentsMethodBtn');
    const riverBoundaryOption = $('modeRiverBoundaryOption');
    const riverBoundaryInput = $('modeRiverBoundaryInput');
    const draftActions = $('modeDraftActions');
    const draftRedraw = $('modeDraftRedrawBtn');
    const draftRemoveLast = $('modeDraftRemoveLastBtn');
    const draftDelete = $('modeDraftDeleteBtn');
    const primary = $('modePrimaryBtn');
    const cancel = $('modeCancelBtn');
    if ($('modeTaskName')) $('modeTaskName').textContent = task.name;
    if ($('modeTaskStage')) $('modeTaskStage').textContent = task.stage;
    const currentTaskIcon = $('modeTaskIcon');
    if (currentTaskIcon && task.icon) {
      const nextTaskIcon = createSemanticIcon(document, task.icon, 'ui-icon mode-task-icon');
      nextTaskIcon.id = 'modeTaskIcon';
      currentTaskIcon.replaceWith(nextTaskIcon);
    }
    if (bar) {
      bar.classList.toggle('hidden', !specialMode);
      bar.classList.toggle('single-action', labelMode);
      bar.classList.toggle('is-processing', state.modeProcessing);
      bar.setAttribute('aria-busy', String(state.modeProcessing));
    }
    methodSwitch?.classList.toggle('hidden', !methodSwitchAvailable);
    methodSwitch?.classList.toggle('annex-three-methods', state.tool === 'annex-territory');
    riverBoundaryOption?.classList.toggle('hidden', !annexComponentsMode);
    riverBoundaryOption?.setAttribute('aria-busy', String(annexComponentsMode && state.annexUseRiverBoundaries && state.annexRiverPartitionStatus === 'loading'));
    if (riverBoundaryInput) {
      riverBoundaryInput.checked = annexComponentsMode && state.annexUseRiverBoundaries;
      riverBoundaryInput.disabled = state.modeProcessing;
    }
    const refineSelection = draftMode && draft.inputPhase === 'refine' && Number.isInteger(draft.selectedVertexIndex);
    const draftActionsVisible = draftMode && draft.coords.length > 0;
    draftActions?.classList.toggle('hidden', !draftActionsVisible);
    draftRedraw?.classList.toggle('hidden', refineSelection);
    draftRemoveLast?.classList.toggle('hidden', refineSelection);
    draftDelete?.classList.toggle('hidden', !refineSelection);
    if (draftRedraw) draftRedraw.disabled = state.modeProcessing || draft.strokeActive || !draft.coords.length;
    if (draftRemoveLast) draftRemoveLast.disabled = state.modeProcessing || draft.strokeActive || !draft.coords.length;
    if (draftDelete) draftDelete.disabled = state.modeProcessing || draft.strokeActive || !refineSelection;
    for (const [button, method] of [[lineMethod, 'line'], [polygonMethod, 'polygon'], [componentsMethod, 'components']]) {
      if (!button) continue;
      button.classList.toggle('hidden', state.tool !== 'annex-territory' && method === 'polygon');
      const active = activeMethod === method;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      button.disabled = state.modeProcessing;
    }
    if (primary) {
      primary.classList.toggle('hidden', labelMode);
      primary.disabled = state.modeProcessing
        || (draftMode && (draft.strokeActive || draft.coords.length < draftMinimumPoints() || draft.issues.length > 0 || (cutLineMode && !cutLineReady)))
        || (terrainMode && draft.coords.length < (isPolygonDraftTool(state.tool) ? 3 : 2))
        || (newCountrySourceMode && !state.newCountrySourceIds.length)
        || (annexDonorMode && !state.annexDonorCountryIds.length)
        || (annexPolygonMode && draft.coords.length < 3)
        || (annexPolygonPreviewMode && !state.annexCandidates[0]?.geometry)
        || (mergeTargetMode && !state.mergeTargetCountryIds.length)
        || (genericFeatureMergeMode && !state.genericFeatureMergeTargetIds.length)
        || (territorialUnitMergeMode && !state.territorialUnitMergeTargetIds.length)
        || ((genericFeatureSplitMode || territorialUnitSplitMode) && !cutLineReady)
        || (territorialUnitRedrawMode && draft.coords.length < 3)
        || (territorialUnitCreateMode && draft.coords.length < 3)
        || (boundarySelectMode && !boundarySelectionReady)
        || ((annexLineMode || newCountryLineMode) && !cutLineReady)
        || (annexSideMode && !state.annexCandidates[state.annexSelectedCandidateIndex]?.geometry)
        || (newCountrySideMode && !state.newCountryCandidates[state.newCountrySelectedCandidateIndex]?.geometry)
        || (annexComponentsMode && state.annexUseRiverBoundaries && state.annexRiverPartitionStatus !== 'ready')
        || (annexComponentsMode && !state.annexSelectedComponentKeys.length)
        || (newCountryComponentsMode && !state.newCountrySelectedComponentKeys.length)
        || (previewMode && state.geometryPreview.session.validation?.blocking === true);
      let primaryLabel = '완료';
      if (previewMode) primaryLabel = '변경 적용';
      else if (boundarySelectMode) primaryLabel = `선택 완료 (${state.boundaryEditCountryIds.length})`;
      else if (boundaryEditMode || state.tool === 'country-coast') primaryLabel = '수정 완료';
      else if (terrainMode) primaryLabel = '그리기 완료';
      else if (newCountrySourceMode) primaryLabel = `선택 완료 (${state.newCountrySourceIds.length})`;
      else if (annexDonorMode) primaryLabel = `선택 완료 (${state.annexDonorCountryIds.length})`;
      else if (annexPolygonMode) primaryLabel = '영역 편입';
      else if (annexPolygonPreviewMode) primaryLabel = '영역 편입';
      else if (mergeTargetMode) primaryLabel = `합병 (${state.mergeTargetCountryIds.length})`;
      else if (genericFeatureMergeMode) primaryLabel = `영역 합치기 (${state.genericFeatureMergeTargetIds.length})`;
      else if (territorialUnitMergeMode) primaryLabel = `영역 합치기 (${state.territorialUnitMergeTargetIds.length})`;
      else if (genericFeatureSplitMode) primaryLabel = '영역 나누기';
      else if (territorialUnitSplitMode) primaryLabel = '영역 나누기';
      else if (territorialUnitRedrawMode) primaryLabel = '영역 다시 지정';
      else if (territorialUnitCreateMode) primaryLabel = '영역 만들기';
      else if (newCountryLineMode || annexLineMode) primaryLabel = '나누기';
      else if (newCountryComponentsMode) primaryLabel = `국가 만들기 (${state.newCountrySelectedComponentKeys.length})`;
      else if (newCountrySideMode) primaryLabel = '국가 만들기';
      else if (annexComponentsMode) primaryLabel = `편입 (${state.annexSelectedComponentKeys.length})`;
      else if (annexSideMode) primaryLabel = '편입';
      const primaryLabelNode = primary.querySelector('.mode-button-label');
      if (primaryLabelNode) primaryLabelNode.textContent = primaryLabel;
      else primary.textContent = primaryLabel;
      primary.setAttribute('aria-label', primaryLabel);
      primary.setAttribute('aria-busy', String(state.modeProcessing));
    }
    if (cancel) {
      const cancelLabelNode = cancel.querySelector('.mode-button-label');
      if (cancelLabelNode) cancelLabelNode.textContent = '취소';
      else cancel.textContent = '취소';
      cancel.setAttribute('aria-label', '작업 취소');
      cancel.disabled = state.modeProcessing;
    }
    syncGeometryPreviewSummary();
    syncMapContextSurfaces();
    syncMapCursorMode();
    syncCountryActionButtons();
    projectUi.syncHistory();
    syncStatusBar();
  }

  function dispatchModePrimaryAction() {
    if (state.geometryPreview.session) return applyActiveGeometryPreview();
    if (state.tool === 'country-border' && state.boundaryEditPhase === 'selecting') return beginCountryBorderEditing();
    if (state.tool === 'country-border') return finishCountryBorderEdit();
    if (state.tool === 'country-coast') return finishCountryCoastEdit();
    if (state.tool === 'merge-generic-feature') return completeGenericFeatureMerge();
    if (state.tool === 'merge-territorial-unit') return completeTerritorialUnitMerge();
    if (state.tool === 'new-country' && state.newCountryPhase === 'sources') return beginNewCountryLine();
    if (state.tool === 'annex-territory' && state.annexPhase === 'donor') return beginAnnexSelection();
    if (state.tool === 'merge-country') return completeCountryMerge();
    if (state.tool === 'new-country' && state.newCountryPhase === 'side') return completeNewCountryCreation(state.newCountrySelectedCandidateIndex);
    if (state.tool === 'new-country' && state.newCountryPhase === 'components') return completeNewCountryCreation(null);
    if (state.tool === 'annex-territory' && state.annexPhase === 'side') return completeLinearAnnexation(state.annexSelectedCandidateIndex);
    if (state.tool === 'annex-territory' && state.annexPhase === 'polygon-preview') return completeLinearAnnexation(0);
    if (state.tool === 'annex-territory' && state.annexPhase === 'components') return completeLinearAnnexation(null);
    if (isGenericFeatureDraftTool(state.tool) || ['new-country', 'annex-territory'].includes(state.tool)) return finishDraft();
    return false;
  }

  async function runModePrimaryAction(action = dispatchModePrimaryAction) {
    if (state.modeProcessing) return false;
    state.modeProcessing = true;
    updateModeButtons();
    try {
      return await action();
    } catch (error) {
      reportOperationError(error, '지도 작업을 완료하지 못했습니다. 현재 상태를 확인한 뒤 다시 시도하세요.', 'PL-MODE-001', 4200);
      return false;
    } finally {
      state.modeProcessing = false;
      updateModeButtons();
    }
  }

  function resetAnnexState() {
    state.annexTargetCountryId = null;
    state.annexDonorCountryIds = [];
    state.annexPhase = null;
    state.annexComponentIndex = null;
    state.annexCandidates = [];
    state.annexSelectedCandidateIndex = null;
    state.annexSelectedComponentKeys = [];
    state.annexSelectionMethod = 'line';
    state.annexUseRiverBoundaries = false;
    state.annexSourceGeometry = null;
    resetRiverPartitionState();
  }

  function resetMergeState() {
    state.mergeSourceCountryId = null;
    state.mergeTargetCountryIds = [];
  }

  function resetGenericFeatureMergeState() {
    state.genericFeatureMergeSourceId = null;
    state.genericFeatureMergeTargetIds = [];
  }

  function resetTerritorialUnitEditState() {
    state.territorialUnitMergeSourceId = null;
    state.territorialUnitMergeTargetIds = [];
    state.territorialUnitSplitSourceId = null;
    state.territorialUnitSplitVirtualSource = null;
    state.territorialUnitRedrawSourceId = null;
    state.territorialCreateContext = null;
  }

  function resetNewCountryState() {
    state.newCountryPhase = null;
    state.newCountrySourceIds = [];
    state.newCountryCandidates = [];
    state.newCountrySelectedCandidateIndex = null;
    state.newCountrySelectedComponentKeys = [];
    state.newCountrySelectionMethod = 'line';
    state.newCountrySourceGeometry = null;
  }

  function switchTerritorySelectionMethod(method) {
    const annexMethods = new Set(['line', 'polygon', 'components']);
    const useComponents = method === 'components';
    const usePolygon = method === 'polygon';
    if (state.tool === 'annex-territory' && ['line', 'polygon', 'polygon-preview', 'side', 'components'].includes(state.annexPhase)) {
      if (!state.annexDonorCountryIds.length) return;
      editingDomain?.clearDraft?.(true);
      state.annexComponentIndex = null;
      state.annexCandidates = [];
      state.annexSelectedCandidateIndex = null;
      state.annexSelectedComponentKeys = [];
      resetRiverPartitionState();
      state.annexSelectionMethod = annexMethods.has(method) ? method : 'line';
      state.annexPhase = useComponents ? 'components' : usePolygon ? 'polygon' : 'line';
      if (useComponents && state.annexUseRiverBoundaries) void prepareRiverPartitionCandidates();
      else if (useComponents) updateTerritoryComponentSelectionFeedback();
      else {
        setModeBanner(defaultDraftInstruction());
      }
    } else if (state.tool === 'new-country' && ['line', 'side', 'components'].includes(state.newCountryPhase)) {
      editingDomain?.clearDraft?.(true);
      state.newCountryCandidates = [];
      state.newCountrySelectedCandidateIndex = null;
      state.newCountrySelectedComponentKeys = [];
      state.newCountrySelectionMethod = useComponents ? 'components' : 'line';
      state.newCountryPhase = useComponents ? 'components' : 'line';
      if (useComponents) updateTerritoryComponentSelectionFeedback();
      else {
        setModeBanner(defaultDraftInstruction());
      }
    } else {
      return;
    }
    updateModeButtons();
      renderingDomain?.invalidateSelection?.('territory-selection-method');
  }

  function draftMinimumPoints() {
    return isPolygonDraftTool(state.tool) ? 3 : 2;
  }

  function resetTerritoryEditingState(invalidateInteraction = true) {
    editingDomain?.clearDraft?.(invalidateInteraction);
    resetAnnexState();
    resetNewCountryState();
  }

  function resetBoundaryEditState() {
    state.boundaryEditCountryIds = [];
    state.boundaryEditPhase = null;
    state.boundaryEditInitialSelection = null;
    state.boundaryEditSeedCountryId = null;
  }

  function enterTerrainGenericFeatureMode(tool) {
    const config = hydroToolConfig(tool);
    if (!config) return false;
    clearNotification();
    selectionUiController.clear({ reason: 'tool-mode-selection-clear' });
    resetTerritoryEditingState(true);
    state.coastEditCountryId = null;
    resetMergeState();
    editingDomain?.setTool(tool, { announce: false });
    setModeBanner(defaultDraftInstruction());
    updateModeButtons();
    return true;
  }

  function enterNewCountryMode() {
    clearNotification();
    selectionUiController.clear({ reason: 'new-country-selection-clear' });
    editingDomain?.clearDraft?.({ reason: 'new-country-mode', render: false });
    resetNewCountryState();
    state.newCountryPhase = 'sources';
    editingDomain?.setTool('new-country', { announce: false });
    setModeBanner('새 국가로 분리할 영토가 있는 국가를 선택하세요.');
    return true;
  }

  function toggleNewCountrySource(id) {
    if (state.tool !== 'new-country' || state.newCountryPhase !== 'sources') return;
    const sourceId = String(id || '');
    if (!countryFeatureById(sourceId)) return;
    const selected = new Set(state.newCountrySourceIds.map(String));
    if (selected.has(sourceId)) selected.delete(sourceId);
    else selected.add(sourceId);
    state.newCountrySourceIds = [...selected];
    renderingDomain?.invalidateEditingOverlays?.('new-country-source-selection-changed');
    setModeBanner('새 국가로 분리할 영토가 있는 국가를 선택하세요.');
    updateModeButtons();
  }

  function beginNewCountryLine() {
    if (state.tool !== 'new-country' || state.newCountryPhase !== 'sources') return;
    if (!requireCountriesUnlocked(state.newCountrySourceIds, '새 국가 분리 작업을 시작')) return;
    let sourceGeometry;
    try {
      sourceGeometry = selectedCountryUnionGeometry(state.newCountrySourceIds);
    } catch (error) {
      reportOperationError(error, '선택한 국가의 영토를 합칠 수 없습니다. 서로 연결된 국가를 다시 선택하세요.', 'PL-COUNTRY-004', 3600);
      return;
    }
    state.newCountryPhase = 'line';
    state.newCountrySelectionMethod = 'line';
    state.newCountryCandidates = [];
    state.newCountrySelectedCandidateIndex = null;
    state.newCountrySelectedComponentKeys = [];
    state.newCountrySourceGeometry = sourceGeometry;
    editingDomain?.startDraft?.({ coords: [] });
    setModeBanner(defaultDraftInstruction());
    updateModeButtons();
    renderingDomain?.invalidateGpuInteraction?.('new-country-line-start');
  }

  function enterAnnexTerritoryMode(id) {
    if (!planDrawnTerritoryAnnex || !composeRiverBoundaryTerritoryComponents) {
      setActionStatus('영토 편입 도구를 준비하는 중입니다.', 'working', 0);
      void ensureGisRuntime()
        .then(() => enterAnnexTerritoryMode(id))
        .catch(error => reportOperationError(error, '영토 편입 도구를 불러오지 못했습니다.', 'PL-GIS-LAZY-001', 4200));
      return true;
    }
    clearNotification();
    const feature = countryFeatureById(id);
    if (!feature) return false;
    if (!requireCountriesUnlocked([id], '영토 편입을 시작')) return false;
    editingDomain?.clearDraft?.({ reason: 'annex-mode', render: false });
    state.annexTargetCountryId = String(id);
    state.annexDonorCountryIds = [];
    state.annexPhase = 'donor';
    state.annexComponentIndex = null;
    state.annexCandidates = [];
    state.annexSelectedCandidateIndex = null;
    state.annexSelectedComponentKeys = [];
    state.annexSelectionMethod = 'line';
    state.annexUseRiverBoundaries = false;
    resetRiverPartitionState();
    editingDomain?.setTool('annex-territory', { announce: false });
    state.annexTargetCountryId = String(id);
    syncCountryActionButtons();
    renderingDomain?.invalidateEditingOverlays?.('annex-target-selected');
    setModeBanner('피편입국을 선택하세요. 여러 국가를 선택할 수 있습니다.');
    updateModeButtons();
    return true;
  }

  function toggleAnnexDonor(id) {
    const targetId = String(state.annexTargetCountryId || '');
    const donorId = String(id || '');
    if (state.tool !== 'annex-territory' || state.annexPhase !== 'donor') return;
    if (!targetId || donorId === targetId) {
      setActionStatus('편입받을 국가는 영토를 가져올 국가로 선택할 수 없습니다. 다른 국가를 선택하세요.', 'error', 3500);
      return;
    }
    const donor = countryFeatureById(donorId);
    if (!donor?.geometry || !['Polygon', 'MultiPolygon'].includes(donor.geometry.type)) {
      setActionStatus('영토를 가져올 국가를 찾을 수 없습니다. 지도에 표시된 다른 국가를 선택하세요.', 'error', 3500);
      return;
    }
    const selected = new Set(state.annexDonorCountryIds.map(String));
    if (selected.has(donorId)) selected.delete(donorId);
    else selected.add(donorId);
    state.annexDonorCountryIds = [...selected];
    renderingDomain?.invalidateEditingOverlays?.('annex-donor-selection-changed');
    setModeBanner('피편입국을 선택하세요. 여러 국가를 선택할 수 있습니다.');
    updateModeButtons();
  }

  function beginAnnexSelection() {
    if (state.tool !== 'annex-territory' || state.annexPhase !== 'donor') return;
    if (!requireCountriesUnlocked([state.annexTargetCountryId, ...state.annexDonorCountryIds], '영토 편입을 시작')) return;
    let sourceGeometry;
    try {
      sourceGeometry = selectedCountryUnionGeometry(state.annexDonorCountryIds);
    } catch (error) {
      reportOperationError(error, '선택한 국가의 영토를 준비할 수 없습니다. 대상을 다시 선택하세요.', 'PL-ANNEX-004', 3600);
      return;
    }
    state.annexPhase = 'line';
    state.annexComponentIndex = null;
    state.annexCandidates = [];
    state.annexSelectedCandidateIndex = null;
    state.annexSelectedComponentKeys = [];
    state.annexSelectionMethod = 'line';
    resetRiverPartitionState();
    state.annexSourceGeometry = sourceGeometry;
    editingDomain?.startDraft?.({ coords: [] });
    setModeBanner(defaultDraftInstruction());
    updateModeButtons();
    renderingDomain?.invalidateSelection?.('annex-selection-start');
  }

  function selectionSessionSnapshot() {
    const snapshot = selectionDomain.snapshot().selection;
    return {
      primaryKey: snapshot.primaryKey,
      items: snapshot.items.map(ref => ({ domain: ref.domain, type: ref.type, id: ref.id })),
    };
  }

  function enterCountryBorderSelection(id) {
    clearNotification();
    const feature = countryFeatureById(id);
    if (!feature) return false;
    if (!requireCountriesUnlocked([id], '국경 조정 대상을 선택')) return false;
    const initialSelection = selectionSessionSnapshot();
    if (!editingDomain?.setTool('country-border', { announce: false })) return false;
    state.boundaryEditCountryIds = [String(id)];
    state.boundaryEditPhase = 'selecting';
    state.boundaryEditInitialSelection = initialSelection;
    state.boundaryEditSeedCountryId = String(id);
    selectionUiController.replaceMany(state.boundaryEditCountryIds.map(countryObjectRef), {
      primary: countryObjectRef(id), scope: 'map', reason: 'boundary-edit-selection', present: false,
    });
    rebuildBoundaryTopology(state.boundaryEditCountryIds);
    setModeBanner(`${countryName(feature)}와 접한 국가를 선택하세요.`);
    renderingDomain?.invalidateGpuInteraction?.('country-border-selection');
    updateModeButtons();
    return true;
  }

  function enterCountryBorderEditFromSelection() {
    clearNotification();
    const snapshot = selectionSessionSnapshot();
    const refs = selectionDomain.snapshot().selection.items;
    const ids = refs.filter(ref => ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY).map(ref => ref.id);
    if (ids.length !== refs.length || ids.length < 2) {
      setActionStatus('국경 조정은 국가를 2개 이상 선택했을 때 시작할 수 있습니다.', 'error', 3200);
      return false;
    }
    if (!requireCountriesUnlocked(ids, '국경 조정을 시작')) return false;
    const analysis = boundaryEditSelectionAnalysis(ids, { rebuild: true });
    if (!analysis.valid) {
      setActionStatus(analysis.message, 'error', 3800);
      return false;
    }
    if (!editingDomain?.setTool('country-border', { announce: false })) return false;
    state.boundaryEditCountryIds = analysis.selectedIds;
    state.boundaryEditPhase = 'editing';
    state.boundaryEditInitialSelection = snapshot;
    state.boundaryEditSeedCountryId = analysis.selectedIds[0];
    selectionUiController.replaceMany(analysis.selectedIds.map(countryObjectRef), {
      primary: countryObjectRef(analysis.selectedIds.at(-1)), scope: 'map', reason: 'boundary-edit-selection', present: false,
    });
    rebuildBoundaryTopology(analysis.selectedIds);
    setModeBanner('공유국경 꼭짓점을 드래그하세요. 외부 접점은 고정됩니다.');
    renderingDomain?.invalidateGpuInteraction?.('country-border-edit-selection');
    updateModeButtons();
    return true;
  }

  function boundaryNeighborIds(selectedCountryIds = state.boundaryEditCountryIds) {
    const selected = new Set(selectedCountryIds.map(String));
    const neighbors = new Set();
    for (const segment of state.sharedBoundaryTopology?.segments?.values?.() || []) {
      if (segment.kind !== 'shared') continue;
      const owners = [...segment.ownerIds].map(String);
      if (!owners.some(id => selected.has(id))) continue;
      for (const id of owners) if (!selected.has(id)) neighbors.add(id);
    }
    return neighbors;
  }

  function toggleBoundaryEditCountry(id) {
    if (state.tool !== 'country-border' || state.boundaryEditPhase !== 'selecting') return false;
    const countryId = String(id || '');
    if (!countryFeatureById(countryId)) return false;
    const selected = new Set(state.boundaryEditCountryIds.map(String));
    if (selected.has(countryId)) {
      if (countryId === state.boundaryEditSeedCountryId) {
        setActionStatus('시작 국가는 대상 선택 단계에서 해제할 수 없습니다.', 'error', 2800);
        return false;
      }
      selected.delete(countryId);
    } else {
      rebuildBoundaryTopology([...selected]);
      if (!boundaryNeighborIds([...selected]).has(countryId)) {
        setActionStatus('현재 선택 집합과 실제 국경을 맞댄 국가만 추가할 수 있습니다.', 'error', 3200);
        return false;
      }
      selected.add(countryId);
    }
    state.boundaryEditCountryIds = [...selected];
    selectionUiController.replaceMany(state.boundaryEditCountryIds.map(countryObjectRef), {
      primary: countryObjectRef(countryId), scope: 'map', reason: 'boundary-edit-selection', present: false,
    });
    const analysis = boundaryEditSelectionAnalysis(state.boundaryEditCountryIds, { rebuild: true });
    setModeBanner(analysis.valid
      ? `${analysis.selectedIds.length}개 국가 선택됨 · 완료하면 공유국경을 편집합니다.`
      : analysis.message);
    renderingDomain?.invalidateGpuInteraction?.('country-border-country-toggle');
    updateModeButtons();
    return true;
  }

  function beginCountryBorderEditing() {
    if (state.tool !== 'country-border' || state.boundaryEditPhase !== 'selecting') return false;
    if (!requireCountriesUnlocked(state.boundaryEditCountryIds, '국경 조정을 시작')) return false;
    const analysis = boundaryEditSelectionAnalysis(state.boundaryEditCountryIds, { rebuild: true });
    if (!analysis.valid) {
      setActionStatus(analysis.message, 'error', 3400);
      return false;
    }
    state.boundaryEditCountryIds = analysis.selectedIds;
    state.boundaryEditPhase = 'editing';
    rebuildBoundaryTopology(analysis.selectedIds);
    setModeBanner('공유국경 꼭짓점을 드래그하세요. 외부 접점은 고정됩니다.');
    renderingDomain?.invalidateGpuInteraction?.('country-border-edit-start');
    updateModeButtons();
    return true;
  }

  function finishCountryBorderEdit() {
    if (state.tool !== 'country-border') return false;
    const ids = state.boundaryEditCountryIds.slice();
    const primaryId = (state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) && ids.includes(String(state.selected.id)) ? String(state.selected.id) : ids.at(-1);
    editingDomain?.setTool('select', { announce: false });
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    state.sharedBoundaryTopology = { segments: new Map(), nodes: new Map() };
    selectionUiController.replaceMany(ids.map(countryObjectRef), {
      primary: countryObjectRef(primaryId), scope: 'map', reason: 'boundary-edit-commit', present: true,
    });
    projectDomain.queueAutosave();
    setActionStatus(`${ids.length}개 국가 사이의 공유국경 조정을 완료했습니다.`, 'success');
    return true;
  }

  function enterCountryCoastEdit(id, { scopeGenericFeatureId = null, returnSelection = null } = {}) {
    clearNotification();
    const feature = countryFeatureById(id);
    if (!feature) return false;
    if (!requireCountriesUnlocked([id], '해안선 조정을 시작')) return false;
    rebuildBoundaryTopology(id);
    state.coastEditCountryId = String(id);
    state.coastEditScopeGenericFeatureId = scopeGenericFeatureId ? String(scopeGenericFeatureId) : null;
    state.coastEditReturnSelection = returnSelection ? deepClone(returnSelection) : null;
    editingDomain?.setTool('country-coast', { announce: false });
    state.coastEditCountryId = String(id);
    state.coastEditScopeGenericFeatureId = scopeGenericFeatureId ? String(scopeGenericFeatureId) : null;
    state.coastEditReturnSelection = returnSelection ? deepClone(returnSelection) : null;
    rebuildBoundaryTopology(id);
    syncCountryActionButtons();
    setModeBanner(scopeGenericFeatureId
      ? '해안선 꼭짓점을 드래그하세요. 연결 영역도 함께 변경됩니다.'
      : '해안선 꼭짓점을 드래그하세요. 국경 접점은 고정됩니다.');
    return true;
  }

  function finishCountryCoastEdit() {
    const id = state.coastEditCountryId;
    if (!id) return;
    const feature = countryFeatureById(id);
    const returnSelection = state.coastEditReturnSelection ? deepClone(state.coastEditReturnSelection) : null;
    editingDomain?.setTool('select', { announce: false });
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    state.sharedBoundaryTopology = { segments: new Map(), nodes: new Map() };
    state.coastEditScopeGenericFeatureId = null;
    state.coastEditReturnSelection = null;
    if (returnSelection?.type === 'generic' && state.genericFeatures.some(item => String(item.id) === String(returnSelection.id))) applyGenericSelectionIntent(String(returnSelection.id), true);
    else if (feature) applyCountrySelectionIntent(id, true);
    projectDomain.queueAutosave();
    setActionStatus(`${feature ? countryName(feature) : '국가'}의 해안선을 조정했습니다.`, 'success');
  }

  function enterMergeCountryMode(id) {
    clearNotification();
    const feature = countryFeatureById(id);
    if (!feature) return false;
    if (!requireCountriesUnlocked([id], '국가 합병을 시작')) return false;
    state.mergeSourceCountryId = String(id);
    state.mergeTargetCountryIds = [];
    editingDomain?.setTool('merge-country', { announce: false });
    state.mergeSourceCountryId = String(id);
    state.mergeTargetCountryIds = [];
    setModeBanner('합병할 국가를 선택하세요.');
    syncCountryActionButtons();
    updateModeButtons();
    return true;
  }

  function toggleMergeTarget(id) {
    const sourceId = String(state.mergeSourceCountryId || '');
    const targetId = String(id || '');
    if (state.tool !== 'merge-country' || !sourceId) return;
    if (!targetId || targetId === sourceId) {
      setActionStatus('기준 국가는 합병 대상으로 선택할 수 없습니다. 다른 국가를 선택하세요.', 'error', 3200);
      return;
    }
    if (!countryFeatureById(targetId)) {
      setActionStatus('합병 대상을 찾을 수 없습니다. 지도에 표시된 다른 국가를 선택하세요.', 'error', 3200);
      return;
    }
    const selected = new Set(state.mergeTargetCountryIds.map(String));
    if (selected.has(targetId)) selected.delete(targetId);
    else selected.add(targetId);
    state.mergeTargetCountryIds = [...selected];
    renderingDomain?.invalidateEditingOverlays?.('merge-country-target-selection-changed');
    setModeBanner('합병할 국가를 선택하세요.');
    updateModeButtons();
  }

  function cancelActiveMode(announce = true) {
    const cancelledTool = state.tool;
    const boundarySelectionSnapshot = state.boundaryEditInitialSelection;
    mapEditClient.cancel();
    const selectedTerritorialUnitId = state.territorialUnitSplitSourceId || state.territorialUnitMergeSourceId
      || ((state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) ? state.selected.id : null);
    const selectedGenericFeatureId = state.genericFeatureSplitSourceId || state.genericFeatureMergeSourceId
      || (state.coastEditReturnSelection?.type === 'generic' ? state.coastEditReturnSelection.id : null);
    const selectedId = state.annexTargetCountryId
      || state.coastEditCountryId
      || state.mergeSourceCountryId
      || ((state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) ? state.selected.id : null);
    resetTerritoryEditingState(true);
    state.coastEditCountryId = null;
    state.coastEditScopeGenericFeatureId = null;
    state.coastEditReturnSelection = null;
    resetBoundaryEditState();
    resetMergeState();
    resetGenericFeatureMergeState();
    resetTerritorialUnitEditState();
    state.genericFeatureSplitSourceId = null;
    editingDomain?.setTool('select', { announce: false });
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    state.sharedBoundaryTopology = { segments: new Map(), nodes: new Map() };
    if (cancelledTool === 'country-border' && boundarySelectionSnapshot) selectionUiController.restore(boundarySelectionSnapshot);
    else if (selectedGenericFeatureId && state.genericFeatures.some(item => String(item.id) === String(selectedGenericFeatureId))) applyGenericSelectionIntent(String(selectedGenericFeatureId), true);
    else if (selectedTerritorialUnitId && territorialUnitById(selectedTerritorialUnitId)) applyTerritorialUnitSelectionIntent(String(selectedTerritorialUnitId), true);
    else if (selectedId && countryFeatureById(selectedId)) applyCountrySelectionIntent(selectedId, true);
    renderingDomain?.invalidateEditingOverlays?.('active-mode-cancelled');
    const labels = { 'new-country': '국가 추가', 'annex-territory': '영토 편입', 'merge-country': '국가 합병', 'merge-generic-feature': '영역 합치기', 'split-generic-feature': '영역 나누기', 'merge-territorial-unit': '영역 합치기', 'split-territorial-unit': '영역 나누기', 'country-border': '국경 조정', 'country-coast': '해안선 조정' };
    if (announce) setActionStatus(`${labels[cancelledTool] || '지도 작업'}을 취소했습니다.`, 'success');
  }

  function enterLabelMode() {
    clearNotification();
    resetTerritoryEditingState(true);
    state.coastEditCountryId = null;
    resetMergeState();
    state.tool = 'label';
    state.labelPlacementMode = true;
    setCurrentTool('지명 추가');
    $('map').classList.add('generic-feature-mode');
    $('map').classList.remove('select-mode');
    setModeBanner('지명을 배치할 위치를 선택하세요.');
    syncMobileNavigation();
    updateModeButtons();
    return true;
  }

  function exitLabelMode(announce = true) {
    state.labelPlacementMode = false;
    state.tool = 'select';
    $('map').classList.remove('generic-feature-mode');
    $('map').classList.add('select-mode');
    setModeBanner();
    setCurrentTool('국가 선택');
    syncMobileNavigation();
    updateModeButtons();
    if (announce) setActionStatus('지명 추가를 취소했습니다.', 'success');
  }

  function createCountryFeature(name, rawRing, color = null, geometryOverride = null) {
    const id = uid('USR');
    const geometry = geometryOverride
      ? deepClone(geometryOverride)
      : { type: 'Polygon', coordinates: [orientRing(rawRing, true)] };
    const feature = {
      type: 'Feature',
      id,
      properties: { name },
      geometry,
    };
    if (color) state.countryOverrides[id] = { ...(state.countryOverrides[id] || {}), color };
    return feature;
  }

  function projectedPointDistance(left, right) {
    return Math.hypot(Number(left?.[0]) - Number(right?.[0]), Number(left?.[1]) - Number(right?.[1]));
  }

  function pointSegmentDistance(point, start, end) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    if (!dx && !dy) return projectedPointDistance(point, start);
    const t = clamp(((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy), 0, 1);
    return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
  }

  function projectedLineDistance(geometry, screenPoint) {
    if (!geometry) return Infinity;
    const lines = geometry.type === 'LineString' ? [geometry.coordinates]
      : geometry.type === 'MultiLineString' ? geometry.coordinates
        : geometry.type === 'Polygon' ? geometry.coordinates
          : geometry.type === 'MultiPolygon' ? geometry.coordinates.flat()
            : [];
    let minimum = Infinity;
    for (const line of lines) {
      let previous = null;
      for (const coordinate of line || []) {
        const projected = activeProjection()(coordinate);
        if (previous && projected) minimum = Math.min(minimum, pointSegmentDistance(screenPoint, previous, projected));
        previous = projected;
      }
    }
    return minimum;
  }

  function geometryHitsScreenPoint(geometry, coord, screenPoint, tolerance = 8) {
    if (!geometry) return false;
    let bounds = geometryBoundsCache.get(geometry);
    if (!bounds) {
      bounds = coordinateBounds(geometry.coordinates);
      geometryBoundsCache.set(geometry, bounds);
    }
    const longitudeSpan = Number(bounds?.[2]) - Number(bounds?.[0]);
    const geographicTolerance = Math.max(0.15, 4 / Math.max(1, currentMapZoom()));
    if (bounds?.every(Number.isFinite) && longitudeSpan < 350 && (coord[0] < bounds[0] - geographicTolerance || coord[0] > bounds[2] + geographicTolerance || coord[1] < bounds[1] - geographicTolerance || coord[1] > bounds[3] + geographicTolerance)) return false;
    if (geometry.type === 'Point') {
      const projected = activeProjection()(geometry.coordinates);
      return !!projected && projectedPointDistance(projected, screenPoint) <= tolerance;
    }
    if (geometry.type === 'MultiPoint') return geometry.coordinates.some(point => {
      const projected = activeProjection()(point);
      return !!projected && projectedPointDistance(projected, screenPoint) <= tolerance;
    });
    if (geometry.type.includes('Polygon')) {
      try { if (d3.geo.contains({ type: 'Feature', properties: {}, geometry }, coord)) return true; } catch (_) {}
    }
    return projectedLineDistance(geometry, screenPoint) <= tolerance;
  }

  function selectableVisualRank(ref) {
    const order = state.layerPresentation?.overlayOrder || OVERLAY_GROUPS;
    let group = '';
    if (ref.domain === 'generic') group = 'genericFeatures';
    else if (ref.domain === 'distribution') group = DISTRIBUTION_TYPE_GROUPS[ref.type] || `${ref.type}s`;
    else if (ref.domain === 'territorial') group = ref.type === TERRITORIAL_UNIT_TYPES.ADMIN ? 'administrative' : ref.type === TERRITORIAL_UNIT_TYPES.REGION ? 'regions' : ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY ? 'countries' : 'territories';
    else if (ref.domain === 'label') group = 'labels';
    else if (ref.domain === 'hydro') group = 'hydro';
    const index = order.indexOf(group);
    if (index >= 0) return 1000 - index;
    return { labels: 1300, hydro: 850, countries: 500 }[group] || 700;
  }

  async function selectableObjectsAt(screenPoint, coord) {
    const candidates = [];
    const add = ref => {
      const normalized = normalizeObjectRef(ref);
      if (normalized && !candidates.some(candidate => candidate.key === normalized.key)) candidates.push(normalized);
    };
    selectionPerformanceMetrics.exactHitTestCount = 0;
    const indexed = indexedMapObjectCandidates(screenPoint);
    for (const entry of indexed) {
      if (entry.domain === 'label') {
        if (!state.layerVisibility.labels || !isLayerItemVisible('labels', entry.id)) continue;
        const label = state.labels.find(item => String(item.id) === entry.id);
        const projected = label ? activeProjection()(label.coordinates) : null;
        selectionPerformanceMetrics.exactHitTestCount += 1;
        if (projected && projectedPointDistance(projected, screenPoint) <= (isMobile() ? 18 : 11)) add({ domain: 'label', type: label.kind || 'label', id: label.id });
        continue;
      }
      if (entry.domain === 'generic') {
        if (!state.layerVisibility.genericFeatures || !isLayerItemVisible('genericFeatures', entry.id)) continue;
        const feature = state.genericFeatures.find(item => String(item.id) === entry.id);
        selectionPerformanceMetrics.exactHitTestCount += 1;
        if (feature && geometryHitsScreenPoint(feature.geometry, coord, screenPoint, isMobile() ? 14 : 8)) add({ domain: 'generic', type: 'feature', id: feature.id });
        continue;
      }
      if (entry.domain === 'distribution') {
        const row = indexedDistributionRow(entry.id);
        selectionPerformanceMetrics.exactHitTestCount += 1;
        if (row && geometryHitsScreenPoint(row.geometry, coord, screenPoint, isMobile() ? 12 : 7)) add({ domain: 'distribution', type: row.layer.type, id: row.layer.id });
        continue;
      }
      if (entry.domain === 'territorial') {
        const feature = territorialUnitById(entry.id);
        if (!feature) continue;
        const group = feature.properties?.unitType === TERRITORIAL_UNIT_TYPES.ADMIN ? 'administrative' : feature.properties?.unitType === TERRITORIAL_UNIT_TYPES.REGION ? 'regions' : 'territories';
        if (state.layerVisibility[group] === false || !isLayerItemVisible(group, feature.id)) continue;
        selectionPerformanceMetrics.exactHitTestCount += 1;
        if (geometryHitsScreenPoint(feature.geometry, coord, screenPoint, isMobile() ? 12 : 7)) add({ domain: 'territorial', type: feature.properties?.unitType || TERRITORIAL_UNIT_TYPES.TERRITORY, id: feature.id });
        continue;
      }
      if (entry.domain === 'hydro') {
        const feature = hydroEditById(entry.id);
        selectionPerformanceMetrics.exactHitTestCount += 1;
        if (feature && isHydroFeatureVisible(feature) && geometryHitsScreenPoint(feature.geometry, coord, screenPoint, isMobile() ? 14 : 8)) add({ domain: 'hydro', type: feature.properties?.category || 'river', id: feature.id });
      }
    }
    const canReuseHover = lastHoverHit?.ref?.type === TERRITORIAL_UNIT_TYPES.COUNTRY && lastHoverHit.feature
      && lastHoverPickViewRevision === viewRevision && lastHoverPickPoint
      && Math.hypot(screenPoint[0] - lastHoverPickPoint[0], screenPoint[1] - lastHoverPickPoint[1]) < 3;
    selectionPerformanceMetrics.pickCacheHit = !!canReuseHover;
    if (state.layerVisibility.countries) {
      let country;
      if (canReuseHover) country = lastHoverHit.feature;
      else {
        const pickStartedAt = performance.now();
        country = countryAtScreenPoint(screenPoint, coord, { verify: false });
        selectionPerformanceMetrics.gpuPickMs = performance.now() - pickStartedAt;
      }
      if (country) add({ domain: 'territorial', type: TERRITORIAL_UNIT_TYPES.COUNTRY, id: country.id });
    }
    if (state.layerVisibility.rivers || state.layerVisibility.lakes) {
      const hydro = await hydroAtScreenPoint(screenPoint, coord);
      if (hydro) add({ domain: 'hydro', type: hydro.properties?.category || 'river', id: hydro.properties?.pandolab_id || hydro.id });
    }
    return candidates.sort((left, right) => selectableVisualRank(right) - selectableVisualRank(left) || objectDisplayInfo(left).name.localeCompare(objectDisplayInfo(right).name, 'ko'));
  }

  function closeObjectChooser({ restoreFocus = false } = {}) {
    const chooser = $('objectChooser');
    if (!chooser) return;
    chooser.classList.add('hidden');
    chooser.removeAttribute('style');
    objectChooserCandidates = [];
    if (restoreFocus) $('map')?.focus();
  }

  function openObjectChooser(candidates, screenPoint) {
    const chooser = $('objectChooser');
    const list = $('objectChooserList');
    if (!chooser || !list || candidates.length < 2) return closeObjectChooser();
    if (isMobile() && surfaceController.activeMobileSheet) closeActiveMobileSheet();
    objectChooserCandidates = candidates.slice();
    list.replaceChildren(...candidates.map((ref, index) => {
      const info = objectDisplayInfo(ref);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `ui-button ui-row ui-card ui-selectable-row object-chooser-item${selectionDomain.has(ref) ? ' is-selected' : ''}`;
      button.dataset.objectChooserIndex = String(index);
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(selectionDomain.has(ref)));
      const name = document.createElement('span');
      const type = document.createElement('small');
      name.textContent = info.name;
      type.textContent = [info.type, info.detail].filter(Boolean).join(' · ');
      button.append(name, type);
      return button;
    }));
    chooser.classList.remove('hidden');
    if (isMobile()) {
      chooser.removeAttribute('style');
      requestAnimationFrame(() => list.querySelector('[role="option"]')?.focus({ preventScroll: true }));
      return;
    }
    const bounds = $('map')?.getBoundingClientRect();
    if (!bounds) return;
    const edge = 8;
    requestAnimationFrame(() => {
      const width = chooser.offsetWidth || 300;
      const height = chooser.offsetHeight || 200;
      chooser.style.left = `${clamp(screenPoint[0] + 12, edge, Math.max(edge, bounds.width - width - edge))}px`;
      chooser.style.top = `${clamp(screenPoint[1] + 12, edge, Math.max(edge, bounds.height - height - edge))}px`;
    });
  }

  async function handleObjectSelectionAt(screenPoint, { sourceEvent = d3.event, forcedRef = null } = {}) {
    const inputStartedAt = performance.now();
    const performanceBefore = selectionPerformanceCounterSnapshot();
    Object.assign(selectionPerformanceMetrics, {
      handlerMs: 0, indexQueryMs: 0, indexedCandidateCount: 0, exactHitTestCount: 0,
      gpuPickMs: 0, pickCacheHit: false, direct: false,
    });
    const normalizedForced = normalizeObjectRef(forcedRef);
    if (normalizedForced && objectRefExists(normalizedForced)) {
      selectionPerformanceMetrics.direct = true;
      const event = sourceEvent?.sourceEvent || sourceEvent || {};
      const mode = event.ctrlKey || event.metaKey || state.addSelectionMode ? 'toggle' : 'replace';
      selectionUiController.applyIntent(normalizedForced, { mode, scope: 'map' });
      selectionPerformanceMetrics.handlerMs = performance.now() - inputStartedAt;
      requestAnimationFrame(() => {
        publishSelectionPerformanceSample(inputStartedAt, performanceBefore, `direct:${normalizedForced.key}`);
      });
      return true;
    }
    const coord = screenToGeo(screenPoint);
    if (!coord) return false;
    const candidates = await selectableObjectsAt(screenPoint, coord);
    if (!candidates.length) {
      closeObjectChooser();
      selectionUiController.clear({ reason: 'empty-object-chooser' });
      return false;
    }
    const event = sourceEvent?.sourceEvent || sourceEvent || {};
    if (candidates.length > 1) {
      openObjectChooser(candidates, screenPoint);
      return true;
    }
    const target = normalizedForced || candidates[0];
    const mode = event.ctrlKey || event.metaKey || state.addSelectionMode ? 'toggle' : 'replace';
    selectionUiController.applyIntent(target, { mode, scope: 'map' });
    selectionPerformanceMetrics.handlerMs = performance.now() - inputStartedAt;
    requestAnimationFrame(() => {
      publishSelectionPerformanceSample(inputStartedAt, performanceBefore, `map:${target.key}`);
    });
    return true;
  }

  async function handleMapClick(screenPoint) {
    if (state.spacePanActive || state.tool === 'move') return;
    const rawCoord = screenToGeo(screenPoint);
    if (!rawCoord) return;
    const pointerType = d3.event?.pointerType === 'touch' || d3.event?.changedTouches ? 'touch' : 'mouse';
    const coord = rawCoord;
    if (state.labelPlacementMode) {
      addLabelAt(coord);
      return;
    }
    if (state.tool === 'select' && !state.labelPlacementMode) return handleObjectSelectionAt(screenPoint);
    const needsCountryHit = (state.tool === 'select' && !state.labelPlacementMode) ||
      (state.tool === 'new-country' && state.newCountryPhase === 'sources') ||
      (state.tool === 'annex-territory' && state.annexPhase === 'donor') ||
      (state.tool === 'country-border' && state.boundaryEditPhase === 'selecting') ||
      (state.tool === 'merge-country' && !!state.mergeSourceCountryId);
    const clickedCountry = needsCountryHit && state.layerVisibility.countries
      ? countryAtScreenPoint(screenPoint, coord)
      : null;
    if (state.tool === 'new-country' && state.newCountryPhase === 'sources') {
      if (clickedCountry) toggleNewCountrySource(clickedCountry.id);
      else setActionStatus('영토를 가져올 국가를 선택할 수 없습니다. 국가 영토 안쪽을 선택하세요.', 'error', 2600);
      return;
    }
    if (state.tool === 'annex-territory' && state.annexPhase === 'donor') {
      if (clickedCountry) toggleAnnexDonor(clickedCountry.id);
      else setActionStatus('영토를 가져올 국가를 선택할 수 없습니다. 국가 영토 안쪽을 선택하세요.', 'error', 2600);
      return;
    }
    if (state.tool === 'merge-country' && state.mergeSourceCountryId) {
      if (clickedCountry) toggleMergeTarget(clickedCountry.id);
      else setActionStatus('합병 대상을 선택할 수 없습니다. 국가 영토 안쪽을 선택하세요.', 'error', 2600);
      return;
    }
    if (state.tool === 'country-border' && state.boundaryEditPhase === 'selecting') {
      if (clickedCountry) toggleBoundaryEditCountry(clickedCountry.id);
      else setActionStatus('접경국을 선택할 수 없습니다. 국가 영토 안쪽을 선택하세요.', 'error', 2600);
      return;
    }
    if (state.tool === 'select' && !state.labelPlacementMode && clickedCountry) return;
    if (state.tool === 'annex-territory') {
      if (state.annexPhase === 'donor') {
        setActionStatus('영토를 가져올 국가를 먼저 지도에서 선택하세요.', 'error', 3200);
        return;
      }
      if (state.annexPhase !== 'line' && state.annexPhase !== 'polygon') return;
      if (!state.annexDonorCountryIds.length) {
        setActionStatus('선택한 국가를 찾을 수 없습니다. 영토를 가져올 국가를 다시 선택하세요.', 'error', 3400);
        return;
      }
      if (editingDraftSnapshot().inputPhase !== 'draw') return;
      editingDomain?.appendDraftScreenPoint?.(screenPoint, pointerType, { dedupe: true });
      return;
    }
    const newCountryLineMode = state.tool === 'new-country' && state.newCountryPhase === 'line';
    if (isGenericFeatureDraftTool(state.tool) || newCountryLineMode) {
      if (editingDraftSnapshot().inputPhase !== 'draw') return;
      editingDomain?.appendDraftScreenPoint?.(screenPoint, pointerType);
      return;
    }
    if (state.tool === 'point') {
      const feature = {
        type: 'Feature', id: uid('point'),
        geometry: { type: 'Point', coordinates: coord },
        properties: { name: '', color: DEFAULT_GENERIC_FEATURE_COLOR, role: 'generic', landBinding: 'none', schemaVersion: GENERIC_FEATURE_SCHEMA_VERSION },
      };
      genericFeatureService.add(feature);
      editingDomain?.setTool('select');
      applyGenericSelectionIntent(String(feature.id));
      setActionStatus('점 기타 객체를 추가했습니다.', 'success');
      return;
    }
    if (state.tool === 'select') selectionUiController.clear({ reason: 'map-background-selection-clear' });
  }

  function finishSplitGenericFeatureDraft() {
    const source = state.genericFeatures.find(item => String(item.id) === String(state.genericFeatureSplitSourceId));
    if (!source || genericFeatureGeometryKind(source) !== 'polygon') {
      setActionStatus('나눌 영역을 찾을 수 없습니다. 영역을 다시 선택하세요.', 'error', 3400);
      return;
    }
    try {
      const split = buildCutSplitCandidates(source.geometry, editingDraftCoordinates());
      const untouchedComponents = geometryPolygonSets(source.geometry)
        .filter((_, index) => index !== split.componentIndex)
        .map(polygon => deepClone(polygon));
      const retainedGeometry = normalizeClippedLandGeometry([
        ...geometryMultiCoordinates(split.candidates[0].geometry),
        ...untouchedComponents,
      ]);
      if (!retainedGeometry) throw new Error('나누지 않은 영토 조각을 보존할 수 없습니다.');
      const baseName = genericFeatureName(source);
      const sourceAfter = deepClone(source);
      sourceAfter.geometry = retainedGeometry;
      sourceAfter.properties.name = `${baseName} 1`;
      const sibling = normalizeGenericFeatureSemantics({
        type: 'Feature',
        id: uid('area'),
        geometry: deepClone(split.candidates[1].geometry),
        properties: { ...deepClone(sourceAfter.properties), name: `${baseName} 2` },
      }, { inferOwner: false });
      beginLocalGeometryPreview({
        operation: 'split-generic-feature',
        beforeFeatures: [source],
        afterFeatures: [sourceAfter, sibling],
        applyResult: () => {
          projectDomain.recordHistory();
          source.geometry = deepClone(sourceAfter.geometry);
          source.properties = deepClone(sourceAfter.properties);
          state.genericFeatures.push(deepClone(sibling));
          editingDomain?.clearDraft?.(true);
          editingDomain?.setTool('select', { announce: false });
          applyGenericSelectionIntent(String(source.id), true);
        },
        successMessage: `${baseName} 영역을 두 영역으로 나눴습니다.`,
        errorMessage: '영역 나누기 결과를 적용하지 못했습니다.',
      });
    } catch (error) {
      reportOperationError(error, '영역을 나누지 못했습니다. 영역을 한 번만 관통하도록 경계를 다시 그리세요.', 'PL-LAND-003', 4200);
    }
  }

  function prepareAnnexDraftCandidates() {
    const targetId = String(state.annexTargetCountryId || '');
    const target = countryFeatureById(targetId);
    if (state.annexPhase !== 'line' || !target || !state.annexDonorCountryIds.length) {
      setActionStatus('편입을 진행할 수 없습니다. 편입받을 국가와 영토를 가져올 국가를 먼저 선택하세요.', 'error', 3800);
      return;
    }
    try {
      const sourceGeometry = state.annexSourceGeometry || selectedCountryUnionGeometry(state.annexDonorCountryIds);
      const split = buildCutSplitCandidates(sourceGeometry, editingDraftCoordinates());
      state.annexComponentIndex = split.componentIndex;
      editingDomain?.replaceDraftCoordinates?.(split.cutLine, { record: false, inputPhase: 'refine' });
      state.annexCandidates = split.candidates;
      state.annexSelectedCandidateIndex = split.candidates[0].area <= split.candidates[1].area ? 0 : 1;
      state.annexPhase = 'side';
      setModeBanner('편입할 영역을 선택하세요.', 'annex-mode');
      updateModeButtons();
      renderingDomain?.invalidateGpuInteraction?.('annex-candidates-ready');
    } catch (error) {
      reportOperationError(error, '새 경계를 사용할 수 없습니다. 영토를 가져올 국가를 한 번만 관통하도록 선을 다시 그리세요.', 'PL-ANNEX-003');
    }
  }

  function prepareNewCountryDraftCandidates() {
    if (state.newCountryPhase !== 'line') {
      setActionStatus('새 국가를 만들 수 없습니다. 영토를 가져올 국가 선택을 먼저 완료하세요.', 'error', 3600);
      return;
    }
    try {
      const sourceGeometry = state.newCountrySourceGeometry || selectedCountryUnionGeometry(state.newCountrySourceIds);
      const split = buildCutSplitCandidates(sourceGeometry, editingDraftCoordinates());
      editingDomain?.replaceDraftCoordinates?.(split.cutLine, { record: false, inputPhase: 'refine' });
      state.newCountryCandidates = split.candidates;
      state.newCountrySelectedCandidateIndex = split.candidates[0].area <= split.candidates[1].area ? 0 : 1;
      state.newCountryPhase = 'side';
      setModeBanner('신생국으로 만들 영역을 선택하세요.', 'add-country-mode');
      updateModeButtons();
      renderingDomain?.invalidateGpuInteraction?.('new-country-candidates-ready');
    } catch (error) {
      reportOperationError(error, '신생국 국경선을 사용할 수 없습니다. 선택 영토를 한 번만 관통하도록 선을 다시 그리세요.', 'PL-COUNTRY-003');
    }
  }

  function prepareAnnexPolygon() {
    const target = countryFeatureById(String(state.annexTargetCountryId || ''));
    const donors = state.annexDonorCountryIds.map(countryFeatureById).filter(Boolean);
    if (state.annexPhase !== 'polygon' || !target || !donors.length) return;
    const plan = planDrawnTerritoryAnnex({
      drawnGeometry: { type: 'Polygon', coordinates: [ensureClosedRing(editingDraftCoordinates())] },
      donorFeatures: donors,
      targetFeature: target,
      clipper: window.polygonClipping,
    });
    if (!plan?.transferGeometry) {
      setActionStatus('그린 영역 안에 편입할 영토가 없습니다.', 'error', 3200);
      return;
    }
    state.annexCandidates = [{ geometry: plan.transferGeometry }];
    state.annexSelectedCandidateIndex = 0;
    state.annexPhase = 'polygon-preview';
    setModeBanner('편입할 영역을 선택하세요.', 'annex-mode');
    updateModeButtons();
    renderingDomain?.invalidateGpuInteraction?.('annex-polygon-ready');
  }

  function resetRiverPartitionState({ preserveCache = true } = {}) {
    riverPartitionGeneration += 1;
    state.annexRiverPartitionStatus = 'idle';
    state.annexRiverPartitionCandidates = [];
    state.annexRiverPartitionDonorResults = [];
    state.annexHoveredComponentKey = null;
    if (!preserveCache) riverPartitionCache.clear();
  }

  function riverPartitionGeometrySignature(feature) {
    if (!feature?.geometry) return '';
    return `${String(feature.id || '')}:${JSON.stringify(feature.geometry.coordinates || [])}`;
  }

  function riverPartitionHydroSignature() {
    const edits = state.hydroEdits
      .filter(feature => feature?.properties?.category === 'river' && feature.geometry)
      .map(feature => `${String(feature.id)}:${JSON.stringify(feature.geometry.coordinates || [])}`)
      .sort();
    return `${state.hydroManifest?.version || ''}:${state.hydroManifest?.index?.sha256 || ''}:${edits.join('|')}`;
  }

  function riverPartitionCandidateSignature(donors) {
    return [
      ...donors.map(riverPartitionGeometrySignature).sort(),
      riverPartitionHydroSignature(),
      RIVER_TERRITORY_PARTITION_ALGORITHM_REVISION,
      riverTerritoryPartitionConfigFingerprint(RIVER_TERRITORY_PARTITION_CONFIG),
    ].join('::');
  }

  function riverPartitionBoundsOverlap(left, right) {
    return !!left && !!right && left[0] <= right[2] && left[2] >= right[0] && left[1] <= right[3] && left[3] >= right[1];
  }

  function riverPartitionQueryBounds(geometry) {
    const output = [];
    for (const polygon of geometryPolygonSets(geometry)) {
      const longitudes = [];
      let minLatitude = Infinity;
      let maxLatitude = -Infinity;
      let minLongitude = Infinity;
      let maxLongitude = -Infinity;
      for (const ring of polygon || []) for (const point of ring || []) {
        const longitude = Number(point?.[0]);
        const latitude = Number(point?.[1]);
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
        longitudes.push(longitude);
        minLatitude = Math.min(minLatitude, latitude);
        maxLatitude = Math.max(maxLatitude, latitude);
        minLongitude = Math.min(minLongitude, longitude);
        maxLongitude = Math.max(maxLongitude, longitude);
      }
      if (!longitudes.length) continue;
      if (maxLongitude - minLongitude <= 180) {
        output.push([minLongitude, minLatitude, maxLongitude, maxLatitude]);
        continue;
      }
      let eastMinimum = Infinity;
      let westMaximum = -Infinity;
      for (const longitude of longitudes) {
        if (longitude >= 0) eastMinimum = Math.min(eastMinimum, longitude);
        else westMaximum = Math.max(westMaximum, longitude);
      }
      if (Number.isFinite(eastMinimum)) output.push([eastMinimum, minLatitude, 180, maxLatitude]);
      if (Number.isFinite(westMaximum)) output.push([-180, minLatitude, westMaximum, maxLatitude]);
    }
    return output;
  }

  function riverPartitionFeatureKey(feature) {
    return String(feature?.properties?.pandolab_id ?? feature?.properties?.__logicalFid ?? feature?.id ?? '');
  }

  function riverPartitionRequestActive() {
    return state.tool === 'annex-territory'
      && state.annexPhase === 'components'
      && state.annexUseRiverBoundaries;
  }

  function applyRiverPartitionResult(candidates, donorResults) {
    state.annexRiverPartitionCandidates = candidates;
    state.annexRiverPartitionDonorResults = donorResults;
    const composition = annexRiverBoundaryComposition(territoryBaseComponentItems());
    state.annexRiverPartitionStatus = composition.items.length ? 'ready' : 'error';
    return composition;
  }

  function riverPartitionResultMessage(candidates, donorResults, donors) {
    const invalidIds = new Set((donorResults || []).filter(result => result.status === 'invalid').map(result => String(result.donorCountryId)));
    const invalidNames = donors.filter(feature => invalidIds.has(String(feature.id))).map(countryName);
    const suffix = invalidNames.length ? ` ${invalidNames.join(', ')}은(는) 분할 오류로 제외했습니다.` : '';
    const composition = annexRiverBoundaryComposition(territoryBaseComponentItems());
    if (candidates.length) return `하천을 경계로 나눈 영토 조각을 선택하세요. 여러 조각을 선택할 수 있습니다.${suffix}`;
    if (composition.items.length) return `분할 가능한 하천이 없어 기존 영토 조각을 표시합니다.${suffix}`;
    return invalidNames.length
      ? `하천 분할 오류로 ${invalidNames.join(', ')}의 영토 조각을 표시할 수 없습니다.`
      : '표시할 수 있는 영토 조각이 없습니다.';
  }

  async function prepareRiverPartitionCandidates({ targetCountryId = state.annexTargetCountryId, donorCountryIds = state.annexDonorCountryIds } = {}) {
    await ensureGisRuntime();
    const target = countryFeatureById(String(targetCountryId || ''));
    const donors = [...new Set((donorCountryIds || []).map(String))].map(countryFeatureById).filter(Boolean);
    if (!riverPartitionRequestActive() || !target || !donors.length) return;
    const signature = riverPartitionCandidateSignature(donors);
    resetRiverPartitionState();
    const generation = riverPartitionGeneration;
    const current = () => riverPartitionRequestActive()
      && generation === riverPartitionGeneration
      && signature === riverPartitionCandidateSignature(state.annexDonorCountryIds.map(countryFeatureById).filter(Boolean));
    const cached = riverPartitionCache.get(signature);
    if (cached) {
      const candidates = structuredClone(cached.candidates);
      const donorResults = structuredClone(cached.donorResults || []);
      applyRiverPartitionResult(candidates, donorResults);
      setModeBanner(riverPartitionResultMessage(candidates, donorResults, donors), 'annex-mode');
      updateModeButtons();
      renderingDomain?.invalidateGpuInteraction?.('river-partition-cache-ready');
      return;
    }
    state.annexRiverPartitionStatus = 'loading';
    setModeBanner('피편입국을 가로지르는 강으로 영토 조각을 계산하는 중입니다.', 'annex-mode');
    updateModeButtons();
    renderingDomain?.invalidateGpuInteraction?.('river-partition-loading');
    try {
      const sources = await gisDomain.loadRiverPartitionFeatures(donors);
      if (!current()) return;
      const result = await gisDomain.computeRiverPartition({
        donors: donors.map(feature => ({
          countryId: String(feature.id || ''),
          geometry: feature.geometry,
          geometryRevision: countryLandRevision,
        })),
        riverFeatures: sources.features,
        hydroRevision: riverPartitionHydroSignature(),
        config: RIVER_TERRITORY_PARTITION_CONFIG,
        algorithmRevision: RIVER_TERRITORY_PARTITION_ALGORITHM_REVISION,
      });
      if (!current()) return;
      if (!result) return;
      const candidates = (result.candidates || []).map(candidate => ({
        ...candidate,
        geometry: normalizeClippedLandGeometry(candidate?.geometry),
      })).filter(candidate => candidate.geometry && candidate.donorCountryId);
      const donorResults = result.donorResults || [];
      const diagnostics = { ...sources.diagnostics, ...(result.diagnostics || {}) };
      riverPartitionCache.set(signature, { candidates: structuredClone(candidates), donorResults: structuredClone(donorResults), diagnostics });
      if (riverPartitionCache.size > 8) riverPartitionCache.delete(riverPartitionCache.keys().next().value);
      applyRiverPartitionResult(candidates, donorResults);
      setModeBanner(riverPartitionResultMessage(candidates, donorResults, donors), 'annex-mode');
      updateModeButtons();
      renderingDomain?.invalidateGpuInteraction?.('river-partition-ready');
    } catch (error) {
      if (!current()) return;
      state.annexRiverPartitionStatus = error?.code === 'RIVER_PARTITION_SOURCE_ERROR' ? 'source-error' : 'error';
      state.annexRiverPartitionCandidates = [];
      state.annexRiverPartitionDonorResults = [];
      setModeBanner(error?.code === 'RIVER_PARTITION_SOURCE_ERROR'
        ? '피편입국을 가로지르는 하천 데이터를 불러오지 못했습니다.'
        : '강으로 분리되는 영토 조각을 계산하지 못했습니다.', 'annex-mode');
      updateModeButtons();
      reportOperationError(error, '강으로 분리되는 영토 조각을 계산하지 못했습니다. 잠시 후 다시 시도하세요.', 'PL-ANNEX-RIVER-001', 4200);
    }
  }

  function finishGenericFeatureDraft(polygonMode) {
    const draftCoords = editingDraftCoordinates();
    const hydro = hydroToolConfig(state.tool);
    const id = uid(hydro?.prefix || (polygonMode ? 'poly' : 'line'));
    const geometry = polygonMode
      ? { type: 'Polygon', coordinates: [orientRing(draftCoords, true)] }
      : { type: 'LineString', coordinates: draftCoords.map(coord => coord.slice()) };
    if (polygonMode) {
      const issues = validateStructuredGeometry({ type: 'Feature', id, properties: {}, geometry });
      if (issues.length) {
        setActionStatus(issues[0].message || '그린 영역을 저장할 수 없습니다. 표시된 경계를 수정하세요.', 'error', 4200);
        updateModeButtons();
        return;
      }
    }
    if (polygonMode && state.distributionDraft) {
      const draft = state.distributionDraft;
      const layer = distributionLayerById(draft.layerId);
      if (!layer) {
        setActionStatus('분포 항목을 찾을 수 없습니다. 그린 영역은 유지했으니 분포 항목을 확인하세요.', 'error', 3600);
        return;
      }
      const result = distributionService.addEntry({
        id: uid('distribution_entry'),
        layerId: layer.id,
        mode: DISTRIBUTION_MODES.GEOMETRY,
        geometry,
        share: draft.share,
      });
      if (!result.ok) {
        setActionStatus(result.error?.message || '자유 분포 영역을 저장하지 못했습니다.', 'error', 3600);
        return;
      }
      state.distributionDraft = null;
      editingDomain?.clearDraft?.({ reason: 'distribution-draft-committed', render: false });
      editingDomain?.setTool('select', { announce: false });
      applyDistributionSelectionIntent(layer.id);
      setActionStatus(`${layer.name} 자유 분포 영역을 추가했습니다.`, 'success');
      return;
    }
    const feature = {
      type: 'Feature', id, geometry,
      properties: hydro
        ? {
          name: '',
          editorColor: hydro.color,
          category: hydro.category,
          notes: '',
        }
        : {
          name: '',
          color: DEFAULT_GENERIC_FEATURE_COLOR,
          role: 'generic',
          landBinding: 'none',
          notes: '',
          schemaVersion: GENERIC_FEATURE_SCHEMA_VERSION,
        },
    };
    if (hydro) {
      projectDomain.recordHistory();
      normalizeHydroEdit(feature);
      state.hydroEdits.push(feature);
    } else {
      genericFeatureService.add(feature);
    }
    editingDomain?.clearDraft?.({ reason: 'feature-draft-committed', render: false });
    editingDomain?.setTool('select', { announce: false });
    markLayerTreeDirty();
    if (hydro) applyHydroSelectionIntent(String(id));
    else applyGenericSelectionIntent(String(id));
    renderingDomain?.invalidateGpuInteraction?.('finish-generic-draft');
    if (hydro) projectDomain.queueAutosave();
    const createdObjectLabel = hydro?.category === 'river' ? '강을' : hydro?.category === 'lake' ? '호수를' : '기타 객체를';
    setActionStatus(`${createdObjectLabel} 추가했습니다.`, 'success');
  }

  function finishDraft() {
    if (!(isGenericFeatureDraftTool(state.tool) || ['new-country', 'annex-territory'].includes(state.tool))) {
      setActionStatus('완료할 형상이 없습니다. 지도에서 점을 먼저 입력하세요.', 'error');
      return;
    }
    const polygonMode = isPolygonDraftTool(state.tool);
    const minimumPoints = polygonMode ? 3 : 2;
    const draft = editingDraftSnapshot();
    if (draft.coords.length < minimumPoints) {
      setActionStatus(`완료하려면 점이 최소 ${minimumPoints}개 필요합니다. 지도에서 점을 더 입력하세요.`, 'error');
      return;
    }
    if (draft.strokeActive) {
      setActionStatus('선을 그리는 중입니다. 포인터를 놓은 뒤 완료하세요.', 'error', 2400);
      return;
    }
    const cutSourceGeometry = activeCutDraftSourceGeometry();
    if (!cutSourceGeometry && draft.issues.length) {
      setActionStatus(draft.issues[0].message || '그린 형상에서 수정이 필요한 위치를 확인하세요.', 'error', 4200);
      updateModeButtons();
      return;
    }
    if (cutSourceGeometry) {
      const assessment = assessCutDraft(draft.coords, cutSourceGeometry);
      if (!assessment.valid) {
        setActionStatus(assessment.message || '경계선을 선택 영역의 반대쪽 경계까지 연결하세요.', 'error', 4200);
        updateModeButtons();
        return;
      }
    }
    dispatchTool(state.tool, {
      'split-generic-feature': finishSplitGenericFeatureDraft,
      'split-territorial-unit': finishTerritorialUnitSplitDraft,
      'redraw-territorial-unit': finishTerritorialUnitRedrawDraft,
      'draw-territorial-unit': finishTerritorialUnitDirectDraft,
      'annex-territory': state.annexPhase === 'polygon' ? prepareAnnexPolygon : prepareAnnexDraftCandidates,
      'new-country': prepareNewCountryDraftCandidates,
    }, () => finishGenericFeatureDraft(polygonMode));
  }

  async function completeLinearAnnexation(candidateIndex) {
    if (state.tool !== 'annex-territory' || !['side', 'polygon-preview', 'components'].includes(state.annexPhase)) return;
    const targetId = String(state.annexTargetCountryId || '');
    const componentMode = state.annexPhase === 'components';
    const selectedComponents = componentMode ? selectedTerritoryComponentItems() : [];
    const donorIds = componentMode
      ? [...new Set(selectedComponents.map(item => String(item.countryId)).filter(Boolean))]
      : state.annexDonorCountryIds.map(String);
    if (!requireCountriesUnlocked([targetId, ...donorIds], '영토를 편입')) return;
    let candidate;
    if (componentMode) {
      try { candidate = { geometry: selectedTerritoryComponentGeometry() }; }
      catch (error) {
        reportOperationError(error, '선택한 영토 조각을 확인하지 못했습니다. 영역을 다시 선택하세요.', 'PL-ANNEX-001', 3800);
        return;
      }
    } else {
      const selectedIndex = candidateIndex === null ? NaN : Number(candidateIndex);
      candidate = Number.isInteger(selectedIndex) && selectedIndex >= 0 ? state.annexCandidates[selectedIndex] : null;
    }
    const targetBefore = countryFeatureById(targetId);
    const donorsBefore = donorIds.map(countryFeatureById).filter(Boolean);
    if (!candidate?.geometry || !targetBefore || !donorsBefore.length) {
      setActionStatus('편입 후보나 국가 데이터를 찾을 수 없습니다.', 'error', 3800);
      return;
    }
    const targetName = countryName(targetBefore);
    const snapshot = snapshotEditable();
    await beginWorkerGeometryPreview({
      operation: 'annex',
      payload: { targetId, donorIds, transferredGeometry: candidate.geometry },
      snapshot,
      transferredGeometry: candidate.geometry,
      applyResult: plan => {
        const affectedIds = new Set(plan.affectedIds);
        applyWorkerCountryPatches(plan);
        reindexCountries(state.countriesData, true);
        transferLandDependents(candidate.geometry, donorIds, targetId);
        refreshCountryCentroids(affectedIds);
        state.boundaryTopology = { edges: new Map(), nodes: new Map() };
        if (!countryFeatureById(targetId)) throw new Error('편입받을 국가가 편입 결과에서 사라졌습니다.');
        editingDomain?.clearDraft?.({ reason: 'annex-committed', render: false });
        editingDomain?.setTool('select', { announce: false });
        applyCountrySelectionIntent(targetId);
        renderingDomain?.invalidateTerritorialPatch?.('territory-annex-committed');
      },
      onSuccess: plan => {
        const removedText = plan.removedIds.length ? ` · ${plan.removedIds.length}개국 완전 흡수` : '';
        const selectedText = componentMode ? `선택한 ${selectedComponents.length}개 영토 조각을 ` : '선택한 ';
        setActionStatus(`${selectedText}${plan.affectedDonorIds.length}개국의 영토를 ${targetName}에 편입했습니다${removedText}.`, 'success', 4000);
      },
      onError: error => reportOperationError(error, '영토를 편입하지 못해 변경을 되돌렸습니다. 편입 범위를 조정한 뒤 다시 시도하세요.', 'PL-ANNEX-002'),
    });
  }

  async function completeNewCountryCreation(candidateIndex) {
    if (state.tool !== 'new-country' || !['side', 'components'].includes(state.newCountryPhase)) return;
    let candidate;
    if (state.newCountryPhase === 'components') {
      try { candidate = { geometry: selectedTerritoryComponentGeometry() }; }
      catch (error) {
        reportOperationError(error, '선택한 영토 조각을 확인하지 못했습니다. 영역을 다시 선택하세요.', 'PL-COUNTRY-001', 3800);
        return;
      }
    } else {
      const selectedIndex = candidateIndex === null ? NaN : Number(candidateIndex);
      candidate = Number.isInteger(selectedIndex) && selectedIndex >= 0 ? state.newCountryCandidates[selectedIndex] : null;
    }
    if (!candidate?.geometry) {
      setActionStatus('신생국 영토 후보를 찾을 수 없습니다.', 'error', 3800);
      return;
    }
    if (!requireCountriesUnlocked(state.newCountrySourceIds, '새 국가를 분리')) return;
    const nameInput = prompt('새 국가의 국명을 입력하세요.', '새 국가');
    if (nameInput === null) return;
    const sourceIds = state.newCountrySourceIds.map(String);
    const snapshot = snapshotEditable();
    const feature = createCountryFeature(
      nameInput.trim() || '새 국가',
      editingDraftCoordinates(),
      null,
      snapGeometryToGrid(candidate.geometry, 7),
    );
    await beginWorkerGeometryPreview({
      operation: 'new-country',
      payload: { sourceIds, transferredGeometry: candidate.geometry, newFeature: feature },
      snapshot,
      transferredGeometry: candidate.geometry,
      applyResult: transferPlan => {
        const affectedIds = new Set(transferPlan.affectedIds);
        applyWorkerCountryPatches(transferPlan);
        reindexCountries(state.countriesData, true);
        transferLandDependents(candidate.geometry, sourceIds, feature.id);
        refreshCountryCentroids(affectedIds);
        state.boundaryTopology = { edges: new Map(), nodes: new Map() };
        editingDomain?.clearDraft?.({ reason: 'country-created', render: false });
        editingDomain?.setTool('select', { announce: false });
        applyCountrySelectionIntent(feature.id);
        renderingDomain?.invalidateCountryPatch?.('new-country-committed');
      },
      onSuccess: transferPlan => {
        const removedText = transferPlan.removedIds.length ? ` · 원본 ${transferPlan.removedIds.length}개국 완전 흡수` : '';
        setActionStatus(`${countryName(feature)} 국가를 추가했습니다${removedText}.`, 'success', 4200);
      },
      onError: error => reportOperationError(error, '국가를 추가하지 못해 변경을 되돌렸습니다. 선택 범위를 조정한 뒤 다시 시도하세요.', 'PL-COUNTRY-002'),
    });
  }

  async function completeCountryMerge() {
    const sourceId = String(state.mergeSourceCountryId || '');
    const targetIds = [...new Set(state.mergeTargetCountryIds.map(String))].filter(id => id && id !== sourceId);
    if (!sourceId || !targetIds.length) {
      setActionStatus('합병할 국가를 하나 이상 선택하세요.', 'error', 3200);
      return;
    }
    if (!requireCountriesUnlocked([sourceId, ...targetIds], '국가를 합병')) return;
    const source = countryFeatureById(sourceId);
    const targets = targetIds.map(countryFeatureById).filter(Boolean);
    if (!source || targets.length !== targetIds.length) {
      setActionStatus('합병할 국가를 찾을 수 없습니다. 대상을 다시 선택하세요.', 'error');
      return;
    }
    const sourceName = countryName(source);
    const snapshot = snapshotEditable();
    await beginWorkerGeometryPreview({
      operation: 'merge',
      payload: { sourceId, targetIds },
      snapshot,
      applyResult: result => {
        applyWorkerCountryPatches(result);
        state.countryOverrides[sourceId] = { ...(state.countryOverrides[sourceId] || {}), name: sourceName };
        for (const targetId of targetIds) delete state.countryOverrides[targetId];
        reindexCountries(state.countriesData, true);
        reassignLandDependents(targetIds, sourceId);
        refreshCountryCentroids(new Set([sourceId]));
        state.boundaryTopology = { edges: new Map(), nodes: new Map() };
        editingDomain?.setTool('select', { announce: false });
        applyCountrySelectionIntent(sourceId);
        renderingDomain?.invalidateCountryPatch?.('country-merge-committed');
      },
      onSuccess: () => setActionStatus(`${targetIds.length}개국을 ${sourceName}에 합병했습니다.`, 'success', 3200),
      onError: error => reportOperationError(error, '국가를 합병하지 못해 변경을 되돌렸습니다. 대상을 다시 확인하세요.', 'PL-MERGE-001'),
    });
  }

  function countryIdsOverlappingGeometry(geometry, excludeIds = []) {
    const clipper = window.polygonClipping;
    if (!geometry || !clipper?.intersection) return [];
    const excluded = new Set(excludeIds.map(String));
    const bounds = geometryBounds(geometry);
    return spatialFeatures(bounds)
      .filter(country => {
        const id = String(country.id || '');
        return id && !excluded.has(id)
          && multiPolygonPlanarArea(clipper.intersection(geometry.coordinates, country.geometry.coordinates)) > 1e-14;
      })
      .map(country => String(country.id));
  }

  function geometryClippedToCurrentLand(geometry) {
    const clipper = window.polygonClipping;
    if (!geometry || !clipper?.intersection || !clipper?.union) return null;
    const pieces = [];
    const bounds = geometryBounds(geometry);
    for (const country of spatialFeatures(bounds)) {
      const overlap = clipper.intersection(geometry.coordinates, country.geometry.coordinates);
      if (overlap?.length) pieces.push(...overlap);
    }
    if (!pieces.length) return null;
    return normalizeClippedLandGeometry(pieces.length === 1 ? pieces : clipper.union(...pieces.map(polygon => [polygon])));
  }

  async function applySelectedGenericFeatureToOwnerCountry() {
    if (state.selected?.domain !== 'generic') return;
    const feature = state.genericFeatures.find(item => String(item.id) === String(state.selected.id));
    const ownerId = String(feature?.properties?.ownerId || '');
    const owner = countryFeatureById(ownerId);
    if (!feature || genericFeatureGeometryKind(feature) !== 'polygon' || !owner) {
      setActionStatus('국가 영토에 반영할 수 없습니다. 면 객체의 소유 국가를 먼저 지정하세요.', 'error', 4000);
      return;
    }
    const transferredGeometry = geometryClippedToCurrentLand(feature.geometry);
    if (!transferredGeometry) {
      setActionStatus('국가 영토에 반영할 육지 영역이 없습니다. 형상과 소유 국가를 확인하세요.', 'error', 3800);
      return;
    }
    const donorIds = countryIdsOverlappingGeometry(transferredGeometry, [ownerId]);
    if (!requireCountriesUnlocked([ownerId, ...donorIds], '국가 영토에 반영')) return;
    if (!donorIds.length) {
      projectDomain.recordHistory();
      feature.geometry = normalizeClippedLandGeometry(window.polygonClipping.intersection(feature.geometry.coordinates, owner.geometry.coordinates)) || feature.geometry;
      normalizeGenericFeatureSemantics(feature, { inferOwner: false });
      applyGenericSelectionIntent(String(feature.id), true);
      renderingDomain?.invalidateGenericPatch?.('generic-owner-clip-preview');
      projectDomain.queueAutosave();
      setActionStatus('영역이 이미 소유 국가 안에 있습니다. 국가 해안선 결합을 갱신했습니다.', 'success', 3400);
      return;
    }
    const snapshot = snapshotEditable();
    setActionStatus('영역을 국가 영토에 반영하는 중입니다.', 'working', 0);
    await transactCountryEdit({
      operation: 'annex',
      payload: { targetId: ownerId, donorIds, transferredGeometry },
      snapshot,
      applyResult: result => {
        applyWorkerCountryPatches(result);
        reindexCountries(state.countriesData, true);
        transferLandDependents(transferredGeometry, donorIds, ownerId);
        normalizeGenericFeatureSemantics(feature, { inferOwner: false });
        refreshCountryCentroids(new Set(result.affectedIds));
        applyGenericSelectionIntent(String(feature.id), true);
        renderingDomain?.invalidateGenericPatch?.('generic-owner-clip-committed');
      },
      onSuccess: () => setActionStatus(`${genericFeatureName(feature)} 영역을 ${countryName(countryFeatureById(ownerId))} 영토에 반영했습니다.`, 'success', 3800),
      onError: error => reportOperationError(error, '영역을 국가 영토에 반영하지 못했습니다. 소유 국가와 겹치는 범위를 확인하세요.', 'PL-LAND-001', 4600),
    });
  }

  async function promoteSelectedGenericFeatureToCountry() {
    if (state.selected?.domain !== 'generic') return;
    const feature = state.genericFeatures.find(item => String(item.id) === String(state.selected.id));
    if (!feature || genericFeatureGeometryKind(feature) !== 'polygon') {
      setActionStatus('국가로 전환할 수 없습니다. 면 객체를 선택하세요.', 'error', 3400);
      return;
    }
    const transferredGeometry = geometryClippedToCurrentLand(feature.geometry);
    const sourceIds = transferredGeometry ? countryIdsOverlappingGeometry(transferredGeometry) : [];
    if (!transferredGeometry || !sourceIds.length) {
      setActionStatus('국가로 전환할 육지 영역이 없습니다. 객체가 현재 국가 영토와 겹치는지 확인하세요.', 'error', 4000);
      return;
    }
    if (!requireCountriesUnlocked(sourceIds, '국가로 전환')) return;
    const name = String(feature.properties?.name || '').trim();
    if (!name) {
      setActionStatus('국가로 전환하기 전에 객체 이름을 입력하세요.', 'error', 3400);
      return;
    }
    const snapshot = snapshotEditable();
    const country = createCountryFeature(name, [], feature.properties?.color || null, snapGeometryToGrid(transferredGeometry, 7));
    setActionStatus('영역을 국가로 전환하는 중입니다.', 'working', 0);
    await transactCountryEdit({
      operation: 'new-country',
      payload: { sourceIds, transferredGeometry, newFeature: country },
      snapshot,
      applyResult: result => {
        applyWorkerCountryPatches(result);
        transferLandDependents(transferredGeometry, sourceIds, country.id, [feature.id]);
        state.genericFeatures = state.genericFeatures.filter(item => String(item.id) !== String(feature.id));
        reindexCountries(state.countriesData, true);
        refreshCountryCentroids(new Set(result.affectedIds));
        applyCountrySelectionIntent(country.id);
        renderingDomain?.invalidateCountryPatch?.('generic-promoted-country');
      },
      onSuccess: () => setActionStatus(`${name} 영역을 독립 국가로 전환했습니다.`, 'success', 3600),
      onError: error => reportOperationError(error, '영역을 국가로 전환하지 못했습니다. 다른 국가와의 중첩과 형상을 확인하세요.', 'PL-LAND-002', 4600),
    });
  }

  function alignSelectedGenericFeatureToOwnerLand() {
    if (state.selected?.domain !== 'generic') return;
    const feature = state.genericFeatures.find(item => String(item.id) === String(state.selected.id));
    const owner = countryFeatureById(feature?.properties?.ownerId);
    if (!feature || !owner || genericFeatureGeometryKind(feature) !== 'polygon') {
      setActionStatus('국가 육지에 맞출 수 없습니다. 면 객체의 소유 국가를 먼저 지정하세요.', 'error', 3800);
      return;
    }
    const next = normalizeClippedLandGeometry(window.polygonClipping.intersection(feature.geometry.coordinates, owner.geometry.coordinates));
    if (!next) {
      setActionStatus('객체와 소유 국가가 겹치지 않습니다. 소유 국가를 다시 지정하세요.', 'error', 3800);
      return;
    }
    projectDomain.recordHistory();
    feature.geometry = next;
    mapObjectGeometryRevisions.generic += 1;
    feature.properties.landBinding = 'hard';
    feature.properties.topologyGroup = `land:${feature.properties.ownerId}`;
    genericFeatureLandClipCache.delete(feature);
    applyGenericSelectionIntent(String(feature.id), true);
    renderingDomain?.invalidateGenericPatch?.('generic-owner-align');
    projectDomain.queueAutosave();
    setActionStatus('객체를 소유 국가의 현재 육지와 맞췄습니다.', 'success', 3200);
  }

  function enterGenericFeatureSplitMode(id) {
    const feature = state.genericFeatures.find(item => String(item.id) === String(id));
    if (!feature || genericFeatureGeometryKind(feature) !== 'polygon') return false;
    state.genericFeatureSplitSourceId = String(id);
    editingDomain?.setTool('split-generic-feature', { announce: false });
    state.genericFeatureSplitSourceId = String(id);
    setModeBanner(defaultDraftInstruction());
    return true;
  }

  function enterGenericFeatureMergeMode(id) {
    const feature = state.genericFeatures.find(item => String(item.id) === String(id));
    if (!feature || genericFeatureGeometryKind(feature) !== 'polygon') return false;
    state.genericFeatureMergeSourceId = String(id);
    state.genericFeatureMergeTargetIds = [];
    editingDomain?.setTool('merge-generic-feature', { announce: false });
    state.genericFeatureMergeSourceId = String(id);
    setModeBanner('합칠 영역을 선택하세요.');
    return true;
  }

  function toggleGenericFeatureMergeTarget(id) {
    if (state.tool !== 'merge-generic-feature') return;
    const source = state.genericFeatures.find(item => String(item.id) === String(state.genericFeatureMergeSourceId));
    const target = state.genericFeatures.find(item => String(item.id) === String(id));
    if (!source || !target || String(source.id) === String(target.id)) return;
    if (genericFeatureRole(source) !== genericFeatureRole(target) || genericFeatureGeometryKind(target) !== 'polygon') {
      setActionStatus('같은 역할의 면 영역만 합칠 수 있습니다.', 'error', 3200);
      return;
    }
    if (['territory', 'administrative'].includes(genericFeatureRole(source)) && String(source.properties?.ownerId || '') !== String(target.properties?.ownerId || '')) {
      setActionStatus('소유 국가가 같은 영역끼리만 합칠 수 있습니다.', 'error', 3400);
      return;
    }
    const targets = new Set(state.genericFeatureMergeTargetIds.map(String));
    if (targets.has(String(id))) targets.delete(String(id)); else targets.add(String(id));
    state.genericFeatureMergeTargetIds = [...targets];
    renderingDomain?.renderGenericFeatures?.();
    updateModeButtons();
  }

  function completeGenericFeatureMerge() {
    const source = state.genericFeatures.find(item => String(item.id) === String(state.genericFeatureMergeSourceId));
    const targets = state.genericFeatureMergeTargetIds.map(id => state.genericFeatures.find(item => String(item.id) === String(id))).filter(Boolean);
    if (!source || !targets.length) {
      setActionStatus('합칠 영역을 하나 이상 선택하세요.', 'error', 3000);
      return;
    }
    const merged = normalizeClippedLandGeometry(window.polygonClipping.union(source.geometry.coordinates, ...targets.map(item => item.geometry.coordinates)));
    if (!merged) {
      setActionStatus('선택한 영역을 합칠 수 없습니다. 형상을 확인하세요.', 'error', 3400);
      return;
    }
    const removed = new Set(targets.map(item => String(item.id)));
    const sourceAfter = deepClone(source);
    sourceAfter.geometry = merged;
    beginLocalGeometryPreview({
      operation: 'merge-generic-feature',
      beforeFeatures: [source, ...targets],
      afterFeatures: [sourceAfter],
      removedIds: [...removed],
      applyResult: () => {
        projectDomain.recordHistory();
        source.geometry = deepClone(merged);
        reassignGenericFeatureParents([...removed], String(source.id));
        state.genericFeatures = state.genericFeatures.filter(item => !removed.has(String(item.id)));
        normalizeGenericFeatureSemantics(source, { inferOwner: false });
        editingDomain?.setTool('select', { announce: false });
        applyGenericSelectionIntent(String(source.id), true);
      },
      successMessage: `${targets.length + 1}개 영역을 하나로 합쳤습니다.`,
      errorMessage: '영역 합치기 결과를 적용하지 못했습니다.',
    });
  }

  function requestDraftDiscard(action) {
    const draftCount = editingDraftCoordinates().length;
    if (!editingDomain?.draftInputActive?.() || draftCount < 3) {
      action?.();
      return true;
    }
    openConfirmModal({
      title: '그리기 취소',
      message: `작성 중인 점 ${draftCount}개를 버리고 현재 그리기를 취소합니다.`,
      confirmText: '그리기 취소',
      cancelText: '계속 그리기',
      danger: true,
      onConfirm: () => action?.(),
    });
    return false;
  }

  function discardActiveDraftSilently() {
    if (!editingDomain?.draftInputActive?.()) return;
    if (isGenericFeatureDraftTool(state.tool)) cancelDraft(false);
    else cancelActiveMode(false);
  }

  function cancelDraft(showMessage = true) {
    const terrain = hydroToolConfig(state.tool);
    const splitSourceId = state.tool === 'split-generic-feature' ? state.genericFeatureSplitSourceId : null;
    const territorialSplitSourceId = state.tool === 'split-territorial-unit' ? state.territorialUnitSplitSourceId : null;
    const territorialRedrawSourceId = state.tool === 'redraw-territorial-unit' ? state.territorialUnitRedrawSourceId : null;
    const directTerritorialUnit = state.tool === 'draw-territorial-unit';
    const distributionDraft = state.distributionDraft;
    state.distributionDraft = null;
    editingDomain?.clearDraft?.(true);
    editingDomain?.setTool('select', { announce: false });
    if (splitSourceId && state.genericFeatures.some(item => String(item.id) === String(splitSourceId))) applyGenericSelectionIntent(String(splitSourceId), true);
    else if (territorialSplitSourceId && territorialUnitById(territorialSplitSourceId)) applyTerritorialUnitSelectionIntent(territorialSplitSourceId, true);
    else if (territorialRedrawSourceId && territorialUnitById(territorialRedrawSourceId)) applyTerritorialUnitSelectionIntent(territorialRedrawSourceId, true);
    renderingDomain?.invalidateGpuInteraction?.('draft-cancel');
    if (distributionDraft?.layerId && distributionLayerById(distributionDraft.layerId)) applyDistributionSelectionIntent(distributionDraft.layerId, true);
    if (showMessage) setActionStatus(distributionDraft ? '자유 분포 그리기를 취소했습니다.' : splitSourceId || territorialSplitSourceId || territorialRedrawSourceId || directTerritorialUnit ? '영역 작업을 취소했습니다.' : `${terrain?.label || '기타 객체'} 추가를 취소했습니다.`, 'success');
  }

  function addLabelAt(coord) {
    const name = prompt('지명 또는 도시명을 입력하세요.', '새 지명');
    if (name === null) return;
    projectDomain.recordHistory();
    const label = { id: uid('label'), name: name.trim() || '새 지명', kind: 'city', coordinates: coord.slice(), notes: '' };
    state.labels.push(label);
    state.labelSettings[labelKey('label', label.id)] = automaticLabelSettings(label.kind, { pinned: false });
    exitLabelMode(false);
    applyLabelSelectionIntent(label.id);
    renderingDomain?.invalidateLabels?.('label-created');
    projectDomain.queueAutosave();
    setActionStatus(`${label.name} 지명을 추가했습니다.`, 'success');
  }

  function labelDragBehavior() {
    return d3.behavior.drag()
      .on('dragstart', function() {
        if (state.tool !== 'select') return;
        projectDomain.recordHistory();
        d3.event.sourceEvent?.stopPropagation?.();
      })
      .on('drag', function(label) {
        if (state.tool !== 'select') return;
        const coord = screenToGeo(d3.mouse(svg.node()));
        if (!coord) return;
        label.coordinates = coord;
        const p = activeProjection()(coord);
        d3.select(this).attr('transform', `translate(${p[0]},${p[1]})`);
      })
      .on('dragend', function(label) {
        if (state.tool !== 'select') return;
        state.labelSettings[labelKey('label', label.id)] = normalizeLabelSettings({
          ...(state.labelSettings[labelKey('label', label.id)] || {}),
          manualPosition: label.coordinates,
          pinned: true,
        });
        mapObjectGeometryRevisions.label += 1;
        renderingDomain?.invalidateLabels?.('label-moved');
        projectDomain.queueAutosave();
        setActionStatus(`${label.name} 지명을 이동했습니다.`, 'success');
      });
  }

  function setEditorShellView(view, { focus = false } = {}) {
    const requested = view === 'relation' ? 'relation' : view === 'actions' ? 'actions' : 'info';
    const tab = requested === 'relation' ? $('relationTabBtn') : requested === 'actions' ? $('actionsTabBtn') : $('editorTabBtn');
    const active = requested !== 'info' && (tab?.hidden || tab?.getAttribute('aria-disabled') === 'true') ? 'info' : requested;
    $('rightPanel')?.setAttribute('data-editor-view', active);
    editorSurfaceTabs?.sync(active, { focus });
  }

  function replaceSelectOptions(select, options, selectedValue = '') {
    if (!select) return;
    select.replaceChildren(...options.map(option => {
      const element = document.createElement('option');
      element.value = String(option.value ?? '');
      element.textContent = String(option.label ?? option.value ?? '');
      if (option.searchText) element.dataset.searchText = String(option.searchText);
      return element;
    }));
    select.value = String(selectedValue || '');
  }

  function territorialUnitCountryOptions() {
    return [
      { value: '', label: '소속 국가 미지정' },
      ...(state.countriesData?.features || []).map(feature => {
        const properties = feature.properties || {};
        return {
          value: String(feature.id || ''),
          label: countryName(feature),
          searchText: [properties.name, feature.id].filter(Boolean).join(' '),
        };
      }).sort((a, b) => layerNameCollator.compare(a.label, b.label)),
    ];
  }

  function territorialUnitParentOptions(feature) {
    const countryId = String(feature?.properties?.sovereignId || '');
    const excluded = new Set([String(feature?.id || '')]);
    const queue = [...excluded];
    while (queue.length) {
      const current = queue.shift();
      for (const child of territorialChildren(state.territorialUnits, current)) {
        if (excluded.has(String(child.id))) continue;
        excluded.add(String(child.id));
        queue.push(String(child.id));
      }
    }
    return [
      { value: countryId, label: '국가 직속' },
      ...state.territorialUnits.filter(candidate => !excluded.has(String(candidate.id))
        && String(candidate.properties?.sovereignId || '') === countryId)
        .map(candidate => ({
          value: String(candidate.id),
          label: `${territorialUnitName(candidate)}${candidate.properties?.unitType === TERRITORIAL_UNIT_TYPES.ADMIN ? ` · ${candidate.properties.adminLevel}급` : ' · 권역'}`,
        }))
        .sort((a, b) => layerNameCollator.compare(a.label, b.label)),
    ];
  }

  function territorialParentOptions(feature) {
    const excluded = new Set([String(feature?.id || '')]);
    const queue = [...excluded];
    while (queue.length) {
      const current = queue.shift();
      for (const child of territorialChildren(state.territorialUnits, current)) {
        if (excluded.has(String(child.id))) continue;
        excluded.add(String(child.id));
        queue.push(String(child.id));
      }
    }
    return [
      { value: '', label: '상위 영역 없음' },
      ...territorialRepository.list()
        .filter(candidate => !excluded.has(String(candidate.id)))
        .map(candidate => ({
          value: String(candidate.id),
          label: `${candidate.properties?.name || territorialUnitName(candidate)} · ${territorialTypeLabel(candidate.properties?.unitType)}`,
        }))
        .sort((left, right) => layerNameCollator.compare(left.label, right.label)),
    ];
  }

  function distributionLayerById(id) {
    return distributionService.getLayer(id);
  }

  function distributionEntryLabel(entry) {
    if (entry.mode === DISTRIBUTION_MODES.TERRITORIAL) return territorialRepository.get(entry.territorialUnitId)?.properties?.name || entry.territorialUnitId;
    return '자유 영역';
  }

  function commitDistributionMeta(field, value) {
    if (state.selected?.domain !== 'distribution') return false;
    const layer = distributionLayerById(state.selected.id);
    if (!layer) return false;
    if (layer.locked && field !== 'locked') {
      setActionStatus('잠금을 해제한 뒤 분포 항목을 변경할 수 있습니다.', 'error', 3200);
      applyDistributionSelectionIntent(layer.id, true);
      return false;
    }
    const result = distributionService.updateLayer(layer.id, field, value);
    if (!result.ok) {
      if (result.code === 'invalid') setActionStatus('자기 자신이나 하위 분류를 상위 분류로 설정할 수 없습니다.', 'error', 3600);
      applyDistributionSelectionIntent(layer.id, true);
      return false;
    }
    if (field === 'locked') layerTreeController?.syncLocks([{ domain: 'distribution', type: layer.type, id: layer.id }]);
    else markLayerTreeDirty();
    applyDistributionSelectionIntent(layer.id, true);
    setActionStatus(`${DISTRIBUTION_TYPE_LABELS[layer.type]} 정보를 변경했습니다.`, 'success');
    return true;
  }

  function createDistributionLayerFromPrompt(type) {
    const label = DISTRIBUTION_TYPE_LABELS[type];
    const name = prompt(`새 ${label} 항목의 이름을 입력하세요.`, `새 ${label}`);
    if (name === null) return false;
    const layer = distributionService.createLayer({
      id: uid(`distribution_${type}`),
      type,
      name: name.trim() || `새 ${label}`,
      color: COLOR_PRESETS[state.distributionLayers.length % COLOR_PRESETS.length] || DEFAULT_GENERIC_FEATURE_COLOR,
    });

    markLayerTreeDirty();
    layerTreeController?.render(true);
    applyDistributionSelectionIntent(layer.id);
    setActionStatus(`${layer.name} ${label} 항목을 추가했습니다. 분포를 이어서 입력하세요.`, 'success', 3600);
    return true;
  }

  function addTerritorialDistributionEntry() {
    const layer = state.selected?.domain === 'distribution' ? distributionLayerById(state.selected.id) : null;
    const territorialUnitId = $('distributionTerritorialUnitInput').value;
    if (!layer || layer.locked || !territorialRepository.get(territorialUnitId)) return false;
    let entry;
    try {
      entry = createDistributionEntry({
        id: uid(),
        layerId: layer.id,
        mode: DISTRIBUTION_MODES.TERRITORIAL,
        territorialUnitId,
        share: Number($('distributionShareInput').value),
      });
    } catch (error) {
      const validationMessage = compactNotificationMessage(error?.message || '분포 정보를 검증하지 못했습니다.', { tone: 'error', maxLength: 52 });
      setActionStatus(validationMessage, 'error', 0);
      return false;
    }
    const result = distributionService.addEntry(entry);
    if (!result.ok) return false;
    applyDistributionSelectionIntent(layer.id, true);
    setActionStatus(`${distributionEntryLabel(result.entry)}에 ${layer.name} 분포를 추가했습니다.`, 'success');
    return true;
  }

  function startGeometryDistributionDraft() {
    const layer = state.selected?.domain === 'distribution' ? distributionLayerById(state.selected.id) : null;
    if (!layer || layer.locked) return false;
    const share = Number($('distributionShareInput').value);
    if (!Number.isFinite(share) || share < 0 || share > 100) {
      setActionStatus('분포 비율은 0~100 범위의 숫자여야 합니다.', 'error', 0);
      return false;
    }
    state.distributionDraft = { layerId: layer.id, share };
    editingDomain?.setTool('polygon', { announce: false });
    setModeBanner('분포 영역을 그리세요.');
    return true;
  }

  function removeDistributionEntry(id) {
    const entry = state.distributionEntries.find(candidate => candidate.id === String(id));
    const layer = entry ? distributionLayerById(entry.layerId) : null;
    if (!entry || !layer || layer.locked) return false;
    const result = distributionService.removeEntry(entry.id);
    if (!result.ok) return false;
    applyDistributionSelectionIntent(layer.id, true);
    setActionStatus('분포 엔트리를 삭제했습니다.', 'success');
    return true;
  }

  function deleteDistributionLayer(id, { confirm = true } = {}) {
    const layer = distributionLayerById(id);
    if (!layer) return false;
    if (layer.locked) {
      setActionStatus('잠금을 해제한 뒤 분포 항목을 삭제할 수 있습니다.', 'error', 3200);
      return false;
    }
    const performDelete = () => {
      const result = distributionService.deleteLayer(layer.id);
      if (!result.ok) return false;
      if (state.selectedDistributionLayerId === layer.id) state.selectedDistributionLayerId = '';
      markLayerTreeDirty();
      selectionUiController.clear({ reason: 'distribution-delete-selection-clear' });
      setActionStatus(`${layer.name} ${DISTRIBUTION_TYPE_LABELS[layer.type]} 항목을 삭제했습니다.`, 'success');
      return true;
    };
    if (!confirm) {
      performDelete();
      return true;
    }
    openConfirmModal({
      title: `${DISTRIBUTION_TYPE_LABELS[layer.type]} 삭제`,
      message: `${layer.name}과 연결된 분포 ${distributionEntriesForLayer(state.distributionEntries, layer.id).length}개를 함께 삭제합니다.`,
      impacts: [`${DISTRIBUTION_TYPE_LABELS[layer.type]} 항목 1개 삭제`, `연결된 분포 ${distributionEntriesForLayer(state.distributionEntries, layer.id).length}개 삭제`],
      confirmText: '분포 항목 삭제',
      danger: true,
      onConfirm: performDelete,
    });
    return true;
  }

  function setDistributionLayerVisible(id, visible) {
    const layer = distributionLayerById(id);
    if (!layer) return false;
    const group = DISTRIBUTION_TYPE_GROUPS[layer.type];
    if (!state.itemVisibility[group]) state.itemVisibility[group] = {};
    if (visible === false) state.itemVisibility[group][layer.id] = false;
    else delete state.itemVisibility[group][layer.id];
    distributionVisibilityRevision += 1;
    markLayerTreeDirty();
    renderingDomain?.invalidateOverlayStyle?.('distribution-layer-visibility');
    projectDomain.queuePresentationAutosave();
    return true;
  }

  function applyTerritorialSelectionIntent(type, id, refreshOnly = false) {
    const unitType = String(type || territorialUnitById(id)?.properties?.unitType || '');
    if (unitType === TERRITORIAL_UNIT_TYPES.COUNTRY) {
      return selectionUiController.applyIntent(countryObjectRef(id), { refreshOnly, openEditor: !refreshOnly });
    }
    const unit = territorialUnitById(id);
    if (!unit || unit.properties?.unitType !== unitType) return false;
    return selectionUiController.applyIntent(normalizeObjectRef({ domain: 'territorial', type: unitType, id }), { refreshOnly, openEditor: !refreshOnly });
  }

  function setTerritorialUnitName(type, id, name) {
    if (!applyTerritorialSelectionIntent(type, id, true)) return false;
    if (type === TERRITORIAL_UNIT_TYPES.COUNTRY) commitCountryEdit('name', name);
    else commitTerritorialUnitMeta('name', name);
    return true;
  }

  function setTerritorialUnitColor(type, id, color) {
    if (!applyTerritorialSelectionIntent(type, id, true)) return false;
    if (type === TERRITORIAL_UNIT_TYPES.COUNTRY) commitCountryEdit('color', color);
    else commitTerritorialUnitMeta('color', color);
    return true;
  }

  function setTerritorialUnitLocked(type, id, locked) {
    const key = String(id || '');
    const result = territorialApplicationService.setLocked(type, key, locked, {
      history: type === TERRITORIAL_UNIT_TYPES.COUNTRY
        ? { description: `${countryName(countryFeatureById(key))} ${locked ? '잠금' : '잠금 해제'}` }
        : {},
    });
    if (!result.ok) return false;
    if (!result.changed) return true;
    layerTreeController?.syncLocks([{ domain: 'territorial', type, id: key }]);
    if (type === TERRITORIAL_UNIT_TYPES.COUNTRY) {
      if ((state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) && String(state.selected.id) === key) countryPropertyController.refresh(countryObjectRef(key));
      syncBatchActionAvailability();
    } else objectPropertyController.presentTerritorial(key, true);
    return true;
  }

  window.PANDOLAB_TERRITORIAL = Object.freeze({
    get: id => territorialApplicationService.get(id),
    list: options => territorialApplicationService.list(options),
    select: applyTerritorialSelectionIntent,
    setName: setTerritorialUnitName,
    setColor: setTerritorialUnitColor,
    setLocked: setTerritorialUnitLocked,
    isLocked: (type, id) => territorialApplicationService.isLocked(type, id),
  });

  window.PANDOLAB_DISTRIBUTIONS = Object.freeze({
    getLayer: id => distributionLayerById(id),
    listLayers: type => distributionService.listLayers(type),
    listEntries: layerId => distributionService.listEntries(layerId),
    select: applyDistributionSelectionIntent,
    setVisible: setDistributionLayerVisible,
  });

  function hydroEditorName(value, fallback) {
    const name = String(value || '').trim();
    if (/^미명명 수계(?:\s+\d+)?$/.test(name)) return fallback;
    return name || fallback;
  }

  async function copySelectedHydroForEditing() {
    if (state.selected?.domain !== 'hydro') return;
    let source = builtInHydroFeatureById(state.selected.id);
    if (!source) {
      setActionStatus('복사할 강·호수 객체를 찾을 수 없습니다. 다시 선택하세요.', 'error', 3200);
      return;
    }
    if (!source.geometry || (source.properties?.category === 'river' && Number(source.properties?.fragment_count || 1) > 1)) {
      setActionStatus('강·호수 전체 형상을 준비하는 중입니다.', 'working', 0);
      try {
        source = await gpuMapRenderer.loadHydroLogicalFeature(Number(source.properties.__logicalFid));
      } catch (error) {
        reportOperationError(error, '강·호수 전체 형상을 불러오지 못했습니다. 잠시 후 다시 시도하세요.', 'PL-WATER-002', 0);
        return;
      }
      if (!source) {
        setActionStatus('강·호수 전체 형상을 찾을 수 없습니다. 다시 선택하세요.', 'error', 3200);
        return;
      }
    }
    projectDomain.recordHistory();
    const category = source.properties?.category === 'lake' ? 'lake' : 'river';
    const copy = {
      type: 'Feature',
      id: uid(category),
      geometry: deepClone(source.geometry),
      properties: {
        name: source.properties?.name || '',
        category,
        editorColor: HYDRO_TOOL_CONFIG[category].color,
        notes: `판도연구소 내장 ${hydroCategoryLabel(category)} 편집용 복사본 · 원본 ${source.properties?.pandolab_id || source.id}`,
        source: source.properties?.source || `판도연구소 내장 ${hydroCategoryLabel(category)}`,
        sourceFeatureId: source.properties?.pandolab_id || source.id,
      },
    };
    normalizeHydroEdit(copy);
    state.hydroEdits.push(copy);
    state.physicalSettings.hiddenHydroIds[String(source.properties?.pandolab_id || source.id)] = true;
    gpuMapRenderer.invalidateHydroVisibility();
    markLayerTreeDirty();
    applyHydroSelectionIntent(String(copy.id));
    renderingDomain?.invalidateHydroPatch?.('hydro-edit-copy');
    projectDomain.queueAutosave();
    setActionStatus(`${source.properties?.name || (category === 'lake' ? '호수' : '강')} 편집 복사본을 만들었습니다.`, 'success', 3600);
  }

  function applyCountrySelectionIntent(id, refreshOnly = false) {
    return selectionUiController.applyIntent(
      countryObjectRef(id),
      { refreshOnly, openEditor: !refreshOnly, reason: 'country-selection' },
    );
  }

  function applyTerritorialUnitSelectionIntent(id, refreshOnly = false) {
    const feature = territorialUnitById(id);
    return feature ? selectionUiController.applyIntent(normalizeObjectRef({
      domain: 'territorial',
      type: feature.properties?.unitType || TERRITORIAL_UNIT_TYPES.TERRITORY,
      id: String(id),
    }), { refreshOnly, openEditor: !refreshOnly, reason: 'territorial-selection' }) : false;
  }

  function applyDistributionSelectionIntent(id, refreshOnly = false) {
    const layer = distributionLayerById(id);
    return layer ? selectionUiController.applyIntent(normalizeObjectRef({ domain: 'distribution', type: layer.type, id: layer.id }), {
      refreshOnly, openEditor: !refreshOnly, reason: 'distribution-selection',
    }) : false;
  }

  function applyGenericSelectionIntent(id, refreshOnly = false) {
    return selectionUiController.applyIntent(
      normalizeObjectRef({ domain: 'generic', type: 'feature', id: String(id) }),
      { refreshOnly, openEditor: !refreshOnly, reason: 'generic-selection' },
    );
  }

  function applyLabelSelectionIntent(id, refreshOnly = false) {
    const label = state.labels.find(item => String(item.id) === String(id));
    return label ? selectionUiController.applyIntent(normalizeObjectRef({ domain: 'label', type: label.kind || 'label', id: String(id) }), {
      refreshOnly, openEditor: !refreshOnly, reason: 'label-selection',
    }) : false;
  }

  function applyHydroSelectionIntent(id, refreshOnly = false) {
    const feature = hydroFeatureById(id);
    const selectedId = String(hydroEditById(id) ? feature?.id : feature?.properties?.pandolab_id || feature?.id || id);
    return feature ? selectionUiController.applyIntent(normalizeObjectRef({
      domain: 'hydro', type: hydroCategoryKey(feature.properties?.category), id: selectedId,
    }), { refreshOnly, openEditor: !refreshOnly, reason: 'hydro-selection' }) : false;
  }

  function territorialPartitionContext(unitType) {
    const selectedUnit = (state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) ? territorialUnitById(state.selected.id) : null;
    const selectedCountry = (state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) ? countryFeatureById(state.selected.id) : null;
    if (unitType === TERRITORIAL_UNIT_TYPES.TERRITORY) {
      const sovereignId = String(selectedUnit?.properties?.sovereignId || selectedCountry?.id || '');
      const country = countryFeatureById(sovereignId);
      if (!country) return null;
      const existing = selectedUnit?.properties?.unitType === TERRITORIAL_UNIT_TYPES.TERRITORY
        ? selectedUnit
        : state.territorialUnits.find(feature => feature.properties?.unitType === unitType
          && String(feature.properties?.sovereignId || '') === sovereignId
          && feature.properties?.isRemainder === true)
          || state.territorialUnits.find(feature => feature.properties?.unitType === unitType && String(feature.properties?.sovereignId || '') === sovereignId);
      return { unitType, sovereignId, parentId: '', adminLevel: null, container: country, source: existing || null };
    }
    const sovereignId = String(selectedUnit?.properties?.sovereignId || selectedCountry?.id || '');
    const country = countryFeatureById(sovereignId);
    if (!country) return null;
    const parent = selectedUnit || null;
    const parentId = String(parent?.id || '');
    const adminLevel = parent?.properties?.unitType === TERRITORIAL_UNIT_TYPES.ADMIN
      ? Math.max(1, Number(parent.properties.adminLevel) || 1) + 1
      : parent?.properties?.unitType === TERRITORIAL_UNIT_TYPES.TERRITORY ? 2 : 1;
    const existing = state.territorialUnits.find(feature => feature.properties?.unitType === unitType
      && String(feature.properties?.sovereignId || '') === sovereignId
      && String(feature.properties?.parentId || '') === parentId
      && Number(feature.properties?.adminLevel || 1) === adminLevel
      && feature.properties?.isRemainder === true)
      || state.territorialUnits.find(feature => feature.properties?.unitType === unitType
        && String(feature.properties?.sovereignId || '') === sovereignId
        && String(feature.properties?.parentId || '') === parentId
        && Number(feature.properties?.adminLevel || 1) === adminLevel);
    return { unitType, sovereignId, parentId, adminLevel, container: parent || country, source: existing || null };
  }

  function explicitRegionCreateContext() {
    const selectedUnit = (state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) ? territorialUnitById(state.selected.id) : null;
    const selectedCountry = (state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) ? countryFeatureById(state.selected.id) : null;
    return {
      unitType: TERRITORIAL_UNIT_TYPES.REGION,
      sovereignId: String(selectedUnit?.properties?.sovereignId || selectedCountry?.id || ''),
      parentId: String(selectedUnit?.id || ''),
      adminLevel: null,
      container: selectedUnit || selectedCountry || null,
      source: null,
    };
  }

  function territorialCreateContext(unitType) {
    return unitType === TERRITORIAL_UNIT_TYPES.REGION
      ? explicitRegionCreateContext()
      : territorialPartitionContext(unitType);
  }

  function enterTerritorialUnitSplitMode(idOrFeature, { virtual = false } = {}) {
    const feature = typeof idOrFeature === 'object' ? idOrFeature : territorialUnitById(idOrFeature);
    if (!feature?.geometry) return false;
    editingDomain?.setTool('split-territorial-unit', { announce: false });
    state.territorialUnitSplitSourceId = virtual ? null : String(feature.id);
    state.territorialUnitSplitVirtualSource = virtual ? deepClone(feature) : null;
    setModeBanner(defaultDraftInstruction());
    updateModeButtons();
    return true;
  }

  function startTerritorialUnitCreate(unitType) {
    if (unitType === TERRITORIAL_UNIT_TYPES.REGION) return false;
    const context = territorialPartitionContext(unitType);
    if (!context) {
      setActionStatus(unitType === TERRITORIAL_UNIT_TYPES.ADMIN
        ? '행정구역의 부모로 사용할 국가·권역·행정구역을 먼저 선택하세요.'
        : '권역을 만들 국가를 먼저 선택하세요.', 'error', 3900);
      return false;
    }
    const source = context.source || createPartitionTerritorialFeature({
      id: uid(unitType === TERRITORIAL_UNIT_TYPES.ADMIN ? 'administrative' : 'territory'),
      unitType,
      sovereignId: context.sovereignId,
      parentId: context.parentId,
      adminLevel: context.adminLevel,
      isRemainder: true,
      geometry: deepClone(context.container.geometry),
    });
    return enterTerritorialUnitSplitMode(source, { virtual: !context.source });
  }

  let pendingTerritorialCreateType = null;

  function closeTerritorialCreateModal() {
    $('territorialCreateModal').classList.add('hidden');
    pendingTerritorialCreateType = null;
  }

  function openTerritorialCreateModal(unitType) {
    const context = territorialCreateContext(unitType);
    if (!context) {
      setActionStatus(unitType === TERRITORIAL_UNIT_TYPES.ADMIN
        ? '행정구역의 부모로 사용할 국가·권역·행정구역을 먼저 선택하세요.'
        : '권역을 만들 국가를 먼저 선택하세요.', 'error', 3900);
      return false;
    }
    const administrative = unitType === TERRITORIAL_UNIT_TYPES.ADMIN;
    const region = unitType === TERRITORIAL_UNIT_TYPES.REGION;
    pendingTerritorialCreateType = unitType;
    $('territorialCreateTitle').textContent = `${territorialTypeLabel(unitType)} 추가`;
    $('territorialCreateContext').textContent = region
      ? context.parentId
        ? `상위 영역 기본값: ${territorialUnitName(context.container)}`
        : context.sovereignId
          ? `주권 국가 기본값: ${countryName(context.container)}`
          : '주권 국가와 상위 영역은 생성 후 설정할 수 있습니다.'
      : administrative
        ? `부모: ${territorialUnitName(context.container) || countryName(context.container)} · 자동 ${context.adminLevel}급`
        : `소속 국가: ${countryName(context.container)}`;
    replaceSelectOptions($('territorialCreateMethod'), region
      ? [{ value: 'draw', label: '영역 직접 지정' }, { value: 'geojson', label: 'GeoJSON에서 가져오기' }]
      : [{ value: 'split', label: '기존 영역 나누기' }, { value: 'draw', label: '영역 직접 지정' }, { value: 'geojson', label: 'GeoJSON에서 가져오기' }], region ? 'draw' : 'split');
    $('territorialCreateModal').classList.remove('hidden');
    $('territorialCreateMethod').focus();
    return true;
  }

  function enterTerritorialUnitDirectCreate(unitType) {
    const context = territorialCreateContext(unitType);
    if (!context) return false;
    editingDomain?.setTool('draw-territorial-unit', { announce: false });
    state.territorialCreateContext = {
      unitType,
      sovereignId: context.sovereignId,
      parentId: context.parentId,
      adminLevel: context.adminLevel,
    };
    setModeBanner(defaultDraftInstruction());
    updateModeButtons();
    return true;
  }

  function finishTerritorialUnitSplitDraft() {
    const source = territorialUnitById(state.territorialUnitSplitSourceId) || state.territorialUnitSplitVirtualSource;
    if (!source?.geometry) {
      setActionStatus('나눌 권역을 찾을 수 없습니다. 권역을 다시 선택하세요.', 'error', 3400);
      return;
    }
    try {
      const split = buildCutSplitCandidates(source.geometry, editingDraftCoordinates());
      const untouched = geometryPolygonSets(source.geometry)
        .filter((_, index) => index !== split.componentIndex)
        .map(polygon => deepClone(polygon));
      const smallerIndex = split.candidates[0].area <= split.candidates[1].area ? 0 : 1;
      const otherIndex = smallerIndex === 0 ? 1 : 0;
      const wasRemainder = source.properties?.isRemainder === true;
      const typeLabel = territorialTypeLabel(source.properties?.unitType);
      const baseName = territorialUnitName(source).replace(/^미지정\s*/, '') || typeLabel;
      const newName = prompt(`새 ${typeLabel} 이름을 입력하세요.`, `새 ${typeLabel}`);
      if (newName === null) return;
      let retainedName = source.properties?.name || '';
      if (!wasRemainder) {
        const entered = prompt(`기존 쪽 ${typeLabel} 이름을 입력하세요.`, `${baseName} 1`);
        if (entered === null) return;
        retainedName = entered.trim() || `${baseName} 1`;
      }
      const retainedCoordinates = wasRemainder
        ? [...geometryMultiCoordinates(split.candidates[otherIndex].geometry), ...untouched]
        : [...geometryMultiCoordinates(split.candidates[0].geometry), ...untouched];
      const retainedGeometry = normalizeClippedLandGeometry(retainedCoordinates);
      const siblingGeometry = deepClone(split.candidates[wasRemainder ? smallerIndex : 1].geometry);
      if (!retainedGeometry || !siblingGeometry) throw new Error('나누지 않은 섬과 월경지를 보존할 수 없습니다.');
      const retainedAfter = deepClone(source);
      retainedAfter.geometry = retainedGeometry;
      retainedAfter.properties.name = retainedName;
      retainedAfter.properties.isRemainder = wasRemainder;
      const sibling = createPartitionTerritorialFeature({
        id: uid(source.properties.unitType === TERRITORIAL_UNIT_TYPES.ADMIN ? 'administrative' : 'territory'),
        unitType: source.properties.unitType,
        sovereignId: source.properties.sovereignId,
        parentId: source.properties.parentId,
        adminLevel: source.properties.adminLevel,
        isRemainder: false,
        name: newName.trim() || `새 ${typeLabel}`,
        color: territorialStyleColor(source),
        notes: '',
        sourceFolderId: source.properties.sourceFolderId || '',
        geometry: siblingGeometry,
      });
      beginLocalGeometryPreview({
        operation: 'split-territorial-unit',
        beforeFeatures: [source],
        afterFeatures: [retainedAfter, sibling],
        applyResult: () => {
          projectDomain.recordHistory();
          const retained = state.territorialUnitSplitSourceId ? territorialUnitById(state.territorialUnitSplitSourceId) : null;
          if (retained) {
            retained.geometry = deepClone(retainedAfter.geometry);
            retained.properties = deepClone(retainedAfter.properties);
          } else state.territorialUnits.push(deepClone(retainedAfter));
          state.territorialUnits.push(deepClone(sibling));
          state.territorialUnits = normalizeTerritorialUnits(state.territorialUnits, { countryExists: id => !!countryFeatureById(id) });
          editingDomain?.clearDraft?.(true);
          editingDomain?.setTool('select', { announce: false });
          markLayerTreeDirty();
          applyTerritorialUnitSelectionIntent(sibling.id, true);
        },
        successMessage: `${typeLabel}을(를) 나누고 나머지 면적을 ${wasRemainder ? '미지정 영역으로 ' : ''}보존했습니다.`,
        errorMessage: '영역 나누기 결과를 적용하지 못했습니다.',
      });
    } catch (error) {
      reportOperationError(error, '영역을 나누지 못했습니다. 한 영역을 정확히 한 번 관통하도록 경계를 다시 그리세요.', 'PL-REGION-SPLIT-001', 4400);
    }
  }

  function territorialUnitsAreAdjacent(left, right) {
    return territorialGeometry.areAdjacent(left, right);
  }

  function enterTerritorialUnitMergeMode(id) {
    const source = territorialUnitById(id);
    if (!source) return false;
    editingDomain?.setTool('merge-territorial-unit', { announce: false });
    state.territorialUnitMergeSourceId = String(source.id);
    state.territorialUnitMergeTargetIds = [];
    setModeBanner('합칠 인접 영역을 선택하세요.');
    updateModeButtons();
    renderingDomain?.renderTerritorialUnits?.();
    return true;
  }

  function toggleTerritorialUnitMergeTarget(id) {
    if (state.tool !== 'merge-territorial-unit') return;
    const source = territorialUnitById(state.territorialUnitMergeSourceId);
    const target = territorialUnitById(id);
    if (!source || !target || String(source.id) === String(target.id)) return;
    if (!territorialSiblings(state.territorialUnits, source).some(candidate => String(candidate.id) === String(target.id))) {
      setActionStatus('같은 국가·부모·단계의 영역만 합칠 수 있습니다.', 'error', 3400);
      return;
    }
    if (!territorialUnitsAreAdjacent(source, target)) {
      setActionStatus('경계를 공유하는 인접 영역만 합칠 수 있습니다.', 'error', 3400);
      return;
    }
    const targets = new Set(state.territorialUnitMergeTargetIds.map(String));
    if (targets.has(String(id))) targets.delete(String(id)); else targets.add(String(id));
    state.territorialUnitMergeTargetIds = [...targets];
    renderingDomain?.renderTerritorialUnits?.();
    updateModeButtons();
  }

  function completeTerritorialUnitMerge() {
    const source = territorialUnitById(state.territorialUnitMergeSourceId);
    const targets = state.territorialUnitMergeTargetIds.map(territorialUnitById).filter(Boolean);
    if (!source || !targets.length) return;
    try {
      const mergeResult = territorialGeometry.mergeUnits(source, targets);
      const removed = new Set(mergeResult.removedIds);
      const sourceAfter = deepClone(source);
      sourceAfter.geometry = deepClone(mergeResult.survivor.geometry);
      beginLocalGeometryPreview({
        operation: 'merge-territorial-unit',
        beforeFeatures: [source, ...targets],
        afterFeatures: [sourceAfter],
        removedIds: [...removed],
        applyResult: () => {
          projectDomain.recordHistory();
          source.geometry = deepClone(sourceAfter.geometry);
          for (const child of state.territorialUnits) {
            if (removed.has(String(child.properties?.parentId || ''))) child.properties.parentId = String(source.id);
          }
          state.territorialUnits = state.territorialUnits.filter(item => !removed.has(String(item.id)));
          state.territorialUnits = normalizeTerritorialUnits(state.territorialUnits, { countryExists: id => !!countryFeatureById(id) });
          editingDomain?.setTool('select', { announce: false });
          markLayerTreeDirty();
          applyTerritorialUnitSelectionIntent(source.id, true);
        },
        successMessage: `${targets.length + 1}개 ${territorialTypeLabel(source.properties.unitType)}을 하나로 합쳤습니다.`,
        errorMessage: '영역 합치기 결과를 적용하지 못했습니다.',
      });
    } catch (error) {
      reportOperationError(error, '영역을 합치지 못했습니다.', 'PL-REGION-MERGE-001', 4200);
    }
  }

  function enterTerritorialUnitRedrawMode(id) {
    const source = territorialUnitById(id);
    if (!source) return false;
    editingDomain?.setTool('redraw-territorial-unit', { announce: false });
    state.territorialUnitRedrawSourceId = String(source.id);
    setModeBanner(defaultDraftInstruction());
    updateModeButtons();
    return true;
  }

  async function finishTerritorialUnitRedrawDraft() {
    const source = territorialUnitById(state.territorialUnitRedrawSourceId);
    const container = territorialUnitContainer(source);
    const clipper = window.polygonClipping;
    if (!source || !container || !clipper?.intersection || !clipper?.difference) return;
    try {
      const drawn = { type: 'Polygon', coordinates: [orientRing(editingDraftCoordinates(), true)] };
      let nextGeometry = normalizeClippedLandGeometry(clipper.intersection(drawn.coordinates, container.geometry.coordinates));
      if (!nextGeometry) throw new Error('그린 영역이 부모 영역 안에 없습니다.');
      const siblings = territorialSiblings(state.territorialUnits, source);
      for (const sibling of siblings) {
        if (sibling.properties?.isRemainder === true) continue;
        const overlap = clipper.intersection(nextGeometry.coordinates, sibling.geometry.coordinates);
        if (multiPolygonPlanarArea(overlap) > Math.max(1e-9, multiPolygonPlanarArea(nextGeometry.coordinates) * 1e-9)) {
          throw new Error(`${territorialUnitName(sibling)}과(와) 겹칩니다. 이름 있는 형제 영역은 침범할 수 없습니다.`);
        }
      }
      let released = normalizeClippedLandGeometry(clipper.difference(source.geometry.coordinates, nextGeometry.coordinates));
      const sourceAfter = deepClone(source);
      sourceAfter.geometry = deepClone(nextGeometry);
      const coastGeometryOverrides = new Map();
      let coastDirection = 'none';
      if (source.properties?.unitType === TERRITORIAL_UNIT_TYPES.ADMIN) {
        const rawSourceAfter = deepClone(sourceAfter);
        rawSourceAfter.geometry = deepClone(drawn);
        const country = countryFeatureById(source.properties?.sovereignId);
        const resolution = await (await getGisImportCommitter()).resolveTerritorialCoast(rawSourceAfter, country, coastGeometryOverrides);
        if (resolution.direction === 'cancel') {
          setActionStatus('해안선 정합을 취소했습니다.', 'ready');
          return;
        }
        coastDirection = resolution.direction;
        if (coastDirection === 'country-to-admin') {
          nextGeometry = normalizeClippedLandGeometry(clipper.intersection(rawSourceAfter.geometry.coordinates, container.geometry.coordinates));
          if (!nextGeometry) throw new Error('국가 해안선을 기준으로 조정한 영역이 부모 영역 안에 없습니다.');
          sourceAfter.geometry = deepClone(nextGeometry);
        } else if (coastDirection === 'admin-to-country' || coastDirection === 'independent') {
          nextGeometry = deepClone(rawSourceAfter.geometry);
          sourceAfter.geometry = deepClone(nextGeometry);
        }
        released = normalizeClippedLandGeometry(clipper.difference(source.geometry.coordinates, nextGeometry.coordinates));
      }
      for (const sibling of siblings) {
        if (sibling.properties?.isRemainder === true) continue;
        const overlap = clipper.intersection(nextGeometry.coordinates, sibling.geometry.coordinates);
        if (multiPolygonPlanarArea(overlap) > Math.max(1e-9, multiPolygonPlanarArea(nextGeometry.coordinates) * 1e-9)) {
          throw new Error(`${territorialUnitName(sibling)}과(와) 겹칩니다. 이름 있는 형제 영역은 침범할 수 없습니다.`);
        }
      }
      beginLocalGeometryPreview({
        operation: 'redraw-territorial-unit',
        beforeFeatures: [source],
        afterFeatures: [sourceAfter],
        applyResult: async () => {
          projectDomain.recordHistory();
          for (const [countryId, geometry] of coastGeometryOverrides) {
            const country = countryFeatureById(countryId);
            if (!country) continue;
            country.geometry = deepClone(geometry);
            state.historyDirtyCountryIds.add(countryId);
          }
          source.geometry = deepClone(nextGeometry);
          for (const sibling of siblings.filter(item => item.properties?.isRemainder === true)) {
            const remainder = normalizeClippedLandGeometry(clipper.difference(sibling.geometry.coordinates, nextGeometry.coordinates));
            if (remainder) sibling.geometry = remainder;
            else state.territorialUnits = state.territorialUnits.filter(item => String(item.id) !== String(sibling.id));
          }
          if (released && source.properties?.isRemainder !== true) addUnassignedTerritorialUnitGeometry({
            unitType: source.properties.unitType,
            sovereignId: source.properties.sovereignId,
            parentId: source.properties.parentId,
            adminLevel: source.properties.adminLevel,
          }, released);
          reconcileTerritorialUnitCompleteness([source.properties.sovereignId], {
            preserveIds: coastDirection === 'admin-to-country' || coastDirection === 'independent' ? [String(source.id)] : [],
          });
          editingDomain?.clearDraft?.(true);
          editingDomain?.setTool('select', { announce: false });
          markLayerTreeDirty();
          applyTerritorialUnitSelectionIntent(source.id, true);
        },
        successMessage: '영역을 다시 지정하고 남는 면적을 미지정 영역으로 보존했습니다.',
        errorMessage: '영역 다시 지정 결과를 적용하지 못했습니다.',
      });
    } catch (error) {
      reportOperationError(error, '영역을 다시 지정하지 못했습니다.', 'PL-REGION-REDRAW-001', 4300);
    }
  }

  function finishTerritorialUnitDirectDraft() {
    const context = state.territorialCreateContext;
    if (!context) return;
    const typeLabel = territorialTypeLabel(context.unitType);
    const name = prompt(`새 ${typeLabel} 이름을 입력하세요.`, `새 ${typeLabel}`);
    if (name === null) return;
    const geometry = normalizeCountryGeometry({ type: 'Polygon', coordinates: [orientRing(editingDraftCoordinates(), true)] });
    try {
      if (!geometry) throw new Error('그린 영역을 닫힌 Polygon으로 만들 수 없습니다.');
      const rawFeature = {
        type: 'Feature',
        id: uid(`${context.unitType}-preview`),
        properties: {
          name: name.trim() || `새 ${typeLabel}`,
          sovereignId: context.sovereignId,
          parentId: context.parentId,
          adminLevel: context.adminLevel,
        },
        geometry,
      };
      const issues = validateStructuredGeometry(rawFeature);
      if (issues.length) throw new Error(issues[0].message);
      const explicitRegion = context.unitType === TERRITORIAL_UNIT_TYPES.REGION
        ? createTerritorialFeature({
          id: uid('region'),
          unitType: TERRITORIAL_UNIT_TYPES.REGION,
          name: rawFeature.properties.name,
          parentId: context.parentId,
          sovereignId: context.sovereignId,
          coverageMode: TERRITORIAL_COVERAGE_MODES.EXPLICIT,
          isRemainder: false,
          geometry: deepClone(geometry),
        })
        : null;
      beginLocalGeometryPreview({
        operation: 'draw-territorial-unit',
        beforeFeatures: [],
        afterFeatures: [explicitRegion || rawFeature],
        applyResult: async () => {
          let createdId = explicitRegion?.id || '';
          if (explicitRegion) {
            projectDomain.recordHistory({ type: 'territorial-create', affectedIds: [String(explicitRegion.id)] });
            state.territorialUnits.push(explicitRegion);
            state.territorialUnits = normalizeTerritorialUnits(state.territorialUnits, { countryExists: id => !!countryFeatureById(id) });
            state.layerVisibility.regions = true;
            delete state.itemVisibility.regions?.[String(explicitRegion.id)];
            markLayerTreeDirty();
            projectDomain.queueAutosave();
          } else {
            const createdIds = await (await getGisImportCommitter()).importGeoJsonTerritorialUnits([rawFeature], context.unitType, {
              nameField: 'name', countryField: 'sovereignId', parentField: 'parentId', levelField: 'adminLevel',
            });
            createdId = createdIds[0] || '';
          }
          editingDomain?.clearDraft?.(true);
          editingDomain?.setTool('select', { announce: false });
          if (createdId) applyTerritorialUnitSelectionIntent(createdId, true);
        },
        successMessage: `${typeLabel}을 직접 지정했습니다.`,
        errorMessage: `${typeLabel} 직접 지정 결과를 적용하지 못했습니다.`,
      });
    } catch (error) {
      reportOperationError(error, `${typeLabel}을 직접 지정하지 못했습니다.`, 'PL-REGION-DRAW-001', 4400);
    }
  }

  function normalizeEditorColor(value, fallback) {
    return normalizeColorValue(value, fallback);
  }

  function syncColorPicker(kind, { value, defaultColor, isDefault }) {
    const picker = document.querySelector(`[data-color-picker="${kind}"]`);
    if (!picker) return;
    const fallback = kind === 'country' ? defaultCountryColor()
      : (kind === 'territory' || kind === 'administrative') && (state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY)
        ? territorialUnitColor(territorialUnitById(state.selected.id))
        : DEFAULT_GENERIC_FEATURE_COLOR;
    const resolvedDefault = normalizeEditorColor(defaultColor, fallback);
    const resolvedValue = normalizeEditorColor(value, resolvedDefault);
    const input = picker.querySelector('.ui-native-color-input');
    const triggerPreview = picker.querySelector('.ui-color-trigger .ui-color-preview');
    const valueLabel = picker.querySelector('.ui-color-value');
    const defaultButton = picker.querySelector('[data-color-default]');
    const defaultPreview = defaultButton?.querySelector('.ui-color-preview');
    if (input) input.value = resolvedValue;
    triggerPreview?.style.setProperty('--swatch-color', resolvedValue);
    defaultPreview?.style.setProperty('--swatch-color', resolvedDefault);
    if (valueLabel) valueLabel.textContent = isDefault ? (kind === 'territory' || kind === 'administrative' ? '국가색 상속' : '기본 색상') : resolvedValue.toUpperCase();
    defaultButton?.setAttribute('aria-pressed', String(!!isDefault));
    picker.querySelectorAll('[data-color-value]').forEach(button => {
      button.setAttribute('aria-pressed', String(!isDefault && button.dataset.colorValue === resolvedValue));
    });
    picker.dataset.colorDefault = resolvedDefault;
    picker.dataset.colorValue = resolvedValue;
    picker.dataset.colorIsDefault = String(!!isDefault);
  }

  function closeColorPicker(picker, { restoreFocus = false } = {}) {
    if (!picker) return;
    const popover = picker.querySelector('.ui-color-popover');
    const trigger = picker.querySelector('.ui-color-trigger');
    if (popover?.classList.contains('hidden')) return;
    popover.classList.add('hidden');
    picker.classList.remove('is-open');
    trigger?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger?.focus({ preventScroll: true });
  }

  function closeAllColorPickers(except = null, options = {}) {
    document.querySelectorAll('[data-color-picker]').forEach(picker => {
      if (picker !== except) closeColorPicker(picker, options);
    });
  }

  function alignColorPopoverToViewport(popover) {
    if (!popover || popover.classList.contains('hidden')) return;
    popover.style.removeProperty('--ui-color-popover-shift-x');
    popover.style.removeProperty('--ui-color-popover-shift-y');
    delete popover.dataset.placement;
    const rootStyle = getComputedStyle(document.documentElement);
    const screenEdge = Number.parseFloat(rootStyle.getPropertyValue('--ui-popover-screen-edge')) || 8;
    const pickerBounds = popover.closest('.ui-color-picker')?.getBoundingClientRect();
    let bounds = popover.getBoundingClientRect();
    if (pickerBounds && bounds.bottom > window.innerHeight - screenEdge && pickerBounds.top - screenEdge >= bounds.height) {
      popover.dataset.placement = 'top';
      bounds = popover.getBoundingClientRect();
    }
    let shiftX = 0;
    let shiftY = 0;
    if (bounds.left < screenEdge) shiftX = screenEdge - bounds.left;
    if (bounds.right + shiftX > window.innerWidth - screenEdge) shiftX += (window.innerWidth - screenEdge) - (bounds.right + shiftX);
    if (bounds.top < screenEdge) shiftY = screenEdge - bounds.top;
    if (bounds.bottom + shiftY > window.innerHeight - screenEdge) shiftY += (window.innerHeight - screenEdge) - (bounds.bottom + shiftY);
    if (shiftX) popover.style.setProperty('--ui-color-popover-shift-x', `${shiftX}px`);
    if (shiftY) popover.style.setProperty('--ui-color-popover-shift-y', `${shiftY}px`);
  }

  function openColorPicker(picker) {
    if (!picker) return;
    const popover = picker.querySelector('.ui-color-popover');
    const trigger = picker.querySelector('.ui-color-trigger');
    if (!popover || !trigger) return;
    const opening = popover.classList.contains('hidden');
    closeAllColorPickers(picker);
    popover.classList.toggle('hidden', !opening);
    picker.classList.toggle('is-open', opening);
    trigger.setAttribute('aria-expanded', String(opening));
    if (opening) requestAnimationFrame(() => {
      alignColorPopoverToViewport(popover);
      popover.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
    });
  }

  function resetCountryColor() {
    if (!(state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) return false;
    const id = state.selected.id;
    const idx = state.countryIndex.get(id);
    const feature = idx === undefined ? null : state.countriesData.features[idx];
    const override = state.countryOverrides[id] || {};
    const color = readDomainColor(COLOR_DOMAINS.COUNTRY, { feature, override }, { fallback: defaultCountryColor() });
    if (color.isDefault) {
      syncColorPicker('country', { value: defaultCountryColor(), defaultColor: defaultCountryColor(), isDefault: true });
      return true;
    }
    projectDomain.recordHistory();
    state.countryOverrides[id] = override;
    writeDomainColor(COLOR_DOMAINS.COUNTRY, { feature, override }, '', { clear: true, fallback: defaultCountryColor() });
    applyCountrySelectionIntent(id, true);
    projectDomain.queueAutosave();
    setActionStatus('국가 색상을 기본값으로 되돌렸습니다.', 'success');
    return true;
  }

  function resetGenericFeatureColor() {
    if (state.selected?.domain !== 'generic') return false;
    const feature = state.genericFeatures.find(item => String(item.id) === String(state.selected.id));
    if (!feature) return false;
    feature.properties ||= {};
    const color = readDomainColor(COLOR_DOMAINS.GENERIC, { feature }, { fallback: defaultGenericFeatureColor(feature) });
    if (color.isDefault) {
      const defaultColor = defaultGenericFeatureColor(feature);
      syncColorPicker('generic', { value: defaultColor, defaultColor, isDefault: true });
      return true;
    }
    projectDomain.recordHistory();
    writeDomainColor(COLOR_DOMAINS.GENERIC, { feature }, '', { clear: true, fallback: defaultGenericFeatureColor(feature) });
    genericFeatureLandClipCache.delete(feature);
    applyGenericSelectionIntent(String(feature.id), true);
    projectDomain.queueAutosave();
    setActionStatus('기타 객체 색상을 기본값으로 되돌렸습니다.', 'success');
    return true;
  }

  function resetTerritorialUnitColor(kind) {
    if (!(state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY)) return false;
    const feature = territorialUnitById(state.selected.id);
    if (!feature) return false;
    if (!territorialStyleColor(feature)) {
      const inherited = territorialUnitColor(feature);
      syncColorPicker(kind, { value: inherited, defaultColor: inherited, isDefault: true });
      return true;
    }
    commitTerritorialUnitMeta('color', '');
    return true;
  }

  function applyColorPickerSelection(kind, value, isDefault = false) {
    if (kind === 'multiProperties') {
      const color = normalizeEditorColor(value, '#3f6fae');
      syncColorPicker('multiProperties', { value: color, defaultColor: color, isDefault: false });
      batchSetColor(color);
      return true;
    }
    if (isDefault) {
      if (kind === 'country') return resetCountryColor();
      if (kind === 'territory' || kind === 'administrative' || kind === 'region') return resetTerritorialUnitColor(kind);
      return resetGenericFeatureColor();
    }
    const color = normalizeEditorColor(value, kind === 'country' ? defaultCountryColor() : DEFAULT_GENERIC_FEATURE_COLOR);
    if (kind === 'country') {
      if (!(state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) return false;
      commitCountryEdit('color', color);
      return true;
    }
    if (kind === 'territory' || kind === 'administrative' || kind === 'region') {
      if (!(state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY)) return false;
      commitTerritorialUnitMeta('color', color);
      return true;
    }
    if (kind === 'distribution') {
      if (state.selected?.domain !== 'distribution') return false;
      return commitDistributionMeta('color', color);
    }
    if (kind === 'hydro') {
      const feature = state.selected?.domain === 'hydro' ? hydroEditById(state.selected.id) : null;
      if (!feature) return false;
      return commitHydroEdit('editorColor', normalizeEditorColor(value, HYDRO_TOOL_CONFIG[feature.properties.category].color));
    }
    if (state.selected?.domain !== 'generic') return false;
    commitGenericFeatureMeta('color', color);
    return true;
  }

  function colorSwatchCheckTone(color) {
    const normalized = normalizeEditorColor(color, '#000000').slice(1);
    const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
    const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
    const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;
    const luminance = (red * 0.2126) + (green * 0.7152) + (blue * 0.0722);
    return luminance >= 0.62 ? 'dark' : 'light';
  }

  function createColorSwatch({ color, label, family = '', tone = '' }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-button ui-color-swatch';
    button.dataset.colorValue = color;
    button.dataset.checkTone = colorSwatchCheckTone(color);
    if (family) button.dataset.colorFamily = family;
    if (tone) button.dataset.colorTone = tone;
    button.setAttribute('aria-label', `${label} (${color.toUpperCase()}) 색상`);
    button.setAttribute('aria-pressed', 'false');
    button.style.setProperty('--swatch-color', color);
    return button;
  }

  function appendColorPaletteSection(container, label, colors, modifier) {
    const section = document.createElement('section');
    section.className = 'ui-color-palette-section';
    const heading = document.createElement('span');
    heading.className = 'ui-color-palette-label';
    heading.textContent = label;
    const grid = document.createElement('div');
    grid.className = `ui-color-swatch-grid ui-color-swatch-grid--${modifier}`;
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', `${label} 색상`);
    colors.forEach(color => grid.appendChild(createColorSwatch(color)));
    section.append(heading, grid);
    container.appendChild(section);
  }

  function populateColorPalette(container) {
    if (!container || container.children.length) return;
    appendColorPaletteSection(container, '무채색', COLOR_PALETTE_NEUTRALS, 'neutral');
    appendColorPaletteSection(container, '색상', COLOR_PALETTE_COLORS, 'chromatic');
  }

  function bindColorPickers() {
    document.querySelectorAll('[data-color-picker]').forEach(picker => {
      const kind = picker.dataset.colorPicker;
      const trigger = picker.querySelector('.ui-color-trigger');
      const input = picker.querySelector('.ui-native-color-input');
      const swatches = picker.querySelector('.ui-color-swatches');
      const defaultButton = picker.querySelector('[data-color-default]');
      const customButton = picker.querySelector('[data-color-custom]');
      populateColorPalette(swatches);
      trigger?.addEventListener('click', () => openColorPicker(picker));
      defaultButton?.addEventListener('click', () => {
        if (applyColorPickerSelection(kind, '', true)) closeColorPicker(picker, { restoreFocus: true });
      });
      swatches?.addEventListener('click', event => {
        const button = event.target.closest('[data-color-value]');
        if (!button) return;
        if (applyColorPickerSelection(kind, button.dataset.colorValue)) closeColorPicker(picker, { restoreFocus: true });
      });
      customButton?.addEventListener('click', () => {
        closeColorPicker(picker);
        input?.click();
      });
      input?.addEventListener('change', event => {
        applyColorPickerSelection(kind, event.target.value);
        trigger?.focus({ preventScroll: true });
      });
    });
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('[data-color-picker]')) closeAllColorPickers();
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const openPicker = document.querySelector('[data-color-picker].is-open');
      if (!openPicker) return;
      closeColorPicker(openPicker, { restoreFocus: true });
      event.preventDefault();
    });
    window.addEventListener('resize', () => {
      document.querySelectorAll('[data-color-picker].is-open .ui-color-popover').forEach(alignColorPopoverToViewport);
    });
  }

  function commitCountryEdit(field, value) {
    if (!(state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
    const id = state.selected.id;
    const result = territorialApplicationService.updateMetadata(TERRITORIAL_UNIT_TYPES.COUNTRY, id, field, value);
    if (!result.ok) return;
    if (field === 'name') markLayerTreeDirty();
    applyCountrySelectionIntent(id, true);
    setActionStatus('국가 정보를 변경했습니다.', 'success');
  }

  function commitGenericFeatureMeta(field, value) {
    if (state.selected?.domain !== 'generic') return;
    const f = state.genericFeatures.find(x => String(x.id) === state.selected.id);
    if (!f) return;
    const result = genericFeatureService.updateMetadata(f.id, field, value);
    if (!result.ok) return;
    genericFeatureLandClipCache.delete(f);
    if (field === 'name') markLayerTreeDirty();
    applyGenericSelectionIntent(state.selected.id, true);
    setActionStatus('기타 객체 정보를 변경했습니다.', 'success');
  }

  function commitHydroEdit(field, value) {
    if (state.selected?.domain !== 'hydro') return;
    const feature = hydroEditById(state.selected.id);
    if (!feature || feature.properties?.locked === true) {
      if (feature?.properties?.locked === true) setActionStatus(`잠금을 해제한 뒤 ${hydroCategoryLabel(feature.properties.category)} 정보를 변경하세요.`, 'error', 3200);
      return;
    }
    projectDomain.recordHistory();
    feature.properties[field] = field === 'editorColor'
      ? normalizeEditorColor(value, HYDRO_TOOL_CONFIG[feature.properties.category].color)
      : value;
    if (field === 'name') markLayerTreeDirty();
    applyHydroSelectionIntent(String(feature.id), true);
    projectDomain.queueAutosave();
    setActionStatus(`${hydroCategoryLabel(feature.properties.category)} 정보를 변경했습니다.`, 'success');
  }

  function territorialUnitContainer(feature, { sovereignId = feature?.properties?.sovereignId, parentId = feature?.properties?.parentId } = {}) {
    if (parentId && (feature?.properties?.unitType === TERRITORIAL_UNIT_TYPES.ADMIN
      || feature?.properties?.coverageMode === TERRITORIAL_COVERAGE_MODES.EXPLICIT)) {
      return territorialUnitById(parentId);
    }
    return countryFeatureById(sovereignId);
  }

  function territorialUnitInsideContainer(feature, container) {
    const clipper = window.polygonClipping;
    if (!feature?.geometry || !container?.geometry || !clipper?.difference) return false;
    const outside = clipper.difference(feature.geometry.coordinates, container.geometry.coordinates);
    return multiPolygonPlanarArea(outside) <= Math.max(1e-9, multiPolygonPlanarArea(feature.geometry.coordinates) * 1e-9);
  }

  function commitTerritorialUnitMeta(field, value) {
    if (!(state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
    const feature = territorialUnitById(state.selected.id);
    if (!feature) return;
    if (feature.properties?.locked) {
      setActionStatus('잠금을 해제한 뒤 영역 정보를 변경할 수 있습니다.', 'error', 3200);
      applyTerritorialUnitSelectionIntent(feature.id, true);
      return;
    }
    const explicitCoverage = feature.properties?.coverageMode === TERRITORIAL_COVERAGE_MODES.EXPLICIT;
    if (field === 'sovereignId' && explicitCoverage && String(value) !== String(feature.properties.sovereignId || '')) {
      const candidateUnits = deepClone(state.territorialUnits);
      const candidateFeature = candidateUnits.find(item => String(item.id) === String(feature.id));
      Object.assign(candidateFeature, changeSovereign(candidateFeature, value));
      const normalizedUnits = normalizeTerritorialUnits(candidateUnits, { countryExists: id => !!countryFeatureById(id) });
      territorialApplicationService.replaceUnits(normalizedUnits, {
        type: 'territorial-sovereign', affectedIds: [feature.id],
      });
      markLayerTreeDirty();
      applyTerritorialUnitSelectionIntent(feature.id, true);
      setActionStatus('지방의 주권 관계를 변경했습니다. 형상은 변경하지 않았습니다.', 'success');
      return;
    }
    if (field === 'sovereignId' && String(value) !== String(feature.properties.sovereignId || '')) {
      const nextCountry = countryFeatureById(value);
      const prefix = feature.properties.unitType === TERRITORIAL_UNIT_TYPES.ADMIN ? 'administrative' : 'territory';
      $(`${prefix}CountryInput`).value = String(feature.properties.sovereignId || '');
      if (!nextCountry) {
        projectDomain.recordHistory();
        feature.properties.sovereignId = '';
        feature.properties.parentId = '';
        feature.properties.isRemainder = false;
        normalizeProjectObjects();
        applyTerritorialUnitSelectionIntent(feature.id, true);
        markLayerTreeDirty();
        renderingDomain?.invalidateTerritorialPatch?.('territorial-meta-committed');
        projectDomain.queueAutosave();
        return;
      }
      requestTerritorialUnitTransfer(feature.id, String(value));
      return;
    }
    if (field === 'parentId' && !explicitCoverage) {
      const parent = value ? territorialUnitById(value) : countryFeatureById(feature.properties.sovereignId);
      if (!parent || !territorialUnitInsideContainer(feature, parent)) {
        $('administrativeParentInput').value = String(feature.properties.parentId || '');
        setActionStatus('행정구역 전체가 새 부모 안에 들어갈 때만 상위 영역을 변경할 수 있습니다.', 'error', 4200);
        return;
      }
    }
    const canonicalField = field === 'level' ? 'adminLevel' : field;
    const candidateUnits = deepClone(state.territorialUnits);
    const candidateFeature = candidateUnits.find(item => String(item.id) === String(feature.id));
    if (field === 'color') setTerritorialStyleColor(candidateFeature, value);
    else if (canonicalField === 'parentId') Object.assign(candidateFeature, changeParent(candidateFeature, value));
    else if (canonicalField === 'sovereignId') Object.assign(candidateFeature, changeSovereign(candidateFeature, value));
    else if (canonicalField === 'unitType') Object.assign(candidateFeature, changeUnitType(candidateFeature, value));
    else candidateFeature.properties[canonicalField] = value;
    let normalizedUnits;
    try {
      normalizedUnits = normalizeTerritorialUnits(candidateUnits, { countryExists: id => !!countryFeatureById(id) });
    } catch (error) {
      applyTerritorialUnitSelectionIntent(feature.id, true);
      const validationMessage = compactNotificationMessage(error?.message || '영역 정보를 검증하지 못했습니다.', { tone: 'error', maxLength: 52 });
      setActionStatus(validationMessage, 'error', 0);
      return;
    }
    territorialApplicationService.replaceUnits(normalizedUnits, {
      type: 'territorial-metadata', affectedIds: [feature.id],
    });
    markLayerTreeDirty();
    applyTerritorialUnitSelectionIntent(feature.id, true);
    const unitLabel = feature.properties.unitType === TERRITORIAL_UNIT_TYPES.ADMIN
      ? '행정구역'
      : feature.properties.unitType === TERRITORIAL_UNIT_TYPES.REGION
        ? '지방'
        : '권역';
    setActionStatus(`${unitLabel} 정보를 변경했습니다.`, 'success');
  }

  async function transferTerritorialUnitToCountry(unitId, targetCountryId) {
    const source = territorialUnitById(unitId);
    const donor = countryFeatureById(source?.properties?.sovereignId);
    const target = countryFeatureById(targetCountryId);
    const clipper = window.polygonClipping;
    if (!source || !donor || !target || donor === target || !clipper?.difference || !clipper?.union) return false;
    if (source.properties?.locked) {
      setActionStatus('영역 잠금을 해제한 뒤 소속과 국경을 변경하세요.', 'error', 3600);
      return false;
    }
    if (!requireCountriesUnlocked([donor.id, targetCountryId], '권역과 국경을 이전')) return false;
    const movedIds = new Set([String(source.id)]);
    const queue = [String(source.id)];
    while (queue.length) {
      const parentId = queue.shift();
      for (const child of territorialChildren(state.territorialUnits, parentId)) {
        if (movedIds.has(String(child.id))) continue;
        movedIds.add(String(child.id));
        queue.push(String(child.id));
      }
    }
    const sourceGeometry = deepClone(source.geometry);
    try {
      await runTerritorialUnitTransaction({
        snapshot: snapshotEditable,
        calculate: async () => {
          const donorGeometry = normalizeClippedLandGeometry(clipper.difference(donor.geometry.coordinates, sourceGeometry.coordinates));
          const targetGeometry = normalizeClippedLandGeometry(clipper.union(target.geometry.coordinates, sourceGeometry.coordinates));
          if (!donorGeometry) throw new Error('이전하면 기존 국가의 국토가 남지 않습니다. 새 국가로 독립을 사용하세요.');
          if (!targetGeometry) throw new Error('대상 국가에 권역을 결합하지 못했습니다.');
          const nextUnits = deepClone(state.territorialUnits).flatMap(feature => {
            if (movedIds.has(String(feature.id))) {
              feature.properties.sovereignId = String(targetCountryId);
              if (String(feature.id) === String(source.id)) feature.properties.parentId = String(targetCountryId);
              return [feature];
            }
            if (String(feature.properties?.sovereignId || '') !== String(donor.id)) return [feature];
            const remainder = normalizeClippedLandGeometry(clipper.difference(feature.geometry.coordinates, sourceGeometry.coordinates));
            if (!remainder) return [];
            feature.geometry = remainder;
            return [feature];
          });
          return {
            donorGeometry: normalizeCountryGeometry(donorGeometry),
            targetGeometry: normalizeCountryGeometry(targetGeometry),
            nextUnits: normalizeTerritorialUnits(nextUnits, { countryExists: id => !!countryFeatureById(id) }),
          };
        },
        validate: result => {
          if (!result.donorGeometry || !result.targetGeometry) return { ok: false, message: '국경 변경 결과가 유효하지 않습니다.' };
          return validateTerritorialUnitRelations(result.nextUnits, { countryExists: id => !!countryFeatureById(id) });
        },
        apply: async result => {
          donor.geometry = result.donorGeometry;
          target.geometry = result.targetGeometry;
          state.territorialUnits = result.nextUnits;
          reindexCountries(state.countriesData, true);
          reconcileTerritorialUnitCompleteness([donor.id, target.id]);
          markCountryGeometriesChanged([donor.id, target.id]);
          refreshCountryCentroids([donor.id, target.id]);
          markLayerTreeDirty();
          applyTerritorialUnitSelectionIntent(unitId, true);
          renderingDomain?.invalidateTerritorialPatch?.('territorial-transfer-committed');
          editingDomain?.clearDraftHover?.('territorial-transfer-committed');
        },
        restore: before => restoreEditable(before),
        recordHistory: before => projectDomain.commitHistorySnapshot(before),
        autosave: (...args) => projectDomain.queueAutosave(...args),
      });
      setActionStatus(`${territorialUnitName(source)} 소속과 국경을 변경했습니다.`, 'success', 4200);
      return true;
        } catch (error) {
          editingDomain?.clearDraftHover?.('territorial-transfer-failed');
      reportOperationError(error, '권역을 다른 국가로 이전하지 못해 변경을 되돌렸습니다.', 'PL-REGION-TRANSFER-001', 4800);
      return false;
    }
  }

  function requestTerritorialUnitTransfer(unitId, targetCountryId) {
    const feature = territorialUnitById(unitId);
    const target = countryFeatureById(targetCountryId);
    if (!feature || !target) return;
    openConfirmModal({
      title: '실제 국경 변경',
      message: `${territorialUnitName(feature)}의 형상을 기존 국가에서 제거하고 ${countryName(target)} 국토에 더합니다. 하위 행정구역도 함께 이전되며 실행취소할 수 있습니다.`,
      impacts: [
        '국가 2개의 실제 국경 변경',
        `${territorialUnitName(feature)} 소속 국가 변경`,
        `하위 영역 ${territorialChildren(state.territorialUnits, feature.id).length}개 함께 이전`,
      ],
      confirmText: '권역과 국경 이전',
      danger: true,
      onConfirm: () => transferTerritorialUnitToCountry(feature.id, targetCountryId),
    });
  }

  async function promoteTerritorialUnitToCountry(unitId) {
    const source = territorialUnitById(unitId);
    const sourceCountryId = String(source?.properties?.sovereignId || '');
    const sourceCountry = countryFeatureById(sourceCountryId);
    const name = String(source?.properties?.name || '').trim();
    if (!source || !sourceCountry || !name) {
      setActionStatus('새 국가로 독립하려면 이름과 소속 국가가 있는 권역을 선택하세요.', 'error', 3800);
      return false;
    }
    if (source.properties?.locked) {
      setActionStatus('영역 잠금을 해제한 뒤 국가로 전환하세요.', 'error', 3400);
      return false;
    }
    if (!requireCountriesUnlocked([sourceCountryId], '권역을 국가로 전환')) return false;
    if (countryFeatureById(source.id)) {
      setActionStatus('영역 ID가 국가 ID와 겹칩니다. ID를 바꾸세요.', 'error', 4200);
      return false;
    }
    const descendantIds = new Set();
    const queue = [String(source.id)];
    while (queue.length) {
      const parentId = queue.shift();
      for (const child of territorialChildren(state.territorialUnits, parentId)) {
        if (descendantIds.has(String(child.id))) continue;
        descendantIds.add(String(child.id));
        queue.push(String(child.id));
      }
    }
    const convertedMetadata = source.properties?.metadata?.convertedFromCountry || {};
    const country = createCountryFeature(name, [], territorialStyleColor(source) || null, snapGeometryToGrid(source.geometry, 7));
    country.id = String(source.id);
    country.properties = { name };
    const restoredOverride = convertedMetadata.override && typeof convertedMetadata.override === 'object'
      ? deepClone(convertedMetadata.override)
      : {};
    const snapshot = snapshotEditable();
    setActionStatus('선택한 권역을 새 국가로 독립시키는 중입니다.', 'working', 0);
    const result = await transactCountryEdit({
      operation: 'new-country',
      payload: { sourceIds: [sourceCountryId], transferredGeometry: source.geometry, newFeature: country },
      snapshot,
      applyResult: plan => {
        state.countryOverrides[source.id] = {
          ...restoredOverride,
          name,
          color: territorialStyleColor(source) || restoredOverride.color || '',
          notes: String(source.properties?.notes || restoredOverride.notes || ''),
        };
        applyWorkerCountryPatches(plan);
        reindexCountries(state.countriesData, true);
        state.territorialUnits = state.territorialUnits.flatMap(feature => {
          if (String(feature.id) === String(source.id)) return [];
          if (descendantIds.has(String(feature.id))) {
            feature.properties.sovereignId = String(country.id);
            if (String(feature.properties?.parentId || '') === String(source.id)) feature.properties.parentId = String(country.id);
            return [feature];
          }
          if (String(feature.properties?.sovereignId || '') !== sourceCountryId) return [feature];
          const remainder = normalizeClippedLandGeometry(window.polygonClipping.difference(feature.geometry.coordinates, source.geometry.coordinates));
          if (!remainder) return [];
          feature.geometry = remainder;
          return [feature];
        });
        state.territorialRelations = state.territorialRelations.filter(relation => String(relation.unitId || '') !== String(source.id));
        for (const relation of state.territorialRelations) {
          const related = String(relation.unitId || '') === String(source.id) || descendantIds.has(String(relation.unitId || ''));
          if (related && String(relation.sovereignId || '') === sourceCountryId) relation.sovereignId = String(country.id);
          if (String(relation.parentId || '') === String(source.id)) relation.parentId = String(country.id);
        }
        for (const entry of state.distributionEntries) {
          if (entry.mode === DISTRIBUTION_MODES.TERRITORIAL && String(entry.territorialUnitId) === String(source.id)) entry.territorialUnitId = String(country.id);
        }
        state.territorialUnits = normalizeTerritorialUnits(state.territorialUnits, { countryExists: id => !!countryFeatureById(id) });
        reconcileTerritorialUnitCompleteness([sourceCountryId, country.id]);
        refreshCountryCentroids(new Set(plan.affectedIds));
        markLayerTreeDirty();
        applyCountrySelectionIntent(country.id);
        renderingDomain?.invalidateCountryPatch?.('territorial-promoted-country');
      },
      onSuccess: () => setActionStatus(`${name} 권역을 새 국가로 독립시켰습니다. 하위 행정구역은 유지했습니다.`, 'success', 4000),
      onError: error => reportOperationError(error, '권역을 새 국가로 독립시키지 못했습니다.', 'PL-REGION-PROMOTE-001', 4700),
    });
    return result.ok;
  }

  function buildTerritorialStructurePreview({ source, sourceType, targetType, sovereignId = '', parentId = '' } = {}) {
    if (!source || !sourceType || !targetType) return null;
    const sourceName = territorialTypeSourceName(source);
    const sourceLabel = TERRITORIAL_TYPE_LABELS[sourceType] || '영역';
    const targetLabel = TERRITORIAL_TYPE_LABELS[targetType] || '영역';
    const subjectLabel = ({ 국가: '국가를', 권역: '권역을', 지방: '지방을', 행정구역: '행정구역을' })[sourceLabel] || `${sourceLabel}을`;
    const directionLabel = ({ 국가: '국가로', 권역: '권역으로', 지방: '지방으로', 행정구역: '행정구역으로' })[targetLabel] || `${targetLabel}으로`;
    const sourceIsCountry = sourceType === TERRITORIAL_UNIT_TYPES.COUNTRY;
    const targetIsCountry = targetType === TERRITORIAL_UNIT_TYPES.COUNTRY;
    const childCount = sourceIsCountry
      ? state.territorialUnits.filter(candidate => String(candidate.properties?.sovereignId || '') === String(source.id || '')).length
      : territorialChildren(state.territorialUnits, source.id).length;
    const targetCountry = countryFeatureById(sovereignId);
    const targetParent = territorialUnitById(parentId);
    const impacts = [];
    let summary = `${sourceName}의 종류를 ${targetLabel}(으)로 변경합니다.`;

    if (sourceIsCountry && !targetIsCountry) {
      if (!targetCountry) {
        return {
          title: `${subjectLabel} ${directionLabel} 전환`,
          summary: '소속 국가를 선택해야 변경 결과를 확인할 수 있습니다.',
          impacts: [],
          confirmText: `${directionLabel} 전환`,
          danger: true,
        };
      }
      summary = `${sourceName}의 국토를 ${countryName(targetCountry)}에 합치고 같은 객체를 ${targetLabel}(으)로 유지합니다.`;
      impacts.push(`${countryName(targetCountry)} 국경 변경 및 기존 국가 관계 해제`);
    } else if (targetIsCountry) {
      summary = `${sourceName}의 영역을 현재 소속 국가에서 분리해 독립 국가로 전환합니다.`;
      impacts.push('기존 상위 영역과 소속 국가 관계 해제', '기존 국가 국경 변경 및 새 국가 1개 생성');
    } else {
      const sovereign = countryFeatureById(sovereignId || source.properties?.sovereignId);
      impacts.push(`소속 국가 유지${sovereign ? `: ${countryName(sovereign)}` : ''}`);
      if (targetType === TERRITORIAL_UNIT_TYPES.ADMIN) {
        const parentName = targetParent ? territorialUnitName(targetParent) : sovereign ? `${countryName(sovereign)} 직속` : '선택한 상위 영역';
        impacts.push(`상위 영역: ${parentName}`, '행정 단계는 상위 관계에서 자동 계산');
      } else if (sourceType === TERRITORIAL_UNIT_TYPES.ADMIN) {
        impacts.push('기존 행정 단계와 상위 행정 관계 해제');
      }
    }

    impacts.push('현재 형상과 객체 ID 유지', `하위 영역 ${childCount}개 유지`, '연결된 분포 참조 유지', '한 번의 실행취소로 복구 가능');
    return {
      title: `${subjectLabel} ${directionLabel} 전환`,
      summary,
      impacts,
      confirmText: `${directionLabel} 전환`,
      danger: sourceIsCountry || targetIsCountry,
    };
  }

  function requestTerritorialUnitPromotion(unitId) {
    const feature = territorialUnitById(unitId);
    if (!feature) return;
    const preview = buildTerritorialStructurePreview({
      source: feature,
      sourceType: feature.properties?.unitType,
      targetType: TERRITORIAL_UNIT_TYPES.COUNTRY,
      sovereignId: feature.properties?.sovereignId,
    });
    if (!preview) return;
    openConfirmModal({
      title: preview.title,
      message: preview.summary,
      impacts: preview.impacts,
      confirmText: preview.confirmText,
      danger: preview.danger,
      onConfirm: () => promoteTerritorialUnitToCountry(feature.id),
    });
  }

  let territorialTypeSource = null;

  function territorialTypeSourceFeature() {
    if (!territorialTypeSource) return null;
    return territorialTypeSource.unitType === TERRITORIAL_UNIT_TYPES.COUNTRY
      ? countryFeatureById(territorialTypeSource.id)
      : territorialUnitById(territorialTypeSource.id);
  }

  function territorialTypeSourceName(feature = territorialTypeSourceFeature()) {
    return territorialTypeSource?.unitType === TERRITORIAL_UNIT_TYPES.COUNTRY
      ? countryName(feature)
      : territorialUnitName(feature);
  }

  function territorialTypeParentOptions(source, sovereignId) {
    const country = countryFeatureById(sovereignId);
    if (!country) return [];
    const excluded = new Set([String(source?.id || '')]);
    const queue = [...excluded];
    while (queue.length) {
      const current = queue.shift();
      for (const child of territorialChildren(state.territorialUnits, current)) {
        if (excluded.has(String(child.id))) continue;
        excluded.add(String(child.id));
        queue.push(String(child.id));
      }
    }
    return [
      { value: String(sovereignId), label: `${countryName(country)} · 국가 직속` },
      ...state.territorialUnits
        .filter(candidate => !excluded.has(String(candidate.id))
          && String(candidate.properties?.sovereignId || '') === String(sovereignId)
          && territorialUnitInsideContainer(source, candidate))
        .map(candidate => ({
          value: String(candidate.id),
          label: `${territorialUnitName(candidate)} · ${candidate.properties?.unitType === TERRITORIAL_UNIT_TYPES.ADMIN ? `${Number(candidate.properties.adminLevel) || 1}급 행정구역` : territorialTypeLabel(candidate.properties?.unitType)}`,
        }))
        .sort((left, right) => layerNameCollator.compare(left.label, right.label)),
    ];
  }

  function syncTerritorialTypeModal() {
    const source = territorialTypeSourceFeature();
    if (!source) {
      closeTerritorialTypeModal();
      return;
    }
    const sourceType = territorialTypeSource.unitType;
    const targetType = $('territorialTypeInput').value;
    const sourceIsCountry = sourceType === TERRITORIAL_UNIT_TYPES.COUNTRY;
    const targetIsCountry = targetType === TERRITORIAL_UNIT_TYPES.COUNTRY;
    const targetIsAdmin = targetType === TERRITORIAL_UNIT_TYPES.ADMIN;
    const sovereignRow = $('territorialTypeSovereignRow');
    sovereignRow.classList.toggle('hidden', !sourceIsCountry || targetIsCountry);

    let sovereignId = sourceIsCountry ? $('territorialTypeSovereignInput').value : String(source.properties?.sovereignId || '');
    if (sourceIsCountry && !targetIsCountry) {
      const options = territorialUnitCountryOptions().filter(option => option.value && option.value !== String(territorialTypeSource.id));
      if (!options.some(option => option.value === sovereignId)) sovereignId = String(options[0]?.value || '');
      replaceSelectOptions($('territorialTypeSovereignInput'), options, sovereignId);
    }

    const parentRow = $('territorialTypeParentRow');
    parentRow.classList.toggle('hidden', !targetIsAdmin);
    if (targetIsAdmin) {
      const options = territorialTypeParentOptions(source, sovereignId);
      const currentParent = $('territorialTypeParentInput').value;
      const preferredParent = options.some(option => option.value === currentParent)
        ? currentParent
        : options.some(option => option.value === String(source.properties?.parentId || ''))
          ? String(source.properties.parentId)
          : String(options[0]?.value || '');
      replaceSelectOptions($('territorialTypeParentInput'), options, preferredParent);
    }

    const targetCountry = countryFeatureById(sovereignId);
    const preview = buildTerritorialStructurePreview({
      source,
      sourceType,
      targetType,
      sovereignId,
      parentId: $('territorialTypeParentInput').value,
    });
    $('territorialTypeTitle').textContent = preview?.title || '종류 변경';
    $('territorialTypeImpactSummary').textContent = preview?.summary || '';
    $('territorialTypeImpactList').replaceChildren(...(preview?.impacts || []).map(value => {
      const item = document.createElement('li');
      item.textContent = value;
      return item;
    }));
    $('territorialTypeImpact').classList.toggle('danger-preview', preview?.danger === true);
    const confirm = $('territorialTypeConfirmBtn');
    confirm.textContent = preview?.confirmText || '종류 변경';
    confirm.classList.toggle('danger-confirm', preview?.danger === true);
    confirm.disabled = sourceType === targetType || (sourceIsCountry && !targetIsCountry && !targetCountry)
      || (targetIsAdmin && !$('territorialTypeParentInput').value);
  }

  function openTerritorialTypeModal(unitType, id) {
    const source = unitType === TERRITORIAL_UNIT_TYPES.COUNTRY ? countryFeatureById(id) : territorialUnitById(id);
    if (!source || ![TERRITORIAL_UNIT_TYPES.COUNTRY, TERRITORIAL_UNIT_TYPES.TERRITORY, TERRITORIAL_UNIT_TYPES.ADMIN].includes(unitType)) return;
    if (!requireCanonicalData()) return;
    const sourceLocked = unitType === TERRITORIAL_UNIT_TYPES.COUNTRY ? isCountryLocked(id) : source.properties?.locked === true;
    if (sourceLocked) {
      setActionStatus('잠금을 해제한 뒤 종류를 변경하세요.', 'error', 3400);
      return;
    }
    territorialTypeSource = { unitType, id: String(id) };
    const options = Object.entries(TERRITORIAL_TYPE_LABELS)
      .filter(([type]) => [TERRITORIAL_UNIT_TYPES.COUNTRY, TERRITORIAL_UNIT_TYPES.TERRITORY, TERRITORIAL_UNIT_TYPES.ADMIN].includes(type) && type !== unitType)
      .map(([value, label]) => ({ value, label }));
    const preferred = unitType === TERRITORIAL_UNIT_TYPES.ADMIN ? TERRITORIAL_UNIT_TYPES.TERRITORY
      : unitType === TERRITORIAL_UNIT_TYPES.TERRITORY ? TERRITORIAL_UNIT_TYPES.ADMIN
        : TERRITORIAL_UNIT_TYPES.TERRITORY;
    replaceSelectOptions($('territorialTypeInput'), options, preferred);
    $('territorialTypeContext').textContent = `${territorialTypeSourceName(source)} · 현재 ${TERRITORIAL_TYPE_LABELS[unitType]}`;
    $('territorialTypeSovereignInput').value = '';
    $('territorialTypeParentInput').value = '';
    $('territorialTypeModal').classList.remove('hidden');
    syncTerritorialTypeModal();
    requestAnimationFrame(() => $('territorialTypeInput').focus());
  }

  function closeTerritorialTypeModal() {
    $('territorialTypeModal')?.classList.add('hidden');
    territorialTypeSource = null;
  }

  async function convertTerritorialUnitType(unitId, targetType, parentId = '') {
    const source = territorialUnitById(unitId);
    if (!source || ![TERRITORIAL_UNIT_TYPES.TERRITORY, TERRITORIAL_UNIT_TYPES.ADMIN].includes(targetType)) return false;
    if (source.properties?.locked) {
      setActionStatus('잠금을 해제한 뒤 종류를 변경하세요.', 'error', 3200);
      return false;
    }
    const sovereignId = String(source.properties?.sovereignId || '');
    const parent = targetType === TERRITORIAL_UNIT_TYPES.ADMIN
      ? territorialUnitById(parentId || sovereignId)
      : countryFeatureById(sovereignId);
    if (!parent || (targetType === TERRITORIAL_UNIT_TYPES.ADMIN && !territorialUnitInsideContainer(source, parent))) {
      setActionStatus('영역 전체를 포함하는 올바른 상위 영역을 선택하세요.', 'error', 3900);
      return false;
    }
    try {
      await runTerritorialUnitTransaction({
        snapshot: snapshotEditable,
        calculate: async () => {
          const nextUnits = deepClone(state.territorialUnits);
          const index = nextUnits.findIndex(feature => String(feature.id) === String(unitId));
          if (index < 0) throw new Error('종류를 변경할 영역을 찾을 수 없습니다.');
          const converted = changeUnitType(nextUnits[index], targetType);
          converted.properties.parentId = targetType === TERRITORIAL_UNIT_TYPES.ADMIN
            ? String(parentId || sovereignId)
            : sovereignId;
          nextUnits[index] = converted;
          return normalizeTerritorialUnits(nextUnits, { countryExists: id => !!countryFeatureById(id) });
        },
        validate: nextUnits => validateTerritorialUnitRelations(nextUnits, {
          countryExists: id => !!countryFeatureById(id),
          relations: state.territorialRelations,
        }),
        apply: async nextUnits => {
          state.territorialUnits = nextUnits;
          reconcileTerritorialUnitCompleteness([sovereignId]);
          state.territorialUnits = normalizeTerritorialUnits(state.territorialUnits, { countryExists: id => !!countryFeatureById(id) });
          markLayerTreeDirty();
          applyTerritorialUnitSelectionIntent(unitId, true);
          renderingDomain?.invalidateTerritorialPatch?.('territorial-type-converted');
        },
        restore: before => restoreEditable(before),
        recordHistory: before => projectDomain.commitHistorySnapshot(before),
        autosave: (...args) => projectDomain.queueAutosave(...args),
      });
      setActionStatus(`${territorialUnitName(territorialUnitById(unitId))}을(를) ${TERRITORIAL_TYPE_LABELS[targetType]}(으)로 변경했습니다.`, 'success', 3600);
      return true;
    } catch (error) {
      reportOperationError(error, '영역 종류를 변경하지 못해 변경을 되돌렸습니다.', 'PL-TYPE-001', 4500);
      return false;
    }
  }

  async function convertCountryToRegionType(countryId, targetType, targetCountryId, parentId = '') {
    const source = countryFeatureById(countryId);
    const target = countryFeatureById(targetCountryId);
    if (!source || !target || source === target || ![TERRITORIAL_UNIT_TYPES.TERRITORY, TERRITORIAL_UNIT_TYPES.ADMIN].includes(targetType)) {
      setActionStatus('종류를 변경할 국가와 소속 국가를 다시 선택하세요.', 'error', 3800);
      return false;
    }
    if (!requireCountriesUnlocked([countryId, targetCountryId], '국가 종류를 변경')) return false;
    if (state.territorialUnits.some(feature => String(feature.id) === String(countryId))) {
      setActionStatus('같은 ID의 영역이 이미 있어 종류를 변경할 수 없습니다.', 'error', 4000);
      return false;
    }
    const parent = targetType === TERRITORIAL_UNIT_TYPES.ADMIN ? territorialUnitById(parentId || targetCountryId) : target;
    if (!parent || (String(parent.id || '') !== String(targetCountryId) && !territorialUnitInsideContainer(source, parent))) {
      setActionStatus('국가 영역 전체를 포함하는 올바른 상위 영역을 선택하세요.', 'error', 3900);
      return false;
    }
    const sourceOverride = deepClone(state.countryOverrides[countryId] || {});
    const sourceProperties = deepClone(source.properties || {});
    const name = countryName(source);
    const sourceGeometry = deepClone(source.geometry);
    const converted = createTerritorialFeature({
      id: uid(),
      unitType: targetType,
      name,
      geometry: sourceGeometry,
      parentId: targetType === TERRITORIAL_UNIT_TYPES.ADMIN ? String(parentId || targetCountryId) : String(targetCountryId),
      sovereignId: String(targetCountryId),
      isRemainder: false,
      coverageMode: TERRITORIAL_COVERAGE_MODES.PARTITION,
      adminLevel: targetType === TERRITORIAL_UNIT_TYPES.ADMIN ? 1 : null,
      color: String(sourceOverride.color || ''),
      notes: String(sourceOverride.notes || ''),
      metadata: { convertedFromCountry: { properties: sourceProperties, override: sourceOverride } },
    });
    const snapshot = snapshotEditable();
    setActionStatus(`${name}의 국가 경계를 대상 국가에 합치는 중입니다.`, 'working', 0);
    const result = await transactCountryEdit({
      operation: 'merge',
      payload: { sourceId: String(targetCountryId), targetIds: [String(countryId)] },
      snapshot,
      applyResult: plan => {
        applyWorkerCountryPatches(plan);
        state.territorialUnits.push(converted);
        for (const feature of state.territorialUnits) {
          if (String(feature.properties?.sovereignId || '') !== String(countryId)) continue;
          feature.properties.sovereignId = String(targetCountryId);
          if (String(feature.properties?.parentId || '') === String(countryId)) feature.properties.parentId = String(converted.id);
        }
        for (const relation of state.territorialRelations) {
          if (String(relation.sovereignId || '') === String(countryId)) relation.sovereignId = String(targetCountryId);
          if (String(relation.parentId || '') === String(countryId)) relation.parentId = String(converted.id);
        }
        for (const entry of state.distributionEntries) {
          if (entry.mode === DISTRIBUTION_MODES.TERRITORIAL && String(entry.territorialUnitId) === String(countryId)) entry.territorialUnitId = String(converted.id);
        }
        for (const genericFeature of state.genericFeatures) {
          if (String(genericFeature.properties?.ownerId || '') !== String(countryId)) continue;
          genericFeature.properties.ownerId = String(targetCountryId);
          if (String(genericFeature.properties.topologyGroup || '') === `land:${countryId}`) genericFeature.properties.topologyGroup = `land:${targetCountryId}`;
        }
        state.territorialUnits = normalizeTerritorialUnits(state.territorialUnits, { countryExists: id => !!countryFeatureById(id) });
        reconcileTerritorialUnitCompleteness([targetCountryId]);
        state.territorialUnits = normalizeTerritorialUnits(state.territorialUnits, { countryExists: id => !!countryFeatureById(id) });
        const territorialValidation = validateTerritorialUnitRelations(state.territorialUnits, {
          countryExists: id => !!countryFeatureById(id),
          relations: state.territorialRelations,
        });
        if (!territorialValidation.ok) throw new Error(territorialValidation.issues[0] || '영역 관계가 올바르지 않습니다.');
        refreshCountryCentroids(new Set(plan.affectedIds));
        state.boundaryTopology = { edges: new Map(), nodes: new Map() };
        markLayerTreeDirty();
        applyTerritorialUnitSelectionIntent(converted.id, true);
        renderingDomain?.invalidateCountryPatch?.('country-converted-to-region');
      },
      onSuccess: () => setActionStatus(`${name}을(를) ${countryName(target)} 소속 ${TERRITORIAL_TYPE_LABELS[targetType]}(으)로 변경했습니다.`, 'success', 4300),
      onError: error => reportOperationError(error, '국가 종류를 변경하지 못해 변경을 되돌렸습니다.', 'PL-TYPE-002', 4800),
    });
    return result.ok;
  }

  async function confirmTerritorialTypeConversion() {
    const source = territorialTypeSourceFeature();
    if (!source || !territorialTypeSource) return;
    const sourceRef = { ...territorialTypeSource };
    const targetType = $('territorialTypeInput').value;
    const sovereignId = sourceRef.unitType === TERRITORIAL_UNIT_TYPES.COUNTRY
      ? $('territorialTypeSovereignInput').value
      : String(source.properties?.sovereignId || '');
    const parentId = $('territorialTypeParentInput').value;
    closeTerritorialTypeModal();
    if (sourceRef.unitType === TERRITORIAL_UNIT_TYPES.COUNTRY) {
      await convertCountryToRegionType(sourceRef.id, targetType, sovereignId, parentId);
    } else if (targetType === TERRITORIAL_UNIT_TYPES.COUNTRY) {
      await promoteTerritorialUnitToCountry(sourceRef.id);
    } else {
      await convertTerritorialUnitType(sourceRef.id, targetType, parentId);
    }
  }

  function commitLabelEdit(field, value) {
    if (state.selected?.domain !== 'label') return;
    const label = state.labels.find(x => x.id === state.selected.id);
    if (!label) return;
    projectDomain.recordHistory();
    label[field] = value;
    if (field === 'name' || field === 'kind') markLayerTreeDirty();
    applyLabelSelectionIntent(label.id, true);
    projectDomain.queueAutosave();
    setActionStatus('지명 정보를 변경했습니다.', 'success');
  }

  function configureDatasetSession(project = null) {
    const deltaProject = project?.format === 'pandolab-autosave-delta';
    const pristineCompatible = !project?.countriesData || project.baseDataset === BASE_DATASET || deltaProject;
    state.sessionBaseCountriesJson = pristineCompatible
      ? null
      : JSON.stringify(state.countriesData || { type: 'FeatureCollection', features: [] });
    state.historyDirtyCountryIds = new Set();
    if (deltaProject) {
      const delta = project.countryDelta || { changed: [], removedIds: [] };
      state.historyDirtyCountryIds = new Set([
        ...(delta.changed || []).map(feature => String(feature.id || '')),
        ...(delta.removedIds || []).map(String),
      ].filter(Boolean));
      return;
    }
    if (project?.countriesData && pristineCompatible) {
      const currentIds = new Set();
      for (const feature of state.countriesData?.features || []) {
        const id = String(feature.id || '');
        currentIds.add(id);
        if (canonicalCountryStore) {
          if (!canonicalCountryStore.getFingerprint(id)
              || !canonicalCountryStore.geometryEquals(id, feature.geometry)) state.historyDirtyCountryIds.add(id);
        } else {
          const pristine = (pristineCountriesFallback?.features || []).find(candidate => String(candidate.id || '') === id);
          if (!pristine || JSON.stringify(pristine.geometry) !== JSON.stringify(feature.geometry)) state.historyDirtyCountryIds.add(id);
        }
      }
      const pristineIds = canonicalCountryStore?.ids?.()
        || (pristineCountriesFallback?.features || []).map(feature => String(feature.id || ''));
      for (const id of pristineIds) if (!currentIds.has(String(id))) state.historyDirtyCountryIds.add(String(id));
    }
  }

  function buildCountryDelta() {
    const current = new Map((state.countriesData?.features || []).map(feature => [String(feature.id || ''), feature]));
    const changed = [];
    const removedIds = [];
    for (const id of state.historyDirtyCountryIds) {
      const feature = current.get(String(id));
      if (feature) changed.push(deepClone(feature));
      else removedIds.push(String(id));
    }
    return { changed, removedIds };
  }

  function restoreCountriesFromSnapshot(snapshot) {
    if (snapshot.countriesData) {
      state.countriesData = reindexCountries(deepClone(snapshot.countriesData), true);
      state.historyDirtyCountryIds = new Set();
      return;
    }
    const delta = snapshot.countryDelta || { changed: [], removedIds: [] };
    const changed = new Map((delta.changed || []).map(feature => [String(feature.id || ''), feature]));
    const removed = new Set((delta.removedIds || []).map(String));
    const seen = new Set();
    let base;
    if (state.sessionBaseCountriesJson) {
      base = JSON.parse(state.sessionBaseCountriesJson);
      base.features = (base.features || []).filter(feature => !removed.has(String(feature.id || ''))).map(feature => {
        const id = String(feature.id || '');
        if (!changed.has(id)) return feature;
        seen.add(id);
        return deepClone(changed.get(id));
      });
    } else if (canonicalCountryStore) {
      const currentById = new Map((state.countriesData?.features || []).map(feature => [String(feature.id || ''), feature]));
      base = { type: 'FeatureCollection', features: [] };
      for (const id of canonicalCountryStore.ids()) {
        if (removed.has(id)) continue;
        if (changed.has(id)) {
          seen.add(id);
          base.features.push(deepClone(changed.get(id)));
          continue;
        }
        const current = currentById.get(id);
        base.features.push(current && canonicalCountryStore.geometryEquals(id, current.geometry)
          ? current
          : canonicalCountryStore.materializeFeature(id));
      }
    } else {
      base = materializePristineCountriesSync();
      base.features = (base.features || []).filter(feature => !removed.has(String(feature.id || ''))).map(feature => {
        const id = String(feature.id || '');
        if (!changed.has(id)) return feature;
        seen.add(id);
        return deepClone(changed.get(id));
      });
    }
    for (const [id, feature] of changed) if (!seen.has(id)) base.features.push(deepClone(feature));
    state.countriesData = reindexCountries(base, true);
    const unchangedIds = (state.countriesData.features || []).map(feature => String(feature.id || '')).filter(id => !changed.has(id));
    if (!state.sessionBaseCountriesJson) applyPristineLabelAnchors(state.countriesData, unchangedIds);
    state.historyDirtyCountryIds = new Set(snapshot.historyDirtyCountryIds || [...changed.keys(), ...removed]);
  }

  function snapshotEditable() {
    return {
      countryDelta: buildCountryDelta(),
      historyDirtyCountryIds: [...state.historyDirtyCountryIds],
      ...pickProjectFields(state, { scope: 'history', clone: deepClone }),
    };
  }

  function applySharedProjectFields(source, scope = 'project') {
    return applyProjectFields(state, source, {
      scope,
      clone: deepClone,
      normalizers: {
        labelSettings: value => deepClone(value || {}),
        genericFeatures: value => deepClone(value || []),
        hydroEdits: value => deepClone(value || []),
        territorialUnits: value => deepClone(value || []),
        territorialRelations: value => deepClone(value || []),
        distributionLayers: value => deepClone(value || []),
        distributionEntries: value => deepClone(value || []),
        distributionSettings: value => ({
          renderMode: value?.renderMode === DISTRIBUTION_RENDER_MODES.INTENSITY ? DISTRIBUTION_RENDER_MODES.INTENSITY : DISTRIBUTION_RENDER_MODES.DOMINANT,
          boundaryVisible: value?.boundaryVisible !== false,
        }),
        physicalSettings: (value, current) => normalizePhysicalSettings(value || current),
        layerVisibility: (value, current) => normalizeLayerVisibility(value, current),
        itemVisibility: value => normalizeLayerItemState(value),
        layerPresentation: value => normalizeLayerPresentation(value),
      },
    });
  }

  function normalizeProjectObjects() {
    const countryIds = new Set((state.countriesData?.features || []).map(feature => String(feature?.id || '')).filter(Boolean));
    state.countryOverrides = pruneCountryOverrides(state.countryOverrides, countryIds);
    state.hydroEdits = normalizeHydroEditCollection(state.hydroEdits);
    state.genericFeatures = normalizeGenericFeatureCollection(state.genericFeatures || []);
    state.distributionLayers = normalizeDistributionLayers(state.distributionLayers);
    const distributionLayerIds = new Set(state.distributionLayers.map(layer => layer.id));
    state.distributionEntries = normalizeDistributionEntries(state.distributionEntries, {
      layerExists: id => distributionLayerIds.has(id),
    });
    state.distributionSettings = {
      renderMode: state.distributionSettings?.renderMode === DISTRIBUTION_RENDER_MODES.INTENSITY ? DISTRIBUTION_RENDER_MODES.INTENSITY : DISTRIBUTION_RENDER_MODES.DOMINANT,
      boundaryVisible: state.distributionSettings?.boundaryVisible !== false,
    };
    state.selectedDistributionLayerId = distributionLayerIds.has(String(state.selectedDistributionLayerId || ''))
      ? String(state.selectedDistributionLayerId)
      : '';
    state.territorialUnits = normalizeTerritorialUnits(state.territorialUnits, {
      countryExists: id => !!countryFeatureById(id),
    });
    state.territorialRelations = normalizeTerritorialRelations(state.territorialRelations);
    const relationValidation = territorialApplicationService.validateRelations(state.territorialUnits, {
      countryExists: id => !!countryFeatureById(id),
      relations: state.territorialRelations,
    });
    if (!relationValidation.ok) throw new Error(relationValidation.issues[0] || '영역 관계가 올바르지 않습니다.');
    const distributionValidation = validateDistributionModel(state.distributionLayers, state.distributionEntries, {
      territorialExists: id => !!territorialRepository.get(id),
    });
    if (!distributionValidation.ok) throw new Error(distributionValidation.issues[0] || '분포 참조가 올바르지 않습니다.');
    state.layerFolders = normalizeLayerFolderState(state.layerFolders);
  }

  function normalizeHistoryMetadata(meta = {}) {
    const primary = selectionDomain.primary();
    const info = primary ? objectDisplayInfo(primary) : null;
    return {
      id: uid('history'),
      timestamp: new Date().toISOString(),
      type: String(meta.type || 'edit'),
      description: String(meta.description || (info ? `${info.name} 편집` : '지도 편집')),
      targetName: String(meta.targetName || info?.name || ''),
      affectedIds: [...new Set((meta.affectedIds || (primary ? [primary.id] : [])).map(String))],
    };
  }

  const historyStore = {
    get history() { return state.history; },
    set history(value) { state.history = value; },
    get historyMeta() { return state.historyMeta; },
    set historyMeta(value) { state.historyMeta = value; },
    get future() { return state.future; },
    set future(value) { state.future = value; },
    get futureMeta() { return state.futureMeta; },
    set futureMeta(value) { state.futureMeta = value; },
  };
  const historyService = createHistoryService({
    store: historyStore,
    maxEntries: MAX_HISTORY,
    snapshot: snapshotEditable,
    restore: restoreEditable,
    normalizeMetadata: normalizeHistoryMetadata,
    onRecord: () => saveState.markContentChanged(),
    onChange: (...args) => projectUi.syncHistory(...args),
  });

  function restoreEditable(snapshot, { mode = 'history' } = {}) {
    const changedCountryIds = new Set(state.historyDirtyCountryIds);
    applySharedProjectFields(snapshot, 'history');
    gpuMapRenderer.invalidateHydroVisibility();
    syncPhysicalControls();
    restoreCountriesFromSnapshot(snapshot);
    normalizeProjectObjects();
    const restoredDirtyIds = new Set(state.historyDirtyCountryIds);
    for (const id of state.historyDirtyCountryIds) changedCountryIds.add(String(id));
    pruneLayerItemVisibility();
    scheduleCountryLabelAnchors(null, 10);
    markLayerTreeDirty();
    selectionDomain.clear({ reason: `${mode}-clear-selection` });
    state.coastEditCountryId = null;
    state.coastEditScopeGenericFeatureId = null;
    state.coastEditReturnSelection = null;
    resetBoundaryEditState();
    resetMergeState();
    resetGenericFeatureMergeState();
    resetTerritorialUnitEditState();
    state.genericFeatureSplitSourceId = null;
    resetTerritoryEditingState(true);
    state.tool = 'select';
    objectPropertyController.show(null);
    $('selectionStatus').textContent = '';
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    state.sharedBoundaryTopology = { segments: new Map(), nodes: new Map() };
    updateModeButtons();
    if (changedCountryIds.size) markCountryGeometriesChanged(changedCountryIds);
    state.historyDirtyCountryIds = restoredDirtyIds;
  }




  function syncProjectionButtons() {
    for (const [id, projection] of [['globeBtn', 'globe'], ['flatBtn', 'flat']]) {
      const button = $(id);
      if (!button) continue;
      const active = state.projection === projection;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    syncStatusBar();
  }

  function setProjection(type) {
    const targetProjection = type === 'globe' ? 'globe' : 'flat';
    if (targetProjection === state.projection) return false;
    updateProjection();
    const currentProjection = activeProjection();
    const currentCenter = screenToGeo(currentProjection.translate()) || (state.projection === 'globe'
      ? [-state.view.globeRotation[0], -state.view.globeRotation[1]]
      : state.view.flatCenter.slice());
    const currentScale = Number(currentProjection.scale()) || 1;
    const layout = projectionLayoutMetrics();
    const nextView = deepClone(state.view);
    if (targetProjection === 'globe') {
      nextView.globeRotation = [
        -wrappedLongitudeDelta(currentCenter[0]),
        -clamp(Number(currentCenter[1]), -89, 89),
        0,
      ];
      nextView.globeZoom = clamp(currentScale / layout.globeBaseScale, ZOOM_LIMITS.globe.min, ZOOM_LIMITS.globe.max);
    } else {
      nextView.flatCenter = [
        wrappedLongitudeDelta(currentCenter[0]),
        clamp(Number(currentCenter[1]), -FLAT_LATITUDE_LIMIT, FLAT_LATITUDE_LIMIT),
      ];
      nextView.flatZoom = clamp(currentScale / layout.flatBaseScale, ZOOM_LIMITS.flat.min, ZOOM_LIMITS.flat.max);
    }
    const token = atomicMapStateController.begin({ kind: 'projection', type: targetProjection });
    if (!atomicMapStateController.commit(token, { projection: targetProjection, view: nextView })) return false;
    invalidateEditInteraction();
    syncMapHostFromState();
    syncProjectionButtons();
    renderingDomain?.invalidateProjection?.('projection-change');
    projectDomain.queueViewAutosave();
    return true;
  }

  function setLayerVisibility(key, visible) {
    state.layerVisibility[key] = visible;
    markLayerTreeDirty();
    layerTreeController?.render();
    if (DISTRIBUTION_GROUP_TYPES[key]) distributionVisibilityRevision += 1;
    if (key === 'countries') gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'country-layer-visibility');
    if (key === 'rivers' || key === 'lakes') gpuMapRenderer.invalidateHydroVisibility();
    renderingDomain?.invalidateBaseScene?.('layer-visibility');
    projectDomain.queuePresentationAutosave();
  }

  const LAYER_STYLE_TARGETS = Object.freeze({
    countries: { presentationGroup: 'countries', label: '국가', opacity: true, boundary: true, boundaryLabel: '국경 표시' },
    territories: { presentationGroup: 'territories', label: '권역', opacity: true, boundary: true },
    administrative: { presentationGroup: 'administrative', label: '행정구역', opacity: true, boundary: true },
    regions: { presentationGroup: 'regions', label: '지방', opacity: true, boundary: true },
    languages: { presentationGroup: 'languages', label: '언어', opacity: true, blendMode: true },
    ethnicities: { presentationGroup: 'ethnicities', label: '민족', opacity: true, blendMode: true },
    religions: { presentationGroup: 'religions', label: '종교', opacity: true, blendMode: true },
    rivers: { presentationGroup: 'rivers', label: '강', opacity: true },
    lakes: { presentationGroup: 'lakes', label: '호수', opacity: true },
    genericFeatures: { presentationGroup: 'genericFeatures', label: '기타 객체', opacity: true, opacityLabel: '전체 투명도' },
  });

  function updateLayerPresentationStyle(group, patch) {
    const target = LAYER_STYLE_TARGETS[group];
    if (!target) return false;
    const currentStyle = layerStyle(state.layerPresentation, target.presentationGroup);
    state.layerPresentation = normalizeLayerPresentation({
      ...state.layerPresentation,
      styles: {
        ...state.layerPresentation.styles,
        [target.presentationGroup]: {
          ...currentStyle,
          ...patch,
          boundaryWidth: 1,
          labelsVisible: currentStyle.labelsVisible,
        },
      },
    });
    syncLayerStylePanels();
    if (target.presentationGroup === 'countries') {
      gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'country-presentation');
    }
    if (target.presentationGroup === 'rivers' || target.presentationGroup === 'lakes') {
      gpuMapRenderer.invalidatePhysicalStyle('hydro-presentation');
    }
    renderingDomain?.invalidateOverlayStyle?.('layer-presentation-style');
    projectDomain.queuePresentationAutosave();
    return true;
  }

  function createLayerInlineStylePanel(group) {
    const panel = document.querySelector(`[data-layer-style-panel="${group}"]`);
    const target = LAYER_STYLE_TARGETS[group];
    if (!panel || panel.dataset.initialized === 'true') return panel;
    panel.dataset.initialized = 'true';
    if (!target) return panel;
    if (target.opacity) {
      const field = document.createElement('label');
      field.className = 'ui-field field-group layer-inline-style-field';
      const title = document.createElement('span');
      title.textContent = target.opacityLabel || '투명도';
      const output = document.createElement('output');
      output.dataset.layerStyleOpacityValue = group;
      title.append(' ', output);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0'; input.max = '100'; input.value = '100';
      input.dataset.layerStyleOpacity = group;
      input.setAttribute('aria-label', `${target.label} ${target.opacityLabel || '투명도'}`);
      field.append(title, input);
      panel.append(field);
    }
    if (target.blendMode) {
      const field = document.createElement('label');
      field.className = 'ui-field field-group layer-inline-style-field';
      const title = document.createElement('span');
      title.textContent = '겹침 방식';
      const select = document.createElement('select');
      select.dataset.layerStyleBlendMode = group;
      select.setAttribute('aria-label', `${target.label} 겹침 방식`);
      select.innerHTML = '<option value="normal">일반</option><option value="multiply">곱하기</option>';
      field.append(title, select);
      panel.append(field);
    }
    if (target.boundary) {
      const choice = document.createElement('label');
      choice.className = 'ui-choice-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.layerStyleBoundary = group;
      checkbox.setAttribute('aria-label', `${target.label} ${target.boundaryLabel || '경계 표시'}`);
      const text = document.createElement('span');
      text.textContent = target.boundaryLabel || '경계 표시';
      choice.append(checkbox, text);
      panel.append(choice);
    }
    return panel;
  }

  function syncLayerStylePanels() {
    state.layerPresentation = normalizeLayerPresentation(state.layerPresentation);
    document.querySelectorAll('[data-layer-style-panel]').forEach(panel => {
      const group = panel.dataset.layerStylePanel;
      createLayerInlineStylePanel(group);
      const expanded = expandedLayerStyleGroups.has(group);
      panel.hidden = !expanded;
      const toggle = document.querySelector(`[data-layer-style-toggle="${group}"]`);
      toggle?.setAttribute('aria-expanded', String(expanded));
      toggle?.classList.toggle('active', expanded);
      const target = LAYER_STYLE_TARGETS[group];
      if (!target) return;
      const style = layerStyle(state.layerPresentation, target.presentationGroup);
      const input = panel.querySelector('[data-layer-style-opacity]');
      if (input) { input.value = String(Math.round(style.opacity * 100)); syncRangeProgress(input); }
      const output = panel.querySelector('[data-layer-style-opacity-value]');
      if (output) output.textContent = `${Math.round(style.opacity * 100)}%`;
      const boundary = panel.querySelector('[data-layer-style-boundary]');
      if (boundary) boundary.checked = style.boundaryVisible;
      const blendMode = panel.querySelector('[data-layer-style-blend-mode]');
      if (blendMode) blendMode.value = style.blendMode;
    });
  }

  function toggleLayerStylePanel(group) {
    const panel = createLayerInlineStylePanel(group);
    const toggle = document.querySelector(`[data-layer-style-toggle="${group}"]`);
    if (!panel || !toggle) return;
    const open = !expandedLayerStyleGroups.has(group);
    if (open) expandedLayerStyleGroups.add(group); else expandedLayerStyleGroups.delete(group);
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('active', open);
    syncLayerStylePanels();
  }

  function renderLayerPresentationList() {
    state.layerPresentation = normalizeLayerPresentation(state.layerPresentation);
    syncLayerStylePanels();
    syncDistributionPresentationControls();
    syncPhysicalControls();
  }

  function syncDistributionPresentationControls() {
    const mode = state.distributionSettings?.renderMode || DISTRIBUTION_RENDER_MODES.DOMINANT;
    for (const id of ['distributionLayerModeInput', 'distributionRenderModeInput']) {
      const input = $(id);
      if (input) input.value = mode;
    }
    const boundary = $('distributionBoundaryVisibleInput');
    if (boundary) boundary.checked = state.distributionSettings?.boundaryVisible !== false;
    const hint = $('distributionLayerModeHint');
    if (!hint) return;
    hint.textContent = mode === DISTRIBUTION_RENDER_MODES.INTENSITY
      ? '선택한 분포를 비율이 높을수록 진하게 표시합니다.'
      : '각 영역에서 비율이 가장 높은 분포만 표시합니다.';
  }


  function setMapPanelView(view, { focus = false } = {}) {
    mapPanelView = view === 'view' ? 'view' : 'layers';
    const showingView = mapPanelView === 'view';
    $('layerSection')?.classList.toggle('hidden', showingView);
    $('mapViewSection')?.classList.toggle('hidden', !showingView);
    mapSurfaceTabs?.sync(mapPanelView, { focus });
    if (showingView) renderLayerPresentationList();
  }

  const projectSerializer = createProjectSerializer({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    baseDataset: BASE_DATASET,
    genericFeatureSchemaVersion: GENERIC_FEATURE_SCHEMA_VERSION,
    distributionSchemaVersion: DISTRIBUTION_SCHEMA_VERSION,
    distributionTypes: Object.values(DISTRIBUTION_TYPES),
    distributionModes: Object.values(DISTRIBUTION_MODES),
    terrainDataset: TERRAIN_DATASET,
    hydroDataset: HYDRO_DATASET,
    readSnapshot: () => ({
      countriesData: state.countriesData,
      projectFields: pickProjectFields(state, { clone: value => value }),
      countryDelta: buildCountryDelta(),
      fullAutosave: !!state.sessionBaseCountriesJson,
      terrainManifest: state.terrainManifest,
      hydroManifest: state.hydroManifest,
    }),
  });

  function applyAutosavedView(viewRecord) {
    if (!viewRecord || typeof viewRecord !== 'object') return false;
    if (viewRecord.projection === 'globe' || viewRecord.projection === 'flat') state.projection = viewRecord.projection;
    if (viewRecord.view && typeof viewRecord.view === 'object') {
      state.view = clampViewZooms({ ...state.view, ...deepClone(viewRecord.view) });
    }
    return true;
  }

  const browserProjectStorage = createBrowserProjectStorage({
    indexedDB: window.indexedDB,
    localStorage: window.localStorage,
    databaseName: AUTOSAVE_DB_NAME,
    storeName: AUTOSAVE_STORE_NAME,
    projectKey: AUTOSAVE_RECORD_KEY,
    viewKey: AUTOSAVE_VIEW_KEY,
    fallbackKey: STORAGE_KEY,
  });
  const persistenceService = createPersistenceService({
    storage: browserProjectStorage,
    scheduler: mapWorkScheduler,
    canPersist: () => canMutateProject(state.dataReadiness),
    buildAutosave: () => projectDomain?.buildAutosave?.() || projectSerializer.buildAutosave(),
    readView: () => ({ projection: state.projection, view: deepClone(state.view) }),
    validateProject: assertCurrentProjectSchema,
    onDirty: scope => {
      if (scope === 'presentation') saveState.markPresentationChanged();
      else saveState.markDocumentChanged();
    },
    onAutosaveState: (value, options) => saveState.setAutosave(value, options),
    onSaved: savedAt => {
      state.lastSavedAt = savedAt;
    },
    onFailure: () => setActionStatus('자동저장 실패. 파일로 저장하세요.', 'error', 0),
    onWarning: (...args) => console.warn(...args),
  });

  function validateCanonicalProjectState() {
    assertProjectReferenceIntegrity({
      countries: state.countriesData?.features || [],
      countryOverrides: state.countryOverrides,
      territorialUnits: state.territorialUnits,
      territorialRelations: state.territorialRelations,
      distributionLayers: state.distributionLayers,
      distributionEntries: state.distributionEntries,
      labels: state.labels,
      genericFeatures: state.genericFeatures,
      itemVisibility: state.itemVisibility,
      labelSettings: state.labelSettings,
    });
    return true;
  }

  function invalidateProjectCommandRender(descriptor, commandId) {
    const domain = String(descriptor?.domain || '');
    const reason = `project-command:${String(commandId || 'mutation')}`;
    if (domain === 'country') return renderingDomain?.invalidateCountryPatch?.(reason);
    if (domain === 'territorial') return renderingDomain?.invalidateTerritorialPatch?.(reason);
    if (domain === 'distribution') return renderingDomain?.invalidateOverlayGeometry?.('distribution', reason);
    if (domain === 'generic') return renderingDomain?.invalidateGenericPatch?.(reason);
    throw new TypeError(`Unknown project command render domain: ${domain || '(empty)'}`);
  }

  let projectCommandSaveStateCheckpoint = null;
  let projectCommandStateRevision = 0;
  projectCommandPipeline = createProjectCommandPipeline({
    captureSnapshot: () => {
      projectCommandSaveStateCheckpoint = saveState.checkpoint();
      projectCommandStateRevision = state.stateRevision;
      return snapshotEditable();
    },
    recordHistory: (meta, snapshot) => projectDomain.commitHistorySnapshot(snapshot, meta),
    discardHistory: () => projectDomain.discardHistory(),
    restoreSnapshot: snapshot => {
      restoreEditable(snapshot, { mode: 'rollback' });
      state.stateRevision = projectCommandStateRevision;
      if (projectCommandSaveStateCheckpoint) saveState.restore(projectCommandSaveStateCheckpoint);
    },
    validateProject: validateCanonicalProjectState,
    advanceRevision: () => {
      state.stateRevision += 1;
      return state.stateRevision;
    },
    invalidateRender: invalidateProjectCommandRender,
    queueAutosave: () => projectDomain.queueAutosave(),
    onSuccess: () => {
      projectCommandSaveStateCheckpoint = null;
    },
    onError: () => {
      projectCommandSaveStateCheckpoint = null;
    },
  });

  territorialRepository = createTerritorialRepository({
    getCountries: () => state.countriesData,
    getUnits: () => state.territorialUnits,
    getCountryOverride: id => state.countryOverrides[id] || {},
  });

  territorialApplicationService = createTerritorialApplicationService({
    repository: territorialRepository,
    commandPipeline: projectCommandPipeline,
    countryCommands: {
      isLocked: id => isCountryLocked(id),
      setLocked: (id, locked) => setCountryLockedState(id, locked),
      setField: (id, field, value) => {
        state.countryOverrides[id] = { ...(state.countryOverrides[id] || {}) };
        if (field === 'color') {
          writeDomainColor(COLOR_DOMAINS.COUNTRY, {
            feature: countryFeatureById(id), override: state.countryOverrides[id],
          }, value, { fallback: defaultCountryColor() });
        } else state.countryOverrides[id][field] = value;
      },
    },
    unitCommands: {
      setField: (id, field, value) => {
        const feature = territorialUnitById(id);
        if (!feature) return;
        if (field === 'color') setTerritorialStyleColor(feature, value);
        else feature.properties[field] = value;
      },
      replaceAll: units => {
        state.territorialUnits = units;
        mapObjectGeometryRevisions.territorial += 1;
      },
    },
  });

  distributionService = createDistributionService({
    documentStore: {
      readLayers: () => state.distributionLayers,
      replaceLayers: layers => {
        state.distributionLayers = layers;
        distributionVisibilityRevision += 1;
      },
      readEntries: () => state.distributionEntries,
      replaceEntries: entries => {
        state.distributionEntries = entries;
        distributionVisibilityRevision += 1;
      },
    },
    presentationStore: {
      setRenderMode: mode => {
        state.distributionSettings.renderMode = mode;
        distributionVisibilityRevision += 1;
      },
      setBoundaryVisible: visible => {
        state.distributionSettings.boundaryVisible = visible !== false;
        distributionVisibilityRevision += 1;
      },
    },
    commandPipeline: projectCommandPipeline,
    writeLayerColor: (layer, color) => writeDomainColor(
      COLOR_DOMAINS.DISTRIBUTION,
      { layer },
      color,
      { fallback: DEFAULT_GENERIC_FEATURE_COLOR },
    ),
    territorialExists: id => !!territorialRepository.get(id),
  });

  genericFeatureService = createGenericFeatureService({
    documentStore: {
      readFeatures: () => state.genericFeatures,
      replaceFeatures: genericFeatures => { state.genericFeatures = genericFeatures; },
    },
    commandPipeline: projectCommandPipeline,
    writeColor: (feature, color) => writeDomainColor(
      COLOR_DOMAINS.GENERIC,
      { feature },
      color,
      { fallback: defaultGenericFeatureColor(feature) },
    ),
  });

  function applyAtlasState(project, manual = false, { projectGeneration = null, skipRenderReset = false } = {}) {
    assertCurrentProjectSchema(project);
    if (project.countriesData?.features) {
      assertProjectReferenceIntegrity({
        countries: project.countriesData.features,
        countryOverrides: project.countryOverrides || {},
        territorialUnits: project.territorialUnits || [],
        territorialRelations: project.territorialRelations || [],
        distributionLayers: project.distributionLayers || [],
        distributionEntries: project.distributionEntries || [],
        labels: project.labels || [],
        genericFeatures: project.genericFeatures || [],
        itemVisibility: project.itemVisibility || {},
        labelSettings: project.labelSettings || {},
      });
    }
    resetCountryLabelAnchorRuntime();
    const nextProjectGeneration = skipRenderReset && Number.isFinite(projectGeneration)
      ? projectGeneration
      : projectDomain
        ? projectDomain.resetRenderGeneration('project-reset')
        : gpuMapRenderer.resetProjectRenderState?.();
    boundarySelectionAnalysisCache.clear();
    state.countryVisualPhase = 'preview';
    countryDisplaySource = null;
    countryDisplayIndex = new Map();
    applySharedProjectFields(project);
    gpuMapRenderer.invalidateHydroVisibility();
    state.layerSearch = '';
    state.countriesData = project.countriesData
      ? reindexCountries(deepClone(project.countriesData), true)
      : freshPristineCountries(true);
    state.auditPreviewCountries = null;
    normalizeProjectObjects();
    pruneLayerItemVisibility();
    scheduleCountryLabelAnchors(null, 10);
    markLayerTreeDirty();
    configureDatasetSession(project);
    const externalGeometry = !!project.countriesData && project.baseDataset !== BASE_DATASET;
    selectionDomain.resetProject(projectDomain?.getGeneration?.() || 0);
    editingDomain?.resetProject?.(projectDomain?.getGeneration?.() || 0);

    syncProjectionButtons();
    $('countriesVisible').checked = state.layerVisibility.countries;
    $('territoriesVisible').checked = state.layerVisibility.territories !== false;
    $('administrativeVisible').checked = state.layerVisibility.administrative !== false;
    $('regionsVisible').checked = state.layerVisibility.regions !== false;
    $('languagesVisible').checked = state.layerVisibility.languages !== false;
    $('ethnicitiesVisible').checked = state.layerVisibility.ethnicities !== false;
    $('religionsVisible').checked = state.layerVisibility.religions !== false;
    $('riversVisible').checked = state.layerVisibility.rivers !== false;
    $('lakesVisible').checked = state.layerVisibility.lakes !== false;
    $('genericFeaturesVisible').checked = state.layerVisibility.genericFeatures;
    $('labelsVisible').checked = state.layerVisibility.labels;
    $('basemapLabelsVisible').checked = state.layerVisibility.basemapLabels;
    syncPhysicalControls();
    if ($('layerSearchInput')) $('layerSearchInput').value = state.layerSearch;
    layerTreeController?.render(true);
    objectPropertyController.show(null);
    $('selectionStatus').textContent = '';
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    scheduleGpuMeshRebuild(0, nextProjectGeneration);
    syncMapHostFromState();
    scheduleMapObjectSpatialIndexRebuild();
    projectUi.syncHistory();
    editingDomain?.setTool('select');
    if (manual) setActionStatus(externalGeometry
      ? '외부 GIS 형상을 저장 당시 상태로 불러왔습니다.'
      : '프로젝트를 불러왔습니다.', 'success', 3200);
  }

  let confirmModalController = null;
  let coastReconciliationController = null;
  async function getConfirmModalController() {
    if (confirmModalController) return confirmModalController;
    await ensureModalRuntime();
    confirmModalController = createConfirmModalController({
      document,
      window,
      elements: {
        modal: $('confirmModal'),
        backdrop: $('confirmModal')?.querySelector('.confirm-modal-dim'),
        title: $('confirmModalTitle'),
        message: $('confirmModalMessage'),
        impactSection: $('confirmModalImpactSection'),
        impactList: $('confirmModalImpactList'),
        ok: $('confirmModalOkBtn'),
        cancel: $('confirmModalCancelBtn'),
        choiceRow: $('confirmModalChoiceRow'),
        choice: $('confirmModalChoice'),
      },
      setChoices: replaceSelectOptions,
      beforeOpen: clearNotification,
    });
    confirmModalController.bind();
    return confirmModalController;
  }
  async function getCoastReconciliationController() {
    if (coastReconciliationController) return coastReconciliationController;
    await ensureModalRuntime();
    coastReconciliationController = createCoastReconciliationController({
      document,
      window,
      elements: {
        modal: $('coastReconciliationModal'),
        backdrop: $('coastReconciliationModal')?.querySelector('.confirm-modal-dim'),
        title: $('coastReconciliationTitle'),
        message: $('coastReconciliationMessage'),
        impact: $('coastReconciliationImpact'),
        impactList: $('coastReconciliationImpactList'),
        country: $('coastReconciliationCountryBtn'),
        subject: $('coastReconciliationAdminBtn'),
        independent: $('coastReconciliationIndependentBtn'),
        cancel: $('coastReconciliationCancelBtn'),
      },
    });
    coastReconciliationController.bind();
    return coastReconciliationController;
  }
  const openConfirmModal = options => getConfirmModalController()
    .then(controller => controller.open(options))
    .catch(error => reportOperationError(error, '확인 창을 불러오지 못했습니다.', 'PL-MODAL-001'));
  const closeConfirmModal = () => confirmModalController?.close();

  function analyzeAdminCountryCoastConflicts(adminId) {
    const admin = territorialUnitById(adminId);
    const countryId = String(admin?.properties?.sovereignId || '');
    const country = countryFeatureById(countryId);
    if (!admin || admin.properties?.unitType !== TERRITORIAL_UNIT_TYPES.ADMIN || !country) return { admin, country, status: 'unavailable', conflicts: [] };
    const topology = buildSharedBoundaryTopology(state.countriesData?.features || []);
    const result = analyzeAdminCountryCoast({ adminFeature: admin, countryFeature: country, countryTopology: topology });
    return { admin, country, status: result.status, unavailableReason: result.unavailableReason, conflicts: result.conflicts || [] };
  }

  async function reconcileAdminCountryCoast(adminId, { manual = true } = {}) {
    await ensureGisRuntime();
    const analysis = analyzeAdminCountryCoastConflicts(adminId);
    if (!analysis.admin || !analysis.country) {
      setActionStatus('소속 국가를 찾을 수 없어 해안선을 비교할 수 없습니다.', 'error', 3600);
      return { ok: false, code: 'missing-country' };
    }
    if (analysis.status === 'unavailable') {
      setActionStatus('국가 해안선을 신뢰할 수 있게 판별하지 못해 자동 정합할 수 없습니다.', 'error', 4200);
      return { ok: false, code: analysis.unavailableReason || 'coast-unavailable' };
    }
    if (!analysis.conflicts.length) {
      if (manual) setActionStatus('국가 해안선과 일치하는 불일치 구간이 없습니다.', 'success', 3000);
      return { ok: true, changed: false };
    }
    const decision = await (await getCoastReconciliationController()).open({
      subjectName: territorialUnitName(analysis.admin),
      subjectActionLabel: '행정구역',
      countryName: countryName(analysis.country),
      conflicts: analysis.conflicts,
    });
    if (decision.direction === 'cancel') return { ok: false, cancelled: true };
    if (decision.direction === 'independent') {
      setActionStatus('두 해안선을 자동으로 맞추지 않고 현재 상태를 유지했습니다.', 'success', 3200);
      return { ok: true, changed: false, independent: true };
    }

    const snapshot = snapshotEditable();
    const countryId = String(analysis.country.id || '');
    const adminIdKey = String(analysis.admin.id);
    const countryBefore = deepClone(analysis.country.geometry);
    const adminBefore = deepClone(analysis.admin.geometry);
    try {
      const planned = planCoastReconciliations({ conflicts: analysis.conflicts, direction: decision.direction });
      const nextCountry = planned.countryGeometry;
      const nextAdmin = planned.adminGeometry;
      const countryValidation = validateCoastReplacement(nextCountry, { clipper: window.polygonClipping });
      const adminValidation = validateCoastReplacement(nextAdmin, { clipper: window.polygonClipping });
      if (!countryValidation.ok || !adminValidation.ok) throw new Error('정합 결과 geometry가 올바르지 않습니다.');
      projectDomain.recordHistory({
        type: 'coast-reconciliation',
        description: `${territorialUnitName(analysis.admin)}·${countryName(analysis.country)} 해안선 정합`,
        affectedIds: [adminIdKey, countryId],
      });
      if (decision.direction === 'admin-to-country') {
        analysis.country.geometry = nextCountry;
        state.historyDirtyCountryIds.add(countryId);
        reconcileTerritorialUnitCompleteness([countryId], { preserveIds: [adminIdKey] });
      } else {
        analysis.admin.geometry = nextAdmin;
        reconcileTerritorialUnitCompleteness([countryId]);
      }
      normalizeProjectObjects();
      assertCurrentProjectReferences();
      markLayerTreeDirty();
      renderingDomain?.invalidateCountryPatch?.('admin-country-coast-reconciled');
      projectDomain.queueAutosave();
      setActionStatus(decision.direction === 'admin-to-country' ? '행정구역 해안선을 기준으로 국가 해안선을 조정했습니다.' : '국가 해안선을 기준으로 행정구역 해안선을 조정했습니다.', 'success', 4200);
      return { ok: true, changed: true, direction: decision.direction };
    } catch (error) {
      analysis.country.geometry = countryBefore;
      analysis.admin.geometry = adminBefore;
      restoreEditable(snapshot);
      reportOperationError(error, '해안선 정합을 적용하지 못했습니다.', 'PL-COAST-RECONCILE-001', 4400);
      return { ok: false, error };
    }
  }

  async function resetProjectInPlace({ projectGeneration = null, skipRenderReset = false, prepared = null } = {}) {
    closeConfirmModal();
    closeMobileSheets();
    const nextProjectGeneration = skipRenderReset && Number.isFinite(projectGeneration)
      ? projectGeneration
      : projectDomain
        ? projectDomain.resetRenderGeneration('project-reset')
        : gpuMapRenderer.resetProjectRenderState?.();
    boundarySelectionAnalysisCache.clear();
    state.countryVisualPhase = 'preview';
    countryDisplaySource = null;
    countryDisplayIndex = new Map();

    resetCountryLabelAnchorRuntime();

    state.countryOverrides = {};
    state.sourceInfo = null;
    state.labels = [];
    state.labelSettings = {};
    state.genericFeatures = [];
    state.hydroEdits = [];
    state.territorialUnits = [];
    state.territorialRelations = [];
    state.distributionLayers = [];
    state.distributionEntries = [];
    state.distributionSettings = { renderMode: DISTRIBUTION_RENDER_MODES.DOMINANT, boundaryVisible: true };
    state.selectedDistributionLayerId = '';
    state.distributionDraft = null;
    clearGeometryPreview(state.geometryPreview);
    editingDomain?.cancelActiveGesture?.('project-state-replaced');
    state.audit = { status: 'idle', revision: state.audit.revision + 1, report: null, selectedIssueId: null };
    lastHoverHit = null;
    state.physicalSettings = normalizePhysicalSettings(null);
    state.projection = 'globe';
    state.layerVisibility = normalizeLayerVisibility();
    state.itemVisibility = normalizeLayerItemState(null);
    state.layerPresentation = normalizeLayerPresentation();
    gpuMapRenderer.invalidateHydroVisibility();
    state.layerFolders = normalizeLayerFolderState(null);
    state.layerSearch = '';
    state.tool = 'select';
    state.labelPlacementMode = false;
    state.coastEditCountryId = null;
    state.coastEditScopeGenericFeatureId = null;
    state.coastEditReturnSelection = null;
    resetBoundaryEditState();
    state.genericFeatureMergeSourceId = null;
    state.genericFeatureMergeTargetIds = [];
    state.genericFeatureSplitSourceId = null;
    resetTerritorialUnitEditState();
    resetMergeState();
    resetTerritoryEditingState(true);
    selectionDomain.resetProject(projectDomain?.getGeneration?.() || 0);
    state.view = { globeRotation: [-15, -25, 0], globeZoom: 1, flatCenter: [0, 20], flatZoom: 1 };

    // 핵심: 현재 state나 window 객체가 아니라 앱 시작 때 고정해 둔 불변 원본 스냅샷에서 다시 생성한다.
    // false = 이전 국가명/색상 override까지 적용하지 않고 최초 데이터 그대로 복원.
    state.countryIndex.clear();
    state.countriesData = reindexCountries(prepared, false, { assumeCanonical: true });
    applyPristineLabelAnchors(state.countriesData);
    state.auditPreviewCountries = null;
    pruneLayerItemVisibility();
    markLayerTreeDirty();
    configureDatasetSession(null);
    scheduleGpuMeshRebuild(0, nextProjectGeneration);
    const restoredExactly = canonicalCountryStore
      ? state.countriesData.features.length === canonicalCountryStore.featureCount
        && state.countriesData.features.every(feature => canonicalCountryStore.geometryEquals(String(feature.id || ''), feature.geometry))
      : true;
    if (!restoredExactly) {
      throw new Error('내장 원본 국경 복원 검증에 실패했습니다.');
    }
    refreshCountryCentroids();
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };

    $('countriesVisible').checked = true;
    $('territoriesVisible').checked = true;
    $('administrativeVisible').checked = true;
    $('regionsVisible').checked = true;
    $('languagesVisible').checked = true;
    $('ethnicitiesVisible').checked = true;
    $('religionsVisible').checked = true;
    $('riversVisible').checked = true;
    $('lakesVisible').checked = true;
    $('genericFeaturesVisible').checked = true;
    $('labelsVisible').checked = true;
    $('basemapLabelsVisible').checked = true;
    syncPhysicalControls();
    if ($('layerSearchInput')) $('layerSearchInput').value = '';
    layerTreeController?.render(true);
    syncProjectionButtons();
    objectPropertyController.show(null);
    $('selectionStatus').textContent = '';
    editingDomain?.setTool('select', { announce: false });

    // 기존 SVG 노드는 편집된 Feature 객체를 __data__로 들고 있을 수 있으므로 완전히 제거 후 원본으로 재바인딩한다.
    countryLayer?.selectAll('*').remove();
    countryLabelLayer?.selectAll('*').remove();
    boundaryEditLayer?.selectAll('*').remove();
    territorialUnitLayer?.selectAll('*').remove();
    distributionLayer?.selectAll('*').remove();
    vertexLayer?.selectAll('*').remove();
    genericFeatureLayer?.selectAll('*').remove();
    labelLayer?.selectAll('*').remove();

    syncMapHostFromState();
    resizeMap();
    scheduleMapObjectSpatialIndexRebuild();
    projectUi.syncHistory();
    setActionStatus('새 프로젝트를 만들었습니다.', 'success', 3200);
  }


  function requestDeleteCountry(id) {
    const key = String(id);
    if (!requireCountriesUnlocked([key], '삭제')) return;
    const feature = countryFeatureById(key);
    if (!feature) return;
    const children = territorialRepository.children(key);
    if (children.length) {
      setActionStatus(`하위 영역 ${children.length}개를 먼저 옮기거나 삭제하세요.`, 'error', 4400);
      return;
    }
    const name = countryName(feature);
    openConfirmModal({
      title: '국가 삭제',
      message: `${name} 국가 객체를 지도에서 삭제합니다. 실행취소로 복구할 수 있습니다.`,
      impacts: ['국가 1개 삭제', '국가명 제거', '하위 영역 없음'],
      confirmText: '국가 삭제',
      danger: true,
      onConfirm: () => {
        projectDomain.recordHistory();
        for (const unit of state.territorialUnits) {
          if (String(unit.properties?.sovereignId || '') !== key) continue;
          unit.properties.sovereignId = '';
          unit.properties.parentId = '';
          unit.properties.isRemainder = false;
        }
        state.countriesData.features = state.countriesData.features.filter(f => String(f.id) !== key);
        delete state.countryOverrides[key];
        reindexCountries(state.countriesData, true);
        markCountryGeometriesChanged([key]);
        state.boundaryTopology = { edges: new Map(), nodes: new Map() };
        if ((state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) && String(state.selected.id) === key) selectionUiController.clear({ reason: 'country-delete-selection-clear' });
        else {
          markLayerTreeDirty();
          renderingDomain?.invalidateCountryPatch?.('country-deleted');
        }
        projectDomain.queueAutosave();
        setActionStatus(`${name} 국가를 삭제했습니다.`, 'success');
      },
    });
  }

  function deleteSelectedCountry() {
    if (!requireCanonicalData()) return;
    if (!(state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
    requestDeleteCountry(state.selected.id);
  }






  let gisImportCommitterPromise = null;
  function getGisImportCommitter() {
    if (gisImportCommitterPromise) return gisImportCommitterPromise;
    gisImportCommitterPromise = Promise.all([
      ensureGisRuntime(),
      import(versionedModuleUrl('./modules/gis-import-transaction.js')),
    ]).then(([, module]) => module.createGisImportTransactionCommitter({
      state,
      TERRITORIAL_UNIT_TYPES,
      TERRITORIAL_COVERAGE_MODES,
      DISTRIBUTION_TYPES,
      DISTRIBUTION_MODES,
      DISTRIBUTION_TYPE_LABELS,
      GENERIC_FEATURE_SCHEMA_VERSION,
      DEFAULT_GENERIC_FEATURE_COLOR,
      polygonClipping: window.polygonClipping,
      uid,
      deepClone,
      countryFeatureById,
      countryName,
      territorialUnitName,
      territorialRepository,
      distributionService,
      genericFeatureService,
      resolveImportedCountryId,
      normalizeCountryGeometry,
      normalizeClippedLandGeometry,
      createTerritorialFeature,
      createPartitionTerritorialFeature,
      normalizeTerritorialUnits,
      reconcileTerritorialUnitCompleteness,
      partitionGroupMatches,
      multiPolygonPlanarArea,
      createGisImportError,
      RELIABILITY_ERROR_CATEGORIES,
      recordHistory: (...args) => projectDomain.recordHistory(...args),
      snapshotEditable,
      markCountryGeometriesChanged,
      refreshCountryCentroids,
      normalizeProjectObjects,
      markLayerTreeDirty,
      applyTerritorialUnitSelectionIntent,
      renderingDomain,
      queueAutosave: (...args) => projectDomain.queueAutosave(...args),
      setActionStatus,
      createDistributionLayer,
      createDistributionEntry,
      activeLayerFolderKeys,
      normalizeGenericFeatureSemantics,
      validateStructuredGeometry,
      territorialTypeLabel,
      sphericalGeometryAreaKm2,
      buildTerritorialImportTransactionPlan,
      mapEditClient,
      validateGisCountryCollection: (...args) => gisWorkflow.validateCountries(...args),
      reindexCountries,
      transferLandDependents,
      assertCurrentProjectReferences,
      commitHistorySnapshot: (...args) => projectDomain.commitHistorySnapshot(...args),
      restoreCountryEditSnapshot,
      createCancellationError,
      buildSharedBoundaryTopology,
      analyzeAdminCountryCoast,
      ensureGisRuntime,
      getCoastReconciliationController,
      normalizeCoastDecision,
      planCoastReconciliations,
      validateCoastReplacement,
      importedCountryOverrides,
      applyImportedPackageAssets,
      projectDomain,
      appendImportedSourceInfo,
      assertProjectReferenceIntegrity,
      pruneLayerItemVisibility,
      scheduleCountryLabelAnchors,
      selectionUiController,
    })).catch(error => {
      gisImportCommitterPromise = null;
      throw error;
    });
    return gisImportCommitterPromise;
  }

  let requestedVectorTarget = '';
  let gisFileControllerPromise = null;

  function getGisFileController() {
    if (gisFileControllerPromise) return gisFileControllerPromise;
    gisFileControllerPromise = import(versionedModuleUrl('./modules/gis-file-controller.js'))
      .then(({ createGisFileController }) => {
        const controller = createGisFileController({
          elements: { open: $('openGisBtn'), input: $('gisFileInput'), save: $('saveProjectBtn') },
          setTarget: target => { requestedVectorTarget = target; },
          onFiles: openGisFiles,
          requireCanonicalData,
          projectDomain,
          setActionStatus,
          window,
          document,
        });
        controller.bind();
        return controller;
      })
      .catch(error => {
        gisFileControllerPromise = null;
        throw error;
      });
    return gisFileControllerPromise;
  }

  async function openGisFiles(files) {
    if (!files?.length) return;
    const requestedTarget = requestedVectorTarget;
    requestedVectorTarget = '';
    setActionStatus('파일 확인 중…', 'working', 0);
    try {
      const outcome = await gisDomain.planImport(files, { targetType: requestedTarget });
      if (outcome?.status === 'planned') await editingDomain.commitImport(outcome.plan);
    } catch (error) {
      if (isAbortError(error)) {
        reliabilityDiagnostic.push({ category: 'gis', operation: 'gis-import', result: 'cancelled' });
        setActionStatus('파일 불러오기를 취소했습니다.', 'ready');
        return;
      }
      reportGisImportError(error, { rollback: 'not-started-or-transaction-owned' });
    }
  }

  let historicalLibraryService = null;
  let historicalLibraryController = null;
  let LIBRARY_TYPE_LABELS = Object.freeze({});

  function combineHistoricalLibraryGeometries(geometries) {
    const coordinates = geometries.filter(geometry => ['Polygon', 'MultiPolygon'].includes(geometry?.type)).map(geometry => geometry.coordinates);
    if (!coordinates.length) return null;
    const union = coordinates.length === 1 ? coordinates[0] : window.polygonClipping.union(...coordinates);
    return normalizeClippedLandGeometry(union);
  }

  function historicalLibraryPreviewSvg(entity, version) {
    const wrapper = document.createElement('div');
    wrapper.className = 'historical-library-preview-map';
    const svgNode = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgNode.setAttribute('viewBox', '0 0 420 190');
    svgNode.setAttribute('aria-label', `${entity.displayNames?.ko || entity.canonicalName} 경계 미리보기`);
    const projection = d3.geo.equirectangular().scale(1).translate([0, 0]);
    const previewPath = d3.geo.path().projection(projection);
    const feature = { type: 'Feature', properties: {}, geometry: version.geometry };
    const bounds = previewPath.bounds(feature);
    const width = Math.max(1, bounds[1][0] - bounds[0][0]);
    const height = Math.max(1, bounds[1][1] - bounds[0][1]);
    const scale = 0.86 / Math.max(width / 420, height / 190);
    const center = [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
    projection.scale(scale).translate([210 - scale * center[0], 95 - scale * center[1]]);
    const pathNode = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathNode.setAttribute('d', previewPath(feature) || '');
    pathNode.setAttribute('fill', 'var(--accent-surface)');
    pathNode.setAttribute('stroke', 'var(--accent-border)');
    pathNode.setAttribute('stroke-width', '1.5');
    pathNode.setAttribute('vector-effect', 'non-scaling-stroke');
    svgNode.appendChild(pathNode);
    wrapper.appendChild(svgNode);
    return wrapper;
  }

  function libraryInstanceId(libraryId) {
    const entity = historicalLibraryService.get(libraryId);
    const currentCountryId = String(entity?.metadata?.currentCountryId || '');
    if (currentCountryId && countryFeatureById(currentCountryId)) return currentCountryId;
    if (countryFeatureById(libraryId)) return String(libraryId);
    const unit = state.territorialUnits.find(feature => String(feature.properties?.sourceLibraryId || '') === String(libraryId));
    return unit ? String(unit.id) : '';
  }

  async function instantiateHistoricalLibraryEntities(rootIds, referenceDate, childDepth = 'none') {
    const descriptors = historicalLibraryService.instantiateDescriptors(rootIds, referenceDate, childDepth);
    const pending = descriptors.filter(descriptor => !libraryInstanceId(descriptor.libraryId));
    if (!pending.length) return { added: 0, subtracted: 0, deleted: 0, affectedIds: [] };
    const priority = pending.filter(descriptor => descriptor.instantiation?.mode === 'country-territory-priority');
    if (priority.length) {
      if (priority.length !== 1 || pending.length !== 1 || priority[0].type !== LIBRARY_ENTITY_TYPES.COUNTRY) {
        throw new Error('영토 우선 라이브러리 항목은 한 번에 국가 1개만 추가할 수 있습니다.');
      }
      const descriptor = priority[0];
      const feature = createCountryFeature(descriptor.name, [], null, descriptor.geometry);
      feature.id = descriptor.libraryId;
      if (descriptor.metadata?.defaultColor) state.countryOverrides[descriptor.libraryId] = { color: descriptor.metadata.defaultColor };
      if (descriptor.validFrom) feature.properties.validFrom = descriptor.validFrom;
      if (descriptor.validTo) feature.properties.validTo = descriptor.validTo;
      const countriesData = { type: 'FeatureCollection', features: [feature] };
      const plan = await gisWorkflow.planMerge(state.countriesData, countriesData, 'imported-territory-priority');
      if (!plan.canCommit) throw new Error('자동 차감 후에도 국가 간 중첩이 남아 라이브러리 항목을 추가할 수 없습니다.');
      if (plan.counts?.deleted) throw new Error('영토 우선 국가 추가 과정에서 기존 국가가 삭제되어 작업을 중단했습니다.');
      const committer = await getGisImportCommitter();
      return committer.commitGisMerge({
        countriesData,
        countryUpdates: descriptor.instantiation?.countryUpdates || {},
        sourceInfo: descriptor.metadata?.librarySourceInfo || {},
        commitStatus: `${descriptor.name}을(를) 추가하고 기존 국가 영토를 한 번의 작업으로 차감했습니다.`,
      }, plan);
    }
    projectDomain.recordHistory();
    let countriesAdded = 0;
    for (const descriptor of pending) {
      if (descriptor.type === LIBRARY_ENTITY_TYPES.COUNTRY) {
        const feature = createCountryFeature(
          descriptor.name,
          [],
          null,
          descriptor.geometry,
        );
        feature.id = descriptor.libraryId;
        if (descriptor.metadata?.defaultColor) state.countryOverrides[descriptor.libraryId] = { color: descriptor.metadata.defaultColor };
        if (descriptor.validFrom) feature.properties.validFrom = descriptor.validFrom;
        if (descriptor.validTo) feature.properties.validTo = descriptor.validTo;
        if (descriptor.metadata?.territoryMerge === 'imported-priority') {
          const overlappingCountryIds = new Set(countryIdsOverlappingGeometry(descriptor.geometry));
          const donorIds = [];
          const nextFeatures = [];
          for (const candidate of state.countriesData.features || []) {
            const donorId = String(candidate.id || '');
            if (!overlappingCountryIds.has(donorId)) {
              nextFeatures.push(candidate);
              continue;
            }
            if (donorId) donorIds.push(donorId);
            const remainder = normalizeClippedLandGeometry(window.polygonClipping.difference(
              candidate.geometry.coordinates,
              descriptor.geometry.coordinates,
            ));
            if (!remainder || sphericalGeometryAreaKm2(remainder) <= 0.000001) continue;
            nextFeatures.push({ ...candidate, geometry: remainder });
          }
          state.countriesData.features = nextFeatures;
          for (const donorId of donorIds) state.historyDirtyCountryIds.add(donorId);
          transferLandDependents(descriptor.geometry, donorIds, descriptor.libraryId);
        }
        state.countriesData.features.push(feature);
        state.historyDirtyCountryIds.add(String(feature.id || ''));
        countriesAdded += 1;
        continue;
      }
      const parentId = libraryInstanceId(descriptor.parentLibraryId);
      const sovereignId = libraryInstanceId(descriptor.sovereignLibraryId);
      state.territorialUnits.push(createTerritorialFeature({
        id: uid(`library_${descriptor.type}`),
        unitType: descriptor.type,
        name: descriptor.name,
        geometry: descriptor.geometry,
        parentId,
        sovereignId,
        adminLevel: descriptor.adminLevel,
        coverageMode: descriptor.type === LIBRARY_ENTITY_TYPES.REGION ? TERRITORIAL_COVERAGE_MODES.EXPLICIT : TERRITORIAL_COVERAGE_MODES.PARTITION,
        isRemainder: false,
        validFrom: descriptor.validFrom,
        validTo: descriptor.validTo,
        metadata: descriptor.metadata,
        sourceLibraryId: descriptor.libraryId,
        sourceGeometryVersion: descriptor.geometryVersionId,
      }));
    }
    if (countriesAdded) {
      reindexCountries(state.countriesData, true);
      // Historical-library country insertion can replace several donor
      // geometries without going through markCountryGeometriesChanged().
      // Advance the canonical country revision here so RenderScene and its
      // SceneColorCache cannot treat the pre-insertion mesh as unchanged.
      countryLandRevision += 1;
      boundarySelectionAnalysisCache.clear();
      mapEditClient.rebase(state.countriesData.features);
      scheduleGpuMeshRebuild(0);
    }
    normalizeProjectObjects();
    markLayerTreeDirty();
    scheduleMapObjectSpatialIndexRebuild();
    renderingDomain?.invalidateProject?.('historical-library-import');
    projectDomain.queueAutosave();
    saveState.markNewProject('content:0');
    return {
      added: pending.length,
      subtracted: 0,
      deleted: 0,
      affectedIds: pending.map(descriptor => libraryInstanceId(descriptor.libraryId)).filter(Boolean),
    };
  }

  async function getHistoricalLibraryController() {
    if (historicalLibraryController) return historicalLibraryController;
    await Promise.all([ensureHistoricalRuntime(), gisWorkflow.ensure(), ensureModalRuntime()]);
    const { createHistoricalLibraryService } = historicalLibraryServiceModule;
    const { createHistoricalLibraryController } = historicalLibraryControllerModule;
    historicalLibraryService = createHistoricalLibraryService({
      dataUrl: HISTORICAL_LIBRARY_DATA_URL,
      fetchJson: async url => {
        const response = await fetch(url, { cache: 'force-cache' });
        if (!response.ok) throw new Error(`라이브러리 HTTP ${response.status}`);
        return response.json();
      },
      getCountriesData: () => state.countriesData,
      displayName: countryName,
      combineGeometries: combineHistoricalLibraryGeometries,
    });
    LIBRARY_TYPE_LABELS = Object.freeze({
      [LIBRARY_ENTITY_TYPES.COUNTRY]: MAP_OBJECT_TYPES.country.label,
      [LIBRARY_ENTITY_TYPES.TERRITORY]: MAP_OBJECT_TYPES.territory.label,
      [LIBRARY_ENTITY_TYPES.ADMIN]: MAP_OBJECT_TYPES.admin.label,
      [LIBRARY_ENTITY_TYPES.REGION]: MAP_OBJECT_TYPES.region.label,
    });
    historicalLibraryController = createHistoricalLibraryController({
      document,
      elements: {
        open: null,
        modal: $('historicalLibraryModal'),
        card: document.querySelector('.historical-library-card'),
        close: $('historicalLibraryCloseBtn'),
        backdrop: $('historicalLibraryModal').querySelector('.ui-dialog-backdrop'),
        search: $('historicalLibrarySearchInput'),
        clearSearch: $('historicalLibrarySearchClearBtn'),
        type: $('historicalLibraryTypeInput'),
        status: $('historicalLibraryStatusInput'),
        year: $('historicalLibraryYearInput'),
        geographicRegion: $('historicalLibraryGeographicRegionInput'),
        results: $('historicalLibraryResults'),
        preview: $('historicalLibraryPreview'),
        snapshot: $('historicalLibrarySnapshotInput'),
        snapshotButton: $('historicalLibrarySnapshotBtn'),
        childDepth: $('historicalLibraryChildDepthInput'),
        add: $('historicalLibraryAddBtn'),
        addOptions: $('historicalLibraryAddOptions'),
        optionsBack: $('historicalLibraryOptionsBackBtn'),
      },
      service: historicalLibraryService,
      typeLabels: LIBRARY_TYPE_LABELS,
      selectGeometryVersion,
      renderMapPreview: historicalLibraryPreviewSvg,
      createEmptyState,
      replaceSelectOptions,
      collator: layerNameCollator,
      isMobile,
      closeCreateMenu,
      instantiate: instantiateHistoricalLibraryEntities,
      confirm: openConfirmModal,
      setStatus: setActionStatus,
      reportError: reportOperationError,
    });
    historicalLibraryController.connect();
    return historicalLibraryController;
  }

  window.PANDOLAB_HISTORICAL_LIBRARY = Object.freeze({
    load: async () => { await getHistoricalLibraryController(); return historicalLibraryService.load(); },
    get: async id => { await getHistoricalLibraryController(); return historicalLibraryService.get(id); },
    list: async () => { await getHistoricalLibraryController(); return historicalLibraryService.list(); },
    search: async options => { await getHistoricalLibraryController(); return historicalLibraryService.search(options); },
    snapshots: async () => { await getHistoricalLibraryController(); return historicalLibraryService.snapshots(); },
    instantiate: async (id, referenceDate = '', childDepth = 'none') => {
      await getHistoricalLibraryController();
      return instantiateHistoricalLibraryEntities([id], referenceDate, childDepth);
    },
  });

  function getGisExportController() {
    if (gisExportControllerPromise) return gisExportControllerPromise;
    gisExportControllerPromise = import(versionedModuleUrl('./modules/gis-export-controller.js')).then(({ createGisExportController }) => {
      const units = () => state.territorialUnits || [];
      const controller = createGisExportController({
        window,
        document,
        elements: {
          trigger: $('dataExportBtn'),
          modal: $('gisExportModal'),
          form: $('gisExportForm'),
          error: $('gisExportError'),
          summary: $('gisExportSummary'),
          format: $('gisExportFormat'),
          stepIndicator: $('gisExportStepIndicator'),
          close: $('gisExportCloseBtn'),
          cancel: $('gisExportCancelBtn'),
          backdrop: $('gisExportModal').querySelector('.ui-dialog-backdrop'),
          back: $('gisExportBackBtn'),
          next: $('gisExportNextBtn'),
          confirm: $('gisExportConfirmBtn'),
        },
        ensureRuntime: () => Promise.all([ensureGisIoRuntime(), ensureModalRuntime()]),
        requireReady: requireCanonicalData,
        getProject: () => projectDomain.buildProject(),
        getCounts: () => ({
          countries: state.countriesData?.features?.length || 0,
          territories: units().filter(feature => feature.properties?.unitType === TERRITORIAL_UNIT_TYPES.TERRITORY).length,
          administrative: units().filter(feature => feature.properties?.unitType === TERRITORIAL_UNIT_TYPES.ADMIN).length,
          regions: units().filter(feature => feature.properties?.unitType === TERRITORIAL_UNIT_TYPES.REGION).length,
          genericFeatures: state.genericFeatures.length,
          distributions: state.distributionEntries.length,
          labels: state.labels.length,
        }),
        download: (filename, blob) => {
          const url = window.URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = filename;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
        },
        setStatus: setActionStatus,
        reportError: error => reportOperationError(error, 'GIS 데이터를 내보내지 못했습니다.', 'PL-GIS-EXPORT-001', 4200),
      });
      controller.bind();
      gisExportController = controller;
      return controller;
    }).catch(error => {
      gisExportControllerPromise = null;
      throw error;
    });
    return gisExportControllerPromise;
  }

  function removeGenericFeatureById(id, statusText = '') {
    const key = String(id);
    const feature = genericFeatureService.get(key);
    if (!feature) return false;
    const result = genericFeatureService.remove(key, {
      beforeRemove: () => reassignGenericFeatureParents([key]),
    });
    if (!result.ok) return false;
    markLayerTreeDirty();
    if (state.selected?.domain === 'generic' && String(state.selected.id) === key) selectionUiController.clear({ reason: 'generic-delete-selection-clear' });
    setActionStatus(statusText || `${genericFeatureName(feature)} 기타 객체를 삭제했습니다.`, 'success');
    return true;
  }

  function removeHydroEditById(id, statusText = '') {
    const key = String(id);
    const feature = hydroEditById(key);
    if (!feature) return false;
    projectDomain.recordHistory();
    state.hydroEdits = state.hydroEdits.filter(candidate => String(candidate.id) !== key);
    const sourceId = String(feature.properties?.sourceFeatureId || '');
    if (sourceId && !state.hydroEdits.some(candidate => String(candidate.properties?.sourceFeatureId || '') === sourceId)) {
      delete state.physicalSettings.hiddenHydroIds[sourceId];
      gpuMapRenderer.invalidateHydroVisibility();
    }
    markLayerTreeDirty();
    if (state.selected?.domain === 'hydro' && String(state.selected.id) === key) selectionUiController.clear({ reason: 'hydro-delete-selection-clear' });
    renderingDomain?.invalidateHydroPatch?.('hydro-feature-deleted');
    projectDomain.queueAutosave();
    const category = hydroCategoryLabel(feature.properties?.category);
    const fallback = hydroFallbackName(feature.properties?.category);
    setActionStatus(statusText || `${hydroEditorName(feature.properties?.name, fallback)}${hydroAccusativeLabel(feature.properties?.category).slice(category.length)} 삭제했습니다.`, 'success');
    return true;
  }

  function removeLabelById(id, statusText = '') {
    const key = String(id);
    const label = state.labels.find(candidate => String(candidate.id) === key);
    if (!label) return false;
    projectDomain.recordHistory();
    state.labels = state.labels.filter(candidate => String(candidate.id) !== key);
    delete state.labelSettings[labelKey('label', key)];
    markLayerTreeDirty();
    if (state.selected?.domain === 'label' && String(state.selected.id) === key) selectionUiController.clear({ reason: 'label-delete-selection-clear' });
    renderingDomain?.invalidateLabels?.('label-deleted');
    projectDomain.queueAutosave();
    setActionStatus(statusText || `${label.name || '지명'} 지명을 삭제했습니다.`, 'success');
    return true;
  }

  function performTerritorialUnitDivisionRemoval(id, action = 'unassigned') {
    const feature = territorialUnitById(id);
    if (!feature) return false;
    const children = territorialChildren(state.territorialUnits, feature.id);
    if (children.length) {
      setActionStatus(`하위 행정구역 ${children.length}개를 먼저 다른 부모로 옮기거나 구분 해제하세요.`, 'error', 4200);
      return false;
    }
    const siblings = territorialSiblings(state.territorialUnits, feature);
    const countryId = String(feature.properties?.sovereignId || '');
    let mergeTarget = null;
    let mergedGeometry = null;
    if (action.startsWith('merge:')) {
      const targetId = action.slice('merge:'.length);
      mergeTarget = siblings.find(candidate => String(candidate.id) === targetId);
      if (!mergeTarget || !territorialUnitsAreAdjacent(feature, mergeTarget)) {
        setActionStatus('합칠 인접 영역을 찾을 수 없어 변경하지 않았습니다.', 'error', 3800);
        return false;
      }
      mergedGeometry = normalizeClippedLandGeometry(window.polygonClipping.union(mergeTarget.geometry.coordinates, feature.geometry.coordinates));
      if (!mergedGeometry) {
        setActionStatus('선택한 영역을 합칠 수 없어 변경하지 않았습니다.', 'error', 3800);
        return false;
      }
    }
    if (action === 'clear-all') {
      const groupIds = new Set([feature, ...siblings].map(candidate => String(candidate.id)));
      if (state.territorialUnits.some(candidate => groupIds.has(String(candidate.properties?.parentId || '')))) {
        setActionStatus('하위 행정구역이 있는 단계는 전체 구분을 해제할 수 없습니다.', 'error', 4200);
        return false;
      }
    }
    projectDomain.recordHistory();
    if (action.startsWith('merge:')) {
      mergeTarget.geometry = mergedGeometry;
      for (const entry of state.distributionEntries) if (entry.mode === DISTRIBUTION_MODES.TERRITORIAL && String(entry.territorialUnitId) === String(feature.id)) entry.territorialUnitId = String(mergeTarget.id);
      state.territorialRelations = state.territorialRelations
        .filter(relation => String(relation.unitId) !== String(feature.id))
        .map(relation => String(relation.parentId) === String(feature.id) ? { ...relation, parentId: String(mergeTarget.id) } : relation);
      state.territorialUnits = state.territorialUnits.filter(candidate => String(candidate.id) !== String(feature.id));
      applyTerritorialUnitSelectionIntent(mergeTarget.id, true);
    } else if (action === 'clear-all') {
      const groupIds = new Set([feature, ...siblings].map(candidate => String(candidate.id)));
      state.distributionEntries = state.distributionEntries.filter(entry => entry.mode !== DISTRIBUTION_MODES.TERRITORIAL || !groupIds.has(String(entry.territorialUnitId)));
      state.territorialRelations = state.territorialRelations.filter(relation => !groupIds.has(String(relation.unitId)) && !groupIds.has(String(relation.parentId)));
      state.territorialUnits = state.territorialUnits.filter(candidate => !groupIds.has(String(candidate.id)));
      selectionUiController.clear({ reason: 'territorial-group-delete-selection-clear' });
    } else if (!siblings.length) {
      state.distributionEntries = state.distributionEntries.filter(entry => entry.mode !== DISTRIBUTION_MODES.TERRITORIAL || String(entry.territorialUnitId) !== String(feature.id));
      state.territorialRelations = state.territorialRelations.filter(relation => String(relation.unitId) !== String(feature.id) && String(relation.parentId) !== String(feature.id));
      state.territorialUnits = state.territorialUnits.filter(candidate => String(candidate.id) !== String(feature.id));
      selectionUiController.clear({ reason: 'territorial-delete-selection-clear' });
    } else {
      const unassigned = siblings.find(candidate => candidate.properties?.isRemainder === true);
      if (unassigned) {
        unassigned.geometry = normalizeClippedLandGeometry(window.polygonClipping.union(unassigned.geometry.coordinates, feature.geometry.coordinates));
        for (const entry of state.distributionEntries) if (entry.mode === DISTRIBUTION_MODES.TERRITORIAL && String(entry.territorialUnitId) === String(feature.id)) entry.territorialUnitId = String(unassigned.id);
        state.territorialRelations = state.territorialRelations
          .filter(relation => String(relation.unitId) !== String(feature.id))
          .map(relation => String(relation.parentId) === String(feature.id) ? { ...relation, parentId: String(unassigned.id) } : relation);
        state.territorialUnits = state.territorialUnits.filter(candidate => String(candidate.id) !== String(feature.id));
        applyTerritorialUnitSelectionIntent(unassigned.id, true);
      } else {
        feature.properties.isRemainder = true;
        feature.properties.name = '';
        feature.properties.notes = '';
        setTerritorialStyleColor(feature, '');
        applyTerritorialUnitSelectionIntent(feature.id, true);
      }
    }
    if (countryId) reconcileTerritorialUnitCompleteness([countryId]);
    state.territorialUnits = normalizeTerritorialUnits(state.territorialUnits, { countryExists: key => !!countryFeatureById(key) });
    markLayerTreeDirty();
    renderingDomain?.invalidateTerritorialPatch?.('territorial-unit-deleted');
    projectDomain.queueAutosave();
    setActionStatus(`${territorialTypeLabel(feature.properties.unitType)} 구분을 안전하게 해제했습니다.`, 'success', 3600);
    return true;
  }

  function requestExplicitTerritorialUnitDelete(feature) {
    const children = territorialChildren(state.territorialUnits, feature.id);
    if (children.length) {
      setActionStatus(`하위 영역 ${children.length}개를 먼저 다른 부모로 옮기거나 삭제해야 합니다.`, 'error', 4200);
      return false;
    }
    openConfirmModal({
      title: '지방 삭제',
      message: `${territorialUnitName(feature)}을(를) 프로젝트에서 삭제합니다. 국가나 다른 영역의 형상은 변경하지 않습니다.`,
      impacts: ['지방 1개 삭제', '국가 및 다른 영역 형상 변경 없음'],
      confirmText: '지방 삭제',
      danger: true,
      onConfirm: () => {
        projectDomain.recordHistory();
        state.territorialUnits = state.territorialUnits.filter(candidate => String(candidate.id) !== String(feature.id));
        state.territorialRelations = state.territorialRelations.filter(relation => String(relation.unitId) !== String(feature.id) && String(relation.parentId) !== String(feature.id));
        state.distributionEntries = state.distributionEntries.filter(entry => entry.mode !== DISTRIBUTION_MODES.TERRITORIAL || String(entry.territorialUnitId) !== String(feature.id));
        markLayerTreeDirty();
        if ((state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && String(state.selected.id) === String(feature.id)) selectionUiController.clear({ reason: 'territorial-delete-selection-clear' });
        else renderingDomain?.invalidateTerritorialPatch?.('territorial-unit-deleted');
        projectDomain.queueAutosave();
        setActionStatus(`${territorialUnitName(feature)} 지방을 삭제했습니다.`, 'success');
      },
    });
    return true;
  }

  function requestTerritorialUnitDivisionRemoval(id) {
    const feature = territorialUnitById(id);
    if (!feature) return;
    if (feature.properties?.locked) {
      setActionStatus('잠금을 해제한 뒤 영역을 삭제할 수 있습니다.', 'error', 3200);
      return;
    }
    if (feature.properties?.coverageMode === TERRITORIAL_COVERAGE_MODES.EXPLICIT) {
      requestExplicitTerritorialUnitDelete(feature);
      return;
    }
    const children = territorialChildren(state.territorialUnits, feature.id);
    if (children.length) {
      setActionStatus(`하위 행정구역 ${children.length}개가 있어 구분을 해제할 수 없습니다.`, 'error', 4200);
      return;
    }
    const label = territorialTypeLabel(feature.properties?.unitType);
    const siblings = territorialSiblings(state.territorialUnits, feature);
    const groupIds = new Set([feature, ...siblings].map(candidate => String(candidate.id)));
    const groupHasChildren = state.territorialUnits.some(candidate => groupIds.has(String(candidate.properties?.parentId || '')));
    const choices = [];
    if (siblings.length && feature.properties?.isRemainder !== true) {
      choices.push({ value: 'unassigned', label: '미지정 영역으로 전환' });
    }
    for (const sibling of siblings.filter(candidate => candidate.properties?.isRemainder !== true && territorialUnitsAreAdjacent(feature, candidate))) {
      choices.push({ value: `merge:${sibling.id}`, label: `${territorialUnitName(sibling)}에 합치기` });
    }
    if (siblings.length && !groupHasChildren) choices.push({ value: 'clear-all', label: '이 단계의 영역 구분 전체 해제' });
    if (siblings.length && !choices.length) {
      setActionStatus('이 영역은 인접 형제에 합치거나 하위 행정구역을 정리한 뒤 구분 해제할 수 있습니다.', 'error', 4400);
      return;
    }
    openConfirmModal({
      title: `${label} 구분 해제`,
      message: siblings.length
        ? `${territorialUnitName(feature)}을(를) 제거한 뒤에도 부모 면적이 완전히 유지되도록 처리 방식을 선택하세요.`
        : `${territorialUnitName(feature)}의 유일한 구분을 해제하고 암시적 전체 국토 상태로 돌아갑니다.`,
      confirmText: '구분 해제',
      danger: true,
      choices,
      onConfirm: action => performTerritorialUnitDivisionRemoval(feature.id, action),
    });
  }

  function deleteTerritorialUnit(type, id) {
    if (type === TERRITORIAL_UNIT_TYPES.COUNTRY) {
      requestDeleteCountry(id);
      return true;
    }
    const feature = territorialUnitById(id);
    if (!feature || feature.properties?.unitType !== type) return false;
    if (territorialChildren(state.territorialUnits, feature.id).length) {
      setActionStatus('하위 영역을 먼저 다른 부모로 옮기거나 삭제해야 합니다.', 'error', 4200);
      return false;
    }
    requestTerritorialUnitDivisionRemoval(id);
    return true;
  }

  function deleteSelected() {
    if (!requireCanonicalData()) return;
    if (!state.selected) {
      setActionStatus('삭제할 객체가 없습니다. 지도에서 객체를 먼저 선택하세요.', 'error');
      return;
    }
    if ((state.selected.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) {
      deleteTerritorialUnit(TERRITORIAL_UNIT_TYPES.COUNTRY, state.selected.id);
      return;
    }
    if (state.selected.domain === 'hydro') {
      const feature = hydroFeatureById(state.selected.id);
      const category = hydroCategoryLabel(feature?.properties?.category);
      if (hydroEditById(state.selected.id)) removeHydroEditById(state.selected.id, `선택한 ${hydroAccusativeLabel(feature?.properties?.category)} 삭제했습니다.`);
      else setActionStatus(`내장 ${category}는 삭제할 수 없습니다. 편집용 복사본을 만들어 수정하세요.`, 'error', 3400);
      return;
    }
    if (state.selected.domain === 'generic') {
      removeGenericFeatureById(state.selected.id, '선택한 객체를 삭제했습니다.');
    } else if (state.selected.domain === 'distribution') {
      deleteDistributionLayer(state.selected.id, { confirm: false });
    } else if ((state.selected.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY)) {
      deleteTerritorialUnit(state.selected.type, state.selected.id);
    } else if (state.selected.domain === 'label') {
      removeLabelById(state.selected.id, '선택한 객체를 삭제했습니다.');
    }
  }

  function zoomBy(factor, announce = true) {
    const current = state.projection === 'globe' ? state.view.globeZoom : state.view.flatZoom;
    const next = current * factor;
    if (!setMapZoomValue(next)) return false;
    renderingDomain?.endInteraction?.('zoom-control-settle');
    projectDomain.queueViewAutosave();
    return true;
  }

  function currentObjectFitInsets() {
    return { ...projectionLayoutMetrics().fitInsets };
  }

  function focusCountry(feature, { announce = false, maxZoom = null, preferredAnchor = null } = {}) {
    if (!feature?.geometry && feature?.type !== 'FeatureCollection') return;
    const geometryCenter = d3.geo.centroid(feature);
    const anchor = validLabelAnchor(preferredAnchor) ? preferredAnchor.map(Number) : geometryCenter;
    if (!validLabelAnchor(anchor)) return;
    const { width, height } = state.size;
    const mobile = isMobile();
    const safe = currentObjectFitInsets();
    const contentWidth = Math.max(96, width - safe.left - safe.right);
    const contentHeight = Math.max(96, height - safe.top - safe.bottom);
    if (state.projection === 'globe') {
      state.view.globeRotation = [-anchor[0], -anchor[1], 0];
      state.view.globeZoom = 1;
    } else {
      state.view.flatCenter = [anchor[0], anchor[1]];
      state.view.flatZoom = 1;
    }
    updateProjection();
    let bounds;
    try { bounds = path.bounds(feature); } catch (_) { bounds = null; }
    if (bounds && bounds[0] && bounds[1]) {
      const bw = Math.max(1, Math.abs(bounds[1][0] - bounds[0][0]));
      const bh = Math.max(1, Math.abs(bounds[1][1] - bounds[0][1]));
      const targetW = contentWidth * 0.82;
      const targetH = contentHeight * 0.82;
      const fitted = Math.min(targetW / bw, targetH / bh) * 0.88;
      if (state.projection === 'globe') {
        state.view.globeZoom = clamp(fitted, 1.25, Math.min(ZOOM_LIMITS.globe.max, maxZoom || (mobile ? 9.5 : 8)));
      } else {
        state.view.flatZoom = clamp(fitted, 1.25, Math.min(ZOOM_LIMITS.flat.max, maxZoom || (mobile ? 16 : 13)));
      }
    } else if (state.projection === 'globe') {
      state.view.globeZoom = 3.2;
    } else {
      state.view.flatZoom = 5;
    }
    updateProjection();
    // Object focus is centered on the actual map viewport. Insets constrain the
    // fitted zoom only; transient panels must not permanently offset the camera.
    const viewportCenter = [width / 2, height / 2];
    // Always align the stable geographic anchor. Projected-bounds panning can
    // diverge on a globe while label anchors are still loading, which used to
    // move a focused European country to the opposite hemisphere.
    alignGeographicAnchor(anchor, viewportCenter);
    syncMapHostFromState();
    renderingDomain?.invalidateView?.('focus-country');
    projectDomain.queueViewAutosave();
  }

  function focusCoordinate(coord, zoom = null) {
    if (!validLabelAnchor(coord)) return;
    if (state.projection === 'globe') {
      state.view.globeRotation = [-Number(coord[0]), -Number(coord[1]), 0];
      state.view.globeZoom = clamp(zoom || Math.max(4.5, state.view.globeZoom), ZOOM_LIMITS.globe.min, ZOOM_LIMITS.globe.max);
    } else {
      state.view.flatCenter = [Number(coord[0]), Number(coord[1])];
      state.view.flatZoom = clamp(zoom || Math.max(6, state.view.flatZoom), ZOOM_LIMITS.flat.min, ZOOM_LIMITS.flat.max);
    }
    syncMapHostFromState();
    renderingDomain?.invalidateView?.('focus-coordinate');
    projectDomain.queueViewAutosave();
  }

  function selectLayerTreeItem(group, id, { mode = 'replace', range = false, orderedRefs = [] } = {}) {
    const key = String(id);
    if (group === 'hydro' && HYDRO_LAYER_META[key]) {
        if (!state.hydroManifest) loadHydroData(true);
        else {
          const cacheState = state.physicalLoadState.hydroCache;
          if (cacheState === 'error') {
            gpuMapRenderer.retryHydroCache?.();
            setActionStatus('전 세계 강·호수 자료의 오프라인 저장을 다시 시도합니다.', 'working', 0);
          } else {
            const suffix = cacheState === 'ready' ? '오프라인에서도 바로 사용할 수 있습니다.' : `전 세계 강·호수 자료를 백그라운드에서 준비하고 있습니다. ${Math.round(state.physicalLoadState.hydroCachePercent || 0)}%`;
            setActionStatus(suffix, 'success', 3200);
          }
        }
        return false;
    }
    const ref = layerItemObjectRef(group, key);
    if (!ref || !objectRefExists(ref)) return false;
    return selectionUiController.applyIntent(ref, { mode: range ? 'range' : mode, orderedRefs, scope: 'layer-list' });
  }

  function resetView() {
    if (state.projection === 'globe') {
      state.view.globeZoom = 1;
    } else {
      state.view.flatZoom = 1;
    }
    syncMapHostFromState();
    renderingDomain?.endInteraction?.('world-view-settle');
    projectDomain.queueViewAutosave();
  }

  function bindHoldZoom(button, factor) {
    if (!button) return;
    let timer = null;
    let repeater = null;
    let repeated = false;
    let suppressNextClick = false;
    const clear = () => {
      clearTimeout(timer); clearInterval(repeater); timer = repeater = null;
      if (repeated) {
        projectDomain.queueViewAutosave();
        suppressNextClick = true;
      }
      repeated = false;
    };
    button.addEventListener('pointerdown', event => {
      repeated = false;
      suppressNextClick = false;
      if (event.button !== 0) return;
      button.setPointerCapture?.(event.pointerId);
      timer = setTimeout(() => {
        repeated = true;
        zoomBy(factor, false);
        repeater = setInterval(() => zoomBy(factor, false), 115);
      }, 360);
    });
    button.addEventListener('pointerup', clear);
    button.addEventListener('pointercancel', clear);
    button.addEventListener('lostpointercapture', clear);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
    button.addEventListener('click', event => {
      if (suppressNextClick) {
        suppressNextClick = false;
        event.preventDefault();
        return;
      }
      zoomBy(factor, true);
      if (navigator.vibrate && isMobile()) navigator.vibrate(6);
    });
  }

  function bindSurfaceTabs() {
    mapSurfaceTabs = createSurfaceTabsController({
      tablist: $('mapPanelTabs'),
      onSelect: (key, options) => setMapPanelView(key, options),
    });
    createSurfaceTabs = createSurfaceTabsController({
      tablist: document.querySelector('#createMenu .surface-tabs'),
      onSelect: (key, options) => syncCreateMenuRoute(key, options),
    });
    editorSurfaceTabs = createSurfaceTabsController({
      tablist: document.querySelector('.editor-view-tabs'),
      onSelect: (key, options) => setEditorShellView(key, options),
    });
    mapSurfaceTabs.bind();
    createSurfaceTabs.bind();
    editorSurfaceTabs.bind();
    setMapPanelView(mapPanelView);
    syncCreateMenuRoute(createMenuRoute);
    setEditorShellView('info');
  }

  function bindNavigationUI() {
    bindSurfaceTabs();
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('#notificationCloseBtn')) clearErrorNotification();
    }, true);
    document.addEventListener('click', e => {
      if (!e.target.closest('.top-actions') && !e.target.closest('#mobileFileBtn')) {
        closeFileMenu();
      }
      if (!e.target.closest('#objectActionsMenu') && !e.target.closest('[data-layer-item-menu]')) closeObjectActionsMenu();
      if (!e.target.closest('#objectChooser')) closeObjectChooser();
    });
    $('objectChooserCloseBtn')?.addEventListener('click', () => closeObjectChooser({ restoreFocus: true }));
    $('objectChooserList')?.addEventListener('click', event => {
      const button = event.target.closest('[data-object-chooser-index]');
      const ref = button ? objectChooserCandidates[Number(button.dataset.objectChooserIndex)] : null;
      if (!ref) return;
      selectionUiController.applyIntent(ref, { mode: event.ctrlKey || event.metaKey || state.addSelectionMode ? 'toggle' : 'replace', scope: 'map' });
    });
    $('objectChooserList')?.addEventListener('keydown', event => {
      const items = [...event.currentTarget.querySelectorAll('[data-object-chooser-index]')];
      const current = items.indexOf(document.activeElement);
      const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      if (!delta) return;
      event.preventDefault();
      items[(current + delta + items.length) % items.length]?.focus();
    });

    $('globeBtn').addEventListener('click', () => setProjection('globe'));
    $('flatBtn').addEventListener('click', () => setProjection('flat'));

    $('mobileFileBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      toggleFileMenu();
    });
    $('notificationCloseBtn')?.addEventListener('click', clearNotification);
    $('createMenuBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      toggleCreateMenu(event.currentTarget);
    });
    $('mobileBackdrop')?.addEventListener('click', () => {
      closeFileMenu({ restoreFocus: true });
    });
    Object.values(MOBILE_SHEET_IDS).forEach(id => bindMobileSheetSurface($(id)));
    $('mobileMapBtn')?.addEventListener('click', event => toggleSurface('layers', event.currentTarget));
    $('mobileEditBtn')?.addEventListener('click', event => toggleSurface('editor', event.currentTarget));
    $('mobileCloseLeftBtn')?.addEventListener('click', () => closeSurface('layers', { restoreFocus: true }));
    $('mobileCloseRightBtn')?.addEventListener('click', () => {
      closeSurface('editor', { manual: layoutMode === 'wide', restoreFocus: true });
    });
    $('mobileCloseCreateBtn')?.addEventListener('click', () => closeCreateMenu({ restoreFocus: true }));
    $('createMenu')?.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.target.closest('.surface-tabs')) return;
      const items = activeCreateMenuItems();
      const index = items.indexOf(document.activeElement);
      let nextIndex;
      if (event.key === 'ArrowDown') nextIndex = (index + 1 + items.length) % items.length;
      else if (event.key === 'ArrowUp') nextIndex = (index - 1 + items.length) % items.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = items.length - 1;
      else return;
      event.preventDefault();
      items[nextIndex]?.focus();
    });

  }

  function bindLayerUI() {
    layerTreeController = createAppLayerTreeController({
      window, document, getElement: $, state, layerSearchGroupKeys: LAYER_SEARCH_GROUP_KEYS,
      builtinCountryIds: () => builtinCountryIds, builtinSession: () => state.sessionBaseCountriesJson == null,
      setBundleVisibility: setLayerItemsVisibility,
      layerGroupNames, createIcon: (name, className) => createSemanticIcon(document, name, className),
      createEmptyState, layerTreeItems, layerItemObjectRef, normalizeObjectRef, selectionDomain,
      isLayerItemVisible: isLayerListItemVisible, objectRefLocked, hydroCategoryKey,
      compareItems: (left, right) => layerNameCollator.compare(left.name, right.name) || layerNameCollator.compare(left.id, right.id),
      pruneLayerItemVisibility, syncCanonicalControls, syncSearchClearButton,
      setLayerVisibility, toggleLayerStylePanel, updateLayerPresentationStyle, distributionService,
      syncDistributionPresentationControls, renderingDomain: () => renderingDomain,
      queuePresentationAutosave: (...args) => projectDomain.queuePresentationAutosave(...args), gpuMapRenderer, syncPhysicalControls, markLayerTreeDirty,
      clamp, syncRangeProgress, setActionStatus, selectLayerTreeItem, openObjectActionsMenu,
      isMobile, returnToMapAfterMobileAction, closeObjectActionsMenu,
      syncLayerVisibilityToggle, setLayerItemVisibility, batchToggleLocked, deleteSelectedFromObjectMenu,
    });
    layerTreeController.bind();
  }

  function bindToolUI() {
    $('addCountryBtn')?.addEventListener('click', () => {
      requestDraftDiscard(() => returnToMapAfterMobileAction(enterNewCountryMode(), { fromCreate: true }));
    });
    $('addTerritoryBtn')?.addEventListener('click', () => {
      openTerritorialCreateModal(TERRITORIAL_UNIT_TYPES.TERRITORY);
    });
    $('addAdministrativeBtn')?.addEventListener('click', () => {
      openTerritorialCreateModal(TERRITORIAL_UNIT_TYPES.ADMIN);
    });
    $('addRegionBtn')?.addEventListener('click', () => {
      openTerritorialCreateModal(TERRITORIAL_UNIT_TYPES.REGION);
    });
    const closeDistributionTypeModal = () => {
      $('distributionTypeModal')?.classList.add('hidden');
      $('addDistributionBtn')?.focus();
    };
    $('addDistributionBtn')?.addEventListener('click', () => {
      $('distributionTypeModal')?.classList.remove('hidden');
      requestAnimationFrame(() => $('distributionTypeInput')?.focus());
    });
    $('distributionTypeCancelBtn')?.addEventListener('click', closeDistributionTypeModal);
    $('distributionTypeModal')?.querySelector('.confirm-modal-dim')?.addEventListener('click', closeDistributionTypeModal);
    $('distributionTypeConfirmBtn')?.addEventListener('click', () => {
      const type = $('distributionTypeInput')?.value || DISTRIBUTION_TYPES.LANGUAGE;
      closeDistributionTypeModal();
      requestDraftDiscard(() => {
        discardActiveDraftSilently();
        const created = createDistributionLayerFromPrompt(type);
        if (!created) return;
        closeCreateMenu();
        if (layoutMode !== 'wide') openSurface('editor');
      });
    });
    $('territorialCreateCancelBtn')?.addEventListener('click', closeTerritorialCreateModal);
    $('territorialCreateModal')?.querySelector('.confirm-modal-dim')?.addEventListener('click', closeTerritorialCreateModal);
    $('territorialCreateConfirmBtn')?.addEventListener('click', () => {
      const unitType = pendingTerritorialCreateType;
      const method = $('territorialCreateMethod').value;
      closeTerritorialCreateModal();
      if (!unitType) return;
      if (method === 'geojson') {
        requestDraftDiscard(() => {
          discardActiveDraftSilently();
          const target = unitType === TERRITORIAL_UNIT_TYPES.ADMIN
            ? 'administrative'
            : unitType === TERRITORIAL_UNIT_TYPES.REGION
              ? 'region'
              : 'territory';
          const trigger = $(unitType === TERRITORIAL_UNIT_TYPES.ADMIN
            ? 'addAdministrativeBtn'
            : unitType === TERRITORIAL_UNIT_TYPES.REGION
              ? 'addRegionBtn'
              : 'addTerritoryBtn');
          void getGisFileController().then(controller => controller.openPicker({ target, trigger }));
        });
        return;
      }
      requestDraftDiscard(() => {
        const started = method === 'draw' ? enterTerritorialUnitDirectCreate(unitType) : startTerritorialUnitCreate(unitType);
        returnToMapAfterMobileAction(started, { fromCreate: true });
      });
    });
    $('addLabelBtn')?.addEventListener('click', () => {
      requestDraftDiscard(() => returnToMapAfterMobileAction(enterLabelMode(), { fromCreate: true }));
    });
    $('addRiverBtn')?.addEventListener('click', () => {
      requestDraftDiscard(() => returnToMapAfterMobileAction(enterTerrainGenericFeatureMode('river'), { fromCreate: true }));
    });
    $('addLakeBtn')?.addEventListener('click', () => {
      requestDraftDiscard(() => returnToMapAfterMobileAction(enterTerrainGenericFeatureMode('lake'), { fromCreate: true }));
    });
    $('modePrimaryBtn')?.addEventListener('click', () => { void runModePrimaryAction(); });
    $('modeTaskMinimizeBtn')?.addEventListener('click', toggleMapTaskWindow);
    $('modeTaskCloseBtn')?.addEventListener('click', () => $('modeCancelBtn')?.click());
    $('modeLineMethodBtn')?.addEventListener('click', () => requestDraftDiscard(() => switchTerritorySelectionMethod('line')));
    $('modePolygonMethodBtn')?.addEventListener('click', () => requestDraftDiscard(() => switchTerritorySelectionMethod('polygon')));
    $('modeComponentsMethodBtn')?.addEventListener('click', () => requestDraftDiscard(() => switchTerritorySelectionMethod('components')));
    $('modeRiverBoundaryInput')?.addEventListener('change', event => toggleAnnexRiverBoundaries(event.currentTarget.checked));
    $('modeDraftRedrawBtn')?.addEventListener('click', () => editingDomain?.redrawDraft?.());
    $('modeDraftRemoveLastBtn')?.addEventListener('click', () => editingDomain?.removeLastDraftPoint());
    $('modeDraftDeleteBtn')?.addEventListener('click', () => editingDomain?.deleteSelectedDraftPoint());
    $('modeCancelBtn')?.addEventListener('click', () => {
      requestDraftDiscard(() => {
        if (state.geometryPreview.session) discardActiveGeometryPreview();
        else if (state.labelPlacementMode || state.tool === 'label') exitLabelMode();
        else if (isGenericFeatureDraftTool(state.tool)) cancelDraft(true);
        else cancelActiveMode();
      });
    });
    $('annexTerritoryBtn')?.addEventListener('click', () => {
      if (!(state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
      requestDraftDiscard(() => {
        if (state.tool === 'annex-territory' && state.annexTargetCountryId === state.selected.id) cancelActiveMode();
        else returnToMapAfterMobileAction(enterAnnexTerritoryMode(state.selected.id));
      });
    });
    $('editBorderBtn')?.addEventListener('click', () => {
      if (!(state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
      requestDraftDiscard(() => {
        if (state.tool === 'country-border' && state.boundaryEditPhase === 'editing') finishCountryBorderEdit();
        else returnToMapAfterMobileAction(enterCountryBorderSelection(state.selected.id));
      });
    });
    $('editCoastBtn')?.addEventListener('click', () => {
      if (!(state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
      requestDraftDiscard(() => {
        if (state.tool === 'country-coast' && state.coastEditCountryId === state.selected.id) finishCountryCoastEdit();
        else returnToMapAfterMobileAction(enterCountryCoastEdit(state.selected.id));
      });
    });
    $('mergeCountryBtn')?.addEventListener('click', () => {
      if ((state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) requestDraftDiscard(() => returnToMapAfterMobileAction(enterMergeCountryMode(state.selected.id)));
    });
    bindHoldZoom($('zoomInBtn'), 1.25);
    bindHoldZoom($('zoomOutBtn'), 0.8);
    $('resetViewBtn').addEventListener('click', resetView);
  }


  function bindFileAndGisUI() {
    $('addFromLibraryBtn')?.addEventListener('click', async () => {
      try {
        const controller = await getHistoricalLibraryController();
        await controller.open();
      } catch (error) {
        reportOperationError(error, '국가·지역 라이브러리를 불러오지 못했습니다.', 'PL-LIB-001', 4800);
      }
    });
    $('saveProjectBtn').addEventListener('click', () => {
      void getGisFileController().then(controller => controller.saveProject());
    });
    $('openGisBtn').addEventListener('click', event => {
      void getGisFileController().then(controller => controller.openPicker({ trigger: event.currentTarget }));
    });

    $('newProjectBtn').addEventListener('click', (...args) => projectUi.requestNew(...args));
    $('dataExportBtn').addEventListener('click', () => {
      void getGisExportController()
        .then(controller => controller.open())
        .catch(error => reportOperationError(error, 'GIS 내보내기 도구를 불러오지 못했습니다.', 'PL-GIS-LAZY-002', 4200));
    });
    const preferencesModal = $('preferencesModal');
    let preferencesOrigin = null;
    let accentPreviewFrame = 0;
    let pendingAccent;
    const syncPreferencesForm = () => {
      $('preferencesThemeInput').value = userPreferences.appearance.theme;
      const accent = userPreferences.appearance.accentColor;
      const input = document.getElementById('preferencesAccentInput');
      input.value = accent || resolvedAccentColor;
      document.getElementById('preferencesAccentValue').textContent = accent || `기본 · ${resolvedAccentColor}`;
      document.getElementById('preferencesAccentPreview').style.backgroundColor = accent || resolvedAccentColor;
      preferencesModal.querySelectorAll('[data-preference-accent]').forEach(button => {
        button.setAttribute('aria-pressed', String((button.dataset.preferenceAccent || null) === accent));
      });
    };
    const preferencesFromForm = () => ({
      ...userPreferences,
      appearance: { ...userPreferences.appearance, theme: $('preferencesThemeInput').value },
    });
    const applyPreferencesForm = () => {
      applyUserPreferences(preferencesFromForm(), { persist: false });
      syncPreferencesForm();
    };
    const flushAccentPreview = () => {
      if (accentPreviewFrame) cancelAnimationFrame(accentPreviewFrame);
      accentPreviewFrame = 0;
      if (pendingAccent === undefined) return;
      const accentColor = pendingAccent; pendingAccent = undefined;
      applyUserPreferences({ ...userPreferences, appearance: { ...userPreferences.appearance, accentColor } }, { persist: false });
      syncPreferencesForm();
    };
    const previewAccent = value => {
      pendingAccent = value;
      if (!accentPreviewFrame) accentPreviewFrame = requestAnimationFrame(flushAccentPreview);
    };
    const closePreferences = ({ restoreFocus = true, revert = false } = {}) => {
      if (!preferencesModal || preferencesModal.classList.contains('hidden')) return;
      if (revert) {
        if (accentPreviewFrame) cancelAnimationFrame(accentPreviewFrame);
        accentPreviewFrame = 0; pendingAccent = undefined;
        if (preferencesOrigin) applyUserPreferences({ ...userPreferences, appearance: preferencesOrigin }, { persist: false });
      } else {
        flushAccentPreview();
        userPreferences = saveUserPreferences(userPreferences);
      }
      preferencesOrigin = null;
      preferencesModal.classList.add('hidden');
      if (restoreFocus) $('preferencesBtn')?.focus({ preventScroll: true });
    };
    const openPreferences = () => {
      syncPreferencesForm();
      preferencesOrigin = { ...userPreferences.appearance };
      preferencesModal?.classList.remove('hidden');
      $('preferencesThemeInput')?.focus({ preventScroll: true });
    };
    $('preferencesBtn')?.addEventListener('click', openPreferences);
    $('preferencesCloseBtn')?.addEventListener('click', () => closePreferences({ revert: true }));
    $('preferencesCancelBtn')?.addEventListener('click', () => closePreferences({ revert: true }));
    preferencesModal?.querySelector('.ui-dialog-backdrop')?.addEventListener('click', () => closePreferences({ revert: true }));
    $('preferencesResetBtn')?.addEventListener('click', () => {
      pendingAccent = undefined;
      if (accentPreviewFrame) cancelAnimationFrame(accentPreviewFrame);
      accentPreviewFrame = 0;
      applyUserPreferences({ ...userPreferences, appearance: defaultUserPreferences().appearance }, { persist: false });
      syncPreferencesForm();
    });
    preferencesModal.querySelectorAll('[data-preference-accent]').forEach(button => {
      button.addEventListener('click', () => previewAccent(button.dataset.preferenceAccent || null));
    });
    document.getElementById('preferencesAccentInput').addEventListener('input', event => previewAccent(event.target.value.toLowerCase()));
    document.getElementById('preferencesAccentCustomBtn').addEventListener('click', () => {
      const input = document.getElementById('preferencesAccentInput');
      if (input.showPicker) input.showPicker(); else input.click();
    });
    $('preferencesThemeInput')?.addEventListener('change', applyPreferencesForm);
    $('preferencesApplyBtn')?.addEventListener('click', () => closePreferences({ revert: false }));
    const fileMenu = document.querySelector('.top-actions');
    const visibleFileMenuItems = () => [...(fileMenu?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])]
      .filter(item => !item.closest('.hidden'));
    fileMenu?.addEventListener('keydown', event => {
      const active = document.activeElement;
      if (event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        closeFileMenu({ restoreFocus: true });
        return;
      }
      const items = visibleFileMenuItems();
      if (!items.length) return;
      let targetIndex = -1;
      const currentIndex = items.indexOf(active);
      if (event.key === 'ArrowDown') targetIndex = (currentIndex + 1 + items.length) % items.length;
      else if (event.key === 'ArrowUp') targetIndex = (currentIndex - 1 + items.length) % items.length;
      else if (event.key === 'Home') targetIndex = 0;
      else if (event.key === 'End') targetIndex = items.length - 1;
      if (targetIndex < 0) return;
      event.preventDefault();
      items[targetIndex]?.focus();
    });
    fileMenu?.addEventListener('click', e => {
      const button = e.target.closest('button');
      if (!button) return;
      setTimeout(() => {
        closeFileMenu();
      }, 80);
    });
    document.addEventListener('pandolab:restore-file-menu-focus', event => {
      const target = document.getElementById(String(event.detail?.targetId || ''));
      if (layoutMode === 'wide' || !target || !fileMenu?.contains(target)) return;
      event.preventDefault();
      requestAnimationFrame(() => {
        fileMenuTrigger = $('mobileFileBtn');
        fileMenu.classList.add('mobile-open');
        syncOverlayState();
        requestAnimationFrame(() => target.focus({ preventScroll: true }));
      });
    });

  }

  function bindGlobalInputUI() {
    document.addEventListener('keydown', e => {
      const tag = document.activeElement?.tagName;
      const editingText = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || document.activeElement?.isContentEditable;
      if (e.code === 'Space' && !editingText && (editingDomain?.draftInputActive?.() || ['country-border', 'country-coast'].includes(state.tool) || state.selected?.domain === 'generic' || (state.selected?.domain === 'hydro' && hydroEditById(state.selected.id)))) {
        state.spacePanActive = true;
        mapInteractionGate.setForcedPan(true);
        mapHost?.setForcedPan?.(true);
        $('map')?.classList.add('space-pan-active');
        editingDomain?.clearDraftHover?.('space-pan');
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        if (state.modeProcessing) { e.preventDefault(); return; }
        if (!$('preferencesModal')?.classList.contains('hidden')) { $('preferencesCancelBtn')?.click(); return; }
        if (!$('objectChooser')?.classList.contains('hidden')) { closeObjectChooser({ restoreFocus: true }); return; }
        if (!$('objectActionsMenu')?.classList.contains('hidden')) { closeObjectActionsMenu({ restoreFocus: true }); return; }
        if (historicalLibraryController?.isOpen()) { historicalLibraryController.close(); return; }
        if (!$('territorialTypeModal')?.classList.contains('hidden')) { closeTerritorialTypeModal(); return; }
        if (!$('distributionTypeModal')?.classList.contains('hidden')) { $('distributionTypeCancelBtn')?.click(); return; }
        if (!$('territorialCreateModal')?.classList.contains('hidden')) { closeTerritorialCreateModal(); return; }
        if (!$('gisImportModal')?.classList.contains('hidden')) { $('gisImportCancelBtn')?.click(); return; }
        if (!$('gisExportModal')?.classList.contains('hidden')) { gisExportController?.close(); return; }
        if (confirmModalController?.isOpen()) { closeConfirmModal(); return; }
        if (document.body.classList.contains('file-menu-open')) { closeFileMenu({ restoreFocus: true }); return; }
        if (isCreateMenuOpen()) { closeCreateMenu({ restoreFocus: true }); return; }
        if (state.geometryPreview.session) { discardActiveGeometryPreview(); return; }
        if (state.labelPlacementMode) exitLabelMode();
        else if (editingDomain?.draftInputActive?.()) requestDraftDiscard(() => isGenericFeatureDraftTool(state.tool) ? cancelDraft(true) : cancelActiveMode());
        else if (['new-country', 'annex-territory', 'merge-country', 'merge-generic-feature', 'country-border', 'country-coast'].includes(state.tool)) cancelActiveMode();
        else if (editingDraftCoordinates().length) cancelDraft(true);
        else if ($('rightPanel')?.classList.contains('mobile-open')) {
          closeSurface('editor', { manual: layoutMode === 'wide', restoreFocus: true });
        }
        else if (layoutMode !== 'wide' && $('leftPanel')?.classList.contains('mobile-open')) closeSurface('layers', { restoreFocus: true });
        else if (!$('actionStatus')?.classList.contains('hidden')) clearNotification();
        else selectionUiController.clear({ reason: 'escape-selection-clear' });
      }
      const newCountryLineMode = state.tool === 'new-country' && state.newCountryPhase === 'line';
      const newCountrySourceMode = state.tool === 'new-country' && state.newCountryPhase === 'sources';
      const newCountrySideMode = state.tool === 'new-country' && state.newCountryPhase === 'side';
      const newCountryComponentsMode = state.tool === 'new-country' && state.newCountryPhase === 'components';
      const annexDonorMode = state.tool === 'annex-territory' && state.annexPhase === 'donor';
      const annexSideMode = state.tool === 'annex-territory' && state.annexPhase === 'side';
      const annexPolygonPreviewMode = state.tool === 'annex-territory' && state.annexPhase === 'polygon-preview';
      const annexComponentsMode = state.tool === 'annex-territory' && state.annexPhase === 'components';
      const mergeTargetMode = state.tool === 'merge-country' && !!state.mergeSourceCountryId;
      const boundarySelectMode = state.tool === 'country-border' && state.boundaryEditPhase === 'selecting';
      if (e.key === 'Enter' && !editingText && state.geometryPreview.session) {
        e.preventDefault();
        applyActiveGeometryPreview();
        return;
      }
      if (e.key === 'Enter' && !editingText && (newCountrySourceMode || annexDonorMode || mergeTargetMode || boundarySelectMode)) {
        e.preventDefault();
        if (newCountrySourceMode) beginNewCountryLine();
        else if (annexDonorMode) beginAnnexSelection();
        else if (mergeTargetMode) completeCountryMerge();
        else beginCountryBorderEditing();
        return;
      }
      if (e.key === 'Enter' && !editingText && (newCountrySideMode || annexSideMode || annexPolygonPreviewMode || newCountryComponentsMode || annexComponentsMode)) {
        e.preventDefault();
        if (newCountrySideMode) completeNewCountryCreation(state.newCountrySelectedCandidateIndex);
        else if (newCountryComponentsMode) completeNewCountryCreation(null);
        else if (annexSideMode) completeLinearAnnexation(state.annexSelectedCandidateIndex);
        else if (annexPolygonPreviewMode) completeLinearAnnexation(0);
        else completeLinearAnnexation(null);
        return;
      }
      if (e.key === 'Enter' && !editingText && (isGenericFeatureDraftTool(state.tool) || newCountryLineMode || (state.tool === 'annex-territory' && ['line', 'polygon'].includes(state.annexPhase))) && editingDraftCoordinates().length) {
        e.preventDefault(); finishDraft();
      }
      if (!editingText && Number.isInteger(editingDraftSnapshot().selectedVertexIndex) && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && editingDomain?.draftInputActive?.()) {
        const distance = e.shiftKey ? 10 : 1;
        const offsets = {
          ArrowLeft: [-distance, 0],
          ArrowRight: [distance, 0],
          ArrowUp: [0, -distance],
          ArrowDown: [0, distance],
        };
        e.preventDefault();
        editingDomain?.moveSelectedDraftPointByPixels(...offsets[e.key]);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void getGisFileController().then(controller => controller.saveProject());
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !editingText) {
        e.preventDefault(); projectUi.undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) && !editingText) {
        e.preventDefault(); projectUi.redo();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !editingText) {
        if (editingDomain?.draftInputActive?.()) {
          e.preventDefault();
          editingDomain?.deleteSelectedDraftPoint();
          return;
        }
        if (state.selected) {
          e.preventDefault();
          if (selectionDomain.size() > 1) requestBatchDelete();
          else deleteSelected();
        }
      }
    });

    document.addEventListener('keyup', e => {
      if (e.code !== 'Space') return;
      state.spacePanActive = false;
      mapInteractionGate.setForcedPan(false);
      mapHost?.setForcedPan?.(false);
      $('map')?.classList.remove('space-pan-active');
    });
    window.addEventListener('blur', () => {
      mapInputController?.cancel?.();
      editingDomain?.cancelActiveGesture?.('window-blur');
      state.spacePanActive = false;
      mapInteractionGate.setForcedPan(false);
      mapHost?.setForcedPan?.(false);
      $('map')?.classList.remove('space-pan-active');
    });
    const clearAssistedPan = () => {
      state.spacePanActive = false;
      mapInteractionGate.setForcedPan(false);
      mapHost?.setForcedPan?.(false);
      $('map')?.classList.remove('space-pan-active');
    };
    $('map')?.addEventListener('pointercancel', () => { clearAssistedPan(); editingDomain?.cancelActiveGesture?.('pointercancel'); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { clearAssistedPan(); mapInputController?.cancel?.(); editingDomain?.cancelActiveGesture?.('document-hidden'); } });
    $('map')?.addEventListener('touchcancel', () => editingDomain?.cancelActiveGesture?.('touchcancel'), { passive: true });

    window.addEventListener('resize', () => {
      closeObjectActionsMenu();
      const layoutChanged = applyLayoutMode();
      if (!layoutChanged) {
        refreshMapSheetMetrics();
        if (!mapResizeObserver) queueMapResize('window-resize-fallback');
      }
    });
    window.addEventListener('orientationchange', () => {
      refreshMapSheetMetrics();
      queueMapResize('orientation-change');
    });
    window.visualViewport?.addEventListener?.('resize', closeObjectActionsMenu);
    const onSystemThemeChange = event => applySystemTheme(!!event.matches);
    if (typeof systemThemeQuery.addEventListener === 'function') systemThemeQuery.addEventListener('change', onSystemThemeChange);
    else if (typeof systemThemeQuery.addListener === 'function') systemThemeQuery.addListener(onSystemThemeChange);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        mapInputController?.cancel?.();
        editingDomain?.cancelActiveGesture?.('document-hidden');
        mapWorkScheduler.cancel('autosave');
        mapWorkScheduler.cancel('view-autosave');
        projectDomain.persistAutosave().catch(error => console.warn('Immediate autosave failed', error));
      }
    });
    window.addEventListener('beforeunload', () => {
      if (!canMutateProject(state.dataReadiness)) return;
      try { projectDomain.flushAutosave().catch(() => {}); } catch (_) {}
    });
    window.addEventListener('popstate', event => {
      if (ignoreNextMobileSheetPopstate) {
        ignoreNextMobileSheetPopstate = false;
        return;
      }
      if (isMobile() && surfaceController.activeMobileSheet) {
        const openSelect = document.querySelector('.ui-select-popover:not([hidden])');
        if (openSelect) {
          selectController.closeAll({ restoreFocus: true });
          trackMobileSheetHistory(surfaceController.activeMobileSheet);
          return;
        }
        const openPicker = document.querySelector('[data-color-picker].is-open');
        if (openPicker) {
          closeColorPicker(openPicker, { restoreFocus: true });
          trackMobileSheetHistory(surfaceController.activeMobileSheet);
          return;
        }
        closeActiveMobileSheet({ restoreFocus: true, syncHistory: false });
        return;
      }
      if (event.state?.[MOBILE_SHEET_HISTORY_KEY]) {
        const nextState = { ...event.state };
        delete nextState[MOBILE_SHEET_HISTORY_KEY];
        window.history.replaceState(nextState, '', window.location.href);
      }
    });
  }

  const EDITOR_COMMAND_ROW_ICONS = Object.freeze({
    multiBorderEditBtn: 'merge',
    annexTerritoryBtn: 'territory',
    mergeCountryBtn: 'merge',
    editBorderBtn: 'boundary',
    editCoastBtn: 'coastline',
    changeCountryTypeBtn: 'transform',
    reassignTerritoryShapeBtn: 'boundary',
    mergeTerritoryBtn: 'merge',
    splitTerritoryBtn: 'split',
    transferTerritoryBtn: 'transfer',
    changeTerritoryTypeBtn: 'transform',
    promoteTerritoryBtn: 'country',
    removeTerritoryDivisionBtn: 'close',
    reassignAdministrativeShapeBtn: 'boundary',
    reconcileAdministrativeCoastBtn: 'coastline',
    mergeAdministrativeBtn: 'merge',
    splitAdministrativeBtn: 'split',
    transferAdministrativeBtn: 'transfer',
    changeAdministrativeTypeBtn: 'transform',
    promoteAdministrativeBtn: 'country',
    removeAdministrativeDivisionBtn: 'close',
    reassignRegionShapeBtn: 'boundary',
    mergeRegionBtn: 'merge',
    transferRegionBtn: 'transfer',
  });

  function syncEditorCommandRows() {
    for (const [id, semanticName] of Object.entries(EDITOR_COMMAND_ROW_ICONS)) {
      const button = $(id);
      if (!button || button.querySelector(':scope > .command-row-icon')) continue;
      const trailingIcon = button.querySelector(':scope > .ui-icon:last-of-type');
      button.insertBefore(createSemanticIcon(document, semanticName, 'ui-icon command-row-icon'), button.firstChild);
      button.classList.add('has-command-row-icon');
      trailingIcon?.querySelector('use')?.setAttribute('href', '#icon-chevron-right');
    }
  }

  function bindUI() {
    syncEditorCommandRows();
    bindUiTooltips();
    bindNavigationUI();
    bindLayerUI();
    bindToolUI();
    propertyEditorUi.bind();
    bindFileAndGisUI();
    bindGlobalInputUI();
    syncSearchClearButton($('layerSearchInput'), $('layerSearchClearBtn'));
    syncSearchClearButton($('historicalLibrarySearchInput'), $('historicalLibrarySearchClearBtn'));
    syncColorPicker('multiProperties', { value: $('multiPropertiesColorInput')?.value, defaultColor: '#3f6fae', isDefault: false });
    projectUi.syncSaveStatus(saveState.snapshot());
  }

  function syncProjectControls() {
    $('countriesVisible').checked = state.layerVisibility.countries;
    $('territoriesVisible').checked = state.layerVisibility.territories !== false;
    $('administrativeVisible').checked = state.layerVisibility.administrative !== false;
    $('regionsVisible').checked = state.layerVisibility.regions !== false;
    $('languagesVisible').checked = state.layerVisibility.languages !== false;
    $('ethnicitiesVisible').checked = state.layerVisibility.ethnicities !== false;
    $('religionsVisible').checked = state.layerVisibility.religions !== false;
    $('riversVisible').checked = state.layerVisibility.rivers !== false;
    $('lakesVisible').checked = state.layerVisibility.lakes !== false;
    $('genericFeaturesVisible').checked = state.layerVisibility.genericFeatures;
    $('labelsVisible').checked = state.layerVisibility.labels;
    $('basemapLabelsVisible').checked = state.layerVisibility.basemapLabels;
    syncPhysicalControls();
    if ($('layerSearchInput')) $('layerSearchInput').value = state.layerSearch;
    layerTreeController?.render(true);
    syncProjectionButtons();
    syncCanonicalControls();
  }

  function handleGeometryProgress(event) {
    const detail = event.detail || {};
    state.geometryProgress = Number(detail.percent || 0);
    const metrics = window.__PANDOLAB_STARTUP_METRICS__;
    if (metrics) metrics.geometryProgress = { stage: detail.stage || '', percent: state.geometryProgress };
    if (canMutateProject(state.dataReadiness)) return;
    if (state.dataReadiness === DATA_READINESS.ERROR) applyDataReadinessEvent(READINESS_EVENTS.RETRY_GEOMETRY);
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = `빠른 미리보기 · 편집 데이터 ${Math.round(state.geometryProgress)}%`;
  }

  function handleMeshProgress(event) {
    const detail = event.detail || {};
    state.meshProgress = Number(detail.percent || 0);
    const metrics = window.__PANDOLAB_STARTUP_METRICS__;
    if (metrics) metrics.meshProgress = { stage: detail.stage || '', percent: state.meshProgress };
    if (!canMutateProject(state.dataReadiness) || state.dataReadiness === DATA_READINESS.ENHANCED) return;
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = `빠른 미리보기 · 고화질 지도 ${Math.round(state.meshProgress)}%`;
  }

  function handleGeometryError(event) {
    applyDataReadinessEvent(READINESS_EVENTS.GEOMETRY_ERROR);
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = '편집 데이터 오류 · 자동 재시도 중';
  }

  function handleMeshError(event) {
    if (!canMutateProject(state.dataReadiness)) return;
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = '고화질 지도 오류 · 자동 재시도 중';
  }

  async function completeGeometryInitialization(geometry, autosaveRestore, previewStart) {
    const applyStartedAt = performance.now();
    const startupMetrics = window.__PANDOLAB_STARTUP_METRICS__;
    if (startupMetrics) startupMetrics.canonicalStateApplyStage = 'start';
    const navigationView = deepClone(state.view);
    const navigationProjection = state.projection;
    const navigationChanged = navigationProjection !== previewStart.projection
      || JSON.stringify(navigationView) !== previewStart.viewJson;
    const previewSearch = state.layerSearch;
    const previewSelection = (state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) ? String(state.selected.id || '') : '';
    installCanonicalCountryStore(geometry.canonicalCountryStore);
    // Preview-to-canonical promotion stays inside the same project generation.
    // A project hard reset here discarded the painted preview scene and forced
    // the renderer down the expensive canonical fallback path before the
    // Worker mesh was ready.
    const projectGeneration = gpuMapRenderer.getProjectGeneration?.();
    boundarySelectionAnalysisCache.clear();
    // The low-resolution country source is a one-way startup aid.  After the
    // first canonical promotion a project reset starts from canonical data or
    // a neutral loading state and must not briefly re-expose preview geometry.
    const previewAllowed = gpuMapRenderer.getRuntimeState?.().previewAllowed !== false;
    state.countryVisualPhase = previewAllowed ? 'preview' : 'canonical';
    countryDisplaySource = null;
    countryDisplayIndex = new Map();

    const restored = autosaveRestore.project;
    if (restored) applySharedProjectFields(restored);
    const restoredDelta = restored?.format === 'pandolab-autosave-delta';
    state.countriesData = restoredDelta
      ? projectDomain.countriesFromAutosaveDelta(restored, geometry.countries)
      : restored?.countriesData
        ? reindexCountries(restored.countriesData, true)
        : reindexCountries(geometry.countries, true, { assumeCanonical: true });
    if (startupMetrics) startupMetrics.canonicalStateApplyStage = 'countries-indexed';
    if (!restored) applyPristineLabelAnchors(state.countriesData);
    if (navigationChanged) {
      state.view = navigationView;
      state.projection = navigationProjection;
    } else {
      applyAutosavedView(autosaveRestore.view);
    }
    syncMapHostFromState();
    state.layerSearch = previewSearch;
    normalizeProjectObjects();
    pruneLayerItemVisibility();
    scheduleCountryLabelAnchors(null, 10);
    markLayerTreeDirty();
    configureDatasetSession(restored);
    if (startupMetrics) startupMetrics.canonicalStateApplyStage = 'project-normalized';
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    const externalGeometry = !!restored?.countriesData && restored.baseDataset !== BASE_DATASET;
    const useBuiltInMesh = !externalGeometry && !state.sessionBaseCountriesJson;
    window.PANDOLAB_COUNTRIES = null;
    applyDataReadinessEvent(READINESS_EVENTS.GEOMETRY_READY);
    state.geometryProgress = 100;
    syncProjectControls();
    projectUi.syncHistory();
    // Keep the already-painted preview scene stable until the canonical mesh is
    // ready. A full project invalidation here made the renderer traverse the
    // 10m geometry on the main thread before the Worker-produced mesh could be
    // applied, defeating the interaction-first startup contract.
    // The canonical state becomes editable here, but the painted preview and
    // its interaction packet remain active until the canonical mesh commits.
    // The mesh commit performs the first full canonical render atomically.
    renderingDomain?.invalidateView?.('canonical-geometry-applied');
    if (previewSelection && countryFeatureById(previewSelection)) applyCountrySelectionIntent(previewSelection, true);
    if (startupMetrics) startupMetrics.canonicalStateApplyStage = 'layer-hydration';
    await layerTreeController?.completeHydration();
    if (startupMetrics) startupMetrics.canonicalStateApplyStage = 'complete';
    // Do not structured-clone the full canonical country collection into the
    // edit Worker during startup. The client rebases lazily on the first edit
    // operation, so the initial canonical promotion stays isolated from
    // non-essential editing preparation.

    if (startupMetrics) {
      startupMetrics.geometryApplyMs = performance.now() - applyStartedAt;
      const renderer = gpuMapRenderer.getRuntimeState();
      startupMetrics.renderer = renderer.renderer;
      startupMetrics.fallbackReason = renderer.fallbackReason;
      startupMetrics.devicePixelRatio = renderer.devicePixelRatio;
      startupMetrics.effectivePixelRatio = renderer.effectivePixelRatio;
    }
    if (restored) {
      saveState.markNewProject(`content:${Date.now()}`);
      saveState.setAutosave(AUTOSAVE_STATES.SAVED, { fallback: autosaveRestore.source === 'localstorage' ? '브라우저 로컬 저장소' : '' });
      if (restored.countriesData && restored.baseDataset === BASE_DATASET) projectDomain.queueAutosave(0);
      const restoredLabel = externalGeometry ? '외부 GIS 자동저장 데이터를' : '자동저장 프로젝트를';
      setActionStatus(`${restoredLabel} 복원 완료. 고화질 지도 준비 중…`, 'success', 3600);
    } else {
      saveState.markNewProject('content:0');
      const restoreMessage = autosaveRestore.error
        ? compactNotificationMessage(autosaveRestore.error?.message || '현재 스키마와 다른 자동저장입니다.', { tone: 'error', maxLength: 52 })
        : '편집 준비 완료. 고화질 지도 준비 중…';
      setActionStatus(restoreMessage, autosaveRestore.error ? 'error' : 'success', autosaveRestore.error ? 0 : 3200);
    }
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = useBuiltInMesh ? '빠른 미리보기 · 고화질 지도 준비 중' : '프로젝트 지도를 다시 구성하는 중입니다.';
    window.dispatchEvent(new CustomEvent('pandolab:editable', { detail: { useBuiltInMesh } }));
    return { useBuiltInMesh, restored, projectGeneration };
  }

  async function completeMeshEnhancement(mesh, context) {
    const meshReplaceStartedAt = performance.now();
    const startupMetrics = window.__PANDOLAB_STARTUP_METRICS__;
    let meshApplied;
    const projectGeneration = context?.projectGeneration ?? gpuMapRenderer.getProjectGeneration?.();
    if (!context.useBuiltInMesh || state.sessionBaseCountriesJson) {
      meshApplied = (await gpuMapRenderer.rebuildFromCountries(state.countriesData?.features || [], { projectGeneration })) !== false;
    } else {
      meshApplied = (await gpuMapRenderer.replaceBuiltInMesh({
        meshBuffer: mesh.meshBuffer,
        preparedStroke: mesh.preparedStroke,
        spatialBlocks: mesh.spatialBlocks,
        onStaged: () => {
          state.countryVisualPhase = 'canonical';
          countryDisplaySource = null;
          countryDisplayIndex = new Map();
          renderingDomain?.invalidateProject?.('canonical-staging-ready');
        },
        features: state.countriesData?.features || [],
        quality: 'canonical',
        projectGeneration,
      })) !== false;
      const dirtyIds = new Set([...state.historyDirtyCountryIds, ...state.pendingCountryRenderIds]);
      if (dirtyIds.size) {
        for (const id of dirtyIds) state.pendingCountryRenderIds.add(String(id));
        await gpuMapRenderer.applyCountryPatch(dirtyIds);
      }
    }
    // Once the canonical mesh is successfully displayed, every country SVG
    // path must use the same source. This prevents edit/selection state from
    // mixing preview and canonical geometries on a single frame.
    if (meshApplied) {
      state.countryVisualPhase = 'canonical';
      countryDisplaySource = null;
      countryDisplayIndex = new Map();
      state.auditPreviewCountries = null;
      window.PANDOLAB_COUNTRIES = null;
      if (startupMetrics) startupMetrics.canonicalPreviewReleasedBytes = Number(
        startupMetrics.preview?.assets?.countries?.decodedBytes || 0,
      );
      void window.PANDOLAB_SAMPLE_STARTUP_MEMORY?.('preview-released');
      applyAdaptiveRenderQuality({ refreshScene: false, reason: 'canonical-ready' });
    }
    loadTerrainManifest();
    loadHydroData();
    applyDataReadinessEvent(READINESS_EVENTS.MESH_READY);
    state.meshProgress = 100;
    if (!context.useBuiltInMesh || state.sessionBaseCountriesJson) {
      renderingDomain?.invalidateProject?.('canonical-mesh-ready');
    }
    const renderer = gpuMapRenderer.getRuntimeState();
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = `Natural Earth 5.1.1 · ${renderer.renderer === 'webgl2' ? 'WebGL2' : renderer.renderer === 'webgl1' ? 'WebGL1' : 'Canvas'} 고화질`;
    if (startupMetrics) {
      startupMetrics.meshApplyMs = performance.now() - meshReplaceStartedAt;
      startupMetrics.renderer = renderer.renderer;
      startupMetrics.fallbackReason = renderer.fallbackReason;
      startupMetrics.devicePixelRatio = renderer.devicePixelRatio;
      startupMetrics.effectivePixelRatio = renderer.effectivePixelRatio;
    }
    setActionStatus('고화질 지도를 준비했습니다.', 'success', 2400);
  }

  function awaitVisualFrame(maxWaitMs = 120) {
    return new Promise(resolve => {
      let settled = false;
      let timeout = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        resolve();
      };
      timeout = setTimeout(finish, Math.max(16, Number(maxWaitMs) || 120));
      requestAnimationFrame(finish);
    });
  }

  async function initProgressive() {
    assertRuntimeCompatibility();
    if (!window.d3) throw new Error('내장 지도 엔진을 불러올 수 없습니다. 페이지를 새로고침하세요.');
    if (!window.PANDOLAB_COUNTRIES?.features?.length) throw new Error('미리보기 국가 데이터를 불러올 수 없습니다. 페이지를 새로고침하세요.');

    const autosavePromise = projectDomain.restoreAutosave();
    state.countriesData = reindexCountries(window.PANDOLAB_COUNTRIES, true);
    normalizeProjectObjects();
    pruneLayerItemVisibility();
    scheduleCountryLabelAnchors(null, 10);
    markLayerTreeDirty();
    configureDatasetSession(null);
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = '빠른 미리보기 GPU 지도를 준비하는 중입니다.';

    applyLayoutMode({ initial: true });
    bindUI();
    layerTreeController.beginHydration();
    window.addEventListener('pandolab:geometry-progress', handleGeometryProgress);
    window.addEventListener('pandolab:mesh-progress', handleMeshProgress);
    window.addEventListener('pandolab:geometry-error', handleGeometryError);
    window.addEventListener('pandolab:mesh-error', handleMeshError);
    initSvg();
    resizeMap();
    if (window.__PANDOLAB_STARTUP_METRICS__) window.__PANDOLAB_STARTUP_METRICS__.mapHostStage = 'frame-pending';
    await awaitVisualFrame();
    if (window.__PANDOLAB_STARTUP_METRICS__) window.__PANDOLAB_STARTUP_METRICS__.mapHostStage = 'host-initialize';
    mapHostReadyPromise = initializeMapHost();
    await mapHostReadyPromise;
    if (window.__PANDOLAB_STARTUP_METRICS__) window.__PANDOLAB_STARTUP_METRICS__.mapHostStage = 'gpu-initialize';
    const previewMeshStartedAt = performance.now();
    await gpuMapRenderer.initialize();
    if (window.__PANDOLAB_STARTUP_METRICS__) window.__PANDOLAB_STARTUP_METRICS__.mapHostStage = 'ready';
    if (window.__PANDOLAB_STARTUP_METRICS__) {
      const previewRenderer = gpuMapRenderer.getRuntimeState();
      window.__PANDOLAB_STARTUP_METRICS__.previewMeshUploadMs = performance.now() - previewMeshStartedAt;
      window.__PANDOLAB_STARTUP_METRICS__.renderer = previewRenderer.renderer;
      window.__PANDOLAB_STARTUP_METRICS__.fallbackReason = previewRenderer.fallbackReason;
      window.__PANDOLAB_STARTUP_METRICS__.devicePixelRatio = previewRenderer.devicePixelRatio;
      window.__PANDOLAB_STARTUP_METRICS__.effectivePixelRatio = previewRenderer.effectivePixelRatio;
    }
    startMapResizeObserver();

    syncProjectControls();
    resizeMap();
    projectUi.syncHistory();
    editingDomain?.setTool('select', { announce: false });
    applyDataReadinessEvent(READINESS_EVENTS.PREVIEW_READY);
    runtimeReady = true;
    const previewStart = { projection: state.projection, viewJson: JSON.stringify(state.view) };
    setActionStatus('미리보기 표시 완료. 편집 데이터 준비 중…', 'working', 0);
    window.dispatchEvent(new CustomEvent('pandolab:interactive'));
    if (window.__PANDOLAB_STARTUP_METRICS__?.geometryError) {
      handleGeometryError({ detail: window.__PANDOLAB_STARTUP_METRICS__.geometryError });
    }

    const [geometry, autosaveRestore] = await Promise.all([
      window.PANDOLAB_CANONICAL_GEOMETRY_PROMISE,
      autosavePromise,
    ]);
    const previewCountries = state.countriesData;
    state.auditPreviewCountries = previewCountries;
    let context;
    try {
      context = await completeGeometryInitialization(geometry, autosaveRestore, previewStart);
    } catch (error) {
      console.error('[PL-GEOMETRY-APPLY-001]', error);
      state.countriesData = reindexCountries(previewCountries, true);
      applyDataReadinessEvent(READINESS_EVENTS.GEOMETRY_ERROR);
      scheduleMapObjectSpatialIndexRebuild();
      renderingDomain?.invalidateProject?.('progressive-initialization');
      handleGeometryError({ detail: '무손실 편집 지도를 적용하지 못했습니다.' });
      return;
    }
    if (!context.useBuiltInMesh) {
      await completeMeshEnhancement(null, context);
      return;
    }
    if (window.__PANDOLAB_STARTUP_METRICS__?.meshError) {
      handleMeshError({ detail: window.__PANDOLAB_STARTUP_METRICS__.meshError });
    }
    const mesh = await window.PANDOLAB_CANONICAL_MESH_PROMISE;
    try {
      await completeMeshEnhancement(mesh, context);
    } catch (error) {
      console.error('[PL-MESH-APPLY-001]', error);
      handleMeshError({ detail: '고화질 지도를 적용하지 못했습니다.' });
      return;
    }
  }

  async function init() {
    if (window.PANDOLAB_CANONICAL_GEOMETRY_PROMISE instanceof Promise) return initProgressive();
    assertRuntimeCompatibility();
    if (!window.d3) {
      (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = '엔진 오류';
      setActionStatus('내장 지도 엔진을 불러올 수 없습니다. 페이지를 새로고침하세요.', 'error', 0);
      return;
    }
    if (!window.PANDOLAB_COUNTRIES?.features?.length) {
      setActionStatus('내장 국가 데이터를 불러올 수 없습니다. 페이지를 새로고침하세요.', 'error', 0);
      return;
    }

    const autosaveRestore = await projectDomain.restoreAutosave();
    const restored = autosaveRestore.project;
    if (restored) applySharedProjectFields(restored);
    applyAutosavedView(autosaveRestore.view);
    state.auditPreviewCountries = window.PANDOLAB_COUNTRIES;

    const restoredDelta = restored?.format === 'pandolab-autosave-delta';
    state.countriesData = restoredDelta
      ? projectDomain.countriesFromAutosaveDelta(restored)
      : restored?.countriesData
        ? reindexCountries(deepClone(restored.countriesData), true)
        : freshPristineCountries(true);
    state.countryVisualPhase = 'canonical';
    normalizeProjectObjects();
    pruneLayerItemVisibility();
    scheduleCountryLabelAnchors(null, 10);
    markLayerTreeDirty();
    configureDatasetSession(restored);
    const externalGeometry = !!restored?.countriesData && restored.baseDataset !== BASE_DATASET;
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = 'Natural Earth 5.1.1 · GPU 렌더러를 준비하는 중입니다.';
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };

    applyLayoutMode({ initial: true });
    bindUI();
    layerTreeController.beginHydration();
    initSvg();
    resizeMap();
    mapEditClient.rebase(state.countriesData?.features || []);
    if (window.__PANDOLAB_STARTUP_METRICS__) window.__PANDOLAB_STARTUP_METRICS__.mapHostStage = 'frame-pending';
    await awaitVisualFrame();
    if (window.__PANDOLAB_STARTUP_METRICS__) window.__PANDOLAB_STARTUP_METRICS__.mapHostStage = 'host-initialize';
    mapHostReadyPromise = initializeMapHost();
    await mapHostReadyPromise;
    if (window.__PANDOLAB_STARTUP_METRICS__) window.__PANDOLAB_STARTUP_METRICS__.mapHostStage = 'gpu-initialize';
    const gpuReady = await gpuMapRenderer.initialize();
    if (window.__PANDOLAB_STARTUP_METRICS__) window.__PANDOLAB_STARTUP_METRICS__.mapHostStage = 'ready';
    if (gpuReady) {
      state.countryVisualPhase = 'canonical';
      countryDisplaySource = null;
      countryDisplayIndex = new Map();
    }
    startMapResizeObserver();
    if (restored && gpuReady) {
      if (externalGeometry || state.sessionBaseCountriesJson) scheduleGpuMeshRebuild(0);
      else if (state.historyDirtyCountryIds.size) {
        for (const id of state.historyDirtyCountryIds) state.pendingCountryRenderIds.add(String(id));
        gpuMapRenderer.applyCountryPatch(state.historyDirtyCountryIds);
      }
    }

    $('countriesVisible').checked = state.layerVisibility.countries;
    $('territoriesVisible').checked = state.layerVisibility.territories !== false;
    $('administrativeVisible').checked = state.layerVisibility.administrative !== false;
    $('regionsVisible').checked = state.layerVisibility.regions !== false;
    $('languagesVisible').checked = state.layerVisibility.languages !== false;
    $('ethnicitiesVisible').checked = state.layerVisibility.ethnicities !== false;
    $('religionsVisible').checked = state.layerVisibility.religions !== false;
    $('riversVisible').checked = state.layerVisibility.rivers !== false;
    $('lakesVisible').checked = state.layerVisibility.lakes !== false;
    $('genericFeaturesVisible').checked = state.layerVisibility.genericFeatures;
    $('labelsVisible').checked = state.layerVisibility.labels;
    $('basemapLabelsVisible').checked = state.layerVisibility.basemapLabels;
    syncPhysicalControls();
    if ($('layerSearchInput')) $('layerSearchInput').value = state.layerSearch;
    layerTreeController?.render(true);
    syncProjectionButtons();

    resizeMap();
    projectUi.syncHistory();
    editingDomain?.setTool('select');
    loadPhysicalData();
    await layerTreeController?.completeHydration();

    if (restored) {
      saveState.markNewProject(`content:${Date.now()}`);
      saveState.setAutosave(AUTOSAVE_STATES.SAVED, { fallback: autosaveRestore.source === 'localstorage' ? '브라우저 로컬 저장소' : '' });
      if (restored.countriesData && restored.baseDataset === BASE_DATASET) projectDomain.queueAutosave(0);
      if (gpuReady) {
        const restoredLabel = externalGeometry ? '외부 GIS 자동저장 데이터를' : '자동저장 프로젝트를';
        setActionStatus(`${restoredLabel} 복원했습니다.`, 'success', 3200);
      } else {
        setActionStatus('자동저장을 복원했습니다.', 'success', 4200);
      }
    } else {
      saveState.markNewProject('content:0');
      if (autosaveRestore.error) {
        const restoreMessage = compactNotificationMessage(autosaveRestore.error?.message || '현재 스키마와 다른 자동저장입니다.', { tone: 'error', maxLength: 52 });
        setActionStatus(restoreMessage, 'error', 0);
      } else if (gpuReady) {
        setActionStatus('고해상도 지도를 준비했습니다.', 'success');
      } else {
        setActionStatus('무손실 렌더러 준비 완료.', 'success', 4200);
      }
    }
  }

  function initializeDomainBoundaries() {
    if (projectDomain || selectionDomain || renderingDomain || gisDomain || editingDomain) return;
    const domainListeners = new Map();
    // Rendering domains are created before initSvg() so project/GIS services can
    // be available during bootstrap. Resource references are plain snapshots;
    // the rendering coordinator refreshes them once at the start of a frame.
    const resourceSnapshots = Object.create(null);
    let renderResourceSnapshotFrameId = null;
    const createResourceSnapshot = (name, values, live = {}) => {
      const resource = { ...values };
      const refresh = () => {
        for (const [property, getter] of Object.entries(live)) {
          if (typeof getter === 'function') resource[property] = getter();
        }
        return resource;
      };
      Object.defineProperty(resource, '__refresh', { value: refresh, enumerable: false });
      resourceSnapshots[name] = resource;
      refresh();
      return resource;
    };
    const refreshRenderResources = frameId => {
      if (frameId !== null && frameId !== undefined && frameId === renderResourceSnapshotFrameId) return;
      for (const resource of Object.values(resourceSnapshots)) resource.__refresh?.();
      renderResourceSnapshotFrameId = frameId ?? `direct-${Date.now()}`;
      return renderResourceSnapshotFrameId;
    };
    const domainContext = Object.freeze({
      getProjectSnapshot: () => projectDomain?.snapshot?.() || projectSerializer.buildProject(),
      getSessionSnapshot: () => deepClone({ projection: state.projection, view: state.view, selected: state.selected }),
      dispatchProjectCommand: command => projectDomain?.dispatch?.(command),
      requestRender: invalidation => renderingDomain?.requestRender?.(invalidation) || false,
      publish: (name, detail) => {
        for (const listener of domainListeners.get(String(name)) || []) listener(detail);
      },
      subscribe: (name, listener) => {
        const key = String(name);
        const listeners = domainListeners.get(key) || new Set();
        listeners.add(listener);
        domainListeners.set(key, listeners);
        return () => listeners.delete(listener);
      },
      getViewport: () => {
        const layout = projectionLayoutMetrics();
        return { width: layout.width, height: layout.height, dpr: layout.dpr };
      },
      getFrameContext: () => window.__PANDOLAB_VIEW_STATE__ || null,
      reportDiagnostic: entry => reliabilityDiagnostic.push({ category: 'domain', ...entry }),
    });
    projectDomain = createProjectDomain({
      context: domainContext,
      getSnapshot: () => projectSerializer.buildProject(),
      replaceSnapshot: (project, options) => {
        const resetOptions = {
          projectGeneration: options?.generation,
          skipRenderReset: options?.skipRenderReset === true,
          prepared: options?.prepared,
        };
        if (project) return applyAtlasState(project, options?.reason === 'load', resetOptions);
        return resetProjectInPlace(resetOptions);
      },
      serializer: projectSerializer,
      history: historyService,
      persistence: persistenceService,
      saveState,
      prepareEmpty: () => materializePristineCountries(),
      createProjectFile: async project => {
        await ensureGisIoRuntime();
        if (!window.PandoLabGIS?.exportGeoPackage) throw new Error('GeoPackage 저장 모듈을 불러오지 못했습니다.');
        return window.PandoLabGIS.exportGeoPackage(project, () => undefined);
      },
      captureReplacement: () => ({
        project: projectSerializer.buildProject(),
        history: [...state.history], historyMeta: [...state.historyMeta],
        future: [...state.future], futureMeta: [...state.futureMeta],
        save: saveState.checkpoint(),
      }),
      restoreReplacement: (checkpoint, generation) => {
        applyAtlasState(checkpoint.project, false, { projectGeneration: generation, skipRenderReset: true });
        Object.assign(historyStore, {
          history: checkpoint.history, historyMeta: checkpoint.historyMeta,
          future: checkpoint.future, futureMeta: checkpoint.futureMeta,
        });
        saveState.restore(checkpoint.save);
        projectUi.syncHistory();
        renderingDomain?.invalidateProject?.('project-rollback');
      },
      invalidateProject: reason => renderingDomain?.invalidateProject?.(reason),
      invalidateHistory: reason => renderingDomain?.invalidateCountryPatch?.(reason),
      reportDiagnostic: entry => reliabilityDiagnostic.push({ category: 'project', ...entry }),
      commandPipeline: projectCommandPipeline,
      invariants: { assertProjectReferenceIntegrity },
      restoreCountriesFromDelta: (project, suppliedBase = null) => restoreCountriesFromDelta(project, {
        base: suppliedBase || materializePristineCountriesSync(),
        clone: deepClone,
        reindex: base => reindexCountries(base, true),
        applyPristineLabelAnchors,
      }),
      onProjectChanged: event => {
        window.dispatchEvent(new CustomEvent('pandolab:project-changed', { detail: event }));
      },
      onProjectReset: event => {
        selectionDomain?.resetProject(event.generation);
        editingDomain?.resetProject?.(event.generation);
        renderingDomain?.resetProjectGeneration(event.generation);
      },
    });

    gisDomain = createGisDomain({
      projectDomain,
      importService: () => gisWorkflow.ensure(),
      riverPartitionWorkerFactory: () => new Worker(runtimeAssetUrl('workers/river-territory-partition-worker.js'), {
        type: 'module', name: 'pandolab-river-territory-partitions',
      }),
      riverPartitionFallback: async payload => {
        await ensureGisRuntime();
        return buildRiverTerritoryPartitions({ ...payload, clipper: window.polygonClipping });
      },
      riverPartitionSource: {
        ensureReady: async () => {
          if (state.physicalLoadState.hydro === 'ready') return true;
          const ready = await loadHydroData(state.physicalLoadState.hydro === 'error');
          if (!ready) throw new Error('강·호수 데이터가 아직 준비되지 않았습니다.');
          return true;
        },
        queryBounds: riverPartitionQueryBounds,
        queryLogicalFeatures: bounds => gpuMapRenderer.queryHydroLogicalFeatures(bounds, { category: 'river' }),
        loadLogicalFeature: logicalId => gpuMapRenderer.loadHydroLogicalFeature(logicalId),
        getEditRivers: boundsList => state.hydroEdits.filter(feature => (
          feature?.properties?.category === 'river'
          && feature.geometry
          && boundsList.some(bounds => riverPartitionBoundsOverlap(geometryBounds(feature.geometry), bounds))
        )),
        featureKey: riverPartitionFeatureKey,
      },
      reportDiagnostic: entry => reliabilityDiagnostic.push({ category: 'gis-domain', ...entry }),
    });

    selectionDomain = createSelectionDomain({
      context: domainContext,
      projectDomain,
      selectionPacketFactory: createSelectionPacket,
      normalizeRef: normalizeObjectRef,
      refExists: objectRefExists,
      onSelectionChanged: snapshot => {
        const selection = snapshot.selection;
        state.selected = selection.items.find(item => item.key === selection.primaryKey) || null;
        if (!selection.items.length) state.addSelectionMode = false;
        selectionUiController?.sync?.(snapshot);
      },
      requestRender: reason => renderingDomain?.invalidateSelectionOverlay?.(reason) || false,
    });

    objectPropertyController = createObjectPropertyController({
      document,
      getElement: $,
      state,
      territorialUnitTypes: TERRITORIAL_UNIT_TYPES,
      distributionModes: DISTRIBUTION_MODES,
      distributionTypeLabels: DISTRIBUTION_TYPE_LABELS,
      colorDomains: COLOR_DOMAINS,
      defaultGenericFeatureColor: DEFAULT_GENERIC_FEATURE_COLOR,
      hydroToolConfig: HYDRO_TOOL_CONFIG,
      territorialUnitById,
      territorialUnitName,
      territorialUnitCountryName,
      territorialUnitCountryOptions,
      territorialUnitParentOptions,
      territorialParentOptions,
      territorialUnitColor,
      territorialRepository,
      territorialChildren,
      distributionService,
      distributionEntriesForLayer,
      genericFeatureById: id => state.genericFeatures.find(feature => String(feature.id) === String(id)),
      normalizeGenericFeatureSemantics,
      genericFeatureGeometryKind,
      genericFeatureRole,
      genericFeatureRoleLabel,
      genericFeatureRoleHelp,
      genericFeatureLandBinding,
      genericFeatureName,
      genericFeatureRoleLabels: GENERIC_FEATURE_ROLE_LABELS,
      defaultGenericFeatureColorFor: defaultGenericFeatureColor,
      labelKey,
      automaticLabelSettings,
      hydroFeatureById,
      hydroEditById,
      isHydroFeatureVisible,
      hydroCategoryKey,
      hydroCategoryLabel,
      hydroFallbackName,
      hydroEditorName,
      prepareHydroFeature,
      gpuMapRenderer,
      readDomainColor,
      syncColorPicker,
      replaceSelectOptions,
      formatArea,
      geometryAreaKm2: sphericalGeometryAreaKm2,
      layerNameCompare: (left, right) => layerNameCollator.compare(left, right),
      layerTreeController: () => layerTreeController,
      syncObjectActionsMenu,
      closeObjectActionsMenu,
      setEditorShellView,
      syncStatusBar,
      createEmptyState,
      createSemanticIcon,
      territorialTypeLabel,
      countryFeatureById,
      onHydroLoaded: full => {
        const key = String(full.properties?.pandolab_id || full.id);
        state.hydroFeatureCache.set(key, full);
        for (const [fid, cached] of state.hydroFeatureByFid) {
          if (String(cached?.properties?.pandolab_id || cached?.id) === key) state.hydroFeatureByFid.set(fid, full);
        }
        if (state.selected?.domain === 'hydro' && state.selected.id === key) objectPropertyController.presentHydro(key, true);
      },
    });

    countryPropertyController = createCountryPropertyController({
      window,
      document,
      elements: {
        name: $('countryNameInput'),
        code: $('countryCodeInput'),
        color: $('countryColorInput'),
        capital: $('capitalInput'),
        notes: $('notesInput'),
        originalName: $('originalNameValue'),
        area: $('countryAreaValue'),
        selectionStatus: $('selectionStatus'),
        flagPreview: $('flagPreview'),
        flagUpload: $('flagUploadBtn'),
        flagFile: $('flagFileInput'),
        flagRemove: $('flagRemoveBtn'),
      },
      getCountryView: value => {
        const ref = normalizeObjectRef(value);
        const id = String(ref?.id || value?.id || value || '');
        const feature = countryFeatureById(id);
        if (!feature) return null;
        const properties = feature.properties || {};
        const override = state.countryOverrides[id] || {};
        return { ref: countryObjectRef(id), id, feature, properties, override, displayName: override.name || properties.name || id };
      },
      getPrimaryRef: () => selectionDomain.primary(),
      showPropertyForm: (...args) => objectPropertyController.show(...args),
      resolveColor: view => readDomainColor(COLOR_DOMAINS.COUNTRY, {
        feature: view.feature,
        override: view.override,
      }, { fallback: defaultCountryColor() }),
      defaultColor: defaultCountryColor,
      syncColorPicker,
      resolveFlagUrl: view => effectiveCountryFlagUrl({
        countryId: view.id,
        properties: view.properties,
        override: view.override,
        assetRevision: ASSET_REVISION,
      }),
      calculateAreaKm2: sphericalGeometryAreaKm2,
      formatArea,
      syncActions: syncCountryActionButtons,
      syncStatus: syncStatusBar,
      commitField: commitCountryEdit,
      metrics: selectionPerformanceMetrics,
    });

    selectionUiController = createSelectionUiController({
      window,
      document,
      selectionDomain,
      elements: {
        multiSelectionCount: $('multiSelectionCount'),
        multiSelectionMode: $('multiSelectionModeBtn'),
        clearMultiSelection: $('clearMultiSelectionBtn'),
        selectionStatus: $('selectionStatus'),
      },
      resolveRef: normalizeObjectRef,
      refExists: objectRefExists,
      displayInfo: objectDisplayInfo,
      presenters: {
        resolve: ref => {
          if (ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY) {
            return (value, options) => countryPropertyController.present(value, options);
          }
          if (ref.domain !== 'territorial' || ref.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) {
            return (value, options) => objectPropertyController.present(value, options);
          }
          return null;
        },
        multiple: (selection, detail) => objectPropertyController.show('multi', '공통 속성', {
          resetScroll: false,
          typeLabel: detail.typeLabel,
        }),
      },
      uiActions: {
        isAddSelectionMode: () => state.addSelectionMode,
        toggleAddSelectionMode: () => {
          if (!isMobile() || !selectionDomain.size()) return false;
          state.addSelectionMode = !state.addSelectionMode;
          selectionUiController.syncNow(selectionDomain.snapshot(), { force: true });
          syncMapContextSurfaces();
          return true;
        },
        focusObject: focusObjectRef,
        openEditor: () => {
          const startedAt = performance.now();
          openSelectionEditor();
          selectionPerformanceMetrics.editorOpenMs = performance.now() - startedAt;
        },
        clearPresenter: () => {
          countryPropertyController.clear();
          state.addSelectionMode = false;
          if ($('selectionStatus')) $('selectionStatus').textContent = '';
          objectPropertyController.show(null);
          syncCountryActionButtons();
          syncMobileNavigation();
          if (layoutMode === 'wide') {
            surfaceState.editorManuallyCollapsed = false;
            if (surfaceState.editorOpen) closeSurface('editor');
          }
        },
        syncBatchActions: syncBatchActionAvailability,
        syncMapSurfaces: syncMapContextSurfaces,
        syncLayerRows: selection => layerTreeController?.syncSelection(selection),
        closeChooser: closeObjectChooser,
      },
      metrics: selectionPerformanceMetrics,
    });
    countryPropertyController.bind();
    selectionUiController.bind();

    editingDomain = createEditingDomain({
      context: domainContext,
      projectDomain,
      gisDomain,
      selectionDomain,
      toolController: {
        requireCanonicalData,
        getGeometryPreviewSession: () => state.geometryPreview.session,
        getCurrentTool: () => state.tool,
        discardGeometryPreview: discardActiveGeometryPreview,
        clearHover: () => { lastHoverHit = null; selectionDomain.setHover(null); },
        resetForTool: tool => {
          state.labelPlacementMode = false;
          if (tool !== 'country-coast') {
            state.coastEditCountryId = null;
            state.coastEditScopeGenericFeatureId = null;
            state.coastEditReturnSelection = null;
          }
          if (tool !== 'country-border') resetBoundaryEditState();
          if (tool !== 'merge-country') resetMergeState();
          if (tool !== 'merge-generic-feature') resetGenericFeatureMergeState();
          if (tool !== 'split-generic-feature') state.genericFeatureSplitSourceId = null;
          if (tool !== 'merge-territorial-unit') {
            state.territorialUnitMergeSourceId = null;
            state.territorialUnitMergeTargetIds = [];
          }
          if (tool !== 'split-territorial-unit') {
            state.territorialUnitSplitSourceId = null;
            state.territorialUnitSplitVirtualSource = null;
          }
          if (tool !== 'redraw-territorial-unit') state.territorialUnitRedrawSourceId = null;
          if (tool !== 'draw-territorial-unit') state.territorialCreateContext = null;
          if (tool !== 'annex-territory') resetAnnexState();
          if (tool !== 'new-country') resetNewCountryState();
        },
        applyToolPresentation: (tool, options = {}) => {
          state.tool = tool;
          setCurrentTool(toolLabel(tool));
          setModeBanner();
          syncMobileNavigation();
          updateModeButtons();
          return options;
        },
      },
      previewController: editPreviewController,
      draftServices: {
        getToolConfig: tool => {
          const config = draftToolConfig(tool);
          return config ? { ...config, minimumPoints: config.shape === 'polygon' ? 3 : 2 } : null;
        },
        isSpacePanActive: () => state.spacePanActive,
        screenSample: screenPoint => {
          const coordinate = screenToGeo(screenPoint);
          return coordinate ? { screen: screenPoint.slice(), coordinate } : null;
        },
        projectCoordinate: coordinate => activeProjection()(coordinate),
        screenToCoordinate: point => screenToGeo(point),
        snapCandidates: ({ coordinate, excludeNodeKey }) => localSnapCandidates(coordinate)
          .filter(candidate => !excludeNodeKey || candidate.nodeKey !== excludeNodeKey),
        assessDraft: ({ tool, coords, buildPreview }) => {
          const sourceGeometry = activeCutDraftSourceGeometry();
          if (sourceGeometry) {
            const assessment = assessCutDraft(coords, sourceGeometry);
            if (assessment.valid && buildPreview) {
              try {
                const split = buildCutSplitCandidates(sourceGeometry, coords);
                assessment.splitPreview = {
                  revision: Number(editingDomain?.snapshot?.().revision || 0),
                  candidates: split.candidates.map(candidate => ({ geometry: deepClone(candidate.geometry), area: candidate.area })),
                };
              } catch (_) { assessment.splitPreview = null; }
            }
            return assessment;
          }
          return null;
        },
        requestFrame: callback => requestAnimationFrame(callback),
        cancelFrame: handle => cancelAnimationFrame(handle),
        onTooShort: config => setActionStatus(`형상이 너무 짧습니다. ${config?.shape === 'polygon' ? '영역의 경계를 더 크게' : '선을 더 길게'} 그려주세요.`, 'error', 3200),
        onFinished: () => {
          if (!activeCutDraftSourceGeometry()) setModeBanner('꼭짓점을 드래그해 미세조정한 뒤 완료하세요.');
        },
      },
      geometryEditing: {
        resolveObjectFeature: targetRef => {
          if (targetRef?.domain === 'hydro') return state.hydroEdits.find(item => String(item.id) === String(targetRef.id)) || null;
          if (targetRef?.domain === 'generic') return state.genericFeatures.find(item => String(item.id) === String(targetRef.id)) || null;
          return null;
        },
        canEditObject: feature => {
          if (feature?.properties?.locked === true) {
            setActionStatus('잠금을 해제한 뒤 꼭짓점을 이동하세요.', 'error', 3200);
            return false;
          }
          const hydroEdit = isHydroEditFeature(feature);
          const owner = hydroEdit ? null : countryFeatureById(feature.properties?.ownerId);
          if (!hydroEdit && genericFeatureLandBinding(feature) === 'hard' && owner) {
            setActionStatus('국가 해안선과 연결된 점입니다. 편집창의 해안 구간 수정을 사용하세요.', 'error', 3800);
            return false;
          }
          projectDomain.recordHistory();
          return true;
        },
        getObjectVertexTarget: () => {
          if (state.tool !== 'select') return null;
          const selected = state.selected;
          if (selected?.domain === 'hydro') {
            const feature = state.hydroEdits.find(item => String(item.id) === String(selected.id));
            return feature ? { targetRef: { domain: 'hydro', type: 'hydro', id: String(feature.id) }, mode: 'hydro', feature } : null;
          }
          if (selected?.domain === 'generic') {
            const feature = state.genericFeatures.find(item => String(item.id) === String(selected.id));
            return feature ? { targetRef: { domain: 'generic', type: 'generic', id: String(feature.id) }, mode: 'generic', feature } : null;
          }
          return null;
        },
        previewObjectGesture: ({ source, feature, segments }) => {
          beginActiveEditPreview({
            key: `${isHydroEditFeature(source) ? 'hydro' : 'generic'}:${source.id}`,
            segments,
            style: {
              color: isHydroEditFeature(source) ? '#72c9ef' : resolvedInteractionStyle.selection.color,
              alpha: 1,
              width: 3.2,
              casing: { color: '#101820', alpha: 0.55, width: 4.8 },
              cap: 'round', join: 'round',
            },
          });
          return feature;
        },
        commitObjectGesture: ({ source, feature, beforeGeometry, changed }) => {
          const hydroEdit = isHydroEditFeature(source);
          clearActiveEditPreview('vertex-edit-preview-end');
          if (!changed) {
            projectDomain.discardHistory();
            renderingDomain?.invalidateEditedGeometryPatch?.(hydroEdit ? 'hydro' : 'generic', 'vertex-preview-no-change');
            return false;
          }
          const issues = ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type) ? validateStructuredGeometry(feature) : [];
          if (issues.length) {
            projectDomain.discardHistory();
            setActionStatus(issues[0].message || '유효하지 않은 geometry라 꼭짓점 이동을 되돌렸습니다.', 'error', 3800);
            return false;
          }
          source.geometry = deepClone(feature.geometry);
          genericFeatureLandClipCache.delete(source);
          if (hydroEdit) mapObjectGeometryRevisions.hydro += 1;
          else mapObjectGeometryRevisions.generic += 1;
          renderingDomain?.invalidateEditedGeometryPatch?.(hydroEdit ? 'hydro' : 'generic', 'vertex-edit-commit');
          projectDomain.queueAutosave();
          setActionStatus('꼭짓점을 이동했습니다.', 'success');
          void beforeGeometry;
          return true;
        },
        beginBoundaryGesture: event => {
          if (!['country-border', 'country-coast'].includes(state.tool)) return false;
          const node = state.sharedBoundaryTopology?.nodes?.get?.(String(event.vertexKey || ''));
          if (!node) return false;
          const borderMode = state.tool === 'country-border';
          const selectedIds = new Set(state.boundaryEditCountryIds.map(String));
          const coastId = String(state.coastEditCountryId || event.targetRef?.id || '');
          const allowed = borderMode
            ? node.ownerIds.size >= 2 && [...node.ownerIds].every(id => selectedIds.has(String(id)))
            : node.kind === 'coast' && node.ownerIds.size === 1 && node.ownerIds.has(coastId);
          if (!allowed) return false;
          const affectedIds = borderMode ? new Set([...node.ownerIds].map(String)) : new Set([coastId]);
          if (!requireCountriesUnlocked([...affectedIds], borderMode ? '국경을 조정' : '해안선을 조정')) return false;
          const features = new Map([...affectedIds]
            .map(id => [id, countryFeatureById(id)])
            .filter(([, feature]) => feature)
            .map(([id, feature]) => [id, deepClone(feature)]));
          const refs = [...(node.refs || []), ...(node.virtualRefs || [])]
            .filter(ref => affectedIds.has(String(ref.featureId)))
            .map(ref => ({
              countryId: String(ref.featureId),
              vertex: { polygonIndex: ref.polygonIndex, ringIndex: ref.ringIndex, index: ref.vertexIndex ?? ref.segmentIndex },
            }));
          beginActiveEditPreview({
            key: `${borderMode ? 'border' : 'coast'}:${[...affectedIds].sort().join('|')}:${node.key}`,
            segments: getCountryBoundarySegments().map(item => ({
              start: item.geometry.coordinates[0], end: item.geometry.coordinates[1],
            })),
            style: {
              color: borderMode ? resolvedInteractionStyle.selection.color : '#72c9ef',
              alpha: 1,
              width: 3.8,
              casing: { color: '#101820', alpha: 0.65, width: 5.4 },
              cap: 'round', join: 'round',
            },
          });
          return {
            borderMode,
            affectedIds,
            features,
            refs,
            startCoordinate: node.coordinate.slice(),
            changed: false,
            snapshot: snapshotEditable(),
            validationBaseline: affectedIds.size > 1 ? captureCountryGeometryValidationBaseline(affectedIds) : null,
            structuredBaseline: new Set([...affectedIds]
              .flatMap(id => validateStructuredGeometry(countryFeatureById(id)).filter(Boolean))
              .map(structuredGeometryIssueKey)),
            beforeGeometries: new Map([...affectedIds].map(id => [id, deepClone(countryFeatureById(id)?.geometry)])),
          };
        },
        moveBoundaryGesture: (session, coordinate) => {
          session.changed = session.changed || !coordNear(session.startCoordinate, coordinate, 1e-9);
          for (const ref of session.refs) {
            const feature = session.features.get(ref.countryId);
            if (feature) setCountryVertexCoord(feature, ref.vertex, coordinate);
          }
          const segments = session.refs.flatMap(ref => {
            const feature = session.features.get(ref.countryId);
            const ring = feature ? countryRingForVertex(feature, ref.vertex) : null;
            const count = Math.max(0, (ring?.length || 0) - 1);
            if (!ring || !count) return [];
            return [
              { start: ring[(ref.vertex.index - 1 + count) % count], end: ring[ref.vertex.index] },
              { start: ring[ref.vertex.index], end: ring[(ref.vertex.index + 1) % count] },
            ];
          });
          updateActiveEditPreview(segments);
        },
        commitBoundaryGesture: session => {
          clearActiveEditPreview('country-boundary-preview-end');
          if (!session.changed) return false;
          try {
            const structuredIssues = [...session.affectedIds]
              .flatMap(id => validateStructuredGeometry(session.features.get(id)).filter(Boolean))
              .filter(issue => !session.structuredBaseline.has(structuredGeometryIssueKey(issue)));
            if (structuredIssues.length) throw new Error(structuredIssues[0].message);
            const validation = validateCountryGeometryEdit(session.affectedIds, session.validationBaseline, { featureOverrides: session.features });
            if (!validation.ok) throw new Error(validation.message);
            for (const id of session.affectedIds) {
              const current = countryFeatureById(id);
              const preview = session.features.get(id);
              if (current && preview?.geometry) current.geometry = deepClone(preview.geometry);
            }
            for (const id of session.affectedIds) {
              const current = countryFeatureById(id);
              const before = session.beforeGeometries.get(id);
              if (current && before) syncHardLandDependents(id, before, current.geometry, session.startCoordinate);
            }
            markCountryGeometriesChanged(session.affectedIds);
            refreshCountryCentroids(session.affectedIds);
            rebuildBoundaryTopology(session.borderMode ? state.boundaryEditCountryIds : state.coastEditCountryId);
            projectDomain.commitHistorySnapshot(session.snapshot);
            renderingDomain?.invalidateEditedGeometryPatch?.('country', 'boundary-edit-commit');
            projectDomain.queueAutosave();
            setActionStatus(session.borderMode
              ? `${session.affectedIds.size}개 국가의 공유국경을 함께 수정했습니다.`
              : '해안선을 수정했습니다.', 'success');
            return true;
          } catch (error) {
            rebuildBoundaryTopology(session.borderMode ? state.boundaryEditCountryIds : state.coastEditCountryId);
            reportOperationError(error, session.borderMode
              ? '공유국경을 이동하지 못해 변경을 되돌렸습니다.'
              : '해안선을 이동하지 못해 변경을 되돌렸습니다.', session.borderMode ? 'PL-BORDER-001' : 'PL-COAST-001', 4300);
            return false;
          }
        },
        renderPacket: () => {
          const boundarySegments = getCountryBoundarySegments().flatMap(item => {
            const coordinates = item.geometry?.coordinates || [];
            return coordinates.length >= 2 ? [{ key: item.key, kind: item.kind, start: coordinates[0], end: coordinates[1] }] : [];
          });
          const boundaryHandles = getCountryBoundaryHandles();
          const territoryItems = territoryComponentItems();
          const candidates = state.tool === 'annex-territory'
            ? state.annexCandidates
            : state.tool === 'new-country' ? state.newCountryCandidates : [];
          return {
            boundaryEdit: boundarySegments.length || boundaryHandles.length ? { segments: boundarySegments, handles: boundaryHandles } : null,
            territoryOperation: territoryItems.length || candidates.length ? {
              kind: state.tool,
              phase: state.tool === 'annex-territory' ? state.annexPhase : state.newCountryPhase,
              components: territoryItems.map(item => ({ ...item, hovered: item.key === state.annexHoveredComponentKey })),
              candidates: candidates.map((item, index) => ({
                index,
                geometry: item.geometry,
                selected: index === (state.tool === 'annex-territory' ? state.annexSelectedCandidateIndex : state.newCountrySelectedCandidateIndex),
              })),
            } : null,
          };
        },
        handleTerritoryInteraction: event => {
          if (event.type === 'territory-component-hover') state.annexHoveredComponentKey = event.componentKey;
          else if (event.type === 'territory-component-leave' && state.annexHoveredComponentKey === event.componentKey) state.annexHoveredComponentKey = null;
          else if (event.type === 'territory-component-toggle') toggleTerritoryComponentSelection(event.componentKey);
          else if (event.type === 'territory-candidate-select') selectTerritoryCandidate(event.candidateIndex);
          else return false;
          return true;
        },
      },
      getImportCommitter: getGisImportCommitter,
      onEditingStateChanged: snapshot => {
        state.tool = snapshot.activeTool;
        $('map')?.classList.toggle('draft-stroke-active', snapshot.draft.strokeActive);
        syncCutDraftFeedback(snapshot.draft.cutAssessment, !!snapshot.draft.hover);
        if (!snapshot.draft.cutAssessment && !snapshot.draft.hover) syncGenericDraftFeedback(snapshot.draft);
        updateModeButtons();
        projectUi.syncHistory();
      },
      transactionRunner: ({ domain, patch: geometryPatch }) => {
        if (geometryPatch?.commit && typeof geometryPatch.commit === 'function') return geometryPatch.commit();
        const error = new TypeError(`${domain} geometry patch requires an explicit transaction commit().`);
        error.code = 'PL-EDIT-TRANSACTION-001';
        throw error;
      },
    });

    renderingDomain = createRenderingDomain({
      context: domainContext,
      gpuMapRenderer,
      sceneBuilder: renderSceneBuilder,
      mapHost: () => mapHost,
      selectionDomain,
      projectDomain,
      getEditingRenderPacket: () => editingDomain?.createRenderPacket?.(),
      emitEditingInteraction: event => editingDomain?.handleInteraction?.(event),
      domLayers: () => ({
        baseSvg,
        svg,
        interactionSvg,
        gpuCanvas: $('map')?.querySelector('.gpu-map-canvas') || null,
      }),
      labelResources: createResourceSnapshot('labels', {
        d3,
        countryLabelLayer,
        labelLayer,
        svg,
        getState: () => state,
        visibleLabelLayout,
        mapClickBlocked,
        handleObjectSelectionAt,
        toggleNewCountrySource,
        toggleAnnexDonor,
        toggleMergeTarget,
        toggleBoundaryEditCountry,
        countryType: TERRITORIAL_UNIT_TYPES.COUNTRY,
        countryName,
        layerStyle,
        isMobile,
        automaticLabelSettings,
        labelSettings: (currentState, domain, id) => currentState.labelSettings?.[labelKey(domain, id)] || {},
        labelKey,
        countryLabelAnchors: () => countryLabelAnchors,
        activeProjection,
        projectVisibleCoordinate,
        isCoordVisible,
        labelDragBehavior,
        normalizeObjectRef,
        selectionSnapshot: () => selectionDomain.snapshot().selection,
        selectionHas: ref => selectionDomain.has(ref),
      }, {
        countryLabelLayer: () => countryLabelLayer,
        labelLayer: () => labelLayer,
        svg: () => svg,
      }),
      countryResources: createResourceSnapshot('countries', {
        getState: () => state,
        getViewRevision: () => viewRevision,
        countryLayer,
        path,
        countryOutlineFeature,
        countryFeatureById,
        isLayerItemVisible,
        renderPendingCountryOverlays,
        selectionGeometryRevision,
        countryColor,
        mapTheme,
        resolvedInteractionStyle: () => resolvedInteractionStyle,
        replaceGpuSceneDomain,
        syncGpuRenderScene,
        gpuMapRenderer,
        applyGpuSceneCoverage,
        applyGpuInteractionCoverage,
      }, {
        countryLayer: () => countryLayer,
      }),
      hydroResources: createResourceSnapshot('hydro', {
        getState: () => state,
        getStateRevision: () => state.stateRevision,
        hydroLakeLayer,
        hydroRiverLayer,
        hydroEditLayer,
        gpuMapRenderer,
        layerStyle,
        hydroRenderGroups,
        hydroDisplayColor,
        hydroEditColor,
        path,
        visibleMapObjectCandidates,
        geometryMayIntersectViewport,
        isHydroFeatureVisible,
        normalizeObjectRef,
        selectionHas: ref => selectionDomain.has(ref),
        viewportCullingMetrics,
        setMapHover,
        mapClickBlocked,
        d3,
        svg: svg?.node?.() || svg,
        handleObjectSelectionAt,
        buildRenderableStrokeFeature,
      }, {
        hydroLakeLayer: () => hydroLakeLayer,
        hydroRiverLayer: () => hydroRiverLayer,
        hydroEditLayer: () => hydroEditLayer,
        svg: () => svg?.node?.() || svg,
      }),
      territorialResources: createResourceSnapshot('territorial', {
        getState: () => state,
        territorialUnitLayer,
        territorialOperationLayer,
        TERRITORIAL_UNIT_TYPES,
        visibleMapObjectCandidates,
        geometryMayIntersectViewport,
        isLayerItemVisible,
        selectionHas: ref => selectionDomain.has(ref),
        normalizeObjectRef,
        viewportCullingMetrics,
        setMapHover,
        mapClickBlocked,
        toggleTerritorialUnitMergeTarget,
        d3,
        svg: svg?.node?.() || svg,
        handleObjectSelectionAt,
        path,
        territorialStyleColor,
        territorialUnitColor,
        presentationGroupForTerritorialFeature,
        layerStyle,
        selectionGeometryRevision,
        gpuSceneOrder,
        resolvedInteractionStyle: () => resolvedInteractionStyle,
        replaceGpuSceneDomain,
        buildRenderableStrokeFeature,
      }, {
        territorialUnitLayer: () => territorialUnitLayer,
        territorialOperationLayer: () => territorialOperationLayer,
        svg: () => svg?.node?.() || svg,
      }),
      genericResources: createResourceSnapshot('generic', {
        getState: () => state,
        genericFeatureLayer,
        path,
        genericFeatureDisplayFeature,
        genericFeatureColor,
        visibleMapObjectCandidates,
        isLayerItemVisible,
        geometryMayIntersectViewport,
        normalizeObjectRef,
        selectionHas: ref => selectionDomain.has(ref),
        selectionSnapshot: () => selectionDomain.snapshot().selection,
        viewportCullingMetrics,
        mapClickBlocked,
        d3,
        svg: svg?.node?.() || svg,
        handleObjectSelectionAt,
        setMapHover,
        toggleGenericFeatureMergeTarget,
        layerStyle,
        selectionGeometryRevision,
        gpuSceneOrder,
        resolvedInteractionStyle: () => resolvedInteractionStyle,
        replaceGpuSceneDomain,
        buildRenderableStrokeFeature,
      }, {
        genericFeatureLayer: () => genericFeatureLayer,
        svg: () => svg?.node?.() || svg,
      }),
      distributionResources: createResourceSnapshot('distribution', {
        getState: () => state,
        distributionLayer,
        distributionEntriesForLayer,
        dominantDistributionEntries,
        territorialRepository,
        featureFromGeometry,
        geometryBounds,
        distributionColor,
        DISTRIBUTION_TYPES,
        DISTRIBUTION_MODES,
        DISTRIBUTION_RENDER_MODES,
        DISTRIBUTION_TYPE_GROUPS,
        visibleMapObjectCandidates,
        geometryMayIntersectViewport,
        isLayerItemVisible,
        normalizeObjectRef,
        selectionHas: ref => selectionDomain.has(ref),
        viewportCullingMetrics,
        mapClickBlocked,
        d3,
        svg: svg?.node?.() || svg,
        handleObjectSelectionAt,
        setMapHover,
        layerStyle,
        selectionGeometryRevision,
        gpuSceneOrder,
        replaceGpuSceneDomain,
        buildRenderableStrokeFeature,
        getCountryGeometryRevision: () => countryLandRevision,
        getDistributionVisibilityRevision: () => distributionVisibilityRevision,
      }, {
        distributionLayer: () => distributionLayer,
        svg: () => svg?.node?.() || svg,
      }),
      territorialBoundaryResources: createResourceSnapshot('territorialBoundary', {
        getState: () => state,
        getCountryLandRevision: () => countryLandRevision,
        getTerritorialGeometryRevision: () => mapObjectGeometryRevisions.territorial,
        geometryToken: geometry => territorialBoundaryGeometryToken(geometry),
        buildTerritorialInternalBoundarySegments,
        territorialUnitColor,
        layerStyle,
        presentationGroupForTerritorialFeature,
        mapTheme,
        territorialBoundaryLayer,
        path,
        replaceGpuSceneDomain,
        gpuSceneOrder,
      }, {
        territorialBoundaryLayer: () => territorialBoundaryLayer,
      }),
      baseResources: createResourceSnapshot('base', {
        getState: () => state,
        updatePandoGlobeShell,
        graticule,
        graticuleLayer,
        path,
        gpuMapRenderer,
        replaceGpuSceneDomain,
        buildGraticuleStrokeGeometryPacket,
        getProjection: () => state.projection,
        isLightTheme: () => (document.documentElement.dataset.theme || window.__PANDOLAB_THEME__ || systemTheme) === 'light',
      }, {
        graticuleLayer: () => graticuleLayer,
      }),
      projectedOverlayResources: createResourceSnapshot('projectedOverlays', {
        layers: null,
        path,
      }, {
        layers: () => [territorialBoundaryLayer, overlayStackLayer, hydroEditLayer, territorialOperationLayer],
      }),
      selectionResources: createResourceSnapshot('selection', {
        getState: () => state,
        countryType: TERRITORIAL_UNIT_TYPES.COUNTRY,
        selectionLayer,
        hoverLayer,
        d3,
        path,
        document,
        selectionPass,
        resolvedInteractionStyle: () => resolvedInteractionStyle,
        countryDisplayFeature,
        countryOutlineFeature,
        mapFeatureForObjectRef,
        selectionGeometryRevision,
        buildRenderableStrokeFeature,
        buildSelectionBoundarySegments,
        getCountryLandRevision: () => countryLandRevision,
        getStateRevision: () => state.stateRevision,
        getTerritorialBoundaryRevision: () => renderingDomain?.getTerritorialBoundaryStats?.().revision || '',
        getViewRevision: () => viewRevision,
        getProjection: () => state.projection,
        isMobile,
        gpuMapRenderer,
        buildGpuInteractionFillItems,
        syncGpuInteractionState,
        setCurrentSelectionPacket: packet => { currentSelectionPacket = packet || null; },
        updatePerformanceMetrics: partial => Object.assign(selectionPerformanceMetrics, partial || {}),
        publishMetrics: metrics => {
          window.__PANDOLAB_SELECTION_RENDER_METRICS__ = {
            ...(window.__PANDOLAB_SELECTION_RENDER_METRICS__ || {}),
            ...metrics,
          };
        },
        reportError: ({ stage = 'selection-overlay-render', error } = {}) => {
          reliabilityDiagnostic.push({
            category: 'render',
            operation: 'selection-overlay-render',
            result: 'recovered',
            errorCode: '',
            technicalMessage: String(error?.message || error || stage),
            stack: error?.stack || '',
          });
          console.warn(`[${stage}] 직전 정상 선택 프레임을 유지합니다.`, error);
        },
      }, {
        selectionLayer: () => selectionLayer,
        hoverLayer: () => hoverLayer,
        selectionPass: () => selectionPass,
      }),
      interactionResources: createResourceSnapshot('interaction', {
        draftLayer,
        d3,
        svg,
        isMobile,
        selectionStyle: SELECTION_STYLE,
        projectedLineDistance,
        formatTerritoryArea,
        setModeBanner,
        previewLayer,
        validationLayer,
        snapLayer,
        path,
        featureFromGeometry,
        hasAreaGeometry,
        buildRenderableStrokeFeature,
        issueCoordinate,
        getValidationPacket: () => ({
          issues: state.audit?.report?.issues || state.geometryPreview?.session?.validation?.issues || [],
          selectedIssueId: state.audit?.selectedIssueId || null,
        }),
        geometryMayIntersectViewport,
        isCoordVisible,
        activeProjection,
        syncGpuInteractionLayer,
        applyGpuInteractionCoverage,
        scheduleSpatialIndexRebuild: () => mapWorkScheduler.scheduleIdle('map-object-spatial-index', () => rebuildMapObjectSpatialIndex(), 40),
        getViewRevision: () => viewRevision,
        getViewState: () => window.__PANDOLAB_VIEW_STATE__ || null,
      }, {
        draftLayer: () => draftLayer,
        previewLayer: () => previewLayer,
        validationLayer: () => validationLayer,
        snapLayer: () => snapLayer,
        svg: () => svg,
      }),
      editingRenderResources: createResourceSnapshot('editing', {
        isCoordVisible,
        activeProjection,
        currentMapZoom,
        isMobile,
        path,
        d3,
        vertexLayer,
        boundaryEditLayer,
        replaceGpuSceneDomain,
        getEditInteractionRevision: () => editInteractionRevision,
        getInteractionStyle: () => resolvedInteractionStyle,
      }, {
        vertexLayer: () => vertexLayer,
        boundaryEditLayer: () => boundaryEditLayer,
      }),
      refreshRenderResources,
      requestFrame: callback => requestAnimationFrame(callback),
      prepareView: ({ frameId } = {}) => {
        updateProjection();
        const viewState = syncViewRevision();
        if (lastVisualProjectionKind !== viewState.projection) {
          lastVisualProjectionKind = viewState.projection;
          visualProjectionRevision += 1;
        }
        const visualProjection = visualProjectionForSnapshot(viewState);
        const visualPath = d3.geo.path().projection(visualProjection);
        return createMapVisualFrame({
          frameId,
          viewRevision: viewState.revision,
          projectGeneration: projectDomain?.getGeneration?.() || 0,
          projectionRevision: visualProjectionRevision,
          viewState,
          layoutSnapshot: mapLayoutMetricsSnapshot,
          projectCoordinate: coordinate => visualProjection(coordinate),
          projectPath: geometry => visualPath(geometry),
        });
      },
      onFrameComplete: handleRenderFrameComplete,
      invalidMaskMode: ['localhost', '127.0.0.1', '::1'].includes(location.hostname)
        || new URLSearchParams(location.search).has('debug')
        || new URLSearchParams(location.search).has('perf')
        ? 'throw'
        : 'report',
      renderers: {
        view: visualFrame => gpuMapRenderer.renderFrame(visualFrame),
        stackOverlays: applyOverlayStackOrder,
        labelLayout: visibleLabelLayout,
        debug: (...args) => mapDebug.renderPanel(...args),
        layerTree: (...args) => layerTreeController?.render?.(...args),
      },
      reportDiagnostic: entry => reliabilityDiagnostic.push({ category: 'rendering-domain', ...entry }),
    });

  }

  const lifecycle = createApplicationLifecycle({
    window,
    compose: [
      () => {
        projectUi = createProjectUiBridge({
          getElement: $,
          getSaveSnapshot: () => saveState.snapshot(),
          getEditingSnapshot: () => ({ processing: state.modeProcessing, previewActive: !!state.geometryPreview.session }),
          getDraftSnapshot: editingDraftSnapshot,
          requireCanonicalData,
          discardActiveGeometryPreview,
          draftInputActive: () => editingDomain?.draftInputActive?.(),
          undoDraft: () => editingDomain?.performDraftUndo(),
          redoDraft: () => editingDomain?.performDraftRedo(),
          canUndo: () => projectDomain?.canUndo() || false,
          canRedo: () => projectDomain?.canRedo() || false,
          undoProject: meta => projectDomain.undo(meta),
          redoProject: meta => projectDomain.redo(meta),
          createEmptyProject: () => projectDomain.createEmpty(),
          setActionStatus,
          closeFileMenu,
          openConfirmModal,
        });
        propertyEditorUi = createPropertyEditorBindings({
          getElement: $,
          document,
          getPrimary: () => selectionDomain.primary(),
          getGenericFeature: id => state.genericFeatures.find(feature => String(feature.id) === String(id)),
          TERRITORIAL_UNIT_TYPES,
          bindColorPickers,
          commitGenericFeatureMeta,
          commitHydroEdit,
          commitTerritorialUnitMeta,
          commitDistributionMeta,
          commitLabelEdit,
          removeDistributionEntry,
          addTerritorialDistributionEntry,
          requestDraftDiscard,
          returnToMapAfterMobileAction,
          startGeometryDistributionDraft,
          requestTerritorialUnitDivisionRemoval,
          enterTerritorialUnitSplitMode,
          enterTerritorialUnitMergeMode,
          enterTerritorialUnitRedrawMode,
          territorialUnitById,
          reconcileAdminCountryCoast,
          requestTerritorialUnitPromotion,
          openTerritorialTypeModal,
          syncTerritorialTypeModal,
          closeTerritorialTypeModal,
          confirmTerritorialTypeConversion,
          setEditorShellView,
          setActionStatus,
          focusObjectRef,
          enterGenericFeatureSplitMode,
          enterGenericFeatureMergeMode,
          alignSelectedGenericFeatureToOwnerLand,
          countryFeatureById,
          enterCountryCoastEdit,
          openConfirmModal,
          applySelectedGenericFeatureToOwnerCountry,
          promoteSelectedGenericFeatureToCountry,
          copySelectedHydroForEditing,
          closeObjectActionsMenu,
          batchSetVisibility,
          enterCountryBorderEditFromSelection,
          undo: () => projectUi.undo(),
          redo: () => projectUi.redo(),
        });
        gisWorkflow = createGisWorkflowController({
          loadRuntime: async () => { await Promise.all([ensureGisRuntime(), ensureGisIoRuntime(), ensureModalRuntime()]); return { importServiceModule, createGisImportWizardController, buildTerritorialImportTransactionPlan, resolveCountryIdentities, identityResolutionSummary, materializeResolvedCountries }; },
          onRuntimeReady: ({ appendSourceInfo, applyPackageAssets, readImportedOverrides }) => { appendImportedSourceInfo = appendSourceInfo; applyImportedPackageAssets = applyPackageAssets; importedCountryOverrides = readImportedOverrides; },
          getCountries: () => state.countriesData,
          getTerritorialUnits: () => state.territorialUnits,
          getSaveSnapshot: () => saveState.snapshot(),
          getProjectGeneration: () => projectDomain.getGeneration(),
          getGisIo: async () => { await ensureGisIoRuntime(); return window.PandoLabGIS; },
          createGeometryWorker: () => new Worker(runtimeAssetUrl('workers/gis-geometry-worker.js'), { name: 'pandolab-gis-geometry' }),
          clipper: window.polygonClipping,
          countryName,
          layerNameCollator,
          TERRITORIAL_UNIT_TYPES,
          territorialUnitName,
          sphericalGeometryAreaKm2,
          createProjectObjectId,
          deepClone,
          featureCountryId,
          geometryBounds,
          boundsOverlap,
          normalizeClippedLandGeometry,
          geometryMultiCoordinates,
          multiPolygonPlanarArea,
          validateStructuredGeometry,
          setActionStatus,
        });
        mapDebug = createMapDebugController({
          getElement: $,
          window,
          document,
          location,
          localStorage,
          readDiagnostics: () => ({ state: { projection: state.projection, stateRevision: state.stateRevision, pendingCountryRenderIds: new Set(state.pendingCountryRenderIds), physicalLoadState: { ...state.physicalLoadState }, audit: state.audit }, viewRevision, mapHost, renderingDomain, selectionDomain, selectionPass, resolvedInteractionStyle, labelLayoutMetrics, mapLayoutMetricsRefreshCount, mapLayoutMetricsSnapshot }),
          getFeatureBounds: feature => path.bounds(feature),
          gpuMapRenderer,
          mapEditClient,
          editPreviewController,
          editPipelineMetrics,
          MAP_HOST_KINDS,
          mapInteractionGate,
          selectionPerformanceMetrics,
          boundarySelectionAnalysisMetrics,
          selectionPerformanceBaseline,
          mapObjectSpatialIndex,
          viewportCullingMetrics,
          distributionRenderRowCache,
          renderQualityController,
          renderSceneBuilder,
          deepClone,
          updateProjection,
          projectionViewSnapshot,
          screenToGeo,
          activeProjection,
          validLabelAnchor,
          countryLabelAnchors,
          runFullMapAudit,
          clearMapAudit,
          focusAuditIssue,
        });
      },
      initializeDomainBoundaries,
      () => {
        mapInputPresentation = createMapInputPresentation({
          getElement: $,
          window,
          d3,
          navigator,
          createMapInputController,
          getInputSnapshot: () => ({ moving: state.mapMoving, spacePanActive: state.spacePanActive, tool: state.tool, projection: state.projection, globeZoom: state.view.globeZoom, flatZoom: state.view.flatZoom, annexPhase: state.annexPhase, newCountryPhase: state.newCountryPhase, labelPlacementMode: state.labelPlacementMode }),
          setMoving: value => { state.mapMoving = value; },
          clearHoverHit: () => { lastHoverHit = null; },
          getQualityTier: () => currentRenderQuality.tier,
          getRevision: () => editInteractionRevision,
          getDraftSnapshot: editingDraftSnapshot,
          renderQualityController,
          mapWorkScheduler,
          gpuMapRenderer,
          renderingDomain,
          editingDomain,
          selectionDomain,
          projectDomain,
          mapInteractionGate,
          applyAdaptiveRenderQuality,
          queueAdaptiveRenderQualityRefresh,
          cancelCountryHoverPick,
          suppressNextMapClick,
          mapNavigationEnabled,
          dragMapBy,
          transformMapView,
          zoomBy,
          isMobile,
          isGenericFeatureDraftTool,
          handleMapClick,
          dispatchEditingInteraction,
          mapClickBlocked,
          screenToGeo,
          queueCountryHoverPick,
        });
          mapDebug.installRenderFacade();
      },
    ],
    startup: init,
    onReady: () => { runtimeReady = true; },
    onError: showFatalError,
    getDisposables: () => [editorWorkspacePresentation, mapInputPresentation, propertyEditorUi, renderingDomain, editingDomain, selectionDomain, gisWorkflow, gisDomain, projectDomain],
    reportDisposeError: error => reliabilityDiagnostic.push({ category: 'dispose', message: String(error?.message || error) }),
  });
  void lifecycle.start();
})();
