/** LifecycleAssembly: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createLifecycleAssembly({onStarted=null,onStopped=null}={}) {
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
            getEditingSnapshot: () => ({ undoCommandId: dependencies.domains.projectDomain.state().undoCommandId, redoCommandId: dependencies.domains.projectDomain.state().redoCommandId, processing: dependencies.projectState.state.modeProcessing, previewActive: dependencies.projectState.state.territorySelectionSession ? dependencies.projectState.state.territorySelectionSession.stage === 'review' : !!dependencies.projectState.state.geometryPreview.session, revision: dependencies.domains.editingDomain.snapshot().revision }),
            getProjectGeneration: () => dependencies.domains.projectDomain.getGeneration(),
            getDraftSnapshot: () => {
              const draft = dependencies.draftPresentation.editingDraftSnapshot();
              const snapshot = dependencies.domains.editingDomain.snapshot();
              const boundary = snapshot.boundaryDraft || snapshot.selectionDraft;
              if(boundary)return {...draft,...boundary};
              const selection = dependencies.projectState.state.territorySelectionSession;
              if (!selection || draft.historyCount || draft.futureCount) return draft;
              return {...draft,historyCount: selection.parts.length + selection.selectedComponentKeys.length + selection.selectedCandidateIds.length + Number(!!selection.currentGeometry),futureCount: 0};
            },
            requireCanonicalData: dependencies.readinessUi.requireCanonicalData,
            returnToEditing: dependencies.taskPresentation.returnToEditing,
            draftInputActive: () => !!dependencies.domains.editingDomain.snapshot().selectionDraft || !!dependencies.domains.editingDomain.snapshot().boundaryDraft || dependencies.domains.editingDomain.draftInputActive() || !!dependencies.projectState.state.territorySelectionSession && dependencies.projectState.state.territorySelectionSession.stage !== 'setup',
            undoDraft: () => dependencies.projectState.state.territorySelectionSession && !dependencies.draftPresentation.editingDraftSnapshot().historyCount ? dependencies.territorySelectionB.territorySelectionUndoPart() : dependencies.domains.editingDomain.performDraftUndo(),
            redoDraft: () => dependencies.domains.editingDomain?.performDraftRedo(),
            canUndo: () => dependencies.domains.projectDomain?.canUndo() || false,
            canRedo: () => dependencies.domains.projectDomain?.canRedo() || false,
            undoProject: meta => dependencies.domains.projectDomain.undo(meta),
            redoProject: meta => dependencies.domains.projectDomain.redo(meta),
            createProject: options => dependencies.domains.projectDomain.createProject(options),
            projectSetupPorts: {
              document,
              screenToGeo:dependencies.mapView.screenToGeo,
              getViewportBounds:()=>{const map=document.getElementById('map'),r=map.getBoundingClientRect(),points=[];for(let x=0;x<=8;x++)for(let y=0;y<=8;y++){const p=dependencies.mapView.screenToGeo([r.width*x/8,r.height*y/8]);if(p)points.push(p);}if(points.length<2)throw new Error('화면 범위를 계산하지 못했습니다.');const center=dependencies.mapView.screenToGeo([r.width/2,r.height/2])||points[0],unwrap=p=>center[0]+((p[0]-center[0]+540)%360)-180,wrap=x=>((x+540)%360)-180;return {west:wrap(Math.min(...points.map(unwrap))),east:wrap(Math.max(...points.map(unwrap))),south:Math.min(...points.map(p=>p[1])),north:Math.max(...points.map(p=>p[1]))};},
              describeSource:async month=>{const source=await dependencies.builtinBaseline.prepareProjectBaseline(month);const coverage=await dependencies.domains.projectDomain.baselineCoverage(source.baselineId,month);return '선택 시점에 Core가 제공하는 영역 '+coverage.available+'개 · 조회 시점: '+source.sourceMonth+' · 선택 시점 '+month+'의 Core 시간 기록을 조회합니다. 자료가 없는 객체는 표시되지 않으며, 현대 형상을 과거 확정 경계로 보장하지 않습니다. 날짜 미확인 현대 형상은 현재 달의 현행 참고 자료입니다. 출처: 국가별 지도 자료 및 객체별 출처.';},
            },
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
            runEntityEditAction: dependencies.territorialEditingB.runEntityEditAction,
            runModePrimaryAction: dependencies.taskPresentation.runModePrimaryAction,
            copySelectedEntityToRegion: dependencies.territorialConversion.copySelectedEntityToRegion,
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
            reportOperationError: (error, context) => {
              dependencies.readiness.reliabilityDiagnostic.push({ category: 'editor-property', code: error?.code || 'PL-EDITOR-PROPERTY', ...context,
                message: String(error?.message || error), stack: String(error?.stack || '') });
              dependencies.feedback.setActionStatus('객체 편집을 완료하지 못했습니다.', 'error', 4200);
            },
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
          mapInputPresentation = (0, dependencies.uiFactoriesB.createMapInputPresentation)({productMode:'editor',ports:dependencies,window,navigator,
            createMapInputController:dependencies.uiFactoriesA.createMapInputController,
            getRevision:()=>dependencies.pointerInteractionA.editInteractionRevision,mapInteractionGate,
            editing:{domain:dependencies.domains.editingDomain,getDraftSnapshot:dependencies.draftPresentation.editingDraftSnapshot,
              isGenericFeatureDraftTool:dependencies.surfaces.isGenericFeatureDraftTool,dispatchInteraction:dependencies.countryEditingA.dispatchEditingInteraction}});
            mapDebug.installRenderFacade();
        },
      ],
      startup: async () => { await dependencies.physicalResources.loadPhysicalLandMask(); return dependencies.startup.init(); },
      onReady:async context=>{if(onStarted)await onStarted(context);if(context.isActive())dependencies.startupCommands.markRuntimeReady();},
      onError: dependencies.readinessUi.showFatalError,
      getDisposables: () => [...(onStopped?[{dispose:onStopped}]:[]),{dispose:dependencies.gisRuntime.disposeFileAccess},{dispose:dependencies.workspaceUiB.disposeWorkspaceSurfaces},{dispose:dependencies.platformConfigurationB.disposeEnvironment},dependencies.workspaceUiB.editorWorkspacePresentation, mapInputPresentation, propertyEditorUi, dependencies.domainControllers.territorialPropertyController, dependencies.domains.selectionUiController, dependencies.domains.renderingDomain, dependencies.domains.editingDomain, dependencies.domains.selectionDomain, dependencies.gisRuntime.gisWorkflow, dependencies.domainControllers.gisDomain, dependencies.domains.projectDomain,dependencies.domains.commandOwner],
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
