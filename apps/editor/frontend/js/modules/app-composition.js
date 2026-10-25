import {createMapOwners} from "../../../../../shared/frontend/js/modules/map-owner-composition.js";
import {handleEditorMapClick} from './editor-map-click.js';
/** Compose owners, connect their explicit ports, then initialize in dependency order. */
export async function composeApplication({ productMode, revision, platform = {}, onComposed = null }) {
  if (productMode !== 'editor') throw new TypeError('The application entry requires editor product mode.');
  const [
    runtime, factoryEnvironment, factoryObjectCommands, factoryServiceAssembly, factoryReadinessNotifications, factorySpatialEdit,
    factoryGeometryPreview, factoryTerritorySelectionWorkflow, factoryTerritoryComponents, factoryCountryValidation, factoryLandRelations,
    factoryCutGeometry, factoryInteractionPackets,
    factoryTerritoryComponentUi, factoryMapAudit, factoryTaskPresentation,
    factoryCountryModes, factoryRiverCandidates, factoryCountryCommits,
    factoryGenericCommands, factoryPropertySelection, factoryTerritorialDrafts, factoryColorPicker,
    factoryObjectMetadata, factoryTerritorialConversion, factoryProjectSnapshots, factoryMapSettings,
    factoryHistoryAssembly, factoryProjectRestore, factoryObjectDeletion, factoryGisAssembly,
    factoryLibraryAssembly, factoryNavigationBindings, factoryToolBindings, factoryFileBindings,
    factoryGlobalInputBindings, factoryEditorBindings, factoryProgressiveStartup, factoryDomainAssembly,
    factoryLifecycleAssembly, factoryCapabilityPorts, foundationConnector, spatialDataConnector, mapResourcesConnector,
    mapInteractionConnector, objectEditingConnector, projectIoConnector, lifecycleUiConnector,
  ] = await Promise.all([
    import(new URL(`./app-runtime-dependencies.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-environment.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-object-commands.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-service-assembly.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-readiness-notifications.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./spatial-edit-registration.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-geometry-preview.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-territory-selection-workflow.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-territory-components.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-country-validation.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-land-relations.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-cut-geometry.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-interaction-packets.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-territory-component-ui.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-map-audit.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-task-presentation.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-country-modes.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-river-candidates.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-country-commits.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-generic-commands.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-property-selection.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-territorial-drafts.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-color-picker.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-object-metadata.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-territorial-conversion.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-project-snapshots.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`../../../../../shared/frontend/js/modules/app-map-settings.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-history-assembly.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-project-restore.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-object-deletion.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-gis-assembly.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-library-assembly.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`../../../../../shared/frontend/js/modules/navigation-bindings.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-tool-bindings.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-file-bindings.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-global-input-bindings.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-editor-bindings.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-progressive-startup.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-domain-assembly.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-lifecycle-assembly.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-capability-ports.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-connect-foundation.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-connect-spatial-data.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-connect-map-resources.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-connect-map-interaction.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-connect-object-editing.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-connect-project-io.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
    import(new URL(`./app-connect-lifecycle-ui.js?v=${encodeURIComponent(revision)}`, import.meta.url)),
  ]);
  const {capabilities,builtinSession,workspaceSurfaces,projectSession,renderQuality,pointerTargets,cameraNavigation,countryIndex,spatialIndex,mapProjection,objectPresentation,hydroSettings,objectCatalog,territorialLabels,physicalResources,gpuScene,mapHost,objectPicking}=createMapOwners({productMode,platform,
    resolveVisibilityGroup:ref=>objectCommands.layerGroupForObjectRef(ref),closeActiveOverlay:()=>workspaceSurfaces.closeActiveMobileSheet(),isObjectVisible:(group,id)=>objectCommands.objectRefVisible(objectCommands.layerItemObjectRef(group,id)),
    editing:{beforeMeshRebuild:()=>spatialIndex.mapEditClient.rebase(),isDraggingDraft:()=>countryModes.editingDraftSnapshot().dragging,
      persistView:()=>domainAssembly.projectDomain.queueViewAutosave(),getEditPreview:()=>geometryPreview.editPreviewController.packet(),
      handleMapClick:point=>handleEditorMapClick(point,applicationPorts),
      onBackgroundClear:()=>workspaceSurfaces.closeSurface('editor',{restoreFocus:false}),
      performanceRecorder:{snapshot:(...args)=>serviceAssembly.selectionPerformanceCounterSnapshot(...args),publish:(...args)=>serviceAssembly.publishSelectionPerformanceSample(...args)}}});
  const environment = factoryEnvironment.createEnvironment();
  const objectCommands = factoryObjectCommands.createObjectCommands();
  const serviceAssembly = factoryServiceAssembly.createServiceAssembly();
  const readinessNotifications = factoryReadinessNotifications.createReadinessNotifications();
  const geometryPreview = factoryGeometryPreview.createGeometryPreview();
  const territorySelectionWorkflow = factoryTerritorySelectionWorkflow.createTerritorySelectionWorkflow();
  const territoryComponents = factoryTerritoryComponents.createTerritoryComponents();
  const countryValidation = factoryCountryValidation.createCountryValidation();
  const landRelations = factoryLandRelations.createLandRelations();
  const cutGeometry = factoryCutGeometry.createCutGeometry();
  const interactionPackets = factoryInteractionPackets.createInteractionPackets();
  const territoryComponentUi = factoryTerritoryComponentUi.createTerritoryComponentUi();
  const mapAudit = factoryMapAudit.createMapAudit();
  const taskPresentation = factoryTaskPresentation.createTaskPresentation();
  const countryModes = factoryCountryModes.createCountryModes();
  const riverCandidates = factoryRiverCandidates.createRiverCandidates();
  const countryCommits = factoryCountryCommits.createCountryCommits();
  const genericCommands = factoryGenericCommands.createGenericCommands();
  const propertySelection = factoryPropertySelection.createPropertySelection();
  const territorialDrafts = factoryTerritorialDrafts.createTerritorialDrafts();
  const colorPicker = factoryColorPicker.createColorPicker();
  const objectMetadata = factoryObjectMetadata.createObjectMetadata();
  const territorialConversion = factoryTerritorialConversion.createTerritorialConversion();
  const projectSnapshots = factoryProjectSnapshots.createProjectSnapshots();
  const mapSettings = factoryMapSettings.createMapSettings({capabilities,viewPresentation:{applyPresentation:projectSession.applyViewingPresentation},authoredStyles:true,onLayerVisibilityChange:async(key,enabled)=>{if(!enabled)return;if(key==='rivers'||key==='lakes')await physicalResources.loadHydroData(true);if(key==='labels')await territorialLabels.preparePlaces({force:true});}});
  const historyAssembly = factoryHistoryAssembly.createHistoryAssembly({ storageNamespace: platform.storageNamespace,
    libraryGeometryContext:platform.libraryGeometryContext });
  const projectRestore = factoryProjectRestore.createProjectRestore();
  const objectDeletion = factoryObjectDeletion.createObjectDeletion();
  const gisAssembly = factoryGisAssembly.createGisAssembly({ fileAccess: platform.fileAccess });
  const libraryAssembly = factoryLibraryAssembly.createLibraryAssembly();
  const navigationBindings = factoryNavigationBindings.createNavigationBindings({productMode});
  const toolBindings = factoryToolBindings.createToolBindings();
  const fileBindings = factoryFileBindings.createFileBindings({libraryGeometryContext:platform.libraryGeometryContext});
  const globalInputBindings = factoryGlobalInputBindings.createGlobalInputBindings({libraryGeometryContext:platform.libraryGeometryContext});
  const editorBindings = factoryEditorBindings.createEditorBindings();
  const progressiveStartup = factoryProgressiveStartup.createProgressiveStartup({
    startupMesh: platform.startupMesh,
    libraryGeometryContext:platform.libraryGeometryContext,
  });
  const domainAssembly = factoryDomainAssembly.createDomainAssembly();
  const lifecycleAssembly = factoryLifecycleAssembly.createLifecycleAssembly();
  const applicationProviders = {
    runtime, environment, builtinSession, workspaceSurfaces, projectSession, objectCommands,
    serviceAssembly, renderQuality, pointerTargets, cameraNavigation, readinessNotifications,
    countryIndex, spatialIndex, geometryPreview, territorySelectionWorkflow, territoryComponents,
    countryValidation, landRelations, cutGeometry, mapProjection, objectPresentation, hydroSettings,
    objectCatalog, territorialLabels, physicalResources, interactionPackets, territoryComponentUi, gpuScene,
    mapAudit, mapHost, taskPresentation, countryModes, objectPicking, riverCandidates, countryCommits,
    genericCommands, propertySelection, territorialDrafts, colorPicker, objectMetadata,
    territorialConversion, projectSnapshots, mapSettings, historyAssembly, projectRestore,
    objectDeletion, gisAssembly, libraryAssembly, navigationBindings, toolBindings, fileBindings,
    globalInputBindings, editorBindings, progressiveStartup, domainAssembly, lifecycleAssembly,
  };
  const applicationPorts = factoryCapabilityPorts.createApplicationPorts(applicationProviders);
  foundationConnector.connectFoundation({
    ports: applicationPorts,
    environment, builtinSession, workspaceSurfaces, projectSession, objectCommands, serviceAssembly,
    renderQuality, pointerTargets,
  });
  spatialDataConnector.connectSpatialData({
    ports: applicationPorts,
    cameraNavigation, readinessNotifications, countryIndex, spatialIndex, geometryPreview,
    territoryComponents, countryValidation, landRelations,
  });
  mapResourcesConnector.connectMapResources({
    ports: applicationPorts,
    cutGeometry, mapProjection, objectPresentation, hydroSettings, objectCatalog, territorialLabels,
    physicalResources, interactionPackets,
  });
  mapInteractionConnector.connectMapInteraction({
    ports: applicationPorts,
    territoryComponentUi, gpuScene, mapAudit, mapHost, taskPresentation, countryModes, objectPicking,
    riverCandidates,
  });
  objectEditingConnector.connectObjectEditing({
    ports: applicationPorts,
    territorySelectionWorkflow, countryCommits, genericCommands, propertySelection, territorialDrafts,
    colorPicker, objectMetadata, territorialConversion, projectSnapshots,
  });
  projectIoConnector.connectProjectIo({
    ports: applicationPorts,
    mapSettings, historyAssembly, projectRestore, objectDeletion, gisAssembly, libraryAssembly,
    navigationBindings, toolBindings,
  });
  lifecycleUiConnector.connectLifecycleUi({
    ports: applicationPorts,
    fileBindings, globalInputBindings, editorBindings, progressiveStartup, domainAssembly, lifecycleAssembly,
  });

  environment.initializeD3();
  lifecycleAssembly.initializeProjectUi();
  gisAssembly.initializeGisWorkflow();
  lifecycleAssembly.initializeMapDebug();
  environment.initializeTerritorialGeometry();
  builtinSession.initializePristineCountriesFallback();
  environment.initializeClamp();
  countryModes.initializeHydroToolConfig();
  workspaceSurfaces.initializeWorkspaceSurfaces();
  projectSession.initializeMapWorkScheduler();
  objectCommands.initializeObjectActionsMenuTrigger();
  mapHost.initializeSvg();
  gpuScene.initializeSelectionPass();
  domainAssembly.initializeDomainState();
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
  mapHost.initializeMapResizeObserver();
  mapProjection.initializeMapLayoutMetricsSnapshot();
  mapHost.initializeResolutionQuery();
  pointerTargets.initializeEditInteractionRevision();
  lifecycleAssembly.initializeMapInputController();
  mapHost.initializeMapHostBindings();
  lifecycleAssembly.initializeMapInteractionGate();
  spatialIndex.initializeGeometryBoundsCache();
  territorialLabels.initializeCountryOutlineCache();
  spatialIndex.initializeMapObjectSpatialIndex();
  objectPresentation.initializeTerritorialScope();
  territorialLabels.initializeLabelLayoutMetrics();
  spatialIndex.initializeViewportCullingMetrics();
  serviceAssembly.initializeSelectionPerformanceMetrics();
  countryIndex.initializeCountryLandRevision();
  territorialLabels.initializeTerritorialLabelScreenAreas();
  pointerTargets.initializeHoverPickFrame();
  countryIndex.initializeCountryLabelAnchorWorker();
  mapAudit.initializeGeometryValidationWorker();
  riverCandidates.initializeRiverPartitionGeneration();
  territorySelectionWorkflow.initializeTerritorySelectionWorkflow();
  geometryPreview.initializeActiveGeometryPreviewApply();
  pointerTargets.initializeSnapCandidateCache();
  mapProjection.initializeProjections();
  serviceAssembly.initializeGpuMapRenderer();
  renderQuality.initializeGpuRebuildTimer();
  readinessNotifications.initializeCANONICAL_CONTROL_SELECTOR();
  countryIndex.initializeLabelFallbackQueue();
  factorySpatialEdit.registerSpatialEditing(spatialIndex,applicationPorts);
  landRelations.initializeRingHitTester();
  objectPresentation.initializeObjectPresentationModel();
  physicalResources.initializeTerrainService();
  propertySelection.initializePropertySelection();
  mapSettings.initializeLAYER_STYLE_TARGETS();
  historyAssembly.initializeBrowserProjectStorage();
  projectRestore.initializeConfirmModalController();
  gisAssembly.initializeGisImportCommitterPromise();
  libraryAssembly.initializeTerritorialLibraryService();
  editorBindings.initializeEDITOR_COMMAND_ROW_ICONS();
  lifecycleAssembly.initializeLifecycle();
  const lifecycle = lifecycleAssembly.lifecycle;
  let startedApplication;
  return Object.freeze({
    ...lifecycle,
    start() {
      if (startedApplication) return startedApplication;
      startedApplication = lifecycle.start().then(async started => {
        if (!started) return started;
        if(platform.libraryGeometryContext)platform.libraryGeometryContext.attachRuntime(Object.freeze({
          projectDomain:domainAssembly.projectDomain,entityRepository:domainAssembly.territorialEntityRepository,
          editingDomain:domainAssembly.editingDomain,getState:()=>projectSession.state,
        }));
        if (onComposed) await onComposed(Object.freeze({
          projectDomain: domainAssembly.projectDomain,
          entityRepository: domainAssembly.territorialEntityRepository,
          gpuMapRenderer: serviceAssembly.gpuMapRenderer,
          persistenceService: historyAssembly.persistenceService,
          getState: () => projectSession.state,
          saveState: projectSession.saveState,
          projectUi: lifecycleAssembly.projectUi,
          getView: () => mapHost.projectionViewSnapshot(),
          navigation: cameraNavigation,
          setTimelineMonth: month => domainAssembly.setTimelineMonth(month),
        }));
        window.addEventListener('pandolab:project-changed', taskPresentation.syncEditingContext);
        taskPresentation.syncEditingContext();
        return started;
      });
      return startedApplication;
    },
  });
}
