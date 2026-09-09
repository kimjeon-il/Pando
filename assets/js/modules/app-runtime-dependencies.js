/* PandoLab v0.31.0
 * GitHub Pages-ready static map editor.
 * Rendering: bundled D3 v3 + Natural Earth 5.1.1 Admin 0 Countries 1:10m.
 * The full 1:10m geometry remains canonical; rendering and editing use lossless source data.
 * Source: naturalearthdata.com (public domain), default de facto boundary viewpoint.
 */

const moduleRevision = new URL(import.meta.url).searchParams.get('v') || globalThis.PANDOLAB_BUILD_META?.assetRevision || '';
const { missingLibraryOwnership, prepareLibraryOwnership, subunitParentChoices } = await import(`./library-ownership.js?v=${encodeURIComponent(moduleRevision)}`);
const { BUILTIN_TERRITORY_MERGES } = await import(`./builtin-territory-policy.js?v=${encodeURIComponent(moduleRevision)}`);
const { layoutCountryFlags } = await import(`./country-label-flags.js?v=${encodeURIComponent(moduleRevision)}`);
const { countryDisplayName, defaultGeographicName } = await import(`./country-display.js?v=${encodeURIComponent(moduleRevision)}`);
const { createTerritorialScopeResolver, validateSubunitParentChanges } = await import(`./territorial-scope.js?v=${encodeURIComponent(moduleRevision)}`);
const { classifyBuiltinCountries, builtinSubunitSourceId } = await import(`./builtin-subunits.js?v=${encodeURIComponent(moduleRevision)}`);
const versionedModuleUrl = relativePath => {
  const url = new URL(relativePath, new URL('../app.js', import.meta.url));
  url.searchParams.set('v', moduleRevision);
  return url.href;
};
await import(versionedModuleUrl('./modules/country-geometry.js'));
const { createGisFileController } = await import(versionedModuleUrl('./modules/gis-file-controller.js'));
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
  [TERRITORIAL_UNIT_TYPES.SUBUNIT]: MAP_OBJECT_TYPES.subunit.label,
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
const { OVERLAY_GROUPS, layerStyle, layerObjectRank, normalizeLayerPresentation } = layerPresentationModule;
const { AUTOSAVE_STATES, createSaveStateController } = saveStateModule;
const {
  ensureClosedRing,
  hasCanonicalCountryWinding,
  normalizeCountryGeometry,
  orientRing,
  ringSignedArea,
} = countryGeometry;

export {
  moduleRevision,
  missingLibraryOwnership,
  prepareLibraryOwnership,
  subunitParentChoices,
  BUILTIN_TERRITORY_MERGES,
  layoutCountryFlags,
  countryDisplayName,
  defaultGeographicName,
  createTerritorialScopeResolver,
  validateSubunitParentChanges,
  classifyBuiltinCountries,
  builtinSubunitSourceId,
  versionedModuleUrl,
  createGisFileController,
  countryGeometry,
  projectStateModule,
  countryEditTransactionModule,
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
  pruneCountryOverrides,
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
  restoreCountriesFromDelta,
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
  genericFeatureLandBinding,
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
  countryPropertyControllerModule,
  objectPropertyControllerModule,
  effectiveCountryFlagUrl,
  createProjectDomain,
  createProjectCommandPipeline,
  createSelectionDomain,
  createRenderingDomain,
  createGisDomain,
  createEditingDomain,
  createSelectionUiController,
  createCountryPropertyController,
  createObjectPropertyController,
  createProjectUiBridge,
  createPropertyEditorBindings,
  createMapInputPresentation,
  createGisWorkflowController,
  createMapDebugController,
  createApplicationLifecycle,
  modalRuntimePromise,
  gisRuntimePromise,
  historicalRuntimePromise,
  gisIoRuntimePromise,
  gisExportControllerPromise,
  gisExportController,
  createConfirmModalController,
  createCoastReconciliationController,
  importServiceModule,
  appendImportedSourceInfo,
  applyImportedPackageAssets,
  importedCountryOverrides,
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
  historicalLibraryServiceModule,
  historicalLibraryControllerModule,
  LIBRARY_ENTITY_TYPES,
  selectGeometryVersion,
  recordLazyRuntime,
  recordLazyRuntimeError,
  ensureModalRuntime,
  ensureGisRuntime,
  loadClassicRuntime,
  ensureGisIoRuntime,
  ensureHistoricalRuntime,
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
  runCountryEditTransaction,
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
  TERRITORIAL_TYPE_LABELS,
  territorialTypeLabel,
  createPartitionTerritorialFeature,
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
  createTerritorialGeometryKernel,
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
  layerObjectRank,
  normalizeLayerPresentation,
  AUTOSAVE_STATES,
  createSaveStateController,
  ensureClosedRing,
  hasCanonicalCountryWinding,
  normalizeCountryGeometry,
  orientRing,
  ringSignedArea
};
export function setgisExportControllerPromise(value) { gisExportControllerPromise = value; }
export function setgisExportController(value) { gisExportController = value; }
export function setappendImportedSourceInfo(value) { appendImportedSourceInfo = value; }
export function setapplyImportedPackageAssets(value) { applyImportedPackageAssets = value; }
export function setimportedCountryOverrides(value) { importedCountryOverrides = value; }
