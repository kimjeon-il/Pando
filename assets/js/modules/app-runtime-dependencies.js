/* PandoLab v0.31.0
 * GitHub Pages-ready static map editor.
 * Rendering: bundled D3 v3 + Natural Earth 5.1.1 Admin 0 Countries 1:10m.
 * The full 1:10m geometry remains canonical; rendering and editing use lossless source data.
 * Source: naturalearthdata.com (public domain), default de facto boundary viewpoint.
 */

const moduleRevision = new URL(import.meta.url).searchParams.get('v') || globalThis.PANDOLAB_BUILD_META?.assetRevision || '';
const { missingLibraryOwnership, prepareLibraryOwnership, shouldShowTerritorialParentChoice, territorialParentChoices } = await import(`./library-ownership.js?v=${encodeURIComponent(moduleRevision)}`);
const { BUILTIN_TERRITORY_MERGES } = await import(`./builtin-territory-policy.js?v=${encodeURIComponent(moduleRevision)}`);
const { layoutTerritorialFlags } = await import(`./territorial-label-flags.js?v=${encodeURIComponent(moduleRevision)}`);
const { createTerritorialScopeResolver } = await import(`./territorial-scope.js?v=${encodeURIComponent(moduleRevision)}`);
const { createTerritorialEntityRepository } = await import(`./territorial-entity-repository.js?v=${encodeURIComponent(moduleRevision)}`);
const { createTerritorialEntityStore } = await import(`./territorial-entity-store.js?v=${encodeURIComponent(moduleRevision)}`);
const { classifyBuiltinCountries, builtinSubunitSourceId } = await import(`./builtin-subunits.js?v=${encodeURIComponent(moduleRevision)}`);
const versionedModuleUrl = relativePath => {
  const url = new URL(relativePath, new URL('../app.js', import.meta.url));
  url.searchParams.set('v', moduleRevision);
  return url.href;
};
await import(versionedModuleUrl('./modules/polygon-geometry.js'));
const { createGisFileController } = await import(versionedModuleUrl('./modules/gis-file-controller.js'));
const polygonGeometry = globalThis.PandoLabPolygonGeometry;
if (!polygonGeometry) throw new Error('폴리곤 지오메트리 정규화 모듈을 불러오지 못했습니다.');

