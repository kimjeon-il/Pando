/** Compose owners, connect their explicit ports, then initialize in dependency order. */
export async function composeApplication({ revision }) {
  const [
    runtime, factoryEnvironment, factoryBuiltinSession, factoryWorkspaceSurfaces, factoryProjectSession,
    factoryObjectCommands, factoryServiceAssembly, factoryRenderQuality, factoryPointerTargets,
    factoryCameraNavigation, factoryReadinessNotifications, factoryCountryIndex, factorySpatialIndex,
    factoryGeometryPreview, factoryTerritoryComponents, factoryCountryValidation, factoryLandRelations,
    factoryCutGeometry, factoryMapProjection, factoryObjectPresentation, factoryHydroSettings,
    factoryLayerList, factoryCountryLabels, factoryPhysicalResources, factoryInteractionPackets,
    factoryTerritoryComponentUi, factoryGpuScene, factoryMapAudit, factoryMapHost, factoryTaskPresentation,
    factoryCountryModes, factoryObjectPicking, factoryRiverCandidates, factoryCountryCommits,
    factoryGenericCommands, factoryPropertySelection, factoryTerritorialDrafts, factoryColorPicker,
    factoryObjectMetadata, factoryTerritorialConversion, factoryProjectSnapshots, factoryMapSettings,
    factoryHistoryAssembly, factoryProjectRestore, factoryObjectDeletion, factoryGisAssembly,
    factoryLibraryAssembly, factoryNavigationBindings, factoryToolBindings, factoryFileBindings,
    factoryGlobalInputBindings, factoryEditorBindings, factoryProgressiveStartup, factoryDomainAssembly,
    factoryLifecycleAssembly, foundationConnector, spatialDataConnector, mapResourcesConnector,
    mapInteractionConnector, objectEditingConnector, projectIoConnector, lifecycleUiConnector,
  ] = await Promise.all([
    import(new URL(`./app-runtime-dependencies.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-environment.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-builtin-session.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-workspace-surfaces.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-project-session.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-object-commands.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-service-assembly.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-render-quality.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-pointer-targets.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-camera-navigation.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-readiness-notifications.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-country-index.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-spatial-index.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-geometry-preview.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-territory-components.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-country-validation.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-land-relations.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-cut-geometry.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-map-projection.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-object-presentation.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-hydro-settings.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-layer-list.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-country-labels.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-physical-resources.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-interaction-packets.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-territory-component-ui.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-gpu-scene.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-map-audit.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-map-host.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-task-presentation.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-country-modes.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-object-picking.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-river-candidates.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-country-commits.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-generic-commands.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-property-selection.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-territorial-drafts.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-color-picker.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-object-metadata.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-territorial-conversion.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-project-snapshots.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-map-settings.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-history-assembly.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-project-restore.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-object-deletion.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-gis-assembly.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-library-assembly.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-navigation-bindings.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-tool-bindings.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-file-bindings.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-global-input-bindings.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-editor-bindings.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-progressive-startup.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-domain-assembly.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-lifecycle-assembly.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-connect-foundation.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-connect-spatial-data.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-connect-map-resources.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-connect-map-interaction.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-connect-object-editing.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-connect-project-io.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-connect-lifecycle-ui.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
  ]);
  const environment = factoryEnvironment.createEnvironment();
  const builtinSession = factoryBuiltinSession.createBuiltinSession();
  const workspaceSurfaces = factoryWorkspaceSurfaces.createWorkspaceSurfaces();
  const projectSession = factoryProjectSession.createProjectSession();
  const objectCommands = factoryObjectCommands.createObjectCommands();
  const serviceAssembly = factoryServiceAssembly.createServiceAssembly();
  const renderQuality = factoryRenderQuality.createRenderQuality();
  const pointerTargets = factoryPointerTargets.createPointerTargets();
  const cameraNavigation = factoryCameraNavigation.createCameraNavigation();
  const readinessNotifications = factoryReadinessNotifications.createReadinessNotifications();
  const countryIndex = factoryCountryIndex.createCountryIndex();
  const spatialIndex = factorySpatialIndex.createSpatialIndex();
  const geometryPreview = factoryGeometryPreview.createGeometryPreview();
  const territoryComponents = factoryTerritoryComponents.createTerritoryComponents();
  const countryValidation = factoryCountryValidation.createCountryValidation();
  const landRelations = factoryLandRelations.createLandRelations();
  const cutGeometry = factoryCutGeometry.createCutGeometry();
  const mapProjection = factoryMapProjection.createMapProjection();
  const objectPresentation = factoryObjectPresentation.createObjectPresentation();
  const hydroSettings = factoryHydroSettings.createHydroSettings();
  const layerList = factoryLayerList.createLayerList();
  const countryLabels = factoryCountryLabels.createCountryLabels();
  const physicalResources = factoryPhysicalResources.createPhysicalResources();
  const interactionPackets = factoryInteractionPackets.createInteractionPackets();
  const territoryComponentUi = factoryTerritoryComponentUi.createTerritoryComponentUi();
  const gpuScene = factoryGpuScene.createGpuScene();
  const mapAudit = factoryMapAudit.createMapAudit();
  const mapHost = factoryMapHost.createMapHost();
  const taskPresentation = factoryTaskPresentation.createTaskPresentation();
  const countryModes = factoryCountryModes.createCountryModes();
  const objectPicking = factoryObjectPicking.createObjectPicking();
  const riverCandidates = factoryRiverCandidates.createRiverCandidates();
  const countryCommits = factoryCountryCommits.createCountryCommits();
  const genericCommands = factoryGenericCommands.createGenericCommands();
  const propertySelection = factoryPropertySelection.createPropertySelection();
  const territorialDrafts = factoryTerritorialDrafts.createTerritorialDrafts();
  const colorPicker = factoryColorPicker.createColorPicker();
  const objectMetadata = factoryObjectMetadata.createObjectMetadata();
  const territorialConversion = factoryTerritorialConversion.createTerritorialConversion();
  const projectSnapshots = factoryProjectSnapshots.createProjectSnapshots();
  const mapSettings = factoryMapSettings.createMapSettings();
  const historyAssembly = factoryHistoryAssembly.createHistoryAssembly();
  const projectRestore = factoryProjectRestore.createProjectRestore();
  const objectDeletion = factoryObjectDeletion.createObjectDeletion();
  const gisAssembly = factoryGisAssembly.createGisAssembly();
  const libraryAssembly = factoryLibraryAssembly.createLibraryAssembly();
  const navigationBindings = factoryNavigationBindings.createNavigationBindings();
  const toolBindings = factoryToolBindings.createToolBindings();
  const fileBindings = factoryFileBindings.createFileBindings();
  const globalInputBindings = factoryGlobalInputBindings.createGlobalInputBindings();
  const editorBindings = factoryEditorBindings.createEditorBindings();
  const progressiveStartup = factoryProgressiveStartup.createProgressiveStartup();
  const domainAssembly = factoryDomainAssembly.createDomainAssembly();
  const lifecycleAssembly = factoryLifecycleAssembly.createLifecycleAssembly();
  foundationConnector.connectFoundation({
    builtinSession, cameraNavigation, colorPicker, countryIndex, countryLabels, countryModes, cutGeometry,
    domainAssembly, environment, geometryPreview, gpuScene, hydroSettings, landRelations, layerList,
    lifecycleAssembly, mapHost, mapProjection, objectCommands, objectDeletion, objectPicking,
    objectPresentation, physicalResources, pointerTargets, projectRestore, projectSession, propertySelection,
    readinessNotifications, renderQuality, runtime, serviceAssembly, spatialIndex, taskPresentation,
    workspaceSurfaces,
  });
  spatialDataConnector.connectSpatialData({
    builtinSession, cameraNavigation, countryIndex, countryLabels, countryValidation, cutGeometry,
    domainAssembly, environment, geometryPreview, landRelations, layerList, mapHost, mapProjection,
    objectCommands, objectMetadata, objectPresentation, physicalResources, projectSession, projectSnapshots,
    readinessNotifications, runtime, serviceAssembly, spatialIndex, taskPresentation, territoryComponents,
    workspaceSurfaces,
  });
  mapResourcesConnector.connectMapResources({
    builtinSession, colorPicker, countryIndex, countryLabels, countryModes, countryValidation, cutGeometry,
    domainAssembly, environment, geometryPreview, gpuScene, hydroSettings, interactionPackets, landRelations,
    layerList, mapHost, mapProjection, objectCommands, objectPresentation, physicalResources, pointerTargets,
    projectSession, propertySelection, readinessNotifications, renderQuality, runtime, serviceAssembly,
    spatialIndex, taskPresentation, territoryComponents, workspaceSurfaces,
  });
  mapInteractionConnector.connectMapInteraction({
    cameraNavigation, countryCommits, countryIndex, countryLabels, countryModes, cutGeometry, domainAssembly,
    environment, genericCommands, geometryPreview, gpuScene, hydroSettings, interactionPackets, layerList,
    lifecycleAssembly, mapAudit, mapHost, mapProjection, objectCommands, objectPicking, objectPresentation,
    physicalResources, pointerTargets, projectSession, propertySelection, readinessNotifications,
    renderQuality, riverCandidates, runtime, serviceAssembly, spatialIndex, taskPresentation,
    territorialDrafts, territoryComponentUi, territoryComponents, workspaceSurfaces,
  });
  objectEditingConnector.connectObjectEditing({
    builtinSession, colorPicker, countryCommits, countryIndex, countryModes, countryValidation, cutGeometry,
    domainAssembly, environment, genericCommands, geometryPreview, gisAssembly, hydroSettings,
    interactionPackets, landRelations, layerList, lifecycleAssembly, mapHost, mapProjection, objectCommands,
    objectMetadata, objectPicking, objectPresentation, projectRestore, projectSession, projectSnapshots,
    propertySelection, readinessNotifications, runtime, serviceAssembly, spatialIndex, taskPresentation,
    territorialConversion, territorialDrafts, territoryComponents, workspaceSurfaces,
  });
  projectIoConnector.connectProjectIo({
    builtinSession, cameraNavigation, countryCommits, countryIndex, countryLabels, countryModes, countryValidation,
    cutGeometry, domainAssembly, environment, genericCommands, geometryPreview, gisAssembly, historyAssembly,
    hydroSettings, landRelations, layerList, libraryAssembly, lifecycleAssembly, mapHost, mapProjection,
    mapSettings, navigationBindings, objectCommands, objectDeletion, objectMetadata, objectPicking,
    objectPresentation, pointerTargets, projectRestore, projectSession, projectSnapshots, propertySelection,
    readinessNotifications, renderQuality, runtime, serviceAssembly, spatialIndex, taskPresentation,
    territorialDrafts, territoryComponentUi, territoryComponents, toolBindings, workspaceSurfaces,
  });
  lifecycleUiConnector.connectLifecycleUi({
    builtinSession, cameraNavigation, colorPicker, countryCommits, countryIndex, countryLabels, countryModes,
    countryValidation, cutGeometry, domainAssembly, editorBindings, environment, fileBindings, genericCommands,
    geometryPreview, gisAssembly, globalInputBindings, gpuScene, historyAssembly, hydroSettings,
    interactionPackets, landRelations, layerList, libraryAssembly, lifecycleAssembly, mapAudit, mapHost,
    mapProjection, mapSettings, navigationBindings, objectCommands, objectDeletion, objectMetadata,
    objectPicking, objectPresentation, physicalResources, pointerTargets, progressiveStartup, projectRestore,
    projectSession, projectSnapshots, propertySelection, readinessNotifications, renderQuality,
    riverCandidates, runtime, serviceAssembly, spatialIndex, taskPresentation, territorialConversion,
    territorialDrafts, territoryComponentUi, territoryComponents, toolBindings, workspaceSurfaces,
  });

  environment.initializeD3();
  lifecycleAssembly.initializeProjectUi();
  gisAssembly.initializeGisWorkflow();
  lifecycleAssembly.initializeMapDebug();
  environment.initializeTerritorialGeometry();
  builtinSession.initializePristineCountriesFallback();
  environment.initializeClamp();
  countryModes.initializeHydroToolConfig();
  workspaceSurfaces.initializeIsPolygonDraftTool();
  projectSession.initializeMapWorkScheduler();
  objectCommands.initializeObjectActionsMenuTrigger();
  mapHost.initializeSvg();
  gpuScene.initializeSelectionPass();
  domainAssembly.initializeProjectDomain();
  countryModes.initializeEmptyDraftSession();
  renderQuality.initializeRenderQualityController();
  gpuScene.initializeRenderSceneBuilder();
  interactionPackets.initializeInteractionSceneBuilder();
  geometryPreview.initializeEditPreviewController();
  gpuScene.initializeGpuSceneDomains();
  interactionPackets.initializeCurrentGpuInteractionFillItems();
  gpuScene.initializeGpuSceneResourceObjectKeys();
  mapHost.initializeValidationLayer();
  geometryPreview.initializeBoundarySelectionAnalysisCache();
  interactionPackets.initializeTerritorialBoundaryGeometryTokens();
  mapHost.initializeMapResizeObserver();
  mapProjection.initializeMapLayoutMetricsSnapshot();
  mapHost.initializeResolutionQuery();
  pointerTargets.initializeEditInteractionRevision();
  lifecycleAssembly.initializeMapInputController();
  mapHost.initializeMapHostBindings();
  lifecycleAssembly.initializeMapInteractionGate();
  spatialIndex.initializeGeometryBoundsCache();
  countryLabels.initializeCountryOutlineCache();
  objectPresentation.initializeGenericFeatureLandClipCache();
  spatialIndex.initializeMapObjectSpatialIndex();
  objectPresentation.initializeTerritorialScope();
  countryLabels.initializeLabelLayoutMetrics();
  spatialIndex.initializeViewportCullingMetrics();
  serviceAssembly.initializeSelectionPerformanceMetrics();
  countryIndex.initializeCountryLandRevision();
  countryLabels.initializeCountryLabelScreenAreas();
  pointerTargets.initializeHoverPickFrame();
  countryIndex.initializeCountryLabelAnchorWorker();
  mapAudit.initializeGeometryValidationWorker();
  riverCandidates.initializeRiverPartitionGeneration();
  geometryPreview.initializeActiveGeometryPreviewApply();
  pointerTargets.initializeSnapCandidateCache();
  mapProjection.initializeGlobeProjection();
  serviceAssembly.initializeGpuMapRenderer();
  renderQuality.initializeGpuRebuildTimer();
  readinessNotifications.initializeCANONICAL_CONTROL_SELECTOR();
  countryIndex.initializeLabelFallbackQueue();
  spatialIndex.initializeApplyingMapEditWorkerResult();
  landRelations.initializeRingHitTester();
  objectPresentation.initializeTerritorialRepository();
  physicalResources.initializeTerrainService();
  propertySelection.initializePropertySelection();
  territorialDrafts.initializePendingTerritorialCreateType();
  territorialConversion.initializeTerritorialTypeSource();
  projectSnapshots.initializeHistoryStore();
  mapSettings.initializeLAYER_STYLE_TARGETS();
  historyAssembly.initializeBrowserProjectStorage();
  projectRestore.initializeConfirmModalController();
  gisAssembly.initializeGisImportCommitterPromise();
  libraryAssembly.initializeHistoricalLibraryService();
  editorBindings.initializeEDITOR_COMMAND_ROW_ICONS();
  lifecycleAssembly.initializeLifecycle();
  return lifecycleAssembly.lifecycle;
}
