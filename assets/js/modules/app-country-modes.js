/** CountryModes: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createCountryModes() {
  let dependencies;
  let hydroToolConfig;
  let draftToolConfig;
  let emptyDraftSession;
  let editingDraftSnapshot;
  let editingDraftCoordinates;
  let dispatchEditingInteraction;
  function connect(ports) {
    if (dependencies) throw new Error('country-modes already connected');
    dependencies = ports;
  }

  function resetMergeState() {
    dependencies.state.mergeSourceCountryId = null;
    dependencies.state.mergeTargetCountryIds = [];
  }

  function resetGenericFeatureMergeState() {
    dependencies.state.genericFeatureMergeSourceId = null;
    dependencies.state.genericFeatureMergeTargetIds = [];
  }

  function resetTerritorialUnitEditState() {
    if (dependencies.state.territorySelectionSession?.tool === 'draw-territorial-unit') {
      (0, dependencies.clearTerritorySelection)({ discardPreview: true, refreshUi: false });
    }
    dependencies.state.territorialUnitMergeSourceId = null;
    dependencies.state.territorialUnitMergeTargetIds = [];
    dependencies.state.territorialUnitSplitSourceId = null;
    dependencies.state.territorialUnitSplitVirtualSource = null;
    dependencies.state.territorialUnitRedrawSourceId = null;
    dependencies.state.multiDraft = null;
  }

  function draftMinimumPoints() {
    return (0, dependencies.isPolygonDraftTool)(dependencies.state.tool) ? 3 : 2;
  }

  function resetTerritoryEditingState(invalidateInteraction = true) {
    dependencies.editingDomain?.clearDraft?.(invalidateInteraction);
    if (dependencies.state.territorySelectionSession) {
      (0, dependencies.clearTerritorySelection)({ discardPreview: true, refreshUi: false });
      return;
    }
  }

  function resetBoundaryEditState() {
    dependencies.state.boundaryEditCountryIds = [];
    dependencies.state.boundaryEditPhase = null;
    dependencies.state.boundaryEditInitialSelection = null;
    dependencies.state.boundaryEditSeedCountryId = null;
  }

  function enterTerrainGenericFeatureMode(tool) {
    const config = hydroToolConfig(tool);
    if (!config) return false;
    (0, dependencies.clearNotification)();
    dependencies.selectionUiController.clear({ reason: 'tool-mode-selection-clear' });
    resetTerritoryEditingState(true);
    dependencies.state.coastEditCountryId = null;
    resetMergeState();
    dependencies.state.multiDraft = { kind: 'hydro', category: config.category, shape: config.category === 'lake' ? 'polygon' : 'line', parts: [], current: null };
    dependencies.editingDomain?.setTool(tool, { announce: false });
    (0, dependencies.setModeBanner)((0, dependencies.defaultDraftInstruction)());
    (0, dependencies.updateModeButtons)();
    return true;
  }

  function enterNewCountryMode() {
    (0, dependencies.clearNotification)();
    dependencies.selectionUiController.clear({ reason: 'new-country-selection-clear' });
    return !!(0, dependencies.startTerritorySelection)('new-country', {
      tool: 'new-country', name: '새 국가', sourceCountryIds: [],
    });
  }

  function enterAnnexTerritoryMode(id) {
    if (!dependencies.planDrawnTerritoryAnnex || !dependencies.composeRiverBoundaryTerritoryComponents) {
      (0, dependencies.setActionStatus)('영토 편입 도구를 준비하는 중입니다.', 'working', 0);
      void (0, dependencies.ensureGisRuntime)()
        .then(() => enterAnnexTerritoryMode(id))
        .catch(error => (0, dependencies.reportOperationError)(error, '영토 편입 도구를 불러오지 못했습니다.', 'PL-GIS-LAZY-001', 4200));
      return true;
    }
    (0, dependencies.clearNotification)();
    const feature = (0, dependencies.countryFeatureById)(id);
    if (!feature) return false;
    if (!(0, dependencies.requireCountriesUnlocked)([id], '영토 편입을 시작')) return false;
    const current = (0, dependencies.startTerritorySelection)('annex', {
      tool: 'annex-territory', targetCountryId: String(id), sourceCountryIds: [],
    });
    if (!current) return false;
    (0, dependencies.syncCountryActionButtons)();
    dependencies.renderingDomain?.invalidateEditingOverlays?.('annex-target-selected');
    (0, dependencies.setModeBanner)('가져올 국가를 선택하세요.');
    (0, dependencies.updateModeButtons)();
    return true;
  }

  function validateAnnexSelectionSetup(session) {
    const targetId = String(session?.targetCountryId || '');
    return !!targetId && !!(0, dependencies.countryFeatureById)(targetId)
      && Array.isArray(session.sourceCountryIds) && session.sourceCountryIds.length > 0
      && session.sourceCountryIds.every(sourceId => String(sourceId) !== targetId && !!(0, dependencies.countryFeatureById)(sourceId));
  }

  function validateNewCountrySelectionSetup(session) {
    return !!session?.name?.trim() && Array.isArray(session.sourceCountryIds) && session.sourceCountryIds.length > 0
      && session.sourceCountryIds.every(sourceId => !!(0, dependencies.countryFeatureById)(sourceId));
  }

  function prepareCountrySelectionSource(session, operationLabel) {
    const ids = session.sourceCountryIds.map(String);
    const lockIds = session.kind === 'annex' ? [session.targetCountryId, ...ids] : ids;
    if (!(0, dependencies.requireCountriesUnlocked)(lockIds, operationLabel)) return false;
    try {
      const sourceGeometry = (0, dependencies.selectedCountryUnionGeometry)(ids);
      if (!sourceGeometry) return false;
      session.baseSourceGeometry = (0, dependencies.deepClone)(sourceGeometry);
      session.workingSourceGeometry = (0, dependencies.deepClone)(sourceGeometry);
      session.remainingGeometry = (0, dependencies.deepClone)(sourceGeometry);
      session.sourceRevision += 1;
      session.componentFeatures = ids
        .map(id => (0, dependencies.countryFeatureById)(id))
        .filter(Boolean)
        .map(feature => (0, dependencies.deepClone)(feature));
      if (session.method !== 'components') {
        dependencies.editingDomain?.startDraft?.({ coords: [] });
        (0, dependencies.setModeBanner)((0, dependencies.defaultDraftInstruction)());
      }
      return true;
    } catch (error) {
      (0, dependencies.reportOperationError)(error, '선택한 국가의 영토를 준비할 수 없습니다. 대상을 다시 선택하세요.', 'PL-TERRITORY-SELECTION-002', 3800);
      return false;
    }
  }

  function prepareAnnexSelection(session) {
    return validateAnnexSelectionSetup(session) && prepareCountrySelectionSource(session, '영토 편입을 시작');
  }

  function prepareNewCountrySelection(session) {
    return validateNewCountrySelectionSetup(session) && prepareCountrySelectionSource(session, '새 국가 분리 작업을 시작');
  }

  function selectionSessionSnapshot() {
    const snapshot = dependencies.selectionDomain.snapshot().selection;
    return {
      primaryKey: snapshot.primaryKey,
      items: snapshot.items.map(ref => ({ domain: ref.domain, type: ref.type, id: ref.id })),
    };
  }

  function enterCountryBorderSelection(id) {
    (0, dependencies.clearNotification)();
    const feature = (0, dependencies.countryFeatureById)(id);
    if (!feature) return false;
    if (!(0, dependencies.requireCountriesUnlocked)([id], '국경 조정 대상을 선택')) return false;
    const initialSelection = selectionSessionSnapshot();
    if (!dependencies.editingDomain?.setTool('country-border', { announce: false })) return false;
    dependencies.state.boundaryEditCountryIds = [String(id)];
    dependencies.state.boundaryEditPhase = 'selecting';
    dependencies.state.boundaryEditInitialSelection = initialSelection;
    dependencies.state.boundaryEditSeedCountryId = String(id);
    dependencies.selectionUiController.replaceMany(dependencies.state.boundaryEditCountryIds.map(dependencies.countryObjectRef), {
      primary: (0, dependencies.countryObjectRef)(id), scope: 'map', reason: 'boundary-edit-selection', present: false,
    });
    (0, dependencies.rebuildBoundaryTopology)(dependencies.state.boundaryEditCountryIds);
    (0, dependencies.setModeBanner)(`${(0, dependencies.countryName)(feature)}와 접한 국가를 선택하세요.`);
    dependencies.renderingDomain?.invalidateGpuInteraction?.('country-border-selection');
    (0, dependencies.updateModeButtons)();
    return true;
  }

  function enterCountryBorderEditFromSelection() {
    (0, dependencies.clearNotification)();
    const snapshot = selectionSessionSnapshot();
    const refs = dependencies.selectionDomain.snapshot().selection.items;
    const ids = refs.filter(ref => ref.domain === 'territorial' && ref.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY).map(ref => ref.id);
    if (ids.length !== refs.length || ids.length < 2) {
      (0, dependencies.setActionStatus)('국가를 2개 이상 선택하세요', 'error', 3200);
      return false;
    }
    if (!(0, dependencies.requireCountriesUnlocked)(ids, '국경 조정을 시작')) return false;
    const analysis = (0, dependencies.boundaryEditSelectionAnalysis)(ids, { rebuild: true });
    if (!analysis.valid) {
      (0, dependencies.setActionStatus)(analysis.message, 'error', 3800);
      return false;
    }
    if (!dependencies.editingDomain?.setTool('country-border', { announce: false })) return false;
    dependencies.state.boundaryEditCountryIds = analysis.selectedIds;
    dependencies.state.boundaryEditPhase = 'editing';
    dependencies.state.boundaryEditInitialSelection = snapshot;
    dependencies.state.boundaryEditSeedCountryId = analysis.selectedIds[0];
    dependencies.selectionUiController.replaceMany(analysis.selectedIds.map(dependencies.countryObjectRef), {
      primary: (0, dependencies.countryObjectRef)(analysis.selectedIds.at(-1)), scope: 'map', reason: 'boundary-edit-selection', present: false,
    });
    (0, dependencies.rebuildBoundaryTopology)(analysis.selectedIds);
    (0, dependencies.setModeBanner)('공유국경 꼭짓점을 드래그하세요. 외부 접점은 고정됩니다.');
    dependencies.renderingDomain?.invalidateGpuInteraction?.('country-border-edit-selection');
    (0, dependencies.updateModeButtons)();
    return true;
  }

  function boundaryNeighborIds(selectedCountryIds = dependencies.state.boundaryEditCountryIds) {
    const selected = new Set(selectedCountryIds.map(String));
    const neighbors = new Set();
    for (const segment of dependencies.state.sharedBoundaryTopology?.segments?.values?.() || []) {
      if (segment.kind !== 'shared') continue;
      const owners = [...segment.ownerIds].map(String);
      if (!owners.some(id => selected.has(id))) continue;
      for (const id of owners) if (!selected.has(id)) neighbors.add(id);
    }
    return neighbors;
  }

  function toggleBoundaryEditCountry(id) {
    if (dependencies.state.tool !== 'country-border' || dependencies.state.boundaryEditPhase !== 'selecting') return false;
    const countryId = String(id || '');
    if (!(0, dependencies.countryFeatureById)(countryId)) return false;
    const selected = new Set(dependencies.state.boundaryEditCountryIds.map(String));
    if (selected.has(countryId)) {
      if (countryId === dependencies.state.boundaryEditSeedCountryId) {
        (0, dependencies.setActionStatus)('시작 국가는 대상 선택 단계에서 해제할 수 없습니다.', 'error', 2800);
        return false;
      }
      selected.delete(countryId);
    } else {
      (0, dependencies.rebuildBoundaryTopology)([...selected]);
      if (!boundaryNeighborIds([...selected]).has(countryId)) {
        (0, dependencies.setActionStatus)('현재 선택 집합과 실제 국경을 맞댄 국가만 추가할 수 있습니다.', 'error', 3200);
        return false;
      }
      selected.add(countryId);
    }
    dependencies.state.boundaryEditCountryIds = [...selected];
    dependencies.selectionUiController.replaceMany(dependencies.state.boundaryEditCountryIds.map(dependencies.countryObjectRef), {
      primary: (0, dependencies.countryObjectRef)(countryId), scope: 'map', reason: 'boundary-edit-selection', present: false,
    });
    const analysis = (0, dependencies.boundaryEditSelectionAnalysis)(dependencies.state.boundaryEditCountryIds, { rebuild: true });
    (0, dependencies.setModeBanner)(analysis.valid
      ? `${analysis.selectedIds.length}개 국가 선택됨 · 완료하면 공유국경을 편집합니다.`
      : analysis.message);
    dependencies.renderingDomain?.invalidateGpuInteraction?.('country-border-country-toggle');
    (0, dependencies.updateModeButtons)();
    return true;
  }

  function beginCountryBorderEditing() {
    if (dependencies.state.tool !== 'country-border' || dependencies.state.boundaryEditPhase !== 'selecting') return false;
    if (!(0, dependencies.requireCountriesUnlocked)(dependencies.state.boundaryEditCountryIds, '국경 조정을 시작')) return false;
    const analysis = (0, dependencies.boundaryEditSelectionAnalysis)(dependencies.state.boundaryEditCountryIds, { rebuild: true });
    if (!analysis.valid) {
      (0, dependencies.setActionStatus)(analysis.message, 'error', 3400);
      return false;
    }
    dependencies.state.boundaryEditCountryIds = analysis.selectedIds;
    dependencies.state.boundaryEditPhase = 'editing';
    (0, dependencies.rebuildBoundaryTopology)(analysis.selectedIds);
    (0, dependencies.setModeBanner)('공유국경 꼭짓점을 드래그하세요. 외부 접점은 고정됩니다.');
    dependencies.renderingDomain?.invalidateGpuInteraction?.('country-border-edit-start');
    (0, dependencies.updateModeButtons)();
    return true;
  }

  function finishCountryBorderEdit() {
    if (dependencies.state.tool !== 'country-border') return false;
    const ids = dependencies.state.boundaryEditCountryIds.slice();
    const primaryId = (dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) && ids.includes(String(dependencies.state.selected.id)) ? String(dependencies.state.selected.id) : ids.at(-1);
    dependencies.editingDomain?.setTool('select', { announce: false });
    dependencies.state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    dependencies.state.sharedBoundaryTopology = { segments: new Map(), nodes: new Map() };
    dependencies.selectionUiController.replaceMany(ids.map(dependencies.countryObjectRef), {
      primary: (0, dependencies.countryObjectRef)(primaryId), scope: 'map', reason: 'boundary-edit-commit', present: true,
    });
    dependencies.projectDomain.queueAutosave();
    (0, dependencies.setActionStatus)(`${ids.length}개 국가 사이의 공유국경 조정을 완료했습니다.`, 'success');
    return true;
  }

  function enterCountryCoastEdit(id, { scopeGenericFeatureId = null, returnSelection = null } = {}) {
    (0, dependencies.clearNotification)();
    const feature = (0, dependencies.countryFeatureById)(id);
    if (!feature) return false;
    if (!(0, dependencies.requireCountriesUnlocked)([id], '해안선 조정을 시작')) return false;
    (0, dependencies.rebuildBoundaryTopology)(id);
    dependencies.state.coastEditCountryId = String(id);
    dependencies.state.coastEditScopeGenericFeatureId = scopeGenericFeatureId ? String(scopeGenericFeatureId) : null;
    dependencies.state.coastEditReturnSelection = returnSelection ? (0, dependencies.deepClone)(returnSelection) : null;
    dependencies.editingDomain?.setTool('country-coast', { announce: false });
    dependencies.state.coastEditCountryId = String(id);
    dependencies.state.coastEditScopeGenericFeatureId = scopeGenericFeatureId ? String(scopeGenericFeatureId) : null;
    dependencies.state.coastEditReturnSelection = returnSelection ? (0, dependencies.deepClone)(returnSelection) : null;
    (0, dependencies.rebuildBoundaryTopology)(id);
    (0, dependencies.syncCountryActionButtons)();
    (0, dependencies.setModeBanner)(scopeGenericFeatureId
      ? '해안선 꼭짓점을 드래그하세요. 연결 영역도 함께 변경됩니다.'
      : '해안선 꼭짓점을 드래그하세요. 국경 접점은 고정됩니다.');
    return true;
  }

  function finishCountryCoastEdit() {
    const id = dependencies.state.coastEditCountryId;
    if (!id) return;
    const feature = (0, dependencies.countryFeatureById)(id);
    const returnSelection = dependencies.state.coastEditReturnSelection ? (0, dependencies.deepClone)(dependencies.state.coastEditReturnSelection) : null;
    dependencies.editingDomain?.setTool('select', { announce: false });
    dependencies.state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    dependencies.state.sharedBoundaryTopology = { segments: new Map(), nodes: new Map() };
    dependencies.state.coastEditScopeGenericFeatureId = null;
    dependencies.state.coastEditReturnSelection = null;
    if (returnSelection?.type === 'generic' && dependencies.state.genericFeatures.some(item => String(item.id) === String(returnSelection.id))) (0, dependencies.applyGenericSelectionIntent)(String(returnSelection.id), true);
    else if (feature) (0, dependencies.applyCountrySelectionIntent)(id, true);
    dependencies.projectDomain.queueAutosave();
    (0, dependencies.setActionStatus)(`${feature ? (0, dependencies.countryName)(feature) : '국가'}의 해안선을 조정했습니다.`, 'success');
  }

  function enterMergeCountryMode(id) {
    (0, dependencies.clearNotification)();
    const feature = (0, dependencies.countryFeatureById)(id);
    if (!feature) return false;
    if (!(0, dependencies.requireCountriesUnlocked)([id], '국가 합병을 시작')) return false;
    dependencies.state.mergeSourceCountryId = String(id);
    dependencies.state.mergeTargetCountryIds = [];
    dependencies.editingDomain?.setTool('merge-country', { announce: false });
    dependencies.state.mergeSourceCountryId = String(id);
    dependencies.state.mergeTargetCountryIds = [];
    (0, dependencies.setModeBanner)('합병할 국가를 선택하세요.');
    (0, dependencies.syncCountryActionButtons)();
    (0, dependencies.updateModeButtons)();
    return true;
  }

  function toggleMergeTarget(id) {
    const sourceId = String(dependencies.state.mergeSourceCountryId || '');
    const targetId = String(id || '');
    if (dependencies.state.tool !== 'merge-country' || !sourceId) return;
    if (!targetId || targetId === sourceId) {
      (0, dependencies.setActionStatus)('기준 국가 외 합병 대상을 선택하세요', 'error', 3200);
      return;
    }
    if (!(0, dependencies.countryFeatureById)(targetId)) {
      (0, dependencies.setActionStatus)('합병 대상을 찾을 수 없습니다. 지도에 표시된 다른 국가를 선택하세요.', 'error', 3200);
      return;
    }
    const selected = new Set(dependencies.state.mergeTargetCountryIds.map(String));
    if (selected.has(targetId)) selected.delete(targetId);
    else selected.add(targetId);
    dependencies.state.mergeTargetCountryIds = [...selected];
    dependencies.renderingDomain?.invalidateEditingOverlays?.('merge-country-target-selection-changed');
    (0, dependencies.setModeBanner)('합병할 국가를 선택하세요.');
    (0, dependencies.updateModeButtons)();
  }

  function cancelActiveMode(announce = true) {
    const cancelledTool = dependencies.state.tool;
    const boundarySelectionSnapshot = dependencies.state.boundaryEditInitialSelection;
    dependencies.mapEditClient.cancel();
    const selectedTerritorialUnitId = dependencies.state.territorialUnitSplitSourceId || dependencies.state.territorialUnitMergeSourceId
      || ((dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type !== dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) ? dependencies.state.selected.id : null);
    const selectedGenericFeatureId = dependencies.state.genericFeatureSplitSourceId || dependencies.state.genericFeatureMergeSourceId
      || (dependencies.state.coastEditReturnSelection?.type === 'generic' ? dependencies.state.coastEditReturnSelection.id : null);
    const selectedId = dependencies.state.territorySelectionSession?.targetCountryId
      || dependencies.state.coastEditCountryId
      || dependencies.state.mergeSourceCountryId
      || ((dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) ? dependencies.state.selected.id : null);
    resetTerritoryEditingState(true);
    dependencies.state.coastEditCountryId = null;
    dependencies.state.coastEditScopeGenericFeatureId = null;
    dependencies.state.coastEditReturnSelection = null;
    resetBoundaryEditState();
    resetMergeState();
    resetGenericFeatureMergeState();
    resetTerritorialUnitEditState();
    dependencies.state.genericFeatureSplitSourceId = null;
    dependencies.editingDomain?.setTool('select', { announce: false });
    dependencies.state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    dependencies.state.sharedBoundaryTopology = { segments: new Map(), nodes: new Map() };
    if (cancelledTool === 'country-border' && boundarySelectionSnapshot) dependencies.selectionUiController.restore(boundarySelectionSnapshot);
    else if (selectedGenericFeatureId && dependencies.state.genericFeatures.some(item => String(item.id) === String(selectedGenericFeatureId))) (0, dependencies.applyGenericSelectionIntent)(String(selectedGenericFeatureId), true);
    else if (selectedTerritorialUnitId && (0, dependencies.territorialUnitById)(selectedTerritorialUnitId)) (0, dependencies.applyTerritorialUnitSelectionIntent)(String(selectedTerritorialUnitId), true);
    else if (selectedId && (0, dependencies.countryFeatureById)(selectedId)) (0, dependencies.applyCountrySelectionIntent)(selectedId, true);
    // Country tool highlighting lives in the GPU scene rather than the draft overlay.
    // Rebuild that scene on cancellation so its translucent fills do not remain until
    // the next camera movement triggers a full country presentation pass.
    if (['annex-territory', 'new-country', 'draw-territorial-unit', 'merge-country'].includes(cancelledTool)) {
      dependencies.renderingDomain?.invalidateCountryPatch?.('active-mode-cancelled');
    } else {
      dependencies.renderingDomain?.invalidateEditingOverlays?.('active-mode-cancelled');
    }
    const labels = { 'new-country': '국가 추가', 'annex-territory': '영토 편입', 'merge-country': '국가 합병', 'merge-generic-feature': '영역 합치기', 'split-generic-feature': '영역 나누기', 'merge-territorial-unit': '영역 합치기', 'split-territorial-unit': '영역 나누기', 'country-border': '국경 조정', 'country-coast': '해안선 조정' };
    if (announce) (0, dependencies.setActionStatus)(`${labels[cancelledTool] || '지도 작업'}을 취소했습니다.`, 'success');
  }

  function enterLabelMode() {
    (0, dependencies.clearNotification)();
    resetTerritoryEditingState(true);
    dependencies.state.coastEditCountryId = null;
    resetMergeState();
    dependencies.state.tool = 'label';
    dependencies.state.labelPlacementMode = true;
    (0, dependencies.setCurrentTool)('지명 추가');
    (0, dependencies.$)('map').classList.add('generic-feature-mode');
    (0, dependencies.$)('map').classList.remove('select-mode');
    (0, dependencies.setModeBanner)('지명을 배치할 위치를 선택하세요.');
    (0, dependencies.syncMobileNavigation)();
    (0, dependencies.updateModeButtons)();
    return true;
  }

  function exitLabelMode(announce = true) {
    dependencies.state.labelPlacementMode = false;
    dependencies.state.tool = 'select';
    (0, dependencies.$)('map').classList.remove('generic-feature-mode');
    (0, dependencies.$)('map').classList.add('select-mode');
    (0, dependencies.setModeBanner)();
    (0, dependencies.setCurrentTool)('국가 선택');
    (0, dependencies.syncMobileNavigation)();
    (0, dependencies.updateModeButtons)();
    if (announce) (0, dependencies.setActionStatus)('지명 추가를 취소했습니다.', 'success');
  }

  function initializeHydroToolConfig() {
    (hydroToolConfig = tool => dependencies.HYDRO_TOOL_CONFIG[tool] || null);

    (draftToolConfig = tool => (0, dependencies.toolDraftDefinition)(tool, dependencies.state));
  }

  function initializeEmptyDraftSession() {
    (emptyDraftSession = Object.freeze({
      coords: Object.freeze([]), hover: null, inputPhase: 'draw', vertexInsertMode: false, selectedVertexIndex: null,
      insertTarget: null, dragging: false, issues: Object.freeze([]), historyCount: 0,
      futureCount: 0, strokeActive: false, cutAssessment: null, activeSnap: null,
    }));

    (editingDraftSnapshot = () => dependencies.editingDomain?.snapshot?.().draft || emptyDraftSession);

    (editingDraftCoordinates = () => editingDraftSnapshot().coords);

    (dispatchEditingInteraction = (type, detail = {}) => {
      const currentPacket = dependencies.editingDomain?.createRenderPacket?.();
      if (!currentPacket) return false;
      return dependencies.editingDomain.handleInteraction({
        type,
        projectGeneration: currentPacket.projectGeneration,
        packetRevision: currentPacket.revision,
        ...detail,
      });
    });
  }

  return Object.freeze({
    connect,
    initializeHydroToolConfig,
    initializeEmptyDraftSession,
    get beginCountryBorderEditing() { return beginCountryBorderEditing; },
    get cancelActiveMode() { return cancelActiveMode; },
    get dispatchEditingInteraction() { return dispatchEditingInteraction; },
    get draftMinimumPoints() { return draftMinimumPoints; },
    get draftToolConfig() { return draftToolConfig; },
    get editingDraftCoordinates() { return editingDraftCoordinates; },
    get editingDraftSnapshot() { return editingDraftSnapshot; },
    get enterAnnexTerritoryMode() { return enterAnnexTerritoryMode; },
    get enterCountryBorderEditFromSelection() { return enterCountryBorderEditFromSelection; },
    get enterCountryBorderSelection() { return enterCountryBorderSelection; },
    get enterCountryCoastEdit() { return enterCountryCoastEdit; },
    get enterLabelMode() { return enterLabelMode; },
    get enterMergeCountryMode() { return enterMergeCountryMode; },
    get enterNewCountryMode() { return enterNewCountryMode; },
    get enterTerrainGenericFeatureMode() { return enterTerrainGenericFeatureMode; },
    get exitLabelMode() { return exitLabelMode; },
    get finishCountryBorderEdit() { return finishCountryBorderEdit; },
    get finishCountryCoastEdit() { return finishCountryCoastEdit; },
    get hydroToolConfig() { return hydroToolConfig; },
    get resetBoundaryEditState() { return resetBoundaryEditState; },
    get resetGenericFeatureMergeState() { return resetGenericFeatureMergeState; },
    get resetMergeState() { return resetMergeState; },
    get resetTerritorialUnitEditState() { return resetTerritorialUnitEditState; },
    get resetTerritoryEditingState() { return resetTerritoryEditingState; },
    get toggleBoundaryEditCountry() { return toggleBoundaryEditCountry; },
    get toggleMergeTarget() { return toggleMergeTarget; },
    get prepareAnnexSelection() { return prepareAnnexSelection; },
    get prepareNewCountrySelection() { return prepareNewCountrySelection; },
    get validateAnnexSelectionSetup() { return validateAnnexSelectionSetup; },
    get validateNewCountrySelectionSetup() { return validateNewCountrySelectionSetup; },
  });
}
