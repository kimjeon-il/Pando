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
    (0, dependencies.$)('countriesVisible').checked = dependencies.state.layerVisibility.countries;
    (0, dependencies.$)('subunitsVisible').checked = dependencies.state.layerVisibility.subunits !== false;
    (0, dependencies.$)('regionsVisible').checked = dependencies.state.layerVisibility.regions !== false;
    (0, dependencies.$)('languagesVisible').checked = dependencies.state.layerVisibility.languages !== false;
    (0, dependencies.$)('ethnicitiesVisible').checked = dependencies.state.layerVisibility.ethnicities !== false;
    (0, dependencies.$)('religionsVisible').checked = dependencies.state.layerVisibility.religions !== false;
    (0, dependencies.$)('riversVisible').checked = dependencies.state.layerVisibility.rivers !== false;
    (0, dependencies.$)('lakesVisible').checked = dependencies.state.layerVisibility.lakes !== false;
    (0, dependencies.$)('genericFeaturesVisible').checked = dependencies.state.layerVisibility.genericFeatures;
    (0, dependencies.$)('labelsVisible').checked = dependencies.state.layerVisibility.labels;
    (0, dependencies.$)('basemapLabelsVisible').checked = dependencies.state.layerVisibility.basemapLabels;
    (0, dependencies.$)('countryFlagsVisible').checked = dependencies.state.layerVisibility.countryFlags !== false;
    (0, dependencies.syncPhysicalControls)();
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

    const snapshot = (0, dependencies.snapshotEditable)();
    const countryId = String(analysis.country.id || '');
    const adminIdKey = String(analysis.admin.id);
    const countryBefore = (0, dependencies.deepClone)(analysis.country.geometry);
    const adminBefore = (0, dependencies.deepClone)(analysis.admin.geometry);
    try {
      const planned = (0, dependencies.planCoastReconciliations)({ conflicts: analysis.conflicts, direction: decision.direction });
      const nextCountry = planned.countryGeometry;
      const nextAdmin = planned.adminGeometry;
      const countryValidation = (0, dependencies.validateCoastReplacement)(nextCountry, { clipper: window.polygonClipping });
      const adminValidation = (0, dependencies.validateCoastReplacement)(nextAdmin, { clipper: window.polygonClipping });
      if (!countryValidation.ok || !adminValidation.ok) throw new Error('정합 결과 geometry가 올바르지 않습니다.');
      dependencies.projectDomain.recordHistory({
        type: 'coast-reconciliation',
        description: `${(0, dependencies.territorialUnitName)(analysis.admin)}·${(0, dependencies.countryName)(analysis.country)} 해안선 정합`,
        affectedIds: [adminIdKey, countryId],
      });
      if (decision.direction === 'admin-to-country') {
        analysis.country.geometry = nextCountry;
        dependencies.state.historyDirtyCountryIds.add(countryId);
        (0, dependencies.reconcileTerritorialUnitCompleteness)([countryId], { preserveIds: [adminIdKey] });
      } else {
        analysis.admin.geometry = nextAdmin;
        (0, dependencies.reconcileTerritorialUnitCompleteness)([countryId]);
      }
      (0, dependencies.normalizeProjectObjects)();
      (0, dependencies.assertCurrentProjectReferences)();
      (0, dependencies.markLayerTreeDirty)();
      dependencies.renderingDomain?.invalidateCountryPatch?.('admin-country-coast-reconciled');
      dependencies.projectDomain.queueAutosave();
      (0, dependencies.setActionStatus)(decision.direction === 'admin-to-country' ? '하위단위 해안선을 기준으로 국가 해안선을 조정했습니다.' : '국가 해안선을 기준으로 하위단위 해안선을 조정했습니다.', 'success', 4200);
      return { ok: true, changed: true, direction: decision.direction };
    } catch (error) {
      analysis.country.geometry = countryBefore;
      analysis.admin.geometry = adminBefore;
      (0, dependencies.restoreEditable)(snapshot);
      (0, dependencies.reportOperationError)(error, '해안선 정합을 적용하지 못했습니다.', 'PL-COAST-RECONCILE-001', 4400);
      return { ok: false, error };
    }
  }

  async function resetProjectInPlace({ projectGeneration = null, skipRenderReset = false, prepared = null } = {}) {
    closeConfirmModal();
    (0, dependencies.closeMobileSheets)();
    const nextProjectGeneration = skipRenderReset && Number.isFinite(projectGeneration)
      ? projectGeneration
      : dependencies.projectDomain
        ? dependencies.projectDomain.resetRenderGeneration('project-reset')
        : dependencies.gpuMapRenderer.resetProjectRenderState?.();
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
    dependencies.state.countriesData = (0, dependencies.reindexCountries)(prepared, false, { assumeCanonical: true });
    (0, dependencies.applyFreshBuiltinClassification)();
    (0, dependencies.applyPristineLabelAnchors)(dependencies.state.countriesData);
    dependencies.state.auditPreviewCountries = null;
    (0, dependencies.pruneLayerItemVisibility)();
    (0, dependencies.markLayerTreeDirty)();
    (0, dependencies.configureDatasetSession)(null);
    (0, dependencies.scheduleGpuMeshRebuild)(0, nextProjectGeneration);
    const expectedCountries = (0, dependencies.classifyBuiltinCountries)({ ...prepared, features: prepared.features }).countries;
    const expectedById = new Map(expectedCountries.features.map(feature => [String(feature.id), feature]));
    const restoredExactly = dependencies.canonicalCountryStore
      ? dependencies.state.countriesData.features.length === expectedCountries.features.length
        && dependencies.state.countriesData.features.every(feature => JSON.stringify(feature.geometry) === JSON.stringify(expectedById.get(String(feature.id))?.geometry))
        && dependencies.state.territorialUnits.every(feature => dependencies.canonicalCountryStore.geometryEquals((0, dependencies.builtinSubunitSourceId)(feature), feature.geometry))
      : true;
    if (!restoredExactly) {
      throw new Error('내장 원본 국경 복원 검증에 실패했습니다.');
    }
    (0, dependencies.refreshCountryCentroids)();
    dependencies.state.boundaryTopology = { edges: new Map(), nodes: new Map() };

    (0, dependencies.$)('countriesVisible').checked = true;
    (0, dependencies.$)('subunitsVisible').checked = true;
    (0, dependencies.$)('regionsVisible').checked = true;
    (0, dependencies.$)('languagesVisible').checked = true;
    (0, dependencies.$)('ethnicitiesVisible').checked = true;
    (0, dependencies.$)('religionsVisible').checked = true;
    (0, dependencies.$)('riversVisible').checked = true;
    (0, dependencies.$)('lakesVisible').checked = true;
    (0, dependencies.$)('genericFeaturesVisible').checked = true;
    (0, dependencies.$)('labelsVisible').checked = true;
    (0, dependencies.$)('basemapLabelsVisible').checked = true;
    (0, dependencies.$)('countryFlagsVisible').checked = dependencies.state.layerVisibility.countryFlags !== false;
    (0, dependencies.syncPhysicalControls)();
    if ((0, dependencies.$)('layerSearchInput')) (0, dependencies.$)('layerSearchInput').value = '';
    dependencies.layerTreeController?.render(true);
    (0, dependencies.syncProjectionButtons)();
    dependencies.objectPropertyController.show(null);
    (0, dependencies.$)('selectionStatus').textContent = '';
    dependencies.editingDomain?.setTool('select', { announce: false });

    // 기존 SVG 노드는 편집된 Feature 객체를 __data__로 들고 있을 수 있으므로 완전히 제거 후 원본으로 재바인딩한다.
    dependencies.countryLayer?.selectAll('*').remove();
    dependencies.countryLabelLayer?.selectAll('*').remove();
    dependencies.boundaryEditLayer?.selectAll('*').remove();
    dependencies.territorialUnitLayer?.selectAll('*').remove();
    dependencies.distributionLayer?.selectAll('*').remove();
    dependencies.vertexLayer?.selectAll('*').remove();
    dependencies.genericFeatureLayer?.selectAll('*').remove();
    dependencies.labelLayer?.selectAll('*').remove();

    (0, dependencies.syncMapHostFromState)();
    (0, dependencies.resizeMap)();
    (0, dependencies.scheduleMapObjectSpatialIndexRebuild)();
    dependencies.projectUi.syncHistory();
    (0, dependencies.setActionStatus)('새 프로젝트를 만들었습니다.', 'success', 3200);
  }

  function initializeConfirmModalController() {
    (confirmModalController = null);

    (coastReconciliationController = null);

    (openConfirmModal = options => getConfirmModalController()
      .then(controller => controller.open(options))
      .catch(error => (0, dependencies.reportOperationError)(error, '확인 창을 불러오지 못했습니다.', 'PL-MODAL-001')));

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
