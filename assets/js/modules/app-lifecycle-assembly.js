/** LifecycleAssembly: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createLifecycleAssembly() {
  let dependencies;
  let projectUi;
  let propertyEditorUi;
  let mapInputPresentation;
  let mapDebug;
  let mapInputController;
  let mapInteractionGate;
  let lifecycle;
  function connect(ports) {
    if (dependencies) throw new Error('lifecycle-assembly already connected');
    dependencies = ports;
  }

  function initializeProjectUi() {

  }

  function initializeMapDebug() {

  }

  function initializeMapInputController() {
    (mapInputController = null);
  }

  function initializeMapInteractionGate() {
    (mapInteractionGate = (0, dependencies.renderFactories.createMapInteractionGate)());
  }

  function initializeLifecycle() {
    (lifecycle = (0, dependencies.domainFactories.createApplicationLifecycle)({
      window,
      compose: [
        () => {
          projectUi = (0, dependencies.uiFactoriesB.createProjectUiBridge)({
            getElement: dependencies.platform.$,
            getSaveSnapshot: () => dependencies.projectSession.saveState.snapshot(),
            getEditingSnapshot: () => ({ processing: dependencies.projectState.state.modeProcessing, previewActive: !!dependencies.projectState.state.geometryPreview.session, revision: dependencies.domains.editingDomain.snapshot().revision }),
            getProjectGeneration: () => dependencies.domains.projectDomain.getGeneration(),
            getDraftSnapshot: dependencies.draftPresentation.editingDraftSnapshot,
            requireCanonicalData: dependencies.readinessUi.requireCanonicalData,
            discardActiveGeometryPreview: dependencies.geometryOperations.discardActiveGeometryPreview,
            draftInputActive: () => dependencies.domains.editingDomain?.draftInputActive?.(),
            undoDraft: () => dependencies.domains.editingDomain?.performDraftUndo(),
            redoDraft: () => dependencies.domains.editingDomain?.performDraftRedo(),
            canUndo: () => dependencies.domains.projectDomain?.canUndo() || false,
            canRedo: () => dependencies.domains.projectDomain?.canRedo() || false,
            undoProject: meta => dependencies.domains.projectDomain.undo(meta),
            redoProject: meta => dependencies.domains.projectDomain.redo(meta),
            createEmptyProject: () => dependencies.domains.projectDomain.createEmpty(),
            isProjectReplacing: () => dependencies.domains.projectDomain?.isReplacing?.() === true,
            setActionStatus: dependencies.feedback.setActionStatus,
            closeFileMenu: dependencies.workspaceUiA.closeFileMenu,
            openConfirmModal: dependencies.projectRestore.openConfirmModal,
            getAutosaveRecovery: () => dependencies.domains.projectDomain.getAutosaveRecovery(),
            restoreAutosave: options => dependencies.domains.projectDomain.restoreAutosave(options),
            resolveAutosaveRecovery: (source, apply, options) => dependencies.domains.projectDomain.resolveAutosaveRecovery(source, apply, options),
            completeAutosaveRecovery: () => dependencies.domains.projectDomain.completeAutosaveRecovery(),
            loadAutosave: project => dependencies.domains.projectDomain.loadAutosave(project),
            queueAutosave: () => dependencies.domains.projectDomain.queueAutosave(0, { markDirty: false }),
          });
          propertyEditorUi = (0, dependencies.applicationFactories.createPropertyEditorBindings)({
            getElement: dependencies.platform.$,
            document,
            getPrimary: () => dependencies.domains.selectionDomain.primary(),
            bindColorPickers: dependencies.colorPicker.bindColorPickers,
            commitHydroEdit: dependencies.objectMetadata.commitHydroEdit,
            commitDistributionMeta: dependencies.propertyEditingA.commitDistributionMeta,
            commitLabelEdit: dependencies.territorialConversion.commitLabelEdit,
            removeDistributionEntry: dependencies.propertyEditingB.removeDistributionEntry,
            updateDistributionEntryValue: dependencies.propertyEditingB.updateDistributionEntryValue,
            addTerritorialDistributionEntry: dependencies.propertyEditingA.addTerritorialDistributionEntry,
            requestDraftDiscard: dependencies.genericEditingB.requestDraftDiscard,
            completeToolStart: dependencies.workspaceUiA.completeToolStart,
            startGeometryDistributionDraft: dependencies.propertyEditingB.startGeometryDistributionDraft,
            runEntityEditAction: dependencies.territorialEditingA.runEntityEditAction,
            runModePrimaryAction: dependencies.taskPresentation.runModePrimaryAction,
            copySelectedEntityToRegion: dependencies.territorialConversion.copySelectedEntityToRegion,
            enterTerritorialCreateWorkflow: dependencies.territorialEditingA.enterTerritorialCreateWorkflow,
            entityRepository: dependencies.territorialModel.entityRepository,
            reconcileAdminCountryCoast: dependencies.projectRestore.reconcileAdminCountryCoast,
            focusObjectRef: dependencies.objectOperationsA.focusObjectRef,
            convertSelectedGenericFeature: dependencies.genericEditingA.convertSelectedGenericFeature,
            copySelectedHydroForEditing: dependencies.propertyEditingA.copySelectedHydroForEditing,
            copySelectedPlaceForEditing: dependencies.genericEditingA.copySelectedPlaceForEditing,
            closeObjectActionsMenu: dependencies.objectOperationsA.closeObjectActionsMenu,
            enterTerritorialBorderEditFromSelection: dependencies.countryEditingA.enterTerritorialBorderEditFromSelection,
            undo: () => projectUi.undo(),
            redo: () => projectUi.redo(),
          });
          dependencies.gisRuntimeCommands.installWorkflow((0, dependencies.uiFactoriesA.createGisWorkflowController)({
            loadRuntime: async () => { await Promise.all([(0, dependencies.gisServicesA.ensureGisRuntime)(), (0, dependencies.gisServicesA.ensureGisIoRuntime)(), (0, dependencies.applicationServicesA.ensureModalRuntime)()]); return { importServiceModule: dependencies.applicationServicesA.importServiceModule, createGisImportWizardController: dependencies.uiFactoriesA.createGisImportWizardController, buildTerritorialImportTransactionPlan: dependencies.gisServicesA.buildTerritorialImportTransactionPlan, resolveCountryIdentities: dependencies.countryServices.resolveCountryIdentities, identityResolutionSummary: dependencies.applicationServicesA.identityResolutionSummary, materializeResolvedCountries: dependencies.applicationServicesB.materializeResolvedCountries }; },
            onRuntimeReady: ({ appendSourceInfo, applyPackageAssets }) => dependencies.startupCommands.installImportedPackageHandlers({ appendSourceInfo, applyPackageAssets }),
            getCountries: () => ({ type: 'FeatureCollection', features: dependencies.territorialModel.entityRepository.list({ kind: 'general', parentId: '' }) }),
            getTerritorialUnits: () => dependencies.territorialModel.entityRepository.list({  }).filter(entity => entity.properties.entityKind === 'regional' || !!entity.properties.parentId),
            getSaveSnapshot: () => dependencies.projectSession.saveState.snapshot(),
            getProjectGeneration: () => dependencies.domains.projectDomain.getGeneration(),
            getGisIo: async () => { await (0, dependencies.gisServicesA.ensureGisIoRuntime)(); return window.PandoLabGIS; },
            createGeometryWorker: () => new Worker((0, dependencies.platform.runtimeAssetUrl)('workers/gis-geometry-worker.js'), { name: 'pandolab-gis-geometry' }),
            clipper: window.polygonClipping,
            countryName: dependencies.objectPresentation.territorialEntityName,
            layerNameCollator: dependencies.objectModelA.layerNameCollator,
            territorialEntityName: dependencies.objectPresentation.territorialEntityName,
            sphericalGeometryAreaKm2: dependencies.applicationServicesB.sphericalGeometryAreaKm2,
            createProjectObjectId: dependencies.projectServices.createProjectObjectId,
            deepClone: dependencies.platform.deepClone,
            featureCountryId: dependencies.countryRecords.featureCountryId,
            geometryBounds: dependencies.spatialQuery.geometryBounds,
            boundsOverlap: dependencies.cutGeometry.boundsOverlap,
            normalizeClippedLandGeometry: dependencies.cutGeometry.normalizeClippedLandGeometry,
            geometryMultiCoordinates: dependencies.territoryGeometry.geometryMultiCoordinates,
            multiPolygonPlanarArea: dependencies.territoryGeometry.multiPolygonPlanarArea,
            validateStructuredGeometry: dependencies.geometryModel.validateStructuredGeometry,
            setActionStatus: dependencies.feedback.setActionStatus,
          }));
          mapDebug = (0, dependencies.uiFactoriesA.createMapDebugController)({
            getElement: dependencies.platform.$,
            window,
            document,
            location,
            localStorage,
            readDiagnostics: () => ({ state: { projection: dependencies.projectState.state.projection, stateRevision: dependencies.projectState.state.stateRevision, pendingCountryRenderIds: new Set(dependencies.projectState.state.pendingCountryRenderIds), physicalLoadState: { ...dependencies.projectState.state.physicalLoadState }, audit: dependencies.projectState.state.audit }, viewRevision: dependencies.mapLayout.viewRevision, mapHost: dependencies.mapView.mapHost, renderingDomain: dependencies.domains.renderingDomain, selectionDomain: dependencies.domains.selectionDomain, selectionPass: dependencies.gpuRenderingA.selectionPass, resolvedInteractionStyle: dependencies.preferences.resolvedInteractionStyle, labelLayoutMetrics: dependencies.countryLabelModel.labelLayoutMetrics, mapLayoutMetricsRefreshCount: dependencies.projectionView.mapLayoutMetricsRefreshCount, mapLayoutMetricsSnapshot: dependencies.mapLayout.mapLayoutMetricsSnapshot }),
            getFeatureBounds: feature => dependencies.mapView.path.bounds(feature),
            gpuMapRenderer: dependencies.rendering.gpuMapRenderer,
            mapEditClient: dependencies.spatialQuery.mapEditClient,
            editPreviewController: dependencies.geometryOperations.editPreviewController,
            editPipelineMetrics: dependencies.geometryOperations.editPipelineMetrics,
            MAP_HOST_KINDS: dependencies.applicationConstantsA.MAP_HOST_KINDS,
            mapInteractionGate,
            selectionPerformanceMetrics: dependencies.rendering.selectionPerformanceMetrics,
            boundarySelectionAnalysisMetrics: dependencies.geometryOperations.boundarySelectionAnalysisMetrics,
            selectionPerformanceBaseline: dependencies.renderServices.selectionPerformanceBaseline,
            mapObjectSpatialIndex: dependencies.spatialRecords.mapObjectSpatialIndex,
            viewportCullingMetrics: dependencies.spatialQuery.viewportCullingMetrics,
            distributionRenderRowCache: dependencies.objectModelA.distributionRenderRowCache,
            renderQualityController: dependencies.renderQuality.renderQualityController,
            renderSceneBuilder: dependencies.gpuRenderingA.renderSceneBuilder,
            deepClone: dependencies.platform.deepClone,
            updateProjection: dependencies.mapView.updateProjection,
            projectionViewSnapshot: dependencies.mapHostViewB.projectionViewSnapshot,
            screenToGeo: dependencies.mapView.screenToGeo,
            activeProjection: dependencies.mapView.activeProjection,
            validLabelAnchor: dependencies.countries.validLabelAnchor,
            countryLabelAnchors: dependencies.labelPresentation.countryLabelAnchors,
            runFullMapAudit: dependencies.mapAudit.runFullMapAudit,
            clearMapAudit: dependencies.mapAudit.clearMapAudit,
            focusAuditIssue: dependencies.mapAudit.focusAuditIssue,
          });
        },
        dependencies.domainControllers.initializeDomainBoundaries,
        () => {
          mapInputPresentation = (0, dependencies.uiFactoriesB.createMapInputPresentation)({
            getElement: dependencies.platform.$,
            window,
            d3: dependencies.platform.d3,
            navigator,
            createMapInputController: dependencies.uiFactoriesA.createMapInputController,
            getInputSnapshot: () => ({ moving: dependencies.projectState.state.mapMoving, projectReplacing: dependencies.projectState.state.projectReplacing === true, spacePanActive: dependencies.projectState.state.spacePanActive, tool: dependencies.projectState.state.tool, projection: dependencies.projectState.state.projection, globeZoom: dependencies.projectState.state.view.globeZoom, flatZoom: dependencies.projectState.state.view.flatZoom, territorySelectionSession: dependencies.projectState.state.territorySelectionSession, labelPlacementMode: dependencies.projectState.state.labelPlacementMode }),
            setMoving: value => { dependencies.projectState.state.mapMoving = value; },
            clearHoverHit: () => { dependencies.interactionStateCommands.setHoverHit(null); },
            getQualityTier: () => dependencies.renderScene.currentRenderQuality.tier,
            getRevision: () => dependencies.pointerInteractionA.editInteractionRevision,
            getDraftSnapshot: dependencies.draftPresentation.editingDraftSnapshot,
            renderQualityController: dependencies.renderQuality.renderQualityController,
            mapWorkScheduler: dependencies.projectState.mapWorkScheduler,
            gpuMapRenderer: dependencies.rendering.gpuMapRenderer,
            renderingDomain: dependencies.domains.renderingDomain,
            editingDomain: dependencies.domains.editingDomain,
            selectionDomain: dependencies.domains.selectionDomain,
            projectDomain: dependencies.domains.projectDomain,
            mapInteractionGate,
            applyAdaptiveRenderQuality: dependencies.renderQuality.applyAdaptiveRenderQuality,
            queueAdaptiveRenderQualityRefresh: dependencies.renderQuality.queueAdaptiveRenderQualityRefresh,
            cancelCountryHoverPick: dependencies.pointerInteractionA.cancelCountryHoverPick,
            suppressNextMapClick: dependencies.pointerInteractionB.suppressNextMapClick,
            mapNavigationEnabled: dependencies.pointerInteractionA.mapNavigationEnabled,
            dragMapBy: dependencies.navigation.dragMapBy,
            transformMapView: dependencies.navigation.transformMapView,
            zoomBy: dependencies.navigation.zoomBy,
            isMobile: dependencies.surfaces.isMobile,
            isGenericFeatureDraftTool: dependencies.surfaces.isGenericFeatureDraftTool,
            handleMapClick: dependencies.objectPicking.handleMapClick,
            dispatchEditingInteraction: dependencies.countryEditingA.dispatchEditingInteraction,
            mapClickBlocked: dependencies.pointerInteractionA.mapClickBlocked,
            screenToGeo: dependencies.mapView.screenToGeo,
            queueCountryHoverPick: dependencies.pointerInteractionA.queueCountryHoverPick,
          });
            mapDebug.installRenderFacade();
        },
      ],
      startup: dependencies.startup.init,
      onReady: () => { dependencies.startupCommands.markRuntimeReady(); },
      onError: dependencies.readinessUi.showFatalError,
      getDisposables: () => [dependencies.workspaceUiB.editorWorkspacePresentation, mapInputPresentation, propertyEditorUi, dependencies.domains.selectionUiController, dependencies.domains.renderingDomain, dependencies.domains.editingDomain, dependencies.domains.selectionDomain, dependencies.gisRuntime.gisWorkflow, dependencies.domainControllers.gisDomain, dependencies.domains.projectDomain],
      reportDisposeError: error => dependencies.readiness.reliabilityDiagnostic.push({ category: 'dispose', message: String(error?.message || error) }),
    }));
  }

  return Object.freeze({
    connect,
    initializeProjectUi,
    initializeMapDebug,
    initializeMapInputController,
    initializeMapInteractionGate,
    initializeLifecycle,
    get mapDebug() { return mapDebug; },
    get mapInputController() { return mapInputController; },
    set mapInputController(value) { mapInputController = value; },
    get mapInputPresentation() { return mapInputPresentation; },
    get mapInteractionGate() { return mapInteractionGate; },
    get projectUi() { return projectUi; },
    get propertyEditorUi() { return propertyEditorUi; },
    get lifecycle() { return lifecycle; },
  });
}
