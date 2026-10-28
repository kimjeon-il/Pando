import {createMapRenderingResources} from '../../../../../shared/frontend/js/modules/map-renderer-composition.js';
import {createEditingPresentation} from './editing-presentation.js';
import {createMapDisplayClient} from "../../../../../shared/frontend/js/modules/map-display-client.js";
import { rememberCutPreparation } from './cut-preparation-cache.js';
import { geometryRevision } from "../../../../../shared/frontend/js/modules/geometry-versions.js";
import { freezeEditingGeometry } from './editing-render-packet.js';
import { boundaryTouchesGeometry } from './territorial-interaction-policy.js';
import { resolveTerritorialColor } from "../../../../../shared/frontend/js/modules/color-adapter.js";
import { createDocumentSession } from "../../../../../shared/frontend/js/modules/document-session.js";
import { coreSelectionRefToWeb,webSelectionRefToCore } from "../../../../../shared/frontend/js/modules/core-object-ref.js";
/** DomainAssembly: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createDomainAssembly() {
  let dependencies;
  const cutSources = new WeakMap();
  let cutSourceSequence = 0;
  let cutRequest = null;
  let confirmedCutSource = null;
  let projectDomain;
  let selectionDomain;
  let renderingDomain;
  let gisDomain;
  let editingDomain;
  let selectionUiController;
  let territorialPropertyController;
  let objectPropertyController;
  let objectSearchController;
  let territorialEntityStore;
  let territorialEntityRepository;
  let commandOwner;
  let documentModel;
  let domainsReady;
  function connect(ports) {
    if (dependencies) throw new Error('domain-assembly already connected');
    dependencies = ports;
  }

  function initializeDomainBoundaries() {
    return domainsReady ||= initializeAcceptedDomains();
  }
  function invalidateAcceptedImpact(reason,outcome,{ history = false } = {}) {
    const impact=outcome.delta?.impact;
    if(!impact || !Array.isArray(impact.geometryDomains) || !Array.isArray(impact.identityDomains)
      || typeof impact.timelineChanged!=='boolean')throw new TypeError('Canonical C++ command render impact is required.');
    const domains=new Set(impact.geometryDomains);
    const identities=new Set(impact.identityDomains);
    if(domains.has('territorial') || impact.timelineChanged) {
      renderingDomain.invalidateCountryPatch(reason);
      renderingDomain.invalidateTerritorialPatch(reason);
    }
    if(domains.has('hydro'))renderingDomain.invalidateHydroPatch(reason);
    if(domains.has('generic'))renderingDomain.invalidateGenericPatch(reason);
    if(domains.has('label'))renderingDomain.invalidateLabels(reason);
    if(domains.has('distributionEntry') || domains.has('distributionLayer')
      || identities.has('distributionEntry') || identities.has('distributionLayer'))renderingDomain.invalidateOverlayGeometry('distribution',reason);
    if(history) {
      if(identities.has('territorial')) {
        dependencies.rendering.gpuMapRenderer.invalidateCountryPalette({ base: true,emphasis: true },reason);
        renderingDomain.invalidateBaseScene(reason);
      }
      if(identities.has('territorial') || identities.has('label'))renderingDomain.invalidateLabels(reason);
      if(identities.has('hydro') && !domains.has('hydro'))renderingDomain.invalidateHydroPatch(reason);
      if(identities.has('generic') && !domains.has('generic'))renderingDomain.invalidateGenericPatch(reason);
    }
  }
  async function initializeAcceptedDomains() {
    if (projectDomain || selectionDomain || renderingDomain || gisDomain || editingDomain) return;
    await commandOwner.load(JSON.stringify(documentModel.snapshot()));
    dependencies.projectSession.installDocumentProjection({ documentModel,commandOwner,entityStore: territorialEntityStore });
    const domainListeners = new Map();
    // Rendering domains are created before initSvg() so project/GIS services can
    // be available during bootstrap. Resource references are plain snapshots;
    // the rendering coordinator refreshes them once at the start of a frame.
    const domainContext = Object.freeze({
      getProjectSnapshot: () => documentModel.snapshot(),
      getSessionSnapshot: () => (0, dependencies.platform.deepClone)({ projection: dependencies.projectState.state.projection, view: dependencies.projectState.state.view, selected: dependencies.projectState.state.selected }),
      dispatchProjectCommand: command => projectDomain.executeCommand(command),
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
        const layout = (0, dependencies.mapView.projectionLayoutMetrics)();
        return { width: layout.width, height: layout.height, dpr: layout.dpr };
      },
      getFrameContext: () => window.__PANDOLAB_VIEW_STATE__ || null,
      reportDiagnostic: entry => dependencies.readiness.reliabilityDiagnostic.push({ category: 'domain', ...entry }),
    });
    projectDomain = (0, dependencies.domainFactories.createProjectDomain)({
      productMode: 'editor',
      commandOwner,documentModel,
      viewingPresentation:payload=>dependencies.projectSession.applyViewingPresentation(payload),
      appVersion: dependencies.platformConfigurationA.APP_VERSION,
      readBuiltinSelectionCatalogs: () => [
        { domain: 'placeBuiltin',refs: dependencies.countryLabelModel.builtinPlaceSelectionReferences() },
        { domain: 'hydroBuiltin',refs: dependencies.physicalResources.builtinHydroSelectionReferences() },
      ],
      readPresentationCatalog: () => dependencies.objectCatalogView.presentationCatalog(),
      publishCommand: async (outcome,{ reason } = {}) => {
        if(outcome.ok && outcome.changed && (reason==='project-undo' || reason==='project-redo')) await dependencies.projectSnapshots.finishHistoryTravel();
        if(reason==='command-rollback') {
          selectionUiController.presentPrimary({ refreshOnly: true });
          renderingDomain.invalidateProject('command-rollback');
        }
      },
      replaceSnapshot: (project, options) => {
        const resetOptions = {
          projectGeneration: options?.generation,
          skipRenderReset: options?.skipRenderReset === true,
          prepared: options?.prepared,
          catalogAlreadyAdmitted: true,
        };
        if (project) return (0, dependencies.projectRestore.applyAtlasState)(project, options?.reason === 'load', resetOptions);
        return (0, dependencies.projectRestore.resetProjectInPlace)(resetOptions);
      },
      persistence: dependencies.persistence.persistenceService,
      saveState: dependencies.projectSession.saveState,
      prepareNewProject: async setup => {
        const countryIds = dependencies.builtinCountries.canonicalCountryStore?.ids?.() || [];
        const [baseline] = await Promise.all([
          dependencies.builtinBaseline.prepareProjectBaseline(setup.initialMonth),
          dependencies.rendering.gpuMapRenderer.ensureBuiltinMeshBaseline(countryIds),
        ]);
        return { baselineId:baseline.baselineId,
          builtinMeshReady: true };
      },
      createProjectFile: async (project,{ spatialState }) => {
        await (0, dependencies.gisServicesA.ensureGisIoRuntime)();
        if (!window.PandoLabGIS?.exportGeoPackage) throw new Error('GeoPackage 저장 모듈을 불러오지 못했습니다.');
        return window.PandoLabGIS.exportGeoPackage(project, () => undefined,{ spatialState });
      },
      restoreReplacement: async (project, generation) => {
        await (0, dependencies.projectRestore.applyAtlasState)(project, false, { projectGeneration: generation,skipRenderReset: true,
          preserveCoreSession: true,catalogAlreadyAdmitted: true });
        dependencies.lifecycleUi.projectUi.syncHistory();
        renderingDomain?.invalidateProject?.('project-rollback');
      },
      invalidateProject: reason => renderingDomain?.invalidateProject?.(reason),
      invalidateCommand: invalidateAcceptedImpact,
      invalidateHistory: (reason,outcome) => invalidateAcceptedImpact(reason,outcome,{ history: true }),
      reportDiagnostic: entry => dependencies.readiness.reliabilityDiagnostic.push({ category: 'project', ...entry }),
      onProjectChanged: event => {
        window.dispatchEvent(new CustomEvent('pandolab:project-changed', { detail: event }));
        dependencies.lifecycleUi.projectUi.syncHistory();
      },
      onReplacementState: async (replacing, reason) => {
        dependencies.projectState.state.projectReplacing = replacing;
        if (replacing) {
          await editingDomain.cancelActiveGesture(`project-${reason}-preparing`);
          if (reason === 'new') (0, dependencies.feedback.setActionStatus)('새 프로젝트 준비 중…', 'working', 0);
        }
      },
      captureEditorSession:()=>({view:dependencies.projectSession.captureReplacement(),editing:editingDomain.captureReplacement()}),
      restoreEditorSession:async(capsule,generation)=>{if(!capsule)return;capsule.view();capsule.editing(generation);selectionUiController.presentPrimary({refreshOnly:false});dependencies.taskPresentation.updateModeButtons();dependencies.mapView.syncMapHostFromState();renderingDomain.invalidateProject('replacement-editor-rollback');},
      onReplacementCommitted: reason => {
        if (reason === 'new') (0, dependencies.feedback.setActionStatus)('새 프로젝트를 만들었습니다.', 'success', 3200, { forceVisible: true });
      },
      onReplacementError: (error, reason) => {
        if (reason === 'new') (0, dependencies.feedback.setActionStatus)(error?.message || '새 프로젝트를 준비하지 못했습니다. 기존 프로젝트를 유지했습니다.', 'error', 0);
      },
      onProjectReset: async event => {
        await selectionDomain.resetProject(event.generation);
        selectionUiController.resetProject();
        await editingDomain.resetProject(event.generation);
        renderingDomain?.resetProjectGeneration(event.generation);
      },
    });

    dependencies.persistence.initializeCoreServices({ commandOwner: projectDomain,documentModel });
    gisDomain = (0, dependencies.domainFactories.createGisDomain)({
      projectDomain,
      importService: () => dependencies.gisRuntime.gisWorkflow.ensure(),
      riverPartitionWorkerFactory: () => new Worker((0, dependencies.platform.runtimeAssetUrl)('workers/river-territory-partition-worker.js'), {
        type: 'module', name: 'pandolab-river-territory-partitions',
      }),
      riverPartitionSource: {
        ensureReady: async () => {
          if (dependencies.projectState.state.physicalLoadState.hydro === 'ready') return true;
          const ready = await (0, dependencies.physicalData.loadHydroData)(dependencies.projectState.state.physicalLoadState.hydro === 'error');
          if (!ready) throw new Error('강·호수 데이터가 아직 준비되지 않았습니다.');
          return true;
        },
        queryBounds: dependencies.riverCandidates.riverPartitionQueryBounds,
        queryLogicalFeatures: bounds => dependencies.rendering.gpuMapRenderer.queryHydroLogicalFeatures(bounds, { category: 'river' }),
        loadLogicalFeature: async logicalId => {
          const feature=await dependencies.rendering.gpuMapRenderer.loadHydroLogicalFeature(logicalId);
          if(feature)await dependencies.physicalResources.admitHydroFeatures([feature]);return feature;
        },
        getEditRivers: boundsList => dependencies.projectState.state.hydroEdits.filter(feature => (
          feature?.properties?.category === 'river'
          && feature.geometry
          && boundsList.some(bounds => (0, dependencies.riverCandidates.riverPartitionBoundsOverlap)((0, dependencies.spatialQuery.geometryBounds)(feature.geometry), bounds))
        )),
        featureKey: dependencies.riverCandidates.riverPartitionFeatureKey,
      },
      reportDiagnostic: entry => dependencies.readiness.reliabilityDiagnostic.push({ category: 'gis-domain', ...entry }),
    });

    selectionDomain = (0, dependencies.domainFactories.createSelectionDomain)({
      commandOwner,
      refAdapter: { fromCore: coreSelectionRefToWeb,toCore: ref => webSelectionRefToCore(ref,
        { isStoredHydro: id => documentModel.get({ domain: 'hydro',id })!==null }) },
      projectDomain,
      onSelectionChanged: (snapshot, _reason, previousSelection) => {
        const previous = previousSelection.items.find(item => item.key === previousSelection.primaryKey) || null;
        if (previous?.domain === 'hydro' && dependencies.projectState.state.tool === 'select'
          && previous.key !== dependencies.projectState.state.selected?.key) {
          editingDomain.cancelActiveGesture('object-target-changed',{ emitChange: false }).catch(error => dependencies.feedback.reportOperationError(error,
            '이전 객체의 편집 동작을 취소하지 못했습니다.','PL-EDIT-SELECTION-CANCEL-001',4200));
        }
        editingDomain?.refreshEditingPresentation('selection-edit-target');
        selectionUiController?.sync?.(snapshot);
      },
      onHoverChanged: snapshot => dependencies.platformConfigurationB.tooltipController.setMapHover(snapshot.hover ? dependencies.objectOperationsA.objectDisplayInfo(snapshot.hover) : null),
      requestRender: reason => renderingDomain ? renderingDomain.invalidateSelection(reason) : false,
    });

    objectPropertyController = (0, dependencies.uiFactoriesB.createObjectPropertyController)({
      document,
      getElement: dependencies.platform.$,
      state: dependencies.projectState.state,
      replaceSelectOptions: dependencies.propertyEditingB.replaceSelectOptions,
      distributionModes: dependencies.territorialModel.DISTRIBUTION_MODES,
      colorDomains: dependencies.colorModel.COLOR_DOMAINS,
      defaultGenericFeatureColor: dependencies.colorModel.DEFAULT_GENERIC_FEATURE_COLOR,
      hydroToolConfig: dependencies.hydroPresentation.HYDRO_TOOL_CONFIG,
      territorialEntityRepository: territorialEntityRepository,
      distributionService: dependencies.objectModelA.distributionService,
      distributionEntriesForLayer: dependencies.distributionServices.distributionEntriesForLayer,
      genericFeatureById: id => dependencies.projectState.state.genericFeatures.find(feature => String(feature.id) === String(id)),
      genericFeatureGeometryKind: dependencies.objectPresentation.genericFeatureGeometryKind,
      genericFeatureRoleLabel: dependencies.objectPresentation.genericFeatureRoleLabel,
      genericFeatureRoleHelp: dependencies.objectModelA.genericFeatureRoleHelp,
      genericFeatureName: dependencies.objectPresentation.genericFeatureName,
      defaultGenericFeatureColorFor: dependencies.objectModelA.defaultGenericFeatureColor,
      labelById: dependencies.countryLabelModel.labelById,
      labelKey: dependencies.labelPresentation.labelKey,
      automaticLabelSettings: dependencies.labelPresentation.automaticLabelSettings,
      hydroFeatureById: dependencies.hydroModel.hydroFeatureById,
      hydroEditById: dependencies.hydroPresentation.hydroEditById,
      hydroCategoryKey: dependencies.hydroPresentation.hydroCategoryKey,
      hydroCategoryLabel: dependencies.hydroPresentation.hydroCategoryLabel,
      hydroFallbackName: dependencies.hydroPresentation.hydroFallbackName,
      hydroEditorName: dependencies.hydroPresentation.hydroEditorName,
      prepareHydroFeature: dependencies.physicalResources.prepareHydroFeature,
      gpuMapRenderer: dependencies.rendering.gpuMapRenderer,
      readDomainColor: dependencies.colorModel.readDomainColor,
      syncColorPicker: dependencies.colorPicker.syncColorPicker,
      formatArea: dependencies.applicationServicesA.formatArea,
      geometryAreaKm2: dependencies.applicationServicesB.sphericalGeometryAreaKm2,
      layerNameCompare: (left, right) => dependencies.objectModelA.layerNameCollator.compare(left, right),
      objectSearchController: () => objectSearchController,
      syncObjectActionsMenu: dependencies.objectOperationsB.syncObjectActionsMenu,
      closeObjectActionsMenu: dependencies.objectOperationsA.closeObjectActionsMenu,
      setEditorShellView: dependencies.propertyEditingB.setEditorShellView,
      syncStatusBar: dependencies.readinessUi.syncStatusBar,
      createEmptyState: dependencies.platformConfigurationB.createEmptyState,
      createSemanticIcon: dependencies.applicationFactories.createSemanticIcon,
      onHydroLoaded: async full => {
        await dependencies.physicalResources.admitHydroFeatures([full]);
        const key = String(full.properties?.pandolab_id || full.id);
        const selected = dependencies.projectState.state.selected;
        if (selected?.domain === 'hydro' && selected.id === key) objectPropertyController.present(selected, { refreshOnly: true });
      },
      reportOperationError: dependencies.feedback.reportOperationError,
    });

    const defaultTerritorialColor = view => resolveTerritorialColor({ ...view.feature, properties: { ...view.properties, style: {} } }, {
      entityRepository: territorialEntityRepository,
      countryColor: dependencies.colorModel.defaultCountryColor,
      fallback: dependencies.colorModel.DEFAULT_GENERIC_FEATURE_COLOR,
    });
    const resolveTerritorialEditorColor = view => dependencies.colorModel.readDomainColor(dependencies.colorModel.COLOR_DOMAINS.TERRITORIAL, { feature: view.feature }, {
      inherited: defaultTerritorialColor(view), fallback: dependencies.colorModel.DEFAULT_GENERIC_FEATURE_COLOR,
    });
    const getTerritorialView = value => {
      const ref = dependencies.selectionServices.normalizeObjectRef(value);
      if (ref?.domain !== 'territorial') return null;
      const feature = territorialEntityRepository.get(ref.id);
      if (!feature || ref.type !== 'entity') return null;
      const info = dependencies.objectOperationsA.objectDisplayInfo(ref);
      const displayName = info.name;
      const statusName = displayName;
      return { ref, id: String(feature.id), feature, properties: feature.properties, displayName, name: displayName,
        statusName,
        flagUrl: info.flagUrl,
        hasFlagOverride: Object.hasOwn(feature.properties?.metadata || {}, 'flagDataUrl') };
    };
    territorialPropertyController = (0, dependencies.uiFactoriesA.createTerritorialPropertyController)({
      window,
      document,
      elements: {
        name: (0, dependencies.platform.$)('entityNameInput'),
        color: (0, dependencies.platform.$)('entityColorInput'),
        notes: (0, dependencies.platform.$)('entityNotesInput'),
        area: (0, dependencies.platform.$)('entityAreaValue'),
        selectionStatus: (0, dependencies.platform.$)('selectionStatus'),
      },
      getTerritorialView,
      entityRepository: territorialEntityRepository,
      focusObject: dependencies.objectOperationsA.focusObjectRef,
      createIcon: (name, className) => dependencies.applicationFactories.createSemanticIcon(document, name, className),
      getPrimaryRef: () => selectionDomain.primary(),
      showPropertyForm: (...args) => objectPropertyController.show(...args),
      resolveColor: resolveTerritorialEditorColor,
      defaultColor: defaultTerritorialColor,
      syncColorPicker: dependencies.colorPicker.syncColorPicker,
      calculateAreaKm2: dependencies.applicationServicesB.sphericalGeometryAreaKm2,
      formatArea: dependencies.applicationServicesA.formatArea,
      syncActions: dependencies.taskPresentation.syncCountryActionButtons,
      syncStatus: dependencies.readinessUi.syncStatusBar,
      commitField: dependencies.objectMetadata.commitTerritorialMetadata,
      commitRelation: dependencies.objectMetadata.commitTerritorialRelation,
      getElement: dependencies.platform.$,
      territorialParentOptions: dependencies.propertyEditingB.territorialParentOptions,
      refreshTerritorialCoastAvailability: dependencies.territorialEditingB.refreshTerritorialCoastAvailability,
      replaceSelectOptions: dependencies.propertyEditingB.replaceSelectOptions,
      syncLayerSelection: () => objectSearchController?.syncSelection(),
      commitFlag: (ref, value) => dependencies.objectMetadata.commitTerritorialMetadata(ref, 'flagDataUrl', value),
      openFlagLibrary: dependencies.flagLibrary.openFlagLibraryPicker,
      closeColorPickers: dependencies.colorPicker.closeAllColorPickers,
      getProjectGeneration: () => projectDomain.getGeneration(),
      isMutationBlocked: ref => dependencies.projectState.state.projectReplacing
        || dependencies.projectState.state.modeProcessing || dependencies.objectOperationsA.objectRefLocked(ref)
        || dependencies.projectState.state.tool !== 'select' || !!dependencies.projectState.state.labelPlacementMode
        || !!dependencies.projectState.state.territorySelectionSession || !!dependencies.projectState.state.geometryPreview?.session
        || !!editingDomain?.draftInputActive(),
      reportFlagError: error => {
        dependencies.readiness.reliabilityDiagnostic.push({ category: 'editor-flag', code: 'PL-EDITOR-FLAG', message: String(error?.message || error) });
        dependencies.feedback.setActionStatus('깃발을 불러오지 못했습니다.', 'error', 4200);
      },
      reportEditError: (error, operation) => {
        dependencies.readiness.reliabilityDiagnostic.push({ category: 'editor-territorial', code: error?.code || 'PL-EDITOR-TERRITORIAL', operation,
          message: String(error?.message || error), stack: String(error?.stack || '') });
        dependencies.feedback.setActionStatus('영역 정보를 변경하지 못했습니다.', 'error', 4200);
      },
      metrics: dependencies.rendering.selectionPerformanceMetrics,
    });

    selectionUiController = (0, dependencies.uiFactoriesB.createSelectionUiController)({
      window,
      document,
      selectionDomain,
      elements: {
        selectionStatus: (0, dependencies.platform.$)('selectionStatus'),
      },
      resolveRef: dependencies.selectionServices.normalizeObjectRef,
      refExists: dependencies.objectLookup.objectRefExists,
      displayInfo: dependencies.objectOperationsA.objectDisplayInfo,
      presenters: {
        resolve: ref => {
          if (ref.domain === 'territorial') {
            return (value, options) => territorialPropertyController.present(value, options);
          }
          return (value, options) => { territorialPropertyController.clear(); return objectPropertyController.present(value, options); };
        },
        multiple: (selection, detail) => {
          territorialPropertyController.clear();
          return objectPropertyController.show('multi', '공통 속성', {
            resetScroll: false,
            typeLabel: detail.typeLabel,
          });
        },
      },
      uiActions: {
        focusObject: dependencies.objectOperationsA.focusObjectRef,
        openEditor: () => {
          const startedAt = performance.now();
          (0, dependencies.workspaceUiB.openSelectionEditor)({ explicit: true });
          dependencies.rendering.selectionPerformanceMetrics.editorOpenMs = performance.now() - startedAt;
        },
        clearPresenter: () => {
          territorialPropertyController.clear();
          if ((0, dependencies.platform.$)('selectionStatus')) (0, dependencies.platform.$)('selectionStatus').textContent = '';
          objectPropertyController.show(null);
          (0, dependencies.taskPresentation.syncCountryActionButtons)();
          if (dependencies.surfaces.layoutMode === 'wide') {
            dependencies.workspaceUiB.surfaceState.editorManuallyCollapsed = false;
            if (dependencies.workspaceUiB.surfaceState.editorOpen) (0, dependencies.workspaceUiA.closeSurface)('editor');
          }
        },
        syncBatchActions: dependencies.objectOperationsB.syncBatchActionAvailability,
        syncMapSurfaces: dependencies.taskPresentation.syncMapContextSurfaces,
        syncLayerRows: selection => objectSearchController?.syncSelection(selection, { reveal: true }),
        closeChooser: dependencies.objectPicking.closeObjectChooser,
      },
      metrics: dependencies.rendering.selectionPerformanceMetrics,
    });
    territorialPropertyController.bind();

    editingDomain = (0, dependencies.domainFactories.createEditingDomain)({
      commandOwner,
      context: domainContext,
      projectDomain,
      gisDomain,
      selectionDomain,
      toolController: {
        requireCanonicalData: dependencies.readinessUi.requireCanonicalData,
        getGeometryPreviewSession: () => dependencies.projectState.state.territorySelectionSession
          && dependencies.projectState.state.territorySelectionSession.stage !== 'review'
          ? null
          : dependencies.projectState.state.geometryPreview.session,
        getCurrentTool: () => dependencies.projectState.state.tool,
        discardGeometryPreview: dependencies.geometryOperations.discardActiveGeometryPreview,
        clearHover: async () => { dependencies.interactionStateCommands.setHoverHit(null);await selectionDomain.setHover(null); },
        resetForTool: async tool => {
          dependencies.projectState.state.boundaryPreparation?.cancel();
          dependencies.projectState.state.boundaryPreparation = null;
          dependencies.projectState.state.labelPlacementMode = false;
          if (tool !== 'country-coast') {
            dependencies.projectState.state.coastEditCountryId = null;
            dependencies.projectState.state.coastEditScopeGenericFeatureId = null;
            dependencies.projectState.state.coastEditReturnSelection = null;
          }
          if (tool !== 'territorial-border') (0, dependencies.countryEditingB.resetBoundaryEditState)();
          if (tool !== 'merge-country') (0, dependencies.countryEditingB.resetMergeState)();
          if (tool !== 'merge-generic-feature') (0, dependencies.countryEditingB.resetGenericFeatureMergeState)();
          if (tool !== 'split-generic-feature') dependencies.projectState.state.genericFeatureSplitSourceId = null;
          if (tool !== 'merge-territorial-unit') {
            dependencies.projectState.state.territorialUnitMergeSourceId = null;
            dependencies.projectState.state.territorialUnitMergeTargetIds = [];
          }
          if (tool !== 'split-territorial-unit') {
            dependencies.projectState.state.territorialUnitSplitSourceId = null;
            dependencies.projectState.state.territorialUnitSplitVirtualSource = null;
          }
          if (tool !== 'redraw-territorial-unit') dependencies.projectState.state.territorialUnitRedrawSourceId = null;
          if (!['river', 'lake'].includes(tool)) dependencies.projectState.state.multiDraft = null;
          const territorySelection = dependencies.projectState.state.territorySelectionSession;
          if (territorySelection && !territorySelection.applying && territorySelection.tool !== tool) {
            await dependencies.territorySelectionA.clearTerritorySelection({ discardPreview: true, refreshUi: false });
          }
        },
        applyToolPresentation: (tool, options = {}) => {
          dependencies.projectState.state.tool = tool;
          (0, dependencies.readinessUi.setCurrentTool)((0, dependencies.labelServices.toolLabel)(tool));
          (0, dependencies.taskUi.setModeBanner)();
          (0, dependencies.taskUi.updateModeButtons)();
          return options;
        },
      },
      previewController: dependencies.geometryOperations.editPreviewController,
      draftServices: {
        reportOperationError: (error,code) => dependencies.feedback.reportOperationError(error,'작성 중인 경로를 변경하지 못했습니다.',code,4200),
        getToolConfig: tool => {
          if (dependencies.projectState.state.geometryPreview.session) return null;
          const config = (0, dependencies.countryEditingA.draftToolConfig)(tool);
          return config ? { ...config, minimumPoints: config.shape === 'polygon' ? 3 : 2 } : null;
        },
        isSpacePanActive: () => dependencies.projectState.state.spacePanActive,
        screenSample: screenPoint => {
          const coordinate = (0, dependencies.mapView.screenToGeo)(screenPoint);
          return coordinate ? { screen: screenPoint.slice(), coordinate } : null;
        },
        projectCoordinate: coordinate => (0, dependencies.mapView.activeProjection)()(coordinate),
        screenToCoordinate: point => (0, dependencies.mapView.screenToGeo)(point),
        snapCandidates: ({ coordinate, excludeNodeKey }) => (0, dependencies.pointerInteractionA.localSnapCandidates)(coordinate)
          .filter(candidate => !excludeNodeKey || candidate.nodeKey !== excludeNodeKey),
        cancelPreparation: () => {
          if (cutRequest?.pending) cutRequest.abortController.abort();
          cutRequest = null;
          confirmedCutSource = null;
        },
        assessDraft: ({ tool, coords, buildPreview }) => {
          const source = (0, dependencies.draftPresentation.activeCutDraftSourceGeometry)();
          if (!source) { cutRequest = null; return null; }
          let sourceKey = cutSources.get(source);
          if (!sourceKey) { sourceKey = `cut:${++cutSourceSequence}`; cutSources.set(source, sourceKey); }
          sourceKey += `:${geometryRevision(source)}`;
          const projection = (0, dependencies.mapView.activeProjection)();
          const view = { kind: dependencies.projectState.state.projection, scale: projection.scale(), translate: projection.translate(),
            rotate: projection.rotate(), center: projection.center(), size: { ...dependencies.projectState.state.size },
            coarsePointer: globalThis.matchMedia?.('(pointer: coarse)')?.matches === true,
            snapDistance: dependencies.geometryValidation.CUT_ENDPOINT_SNAP_DISTANCE };
          const workerStats = dependencies.spatialQuery.mapEditClient.stats();
          const key = JSON.stringify([sourceKey, coords, view, buildPreview, tool, projectDomain?.getGeneration?.()]);
          if (cutRequest?.key === key) return cutRequest.promise;
          const entry = { key, sourceKey, promise: null, pending: true, abortController: new AbortController() };
          cutRequest = entry;
          entry.promise = dependencies.spatialQuery.mapEditClient.execute('territorial-cut', { payload: {
            sourceKey, source: confirmedCutSource?.key === sourceKey && confirmedCutSource.workerRevision === workerStats.dataRevision && workerStats.ready ? undefined : source,
            coords, view, buildPreview,
          } }, { jobKey: 'territorial-cut', signal: entry.abortController.signal }).then(response => {
            for (const candidate of response.result.split?.candidates || []) {
              freezeEditingGeometry(candidate.geometry);
              if (candidate.feature) freezeEditingGeometry(candidate.feature.geometry);
            }
            if (cutRequest === entry) {
              confirmedCutSource = { key: sourceKey, workerRevision: response.geometryRevision };
              rememberCutPreparation(source, coords, response.result);
            }
            return response.result;
          }).catch(error => { if (cutRequest === entry) { cutRequest = null; confirmedCutSource = null; } throw error; }).finally(() => { entry.pending = false; });
          return entry.promise;
        },
        requestFrame: callback => requestAnimationFrame(callback),
        cancelFrame: handle => cancelAnimationFrame(handle),
        onTooShort: config => (0, dependencies.feedback.setActionStatus)(`형상이 너무 짧습니다. ${config?.shape === 'polygon' ? '영역의 경계를 더 크게' : '선을 더 길게'} 그려주세요.`, 'error', 3200),
        onFinished: () => {
          if (!(0, dependencies.draftPresentation.activeCutDraftSourceGeometry)()) (0, dependencies.taskUi.setModeBanner)('꼭짓점을 드래그해 미세조정하세요.');
        },
      },
      geometryEditing: {
        boundaryDraftActive: () => dependencies.projectState.state.tool === 'country-coast' || dependencies.projectState.state.tool === 'territorial-border' && dependencies.projectState.state.boundaryEditPhase === 'editing',
        resolveObjectFeature: targetRef => {
          if (targetRef?.domain === 'hydro') return dependencies.projectState.state.hydroEdits.find(item => String(item.id) === String(targetRef.id)) || null;
          if (targetRef?.domain === 'generic') return dependencies.projectState.state.genericFeatures.find(item => String(item.id) === String(targetRef.id)) || null;
          return null;
        },
        canEditObject: (feature, _vertex, targetRef) => {
          const ref = (0, dependencies.selectionServices.normalizeObjectRef)(targetRef);
          if (!(0, dependencies.objectOperationsA.objectRefVisible)(ref)) return false;
          if (feature?.properties?.locked === true) {
            (0, dependencies.feedback.setActionStatus)('잠금을 해제한 뒤 꼭짓점을 이동하세요.', 'error', 3200);
            return false;
          }
          return ref.domain === 'generic' || (0, dependencies.hydroModel.isHydroEditFeature)(feature);
        },
        captureObjectGestureSnapshot: () => ({ expectedEpoch: commandOwner.state().epoch,projectGeneration: projectDomain.getGeneration() }),
        getObjectVertexTarget: requestedRef => {
          if(!requestedRef)return null;
          if (dependencies.projectState.state.tool !== 'select') return null;
          const selected = requestedRef;
          if (selected?.domain === 'hydro') {
            if (!(0, dependencies.objectOperationsA.objectRefVisible)(selected)) return null;
            const feature = dependencies.projectState.state.hydroEdits.find(item => String(item.id) === String(selected.id));
            return feature ? { targetRef: (0, dependencies.selectionServices.normalizeObjectRef)({ domain: 'hydro',
              type: feature.properties.category, id: String(feature.id) }), mode: 'hydro', feature } : null;
          }
          if (selected?.domain === 'generic') {
            if (!(0, dependencies.objectOperationsA.objectRefVisible)(selected)) return null;
            const feature = dependencies.projectState.state.genericFeatures.find(item => String(item.id) === String(selected.id));
            return feature && ['LineString','MultiLineString','Polygon','MultiPolygon'].includes(feature.geometry.type)
              ? { targetRef: (0, dependencies.selectionServices.normalizeObjectRef)({ domain: 'generic',type: 'feature',id: feature.id }),mode: 'generic',feature } : null;
          }
          return null;
        },
        previewObjectGesture: ({ targetRef, source, feature, segments, gestureId }) => {
          if (dependencies.geometryOperations.editPreviewController.snapshot().gestureId === gestureId) {
            (0, dependencies.gpuRenderingB.updateActiveEditPreview)(segments);
          } else (0, dependencies.gpuRenderingA.beginActiveEditPreview)({
            key: `${targetRef.domain}:${source.id}`, gestureId, segments,
            targetRefs: [(0, dependencies.selectionServices.normalizeObjectRef)(targetRef)],
          });
          return feature;
        },
        commitObjectGesture: async ({ targetRef, source, feature, changed, snapshot, previewId }) => {
          const hydroEdit = targetRef.domain === 'hydro';
          if (!changed) {
            renderingDomain?.invalidateEditedGeometryPatch?.(hydroEdit ? 'hydro' : 'generic', 'vertex-preview-no-change');
            return false;
          }
          const result=await projectDomain.executeCommand(hydroEdit ? { commandId: 'hydro.geometry',expectedEpoch: snapshot.expectedEpoch,
            targets: [{ domain: 'hydro',id: source.id }],payload: { id: source.id,geometry: feature.geometry } }
            : { commandId: 'content.edit',expectedEpoch: snapshot.expectedEpoch,targets: [{ domain: 'generic',id: source.id }],
              payload: { domain: 'generic',id: source.id,value: feature,create: false } });
          if(!result.ok)throw Object.assign(new Error(result.error.message),{ code: result.error.code });
          if(!result.changed || snapshot.projectGeneration!==projectDomain.getGeneration() || dependencies.projectState.state.projectReplacing)return false;
          const accepted=documentModel.get({ domain: targetRef.domain,id: source.id });
          if (hydroEdit) dependencies.spatialQuery.mapObjectGeometryRevisions.hydro += 1;
          else dependencies.spatialQuery.mapObjectGeometryRevisions.generic += 1;
          if (previewId) dependencies.geometryOperations.editPreviewController.handoff(previewId, {
            kind: 'object', objectKey: (0, dependencies.selectionServices.normalizeObjectRef)(targetRef).key,
            geometry: accepted.geometry, geometryRevision: geometryRevision(accepted.geometry),
          });
          renderingDomain?.invalidateEditedGeometryPatch?.(hydroEdit ? 'hydro' : 'generic', 'vertex-edit-commit');
          (0, dependencies.feedback.setActionStatus)('꼭짓점을 이동했습니다.', 'success');
          return true;
        },
        beginBoundaryGesture: event => {
          if (!['territorial-border', 'country-coast'].includes(dependencies.projectState.state.tool)) return false;
          const preparation = dependencies.projectState.state.boundaryPreparation;
          if (preparation?.status !== 'ready') return false;
          if (!preparation.current()) {
            preparation.status = 'error';
            preparation.message = '형상이나 소속·잠금이 바뀌었습니다. 경계를 다시 준비하세요.';
            (0, dependencies.taskUi.updateModeButtons)();
            return false;
          }
          const node = preparation.nodes.get(String(event.vertexKey || ''));
          if (!node || node.fixed) return false;
          const borderMode = dependencies.projectState.state.tool === 'territorial-border';
          const coastId = String(dependencies.projectState.state.coastEditCountryId || event.targetRef?.id || '');
          const affectedIds = borderMode ? new Set([...node.ownerIds].map(String)) : new Set([coastId]);
          const boundaryFeature = id => territorialEntityRepository.get(id);
          if (!(0, dependencies.objectOperationsB.requireObjectsUnlocked)([...affectedIds].map(id => ({ domain: 'territorial', type: 'entity', id: String(id) })), borderMode ? '국경을 조정' : '해안선을 조정')) return false;
          if ([...affectedIds].some(id => boundaryFeature(id)?.properties?.locked)) {
            (0, dependencies.feedback.setActionStatus)('잠긴 객체와 공유하는 경계는 이동할 수 없습니다.', 'error', 3400);
            return false;
          }
          const hierarchyIds = new Set(affectedIds);
          for (const id of affectedIds) {
            let parent = boundaryFeature(id);
            const visited = new Set();
            while (parent?.properties?.parentId && !visited.has(String(parent.id))) {
              visited.add(String(parent.id));
              hierarchyIds.add(String(parent.properties.parentId));
              parent = boundaryFeature(parent.properties.parentId);
            }
          }
          if (!(0, dependencies.objectOperationsB.requireObjectsUnlocked)([...hierarchyIds].map(id => ({ domain: 'territorial', type: 'entity', id: String(id) })), '경계를 조정')) return false;
          const lockedHierarchy = territorialEntityRepository.list().some(entity => entity.properties?.locked && (
            hierarchyIds.has(String(entity.id)) || (hierarchyIds.has(String((0, dependencies.territorialModel.territorialRootId)(entity, id => dependencies.territorialModel.entityRepository.get(id)))) && boundaryTouchesGeometry(entity.geometry, node.coordinate))
          ));
          if (lockedHierarchy) {
            (0, dependencies.feedback.setActionStatus)('변경 구간의 상위 단위 또는 자식이 잠겨 있습니다.', 'error', 3400);
            return false;
          }
          const previewId = (0, dependencies.gpuRenderingA.beginActiveEditPreview)({
            key: `${borderMode ? 'border' : 'coast'}:${[...affectedIds].sort().join('|')}:${node.key}`,
            segments: node.segments,
            targetRefs: [...affectedIds].map(id => (0, dependencies.selectionServices.normalizeObjectRef)({ domain: 'territorial', type: 'entity', id })),
          });
          return {
            borderMode,
            affectedIds,
            preparation,
            node,
            startCoordinate: node.coordinate,
            coordinate: node.coordinate,
            changed: false,
            previewId,
          };
        },
        moveBoundaryGesture: (session, coordinate) => {
          session.changed = !(0, dependencies.geometryPreview.coordNear)(session.startCoordinate, coordinate, 1e-9);
          session.coordinate = coordinate.slice();
          const same = value => dependencies.geometryPreview.coordNear(value, session.startCoordinate, 1e-9);
          const segments = session.previewSegments.map(segment => ({
            start: same(segment.start) ? coordinate : segment.start,
            end: same(segment.end) ? coordinate : segment.end,
          }));
          (0, dependencies.gpuRenderingB.updateActiveEditPreview)(segments);
        },
        previewBoundaryDraft: async ({moves,preparation,borderMode,current: draftCurrent}) => {
          preparation.calculationFailed = false;

          if (!preparation.current() || preparation.status !== 'ready') return false;
          const current = () => preparation.current() && draftCurrent();
          const affectedIds = new Set(moves.flatMap(move=>[...move.affectedIds]));
          preparation.status = 'moving';
          (0, dependencies.taskUi.updateModeButtons)();
          try {
            const response = await dependencies.spatialQuery.mapEditClient.execute('boundary-move', { payload: {
              preparationId: preparation.result.preparationId, moves: moves.map(move=>({nodeKey:move.node.nodeKey,coordinate:move.coordinate})),
            } }, { jobKey: 'boundary-move' });
            if (!current()) return false;
            const features = new Map(response.result.features.map(feature => [String(feature.id), feature]));
            const unitTarget = territorialEntityRepository.get(dependencies.projectState.state.boundaryEditSeedEntityId);
            let ready;
            if (borderMode && !(unitTarget?.properties?.entityKind === 'general' && !unitTarget?.properties?.parentId)) {
              ready = await (0, dependencies.territorialEditingB.previewTerritorialEdit)({ operation: 'boundary', targetId: unitTarget.id,
                parentId: unitTarget.properties.parentId, featurePatches: [...features.values()],
              }, { selectedId: unitTarget.id, shouldKeepResult: () => current() && dependencies.projectState.state.tool === 'territorial-border'
                && String(dependencies.projectState.state.boundaryEditSeedEntityId) === String(unitTarget.id) });
            } else if (!borderMode) {
              const countryId = [...affectedIds][0];
              ready = await (0, dependencies.territorialEditingB.previewTerritorialEdit)({
                operation: 'coast', targetId: countryId, draft: features.get(countryId)?.geometry,
              }, { selectedId: dependencies.projectState.state.coastEditReturnSelection?.id || countryId,
                shouldKeepResult: () => current() && dependencies.projectState.state.tool === 'country-coast' && String(dependencies.projectState.state.coastEditCountryId) === String(countryId) });
            } else {
              const ids = [...affectedIds];
              ready = await (0, dependencies.territorialEditingB.previewTerritorialEdit)({ operation: 'country-boundary', targetId: ids[0],
                featurePatches: [...features.values()],
              }, { selectedId: ids[0], shouldKeepResult: () => current() && dependencies.projectState.state.tool === 'territorial-border' });
            }
            if (!ready || !current()) return false;
            const result = dependencies.projectState.state.geometryPreview.session;
            if (result.validation.blocking || !result.delta.newBoundaries.length) {
              await dependencies.geometryOperations.discardActiveGeometryPreview({ announce: false });
              return false;
            }
            return true;
          } catch (error) {
            if (current() && !error.cancelled && error.name !== 'AbortError') {
              preparation.status = 'ready';
              preparation.calculationFailed = true;
              preparation.message = error.message || '경계 이동을 계산하지 못했습니다. 다시 시도하세요.';
              (0, dependencies.feedback.reportOperationError)(error, preparation.message, 'PL-BOUNDARY-MOVE', 3800);
            }
            return false;
          } finally {
            if (preparation.status === 'moving') preparation.status = 'ready';
            (0, dependencies.taskUi.updateModeButtons)();
          }
        },
        renderPacket: () => {
          const territorySelection = dependencies.projectState.state.territorySelectionSession;
          const geometryPreview = dependencies.projectState.state.geometryPreview?.session;
          const previewDelta = geometryPreview?.delta;
          const workflowVisible = territorySelection?.tool === dependencies.projectState.state.tool;
          const selectionVisible = workflowVisible && territorySelection.stage === 'selection';
          const previewVisible = !workflowVisible || territorySelection.stage !== 'setup';
          const territoryItems = selectionVisible ? (0, dependencies.territoryComponents.territoryComponentItems)() : [];
          const sessionKey = String(territorySelection?.id || 'unknown');
          const candidates = selectionVisible ? territorySelection.candidates.map((item, index) => ({
            key: `${sessionKey}:candidate:${item.id}`,
            id: item.id,
            index,
            geometry: item.geometry,
            selected: territorySelection.selectedCandidateIds.includes(item.id),
          })) : [];
          if (selectionVisible && territorySelection.currentGeometry && !candidates.some(item => item.selected)) {
            candidates.unshift({ key: `${sessionKey}:current`, index: -1, geometry: territorySelection.currentGeometry, selected: true, interactive: false });
          }
          if (selectionVisible && territorySelection.parts.length) {
            candidates.unshift(...territorySelection.parts.map(item => ({
              key: `${sessionKey}:part:${item.id}`, index: -1, geometry: item.geometry, selected: true, interactive: false,
            })));
          }
          return {
            boundaryEdit: !(previewVisible && previewDelta) && ['ready','moving'].includes(dependencies.projectState.state.boundaryPreparation?.status) ? dependencies.projectState.state.boundaryPreparation.packet : null,
            preview: previewVisible && previewDelta ? { sessionId: geometryPreview.sessionId, revision: geometryPreview.revision,
              status: geometryPreview.status, delta: {
              removedGeometry: freezeEditingGeometry(previewDelta.removedGeometry),
              addedGeometry: freezeEditingGeometry(previewDelta.addedGeometry),
              oldBoundaries: (previewDelta.oldBoundaries || []).map(freezeEditingGeometry),
              newBoundaries: (previewDelta.newBoundaries || []).map(freezeEditingGeometry),
            } } : null,
            territoryOperation: selectionVisible && (territoryItems.length || candidates.length) ? {
              kind: dependencies.projectState.state.tool,
              sourceKey: `${territorySelection.id}:${territorySelection.componentIndex?.key}:${territorySelection.settingsRevision}`,
              phase: territorySelection.activePhase || null,
              components: territoryItems.map(item => ({ ...item, hovered: item.key === territorySelection.hoveredComponentKey })),
              candidates,
            } : null,
          };
        },
        handleTerritoryInteraction: event => {
          const territorySelection = dependencies.projectState.state.territorySelectionSession;
          if (!territorySelection || territorySelection.stage !== 'selection') return false;
          if (event.type.startsWith('territory-component-') && event.territorySourceKey !== `${territorySelection.id}:${territorySelection.componentIndex?.key}:${territorySelection.settingsRevision}`) return false;
          if (event.type === 'territory-component-hover') {
            territorySelection.hoveredComponentKey = event.componentKey;
          }
          else if (event.type === 'territory-component-leave' && territorySelection.hoveredComponentKey === event.componentKey) {
            territorySelection.hoveredComponentKey = null;
          }
          else if (event.type === 'territory-component-toggle') (0, dependencies.territoryComponentUi.toggleTerritoryComponentSelection)(event.componentKey);
          else if (event.type === 'territory-candidate-select') (0, dependencies.territoryComponentUi.selectTerritoryCandidate)(event.candidateId);
          else return false;
          return true;
        },
      },
      getImportCommitter: dependencies.gisRuntime.getGisImportCommitter,
      onEditingStateChanged: snapshot => {
        window.dispatchEvent(new CustomEvent('pandolab:editing-state-changed'));
        dependencies.projectState.state.tool = snapshot.activeTool;
        dependencies.rendering.gpuMapRenderer.setCountryEditingActive(snapshot.phase !== 'idle');
        (0, dependencies.platform.$)('map')?.classList.toggle('draft-stroke-active', snapshot.draft.strokeActive);
        (0, dependencies.taskPresentation.syncCutDraftFeedback)(snapshot.draft.cutAssessment, !!snapshot.draft.hover);
        if (!snapshot.draft.cutAssessment && !snapshot.draft.hover) (0, dependencies.interactionPresentation.syncGenericDraftFeedback)(snapshot.draft);
        (0, dependencies.taskUi.updateModeButtons)();
        dependencies.lifecycleUi.projectUi.syncHistory();
      },
      transactionRunner: ({ domain, patch: geometryPatch }) => {
        if (geometryPatch?.commit && typeof geometryPatch.commit === 'function') return geometryPatch.commit();
        const error = new TypeError(`${domain} geometry patch requires an explicit transaction commit().`);
        error.code = 'PL-EDIT-TRANSACTION-001';
        throw error;
      },
    });

    const mapDisplay=createMapDisplayClient({getEntities:()=>dependencies.objectModelB.territorialScope.displayEntities(),
      getRevision:()=>dependencies.projectState.state.stateRevision});
    renderingDomain = (0, dependencies.domainFactories.createRenderingDomain)({
      prepareMapDisplay:mapDisplay.prepare,disposeMapDisplay:mapDisplay.dispose,
      context: domainContext,
      gpuMapRenderer: dependencies.rendering.gpuMapRenderer,
      sceneBuilder: dependencies.gpuRenderingA.renderSceneBuilder,
      mapHost: () => dependencies.mapView.mapHost,
      selectionDomain,
      projectDomain,
      editPreviewController: dependencies.geometryOperations.editPreviewController,
      isEditPreviewCurrent: snapshot => snapshot.projectGeneration === projectDomain.getGeneration()
        && snapshot.tool === dependencies.projectState.state.tool
        && snapshot.targetRefs.every(ref => (0, dependencies.objectLookup.objectRefExists)(ref)
          && (0, dependencies.objectOperationsA.objectRefVisible)(ref))
        && (snapshot.targetRefs[0]?.domain !== 'hydro' || dependencies.projectState.state.selected?.key === snapshot.targetRefs[0].key)
        && (snapshot.successor?.kind !== 'object' || snapshot.successor.geometry === dependencies.projectState.state.hydroEdits
          .find(feature => String(feature.id) === String(snapshot.targetRefs[0].id))?.geometry),
      createEditingPresentation,
      getEditingRenderPacket: () => editingDomain?.createRenderPacket?.(),
      emitEditingInteraction: event => editingDomain?.handleInteraction?.(event),
      reportEditingOperationError: error => dependencies.feedback.reportOperationError(error,'편집 동작을 적용하지 못했습니다.','PL-EDIT-INTERACTION-001',4200),
      domLayers: () => ({
        baseSvg: dependencies.mapLayers.baseSvg,
        svg: dependencies.mapLayers.svg,
        interactionSvg: dependencies.mapHostViewB.interactionSvg,
        gpuCanvas: (0, dependencies.platform.$)('map')?.querySelector('.gpu-map-canvas') || null,
      }),
      ...createMapRenderingResources({ports:dependencies,session:{selectionDomain,get renderingDomain(){return renderingDomain;},get objectSearchController(){return objectSearchController;}},layers:{
      get territorialLabelLayer(){return dependencies.mapHostViewA.territorialLabelLayer;},
      get labelLayer(){return dependencies.mapHostViewB.labelLayer;},
      get svg(){return dependencies.mapLayers.svg;},
      get countryLayer(){return dependencies.mapLayers.countryLayer;},
      get hydroLakeLayer(){return dependencies.mapHostViewA.hydroLakeLayer;},
      get hydroRiverLayer(){return dependencies.mapHostViewA.hydroRiverLayer;},
      get hydroEditLayer(){return dependencies.mapHostViewA.hydroEditLayer;},
      get territorialUnitLayer(){return dependencies.mapHostViewC.territorialUnitLayer;},
      get territorialOperationLayer(){return dependencies.mapHostViewC.territorialOperationLayer;},
      get genericFeatureLayer(){return dependencies.mapHostViewA.genericFeatureLayer;},
      get distributionLayer(){return dependencies.mapHostViewA.distributionLayer;},
      get territorialBoundaryLayer(){return dependencies.mapHostViewC.territorialBoundaryLayer;},
      get selectionLayer(){return dependencies.mapHostViewB.selectionLayer;},
      get hoverLayer(){return dependencies.mapHostViewA.hoverLayer;}
      },editing:{
      projectedOverlayResources:{get layers(){return [dependencies.mapHostViewC.territorialBoundaryLayer, dependencies.mapLayers.overlayStackLayer, dependencies.mapHostViewA.hydroEditLayer, dependencies.mapHostViewC.territorialOperationLayer];}},
      interactionResources:{d3: dependencies.platform.d3,
      isMobile: dependencies.surfaces.isMobile,
      selectionStyle: dependencies.applicationConstantsB.SELECTION_STYLE,
      projectedLineDistance: dependencies.objectPicking.projectedLineDistance,
      formatTerritoryArea: dependencies.territoryComponents.formatTerritoryArea,
      setModeBanner: dependencies.taskUi.setModeBanner,
      featureFromGeometry: dependencies.renderScene.featureFromGeometry,
      hasAreaGeometry: dependencies.applicationServicesA.hasAreaGeometry,
      buildRenderableStrokeFeature: dependencies.labelPresentation.buildRenderableStrokeFeature,
      issueCoordinate: dependencies.mapAudit.issueCoordinate,
      getValidationPacket: () => ({
      issues: dependencies.projectState.state.audit?.report?.issues || dependencies.projectState.state.geometryPreview?.session?.validation?.issues || [],
      selectedIssueId: dependencies.projectState.state.audit?.selectedIssueId || null,
      }),
      geometryMayIntersectViewport: dependencies.spatialRecords.geometryMayIntersectViewport,
      syncGpuInteractionLayer: dependencies.interactionPresentation.syncGpuInteractionLayer,
      applyGpuInteractionCoverage: dependencies.gpuRenderingA.applyGpuInteractionCoverage,
      scheduleSpatialIndexRebuild: () => dependencies.projectState.mapWorkScheduler.scheduleIdle('map-object-spatial-index', () => (0, dependencies.spatialRecords.rebuildMapObjectSpatialIndex)(), 40),
      getViewRevision: () => dependencies.mapLayout.viewRevision,
      getViewState: () => window.__PANDOLAB_VIEW_STATE__ || null,
      get draftLayer(){return dependencies.mapHostViewA.draftLayer;},
      get previewLayer(){return dependencies.mapHostViewB.previewLayer;},
      get validationLayer(){return dependencies.mapHostViewC.validationLayer;},
      get snapLayer(){return dependencies.mapHostViewB.snapLayer;},
      get svg(){return dependencies.mapLayers.svg;}},
      editingRenderResources:{openVertexChooser:dependencies.objectPicking.openVertexChooser,
      currentRevision:()=>editingDomain.snapshot().revision,
      inputRevision:()=>dependencies.lifecycleUi.mapInputController?.pointerRevision()??0,
      currentMapZoom: dependencies.labelPresentation.currentMapZoom,
      isMobile: dependencies.surfaces.isMobile,
      d3: dependencies.platform.d3,
      replaceGpuSceneDomain: dependencies.gpuRenderingA.replaceGpuSceneDomain,
      getEditInteractionRevision: () => dependencies.pointerInteractionA.editInteractionRevision,
      getInteractionStyle: () => dependencies.preferences.resolvedInteractionStyle,
      get vertexLayer(){return dependencies.mapHostViewC.vertexLayer;},
      get boundaryEditLayer(){return dependencies.mapHostViewA.boundaryEditLayer;}},

      labelResources:{labelDragBehavior: dependencies.genericEditingA.labelDragBehavior},
      countryResources:{renderPendingCountryOverlays:dependencies.countryLabelModel.renderPendingCountryOverlays},
      territorialBoundaryResources:{buildTerritorialInternalBoundarySegments:dependencies.territorialServicesA.buildTerritorialInternalBoundarySegments},
      territorialResources:{
      toggleTerritorialUnitMergeTarget: dependencies.territorialEditingB.toggleTerritorialUnitMergeTarget,
      get territorialOperationLayer(){return dependencies.mapHostViewC.territorialOperationLayer;}},
      genericResources:{toggleGenericFeatureMergeTarget: dependencies.genericEditingB.toggleGenericFeatureMergeTarget},
      selectionResources:{activeEditPreview: () => dependencies.geometryOperations.editPreviewController.packet(),
      updatePerformanceMetrics: partial => Object.assign(dependencies.rendering.selectionPerformanceMetrics, partial || {}),
      publishMetrics: metrics => {
      window.__PANDOLAB_SELECTION_RENDER_METRICS__ = {
      ...(window.__PANDOLAB_SELECTION_RENDER_METRICS__ || {}),
      ...metrics,
      };
      },
      reportError: ({ stage = 'selection-overlay-render', error } = {}) => {
      dependencies.readiness.reliabilityDiagnostic.push({
      category: 'render',
      operation: 'selection-overlay-render',
      result: 'recovered',
      errorCode: '',
      technicalMessage: String(error?.message || error || stage),
      stack: error?.stack || '',
      });
      console.warn(`[${stage}] 직전 정상 선택 프레임을 유지합니다.`, error);
      }}
      }}),

      requestFrame: callback => requestAnimationFrame(callback),
      prepareView:dependencies.mapHostViewC.prepareVisualFrame,
      onFrameComplete: dependencies.mapHostViewA.handleRenderFrameComplete,
      invalidMaskMode: ['localhost', '127.0.0.1', '::1'].includes(location.hostname)
      || new URLSearchParams(location.search).has('debug')
      || new URLSearchParams(location.search).has('perf')
      ? 'throw'
      : 'report',
      renderers: {
      view: visualFrame => dependencies.rendering.gpuMapRenderer.renderFrame(visualFrame),
      stackOverlays: dependencies.interactionPresentation.applyOverlayStackOrder,
      labelLayout: dependencies.countryLabelModel.visibleLabelLayout,
      debug: (...args) => dependencies.lifecycleUi.mapDebug.renderPanel(...args),
      objectSearch: (...args) => objectSearchController?.render?.(...args),
      },
      reportDiagnostic: entry => dependencies.readiness.reliabilityDiagnostic.push({ category: 'rendering-domain', ...entry }),
      });

      }

      function initializeDomainState() {
      territorialEntityStore?.dispose();
      commandOwner?.dispose();
      ({ documentModel, commandOwner } = createDocumentSession({ productMode: 'editor',
      initialProject: dependencies.projectSession.initialDocument(),
      onTransition: () => dependencies.projectSession.saveState.sync() }));
      (territorialEntityStore = (0, dependencies.territorialServicesA.createTerritorialEntityStore)({
      documentModel,commandOwner,
      onEntitiesReplaced: (entities, { rootGeometryChanged }) => {
      if (rootGeometryChanged) (0, dependencies.geometryMutation.reindexCountries)(
      { type: 'FeatureCollection', features: entities.filter(feature => (feature.properties.entityKind === 'general' && !feature.properties.parentId)) });
      dependencies.spatialQuery.mapObjectGeometryRevisions.territorial += 1;
      },
      }));

      (territorialEntityRepository = (0, dependencies.territorialServicesA.createTerritorialEntityRepository)({
      entityStore: territorialEntityStore,
      }));

      (projectDomain = null);

      (selectionDomain = null);

      (renderingDomain = null);

      (gisDomain = null);

      (editingDomain = null);

      (selectionUiController = null);

      territorialPropertyController?.dispose();
      (territorialPropertyController = null);

      (objectPropertyController = null);

      (objectSearchController = null);
      domainsReady=null;
      }

      async function setTimelineMonth(month) {
      const canPublish = () => {
      const current = dependencies.projectState.state;
      return !(current.projectReplacing || current.modeProcessing || current.geometryPreview?.session
      || current.territorySelectionSession || editingDomain?.snapshot().objectVertexEditing || editingDomain?.snapshot().selectionDraft || editingDomain?.snapshot().boundaryDraft || editingDomain?.draftInputActive?.());
      };
      if (!canPublish()) {
      throw Object.assign(new Error('편집을 확정하거나 취소한 뒤 시간대를 이동하세요.'), { code: 'TIMELINE_DRAFT_ACTIVE' });
      }
      const changed = await territorialEntityStore.setTimelineCursor(month, { canPublish });
      if (!changed) return false;
      // The map-edit Worker may be idle with an earlier month's large cached
      // topology. Drop that derived cache without re-exporting or re-sending the
      // whole current world; the next actual edit refreshes its sources.
      dependencies.spatialQuery.mapEditClient.invalidateBoundaryCache();
      dependencies.rendering.gpuMapRenderer.invalidateCountryPreview();
      renderingDomain?.invalidateProject?.('timeline-cursor');
      // A cursor change does not modify the canonical document. Persist only
      // the small view/session record, never the full geometry archive.
      projectDomain.queueViewAutosave();
      dependencies.taskPresentation.syncEditingContext();
      return true;
      }

      return Object.freeze({
      connect,
      initializeDomainState,
      setTimelineMonth,
      get timelineMonth() { return commandOwner.state()?.timelineCursor || ''; },
      get commandOwner() { return commandOwner; },
      get documentModel() { return documentModel; },
      get territorialPropertyController() { return territorialPropertyController; },
      get editingDomain() { return editingDomain; },
      get gisDomain() { return gisDomain; },
      get initializeDomainBoundaries() { return initializeDomainBoundaries; },
      get objectSearchController() { return objectSearchController; },
      set objectSearchController(value) { objectSearchController = value; },
      get objectPropertyController() { return objectPropertyController; },
      get projectDomain() { return projectDomain; },
      get renderingDomain() { return renderingDomain; },
      get selectionDomain() { return selectionDomain; },
      get selectionUiController() { return selectionUiController; },
      get territorialEntityRepository() { return territorialEntityRepository; },
      get territorialEntityStore() { return territorialEntityStore; },
      });
      }
