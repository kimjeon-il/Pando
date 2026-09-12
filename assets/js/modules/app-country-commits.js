/** CountryCommits: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createCountryCommits() {
  let dependencies;
  let annexPreviewTimer = null;
  let annexPreviewGeneration = 0;

  function connect(ports) {
    if (dependencies) throw new Error('country-commits already connected');
    dependencies = ports;
  }

  function annexPreviewSignature() {
    return JSON.stringify({
      phase: dependencies.state.annexPhase,
      targetId: dependencies.state.annexTargetCountryId,
      donorIds: dependencies.state.annexDonorCountryIds.map(String).sort(),
      candidateIndex: dependencies.state.annexSelectedCandidateIndex,
      componentKeys: dependencies.state.annexSelectedComponentKeys.map(String).sort(),
      riverStatus: dependencies.state.annexRiverPartitionStatus,
      usesRiverBoundaries: dependencies.state.annexUseRiverBoundaries,
      generation: annexPreviewGeneration,
    });
  }

  function cancelScheduledAnnexPreview({ discard = true } = {}) {
    annexPreviewGeneration += 1;
    if (annexPreviewTimer !== null) {
      clearTimeout(annexPreviewTimer);
      annexPreviewTimer = null;
    }
    dependencies.state.annexPreviewPending = false;
    if (discard) dependencies.discardActiveGeometryPreview?.({ announce: false });
    (0, dependencies.updateModeButtons)();
  }

  function currentAnnexPreviewCandidateIndex() {
    if (dependencies.state.annexPhase === 'components') return null;
    if (dependencies.state.annexPhase === 'polygon-preview') return 0;
    return dependencies.state.annexSelectedCandidateIndex;
  }

  function annexPreviewIsReady() {
    if (dependencies.state.tool !== 'annex-territory') return false;
    if (dependencies.state.annexPhase === 'components') {
      return (!dependencies.state.annexUseRiverBoundaries || dependencies.state.annexRiverPartitionStatus === 'ready')
        && dependencies.state.annexSelectedComponentKeys.length > 0;
    }
    return ['side', 'polygon-preview'].includes(dependencies.state.annexPhase)
      && !!dependencies.state.annexDrawnGeometry;
  }

  // Prepared only when the selection changes, never in a render frame.
  function refreshAnnexDrawnSelection(candidateIndex = currentAnnexPreviewCandidateIndex()) {
    const state = dependencies.state;
    const accumulated = state.annexDrawnSelections?.at(-1)?.combinedGeometry || null;
    const current = Number.isInteger(candidateIndex) ? state.annexCandidates[candidateIndex]?.geometry : null;
    const coordinates = dependencies.geometryMultiCoordinates;
    const normalize = dependencies.normalizeClippedLandGeometry;
    state.annexDrawnGeometry = null;
    state.annexRemainingGeometry = null;
    if (!current) {
      state.annexDrawnGeometry = accumulated;
      state.annexRemainingGeometry = state.annexSourceGeometry;
      return true;
    }
    try {
      const combined = accumulated
        ? normalize(window.polygonClipping.union(coordinates(accumulated), coordinates(current)))
        : current;
      const remaining = normalize(window.polygonClipping.difference(coordinates(state.annexSourceGeometry), coordinates(current)));
      state.annexDrawnGeometry = combined;
      state.annexRemainingGeometry = remaining;
      return true;
    } catch (error) {
      (0, dependencies.reportOperationError)(error, '선택한 영역을 합칠 수 없습니다. 선택을 조정하세요.', 'PL-ANNEX-001', 3800);
      return false;
    }
  }

  function addAnnexDrawnSelection() {
    const state = dependencies.state;
    if (state.tool !== 'annex-territory' || !['side', 'polygon-preview'].includes(state.annexPhase)
      || dependencies.editingDraftSnapshot().strokeActive) return false;
    if (!refreshAnnexDrawnSelection() || !state.annexDrawnGeometry || !state.annexRemainingGeometry) return false;
    cancelScheduledAnnexPreview({ discard: true });
    const current = state.annexCandidates[state.annexSelectedCandidateIndex]?.geometry;
    if (current) {
      state.annexDrawnSelections.push({
        geometry: current,
        combinedGeometry: state.annexDrawnGeometry,
        sourceGeometry: state.annexSourceGeometry,
      });
      state.annexSourceGeometry = state.annexRemainingGeometry;
    }
    state.annexCandidates = [];
    state.annexSelectedCandidateIndex = null;
    state.annexComponentIndex = null;
    state.annexPhase = state.annexSelectionMethod === 'polygon' ? 'polygon' : 'line';
    dependencies.editingDomain?.startDraft?.({ coords: [] });
    (0, dependencies.setModeBanner)((0, dependencies.defaultDraftInstruction)());
    dependencies.renderingDomain?.invalidateEditingOverlays?.('annex-drawn-add');
    (0, dependencies.updateModeButtons)();
    return true;
  }

  function undoAnnexDrawnSelection() {
    const state = dependencies.state;
    if (state.tool !== 'annex-territory' || !['line', 'polygon', 'side', 'polygon-preview'].includes(state.annexPhase)
      || dependencies.editingDraftSnapshot().strokeActive) return false;
    const current = state.annexCandidates[state.annexSelectedCandidateIndex]?.geometry;
    if (!current && !state.annexDrawnSelections?.length) return false;
    cancelScheduledAnnexPreview({ discard: true });
    if (!current) state.annexSourceGeometry = state.annexDrawnSelections.pop().sourceGeometry;
    state.annexCandidates = [];
    state.annexSelectedCandidateIndex = null;
    state.annexComponentIndex = null;
    const polygon = state.annexSelectionMethod === 'polygon';
    state.annexPhase = state.annexDrawnSelections.length ? (polygon ? 'polygon-preview' : 'side') : (polygon ? 'polygon' : 'line');
    dependencies.editingDomain?.startDraft?.({ coords: [] });
    (0, dependencies.setModeBanner)(state.annexDrawnSelections.length ? '선택한 영역을 확인하세요.' : (0, dependencies.defaultDraftInstruction)());
    scheduleAnnexGeometryPreview();
    dependencies.renderingDomain?.invalidateEditingOverlays?.('annex-drawn-undo');
    (0, dependencies.updateModeButtons)();
    return true;
  }

  function scheduleAnnexGeometryPreview({ delay = 300 } = {}) {
    cancelScheduledAnnexPreview({ discard: true });
    if (dependencies.state.tool === 'annex-territory' && dependencies.state.annexSelectionMethod !== 'components'
      && !refreshAnnexDrawnSelection()) return false;
    if (!annexPreviewIsReady()) return false;
    const signature = annexPreviewSignature();
    dependencies.state.annexPreviewPending = true;
    (0, dependencies.updateModeButtons)();
    annexPreviewTimer = setTimeout(() => {
      annexPreviewTimer = null;
      if (signature !== annexPreviewSignature() || !annexPreviewIsReady()) return;
      void completeLinearAnnexation(currentAnnexPreviewCandidateIndex(), signature).finally(() => {
        if (signature !== annexPreviewSignature()) return;
        dependencies.state.annexPreviewPending = false;
        (0, dependencies.updateModeButtons)();
      });
    }, Math.max(0, Number(delay) || 0));
    return true;
  }

  function prepareAnnexDraftCandidates() {
    const targetId = String(dependencies.state.annexTargetCountryId || '');
    const target = (0, dependencies.countryFeatureById)(targetId);
    if (dependencies.state.annexPhase !== 'line' || !target || !dependencies.state.annexDonorCountryIds.length) {
      (0, dependencies.setActionStatus)('편입을 진행할 수 없습니다. 편입받을 국가와 영토를 가져올 국가를 먼저 선택하세요.', 'error', 3800);
      return;
    }
    try {
      const sourceGeometry = dependencies.state.annexSourceGeometry || (0, dependencies.selectedCountryUnionGeometry)(dependencies.state.annexDonorCountryIds);
      const split = (0, dependencies.buildCutSplitCandidates)(sourceGeometry, (0, dependencies.editingDraftCoordinates)());
      dependencies.state.annexComponentIndex = split.componentIndex;
      dependencies.editingDomain?.replaceDraftCoordinates?.(split.cutLine, { record: false, inputPhase: 'refine' });
      dependencies.state.annexCandidates = split.candidates;
      dependencies.state.annexSelectedCandidateIndex = split.candidates[0].area <= split.candidates[1].area ? 0 : 1;
      dependencies.state.annexPhase = 'side';
      dependencies.editingDomain?.refreshTerritoryOperation?.('annex-candidates-ready');
      (0, dependencies.setModeBanner)('가져올 영역을 선택하세요.', 'annex-mode');
      (0, dependencies.updateModeButtons)();
      dependencies.renderingDomain?.invalidateGpuInteraction?.('annex-candidates-ready');
      scheduleAnnexGeometryPreview();
    } catch (error) {
      (0, dependencies.reportOperationError)(error, '새 경계를 사용할 수 없습니다. 영토를 가져올 국가를 한 번만 관통하도록 선을 다시 그리세요.', 'PL-ANNEX-003');
    }
  }

  function prepareNewCountryDraftCandidates() {
    if (dependencies.state.newCountryPhase !== 'line') {
      (0, dependencies.setActionStatus)('새 국가를 만들 수 없습니다. 영토를 가져올 국가 선택을 먼저 완료하세요.', 'error', 3600);
      return;
    }
    try {
      const sourceGeometry = dependencies.state.newCountrySourceGeometry || (0, dependencies.selectedCountryUnionGeometry)(dependencies.state.newCountrySourceIds);
      const split = (0, dependencies.buildCutSplitCandidates)(sourceGeometry, (0, dependencies.editingDraftCoordinates)());
      dependencies.editingDomain?.replaceDraftCoordinates?.(split.cutLine, { record: false, inputPhase: 'refine' });
      dependencies.state.newCountryCandidates = split.candidates;
      dependencies.state.newCountrySelectedCandidateIndex = split.candidates[0].area <= split.candidates[1].area ? 0 : 1;
      dependencies.state.newCountryPhase = 'side';
      (0, dependencies.setModeBanner)('신생국으로 만들 영역을 선택하세요.', 'add-country-mode');
      (0, dependencies.updateModeButtons)();
      dependencies.renderingDomain?.invalidateGpuInteraction?.('new-country-candidates-ready');
    } catch (error) {
      (0, dependencies.reportOperationError)(error, '신생국 국경선을 사용할 수 없습니다. 선택 영토를 한 번만 관통하도록 선을 다시 그리세요.', 'PL-COUNTRY-003');
    }
  }

  function prepareAnnexPolygon() {
    const target = (0, dependencies.countryFeatureById)(String(dependencies.state.annexTargetCountryId || ''));
    const donors = dependencies.state.annexDonorCountryIds.map(dependencies.countryFeatureById).filter(Boolean);
    if (dependencies.state.annexPhase !== 'polygon' || !target || !donors.length) return;
    const plan = (0, dependencies.planDrawnTerritoryAnnex)({
      drawnGeometry: { type: 'Polygon', coordinates: [(0, dependencies.ensureClosedRing)((0, dependencies.editingDraftCoordinates)())] },
      donorFeatures: [{ geometry: dependencies.state.annexSourceGeometry }],
      targetFeature: target,
      clipper: window.polygonClipping,
    });
    if (!plan?.transferGeometry) {
      (0, dependencies.setActionStatus)('그린 영역 안에 편입할 영토가 없습니다.', 'error', 3200);
      return;
    }
    dependencies.state.annexCandidates = [{ geometry: plan.transferGeometry }];
    dependencies.state.annexSelectedCandidateIndex = 0;
    dependencies.state.annexPhase = 'polygon-preview';
    dependencies.editingDomain?.refreshTerritoryOperation?.('annex-polygon-ready');
    (0, dependencies.setModeBanner)('가져올 영역을 선택하세요.', 'annex-mode');
    (0, dependencies.updateModeButtons)();
    dependencies.renderingDomain?.invalidateGpuInteraction?.('annex-polygon-ready');
    scheduleAnnexGeometryPreview();
  }

  function finishGenericFeatureDraft(polygonMode) {
    const draftCoords = (0, dependencies.editingDraftCoordinates)();
    const hydro = (0, dependencies.hydroToolConfig)(dependencies.state.tool);
    const id = (0, dependencies.uid)(hydro?.prefix || (polygonMode ? 'poly' : 'line'));
    const geometry = polygonMode
      ? { type: 'Polygon', coordinates: [(0, dependencies.orientRing)(draftCoords, true)] }
      : { type: 'LineString', coordinates: draftCoords.map(coord => coord.slice()) };
    if (polygonMode) {
      const issues = (0, dependencies.validateStructuredGeometry)({ type: 'Feature', id, properties: {}, geometry });
      if (issues.length) {
        (0, dependencies.setActionStatus)(issues[0].message || '그린 영역을 저장할 수 없습니다. 표시된 경계를 수정하세요.', 'error', 4200);
        (0, dependencies.updateModeButtons)();
        return;
      }
    }
    if (polygonMode && dependencies.state.distributionDraft) {
      const draft = dependencies.state.distributionDraft;
      const layer = (0, dependencies.distributionLayerById)(draft.layerId);
      if (!layer) {
        (0, dependencies.setActionStatus)('분포 항목을 찾을 수 없습니다. 그린 영역은 유지했으니 분포 항목을 확인하세요.', 'error', 3600);
        return;
      }
      const result = dependencies.distributionService.addEntry({
        id: (0, dependencies.uid)('distribution_entry'),
        layerId: layer.id,
        mode: dependencies.DISTRIBUTION_MODES.GEOMETRY,
        geometry,
        share: draft.share,
      });
      if (!result.ok) {
        (0, dependencies.setActionStatus)(result.error?.message || '자유 분포 영역을 저장하지 못했습니다.', 'error', 3600);
        return;
      }
      dependencies.state.distributionDraft = null;
      dependencies.editingDomain?.clearDraft?.({ reason: 'distribution-draft-committed', render: false });
      dependencies.editingDomain?.setTool('select', { announce: false });
      (0, dependencies.applyDistributionSelectionIntent)(layer.id);
      (0, dependencies.setActionStatus)(`${layer.name} 자유 분포 영역을 추가했습니다.`, 'success');
      return;
    }
    const feature = {
      type: 'Feature', id, geometry,
      properties: hydro
        ? {
          name: '',
          editorColor: hydro.color,
          category: hydro.category,
          notes: '',
        }
        : {
          name: '',
          color: dependencies.DEFAULT_GENERIC_FEATURE_COLOR,
          role: 'generic',
          landBinding: 'none',
          notes: '',
          schemaVersion: dependencies.GENERIC_FEATURE_SCHEMA_VERSION,
        },
    };
    if (hydro) {
      dependencies.projectDomain.recordHistory();
      (0, dependencies.normalizeHydroEdit)(feature);
      dependencies.state.hydroEdits.push(feature);
    } else {
      dependencies.genericFeatureService.add(feature);
    }
    dependencies.editingDomain?.clearDraft?.({ reason: 'feature-draft-committed', render: false });
    dependencies.editingDomain?.setTool('select', { announce: false });
    (0, dependencies.markLayerTreeDirty)();
    if (hydro) (0, dependencies.applyHydroSelectionIntent)(String(id));
    else (0, dependencies.applyGenericSelectionIntent)(String(id));
    dependencies.renderingDomain?.invalidateGpuInteraction?.('finish-generic-draft');
    if (hydro) dependencies.projectDomain.queueAutosave();
    const createdObjectLabel = hydro?.category === 'river' ? '강을' : hydro?.category === 'lake' ? '호수를' : '기타 객체를';
    (0, dependencies.setActionStatus)(`${createdObjectLabel} 추가했습니다.`, 'success');
  }

  function finishDraft() {
    if (!((0, dependencies.isGenericFeatureDraftTool)(dependencies.state.tool) || ['new-country', 'annex-territory'].includes(dependencies.state.tool))) {
      (0, dependencies.setActionStatus)('완료할 형상이 없습니다. 지도에서 점을 먼저 입력하세요.', 'error');
      return;
    }
    const polygonMode = (0, dependencies.isPolygonDraftTool)(dependencies.state.tool);
    const minimumPoints = polygonMode ? 3 : 2;
    const draft = (0, dependencies.editingDraftSnapshot)();
    if (dependencies.state.tool === 'annex-territory' && ['line', 'polygon'].includes(dependencies.state.annexPhase)
      && dependencies.state.annexDrawnSelections?.length && !draft.coords.length && !draft.strokeActive) {
      dependencies.state.annexPhase = polygonMode ? 'polygon-preview' : 'side';
      dependencies.editingDomain?.refreshTerritoryOperation?.('annex-accumulated-review');
      scheduleAnnexGeometryPreview();
      (0, dependencies.updateModeButtons)();
      return;
    }
    if (draft.coords.length < minimumPoints) {
      (0, dependencies.setActionStatus)(`완료하려면 점이 최소 ${minimumPoints}개 필요합니다. 지도에서 점을 더 입력하세요.`, 'error');
      return;
    }
    if (draft.strokeActive) {
      (0, dependencies.setActionStatus)('선을 그리는 중입니다. 포인터를 놓은 뒤 완료하세요.', 'error', 2400);
      return;
    }
    const cutSourceGeometry = (0, dependencies.activeCutDraftSourceGeometry)();
    if (!cutSourceGeometry && draft.issues.length) {
      (0, dependencies.setActionStatus)(draft.issues[0].message || '그린 형상에서 수정이 필요한 위치를 확인하세요.', 'error', 4200);
      (0, dependencies.updateModeButtons)();
      return;
    }
    if (cutSourceGeometry) {
      const assessment = (0, dependencies.assessCutDraft)(draft.coords, cutSourceGeometry);
      if (!assessment.valid) {
        (0, dependencies.setActionStatus)(assessment.message || '경계선을 선택 영역의 반대쪽 경계까지 연결하세요.', 'error', 4200);
        (0, dependencies.updateModeButtons)();
        return;
      }
    }
    (0, dependencies.dispatchTool)(dependencies.state.tool, {
      'split-generic-feature': dependencies.finishSplitGenericFeatureDraft,
      'split-territorial-unit': dependencies.finishTerritorialUnitSplitDraft,
      'redraw-territorial-unit': dependencies.finishTerritorialUnitRedrawDraft,
      'draw-territorial-unit': dependencies.finishTerritorialUnitDirectDraft,
      'annex-territory': dependencies.state.annexPhase === 'polygon' ? prepareAnnexPolygon : prepareAnnexDraftCandidates,
      'new-country': prepareNewCountryDraftCandidates,
    }, () => finishGenericFeatureDraft(polygonMode));
  }

  async function completeLinearAnnexation(candidateIndex, expectedSignature = null) {
    if (dependencies.state.tool !== 'annex-territory' || !['side', 'polygon-preview', 'components'].includes(dependencies.state.annexPhase)) return;
    const targetId = String(dependencies.state.annexTargetCountryId || '');
    const componentMode = dependencies.state.annexPhase === 'components';
    const componentItems = componentMode ? (0, dependencies.territoryComponentItems)() : [];
    const selectedComponents = componentItems.filter(item => item.selected);
    const riverSliverContext = [];
    for (const item of selectedComponents) {
      if (!item.usesRiverBoundary || riverSliverContext.some(row => row.donorId === item.countryId && row.polygonIndex === item.polygonIndex)) continue;
      riverSliverContext.push({
        donorId: item.countryId, polygonIndex: item.polygonIndex,
        unselectedGeometries: componentItems.filter(other => other.componentKey === item.componentKey && !other.selected).map(other => other.geometry),
      });
    }
    const donorIds = componentMode
      ? [...new Set(selectedComponents.map(item => String(item.countryId)).filter(Boolean))]
      : dependencies.state.annexDonorCountryIds.map(String);
    if (!(0, dependencies.requireCountriesUnlocked)([targetId, ...donorIds], '영토를 편입')) return;
    let candidate;
    if (componentMode) {
      try { candidate = { geometry: (0, dependencies.selectedTerritoryComponentGeometry)() }; }
      catch (error) {
        (0, dependencies.reportOperationError)(error, '선택한 영토 조각을 확인하지 못했습니다. 영역을 다시 선택하세요.', 'PL-ANNEX-001', 3800);
        return;
      }
    } else {
      if (!expectedSignature && !refreshAnnexDrawnSelection(candidateIndex)) return;
      candidate = { geometry: dependencies.state.annexDrawnGeometry };
    }
    const targetBefore = (0, dependencies.countryFeatureById)(targetId);
    const donorsBefore = donorIds.map(dependencies.countryFeatureById).filter(Boolean);
    if (!candidate?.geometry || !targetBefore || !donorsBefore.length) {
      (0, dependencies.setActionStatus)('편입 후보나 국가 데이터를 찾을 수 없습니다.', 'error', 3800);
      return;
    }
    const targetName = (0, dependencies.countryName)(targetBefore);
    const snapshot = (0, dependencies.snapshotEditable)();
    await (0, dependencies.beginWorkerGeometryPreview)({
      operation: 'annex',
      payload: { targetId, donorIds, transferredGeometry: candidate.geometry, riverSliverContext },
      snapshot,
      transferredGeometry: candidate.geometry,
      applyResult: plan => {
        const affectedIds = new Set(plan.affectedIds);
        (0, dependencies.applyWorkerCountryPatches)(plan);
        (0, dependencies.reindexCountries)(dependencies.state.countriesData, true);
        (0, dependencies.transferLandDependents)(plan.transferredGeometry || candidate.geometry, donorIds, targetId);
        (0, dependencies.refreshCountryCentroids)(affectedIds);
        dependencies.state.boundaryTopology = { edges: new Map(), nodes: new Map() };
        if (!(0, dependencies.countryFeatureById)(targetId)) throw new Error('편입받을 국가가 편입 결과에서 사라졌습니다.');
        dependencies.editingDomain?.clearDraft?.({ reason: 'annex-committed', render: false });
        dependencies.editingDomain?.setTool('select', { announce: false });
        (0, dependencies.applyCountrySelectionIntent)(targetId);
        dependencies.renderingDomain?.invalidateTerritorialPatch?.('territory-annex-committed');
      },
      onSuccess: plan => {
        const removedText = plan.removedIds.length ? ` · ${plan.removedIds.length}개국 완전 흡수` : '';
        const selectedText = componentMode ? `선택한 ${selectedComponents.length}개 영토 조각을 ` : '선택한 ';
        (0, dependencies.setActionStatus)(`${selectedText}${plan.affectedDonorIds.length}개국의 영토를 ${targetName}에 편입했습니다${removedText}.`, 'success', 4000);
      },
      onError: error => (0, dependencies.reportOperationError)(error, '영토를 편입하지 못해 변경을 되돌렸습니다. 편입 범위를 조정한 뒤 다시 시도하세요.', 'PL-ANNEX-002'),
      shouldKeepResult: () => !expectedSignature || expectedSignature === annexPreviewSignature(),
    });
  }

  async function completeNewCountryCreation(candidateIndex) {
    if (dependencies.state.tool !== 'new-country' || !['side', 'components'].includes(dependencies.state.newCountryPhase)) return;
    let candidate;
    if (dependencies.state.newCountryPhase === 'components') {
      try { candidate = { geometry: (0, dependencies.selectedTerritoryComponentGeometry)() }; }
      catch (error) {
        (0, dependencies.reportOperationError)(error, '선택한 영토 조각을 확인하지 못했습니다. 영역을 다시 선택하세요.', 'PL-COUNTRY-001', 3800);
        return;
      }
    } else {
      const selectedIndex = candidateIndex === null ? NaN : Number(candidateIndex);
      candidate = Number.isInteger(selectedIndex) && selectedIndex >= 0 ? dependencies.state.newCountryCandidates[selectedIndex] : null;
    }
    if (!candidate?.geometry) {
      (0, dependencies.setActionStatus)('신생국 영토 후보를 찾을 수 없습니다.', 'error', 3800);
      return;
    }
    if (!(0, dependencies.requireCountriesUnlocked)(dependencies.state.newCountrySourceIds, '새 국가를 분리')) return;
    const nameInput = prompt('새 국가의 국명을 입력하세요.', '새 국가');
    if (nameInput === null) return;
    const sourceIds = dependencies.state.newCountrySourceIds.map(String);
    const snapshot = (0, dependencies.snapshotEditable)();
    const feature = (0, dependencies.createCountryFeature)(
      nameInput.trim() || '새 국가',
      (0, dependencies.editingDraftCoordinates)(),
      null,
      (0, dependencies.snapGeometryToGrid)(candidate.geometry, 7),
    );
    await (0, dependencies.beginWorkerGeometryPreview)({
      operation: 'new-country',
      payload: { sourceIds, transferredGeometry: candidate.geometry, newFeature: feature },
      snapshot,
      transferredGeometry: candidate.geometry,
      applyResult: transferPlan => {
        const affectedIds = new Set(transferPlan.affectedIds);
        (0, dependencies.applyWorkerCountryPatches)(transferPlan);
        (0, dependencies.reindexCountries)(dependencies.state.countriesData, true);
        (0, dependencies.transferLandDependents)(candidate.geometry, sourceIds, feature.id);
        (0, dependencies.refreshCountryCentroids)(affectedIds);
        dependencies.state.boundaryTopology = { edges: new Map(), nodes: new Map() };
        dependencies.editingDomain?.clearDraft?.({ reason: 'country-created', render: false });
        dependencies.editingDomain?.setTool('select', { announce: false });
        (0, dependencies.applyCountrySelectionIntent)(feature.id);
        dependencies.renderingDomain?.invalidateCountryPatch?.('new-country-committed');
      },
      onSuccess: transferPlan => {
        const removedText = transferPlan.removedIds.length ? ` · 원본 ${transferPlan.removedIds.length}개국 완전 흡수` : '';
        (0, dependencies.setActionStatus)(`${(0, dependencies.countryName)(feature)} 국가를 추가했습니다${removedText}.`, 'success', 4200);
      },
      onError: error => (0, dependencies.reportOperationError)(error, '국가를 추가하지 못해 변경을 되돌렸습니다. 선택 범위를 조정한 뒤 다시 시도하세요.', 'PL-COUNTRY-002'),
    });
  }

  async function completeCountryMerge() {
    const sourceId = String(dependencies.state.mergeSourceCountryId || '');
    const targetIds = [...new Set(dependencies.state.mergeTargetCountryIds.map(String))].filter(id => id && id !== sourceId);
    if (!sourceId || !targetIds.length) {
      (0, dependencies.setActionStatus)('합병할 국가를 하나 이상 선택하세요.', 'error', 3200);
      return;
    }
    if (!(0, dependencies.requireCountriesUnlocked)([sourceId, ...targetIds], '국가를 합병')) return;
    const source = (0, dependencies.countryFeatureById)(sourceId);
    const targets = targetIds.map(dependencies.countryFeatureById).filter(Boolean);
    if (!source || targets.length !== targetIds.length) {
      (0, dependencies.setActionStatus)('합병할 국가를 찾을 수 없습니다. 대상을 다시 선택하세요.', 'error');
      return;
    }
    const sourceName = (0, dependencies.countryName)(source);
    const snapshot = (0, dependencies.snapshotEditable)();
    await (0, dependencies.beginWorkerGeometryPreview)({
      operation: 'merge',
      payload: { sourceId, targetIds },
      snapshot,
      applyResult: result => {
        (0, dependencies.applyWorkerCountryPatches)(result);
        dependencies.state.countryOverrides[sourceId] = { ...(dependencies.state.countryOverrides[sourceId] || {}), name: sourceName };
        for (const targetId of targetIds) delete dependencies.state.countryOverrides[targetId];
        (0, dependencies.reindexCountries)(dependencies.state.countriesData, true);
        (0, dependencies.reassignLandDependents)(targetIds, sourceId);
        (0, dependencies.refreshCountryCentroids)(new Set([sourceId]));
        dependencies.state.boundaryTopology = { edges: new Map(), nodes: new Map() };
        dependencies.editingDomain?.setTool('select', { announce: false });
        (0, dependencies.applyCountrySelectionIntent)(sourceId);
        dependencies.renderingDomain?.invalidateCountryPatch?.('country-merge-committed');
      },
      onSuccess: () => (0, dependencies.setActionStatus)(`${targetIds.length}개국을 ${sourceName}에 합병했습니다.`, 'success', 3200),
      onError: error => (0, dependencies.reportOperationError)(error, '국가를 합병하지 못해 변경을 되돌렸습니다. 대상을 다시 확인하세요.', 'PL-MERGE-001'),
    });
  }



  return Object.freeze({
    connect,

    get completeCountryMerge() { return completeCountryMerge; },
    get addAnnexDrawnSelection() { return addAnnexDrawnSelection; },
    get undoAnnexDrawnSelection() { return undoAnnexDrawnSelection; },
    get completeLinearAnnexation() { return completeLinearAnnexation; },
    get completeNewCountryCreation() { return completeNewCountryCreation; },
    get cancelScheduledAnnexPreview() { return cancelScheduledAnnexPreview; },
    get finishDraft() { return finishDraft; },
    get scheduleAnnexGeometryPreview() { return scheduleAnnexGeometryPreview; },
  });
}
