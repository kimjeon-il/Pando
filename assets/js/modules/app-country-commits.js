/** CountryCommits: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createCountryCommits() {
  let dependencies;
  let multiDraftPreviewTimer = null;
  let multiDraftPreviewGeneration = 0;

  function connect(ports) {
    if (dependencies) throw new Error('country-commits already connected');
    dependencies = ports;
  }

  function cancelScheduledMultiDraftPreview() {
    multiDraftPreviewGeneration += 1;
    if (multiDraftPreviewTimer !== null) {
      clearTimeout(multiDraftPreviewTimer);
      multiDraftPreviewTimer = null;
    }
    const draft = multiDraft();
    if (draft && draft.kind !== 'new-country') draft.previewPending = false;
  }

  function scheduleMultiDraftPreview({ delay = 300 } = {}) {
    const draft = multiDraft();
    if (!draft || draft.kind === 'new-country') return false;
    cancelScheduledMultiDraftPreview();
    const generation = multiDraftPreviewGeneration;
    draft.previewPending = true;
    draft.previewIssues = [];
    (0, dependencies.updateModeButtons)();
    multiDraftPreviewTimer = setTimeout(() => {
      multiDraftPreviewTimer = null;
      if (generation !== multiDraftPreviewGeneration || dependencies.state.multiDraft !== draft) return;
      const geometry = composeMultiDraftGeometry({ polygon: draft.shape === 'polygon' });
      const feature = geometry && draft.shape === 'polygon'
        ? { type: 'Feature', id: 'multi-draft-preview', properties: {}, geometry }
        : null;
      draft.previewGeometry = geometry;
      const issues = feature ? (0, dependencies.validateStructuredGeometry)(feature) : [{ message: '그린 조각을 하나의 형상으로 만들 수 없습니다.', severity: 'error' }];
      draft.previewIssues = issues.filter(issue => issue.severity !== 'warning');
      draft.previewPending = false;
      dependencies.renderingDomain?.invalidateEditingOverlays?.('multi-draft-preview-ready');
      (0, dependencies.updateModeButtons)();
    }, Math.max(0, Number(delay) || 0));
    return true;
  }

  function redrawCurrentDraft() {
    const state = dependencies.state;
    const draft = dependencies.editingDraftSnapshot();
    if (state.modeProcessing || draft.strokeActive || draft.dragging) return false;
    if (state.territorySelectionSession) return (0, dependencies.redrawTerritorySelection)();
    const multi = state.multiDraft;
    const multiDraft = !!multi && ['hydro', 'territorial-direct', 'territorial-split-create'].includes(multi.kind);
    if (!multiDraft && !dependencies.isGenericFeatureDraftTool(state.tool)) return false;
    dependencies.discardActiveGeometryPreview?.({ announce: false });
    cancelScheduledMultiDraftPreview();
    if (multi?.current) multi.current = null;
    if (multi) {
      multi.previewGeometry = null;
      multi.previewIssues = [];
    }
    dependencies.editingDomain?.startDraft?.({ coords: [] });
    dependencies.setModeBanner(dependencies.defaultDraftInstruction());
    dependencies.renderingDomain?.invalidateEditingOverlays?.('current-draft-redrawn');
    dependencies.updateModeButtons();
    return true;
  }

  function multiDraft() {
    const draft = dependencies.state.multiDraft;
    return draft && Array.isArray(draft.parts) ? draft : null;
  }

  function multiDraftPartCount({ includeCurrent = true } = {}) {
    const draft = multiDraft();
    return draft ? draft.parts.length + (includeCurrent && draft.current ? 1 : 0) : 0;
  }

  function composeMultiDraftGeometry({ polygon = false } = {}) {
    const draft = multiDraft();
    const pieces = [...(draft?.parts || []), ...(draft?.current ? [draft.current] : [])].filter(item => item?.geometry);
    if (!pieces.length) return null;
    if (!polygon) {
      const lines = pieces.flatMap(item => item.geometry.type === 'MultiLineString'
        ? item.geometry.coordinates : [item.geometry.coordinates]);
      return lines.length === 1
        ? { type: 'LineString', coordinates: lines[0].map(coord => coord.slice()) }
        : { type: 'MultiLineString', coordinates: lines.map(line => line.map(coord => coord.slice())) };
    }
    try {
      const coordinates = pieces.flatMap(item => (0, dependencies.geometryMultiCoordinates)(item.geometry));
      const union = window.polygonClipping?.union ? window.polygonClipping.union(...coordinates) : coordinates;
      return (0, dependencies.normalizeClippedLandGeometry)(union);
    } catch (error) {
      (0, dependencies.reportOperationError)(error, '여러 영역을 하나로 준비하지 못했습니다. 겹치는 경계를 확인하세요.', 'PL-MULTI-DRAFT-001', 3800);
      return null;
    }
  }

  function startNextMultiDraftPart() {
    dependencies.editingDomain?.startDraft?.({ coords: [] });
    (0, dependencies.setModeBanner)((0, dependencies.defaultDraftInstruction)());
    dependencies.renderingDomain?.invalidateEditingOverlays?.('multi-draft-next-part');
    (0, dependencies.updateModeButtons)();
  }

  function addMultiDraftPart() {
    const draft = multiDraft();
    const snapshot = dependencies.editingDraftSnapshot();
    if (!draft || dependencies.state.modeProcessing || snapshot.strokeActive || !draft.current) return false;
    draft.parts.push(draft.current);
    draft.current = null;
    scheduleMultiDraftPreview();
    startNextMultiDraftPart();
    return true;
  }

  function undoMultiDraftPart() {
    const draft = multiDraft();
    const snapshot = dependencies.editingDraftSnapshot();
    if (!draft || dependencies.state.modeProcessing || snapshot.strokeActive) return false;
    if (!draft.current && !draft.parts.length) return false;
    cancelScheduledMultiDraftPreview();
    draft.current = null;
    if (!draft.parts.length) {
      draft.previewGeometry = null;
      draft.previewIssues = [];
      startNextMultiDraftPart();
      return true;
    }
    draft.parts.pop();
    scheduleMultiDraftPreview();
    startNextMultiDraftPart();
    return true;
  }

  function finishHydroDraft(geometry, hydro) {
    const draft = multiDraft();
    if (!draft || draft.kind !== 'hydro') return false;
    draft.current = { geometry };
    scheduleMultiDraftPreview();
    dependencies.editingDomain?.clearDraft?.({ reason: 'hydro-draft-part-finished', render: false });
    (0, dependencies.setModeBanner)('그린 경로를 확인하세요.');
    dependencies.renderingDomain?.invalidateEditingOverlays?.('hydro-draft-part-finished');
    (0, dependencies.updateModeButtons)();
    return true;
  }

  function completeHydroMultiDraft() {
    const draft = multiDraft();
    const hydro = (0, dependencies.hydroToolConfig)(dependencies.state.tool);
    if (!draft || draft.kind !== 'hydro' || !hydro || dependencies.editingDomain?.draftInputActive?.() || draft.previewPending || draft.previewIssues?.length) return false;
    const geometry = draft.previewGeometry || composeMultiDraftGeometry({ polygon: hydro.category === 'lake' });
    if (!geometry) return false;
    const feature = {
      type: 'Feature', id: (0, dependencies.uid)(hydro.prefix), geometry,
      properties: { name: '', editorColor: hydro.color, category: hydro.category, notes: '' },
    };
    try {
      dependencies.projectDomain.recordHistory({ type: 'hydro-create', affectedIds: [String(feature.id)] });
      (0, dependencies.normalizeHydroEdit)(feature);
      dependencies.state.hydroEdits.push(feature);
      dependencies.state.multiDraft = null;
      dependencies.editingDomain?.clearDraft?.({ reason: 'hydro-draft-committed', render: false });
      dependencies.editingDomain?.setTool('select', { announce: false });
      (0, dependencies.markLayerTreeDirty)();
      (0, dependencies.applyHydroSelectionIntent)(String(feature.id));
      dependencies.renderingDomain?.invalidateGpuInteraction?.('finish-hydro-multi-draft');
      dependencies.projectDomain.queueAutosave();
      (0, dependencies.setActionStatus)(`${hydro.category === 'river' ? '강을' : '호수를'} 추가했습니다.`, 'success');
      return true;
    } catch (error) {
      (0, dependencies.reportOperationError)(error, '그린 객체를 생성하지 못했습니다.', 'PL-MULTI-DRAFT-002', 3800);
      return false;
    }
  }

  function completeMultiDraftCreation() {
    const draft = multiDraft();
    if (!draft) return false;
    if (draft.kind === 'hydro') return completeHydroMultiDraft();
    return false;
  }

  function prepareAnnexDraftCandidates(session = dependencies.state.territorySelectionSession) {
    const targetId = String(session?.targetCountryId || '');
    const target = (0, dependencies.countryFeatureById)(targetId);
    if (session?.kind !== 'annex' || session.selectionPhase !== 'line' || !target || !session.sourceCountryIds.length) {
      (0, dependencies.setActionStatus)('편입을 진행할 수 없습니다. 편입받을 국가와 영토를 가져올 국가를 먼저 선택하세요.', 'error', 3800);
      return;
    }
    try {
      const sourceGeometry = session.workingSourceGeometry;
      const split = (0, dependencies.buildCutSplitCandidates)(sourceGeometry, (0, dependencies.editingDraftCoordinates)());
      session.componentIndex = split.componentIndex;
      dependencies.editingDomain?.replaceDraftCoordinates?.(split.cutLine, { record: false, inputPhase: 'refine' });
      const selectedIndex = split.candidates[0].area <= split.candidates[1].area ? 0 : 1;
      (0, dependencies.setTerritorySelectionCandidates)(split.candidates, selectedIndex, 'side');
      dependencies.editingDomain?.refreshTerritoryOperation?.('annex-candidates-ready');
      (0, dependencies.setModeBanner)('가져올 영역을 선택하세요.', 'annex-mode');
      (0, dependencies.updateModeButtons)();
      dependencies.renderingDomain?.invalidateGpuInteraction?.('annex-candidates-ready');
      return true;
    } catch (error) {
      (0, dependencies.reportOperationError)(error, '새 경계를 사용할 수 없습니다. 영토를 가져올 국가를 한 번만 관통하도록 선을 다시 그리세요.', 'PL-ANNEX-003');
    }
  }

  function prepareNewCountryDraftCandidates(session = dependencies.state.territorySelectionSession) {
    if (session?.kind !== 'new-country' || session.selectionPhase !== 'line') {
      (0, dependencies.setActionStatus)('새 국가를 만들 수 없습니다. 영토를 가져올 국가 선택을 먼저 완료하세요.', 'error', 3600);
      return;
    }
    try {
      const sourceGeometry = session.workingSourceGeometry;
      const split = (0, dependencies.buildCutSplitCandidates)(sourceGeometry, (0, dependencies.editingDraftCoordinates)());
      dependencies.editingDomain?.replaceDraftCoordinates?.(split.cutLine, { record: false, inputPhase: 'refine' });
      const selectedIndex = split.candidates[0].area <= split.candidates[1].area ? 0 : 1;
      (0, dependencies.setTerritorySelectionCandidates)(split.candidates, selectedIndex, 'side');
      dependencies.editingDomain?.refreshTerritoryOperation?.('new-country-candidates-ready');
      (0, dependencies.setModeBanner)('신생국으로 만들 영역을 선택하세요.', 'add-country-mode');
      (0, dependencies.updateModeButtons)();
      dependencies.renderingDomain?.invalidateGpuInteraction?.('new-country-candidates-ready');
      return true;
    } catch (error) {
      (0, dependencies.reportOperationError)(error, '신생국 국경선을 사용할 수 없습니다. 선택 영토를 한 번만 관통하도록 선을 다시 그리세요.', 'PL-COUNTRY-003');
    }
  }

  function prepareAnnexPolygon(session = dependencies.state.territorySelectionSession) {
    const target = (0, dependencies.countryFeatureById)(String(session?.targetCountryId || ''));
    const donors = (session?.sourceCountryIds || []).map(dependencies.countryFeatureById).filter(Boolean);
    if (session?.kind !== 'annex' || session.selectionPhase !== 'polygon' || !target || !donors.length) return;
    const plan = (0, dependencies.planDrawnTerritoryAnnex)({
      drawnGeometry: { type: 'Polygon', coordinates: [(0, dependencies.ensureClosedRing)((0, dependencies.editingDraftCoordinates)())] },
      donorFeatures: [{ geometry: session.workingSourceGeometry }],
      targetFeature: target,
      clipper: window.polygonClipping,
    });
    if (!plan?.transferGeometry) {
      (0, dependencies.setActionStatus)('그린 영역 안에 편입할 영토가 없습니다.', 'error', 3200);
      return;
    }
    (0, dependencies.setTerritorySelectionCandidates)([{ geometry: plan.transferGeometry }], 0, 'side');
    dependencies.editingDomain?.refreshTerritoryOperation?.('annex-polygon-ready');
    (0, dependencies.setModeBanner)('가져올 영역을 선택하세요.', 'annex-mode');
    (0, dependencies.updateModeButtons)();
    dependencies.renderingDomain?.invalidateGpuInteraction?.('annex-polygon-ready');
    return true;
  }

  function prepareNewCountryPolygon(session = dependencies.state.territorySelectionSession) {
    if (session?.kind !== 'new-country' || session.selectionPhase !== 'polygon') return false;
    try {
      const drawn = { type: 'Polygon', coordinates: [(0, dependencies.ensureClosedRing)((0, dependencies.editingDraftCoordinates)())] };
      const geometry = (0, dependencies.normalizeClippedLandGeometry)(window.polygonClipping.intersection(
        (0, dependencies.geometryMultiCoordinates)(session.workingSourceGeometry),
        (0, dependencies.geometryMultiCoordinates)(drawn),
      ));
      if (!geometry) throw new Error('그린 영역 안에 새 국가로 만들 영토가 없습니다.');
      return (0, dependencies.setTerritorySelectionCandidates)([{ geometry }], 0, 'side');
    } catch (error) {
      (0, dependencies.reportOperationError)(error, '그린 영역을 새 국가 후보로 만들 수 없습니다.', 'PL-COUNTRY-003', 3800);
      return false;
    }
  }

  function finishAnnexSelectionDraft(session) {
    return session?.method === 'polygon' ? prepareAnnexPolygon(session) : prepareAnnexDraftCandidates(session);
  }

  function finishNewCountrySelectionDraft(session) {
    return session?.method === 'polygon' ? prepareNewCountryPolygon(session) : prepareNewCountryDraftCandidates(session);
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
    if (!hydro) {
      (0, dependencies.setActionStatus)('기타 객체는 새로 만들 수 없습니다. 필요한 종류를 선택해 생성하세요.', 'error', 3600);
      return false;
    }
    return finishHydroDraft(geometry, hydro);
  }

  function finishDraft() {
    const territorySession = dependencies.state.territorySelectionSession;
    if (!((0, dependencies.isGenericFeatureDraftTool)(dependencies.state.tool) || territorySession)) {
      (0, dependencies.setActionStatus)('완료할 형상이 없습니다. 지도에서 점을 먼저 입력하세요.', 'error');
      return;
    }
    const polygonMode = (0, dependencies.isPolygonDraftTool)(dependencies.state.tool);
    const minimumPoints = polygonMode ? 3 : 2;
    const draft = (0, dependencies.editingDraftSnapshot)();
    const accumulatedMultiDraft = dependencies.state.multiDraft?.kind === 'hydro'
      && dependencies.state.multiDraft.parts.length > 0 && !draft.coords.length && !draft.strokeActive;
    if (accumulatedMultiDraft) {
      dependencies.editingDomain?.clearDraft?.({ reason: 'multi-draft-review', render: false });
      (0, dependencies.setModeBanner)('그린 영역을 확인하세요.');
      dependencies.renderingDomain?.invalidateEditingOverlays?.('multi-draft-review');
      scheduleMultiDraftPreview();
      (0, dependencies.updateModeButtons)();
      return true;
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
    dependencies.editingDomain?.setDraftVertexInsertMode?.(false);
    if (territorySession) return (0, dependencies.finishTerritorySelectionDraft)();
    return (0, dependencies.dispatchTool)(dependencies.state.tool, {
      'split-generic-feature': dependencies.finishSplitGenericFeatureDraft,
      'split-territorial-unit': dependencies.finishTerritorialUnitSplitDraft,
      'redraw-territorial-unit': dependencies.finishTerritorialUnitRedrawDraft,
    }, () => finishGenericFeatureDraft(polygonMode));
  }

  async function prepareAnnexSelectionPreview(session, expectedKey) {
    if (session?.kind !== 'annex' || session.stage !== 'selection' || !['side', 'components'].includes(session.selectionPhase)) return false;
    const targetId = String(session.targetCountryId || '');
    const componentMode = session.selectionPhase === 'components';
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
      : session.sourceCountryIds.map(String);
    if (!(0, dependencies.requireCountriesUnlocked)([targetId, ...donorIds], '영토를 편입')) return;
    const candidate = { geometry: session.combinedGeometry };
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
      shouldKeepResult: () => dependencies.state.territorySelectionSession === session
        && expectedKey === [session.id, session.projectGeneration, session.settingsRevision, session.sourceRevision, session.selectionRevision].join(':'),
    });
    return true;
  }

  function newCountryPreviewContext(session) {
    if (session?.kind !== 'new-country' || session.stage !== 'selection') return null;
    const transferredGeometry = session.combinedGeometry;
    if (!transferredGeometry) {
      (0, dependencies.setActionStatus)('신생국 영토 후보를 찾을 수 없습니다.', 'error', 3800);
      return null;
    }
    if (!(0, dependencies.requireCountriesUnlocked)(session.sourceCountryIds, '새 국가를 분리')) return null;
    const sourceIds = session.sourceCountryIds.map(String);
    const snapshot = (0, dependencies.snapshotEditable)();
    const feature = (0, dependencies.createCountryFeature)(
      session.name.trim(),
      (0, dependencies.editingDraftCoordinates)(),
      null,
      (0, dependencies.snapGeometryToGrid)(transferredGeometry, 7),
    );
    feature.id = session.generatedId;
    return { sourceIds, snapshot, feature, transferredGeometry };
  }

  async function prepareNewCountrySelectionPreview(session, expectedKey) {
    const context = newCountryPreviewContext(session);
    if (!context) return false;
    const { sourceIds, snapshot, feature, transferredGeometry } = context;
    await (0, dependencies.beginWorkerGeometryPreview)({
      operation: 'new-country',
      payload: { sourceIds, transferredGeometry, newFeature: feature },
      snapshot,
      applyResult: transferPlan => {
        const affectedIds = new Set(transferPlan.affectedIds);
        (0, dependencies.applyWorkerCountryPatches)(transferPlan);
        (0, dependencies.reindexCountries)(dependencies.state.countriesData, true);
        (0, dependencies.transferLandDependents)(transferredGeometry, sourceIds, feature.id);
        (0, dependencies.refreshCountryCentroids)(affectedIds);
        dependencies.state.boundaryTopology = { edges: new Map(), nodes: new Map() };
        dependencies.state.multiDraft = null;
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
      shouldKeepResult: () => dependencies.state.territorySelectionSession === session
        && expectedKey === [session.id, session.projectGeneration, session.settingsRevision, session.sourceRevision, session.selectionRevision].join(':'),
    });
    return true;
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
    get addMultiDraftPart() { return addMultiDraftPart; },
    get completeMultiDraftCreation() { return completeMultiDraftCreation; },
    get composeMultiDraftGeometry() { return composeMultiDraftGeometry; },
    get multiDraftPartCount() { return multiDraftPartCount; },
    get undoMultiDraftPart() { return undoMultiDraftPart; },
    get cancelScheduledMultiDraftPreview() { return cancelScheduledMultiDraftPreview; },
    get finishDraft() { return finishDraft; },
    get finishAnnexSelectionDraft() { return finishAnnexSelectionDraft; },
    get finishNewCountrySelectionDraft() { return finishNewCountrySelectionDraft; },
    get prepareAnnexSelectionPreview() { return prepareAnnexSelectionPreview; },
    get prepareNewCountrySelectionPreview() { return prepareNewCountrySelectionPreview; },
    get redrawCurrentDraft() { return redrawCurrentDraft; },
    get scheduleMultiDraftPreview() { return scheduleMultiDraftPreview; },
  });
}
