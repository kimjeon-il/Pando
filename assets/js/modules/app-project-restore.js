/** ProjectRestore: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createProjectRestore() {
  let dependencies;
  let confirmModalController;
  let coastReconciliationController;
  let openConfirmModal;
  let closeConfirmModal;
  function connect(ports) {
    if (dependencies) throw new Error('project-restore already connected');
    dependencies = ports;
  }

  function applyAtlasState(project, manual = false, { projectGeneration = null, skipRenderReset = false } = {}) {
    (0, dependencies.projectServices.assertCurrentProjectSchema)(project);
    if (project.countriesData?.features) {
      (0, dependencies.territorialModel.assertProjectReferenceIntegrity)({
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
    (0, dependencies.countryRecords.resetCountryLabelAnchorRuntime)();
    const nextProjectGeneration = skipRenderReset && Number.isFinite(projectGeneration)
      ? projectGeneration
      : dependencies.domains.projectDomain
        ? dependencies.domains.projectDomain.resetRenderGeneration('project-reset')
        : dependencies.rendering.gpuMapRenderer.resetProjectRenderState?.();
    dependencies.geometryPreview.boundarySelectionAnalysisCache.clear();
    dependencies.projectState.state.countryVisualPhase = 'preview';
    dependencies.labelCacheCommands.resetCountryDisplayCache();
    (0, dependencies.snapshots.applySharedProjectFields)(project);
    dependencies.rendering.gpuMapRenderer.invalidateHydroVisibility();
    dependencies.projectState.state.layerSearch = '';
    dependencies.projectState.state.countriesData = project.countriesData
      ? (0, dependencies.geometryMutation.reindexCountries)((0, dependencies.platform.deepClone)(project.countriesData), true)
      : (0, dependencies.builtinCountries.freshPristineCountries)(true);
    dependencies.projectState.state.auditPreviewCountries = null;
    (0, dependencies.snapshots.normalizeProjectObjects)();
    (0, dependencies.layerTree.pruneLayerItemVisibility)();
    (0, dependencies.countries.scheduleCountryLabelAnchors)(null, 10);
    (0, dependencies.layers.markLayerTreeDirty)();
    (0, dependencies.projectSnapshots.configureDatasetSession)(project);
    const externalGeometry = !!project.countriesData && project.baseDataset !== dependencies.platformConfigurationA.BASE_DATASET;
    dependencies.domains.selectionDomain.resetProject(dependencies.domains.projectDomain?.getGeneration?.() || 0);
    dependencies.domains.editingDomain?.resetProject?.(dependencies.domains.projectDomain?.getGeneration?.() || 0);

    (0, dependencies.mapSettingsUi.syncProjectionButtons)();
    (0, dependencies.mapSettingsUi.renderMapDisplaySettings)();
    if ((0, dependencies.platform.$)('layerSearchInput')) (0, dependencies.platform.$)('layerSearchInput').value = dependencies.projectState.state.layerSearch;
    dependencies.domains.layerTreeController?.render(true);
    dependencies.domainControllers.objectPropertyController.show(null);
    (0, dependencies.platform.$)('selectionStatus').textContent = '';
    dependencies.projectState.state.boundaryPreparation?.cancel();
    dependencies.projectState.state.boundaryPreparation = null;
    dependencies.spatialQuery.mapEditClient?.invalidateBoundaryCache?.();
    (0, dependencies.renderQuality.scheduleGpuMeshRebuild)(0, nextProjectGeneration);
    (0, dependencies.mapView.syncMapHostFromState)();
    (0, dependencies.spatialRecords.scheduleMapObjectSpatialIndexRebuild)();
    dependencies.lifecycleUi.projectUi.syncHistory();
    dependencies.domains.editingDomain?.setTool('select');
    if (manual) (0, dependencies.feedback.setActionStatus)(externalGeometry
      ? '외부 GIS 형상을 저장 당시 상태로 불러왔습니다.'
      : '프로젝트를 불러왔습니다.', 'success', 3200);
  }

  async function getConfirmModalController() {
    if (confirmModalController) return confirmModalController;
    await (0, dependencies.applicationServicesA.ensureModalRuntime)();
    confirmModalController = (0, dependencies.uiFactoriesA.createConfirmModalController)({
      document,
      window,
      elements: {
        modal: (0, dependencies.platform.$)('confirmModal'),
        backdrop: (0, dependencies.platform.$)('confirmModal')?.querySelector('.confirm-modal-dim'),
        title: (0, dependencies.platform.$)('confirmModalTitle'),
        message: (0, dependencies.platform.$)('confirmModalMessage'),
        impactSection: (0, dependencies.platform.$)('confirmModalImpactSection'),
        impactList: (0, dependencies.platform.$)('confirmModalImpactList'),
        ok: (0, dependencies.platform.$)('confirmModalOkBtn'),
        cancel: (0, dependencies.platform.$)('confirmModalCancelBtn'),
        choiceRow: (0, dependencies.platform.$)('confirmModalChoiceRow'),
        choice: (0, dependencies.platform.$)('confirmModalChoice'),
      },
      setChoices: dependencies.propertyEditingB.replaceSelectOptions,
      beforeOpen: dependencies.readinessUi.clearNotification,
    });
    confirmModalController.bind();
    return confirmModalController;
  }

  async function getCoastReconciliationController() {
    if (coastReconciliationController) return coastReconciliationController;
    await (0, dependencies.applicationServicesA.ensureModalRuntime)();
    coastReconciliationController = (0, dependencies.uiFactoriesA.createCoastReconciliationController)({
      document,
      window,
      elements: {
        modal: (0, dependencies.platform.$)('coastReconciliationModal'),
        backdrop: (0, dependencies.platform.$)('coastReconciliationModal')?.querySelector('.confirm-modal-dim'),
        title: (0, dependencies.platform.$)('coastReconciliationTitle'),
        message: (0, dependencies.platform.$)('coastReconciliationMessage'),
        impact: (0, dependencies.platform.$)('coastReconciliationImpact'),
        impactList: (0, dependencies.platform.$)('coastReconciliationImpactList'),
        country: (0, dependencies.platform.$)('coastReconciliationCountryBtn'),
        subject: (0, dependencies.platform.$)('coastReconciliationAdminBtn'),
        independent: (0, dependencies.platform.$)('coastReconciliationIndependentBtn'),
        cancel: (0, dependencies.platform.$)('coastReconciliationCancelBtn'),
      },
    });
    coastReconciliationController.bind();
    return coastReconciliationController;
  }

  function analyzeAdminCountryCoastConflicts(adminId) {
    const admin = (0, dependencies.objectPresentation.territorialUnitById)(adminId);
    const countryId = String(admin?.properties?.sovereignId || '');
    const country = (0, dependencies.countries.countryFeatureById)(countryId);
    if (!admin || admin.properties?.unitType !== dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.SUBUNIT || !country) return { admin, country, status: 'unavailable', conflicts: [] };
    const topology = (0, dependencies.territorialModel.buildSharedBoundaryTopology)(dependencies.projectState.state.countriesData?.features || []);
    const result = (0, dependencies.gisServicesA.analyzeAdminCountryCoast)({ adminFeature: admin, countryFeature: country, countryTopology: topology });
    return { admin, country, status: result.status, unavailableReason: result.unavailableReason, conflicts: result.conflicts || [] };
  }

  async function reconcileAdminCountryCoast(adminId, { manual = true } = {}) {
    await (0, dependencies.gisServicesA.ensureGisRuntime)();
    const revision = dependencies.projectState.state.stateRevision;
    const analysis = analyzeAdminCountryCoastConflicts(adminId);
    if (!analysis.admin || !analysis.country) {
      (0, dependencies.feedback.setActionStatus)('소속 국가를 찾을 수 없어 해안선을 비교할 수 없습니다.', 'error', 3600);
      return { ok: false, code: 'missing-country' };
    }
    if (analysis.status === 'unavailable') {
      (0, dependencies.feedback.setActionStatus)('국가 해안선을 신뢰할 수 있게 판별하지 못해 자동 정합할 수 없습니다.', 'error', 4200);
      return { ok: false, code: analysis.unavailableReason || 'coast-unavailable' };
    }
    if (!analysis.conflicts.length) {
      if (manual) (0, dependencies.feedback.setActionStatus)('국가 해안선과 일치하는 불일치 구간이 없습니다.', 'success', 3000);
      return { ok: true, changed: false };
    }
    const decision = await (await getCoastReconciliationController()).open({
      subjectName: (0, dependencies.objectPresentation.territorialUnitName)(analysis.admin),
      subjectActionLabel: '하위단위',
      countryName: (0, dependencies.presentation.countryName)(analysis.country),
      conflicts: analysis.conflicts,
    });
    if (decision.direction === 'cancel') return { ok: false, cancelled: true };
    if (decision.direction === 'independent') {
      (0, dependencies.feedback.setActionStatus)('두 해안선을 자동으로 맞추지 않고 현재 상태를 유지했습니다.', 'success', 3200);
      return { ok: true, changed: false, independent: true };
    }

    if (dependencies.projectState.state.stateRevision !== revision) return { ok: false, cancelled: true };
    try {
      const planned = (0, dependencies.gisServicesA.planCoastReconciliations)({ conflicts: analysis.conflicts, direction: decision.direction });
      const clipper = window.polygonClipping;
      let coastBaseline;
      if (decision.direction === 'country-to-admin') {
        const addition = clipper.difference(planned.adminGeometry.coordinates, analysis.admin.geometry.coordinates);
        const removal = clipper.difference(analysis.admin.geometry.coordinates, planned.adminGeometry.coordinates);
        coastBaseline = { type: 'MultiPolygon', coordinates: clipper.union(clipper.difference(analysis.country.geometry.coordinates, addition), removal) };
      }
      const prepared = await (0, dependencies.territorialEditingB.previewTerritorialEdit)({ operation: 'coast',
        targetId: analysis.admin.id, draft: planned.countryGeometry, coastBaseline,
      }, { selectedId: analysis.admin.id, shouldKeepResult: () => dependencies.projectState.state.stateRevision === revision });
      return { ok: prepared, preview: prepared, changed: false };
    } catch (error) {
      (0, dependencies.feedback.reportOperationError)(error, '해안선 정합을 계산하지 못했습니다.', 'PL-COAST-RECONCILE-001', 4400);
      return { ok: false, error };
    }
  }

  async function resetProjectInPlace({ projectGeneration = null, skipRenderReset = false, prepared = null } = {}) {
    const preparedCountries = prepared?.countries || prepared;
    if (!preparedCountries?.features) throw new Error('내장 기본 프로젝트 자료가 준비되지 않았습니다.');
    closeConfirmModal();
    (0, dependencies.workspaceUiA.closeMobileSheets)();
    const nextProjectGeneration = skipRenderReset && Number.isFinite(projectGeneration)
      ? projectGeneration
      : dependencies.domains.projectDomain
        ? dependencies.domains.projectDomain.resetRenderGeneration('project-reset')
        : dependencies.rendering.gpuMapRenderer.resetProjectRenderState?.();
    (0, dependencies.renderQuality.cancelGpuMeshRebuild)();
    dependencies.spatialQuery.mapEditClient?.stop?.();
    dependencies.geometryPreview.boundarySelectionAnalysisCache.clear();
    dependencies.projectState.state.countryVisualPhase = 'preview';
    dependencies.labelCacheCommands.resetCountryDisplayCache();

    (0, dependencies.countryRecords.resetCountryLabelAnchorRuntime)();

    dependencies.projectState.state.countryOverrides = {};
    dependencies.projectState.state.sourceInfo = null;
    dependencies.projectState.state.labels = [];
    dependencies.projectState.state.labelSettings = {};
    dependencies.projectState.state.genericFeatures = [];
    dependencies.projectState.state.hydroEdits = [];
    dependencies.projectState.state.territorialUnits = [];
    dependencies.projectState.state.territorialRelations = [];
    dependencies.projectState.state.distributionLayers = [];
    dependencies.projectState.state.distributionEntries = [];
    dependencies.projectState.state.distributionSettings = { renderMode: dependencies.applicationConstantsA.DISTRIBUTION_RENDER_MODES.DOMINANT, boundaryVisible: true };
    dependencies.projectState.state.selectedDistributionLayerId = '';
    dependencies.projectState.state.distributionDraft = null;
    (0, dependencies.geometryEditingCore.clearGeometryPreview)(dependencies.projectState.state.geometryPreview);
    dependencies.domains.editingDomain?.cancelActiveGesture?.('project-state-replaced');
    dependencies.projectState.state.audit = { status: 'idle', revision: dependencies.projectState.state.audit.revision + 1, report: null, selectedIssueId: null };
    dependencies.interactionStateCommands.setHoverHit(null);
    dependencies.projectState.state.physicalSettings = (0, dependencies.hydroModel.normalizePhysicalSettings)(null);
    dependencies.projectState.state.projection = 'globe';
    dependencies.projectState.state.layerVisibility = (0, dependencies.projectSession.normalizeLayerVisibility)();
    dependencies.projectState.state.itemVisibility = (0, dependencies.layerTree.normalizeLayerItemState)(null);
    dependencies.projectState.state.layerPresentation = (0, dependencies.modelValidation.normalizeLayerPresentation)();
    dependencies.rendering.gpuMapRenderer.invalidateHydroVisibility();
    dependencies.projectState.state.layerFolders = (0, dependencies.layerTree.normalizeLayerFolderState)(null);
    dependencies.projectState.state.layerSearch = '';
    dependencies.projectState.state.tool = 'select';
    dependencies.projectState.state.labelPlacementMode = false;
    dependencies.projectState.state.coastEditCountryId = null;
    dependencies.projectState.state.coastEditScopeGenericFeatureId = null;
    dependencies.projectState.state.coastEditReturnSelection = null;
    (0, dependencies.countryEditingB.resetBoundaryEditState)();
    dependencies.projectState.state.genericFeatureMergeSourceId = null;
    dependencies.projectState.state.genericFeatureMergeTargetIds = [];
    dependencies.projectState.state.genericFeatureSplitSourceId = null;
    (0, dependencies.countryEditingB.resetTerritorialUnitEditState)();
    (0, dependencies.countryEditingB.resetMergeState)();
    (0, dependencies.countryEditingB.resetTerritoryEditingState)(true);
    dependencies.domains.selectionDomain.resetProject(dependencies.domains.projectDomain?.getGeneration?.() || 0);
    dependencies.projectState.state.view = { globeRotation: [-15, -25, 0], globeZoom: 1, flatCenter: [0, 20], flatZoom: 1 };

    // 핵심: 현재 state나 window 객체가 아니라 앱 시작 때 고정해 둔 불변 원본 스냅샷에서 다시 생성한다.
    // false = 이전 국가명/색상 override까지 적용하지 않고 최초 데이터 그대로 복원.
    dependencies.projectState.state.countryIndex.clear();
    dependencies.projectState.state.countriesData = (0, dependencies.geometryMutation.reindexCountries)(preparedCountries, false, { assumeCanonical: true });
    const restoredExactly = dependencies.builtinCountries.canonicalCountryStore
      ? dependencies.projectState.state.countriesData.features.length === dependencies.builtinCountries.canonicalCountryStore.ids().length
        && dependencies.projectState.state.countriesData.features.every(feature => dependencies.builtinCountries.canonicalCountryStore.geometryEquals(String(feature.id), feature.geometry))
      : true;
    if (!restoredExactly) {
      throw new Error('내장 원본 국경 복원 검증에 실패했습니다.');
    }
    (0, dependencies.builtinCountries.applyFreshBuiltinClassification)();
    (0, dependencies.countryRecords.applyPristineLabelAnchors)(dependencies.projectState.state.countriesData);
    dependencies.projectState.state.auditPreviewCountries = null;
    (0, dependencies.layerTree.pruneLayerItemVisibility)();
    (0, dependencies.layers.markLayerTreeDirty)();
    (0, dependencies.projectSnapshots.configureDatasetSession)(null);
    (0, dependencies.countryValidation.refreshCountryCentroids)();
    dependencies.projectState.state.boundaryPreparation?.cancel();
    dependencies.projectState.state.boundaryPreparation = null;
    dependencies.spatialQuery.mapEditClient?.invalidateBoundaryCache?.();

    (0, dependencies.mapSettingsUi.renderMapDisplaySettings)();
    if ((0, dependencies.platform.$)('layerSearchInput')) (0, dependencies.platform.$)('layerSearchInput').value = '';
    dependencies.domains.layerTreeController?.render(true);
    (0, dependencies.mapSettingsUi.syncProjectionButtons)();
    dependencies.domainControllers.objectPropertyController.show(null);
    (0, dependencies.platform.$)('selectionStatus').textContent = '';
    dependencies.domains.editingDomain?.setTool('select', { announce: false });

    const clearReplacedProjectLayers = () => {
      // Existing SVG nodes can retain the edited Feature as __data__.  Clear
      // them only when the canonical mesh is staged, so labels never arrive
      // before the corresponding country surface.
      dependencies.mapLayers.countryLayer?.selectAll('*').remove();
      dependencies.mapHostViewA.countryLabelLayer?.selectAll('*').remove();
      dependencies.mapHostViewB.selectionLayer?.selectAll('*').remove();
      dependencies.mapHostViewA.hoverLayer?.selectAll('*').remove();
      dependencies.mapHostViewA.boundaryEditLayer?.selectAll('*').remove();
      dependencies.mapHostViewC.territorialUnitLayer?.selectAll('*').remove();
      dependencies.mapHostViewA.distributionLayer?.selectAll('*').remove();
      dependencies.mapHostViewC.vertexLayer?.selectAll('*').remove();
      dependencies.mapHostViewA.genericFeatureLayer?.selectAll('*').remove();
      dependencies.mapHostViewB.labelLayer?.selectAll('*').remove();
      dependencies.mapHostViewB.previewLayer?.selectAll('*').remove();
      dependencies.mapHostViewC.validationLayer?.selectAll('*').remove();
      dependencies.mapHostViewA.draftLayer?.selectAll('*').remove();
      dependencies.mapHostViewB.snapLayer?.selectAll('*').remove();
      dependencies.mapHostViewC.territorialOperationLayer?.selectAll('*').remove();
    };

    const activatedBuiltinMesh = await dependencies.rendering.gpuMapRenderer.activateBuiltinMeshBaseline({
      projectGeneration: nextProjectGeneration,
      onStaged: () => {
        dependencies.projectState.state.countryVisualPhase = 'canonical';
        dependencies.labelCacheCommands.resetCountryDisplayCache();
        clearReplacedProjectLayers();
        (0, dependencies.mapView.syncMapHostFromState)();
        dependencies.domains.renderingDomain?.invalidateProject?.('built-in-project-transition-ready');
        (0, dependencies.mapHostViewB.resizeMap)();
      },
    });
    if (!activatedBuiltinMesh) {
      throw new Error('내장 기본 메시를 화면에 적용하지 못했습니다.');
    }
    (0, dependencies.spatialRecords.scheduleMapObjectSpatialIndexRebuild)();
    dependencies.lifecycleUi.projectUi.syncHistory();
  }

  function initializeConfirmModalController() {
    (confirmModalController = null);

    (coastReconciliationController = null);

    (openConfirmModal = options => getConfirmModalController()
      .then(controller => controller.open(options))
      .catch(error => { options.onCancel?.(); (0, dependencies.feedback.reportOperationError)(error, '확인 창을 불러오지 못했습니다.', 'PL-MODAL-001'); }));

    (closeConfirmModal = () => confirmModalController?.close());
  }

  return Object.freeze({
    connect,
    initializeConfirmModalController,
    get applyAtlasState() { return applyAtlasState; },
    get closeConfirmModal() { return closeConfirmModal; },
    get confirmModalController() { return confirmModalController; },
    get getCoastReconciliationController() { return getCoastReconciliationController; },
    get openConfirmModal() { return openConfirmModal; },
    get reconcileAdminCountryCoast() { return reconcileAdminCountryCoast; },
    get resetProjectInPlace() { return resetProjectInPlace; },
  });
}
