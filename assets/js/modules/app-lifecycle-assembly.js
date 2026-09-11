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
    (mapInteractionGate = (0, dependencies.createMapInteractionGate)());
  }

  function initializeLifecycle() {
    (lifecycle = (0, dependencies.createApplicationLifecycle)({
      window,
      compose: [
        () => {
          projectUi = (0, dependencies.createProjectUiBridge)({
            getElement: dependencies.$,
            getSaveSnapshot: () => dependencies.saveState.snapshot(),
            getEditingSnapshot: () => ({ processing: dependencies.state.modeProcessing, previewActive: !!dependencies.state.geometryPreview.session }),
            getDraftSnapshot: dependencies.editingDraftSnapshot,
            requireCanonicalData: dependencies.requireCanonicalData,
            discardActiveGeometryPreview: dependencies.discardActiveGeometryPreview,
            draftInputActive: () => dependencies.editingDomain?.draftInputActive?.(),
            undoDraft: () => dependencies.editingDomain?.performDraftUndo(),
            redoDraft: () => dependencies.editingDomain?.performDraftRedo(),
            canUndo: () => dependencies.projectDomain?.canUndo() || false,
            canRedo: () => dependencies.projectDomain?.canRedo() || false,
            undoProject: meta => dependencies.projectDomain.undo(meta),
            redoProject: meta => dependencies.projectDomain.redo(meta),
            createEmptyProject: () => dependencies.projectDomain.createEmpty(),
            setActionStatus: dependencies.setActionStatus,
            closeFileMenu: dependencies.closeFileMenu,
            openConfirmModal: dependencies.openConfirmModal,
          });
          propertyEditorUi = (0, dependencies.createPropertyEditorBindings)({
            getElement: dependencies.$,
            document,
            getPrimary: () => dependencies.selectionDomain.primary(),
            getGenericFeature: id => dependencies.state.genericFeatures.find(feature => String(feature.id) === String(id)),
            TERRITORIAL_UNIT_TYPES: dependencies.TERRITORIAL_UNIT_TYPES,
            bindColorPickers: dependencies.bindColorPickers,
            commitGenericFeatureMeta: dependencies.commitGenericFeatureMeta,
            commitHydroEdit: dependencies.commitHydroEdit,
            commitTerritorialUnitMeta: dependencies.commitTerritorialUnitMeta,
            commitDistributionMeta: dependencies.commitDistributionMeta,
            commitLabelEdit: dependencies.commitLabelEdit,
            removeDistributionEntry: dependencies.removeDistributionEntry,
            addTerritorialDistributionEntry: dependencies.addTerritorialDistributionEntry,
            requestDraftDiscard: dependencies.requestDraftDiscard,
            returnToMapAfterMobileAction: dependencies.returnToMapAfterMobileAction,
            startGeometryDistributionDraft: dependencies.startGeometryDistributionDraft,
            requestTerritorialUnitDivisionRemoval: dependencies.requestTerritorialUnitDivisionRemoval,
            enterTerritorialUnitSplitMode: dependencies.enterTerritorialUnitSplitMode,
            enterTerritorialUnitMergeMode: dependencies.enterTerritorialUnitMergeMode,
            enterTerritorialUnitRedrawMode: dependencies.enterTerritorialUnitRedrawMode,
            territorialUnitById: dependencies.territorialUnitById,
            reconcileAdminCountryCoast: dependencies.reconcileAdminCountryCoast,
            requestTerritorialUnitPromotion: dependencies.requestTerritorialUnitPromotion,
            openTerritorialTypeModal: dependencies.openTerritorialTypeModal,
            syncTerritorialTypeModal: dependencies.syncTerritorialTypeModal,
            closeTerritorialTypeModal: dependencies.closeTerritorialTypeModal,
            confirmTerritorialTypeConversion: dependencies.confirmTerritorialTypeConversion,
            setEditorShellView: dependencies.setEditorShellView,
            setActionStatus: dependencies.setActionStatus,
            focusObjectRef: dependencies.focusObjectRef,
            enterGenericFeatureSplitMode: dependencies.enterGenericFeatureSplitMode,
            enterGenericFeatureMergeMode: dependencies.enterGenericFeatureMergeMode,
            alignSelectedGenericFeatureToOwnerLand: dependencies.alignSelectedGenericFeatureToOwnerLand,
            countryFeatureById: dependencies.countryFeatureById,
            enterCountryCoastEdit: dependencies.enterCountryCoastEdit,
            openConfirmModal: dependencies.openConfirmModal,
            applySelectedGenericFeatureToOwnerCountry: dependencies.applySelectedGenericFeatureToOwnerCountry,
            promoteSelectedGenericFeatureToCountry: dependencies.promoteSelectedGenericFeatureToCountry,
            copySelectedHydroForEditing: dependencies.copySelectedHydroForEditing,
            closeObjectActionsMenu: dependencies.closeObjectActionsMenu,
            batchSetVisibility: dependencies.batchSetVisibility,
            enterCountryBorderEditFromSelection: dependencies.enterCountryBorderEditFromSelection,
            undo: () => projectUi.undo(),
            redo: () => projectUi.redo(),
          });
          dependencies.gisWorkflow = (0, dependencies.createGisWorkflowController)({
            loadRuntime: async () => { await Promise.all([(0, dependencies.ensureGisRuntime)(), (0, dependencies.ensureGisIoRuntime)(), (0, dependencies.ensureModalRuntime)()]); return { importServiceModule: dependencies.importServiceModule, createGisImportWizardController: dependencies.createGisImportWizardController, buildTerritorialImportTransactionPlan: dependencies.buildTerritorialImportTransactionPlan, resolveCountryIdentities: dependencies.resolveCountryIdentities, identityResolutionSummary: dependencies.identityResolutionSummary, materializeResolvedCountries: dependencies.materializeResolvedCountries }; },
            onRuntimeReady: ({ appendSourceInfo, applyPackageAssets, readImportedOverrides }) => { dependencies.appendImportedSourceInfo = appendSourceInfo; dependencies.applyImportedPackageAssets = applyPackageAssets; dependencies.importedCountryOverrides = readImportedOverrides; },
            getCountries: () => dependencies.state.countriesData,
            getTerritorialUnits: () => dependencies.state.territorialUnits,
            getSaveSnapshot: () => dependencies.saveState.snapshot(),
            getProjectGeneration: () => dependencies.projectDomain.getGeneration(),
            getGisIo: async () => { await (0, dependencies.ensureGisIoRuntime)(); return window.PandoLabGIS; },
            createGeometryWorker: () => new Worker((0, dependencies.runtimeAssetUrl)('workers/gis-geometry-worker.js'), { name: 'pandolab-gis-geometry' }),
            clipper: window.polygonClipping,
            countryName: dependencies.countryName,
            layerNameCollator: dependencies.layerNameCollator,
            TERRITORIAL_UNIT_TYPES: dependencies.TERRITORIAL_UNIT_TYPES,
            territorialUnitName: dependencies.territorialUnitName,
            sphericalGeometryAreaKm2: dependencies.sphericalGeometryAreaKm2,
            createProjectObjectId: dependencies.createProjectObjectId,
            deepClone: dependencies.deepClone,
            featureCountryId: dependencies.featureCountryId,
            geometryBounds: dependencies.geometryBounds,
            boundsOverlap: dependencies.boundsOverlap,
            normalizeClippedLandGeometry: dependencies.normalizeClippedLandGeometry,
            geometryMultiCoordinates: dependencies.geometryMultiCoordinates,
            multiPolygonPlanarArea: dependencies.multiPolygonPlanarArea,
            validateStructuredGeometry: dependencies.validateStructuredGeometry,
            setActionStatus: dependencies.setActionStatus,
          });
          mapDebug = (0, dependencies.createMapDebugController)({
            getElement: dependencies.$,
            window,
            document,
            location,
            localStorage,
            readDiagnostics: () => ({ state: { projection: dependencies.state.projection, stateRevision: dependencies.state.stateRevision, pendingCountryRenderIds: new Set(dependencies.state.pendingCountryRenderIds), physicalLoadState: { ...dependencies.state.physicalLoadState }, audit: dependencies.state.audit }, viewRevision: dependencies.viewRevision, mapHost: dependencies.mapHost, renderingDomain: dependencies.renderingDomain, selectionDomain: dependencies.selectionDomain, selectionPass: dependencies.selectionPass, resolvedInteractionStyle: dependencies.resolvedInteractionStyle, labelLayoutMetrics: dependencies.labelLayoutMetrics, mapLayoutMetricsRefreshCount: dependencies.mapLayoutMetricsRefreshCount, mapLayoutMetricsSnapshot: dependencies.mapLayoutMetricsSnapshot }),
            getFeatureBounds: feature => dependencies.path.bounds(feature),
            gpuMapRenderer: dependencies.gpuMapRenderer,
            mapEditClient: dependencies.mapEditClient,
            editPreviewController: dependencies.editPreviewController,
            editPipelineMetrics: dependencies.editPipelineMetrics,
            MAP_HOST_KINDS: dependencies.MAP_HOST_KINDS,
            mapInteractionGate,
            selectionPerformanceMetrics: dependencies.selectionPerformanceMetrics,
            boundarySelectionAnalysisMetrics: dependencies.boundarySelectionAnalysisMetrics,
            selectionPerformanceBaseline: dependencies.selectionPerformanceBaseline,
            mapObjectSpatialIndex: dependencies.mapObjectSpatialIndex,
            viewportCullingMetrics: dependencies.viewportCullingMetrics,
            distributionRenderRowCache: dependencies.distributionRenderRowCache,
            renderQualityController: dependencies.renderQualityController,
            renderSceneBuilder: dependencies.renderSceneBuilder,
            deepClone: dependencies.deepClone,
            updateProjection: dependencies.updateProjection,
            projectionViewSnapshot: dependencies.projectionViewSnapshot,
            screenToGeo: dependencies.screenToGeo,
            activeProjection: dependencies.activeProjection,
            validLabelAnchor: dependencies.validLabelAnchor,
            countryLabelAnchors: dependencies.countryLabelAnchors,
            runFullMapAudit: dependencies.runFullMapAudit,
            clearMapAudit: dependencies.clearMapAudit,
            focusAuditIssue: dependencies.focusAuditIssue,
          });
        },
        dependencies.initializeDomainBoundaries,
        () => {
          mapInputPresentation = (0, dependencies.createMapInputPresentation)({
            getElement: dependencies.$,
            window,
            d3: dependencies.d3,
            navigator,
            createMapInputController: dependencies.createMapInputController,
            getInputSnapshot: () => ({ moving: dependencies.state.mapMoving, spacePanActive: dependencies.state.spacePanActive, tool: dependencies.state.tool, projection: dependencies.state.projection, globeZoom: dependencies.state.view.globeZoom, flatZoom: dependencies.state.view.flatZoom, annexPhase: dependencies.state.annexPhase, newCountryPhase: dependencies.state.newCountryPhase, labelPlacementMode: dependencies.state.labelPlacementMode }),
            setMoving: value => { dependencies.state.mapMoving = value; },
            clearHoverHit: () => { dependencies.lastHoverHit = null; },
            getQualityTier: () => dependencies.currentRenderQuality.tier,
            getRevision: () => dependencies.editInteractionRevision,
            getDraftSnapshot: dependencies.editingDraftSnapshot,
            renderQualityController: dependencies.renderQualityController,
            mapWorkScheduler: dependencies.mapWorkScheduler,
            gpuMapRenderer: dependencies.gpuMapRenderer,
            renderingDomain: dependencies.renderingDomain,
            editingDomain: dependencies.editingDomain,
            selectionDomain: dependencies.selectionDomain,
            projectDomain: dependencies.projectDomain,
            mapInteractionGate,
            applyAdaptiveRenderQuality: dependencies.applyAdaptiveRenderQuality,
            queueAdaptiveRenderQualityRefresh: dependencies.queueAdaptiveRenderQualityRefresh,
            cancelCountryHoverPick: dependencies.cancelCountryHoverPick,
            suppressNextMapClick: dependencies.suppressNextMapClick,
            mapNavigationEnabled: dependencies.mapNavigationEnabled,
            dragMapBy: dependencies.dragMapBy,
            transformMapView: dependencies.transformMapView,
            zoomBy: dependencies.zoomBy,
            isMobile: dependencies.isMobile,
            isGenericFeatureDraftTool: dependencies.isGenericFeatureDraftTool,
            handleMapClick: dependencies.handleMapClick,
            dispatchEditingInteraction: dependencies.dispatchEditingInteraction,
            mapClickBlocked: dependencies.mapClickBlocked,
            screenToGeo: dependencies.screenToGeo,
            queueCountryHoverPick: dependencies.queueCountryHoverPick,
          });
            mapDebug.installRenderFacade();
        },
      ],
      startup: dependencies.init,
      onReady: () => { dependencies.runtimeReady = true; },
      onError: dependencies.showFatalError,
      getDisposables: () => [dependencies.editorWorkspacePresentation, mapInputPresentation, propertyEditorUi, dependencies.renderingDomain, dependencies.editingDomain, dependencies.selectionDomain, dependencies.gisWorkflow, dependencies.gisDomain, dependencies.projectDomain],
      reportDisposeError: error => dependencies.reliabilityDiagnostic.push({ category: 'dispose', message: String(error?.message || error) }),
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
