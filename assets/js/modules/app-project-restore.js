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
    (0, dependencies.assertCurrentProjectSchema)(project);
    if (project.countriesData?.features) {
      (0, dependencies.assertProjectReferenceIntegrity)({
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
    (0, dependencies.resetCountryLabelAnchorRuntime)();
    const nextProjectGeneration = skipRenderReset && Number.isFinite(projectGeneration)
      ? projectGeneration
      : dependencies.projectDomain
        ? dependencies.projectDomain.resetRenderGeneration('project-reset')
        : dependencies.gpuMapRenderer.resetProjectRenderState?.();
    dependencies.boundarySelectionAnalysisCache.clear();
    dependencies.state.countryVisualPhase = 'preview';
    dependencies.countryDisplaySource = null;
    dependencies.countryDisplayIndex = new Map();
    (0, dependencies.applySharedProjectFields)(project);
    dependencies.gpuMapRenderer.invalidateHydroVisibility();
    dependencies.state.layerSearch = '';
    dependencies.state.countriesData = project.countriesData
      ? (0, dependencies.reindexCountries)((0, dependencies.deepClone)(project.countriesData), true)
      : (0, dependencies.freshPristineCountries)(true);
    dependencies.state.auditPreviewCountries = null;
    (0, dependencies.normalizeProjectObjects)();
    (0, dependencies.pruneLayerItemVisibility)();
    (0, dependencies.scheduleCountryLabelAnchors)(null, 10);
    (0, dependencies.markLayerTreeDirty)();
    (0, dependencies.configureDatasetSession)(project);
    const externalGeometry = !!project.countriesData && project.baseDataset !== dependencies.BASE_DATASET;
    dependencies.selectionDomain.resetProject(dependencies.projectDomain?.getGeneration?.() || 0);
    dependencies.editingDomain?.resetProject?.(dependencies.projectDomain?.getGeneration?.() || 0);

    (0, dependencies.syncProjectionButtons)();
    (0, dependencies.renderMapDisplaySettings)();
    if ((0, dependencies.$)('layerSearchInput')) (0, dependencies.$)('layerSearchInput').value = dependencies.state.layerSearch;
    dependencies.layerTreeController?.render(true);
    dependencies.objectPropertyController.show(null);
    (0, dependencies.$)('selectionStatus').textContent = '';
    dependencies.state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    (0, dependencies.scheduleGpuMeshRebuild)(0, nextProjectGeneration);
    (0, dependencies.syncMapHostFromState)();
    (0, dependencies.scheduleMapObjectSpatialIndexRebuild)();
    dependencies.projectUi.syncHistory();
    dependencies.editingDomain?.setTool('select');
    if (manual) (0, dependencies.setActionStatus)(externalGeometry
      ? '외부 GIS 형상을 저장 당시 상태로 불러왔습니다.'
      : '프로젝트를 불러왔습니다.', 'success', 3200);
  }

  async function getConfirmModalController() {
    if (confirmModalController) return confirmModalController;
    await (0, dependencies.ensureModalRuntime)();
    confirmModalController = (0, dependencies.createConfirmModalController)({
      document,
      window,
      elements: {
        modal: (0, dependencies.$)('confirmModal'),
        backdrop: (0, dependencies.$)('confirmModal')?.querySelector('.confirm-modal-dim'),
        title: (0, dependencies.$)('confirmModalTitle'),
        message: (0, dependencies.$)('confirmModalMessage'),
        impactSection: (0, dependencies.$)('confirmModalImpactSection'),
        impactList: (0, dependencies.$)('confirmModalImpactList'),
        ok: (0, dependencies.$)('confirmModalOkBtn'),
        cancel: (0, dependencies.$)('confirmModalCancelBtn'),
        choiceRow: (0, dependencies.$)('confirmModalChoiceRow'),
        choice: (0, dependencies.$)('confirmModalChoice'),
      },
      setChoices: dependencies.replaceSelectOptions,
      beforeOpen: dependencies.clearNotification,
    });
    confirmModalController.bind();
    return confirmModalController;
  }

  async function getCoastReconciliationController() {
    if (coastReconciliationController) return coastReconciliationController;
    await (0, dependencies.ensureModalRuntime)();
    coastReconciliationController = (0, dependencies.createCoastReconciliationController)({
      document,
      window,
      elements: {
        modal: (0, dependencies.$)('coastReconciliationModal'),
        backdrop: (0, dependencies.$)('coastReconciliationModal')?.querySelector('.confirm-modal-dim'),
        title: (0, dependencies.$)('coastReconciliationTitle'),
        message: (0, dependencies.$)('coastReconciliationMessage'),
        impact: (0, dependencies.$)('coastReconciliationImpact'),
        impactList: (0, dependencies.$)('coastReconciliationImpactList'),
        country: (0, dependencies.$)('coastReconciliationCountryBtn'),
        subject: (0, dependencies.$)('coastReconciliationAdminBtn'),
        independent: (0, dependencies.$)('coastReconciliationIndependentBtn'),
        cancel: (0, dependencies.$)('coastReconciliationCancelBtn'),
      },
    });
    coastReconciliationController.bind();
    return coastReconciliationController;
  }

  function analyzeAdminCountryCoastConflicts(adminId) {
    const admin = (0, dependencies.territorialUnitById)(adminId);
    const countryId = String(admin?.properties?.sovereignId || '');
    const country = (0, dependencies.countryFeatureById)(countryId);
    if (!admin || admin.properties?.unitType !== dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT || !country) return { admin, country, status: 'unavailable', conflicts: [] };
    const topology = (0, dependencies.buildSharedBoundaryTopology)(dependencies.state.countriesData?.features || []);
    const result = (0, dependencies.analyzeAdminCountryCoast)({ adminFeature: admin, countryFeature: country, countryTopology: topology });
    return { admin, country, status: result.status, unavailableReason: result.unavailableReason, conflicts: result.conflicts || [] };
  }

  async function reconcileAdminCountryCoast(adminId, { manual = true } = {}) {
    await (0, dependencies.ensureGisRuntime)();
    const revision = dependencies.state.stateRevision;
    const analysis = analyzeAdminCountryCoastConflicts(adminId);
    if (!analysis.admin || !analysis.country) {
      (0, dependencies.setActionStatus)('소속 국가를 찾을 수 없어 해안선을 비교할 수 없습니다.', 'error', 3600);
      return { ok: false, code: 'missing-country' };
    }
    if (analysis.status === 'unavailable') {
      (0, dependencies.setActionStatus)('국가 해안선을 신뢰할 수 있게 판별하지 못해 자동 정합할 수 없습니다.', 'error', 4200);
      return { ok: false, code: analysis.unavailableReason || 'coast-unavailable' };
    }
    if (!analysis.conflicts.length) {
      if (manual) (0, dependencies.setActionStatus)('국가 해안선과 일치하는 불일치 구간이 없습니다.', 'success', 3000);
      return { ok: true, changed: false };
    }
    const decision = await (await getCoastReconciliationController()).open({
      subjectName: (0, dependencies.territorialUnitName)(analysis.admin),
      subjectActionLabel: '하위단위',
      countryName: (0, dependencies.countryName)(analysis.country),
      conflicts: analysis.conflicts,
    });
    if (decision.direction === 'cancel') return { ok: false, cancelled: true };
    if (decision.direction === 'independent') {
      (0, dependencies.setActionStatus)('두 해안선을 자동으로 맞추지 않고 현재 상태를 유지했습니다.', 'success', 3200);
      return { ok: true, changed: false, independent: true };
    }

    if (dependencies.state.stateRevision !== revision) return { ok: false, cancelled: true };
    try {
      const planned = (0, dependencies.planCoastReconciliations)({ conflicts: analysis.conflicts, direction: decision.direction });
      const clipper = window.polygonClipping;
      let coastBaseline;
      if (decision.direction === 'country-to-admin') {
        const addition = clipper.difference(planned.adminGeometry.coordinates, analysis.admin.geometry.coordinates);
        const removal = clipper.difference(analysis.admin.geometry.coordinates, planned.adminGeometry.coordinates);
        coastBaseline = { type: 'MultiPolygon', coordinates: clipper.union(clipper.difference(analysis.country.geometry.coordinates, addition), removal) };
      }
      const prepared = await (0, dependencies.previewTerritorialEdit)({ operation: 'coast',
        targetId: analysis.admin.id, draft: planned.countryGeometry, coastBaseline,
      }, { selectedId: analysis.admin.id, shouldKeepResult: () => dependencies.state.stateRevision === revision });
      return { ok: prepared, preview: prepared, changed: false };
    } catch (error) {
      (0, dependencies.reportOperationError)(error, '해안선 정합을 계산하지 못했습니다.', 'PL-COAST-RECONCILE-001', 4400);
      return { ok: false, error };
    }
  }

  async function resetProjectInPlace({ projectGeneration = null, skipRenderReset = false, prepared = null } = {}) {
    const preparedCountries = prepared?.countries || prepared;
    if (!preparedCountries?.features) throw new Error('내장 기본 프로젝트 자료가 준비되지 않았습니다.');
    closeConfirmModal();
    (0, dependencies.closeMobileSheets)();
    const nextProjectGeneration = skipRenderReset && Number.isFinite(projectGeneration)
      ? projectGeneration
      : dependencies.projectDomain
        ? dependencies.projectDomain.resetRenderGeneration('project-reset')
        : dependencies.gpuMapRenderer.resetProjectRenderState?.();
    (0, dependencies.cancelGpuMeshRebuild)();
    dependencies.mapEditClient?.stop?.();
    dependencies.boundarySelectionAnalysisCache.clear();
    dependencies.state.countryVisualPhase = 'preview';
    dependencies.countryDisplaySource = null;
    dependencies.countryDisplayIndex = new Map();

    (0, dependencies.resetCountryLabelAnchorRuntime)();

    dependencies.state.countryOverrides = {};
    dependencies.state.sourceInfo = null;
    dependencies.state.labels = [];
    dependencies.state.labelSettings = {};
    dependencies.state.genericFeatures = [];
    dependencies.state.hydroEdits = [];
    dependencies.state.territorialUnits = [];
    dependencies.state.territorialRelations = [];
    dependencies.state.distributionLayers = [];
    dependencies.state.distributionEntries = [];
    dependencies.state.distributionSettings = { renderMode: dependencies.DISTRIBUTION_RENDER_MODES.DOMINANT, boundaryVisible: true };
    dependencies.state.selectedDistributionLayerId = '';
    dependencies.state.distributionDraft = null;
    (0, dependencies.clearGeometryPreview)(dependencies.state.geometryPreview);
    dependencies.editingDomain?.cancelActiveGesture?.('project-state-replaced');
    dependencies.state.audit = { status: 'idle', revision: dependencies.state.audit.revision + 1, report: null, selectedIssueId: null };
    dependencies.lastHoverHit = null;
    dependencies.state.physicalSettings = (0, dependencies.normalizePhysicalSettings)(null);
    dependencies.state.projection = 'globe';
    dependencies.state.layerVisibility = (0, dependencies.normalizeLayerVisibility)();
    dependencies.state.itemVisibility = (0, dependencies.normalizeLayerItemState)(null);
    dependencies.state.layerPresentation = (0, dependencies.normalizeLayerPresentation)();
    dependencies.gpuMapRenderer.invalidateHydroVisibility();
    dependencies.state.layerFolders = (0, dependencies.normalizeLayerFolderState)(null);
    dependencies.state.layerSearch = '';
    dependencies.state.tool = 'select';
    dependencies.state.labelPlacementMode = false;
    dependencies.state.coastEditCountryId = null;
    dependencies.state.coastEditScopeGenericFeatureId = null;
    dependencies.state.coastEditReturnSelection = null;
    (0, dependencies.resetBoundaryEditState)();
    dependencies.state.genericFeatureMergeSourceId = null;
    dependencies.state.genericFeatureMergeTargetIds = [];
    dependencies.state.genericFeatureSplitSourceId = null;
    (0, dependencies.resetTerritorialUnitEditState)();
    (0, dependencies.resetMergeState)();
    (0, dependencies.resetTerritoryEditingState)(true);
    dependencies.selectionDomain.resetProject(dependencies.projectDomain?.getGeneration?.() || 0);
    dependencies.state.view = { globeRotation: [-15, -25, 0], globeZoom: 1, flatCenter: [0, 20], flatZoom: 1 };

    // 핵심: 현재 state나 window 객체가 아니라 앱 시작 때 고정해 둔 불변 원본 스냅샷에서 다시 생성한다.
    // false = 이전 국가명/색상 override까지 적용하지 않고 최초 데이터 그대로 복원.
    dependencies.state.countryIndex.clear();
    dependencies.state.countriesData = (0, dependencies.reindexCountries)(preparedCountries, false, { assumeCanonical: true });
    const restoredExactly = dependencies.canonicalCountryStore
      ? dependencies.state.countriesData.features.length === dependencies.canonicalCountryStore.ids().length
        && dependencies.state.countriesData.features.every(feature => dependencies.canonicalCountryStore.geometryEquals(String(feature.id), feature.geometry))
      : true;
    if (!restoredExactly) {
      throw new Error('내장 원본 국경 복원 검증에 실패했습니다.');
    }
    (0, dependencies.applyFreshBuiltinClassification)();
    (0, dependencies.applyPristineLabelAnchors)(dependencies.state.countriesData);
    dependencies.state.auditPreviewCountries = null;
    (0, dependencies.pruneLayerItemVisibility)();
    (0, dependencies.markLayerTreeDirty)();
    (0, dependencies.configureDatasetSession)(null);
    (0, dependencies.refreshCountryCentroids)();
    dependencies.state.boundaryTopology = { edges: new Map(), nodes: new Map() };

    (0, dependencies.renderMapDisplaySettings)();
    if ((0, dependencies.$)('layerSearchInput')) (0, dependencies.$)('layerSearchInput').value = '';
    dependencies.layerTreeController?.render(true);
    (0, dependencies.syncProjectionButtons)();
    dependencies.objectPropertyController.show(null);
    (0, dependencies.$)('selectionStatus').textContent = '';
    dependencies.editingDomain?.setTool('select', { announce: false });

    const clearReplacedProjectLayers = () => {
      // Existing SVG nodes can retain the edited Feature as __data__.  Clear
      // them only when the canonical mesh is staged, so labels never arrive
      // before the corresponding country surface.
      dependencies.countryLayer?.selectAll('*').remove();
      dependencies.countryLabelLayer?.selectAll('*').remove();
      dependencies.selectionLayer?.selectAll('*').remove();
      dependencies.hoverLayer?.selectAll('*').remove();
      dependencies.boundaryEditLayer?.selectAll('*').remove();
      dependencies.territorialUnitLayer?.selectAll('*').remove();
      dependencies.distributionLayer?.selectAll('*').remove();
      dependencies.vertexLayer?.selectAll('*').remove();
      dependencies.genericFeatureLayer?.selectAll('*').remove();
      dependencies.labelLayer?.selectAll('*').remove();
      dependencies.previewLayer?.selectAll('*').remove();
      dependencies.validationLayer?.selectAll('*').remove();
      dependencies.draftLayer?.selectAll('*').remove();
      dependencies.snapLayer?.selectAll('*').remove();
      dependencies.territorialOperationLayer?.selectAll('*').remove();
    };

    const activatedBuiltinMesh = await dependencies.gpuMapRenderer.activateBuiltinMeshBaseline({
      projectGeneration: nextProjectGeneration,
      onStaged: () => {
        dependencies.state.countryVisualPhase = 'canonical';
        dependencies.countryDisplaySource = null;
        dependencies.countryDisplayIndex = new Map();
        clearReplacedProjectLayers();
        (0, dependencies.syncMapHostFromState)();
        dependencies.renderingDomain?.invalidateProject?.('built-in-project-transition-ready');
        (0, dependencies.resizeMap)();
      },
    });
    if (!activatedBuiltinMesh) {
      throw new Error('내장 기본 메시를 화면에 적용하지 못했습니다.');
    }
    (0, dependencies.scheduleMapObjectSpatialIndexRebuild)();
    dependencies.projectUi.syncHistory();
  }

  function initializeConfirmModalController() {
    (confirmModalController = null);

    (coastReconciliationController = null);

    (openConfirmModal = options => getConfirmModalController()
      .then(controller => controller.open(options))
      .catch(error => { options.onCancel?.(); (0, dependencies.reportOperationError)(error, '확인 창을 불러오지 못했습니다.', 'PL-MODAL-001'); }));

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