const [projectStateModule, mapEditTransactionModule, territorialUnitsModule, distributionModelModule, surfaceControllerModule, toolControllerModule, mapInputControllerModule, gpuMapRendererModule, territorialGeometryModule, selectControllerModule, startupReadinessModule, boundaryTopologyModule, geometryMetricsModule, geometryPreviewModule, geometryValidationModule, labelLayoutModule, mapStateTransitionModule, objectRefModule, layerPresentationModule, saveStateModule, colorAdapterModule, projectSerializerModule, persistenceServiceModule, browserProjectStorageModule, physicalLayerServiceModule, territorialServiceModule, distributionServiceModule, genericFeatureServiceModule, tooltipControllerModule, layerTreeControllerModule, historyServiceModule, mapEditWorkerClientModule, mapObjectSpatialIndexModule, surfaceTabsControllerModule] = await Promise.all([
  import(versionedModuleUrl('./modules/project-state.js')),
  import(versionedModuleUrl('./modules/map-edit-transaction.js')),
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
  import(versionedModuleUrl('./modules/browser-project-storage.js')),
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
const { normalizeCountryCollection } = await import(versionedModuleUrl('./modules/country-feature.js'));
const {
  PROJECT_SCHEMA_VERSION,
  applyProjectFields,
  assertCurrentProjectSchema,
  createProjectObjectId,
  pickProjectFields,
  restoreEntitiesFromDelta,
} = projectStateModule;
const { COLOR_DOMAINS, normalizeColorValue, readDomainColor, writeDomainColor } = colorAdapterModule;
const { createProjectSerializer } = projectSerializerModule;
const { createPersistenceService } = persistenceServiceModule;
const { createBrowserProjectStorage } = browserProjectStorageModule;
const { createHydroService, createTerrainService } = physicalLayerServiceModule;
const { createTerritorialApplicationService } = territorialServiceModule;
const { createDistributionService } = distributionServiceModule;
const {
  GENERIC_FEATURE_ROLE_RULES,
  GENERIC_FEATURE_ROLE_LABELS,
  GENERIC_FEATURE_SCHEMA_VERSION,
  createGenericFeatureService,
  genericFeatureGeometryKind,
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
const selectionToolbarPresentationModule = await import(versionedModuleUrl('./modules/selection-toolbar-presentation.js'));
const territorialPropertyControllerModule = await import(versionedModuleUrl('./modules/territorial-property-controller.js'));
const objectPropertyControllerModule = await import(versionedModuleUrl('./modules/object-property-controller.js'));
const { effectiveTerritorialFlagUrl } = countryFlagsModule;
const { createProjectDomain } = projectDomainModule;
const { createProjectCommandPipeline } = projectCommandPipelineModule;
const { createSelectionDomain } = selectionDomainModule;
const { createRenderingDomain } = renderingDomainModule;
const { createGisDomain } = gisDomainModule;
const { createEditingDomain } = editingDomainModule;
const { createSelectionUiController } = selectionUiControllerModule;
const { createSelectionToolbarPresentation } = selectionToolbarPresentationModule;
const { createTerritorialPropertyController } = territorialPropertyControllerModule;
const { createObjectPropertyController } = objectPropertyControllerModule;

const { createProjectUiBridge } = await import(versionedModuleUrl('./modules/project-ui-bridge.js'));
const { createPropertyEditorBindings } = await import(versionedModuleUrl('./modules/property-editor-bindings.js'));
const { createMapInputPresentation } = await import(versionedModuleUrl('./modules/map-input-presentation.js'));
const { createGisWorkflowController } = await import(versionedModuleUrl('./modules/gis-workflow-controller.js'));
const { createMapDebugController } = await import(versionedModuleUrl('./modules/map-debug-controller.js'));
const { createApplicationLifecycle } = await import(versionedModuleUrl('./modules/application-lifecycle.js'));

let modalRuntimePromise = null;
let gisRuntimePromise = null;
let territorialLibraryRuntimePromise = null;
let gisIoRuntimePromise = null;
let gisExportControllerPromise = null;
let gisExportController = null;
let createConfirmModalController;
let createCoastReconciliationController;
let importServiceModule;
let appendImportedSourceInfo;
let applyImportedPackageAssets;
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
let territorialLibraryServiceModule;
let territorialEntityLoaderModule;
let territorialLibraryControllerModule;
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

async function ensureTerritorialLibraryRuntime() {
  if (territorialLibraryRuntimePromise) return territorialLibraryRuntimePromise;
  const startedAt = performance.now();
  territorialLibraryRuntimePromise = Promise.all([
    window.PANDOLAB_ENSURE_MODAL_STYLES?.() || Promise.resolve(),
    import(versionedModuleUrl('./modules/territorial-library.js')),
    import(versionedModuleUrl('./modules/territorial-library-service.js')),
    import(versionedModuleUrl('./modules/territorial-library-controller.js')),
    import(versionedModuleUrl('./modules/territorial-entity-loader.js')),
  ]).then(([, library, service, controller, loader]) => {
    territorialLibraryServiceModule = service;
    territorialEntityLoaderModule = loader;
    territorialLibraryControllerModule = controller;
    ({ LIBRARY_ENTITY_TYPES, selectGeometryVersion } = library);
    recordLazyRuntime('lazyTerritorialLibraryLoadedMs', startedAt);
    return { library, service, controller };
  }).catch(error => {
    territorialLibraryRuntimePromise = null;
    recordLazyRuntimeError();
    throw error;
  });
  return territorialLibraryRuntimePromise;
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
const { runMapEditTransaction } = mapEditTransactionModule;
const {
  TERRITORIAL_COVERAGE_MODES,
  createTerritorialFeature,
  normalizeTerritorialEntities,
  territorialRootId,
  runTerritorialTransaction,
} = territorialUnitsModule;
const {
  DISTRIBUTION_SCHEMA_VERSION,
  DISTRIBUTION_MODES,
  DISTRIBUTION_RENDER_MODES,
  createDistributionEntry,
  createDistributionLayer,
  distributionEntriesForLayer,
  normalizeDistributionEntries,
  normalizeDistributionLayers,
  validateDistributionModel,
} = distributionModelModule;
const { createSurfaceController } = surfaceControllerModule;
const { createEditorWorkspacePresentation } = await import(versionedModuleUrl('./modules/editor-workspace-presentation.js'));
const { describeTool, dispatchTool, isSpecialTool, toolCursorMode, toolDraftDefinition, toolLabel } = toolControllerModule;
const { createMapInputController } = mapInputControllerModule;
const { createGpuMapRenderer } = gpuMapRendererModule;
const { snapLineEndpointsToBoundary } = territorialGeometryModule;
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
const { OVERLAY_GROUPS, layerStyle, layerObjectRank, normalizeLayerPresentation, resolveLayerDisplayColor } = layerPresentationModule;
const { AUTOSAVE_STATES, createSaveStateController } = saveStateModule;
const {
  ensureClosedRing,
  hasCanonicalPolygonWinding,
  normalizePolygonGeometry,
  orientRing,
  ringSignedArea,
} = polygonGeometry;

export {
  moduleRevision,
  missingLibraryOwnership,
  prepareLibraryOwnership,
  shouldShowTerritorialParentChoice,
  territorialParentChoices,
  BUILTIN_TERRITORY_MERGES,
  layoutTerritorialFlags,
  createTerritorialScopeResolver,
  classifyBuiltinCountries,
  builtinSubunitSourceId,
  versionedModuleUrl,
  createGisFileController,
  polygonGeometry,
  projectStateModule,
  mapEditTransactionModule,
  territorialUnitsModule,
  distributionModelModule,
  surfaceControllerModule,
  toolControllerModule,
  mapInputControllerModule,
  gpuMapRendererModule,
  territorialGeometryModule,
  selectControllerModule,
  startupReadinessModule,
  boundaryTopologyModule,
  geometryMetricsModule,
  geometryPreviewModule,
  geometryValidationModule,
  labelLayoutModule,
  mapStateTransitionModule,
  objectRefModule,
  layerPresentationModule,
  saveStateModule,
  colorAdapterModule,
  projectSerializerModule,
  persistenceServiceModule,
  physicalLayerServiceModule,
  territorialServiceModule,
  distributionServiceModule,
  genericFeatureServiceModule,
  tooltipControllerModule,
  layerTreeControllerModule,
  historyServiceModule,
  mapEditWorkerClientModule,
  mapObjectSpatialIndexModule,
  surfaceTabsControllerModule,
  createSemanticIcon,
  normalizeCountryCollection,
  PROJECT_SCHEMA_VERSION,
  applyProjectFields,
  assertCurrentProjectSchema,
  createProjectObjectId,
  pickProjectFields,
  COLOR_DOMAINS,
  normalizeColorValue,
  readDomainColor,
  writeDomainColor,
  createProjectSerializer,
  restoreEntitiesFromDelta,
  createBrowserProjectStorage,
  createPersistenceService,
  createHydroService,
  createTerrainService,
  createTerritorialApplicationService,
  createDistributionService,
  GENERIC_FEATURE_ROLE_RULES,
  GENERIC_FEATURE_ROLE_LABELS,
  GENERIC_FEATURE_SCHEMA_VERSION,
  createGenericFeatureService,
  genericFeatureGeometryKind,
  genericFeatureRole,
  normalizeGenericFeatureCollection,
  normalizeGenericFeatureSemantics,
  createTooltipController,
  createAppLayerTreeController,
  setScopedItemVisibility,
  createHistoryService,
  createMapEditWorkerClient,
  createMapObjectSpatialIndex,
  createSurfaceTabsController,
  mapObjectCategoriesModule,
  MAP_OBJECT_CATEGORIES,
  MAP_OBJECT_CATEGORY_ORDER,
  MAP_OBJECT_TYPES,
  reliabilityCoreModule,
  projectInvariantsModule,
  selectionStyleModule,
  selectionStrokeGeometryModule,
  selectionPassModule,
  selectionPacketModule,
  selectionPerformanceBaselineModule,
  renderSceneModule,
  adaptiveRenderQualityModule,
  editPreviewControllerModule,
  mapHostModule,
  legacyMapHostModule,
  mapInteractionGateModule,
  mapInteractionStyleModule,
  graticuleGeometryModule,
  userPreferencesModule,
  applyAppAccent,
  notificationCopyModule,
  countryFlagsModule,
  mapLayoutMetricsModule,
  mapVisualFrameModule,
  createRingHitTester,
  projectDomainModule,
  projectCommandPipelineModule,
  selectionDomainModule,
  renderingDomainModule,
  gisDomainModule,
  editingDomainModule,
  selectionUiControllerModule,
  selectionToolbarPresentationModule,
  territorialPropertyControllerModule,
  objectPropertyControllerModule,
  effectiveTerritorialFlagUrl,
  createProjectDomain,
  createProjectCommandPipeline,
  createSelectionDomain,
  createRenderingDomain,
  createGisDomain,
  createEditingDomain,
  createSelectionUiController,
  createSelectionToolbarPresentation,
  createTerritorialPropertyController,
  createObjectPropertyController,
  createProjectUiBridge,
  createPropertyEditorBindings,
  createMapInputPresentation,
  createGisWorkflowController,
  createMapDebugController,
  createApplicationLifecycle,
  modalRuntimePromise,
  gisRuntimePromise,
  territorialLibraryRuntimePromise,
  gisIoRuntimePromise,
  gisExportControllerPromise,
  gisExportController,
  createConfirmModalController,
  createCoastReconciliationController,
  importServiceModule,
  appendImportedSourceInfo,
  applyImportedPackageAssets,
  createGisImportWizardController,
  buildTerritorialImportTransactionPlan,
  resolveImportedCountryId,
  identityResolutionSummary,
  materializeResolvedCountries,
  resolveCountryIdentities,
  analyzeAdminCountryCoast,
  normalizeCoastDecision,
  planCoastReconciliations,
  validateCoastReplacement,
  planDrawnTerritoryAnnex,
  buildRiverTerritoryPartitions,
  composeRiverBoundaryTerritoryComponents,
  RIVER_TERRITORY_PARTITION_ALGORITHM_REVISION,
  RIVER_TERRITORY_PARTITION_CONFIG,
  riverTerritoryPartitionConfigFingerprint,
  territorialLibraryServiceModule,
  territorialEntityLoaderModule,
  territorialLibraryControllerModule,
  LIBRARY_ENTITY_TYPES,
  selectGeometryVersion,
  recordLazyRuntime,
  recordLazyRuntimeError,
  ensureModalRuntime,
  ensureGisRuntime,
  loadClassicRuntime,
  ensureGisIoRuntime,
  ensureTerritorialLibraryRuntime,
  RELIABILITY_ERROR_CATEGORIES,
  createCancellationError,
  createDiagnosticLog,
  createOperationalError,
  fetchWithRetry,
  isAbortError,
  assertProjectReferenceIntegrity,
  SELECTION_STYLE,
  setSelectionColor,
  setSelectionInteractionStyle,
  buildSelectionBoundarySegments,
  createSelectionPass,
  createSelectionPacket,
  createSelectionPerformanceBaseline,
  createRenderSceneBuilder,
  createAdaptiveRenderQualityController,
  createEditPreviewController,
  MAP_HOST_KINDS,
  normalizeMapSurfaceDragDelta,
  createLegacyMapHost,
  buildGraticuleStrokeGeometryPacket,
  createMapInteractionGate,
  resolveMapInteractionStyle,
  loadUserPreferences,
  saveUserPreferences,
  effectiveTheme,
  defaultUserPreferences,
  compactNotificationMessage,
  DEFAULT_SAFE_INSETS,
  createMapLayoutMetricsSnapshot,
  equirectangularCenterForAnchor,
  createMapVisualFrame,
  createSelectController,
  DATA_READINESS,
  READINESS_EVENTS,
  canMutateProject,
  transitionDataReadiness,
  runMapEditTransaction,
  TERRITORIAL_COVERAGE_MODES,
  createTerritorialFeature,
  createTerritorialEntityRepository,
  createTerritorialEntityStore,
  normalizeTerritorialEntities,
  territorialRootId,
  runTerritorialTransaction,
  DISTRIBUTION_SCHEMA_VERSION,
  DISTRIBUTION_MODES,
  DISTRIBUTION_RENDER_MODES,
  createDistributionEntry,
  createDistributionLayer,
  distributionEntriesForLayer,
  normalizeDistributionEntries,
  normalizeDistributionLayers,
  validateDistributionModel,
  createSurfaceController,
  createEditorWorkspacePresentation,
  describeTool,
  dispatchTool,
  isSpecialTool,
  toolCursorMode,
  toolDraftDefinition,
  toolLabel,
  createMapInputController,
  createGpuMapRenderer,
  snapLineEndpointsToBoundary,
  buildSharedBoundaryTopology,
  buildTerritorialInternalBoundarySegments,
  planCoastEdit,
  planSharedBoundaryEdit,
  formatArea,
  sphericalGeometryAreaKm2,
  beginGeometryPreview,
  buildRenderableStrokeFeature,
  buildGeometryPreview,
  clearGeometryPreview,
  createGeometryPreviewState,
  hasAreaGeometry,
  previewIsCurrent,
  validateStructuredGeometry,
  validateTerritorialGeometry,
  LABEL_PRIORITIES,
  automaticLabelSettings,
  labelKey,
  layoutLabels,
  normalizeLabelSettings,
  createAtomicMapStateController,
  normalizeObjectRef,
  OVERLAY_GROUPS,
  layerStyle,
  resolveLayerDisplayColor,
  layerObjectRank,
  normalizeLayerPresentation,
  AUTOSAVE_STATES,
  createSaveStateController,
  ensureClosedRing,
  hasCanonicalPolygonWinding,
  normalizePolygonGeometry,
  orientRing,
  ringSignedArea
};
export function setgisExportControllerPromise(value) { gisExportControllerPromise = value; }
export function setgisExportController(value) { gisExportController = value; }
export function setappendImportedSourceInfo(value) { appendImportedSourceInfo = value; }
export function setapplyImportedPackageAssets(value) { applyImportedPackageAssets = value; }
