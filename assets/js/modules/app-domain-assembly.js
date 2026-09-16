import { rememberCutPreparation } from './cut-preparation-cache.js';
import { geometryRevision } from './geometry-versions.js';
import { freezeEditingGeometry } from './editing-render-packet.js';
import { boundaryTouchesGeometry } from './territorial-interaction-policy.js';
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
  let selectionToolbarPresentation;
  let countryPropertyController;
  let objectPropertyController;
  let layerTreeController;
  function connect(ports) {
    if (dependencies) throw new Error('domain-assembly already connected');
    dependencies = ports;
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
      getProjectSnapshot: () => projectDomain?.snapshot?.() || dependencies.mapSettingsUi.projectSerializer.buildProject(),
      getSessionSnapshot: () => (0, dependencies.platform.deepClone)({ projection: dependencies.projectState.state.projection, view: dependencies.projectState.state.view, selected: dependencies.projectState.state.selected }),
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
        const layout = (0, dependencies.mapView.projectionLayoutMetrics)();
        return { width: layout.width, height: layout.height, dpr: layout.dpr };
      },
      getFrameContext: () => window.__PANDOLAB_VIEW_STATE__ || null,
      reportDiagnostic: entry => dependencies.readiness.reliabilityDiagnostic.push({ category: 'domain', ...entry }),
    });
    projectDomain = (0, dependencies.domainFactories.createProjectDomain)({
      context: domainContext,
      getSnapshot: () => dependencies.mapSettingsUi.projectSerializer.buildProject(),
      replaceSnapshot: (project, options) => {
        const resetOptions = {
          projectGeneration: options?.generation,
          skipRenderReset: options?.skipRenderReset === true,
          prepared: options?.prepared,
          preserveBuiltinMesh: options?.preserveBuiltinMesh === true,
        };
        if (project) return (0, dependencies.projectRestore.applyAtlasState)(project, options?.reason === 'load', resetOptions);
        return (0, dependencies.projectRestore.resetProjectInPlace)(resetOptions);
      },
      serializer: dependencies.mapSettingsUi.projectSerializer,
      history: dependencies.projectSnapshots.historyService,
      persistence: dependencies.persistence.persistenceService,
      saveState: dependencies.projectSession.saveState,
      prepareEmpty: async () => {
        const countryIds = dependencies.builtinCountries.canonicalCountryStore?.ids?.() || [];
        const [countries] = await Promise.all([
          (0, dependencies.builtinCountries.materializePristineCountries)(),
          dependencies.rendering.gpuMapRenderer.ensureBuiltinMeshBaseline(countryIds),
        ]);
        return { countries, builtinMeshReady: true };
      },
      createProjectFile: async project => {
        await (0, dependencies.gisServicesA.ensureGisIoRuntime)();
        if (!window.PandoLabGIS?.exportGeoPackage) throw new Error('GeoPackage 저장 모듈을 불러오지 못했습니다.');
        return window.PandoLabGIS.exportGeoPackage(project, () => undefined);
      },
      captureReplacement: () => ({
        project: dependencies.mapSettingsUi.projectSerializer.buildProject(),
        history: [...dependencies.projectState.state.history], historyMeta: [...dependencies.projectState.state.historyMeta],
        future: [...dependencies.projectState.state.future], futureMeta: [...dependencies.projectState.state.futureMeta],
        save: dependencies.projectSession.saveState.checkpoint(),
      }),
      restoreReplacement: (checkpoint, generation) => {
        (0, dependencies.projectRestore.applyAtlasState)(checkpoint.project, false, { projectGeneration: generation, skipRenderReset: true });
        Object.assign(dependencies.projectSnapshots.historyStore, {
          history: checkpoint.history, historyMeta: checkpoint.historyMeta,
          future: checkpoint.future, futureMeta: checkpoint.futureMeta,
        });
        dependencies.projectSession.saveState.restore(checkpoint.save);
        dependencies.lifecycleUi.projectUi.syncHistory();
        renderingDomain?.invalidateProject?.('project-rollback');
      },
      invalidateProject: reason => renderingDomain?.invalidateProject?.(reason),
      invalidateHistory: reason => renderingDomain?.invalidateCountryPatch?.(reason),
      reportDiagnostic: entry => dependencies.readiness.reliabilityDiagnostic.push({ category: 'project', ...entry }),
      commandPipeline: dependencies.objectModelB.projectCommandPipeline,
      invariants: { assertProjectReferenceIntegrity: dependencies.territorialModel.assertProjectReferenceIntegrity },
      restoreCountriesFromDelta: (project, suppliedBase = null) => (0, dependencies.modelValidation.restoreCountriesFromDelta)(project, {
        base: suppliedBase || (0, dependencies.builtinCountries.materializePristineCountriesSync)(),
        clone: dependencies.platform.deepClone,
        reindex: base => (0, dependencies.geometryMutation.reindexCountries)(base, true),
        applyPristineLabelAnchors: dependencies.countryRecords.applyPristineLabelAnchors,
      }),
      onProjectChanged: event => {
        window.dispatchEvent(new CustomEvent('pandolab:project-changed', { detail: event }));
      },
      onReplacementState: (replacing, reason) => {
        dependencies.projectState.state.projectReplacing = replacing;
        if (replacing) {
          editingDomain?.cancelActiveGesture?.(`project-${reason}-preparing`);
          if (reason === 'new') (0, dependencies.feedback.setActionStatus)('새 프로젝트 준비 중…', 'working', 0);
        }
      },
      onReplacementCommitted: reason => {
        if (reason === 'new') (0, dependencies.feedback.setActionStatus)('새 프로젝트를 만들었습니다.', 'success', 3200, { forceVisible: true });
      },
      onReplacementError: (error, reason) => {
        if (reason === 'new') (0, dependencies.feedback.setActionStatus)(error?.message || '새 프로젝트를 준비하지 못했습니다. 기존 프로젝트를 유지했습니다.', 'error', 0);
      },
      onProjectReset: event => {
        selectionDomain?.resetProject(event.generation);
        editingDomain?.resetProject?.(event.generation);
        renderingDomain?.resetProjectGeneration(event.generation, { preserveBuiltinMesh: event.preserveBuiltinMesh === true });
      },
    });

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
        loadLogicalFeature: logicalId => dependencies.rendering.gpuMapRenderer.loadHydroLogicalFeature(logicalId),
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
      context: domainContext,
      projectDomain,
      selectionPacketFactory: dependencies.selectionServices.createSelectionPacket,
      normalizeRef: dependencies.selectionServices.normalizeObjectRef,
      refExists: dependencies.objectLookup.objectRefExists,
      onSelectionChanged: snapshot => {
        const selection = snapshot.selection;
        dependencies.projectState.state.selected = selection.items.find(item => item.key === selection.primaryKey) || null;
        selectionUiController?.sync?.(snapshot);
      },
      requestRender: reason => renderingDomain?.invalidateSelectionOverlay?.(reason) || false,
    });

    objectPropertyController = (0, dependencies.uiFactoriesB.createObjectPropertyController)({
      document,
      getElement: dependencies.platform.$,
      state: dependencies.projectState.state,
      territorialUnitTypes: dependencies.territorialModel.TERRITORIAL_UNIT_TYPES,
      distributionModes: dependencies.territorialModel.DISTRIBUTION_MODES,
      distributionTypeLabels: dependencies.objectModelA.DISTRIBUTION_TYPE_LABELS,
      colorDomains: dependencies.colorModel.COLOR_DOMAINS,
      defaultGenericFeatureColor: dependencies.colorModel.DEFAULT_GENERIC_FEATURE_COLOR,
      hydroToolConfig: dependencies.hydroPresentation.HYDRO_TOOL_CONFIG,
      refreshTerritorialCoastAvailability: dependencies.territorialEditingB.refreshTerritorialCoastAvailability,
      territorialUnitById: dependencies.objectPresentation.territorialUnitById,
      territorialUnitName: dependencies.objectPresentation.territorialUnitName,
      territorialUnitCountryName: dependencies.objectPresentation.territorialUnitCountryName,
      territorialUnitCountryOptions: dependencies.propertyEditingB.territorialUnitCountryOptions,
      territorialUnitParentOptions: dependencies.propertyEditingB.territorialUnitParentOptions,
      territorialParentOptions: dependencies.propertyEditingB.territorialParentOptions,
      territorialUnitColor: dependencies.colorModel.territorialUnitColor,
      territorialRepository: dependencies.presentation.territorialRepository,
      territorialChildren: dependencies.territorialServicesA.territorialChildren,
      distributionService: dependencies.objectModelA.distributionService,
      distributionEntriesForLayer: dependencies.distributionServices.distributionEntriesForLayer,
      genericFeatureById: id => dependencies.projectState.state.genericFeatures.find(feature => String(feature.id) === String(id)),
      normalizeGenericFeatureSemantics: dependencies.modelValidation.normalizeGenericFeatureSemantics,
      genericFeatureGeometryKind: dependencies.objectPresentation.genericFeatureGeometryKind,
      genericFeatureRole: dependencies.applicationServicesA.genericFeatureRole,
      genericFeatureRoleLabel: dependencies.objectPresentation.genericFeatureRoleLabel,
      genericFeatureRoleHelp: dependencies.objectModelA.genericFeatureRoleHelp,
      genericFeatureLandBinding: dependencies.objectPresentation.genericFeatureLandBinding,
      genericFeatureName: dependencies.objectPresentation.genericFeatureName,
      genericFeatureRoleLabels: dependencies.applicationConstantsA.GENERIC_FEATURE_ROLE_LABELS,
      defaultGenericFeatureColorFor: dependencies.objectModelA.defaultGenericFeatureColor,
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
      replaceSelectOptions: dependencies.propertyEditingB.replaceSelectOptions,
      shouldShowTerritorialParentChoice: dependencies.territorialServicesA.shouldShowTerritorialParentChoice,
      formatArea: dependencies.applicationServicesA.formatArea,
      geometryAreaKm2: dependencies.applicationServicesB.sphericalGeometryAreaKm2,
      layerNameCompare: (left, right) => dependencies.objectModelA.layerNameCollator.compare(left, right),
      layerTreeController: () => layerTreeController,
      syncObjectActionsMenu: dependencies.objectOperationsB.syncObjectActionsMenu,
      closeObjectActionsMenu: dependencies.objectOperationsA.closeObjectActionsMenu,
      setEditorShellView: dependencies.propertyEditingB.setEditorShellView,
      syncStatusBar: dependencies.readinessUi.syncStatusBar,
      createEmptyState: dependencies.platformConfigurationB.createEmptyState,
      createSemanticIcon: dependencies.applicationFactories.createSemanticIcon,
      territorialTypeLabel: dependencies.territorialServicesB.territorialTypeLabel,
      countryFeatureById: dependencies.countries.countryFeatureById,
      onHydroLoaded: full => {
        const key = String(full.properties?.pandolab_id || full.id);
        dependencies.projectState.state.hydroFeatureCache.set(key, full);
        for (const [fid, cached] of dependencies.projectState.state.hydroFeatureByFid) {
          if (String(cached?.properties?.pandolab_id || cached?.id) === key) dependencies.projectState.state.hydroFeatureByFid.set(fid, full);
        }
        if (dependencies.projectState.state.selected?.domain === 'hydro' && dependencies.projectState.state.selected.id === key) objectPropertyController.presentHydro(key, true);
      },
    });

    countryPropertyController = (0, dependencies.uiFactoriesA.createCountryPropertyController)({
      window,
      document,
      elements: {
        name: (0, dependencies.platform.$)('countryNameInput'),
        color: (0, dependencies.platform.$)('countryColorInput'),
        notes: (0, dependencies.platform.$)('notesInput'),
        area: (0, dependencies.platform.$)('countryAreaValue'),
        selectionStatus: (0, dependencies.platform.$)('selectionStatus'),
      },
      getCountryView: value => {
        const ref = (0, dependencies.selectionServices.normalizeObjectRef)(value);
        const id = String(ref?.id || value?.id || value || '');
        const feature = (0, dependencies.countries.countryFeatureById)(id);
        if (!feature) return null;
        const properties = feature.properties || {};
        const override = dependencies.projectState.state.countryOverrides[id] || {};
        return { ref: (0, dependencies.objectOperationsA.countryObjectRef)(id), id, feature, properties, override, displayName: (0, dependencies.presentation.countryName)(feature) };
      },
      getPrimaryRef: () => selectionDomain.primary(),
      showPropertyForm: (...args) => objectPropertyController.show(...args),
      resolveColor: view => (0, dependencies.colorModel.readDomainColor)(dependencies.colorModel.COLOR_DOMAINS.COUNTRY, {
        feature: view.feature,
        override: view.override,
      }, { fallback: (0, dependencies.colorModel.defaultCountryColor)() }),
      defaultColor: dependencies.colorModel.defaultCountryColor,
      syncColorPicker: dependencies.colorPicker.syncColorPicker,
      resolveFlagUrl: view => (0, dependencies.labelPresentation.effectiveCountryFlagUrl)({
        countryId: view.id,
        properties: view.properties,
        override: view.override,
        assetRevision: dependencies.layerPresentation.ASSET_REVISION,
      }),
      calculateAreaKm2: dependencies.applicationServicesB.sphericalGeometryAreaKm2,
      formatArea: dependencies.applicationServicesA.formatArea,
      syncActions: dependencies.taskPresentation.syncCountryActionButtons,
      syncStatus: dependencies.readinessUi.syncStatusBar,
      commitField: dependencies.objectMetadata.commitCountryEdit,
      metrics: dependencies.rendering.selectionPerformanceMetrics,
    });

    selectionToolbarPresentation = (0, dependencies.uiFactoriesB.createSelectionToolbarPresentation)({
      window,
      document,
      getElement: dependencies.platform.$,
      getSelection: () => selectionDomain.snapshot().selection,
      getView: value => {
        const ref = (0, dependencies.selectionServices.normalizeObjectRef)(value);
        if (!ref?.id || ref.domain !== 'territorial') return null;
        if (ref.type === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY) {
          const feature = (0, dependencies.countries.countryFeatureById)(ref.id);
          if (!feature) return null;
          const override = dependencies.projectState.state.countryOverrides[String(ref.id)] || {};
          return {
            ref,
            feature,
            name: (0, dependencies.presentation.countryName)(feature),
            flagUrl: (0, dependencies.labelPresentation.effectiveCountryFlagUrl)({
              countryId: ref.id,
              override,
              assetRevision: dependencies.layerPresentation.ASSET_REVISION,
            }),
            hasFlagOverride: Object.hasOwn(override, 'flagDataUrl'),
          };
        }
        const feature = (0, dependencies.objectPresentation.territorialUnitById)(ref.id);
        if (!feature || feature.properties?.unitType !== ref.type) return null;
        return {
          ref,
          feature,
          name: (0, dependencies.objectPresentation.territorialUnitName)(feature),
          flagUrl: (0, dependencies.territorialServicesA.effectiveTerritorialFlagUrl)(feature, {
            assetRevision: dependencies.layerPresentation.ASSET_REVISION,
          }),
          hasFlagOverride: Object.hasOwn(feature.properties?.metadata || {}, 'flagDataUrl'),
        };
      },
      commitFlag: (ref, value) => ref.type === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY
        ? (0, dependencies.objectMetadata.commitCountryEdit)('flagDataUrl', value)
        : (0, dependencies.objectMetadata.commitTerritorialUnitMeta)('flagDataUrl', value),
      openFlagLibrary: dependencies.flagLibrary.openFlagLibraryPicker,
      openEditor: (_ref, trigger) => (0, dependencies.workspaceUiB.openSelectionEditor)({ explicit: true, trigger, focus: true }),
      closeEditor: () => (0, dependencies.workspaceUiA.closeSurface)('editor', { manual: true }),
      isEditorOpen: () => dependencies.workspaceUiB.surfaceState.editorOpen,
      isMutationBlocked: ref => dependencies.projectState.state.projectReplacing
        || dependencies.projectState.state.modeProcessing
        || dependencies.objectOperationsA.objectRefLocked(ref)
        || dependencies.projectState.state.tool !== 'select'
        || !!dependencies.projectState.state.labelPlacementMode
        || !!dependencies.projectState.state.territorySelectionSession
        || !!dependencies.projectState.state.geometryPreview?.session
        || !!editingDomain?.draftInputActive?.(),
      getProjectGeneration: () => projectDomain?.getGeneration?.() || 0,
      closeColorPickers: dependencies.colorPicker.closeAllColorPickers,
      createSemanticIcon: dependencies.applicationFactories.createSemanticIcon,
      getLayout: () => dependencies.surfaces.layoutMode,
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
          if (ref.domain === 'territorial' && ref.type === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY) {
            return (value, options) => countryPropertyController.present(value, options);
          }
          if (ref.domain !== 'territorial' || ref.type !== dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY) {
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
        focusObject: dependencies.objectOperationsA.focusObjectRef,
        openEditor: () => {
          const startedAt = performance.now();
          (0, dependencies.workspaceUiB.openSelectionEditor)();
          dependencies.rendering.selectionPerformanceMetrics.editorOpenMs = performance.now() - startedAt;
        },
        clearPresenter: () => {
          countryPropertyController.clear();
          if ((0, dependencies.platform.$)('selectionStatus')) (0, dependencies.platform.$)('selectionStatus').textContent = '';
          objectPropertyController.show(null);
          (0, dependencies.taskPresentation.syncCountryActionButtons)();
          if (dependencies.surfaces.layoutMode === 'wide') {
            dependencies.workspaceUiB.surfaceState.editorManuallyCollapsed = false;
            if (dependencies.workspaceUiB.surfaceState.editorOpen) (0, dependencies.workspaceUiA.closeSurface)('editor');
          }
        },
        syncSelectionToolbar: () => selectionToolbarPresentation.sync(),
        clearSelectionToolbar: () => selectionToolbarPresentation.clear(),
        syncBatchActions: dependencies.objectOperationsB.syncBatchActionAvailability,
        syncMapSurfaces: dependencies.taskPresentation.syncMapContextSurfaces,
        syncLayerRows: selection => layerTreeController?.syncSelection(selection, { reveal: true }),
        closeChooser: dependencies.objectPicking.closeObjectChooser,
      },
      metrics: dependencies.rendering.selectionPerformanceMetrics,
    });
    countryPropertyController.bind();
    selectionToolbarPresentation.bind();
    selectionUiController.bind();

    editingDomain = (0, dependencies.domainFactories.createEditingDomain)({
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
        clearHover: () => { dependencies.interactionStateCommands.setHoverHit(null); selectionDomain.setHover(null); },
        resetForTool: tool => {
          dependencies.projectState.state.boundaryPreparation?.cancel();
          dependencies.projectState.state.boundaryPreparation = null;
          dependencies.projectState.state.labelPlacementMode = false;
          if (tool !== 'country-coast') {
            dependencies.projectState.state.coastEditCountryId = null;
            dependencies.projectState.state.coastEditScopeGenericFeatureId = null;
            dependencies.projectState.state.coastEditReturnSelection = null;
          }
          if (tool !== 'country-border') (0, dependencies.countryEditingB.resetBoundaryEditState)();
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
            (0, dependencies.territorySelectionA.clearTerritorySelection)({ discardPreview: true, refreshUi: false });
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
          if (cutRequest?.pending) dependencies.spatialQuery.mapEditClient.stop();
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
          const entry = { key, sourceKey, promise: null, pending: true };
          cutRequest = entry;
          entry.promise = dependencies.spatialQuery.mapEditClient.execute('territorial-cut', { payload: {
            sourceKey, source: confirmedCutSource?.key === sourceKey && confirmedCutSource.workerRevision === workerStats.dataRevision && workerStats.ready ? undefined : source,
            coords, view, buildPreview,
          } }, { jobKey: 'territorial-cut' }).then(response => {
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
        resolveObjectFeature: targetRef => {
          if (targetRef?.domain === 'hydro') return dependencies.projectState.state.hydroEdits.find(item => String(item.id) === String(targetRef.id)) || null;
          return null;
        },
        canEditObject: feature => {
          if (feature?.properties?.locked === true) {
            (0, dependencies.feedback.setActionStatus)('잠금을 해제한 뒤 꼭짓점을 이동하세요.', 'error', 3200);
            return false;
          }
          const hydroEdit = (0, dependencies.hydroModel.isHydroEditFeature)(feature);
          if (!hydroEdit) return false;
          projectDomain.recordHistory();
          return true;
        },
        getObjectVertexTarget: () => {
          if (dependencies.projectState.state.tool !== 'select') return null;
          const selected = dependencies.projectState.state.selected;
          if (selected?.domain === 'hydro') {
            const feature = dependencies.projectState.state.hydroEdits.find(item => String(item.id) === String(selected.id));
            return feature ? { targetRef: { domain: 'hydro', type: 'hydro', id: String(feature.id) }, mode: 'hydro', feature } : null;
          }
          return null;
        },
        previewObjectGesture: ({ source, feature, segments }) => {
          (0, dependencies.gpuRenderingA.beginActiveEditPreview)({
            key: `${(0, dependencies.hydroModel.isHydroEditFeature)(source) ? 'hydro' : 'generic'}:${source.id}`,
            segments,
          });
          return feature;
        },
        commitObjectGesture: ({ source, feature, beforeGeometry, changed }) => {
          const hydroEdit = (0, dependencies.hydroModel.isHydroEditFeature)(source);
          (0, dependencies.gpuRenderingA.clearActiveEditPreview)('vertex-edit-preview-end');
          if (!changed) {
            projectDomain.discardHistory();
            renderingDomain?.invalidateEditedGeometryPatch?.(hydroEdit ? 'hydro' : 'generic', 'vertex-preview-no-change');
            return false;
          }
          const issues = ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type) ? (0, dependencies.geometryModel.validateStructuredGeometry)(feature) : [];
          if (issues.length) {
            projectDomain.discardHistory();
            (0, dependencies.feedback.setActionStatus)(issues[0].message || '유효하지 않은 geometry라 꼭짓점 이동을 되돌렸습니다.', 'error', 3800);
            return false;
          }
          source.geometry = (0, dependencies.platform.deepClone)(feature.geometry);
          dependencies.presentation.genericFeatureLandClipCache.delete(source);
          if (hydroEdit) dependencies.spatialQuery.mapObjectGeometryRevisions.hydro += 1;
          else dependencies.spatialQuery.mapObjectGeometryRevisions.generic += 1;
          renderingDomain?.invalidateEditedGeometryPatch?.(hydroEdit ? 'hydro' : 'generic', 'vertex-edit-commit');
          projectDomain.queueAutosave();
          (0, dependencies.feedback.setActionStatus)('꼭짓점을 이동했습니다.', 'success');
          void beforeGeometry;
          return true;
        },
        beginBoundaryGesture: event => {
          if (!['country-border', 'country-coast'].includes(dependencies.projectState.state.tool)) return false;
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
          const borderMode = dependencies.projectState.state.tool === 'country-border';
          const coastId = String(dependencies.projectState.state.coastEditCountryId || event.targetRef?.id || '');
          const affectedIds = borderMode ? new Set([...node.ownerIds].map(String)) : new Set([coastId]);
          const boundaryFeature = id => (0, dependencies.countries.countryFeatureById)(id) || dependencies.projectState.state.territorialUnits.find(unit => String(unit.id) === String(id));
          if (!(0, dependencies.objectOperationsB.requireCountriesUnlocked)([...affectedIds], borderMode ? '국경을 조정' : '해안선을 조정')) return false;
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
          if (!(0, dependencies.objectOperationsB.requireCountriesUnlocked)([...hierarchyIds], '경계를 조정')) return false;
          const lockedHierarchy = dependencies.projectState.state.territorialUnits.some(unit => unit.properties?.locked && (
            hierarchyIds.has(String(unit.id)) || (hierarchyIds.has(String(unit.properties.sovereignId)) && boundaryTouchesGeometry(unit.geometry, node.coordinate))
          ));
          if (lockedHierarchy) {
            (0, dependencies.feedback.setActionStatus)('변경 구간의 상위 단위 또는 자식이 잠겨 있습니다.', 'error', 3400);
            return false;
          }
          (0, dependencies.gpuRenderingA.beginActiveEditPreview)({
            key: `${borderMode ? 'border' : 'coast'}:${[...affectedIds].sort().join('|')}:${node.key}`,
            segments: node.segments,
          });
          return {
            borderMode,
            affectedIds,
            preparation,
            node,
            startCoordinate: node.coordinate,
            coordinate: node.coordinate,
            changed: false,
          };
        },
        moveBoundaryGesture: (session, coordinate) => {
          session.changed = session.changed || !(0, dependencies.geometryPreview.coordNear)(session.startCoordinate, coordinate, 1e-9);
          session.coordinate = coordinate.slice();
          const same = value => dependencies.geometryPreview.coordNear(value, session.startCoordinate, 1e-9);
          const segments = session.node.segments.map(segment => ({
            start: same(segment.start) ? coordinate : segment.start,
            end: same(segment.end) ? coordinate : segment.end,
          }));
          (0, dependencies.gpuRenderingB.updateActiveEditPreview)(segments);
        },
        commitBoundaryGesture: async session => {
          (0, dependencies.gpuRenderingA.clearActiveEditPreview)('country-boundary-preview-end');
          if (!session.changed) return false;
          const preparation = session.preparation;
          if (!preparation.current() || preparation.status !== 'ready') return false;
          preparation.status = 'moving';
          (0, dependencies.taskUi.updateModeButtons)();
          try {
            const response = await dependencies.spatialQuery.mapEditClient.execute('boundary-move', { payload: {
              preparationId: preparation.result.preparationId, nodeKey: session.node.nodeKey, coordinate: session.coordinate,
            } }, { jobKey: 'boundary-move' });
            if (!preparation.current()) return false;
            session.features = new Map(response.result.features.map(feature => [String(feature.id), feature]));
          } catch (error) {
            if (preparation.current()) {
              preparation.status = 'error';
              preparation.message = error.message || '경계 이동을 계산하지 못했습니다. 다시 시도하세요.';
            }
            return false;
          } finally {
            if (preparation.status === 'moving') preparation.status = 'ready';
            (0, dependencies.taskUi.updateModeButtons)();
          }
          const unitTarget = dependencies.projectState.state.territorialUnits.find(unit => String(unit.id) === String(dependencies.projectState.state.boundaryEditSeedCountryId));
          if (session.borderMode && unitTarget) {
            return (0, dependencies.territorialEditingB.previewTerritorialEdit)({ operation: 'boundary', targetId: unitTarget.id,
              parentId: unitTarget.properties.parentId, featurePatches: [...session.features.values()],
            }, { selectedId: unitTarget.id, shouldKeepResult: () => preparation.current() && dependencies.projectState.state.tool === 'country-border'
              && String(dependencies.projectState.state.boundaryEditSeedCountryId) === String(unitTarget.id) });
          }
          if (!session.borderMode) {
            const countryId = [...session.affectedIds][0];
            return (0, dependencies.territorialEditingB.previewTerritorialEdit)({
              operation: 'coast', targetId: countryId, draft: session.features.get(countryId)?.geometry,
            }, { selectedId: dependencies.projectState.state.coastEditReturnSelection?.id || countryId,
              shouldKeepResult: () => preparation.current() && dependencies.projectState.state.tool === 'country-coast' && String(dependencies.projectState.state.coastEditCountryId) === String(countryId) });
          }
          const ids = [...session.affectedIds];
          return (0, dependencies.territorialEditingB.previewTerritorialEdit)({ operation: 'country-boundary', targetId: ids[0],
            featurePatches: [...session.features.values()],
          }, { selectedId: ids[0], shouldKeepResult: () => preparation.current() && dependencies.projectState.state.tool === 'country-border' });
        },
        renderPacket: () => {
          const territoryItems = (0, dependencies.territoryComponents.territoryComponentItems)();
          const territorySelection = dependencies.projectState.state.territorySelectionSession;
          const selectionVisible = territorySelection?.tool === dependencies.projectState.state.tool && territorySelection.stage === 'selection';
          const candidates = selectionVisible ? territorySelection.candidates.map((item, index) => ({
            index,
            geometry: item.geometry,
            selected: index === territorySelection.selectedCandidateIndex,
          })) : [];
          if (selectionVisible && territorySelection.currentGeometry && !candidates.some(item => item.selected)) {
            candidates.unshift({ index: -1, geometry: territorySelection.currentGeometry, selected: true, interactive: false });
          }
          if (selectionVisible && territorySelection.parts.length) {
            candidates.unshift(...territorySelection.parts.map(item => ({
              index: -1, geometry: item.geometry, selected: true, interactive: false,
            })));
          }
          return {
            boundaryEdit: dependencies.projectState.state.boundaryPreparation?.status === 'ready' ? dependencies.projectState.state.boundaryPreparation.packet : null,
            territoryOperation: territoryItems.length || candidates.length ? {
              kind: dependencies.projectState.state.tool,
              sourceKey: `${territorySelection?.id}:${territorySelection?.componentIndex?.key}:${territorySelection?.settingsRevision}`,
              phase: territorySelection?.activePhase || null,
              components: territoryItems.map(item => ({ ...item, hovered: item.key === territorySelection?.hoveredComponentKey })),
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
          else if (event.type === 'territory-candidate-select') (0, dependencies.territoryComponentUi.selectTerritoryCandidate)(event.candidateIndex);
          else return false;
          return true;
        },
      },
      getImportCommitter: dependencies.gisRuntime.getGisImportCommitter,
      onEditingStateChanged: snapshot => {
        dependencies.projectState.state.tool = snapshot.activeTool;
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

    renderingDomain = (0, dependencies.domainFactories.createRenderingDomain)({
      prepareEditDisplay: (payload, options) => dependencies.spatialQuery.mapEditClient.execute('territorial-display', { payload }, options),
      onEditDisplayReady: result => {
        if (result?.kind === 'highlight') {
          renderingDomain?.invalidateSelectionOverlay?.('highlight-ready');
          return;
        }
        renderingDomain?.invalidateTerritorialPatch?.('edit-display-ready');
        renderingDomain?.invalidateGpuInteraction?.('edit-display-ready');
      },
      context: domainContext,
      gpuMapRenderer: dependencies.rendering.gpuMapRenderer,
      sceneBuilder: dependencies.gpuRenderingA.renderSceneBuilder,
      mapHost: () => dependencies.mapView.mapHost,
      selectionDomain,
      projectDomain,
      getEditingRenderPacket: () => editingDomain?.createRenderPacket?.(),
      emitEditingInteraction: event => editingDomain?.handleInteraction?.(event),
      domLayers: () => ({
        baseSvg: dependencies.mapLayers.baseSvg,
        svg: dependencies.mapLayers.svg,
        interactionSvg: dependencies.mapHostViewB.interactionSvg,
        gpuCanvas: (0, dependencies.platform.$)('map')?.querySelector('.gpu-map-canvas') || null,
      }),
      labelResources: createResourceSnapshot('labels', {
        d3: dependencies.platform.d3,
        countryLabelLayer: dependencies.mapHostViewA.countryLabelLayer,
        labelLayer: dependencies.mapHostViewB.labelLayer,
        svg: dependencies.mapLayers.svg,
        getState: () => dependencies.projectState.state,
        visibleLabelLayout: dependencies.countryLabelModel.visibleLabelLayout,
        mapClickBlocked: dependencies.pointerInteractionA.mapClickBlocked,
        handleObjectSelectionAt: dependencies.objectPicking.handleObjectSelectionAt,
        handleMapClick: dependencies.objectPicking.handleMapClick,
        countryName: dependencies.presentation.countryName,
        layerStyle: dependencies.applicationServicesB.layerStyle,
        isMobile: dependencies.surfaces.isMobile,
        automaticLabelSettings: dependencies.labelPresentation.automaticLabelSettings,
        labelSettings: (currentState, domain, id) => currentState.labelSettings?.[(0, dependencies.labelPresentation.labelKey)(domain, id)] || {},
        labelKey: dependencies.labelPresentation.labelKey,
        countryLabelAnchors: () => dependencies.labelPresentation.countryLabelAnchors,
        activeProjection: dependencies.mapView.activeProjection,
        projectVisibleCoordinate: dependencies.mapLayout.projectVisibleCoordinate,
        isCoordVisible: dependencies.mapView.isCoordVisible,
        labelDragBehavior: dependencies.genericEditingA.labelDragBehavior,
        normalizeObjectRef: dependencies.selectionServices.normalizeObjectRef,
        selectionSnapshot: () => selectionDomain.snapshot().selection,
        selectionHas: ref => selectionDomain.has(ref),
      }, {
        countryLabelLayer: () => dependencies.mapHostViewA.countryLabelLayer,
        labelLayer: () => dependencies.mapHostViewB.labelLayer,
        svg: () => dependencies.mapLayers.svg,
      }),
      countryResources: createResourceSnapshot('countries', {
        getState: () => dependencies.projectState.state,
        getViewRevision: () => dependencies.mapLayout.viewRevision,
        countryLayer: dependencies.mapLayers.countryLayer,
        path: dependencies.mapView.path,
        countryOutlineFeature: dependencies.countryLabelModel.countryOutlineFeature,
        countryFeatureById: dependencies.countries.countryFeatureById,
        isLayerItemVisible: dependencies.layerPresentation.isLayerItemVisible,
        renderPendingCountryOverlays: dependencies.countryLabelModel.renderPendingCountryOverlays,
        selectionGeometryRevision: dependencies.renderScene.selectionGeometryRevision,
        countryColor: dependencies.colorModel.countryColor,
        mapTheme: dependencies.preferences.mapTheme,
        resolvedInteractionStyle: () => dependencies.preferences.resolvedInteractionStyle,
        replaceGpuSceneDomain: dependencies.gpuRenderingA.replaceGpuSceneDomain,
        syncGpuRenderScene: dependencies.gpuRenderingB.syncGpuRenderScene,
        gpuMapRenderer: dependencies.rendering.gpuMapRenderer,
        applyGpuSceneCoverage: dependencies.gpuRenderingA.applyGpuSceneCoverage,
        applyGpuInteractionCoverage: dependencies.gpuRenderingA.applyGpuInteractionCoverage,
      }, {
        countryLayer: () => dependencies.mapLayers.countryLayer,
      }),
      hydroResources: createResourceSnapshot('hydro', {
        getState: () => dependencies.projectState.state,
        getStateRevision: () => dependencies.projectState.state.stateRevision,
        hydroLakeLayer: dependencies.mapHostViewA.hydroLakeLayer,
        hydroRiverLayer: dependencies.mapHostViewA.hydroRiverLayer,
        hydroEditLayer: dependencies.mapHostViewA.hydroEditLayer,
        gpuMapRenderer: dependencies.rendering.gpuMapRenderer,
        layerStyle: dependencies.applicationServicesB.layerStyle,
        hydroRenderGroups: dependencies.physicalResources.hydroRenderGroups,
        hydroDisplayColor: dependencies.hydroPresentation.hydroDisplayColor,
        hydroEditColor: dependencies.physicalResources.hydroEditColor,
        path: dependencies.mapView.path,
        visibleMapObjectCandidates: dependencies.spatialQuery.visibleMapObjectCandidates,
        geometryMayIntersectViewport: dependencies.spatialRecords.geometryMayIntersectViewport,
        isHydroFeatureVisible: dependencies.physicalServices.isHydroFeatureVisible,
        normalizeObjectRef: dependencies.selectionServices.normalizeObjectRef,
        selectionHas: ref => selectionDomain.has(ref),
        viewportCullingMetrics: dependencies.spatialQuery.viewportCullingMetrics,
        setMapHover: dependencies.gpuRenderingA.setMapHover,
        mapClickBlocked: dependencies.pointerInteractionA.mapClickBlocked,
        d3: dependencies.platform.d3,
        svg: dependencies.mapLayers.svg?.node?.() || dependencies.mapLayers.svg,
        handleObjectSelectionAt: dependencies.objectPicking.handleObjectSelectionAt,
        buildRenderableStrokeFeature: dependencies.labelPresentation.buildRenderableStrokeFeature,
      }, {
        hydroLakeLayer: () => dependencies.mapHostViewA.hydroLakeLayer,
        hydroRiverLayer: () => dependencies.mapHostViewA.hydroRiverLayer,
        hydroEditLayer: () => dependencies.mapHostViewA.hydroEditLayer,
        svg: () => dependencies.mapLayers.svg?.node?.() || dependencies.mapLayers.svg,
      }),
      territorialResources: createResourceSnapshot('territorial', {
        isNativeBuiltinSubunit: dependencies.builtinCountries.isNativeBuiltinSubunit,
        syncBuiltinPalette: dependencies.builtinCountries.syncBuiltinPalette,
        getState: () => dependencies.projectState.state,
        territorialUnitLayer: dependencies.mapHostViewC.territorialUnitLayer,
        territorialOperationLayer: dependencies.mapHostViewC.territorialOperationLayer,
        TERRITORIAL_UNIT_TYPES: dependencies.territorialModel.TERRITORIAL_UNIT_TYPES,
        visibleMapObjectCandidates: dependencies.spatialQuery.visibleMapObjectCandidates,
        geometryMayIntersectViewport: dependencies.spatialRecords.geometryMayIntersectViewport,
        isLayerItemVisible: dependencies.layerPresentation.isLayerItemVisible,
        selectionHas: ref => selectionDomain.has(ref),
        normalizeObjectRef: dependencies.selectionServices.normalizeObjectRef,
        viewportCullingMetrics: dependencies.spatialQuery.viewportCullingMetrics,
        setMapHover: dependencies.gpuRenderingA.setMapHover,
        mapClickBlocked: dependencies.pointerInteractionA.mapClickBlocked,
        toggleTerritorialUnitMergeTarget: dependencies.territorialEditingB.toggleTerritorialUnitMergeTarget,
        d3: dependencies.platform.d3,
        svg: dependencies.mapLayers.svg?.node?.() || dependencies.mapLayers.svg,
        handleObjectSelectionAt: dependencies.objectPicking.handleObjectSelectionAt,
        path: dependencies.mapView.path,
        territorialStyleColor: dependencies.objectModelB.territorialStyleColor,
        territorialUnitColor: dependencies.colorModel.territorialUnitColor,
        presentationGroupForTerritorialFeature: dependencies.interactionPresentation.presentationGroupForTerritorialFeature,
        layerStyle: dependencies.applicationServicesB.layerStyle,
        selectionGeometryRevision: dependencies.renderScene.selectionGeometryRevision,
        gpuSceneOrder: dependencies.gpuRenderingA.gpuSceneOrder,
        resolvedInteractionStyle: () => dependencies.preferences.resolvedInteractionStyle,
        replaceGpuSceneDomain: dependencies.gpuRenderingA.replaceGpuSceneDomain,
        buildRenderableStrokeFeature: dependencies.labelPresentation.buildRenderableStrokeFeature,
      }, {
        territorialUnitLayer: () => dependencies.mapHostViewC.territorialUnitLayer,
        territorialOperationLayer: () => dependencies.mapHostViewC.territorialOperationLayer,
        svg: () => dependencies.mapLayers.svg?.node?.() || dependencies.mapLayers.svg,
      }),
      genericResources: createResourceSnapshot('generic', {
        getState: () => dependencies.projectState.state,
        genericFeatureLayer: dependencies.mapHostViewA.genericFeatureLayer,
        path: dependencies.mapView.path,
        genericFeatureDisplayFeature: dependencies.presentation.genericFeatureDisplayFeature,
        genericFeatureColor: dependencies.colorModel.genericFeatureColor,
        visibleMapObjectCandidates: dependencies.spatialQuery.visibleMapObjectCandidates,
        isLayerItemVisible: dependencies.layerPresentation.isLayerItemVisible,
        geometryMayIntersectViewport: dependencies.spatialRecords.geometryMayIntersectViewport,
        normalizeObjectRef: dependencies.selectionServices.normalizeObjectRef,
        selectionHas: ref => selectionDomain.has(ref),
        selectionSnapshot: () => selectionDomain.snapshot().selection,
        viewportCullingMetrics: dependencies.spatialQuery.viewportCullingMetrics,
        mapClickBlocked: dependencies.pointerInteractionA.mapClickBlocked,
        d3: dependencies.platform.d3,
        svg: dependencies.mapLayers.svg?.node?.() || dependencies.mapLayers.svg,
        handleObjectSelectionAt: dependencies.objectPicking.handleObjectSelectionAt,
        setMapHover: dependencies.gpuRenderingA.setMapHover,
        toggleGenericFeatureMergeTarget: dependencies.genericEditingB.toggleGenericFeatureMergeTarget,
        layerStyle: dependencies.applicationServicesB.layerStyle,
        selectionGeometryRevision: dependencies.renderScene.selectionGeometryRevision,
        gpuSceneOrder: dependencies.gpuRenderingA.gpuSceneOrder,
        resolvedInteractionStyle: () => dependencies.preferences.resolvedInteractionStyle,
        replaceGpuSceneDomain: dependencies.gpuRenderingA.replaceGpuSceneDomain,
        buildRenderableStrokeFeature: dependencies.labelPresentation.buildRenderableStrokeFeature,
      }, {
        genericFeatureLayer: () => dependencies.mapHostViewA.genericFeatureLayer,
        svg: () => dependencies.mapLayers.svg?.node?.() || dependencies.mapLayers.svg,
      }),
      distributionResources: createResourceSnapshot('distribution', {
        getState: () => dependencies.projectState.state,
        distributionLayer: dependencies.mapHostViewA.distributionLayer,
        distributionEntriesForLayer: dependencies.distributionServices.distributionEntriesForLayer,
        dominantDistributionEntries: dependencies.distributionServices.dominantDistributionEntries,
        territorialRepository: dependencies.presentation.territorialRepository,
        featureFromGeometry: dependencies.renderScene.featureFromGeometry,
        geometryBounds: dependencies.spatialQuery.geometryBounds,
        distributionColor: dependencies.distributionPresentation.distributionColor,
        DISTRIBUTION_TYPES: dependencies.objectCatalog.DISTRIBUTION_TYPES,
        DISTRIBUTION_MODES: dependencies.territorialModel.DISTRIBUTION_MODES,
        DISTRIBUTION_RENDER_MODES: dependencies.applicationConstantsA.DISTRIBUTION_RENDER_MODES,
        DISTRIBUTION_TYPE_GROUPS: dependencies.distributionPresentation.DISTRIBUTION_TYPE_GROUPS,
        visibleMapObjectCandidates: dependencies.spatialQuery.visibleMapObjectCandidates,
        geometryMayIntersectViewport: dependencies.spatialRecords.geometryMayIntersectViewport,
        isLayerItemVisible: dependencies.layerPresentation.isLayerItemVisible,
        normalizeObjectRef: dependencies.selectionServices.normalizeObjectRef,
        selectionHas: ref => selectionDomain.has(ref),
        viewportCullingMetrics: dependencies.spatialQuery.viewportCullingMetrics,
        mapClickBlocked: dependencies.pointerInteractionA.mapClickBlocked,
        d3: dependencies.platform.d3,
        svg: dependencies.mapLayers.svg?.node?.() || dependencies.mapLayers.svg,
        handleObjectSelectionAt: dependencies.objectPicking.handleObjectSelectionAt,
        setMapHover: dependencies.gpuRenderingA.setMapHover,
        layerStyle: dependencies.applicationServicesB.layerStyle,
        selectionGeometryRevision: dependencies.renderScene.selectionGeometryRevision,
        gpuSceneOrder: dependencies.gpuRenderingA.gpuSceneOrder,
        replaceGpuSceneDomain: dependencies.gpuRenderingA.replaceGpuSceneDomain,
        buildRenderableStrokeFeature: dependencies.labelPresentation.buildRenderableStrokeFeature,
        getCountryGeometryRevision: () => dependencies.countries.countryLandRevision,
        getDistributionVisibilityRevision: () => dependencies.objectModelA.distributionVisibilityRevision,
      }, {
        distributionLayer: () => dependencies.mapHostViewA.distributionLayer,
        svg: () => dependencies.mapLayers.svg?.node?.() || dependencies.mapLayers.svg,
      }),
      territorialBoundaryResources: createResourceSnapshot('territorialBoundary', {
        getState: () => dependencies.projectState.state,
        getCountryLandRevision: () => dependencies.countries.countryLandRevision,
        getTerritorialGeometryRevision: () => dependencies.spatialQuery.mapObjectGeometryRevisions.territorial,
        geometryToken: geometry => (0, dependencies.interactionPresentation.territorialBoundaryGeometryToken)(geometry),
        buildTerritorialInternalBoundarySegments: dependencies.territorialServicesA.buildTerritorialInternalBoundarySegments,
        territorialUnitColor: dependencies.colorModel.territorialUnitColor,
        layerStyle: dependencies.applicationServicesB.layerStyle,
        presentationGroupForTerritorialFeature: dependencies.interactionPresentation.presentationGroupForTerritorialFeature,
        mapTheme: dependencies.preferences.mapTheme,
        territorialBoundaryLayer: dependencies.mapHostViewC.territorialBoundaryLayer,
        path: dependencies.mapView.path,
        replaceGpuSceneDomain: dependencies.gpuRenderingA.replaceGpuSceneDomain,
        gpuSceneOrder: dependencies.gpuRenderingA.gpuSceneOrder,
      }, {
        territorialBoundaryLayer: () => dependencies.mapHostViewC.territorialBoundaryLayer,
      }),
      baseResources: createResourceSnapshot('base', {
        getState: () => dependencies.projectState.state,
        updatePandoGlobeShell: dependencies.projectionView.updatePandoGlobeShell,
        graticule: dependencies.projectionView.graticule,
        graticuleLayer: dependencies.mapHostViewA.graticuleLayer,
        path: dependencies.mapView.path,
        gpuMapRenderer: dependencies.rendering.gpuMapRenderer,
        replaceGpuSceneDomain: dependencies.gpuRenderingA.replaceGpuSceneDomain,
        buildGraticuleStrokeGeometryPacket: dependencies.applicationServicesA.buildGraticuleStrokeGeometryPacket,
        getProjection: () => dependencies.projectState.state.projection,
        isLightTheme: () => (document.documentElement.dataset.theme || window.__PANDOLAB_THEME__ || dependencies.preferences.systemTheme) === 'light',
      }, {
        graticuleLayer: () => dependencies.mapHostViewA.graticuleLayer,
      }),
      projectedOverlayResources: createResourceSnapshot('projectedOverlays', {
        layers: null,
        path: dependencies.mapView.path,
      }, {
        layers: () => [dependencies.mapHostViewC.territorialBoundaryLayer, dependencies.mapLayers.overlayStackLayer, dependencies.mapHostViewA.hydroEditLayer, dependencies.mapHostViewC.territorialOperationLayer],
      }),
      selectionResources: createResourceSnapshot('selection', {
        getState: () => dependencies.projectState.state,
        countryType: dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY,
        selectionLayer: dependencies.mapHostViewB.selectionLayer,
        hoverLayer: dependencies.mapHostViewA.hoverLayer,
        d3: dependencies.platform.d3,
        path: dependencies.mapView.path,
        document,
        selectionPass: dependencies.gpuRenderingA.selectionPass,
        resolvedInteractionStyle: () => dependencies.preferences.resolvedInteractionStyle,
        countryDisplayFeature: dependencies.countryLabelModel.countryDisplayFeature,
        countryOutlineFeature: dependencies.countryLabelModel.countryOutlineFeature,
        countrySubunitExtent: id => dependencies.objectModelB.territorialScope.scope(id).extra,
        mapFeatureForObjectRef: dependencies.gpuRenderingA.mapFeatureForObjectRef,
        objectRefVisible: dependencies.objectOperationsA.objectRefVisible,
        selectionGeometryRevision: dependencies.renderScene.selectionGeometryRevision,
        buildRenderableStrokeFeature: dependencies.labelPresentation.buildRenderableStrokeFeature,
        buildSelectionBoundarySegments: dependencies.selectionServices.buildSelectionBoundarySegments,
        getCountryLandRevision: () => dependencies.countries.countryLandRevision,
        getStateRevision: () => dependencies.projectState.state.stateRevision,
        getTerritorialBoundaryRevision: () => renderingDomain?.getTerritorialBoundaryStats?.().revision || '',
        getViewRevision: () => dependencies.mapLayout.viewRevision,
        getProjection: () => dependencies.projectState.state.projection,
        isMobile: dependencies.surfaces.isMobile,
        gpuMapRenderer: dependencies.rendering.gpuMapRenderer,
        activeEditPreview: () => dependencies.geometryOperations.editPreviewController.packet(),
        buildGpuInteractionFillItems: dependencies.gpuRenderingA.buildGpuInteractionFillItems,
        syncGpuInteractionState: dependencies.renderScene.syncGpuInteractionState,
        setCurrentSelectionPacket: packet => { dependencies.interactionStateCommands.setSelectionPacket(packet || null); },
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
        },
      }, {
        selectionLayer: () => dependencies.mapHostViewB.selectionLayer,
        hoverLayer: () => dependencies.mapHostViewA.hoverLayer,
        selectionPass: () => dependencies.gpuRenderingA.selectionPass,
      }),
      interactionResources: createResourceSnapshot('interaction', {
        draftLayer: dependencies.mapHostViewA.draftLayer,
        d3: dependencies.platform.d3,
        svg: dependencies.mapLayers.svg,
        isMobile: dependencies.surfaces.isMobile,
        selectionStyle: dependencies.applicationConstantsB.SELECTION_STYLE,
        projectedLineDistance: dependencies.objectPicking.projectedLineDistance,
        formatTerritoryArea: dependencies.territoryComponents.formatTerritoryArea,
        setModeBanner: dependencies.taskUi.setModeBanner,
        previewLayer: dependencies.mapHostViewB.previewLayer,
        validationLayer: dependencies.mapHostViewC.validationLayer,
        snapLayer: dependencies.mapHostViewB.snapLayer,
        path: dependencies.mapView.path,
        featureFromGeometry: dependencies.renderScene.featureFromGeometry,
        hasAreaGeometry: dependencies.applicationServicesA.hasAreaGeometry,
        buildRenderableStrokeFeature: dependencies.labelPresentation.buildRenderableStrokeFeature,
        issueCoordinate: dependencies.mapAudit.issueCoordinate,
        getValidationPacket: () => ({
          issues: dependencies.projectState.state.audit?.report?.issues || dependencies.projectState.state.geometryPreview?.session?.validation?.issues || [],
          selectedIssueId: dependencies.projectState.state.audit?.selectedIssueId || null,
        }),
        geometryMayIntersectViewport: dependencies.spatialRecords.geometryMayIntersectViewport,
        isCoordVisible: dependencies.mapView.isCoordVisible,
        activeProjection: dependencies.mapView.activeProjection,
        syncGpuInteractionLayer: dependencies.interactionPresentation.syncGpuInteractionLayer,
        applyGpuInteractionCoverage: dependencies.gpuRenderingA.applyGpuInteractionCoverage,
        scheduleSpatialIndexRebuild: () => dependencies.projectState.mapWorkScheduler.scheduleIdle('map-object-spatial-index', () => (0, dependencies.spatialRecords.rebuildMapObjectSpatialIndex)(), 40),
        getViewRevision: () => dependencies.mapLayout.viewRevision,
        getViewState: () => window.__PANDOLAB_VIEW_STATE__ || null,
      }, {
        draftLayer: () => dependencies.mapHostViewA.draftLayer,
        previewLayer: () => dependencies.mapHostViewB.previewLayer,
        validationLayer: () => dependencies.mapHostViewC.validationLayer,
        snapLayer: () => dependencies.mapHostViewB.snapLayer,
        svg: () => dependencies.mapLayers.svg,
      }),
      editingRenderResources: createResourceSnapshot('editing', {
        isCoordVisible: dependencies.mapView.isCoordVisible,
        activeProjection: dependencies.mapView.activeProjection,
        currentMapZoom: dependencies.labelPresentation.currentMapZoom,
        isMobile: dependencies.surfaces.isMobile,
        path: dependencies.mapView.path,
        d3: dependencies.platform.d3,
        vertexLayer: dependencies.mapHostViewC.vertexLayer,
        boundaryEditLayer: dependencies.mapHostViewA.boundaryEditLayer,
        replaceGpuSceneDomain: dependencies.gpuRenderingA.replaceGpuSceneDomain,
        getEditInteractionRevision: () => dependencies.pointerInteractionA.editInteractionRevision,
        getInteractionStyle: () => dependencies.preferences.resolvedInteractionStyle,
      }, {
        vertexLayer: () => dependencies.mapHostViewC.vertexLayer,
        boundaryEditLayer: () => dependencies.mapHostViewA.boundaryEditLayer,
      }),
      refreshRenderResources,
      requestFrame: callback => requestAnimationFrame(callback),
      prepareView: ({ frameId } = {}) => {
        (0, dependencies.mapView.updateProjection)();
        const viewState = (0, dependencies.mapHostViewC.syncViewRevision)();
        if (dependencies.mapHostViewB.lastVisualProjectionKind !== viewState.projection) {
          dependencies.mapHostCommands.advanceVisualProjection(viewState.projection);
        }
        const visualProjection = (0, dependencies.mapHostViewC.visualProjectionForSnapshot)(viewState);
        const visualPath = dependencies.platform.d3.geo.path().projection(visualProjection);
        return (0, dependencies.renderFactories.createMapVisualFrame)({
          frameId,
          viewRevision: viewState.revision,
          projectGeneration: projectDomain?.getGeneration?.() || 0,
          projectionRevision: dependencies.mapHostViewC.visualProjectionRevision,
          viewState,
          layoutSnapshot: dependencies.mapLayout.mapLayoutMetricsSnapshot,
          projectCoordinate: coordinate => visualProjection(coordinate),
          projectPath: geometry => visualPath(geometry),
        });
      },
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
        layerTree: (...args) => layerTreeController?.render?.(...args),
      },
      reportDiagnostic: entry => dependencies.readiness.reliabilityDiagnostic.push({ category: 'rendering-domain', ...entry }),
    });

  }

  function initializeProjectDomain() {
    (projectDomain = null);

    (selectionDomain = null);

    (renderingDomain = null);

    (gisDomain = null);

    (editingDomain = null);

    (selectionUiController = null);

    selectionToolbarPresentation?.dispose?.();
    (selectionToolbarPresentation = null);

    (countryPropertyController = null);

    (objectPropertyController = null);

    (layerTreeController = null);
  }

  return Object.freeze({
    connect,
    initializeProjectDomain,
    get countryPropertyController() { return countryPropertyController; },
    get editingDomain() { return editingDomain; },
    get gisDomain() { return gisDomain; },
    get initializeDomainBoundaries() { return initializeDomainBoundaries; },
    get layerTreeController() { return layerTreeController; },
    set layerTreeController(value) { layerTreeController = value; },
    get objectPropertyController() { return objectPropertyController; },
    get projectDomain() { return projectDomain; },
    get renderingDomain() { return renderingDomain; },
    get selectionDomain() { return selectionDomain; },
    get selectionToolbarPresentation() { return selectionToolbarPresentation; },
    get selectionUiController() { return selectionUiController; },
  });
}
