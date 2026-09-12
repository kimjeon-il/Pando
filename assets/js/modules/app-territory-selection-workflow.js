/** Shared territory-selection workflow for annexation, countries, subunits, and regions. */
export function createTerritorySelectionWorkflow() {
  let dependencies;
  let adapters;
  let previewTimer = null;
  let previewGeneration = 0;
  const text = value => String(value ?? '').trim();

  function connect(ports) {
    if (dependencies) throw new Error('territory-selection-workflow already connected');
    dependencies = ports;
  }

  function session() {
    return dependencies.state?.territorySelectionSession || null;
  }

  function createSession(kind, options = {}) {
    const definition = adapters?.get(kind);
    if (!definition) return null;
    const sourceCountryIds = [...new Set((options.sourceCountryIds || options.referenceCountryIds || []).map(text).filter(Boolean))];
    return {
      ...options,
      id: options.id || (0, dependencies.uid)('territory-selection'),
      kind,
      tool: options.tool || definition.tool,
      taskLabel: definition.label,
      setupStageLabel: definition.setupStageLabel,
      setupCountryPicking: definition.setupCountryPicking,
      methodsRequiringSources: [...definition.methodsRequiringSources],
      unboundedMethods: [...definition.unboundedMethods],
      draftInstructions: definition.draftInstructions,
      componentLabel: definition.componentLabel,
      riverComponentLabel: definition.riverComponentLabel,
      showRiverFailureSources: definition.showRiverFailureSources,
      targetHighlightRole: definition.targetHighlightRole,
      sourceHighlightRole: definition.sourceHighlightRole,
      actionButtonId: definition.actionButtonId,
      stage: 'setup',
      activePhase: null,
      activeMethod: null,
      requestedMethod: null,
      methodChangeConfirmation: null,
      name: String(options.name ?? definition.defaultName),
      generatedId: options.generatedId || (definition.generatedIdPrefix ? (0, dependencies.uid)(definition.generatedIdPrefix) : ''),
      targetCountryId: text(options.targetCountryId),
      sovereignId: text(options.sovereignId),
      parentId: text(options.parentId),
      sourceKey: text(options.sourceKey || definition.defaultSourceKey),
      componentIndex: null,
      candidates: [],
      selectedCandidateIndex: null,
      selectedComponentKeys: [],
      componentFeatures: [],
      hoveredComponentKey: null,
      parts: [],
      componentSnapshots: [],
      baseSourceFeatures: [],
      currentGeometry: null,
      combinedGeometry: null,
      baseSourceGeometry: null,
      workingSourceGeometry: null,
      remainingGeometry: null,
      sourceInfo: null,
      setupSourceCache: null,
      useRiverBoundaries: false,
      riverPartitionStatus: 'idle',
      riverPartitionCandidates: [],
      riverPartitionDonorResults: [],
      previewPending: false,
      previewReadyKey: null,
      settingsRevision: 0,
      selectionRevision: 0,
      sourceRevision: 0,
      projectGeneration: dependencies.projectDomain?.getGeneration?.() ?? 0,
      applying: false,
      sourceCountryIds,
    };
  }

  function initializeTerritorySelectionWorkflow() {
    adapters = Object.freeze(new Map([
      ['annex', Object.freeze({
        tool: 'annex-territory',
        label: '영토 편입',
        setupStageLabel: '대상 선택',
        defaultName: '',
        nameLabel: '',
        referenceLabel: '',
        generatedIdPrefix: '',
        supportsName: false,
        showSetup: false,
        showSubunitFields: false,
        setupCountryPicking: true,
        methodsRequiringSources: [],
        unboundedMethods: [],
        draftInstructions: Object.freeze({
          line: '가져올 영토를 가로질러 선을 그리세요.',
          polygon: '가져올 영역을 지도에 그리세요.',
          components: '가져올 영토 조각을 선택하세요.',
        }),
        componentLabel: '가져올 영토 조각',
        riverComponentLabel: '하천으로 나뉜 영토 조각',
        showRiverFailureSources: true,
        targetHighlightRole: 'annex-target',
        sourceHighlightRole: 'annex-source',
        actionButtonId: 'annexTerritoryBtn',
        defaultSourceKey: '',
        showReference: () => false,
        showCountryFlow: true,
        finalLabel: count => `편입 (${count})`,
        sourceInstruction: '영토를 가져올 국가를 선택할 수 없습니다. 국가 영토 안쪽을 선택하세요.',
        canUseSource: (current, id) => id !== current.targetCountryId,
        sourceRejectedMessage: '편입 주체와 다른 국가를 선택하세요.',
        validateSetup: dependencies.validateAnnexSelectionSetup,
        prepareSelection: dependencies.prepareAnnexSelection,
        finishDraft: dependencies.finishAnnexSelectionDraft,
        preview: dependencies.prepareAnnexSelectionPreview,
      })],
      ['new-country', Object.freeze({
        tool: 'new-country',
        label: '국가 추가',
        setupStageLabel: '기본 설정',
        defaultName: '새 국가',
        nameLabel: '국가명',
        referenceLabel: '영토를 가져올 국가',
        generatedIdPrefix: 'USR',
        supportsName: true,
        showSetup: true,
        showSubunitFields: false,
        setupCountryPicking: true,
        methodsRequiringSources: [],
        unboundedMethods: [],
        draftInstructions: Object.freeze({
          line: '가져올 영토를 가로질러 선을 그리세요.',
          polygon: '추가할 영역을 지도에 그리세요.',
          components: '새 국가로 만들 영토 조각을 선택하세요.',
        }),
        componentLabel: '새 국가로 만들 영토 조각',
        riverComponentLabel: '하천으로 나뉜 영토 조각',
        showRiverFailureSources: false,
        targetHighlightRole: '',
        sourceHighlightRole: 'reference',
        actionButtonId: '',
        defaultSourceKey: '',
        showReference: current => current.stage === 'setup',
        showCountryFlow: false,
        finalLabel: () => '생성',
        sourceInstruction: '영토를 가져올 국가를 선택할 수 없습니다. 국가 영토 안쪽을 선택하세요.',
        canUseSource: () => true,
        validateSetup: dependencies.validateNewCountrySelectionSetup,
        prepareSelection: dependencies.prepareNewCountrySelection,
        finishDraft: dependencies.finishNewCountrySelectionDraft,
        preview: dependencies.prepareNewCountrySelectionPreview,
      })],
      ['subunit', Object.freeze({
        tool: 'draw-territorial-unit',
        label: '하위단위 추가',
        setupStageLabel: '기본 설정',
        defaultName: '새 하위단위',
        nameLabel: '하위단위명',
        referenceLabel: '',
        generatedIdPrefix: 'subunit',
        supportsName: true,
        showSetup: true,
        showSubunitFields: true,
        setupCountryPicking: false,
        methodsRequiringSources: [],
        unboundedMethods: [],
        draftInstructions: Object.freeze({
          line: '기준 영역을 가로질러 경계를 그리세요.',
          polygon: '추가할 영역을 지도에 그리세요.',
          components: '새 하위단위로 만들 영토 조각을 선택하세요.',
        }),
        componentLabel: '새 하위단위로 만들 영토 조각',
        riverComponentLabel: '하천으로 나뉜 영토 조각',
        showRiverFailureSources: false,
        targetHighlightRole: '',
        sourceHighlightRole: '',
        actionButtonId: '',
        defaultSourceKey: 'unassigned',
        showReference: () => false,
        showCountryFlow: false,
        finalLabel: () => '생성',
        sourceInstruction: '기준 국가를 선택할 수 없습니다. 국가 영토 안쪽을 선택하세요.',
        canUseSource: () => false,
        validateSetup: dependencies.territorialCreateSetupValid,
        prepareSelection: dependencies.prepareTerritorialCreateSelection,
        finishDraft: dependencies.finishTerritorialUnitDirectDraft,
        preview: dependencies.prepareTerritorialSelectionPreview,
      })],
      ['region', Object.freeze({
        tool: 'draw-territorial-unit',
        label: '지방 추가',
        setupStageLabel: '기본 설정',
        defaultName: '새 지방',
        nameLabel: '지방명',
        referenceLabel: '영역 기준 국가',
        generatedIdPrefix: 'region',
        supportsName: true,
        showSetup: true,
        showSubunitFields: false,
        setupCountryPicking: false,
        methodsRequiringSources: ['line', 'components'],
        unboundedMethods: ['polygon'],
        draftInstructions: Object.freeze({
          line: '기준 영역을 가로질러 경계를 그리세요.',
          polygon: '추가할 영역을 지도에 그리세요.',
          components: '새 지방으로 만들 영토 조각을 선택하세요.',
        }),
        componentLabel: '새 지방으로 만들 영토 조각',
        riverComponentLabel: '하천으로 나뉜 영토 조각',
        showRiverFailureSources: false,
        targetHighlightRole: '',
        sourceHighlightRole: 'reference',
        actionButtonId: '',
        defaultSourceKey: '',
        showReference: current => current.stage === 'selection' && current.activePhase === 'source',
        showCountryFlow: false,
        finalLabel: () => '생성',
        sourceInstruction: '영역 기준 국가를 선택할 수 없습니다. 국가 영토 안쪽을 선택하세요.',
        canUseSource: () => true,
        validateSetup: dependencies.territorialCreateSetupValid,
        prepareSelection: dependencies.prepareTerritorialCreateSelection,
        finishDraft: dependencies.finishTerritorialUnitDirectDraft,
        preview: dependencies.prepareTerritorialSelectionPreview,
      })],
    ]));
    dependencies.state.territorySelectionSession = null;
  }

  function adapterFor(current = session()) {
    return current ? adapters?.get(current.kind) || null : null;
  }

  function refresh(reason) {
    dependencies.renderingDomain?.invalidateEditingOverlays?.(reason);
    dependencies.renderingDomain?.invalidateCountryPatch?.(reason);
    (0, dependencies.updateModeButtons)();
  }

  function start(kind, options = {}) {
    if (!adapters?.has(kind)) return false;
    clear({ discardPreview: true, refreshUi: false });
    const current = createSession(kind, options);
    dependencies.state.territorySelectionSession = current;
    dependencies.editingDomain?.setTool(current.tool, { announce: false });
    dependencies.state.territorySelectionSession = current;
    (0, dependencies.setModeBanner)('');
    refresh('territory-selection-start');
    return current;
  }

  function cancelPreview({ discard = true, preserveReady = false } = {}) {
    previewGeneration += 1;
    if (previewTimer !== null) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
    const current = session();
    if (current) {
      current.previewPending = false;
      if (!preserveReady) current.previewReadyKey = null;
    }
    if (discard) (0, dependencies.discardActiveGeometryPreview)({ announce: false });
    (0, dependencies.updateModeButtons)();
  }

  function clear({ discardPreview = true, refreshUi = true } = {}) {
    const current = session();
    cancelPreview({ discard: discardPreview });
    dependencies.editingDomain?.clearDraft?.({ reason: 'territory-selection-clear', render: false });
    dependencies.state.territorySelectionSession = null;
    (0, dependencies.resetRiverPartitionState)();
    if (refreshUi) refresh('territory-selection-clear');
    return !!current;
  }

  function previewKey(current = session()) {
    if (!current) return '';
    return [current.id, current.projectGeneration, current.settingsRevision, current.sourceRevision, current.selectionRevision].join(':');
  }

  function previewIsCurrent(current, key) {
    return current === session()
      && current.projectGeneration === (dependencies.projectDomain?.getGeneration?.() ?? current.projectGeneration)
      && key === previewKey(current);
  }

  function touchSelection(current = session(), { discard = true } = {}) {
    if (!current) return;
    cancelPreview({ discard });
    current.selectionRevision += 1;
    current.previewReadyKey = null;
  }

  function clearCurrentSelection(current = session(), { clearDraft = true, refreshUi = false } = {}) {
    if (!current) return false;
    touchSelection(current);
    if (clearDraft) dependencies.editingDomain?.clearDraft?.({ reason: 'territory-selection-current-clear', render: false });
    current.activePhase = null;
    current.activeMethod = null;
    current.requestedMethod = null;
    current.methodChangeConfirmation = null;
    current.componentIndex = null;
    current.candidates = [];
    current.selectedCandidateIndex = null;
    current.selectedComponentKeys = [];
    current.hoveredComponentKey = null;
    current.currentGeometry = null;
    current.useRiverBoundaries = false;
    current.riverPartitionStatus = 'idle';
    current.riverPartitionCandidates = [];
    current.riverPartitionDonorResults = [];
    (0, dependencies.resetRiverPartitionState)();
    refreshCombinedGeometry(current);
    if (refreshUi) refresh('territory-selection-current-clear');
    return true;
  }

  function resetSelection(current = session(), { keepRequestedMethod = true, refreshUi = true } = {}) {
    if (!current) return false;
    const requestedMethod = current.requestedMethod;
    clearCurrentSelection(current, { refreshUi: false });
    current.requestedMethod = keepRequestedMethod ? requestedMethod : null;
    current.parts = [];
    current.componentSnapshots = [];
    current.baseSourceFeatures = [];
    current.combinedGeometry = null;
    current.baseSourceGeometry = null;
    current.workingSourceGeometry = null;
    current.remainingGeometry = null;
    current.sourceInfo = null;
    if (refreshUi) refresh('territory-selection-reset');
    return true;
  }

  function setupValid(current = session()) {
    return !!current && adapterFor(current)?.validateSetup?.(current) === true;
  }

  function draftCoordinates() {
    return (0, dependencies.editingDraftCoordinates)() || [];
  }

  function activeCurrentWork(current = session()) {
    return !!current && (!!current.currentGeometry || current.candidates.length > 0
      || current.selectedComponentKeys.length > 0 || draftCoordinates().length > 0
      || dependencies.editingDomain?.draftInputActive?.());
  }

  function currentSelectionSnapshot(current) {
    return {
      activePhase: current.activePhase,
      activeMethod: current.activeMethod,
      requestedMethod: current.requestedMethod,
      methodChangeConfirmation: current.methodChangeConfirmation,
      componentIndex: current.componentIndex,
      candidates: structuredClone(current.candidates),
      selectedCandidateIndex: current.selectedCandidateIndex,
      selectedComponentKeys: [...current.selectedComponentKeys],
      componentFeatures: structuredClone(current.componentFeatures),
      hoveredComponentKey: current.hoveredComponentKey,
      currentGeometry: structuredClone(current.currentGeometry),
      useRiverBoundaries: current.useRiverBoundaries,
      riverPartitionStatus: current.riverPartitionStatus,
      riverPartitionCandidates: structuredClone(current.riverPartitionCandidates),
      riverPartitionDonorResults: structuredClone(current.riverPartitionDonorResults),
      draftCoords: structuredClone(draftCoordinates()),
    };
  }

  function restoreCurrentSelection(current, snapshot) {
    Object.assign(current, {
      activePhase: snapshot.activePhase,
      activeMethod: snapshot.activeMethod,
      requestedMethod: snapshot.requestedMethod,
      methodChangeConfirmation: snapshot.methodChangeConfirmation,
      componentIndex: snapshot.componentIndex,
      candidates: snapshot.candidates,
      selectedCandidateIndex: snapshot.selectedCandidateIndex,
      selectedComponentKeys: snapshot.selectedComponentKeys,
      componentFeatures: snapshot.componentFeatures,
      hoveredComponentKey: snapshot.hoveredComponentKey,
      currentGeometry: snapshot.currentGeometry,
      useRiverBoundaries: snapshot.useRiverBoundaries,
      riverPartitionStatus: snapshot.riverPartitionStatus,
      riverPartitionCandidates: snapshot.riverPartitionCandidates,
      riverPartitionDonorResults: snapshot.riverPartitionDonorResults,
    });
    dependencies.editingDomain?.replaceDraftCoordinates?.(snapshot.draftCoords, { record: false, inputPhase: 'refine' });
    refreshCombinedGeometry(current);
  }

  function archivedGeometry(current) {
    const pieces = current.parts.map(part => part.geometry).filter(Boolean);
    if (!pieces.length) return null;
    try {
      const coordinates = pieces.flatMap(geometry => (0, dependencies.geometryMultiCoordinates)(geometry));
      const union = window.polygonClipping?.union ? window.polygonClipping.union(...coordinates) : coordinates;
      return (0, dependencies.normalizeClippedLandGeometry)(union);
    } catch (error) {
      (0, dependencies.reportOperationError)(error, '보관한 영역을 준비하지 못했습니다.', 'PL-TERRITORY-SELECTION-002', 3800);
      return null;
    }
  }

  function differenceGeometry(base, removed) {
    if (!base) return null;
    if (!removed) return structuredClone(base);
    return (0, dependencies.normalizeClippedLandGeometry)(window.polygonClipping.difference(
      (0, dependencies.geometryMultiCoordinates)(base),
      (0, dependencies.geometryMultiCoordinates)(removed),
    ));
  }

  function rebuildComponentFeatures(current, removed) {
    if (!current.baseSourceFeatures.length) return;
    current.componentFeatures = current.baseSourceFeatures.map(feature => {
      const geometry = differenceGeometry(feature.geometry, removed);
      return geometry ? { ...structuredClone(feature), geometry } : null;
    }).filter(Boolean);
  }

  function rebuildWorkingSource(current) {
    const archived = archivedGeometry(current);
    try {
      current.workingSourceGeometry = differenceGeometry(current.baseSourceGeometry, archived);
      current.remainingGeometry = current.activePhase !== 'components' && current.currentGeometry && current.workingSourceGeometry
        ? differenceGeometry(current.workingSourceGeometry, current.currentGeometry)
        : current.workingSourceGeometry;
      rebuildComponentFeatures(current, archived);
      return true;
    } catch (error) {
      current.workingSourceGeometry = null;
      current.remainingGeometry = null;
      (0, dependencies.reportOperationError)(
        error,
        '보관한 영역을 제외한 기준 영역을 계산하지 못했습니다. 선택을 다시 확인하세요.',
        'PL-TERRITORY-SELECTION-003',
        3800,
      );
      return false;
    }
  }

  function sourceFeaturesFromPreparedSession(current) {
    if (current.baseSourceFeatures.length) return;
    const supplied = Array.isArray(current.componentFeatures) ? current.componentFeatures.filter(feature => feature?.geometry) : [];
    if (supplied.length) current.baseSourceFeatures = structuredClone(supplied).map(feature => ({
      ...feature,
      properties: {
        ...(feature.properties || {}),
        __territorySourcePolygons: (0, dependencies.geometryMultiCoordinates)(feature.geometry),
      },
    }));
    else if (current.baseSourceGeometry) current.baseSourceFeatures = [{
      type: 'Feature',
      id: String(current.sourceInfo?.source?.id || current.sourceInfo?.feature?.id || current.sourceCountryIds[0] || 'territory-source'),
      properties: { __territorySourcePolygons: (0, dependencies.geometryMultiCoordinates)(current.baseSourceGeometry) },
      geometry: structuredClone(current.baseSourceGeometry),
    }];
  }

  async function activateMethod(current, method) {
    if (!current || !['line', 'polygon', 'components'].includes(method)) return false;
    const previous = currentSelectionSnapshot(current);
    clearCurrentSelection(current, { refreshUi: false });
    current.activeMethod = method;
    current.activePhase = 'preparing';
    const prepared = await adapterFor(current)?.prepareSelection?.(current);
    if (current !== session()) return false;
    if (!prepared) {
      restoreCurrentSelection(current, previous);
      refresh('territory-selection-prepare-failed');
      return false;
    }
    sourceFeaturesFromPreparedSession(current);
    if (!rebuildWorkingSource(current)) {
      restoreCurrentSelection(current, previous);
      refresh('territory-selection-source-rebuild-failed');
      return false;
    }
    current.activePhase = method === 'components' ? 'components' : 'drawing';
    if (current.activePhase === 'drawing') {
      dependencies.editingDomain?.startDraft?.({ coords: [] });
      (0, dependencies.setModeBanner)((0, dependencies.defaultDraftInstruction)());
    } else {
      (0, dependencies.updateTerritoryComponentSelectionFeedback)();
      dependencies.editingDomain?.refreshTerritorySelection?.({
        tool: current.tool,
        reason: 'territory-selection-components-ready',
      });
    }
    refresh('territory-selection-ready');
    return true;
  }

  async function advance() {
    const current = session();
    if (!current) return false;
    if (current.stage === 'setup') {
      if (!setupValid(current)) return false;
      current.name = current.name.trim();
      current.stage = 'selection';
      (0, dependencies.setModeBanner)('');
      if (!dependencies.state.geometryPreview.session && selectionGeometryReady(current)) schedulePreview();
      refresh('territory-selection-open');
      return true;
    }
    if (current.stage !== 'selection' || !previewReady(current)) return false;
    current.stage = 'review';
    (0, dependencies.setModeBanner)('');
    refresh('territory-selection-review');
    return true;
  }

  function back() {
    const current = session();
    if (!current) return false;
    if (current.methodChangeConfirmation) {
      current.methodChangeConfirmation = null;
      current.requestedMethod = current.activeMethod || current.requestedMethod;
      refresh('territory-selection-method-change-kept');
      return true;
    }
    if (current.stage === 'review') {
      current.stage = 'selection';
      (0, dependencies.setModeBanner)('');
      refresh('territory-selection-back-selection');
      return true;
    }
    if (current.stage === 'selection') {
      cancelPreview({ discard: false, preserveReady: true });
      current.stage = 'setup';
      (0, dependencies.setModeBanner)('');
      refresh('territory-selection-back-setup');
      return true;
    }
    return false;
  }

  async function selectMethod(method) {
    const current = session();
    if (!current || current.stage !== 'selection' || !['line', 'polygon', 'components'].includes(method)) return false;
    if (current.activeMethod === method && current.activePhase !== 'source') return true;
    current.requestedMethod = method;
    if (current.activeMethod && current.activeMethod !== method && activeCurrentWork(current)) {
      current.methodChangeConfirmation = { type: 'method', method };
      refresh('territory-selection-method-change-confirm');
      return false;
    }
    if (current.methodsRequiringSources.includes(method) && !current.sourceCountryIds.length) {
      current.activePhase = 'source';
      refresh('territory-selection-source-required');
      return false;
    }
    return activateMethod(current, method);
  }

  async function confirmMethodChange() {
    const current = session();
    const confirmation = current?.methodChangeConfirmation;
    if (!current || !confirmation) return false;
    if (confirmation.type === 'settings') {
      current.methodChangeConfirmation = null;
      return applySourceCountryToggle(current, confirmation.countryId, { reset: true });
    }
    const requested = confirmation.method;
    if (current.stage !== 'selection' || !requested) return false;
    current.methodChangeConfirmation = null;
    const started = await activateMethod(current, requested);
    if (!started && current === session()) {
      current.requestedMethod = current.activeMethod || requested;
    }
    return started;
  }

  function cancelMethodChange() {
    const current = session();
    if (!current?.methodChangeConfirmation) return false;
    const wasMethodChange = current.methodChangeConfirmation.type === 'method';
    current.methodChangeConfirmation = null;
    if (wasMethodChange) {
      current.requestedMethod = current.activeMethod || current.requestedMethod;
    }
    refresh('territory-selection-method-change-kept');
    return true;
  }

  async function startReferenceMethod() {
    const current = session();
    if (!current || current.stage !== 'selection' || current.activePhase !== 'source' || !current.requestedMethod) return false;
    if (!current.sourceCountryIds.length) return false;
    return activateMethod(current, current.requestedMethod);
  }

  function updateName(value) {
    const current = session();
    if (!current || !adapterFor(current)?.supportsName) return false;
    const next = String(value ?? '');
    if (current.name === next) return true;
    current.name = next;
    current.settingsRevision += 1;
    current.previewReadyKey = null;
    if (current.stage === 'selection' && selectionGeometryReady(current)) schedulePreview();
    else refresh('territory-selection-name');
    return true;
  }

  function countryPickingActive(current = session()) {
    return !!current && ((current.stage === 'setup' && current.setupCountryPicking)
      || (current.stage === 'selection' && current.activePhase === 'source'
        && current.methodsRequiringSources.includes(current.requestedMethod)));
  }

  function toggleSourceCountry(countryId) {
    const current = session();
    const id = text(countryId);
    if (!countryPickingActive(current) || !id || !(0, dependencies.countryFeatureById)(id)) return false;
    const adapter = adapterFor(current);
    if (adapter?.canUseSource?.(current, id) !== true) {
      if (adapter?.sourceRejectedMessage) (0, dependencies.setActionStatus)(adapter.sourceRejectedMessage, 'error', 3000);
      return false;
    }
    const firstRegionReference = current.kind === 'region' && current.stage === 'selection'
      && current.activePhase === 'source' && current.sourceCountryIds.length === 0;
    if ((current.parts.length || activeCurrentWork(current)) && current.stage !== 'setup' && !firstRegionReference) {
      current.methodChangeConfirmation = { type: 'settings', countryId: id };
      refresh('territory-selection-settings-change-confirm');
      return true;
    }
    return applySourceCountryToggle(current, id, { reset: !!current.activeMethod });
  }

  function applySourceCountryToggle(current, id, { reset = false } = {}) {
    const adapter = adapterFor(current);
    if (!current || !id || adapter?.canUseSource?.(current, id) !== true) return false;
    const selected = new Set(current.sourceCountryIds.map(text));
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    current.sourceCountryIds = [...selected];
    current.settingsRevision += 1;
    if (reset) {
      const requestedMethod = current.requestedMethod;
      resetSelection(current, { keepRequestedMethod: true, refreshUi: false });
      current.requestedMethod = requestedMethod;
      current.stage = 'selection';
    }
    refresh('territory-selection-source-country');
    return true;
  }

  function sourceCountryInstruction(current = session()) {
    return current ? adapterFor(current)?.sourceInstruction || '' : '';
  }

  function finishDraft() {
    const current = session();
    if (!current || current.stage !== 'selection' || current.activePhase !== 'drawing'
      || !['line', 'polygon'].includes(current.activeMethod)) return false;
    if (!dependencies.editingDraftCoordinates().length && current.parts.length) {
      current.currentGeometry = null;
      current.candidates = [];
      current.selectedCandidateIndex = null;
      current.activePhase = 'result';
      dependencies.editingDomain?.clearDraft?.({ reason: 'territory-selection-parts-review', render: false });
      refreshCombinedGeometry(current);
      if (!previewReady(current)) schedulePreview();
      refresh('territory-selection-parts-review');
      return true;
    }
    return adapterFor(current)?.finishDraft?.(current) || false;
  }

  function combineSelectionGeometry(current = session()) {
    if (!current) return null;
    const pieces = [...current.parts.map(part => part.geometry), current.currentGeometry].filter(Boolean);
    if (!pieces.length) return null;
    try {
      const coordinates = pieces.flatMap(geometry => (0, dependencies.geometryMultiCoordinates)(geometry));
      const union = window.polygonClipping?.union ? window.polygonClipping.union(...coordinates) : coordinates;
      return (0, dependencies.normalizeClippedLandGeometry)(union);
    } catch (error) {
      (0, dependencies.reportOperationError)(error, '여러 영역을 하나로 준비하지 못했습니다. 겹치는 경계를 확인하세요.', 'PL-TERRITORY-SELECTION-001', 3800);
      return null;
    }
  }

  function refreshCombinedGeometry(current = session()) {
    if (!current) return null;
    current.combinedGeometry = combineSelectionGeometry(current);
    rebuildWorkingSource(current);
    return current.combinedGeometry;
  }

  function setCurrentCandidates(candidates, selectedIndex = 0) {
    const current = session();
    if (!current || current.stage !== 'selection') return false;
    touchSelection(current);
    current.candidates = Array.isArray(candidates) ? candidates : [];
    current.selectedCandidateIndex = Number.isInteger(selectedIndex) ? selectedIndex : null;
    current.currentGeometry = current.candidates[current.selectedCandidateIndex]?.geometry || null;
    current.activePhase = 'candidate';
    refreshCombinedGeometry(current);
    dependencies.editingDomain?.clearDraft?.({ reason: 'territory-selection-candidate-ready', render: false });
    if (current.currentGeometry) schedulePreview();
    refresh('territory-selection-candidates');
    return !!current.currentGeometry;
  }

  function selectCandidate(candidateIndex) {
    const current = session();
    const index = Number(candidateIndex);
    if (!current || current.stage !== 'selection' || current.activePhase !== 'candidate' || !current.candidates[index]?.geometry) return false;
    touchSelection(current);
    current.selectedCandidateIndex = index;
    current.currentGeometry = current.candidates[index].geometry;
    refreshCombinedGeometry(current);
    (0, dependencies.setModeBanner)('선택한 영역을 확인하세요.');
    schedulePreview();
    refresh('territory-selection-candidate');
    return true;
  }

  function toggleComponent(componentKey) {
    const current = session();
    if (!current || current.stage !== 'selection' || current.activePhase !== 'components') return false;
    const available = new Set((0, dependencies.territoryComponentItems)().map(item => item.key));
    if (!available.has(componentKey)) return false;
    touchSelection(current);
    const selected = new Set(current.selectedComponentKeys);
    if (selected.has(componentKey)) selected.delete(componentKey); else selected.add(componentKey);
    current.selectedComponentKeys = [...selected];
    try { current.currentGeometry = selected.size ? (0, dependencies.selectedTerritoryComponentGeometry)() : null; }
    catch { current.currentGeometry = null; }
    refreshCombinedGeometry(current);
    (0, dependencies.updateTerritoryComponentSelectionFeedback)();
    if (current.currentGeometry) schedulePreview();
    refresh('territory-selection-component');
    return true;
  }

  function toggleRiverBoundaries(enabled) {
    const current = session();
    if (!current || current.stage !== 'selection' || current.activePhase !== 'components') return false;
    const next = enabled === true;
    if (current.useRiverBoundaries === next) return true;
    touchSelection(current);
    current.useRiverBoundaries = next;
    current.selectedComponentKeys = [];
    current.currentGeometry = null;
    current.hoveredComponentKey = null;
    refreshCombinedGeometry(current);
    (0, dependencies.resetRiverPartitionState)();
    if (next) void (0, dependencies.prepareRiverPartitionCandidates)();
    else (0, dependencies.updateTerritoryComponentSelectionFeedback)();
    dependencies.editingDomain?.refreshTerritorySelection?.({
      tool: current.tool,
      reason: 'territory-selection-river-toggle',
    });
    refresh('territory-selection-river');
    return true;
  }

  function startNextDraft(current) {
    current.activePhase = 'drawing';
    dependencies.editingDomain?.startDraft?.({ coords: [] });
    (0, dependencies.setModeBanner)((0, dependencies.defaultDraftInstruction)());
    refresh('territory-selection-next-part');
  }

  function addPart() {
    const current = session();
    if (!canAddPart(current)) return false;
    refreshCombinedGeometry(current);
    touchSelection(current);
    if (current.activePhase === 'components') {
      const selected = new Set(current.selectedComponentKeys);
      const allItems = (0, dependencies.territoryComponentItems)();
      const snapshotId = (0, dependencies.uid)('territory-component-snapshot');
      current.componentSnapshots.push({ id: snapshotId, items: structuredClone(allItems) });
      const selectedItems = allItems.filter(item => selected.has(item.key));
      current.parts.push(...selectedItems.map(item => ({
        id: (0, dependencies.uid)('territory-part'),
        method: 'components',
        geometry: structuredClone(item.geometry),
        component: { ...structuredClone(item), snapshotId },
      })));
    } else {
      current.parts.push({
        id: (0, dependencies.uid)('territory-part'),
        method: current.activeMethod,
        geometry: structuredClone(current.currentGeometry),
      });
    }
    current.currentGeometry = null;
    current.candidates = [];
    current.selectedCandidateIndex = null;
    current.selectedComponentKeys = [];
    current.hoveredComponentKey = null;
    current.activeMethod = null;
    current.requestedMethod = null;
    current.activePhase = null;
    current.useRiverBoundaries = false;
    (0, dependencies.resetRiverPartitionState)();
    refreshCombinedGeometry(current);
    schedulePreview();
    dependencies.editingDomain?.clearDraft?.({ reason: 'territory-selection-part-archived', render: false });
    refresh('territory-selection-part-archived');
    return true;
  }

  function undoPart() {
    const current = session();
    if (!current || current.stage !== 'selection'
      || dependencies.editingDomain?.draftInputActive?.() && (0, dependencies.editingDraftCoordinates)().length) return false;
    if (!current.currentGeometry && !current.parts.length && !current.selectedComponentKeys.length) return false;
    touchSelection(current);
    if (current.activePhase === 'components' && current.selectedComponentKeys.length) {
      current.selectedComponentKeys.pop();
      try { current.currentGeometry = current.selectedComponentKeys.length ? (0, dependencies.selectedTerritoryComponentGeometry)() : null; }
      catch { current.currentGeometry = null; }
      (0, dependencies.updateTerritoryComponentSelectionFeedback)();
    } else if (current.currentGeometry) {
      current.currentGeometry = null;
    } else {
      current.parts.pop();
      const referencedSnapshots = new Set(current.parts.map(part => part.component?.snapshotId).filter(Boolean));
      current.componentSnapshots = current.componentSnapshots.filter(snapshot => referencedSnapshots.has(snapshot.id));
    }
    current.candidates = [];
    current.selectedCandidateIndex = null;
    refreshCombinedGeometry(current);
    if (selectionGeometryReady(current)) schedulePreview();
    refresh('territory-selection-part-undone');
    return true;
  }

  function redraw() {
    const current = session();
    if (!current || current.stage !== 'selection' || current.activePhase === 'components') return false;
    touchSelection(current);
    current.currentGeometry = null;
    current.candidates = [];
    current.selectedCandidateIndex = null;
    refreshCombinedGeometry(current);
    startNextDraft(current);
    return true;
  }

  function partCount(current = session()) {
    if (!current) return 0;
    return current.parts.length + (current.activePhase === 'components'
      ? current.selectedComponentKeys.length
      : current.currentGeometry ? 1 : 0);
  }

  function canAddPart(current = session()) {
    if (!current || current.stage !== 'selection' || !current.currentGeometry || !previewReady(current)) return false;
    if (!['candidate', 'components', 'result'].includes(current.activePhase)) return false;
    return current.unboundedMethods.includes(current.activeMethod) || !!current.remainingGeometry;
  }

  function selectionGeometryReady(current = session()) {
    if (!current || !['selection', 'review'].includes(current.stage)) return false;
    if (current.stage === 'review') return !!current.combinedGeometry && !dependencies.editingDomain?.draftInputActive?.();
    if (current.activePhase === 'components') {
      return (!current.useRiverBoundaries || current.riverPartitionStatus === 'ready') && current.selectedComponentKeys.length > 0 && !!current.currentGeometry;
    }
    if (current.activePhase === 'drawing' || current.activePhase === 'source' || current.activePhase === 'preparing') return false;
    return !!current.combinedGeometry && !dependencies.editingDomain?.draftInputActive?.();
  }

  function schedulePreview({ delay = 300 } = {}) {
    const current = session();
    if (!selectionGeometryReady(current)) return false;
    cancelPreview({ discard: true });
    const generation = previewGeneration;
    const key = previewKey(current);
    current.previewPending = true;
    refresh('territory-selection-preview-pending');
    previewTimer = setTimeout(async () => {
      previewTimer = null;
      if (generation !== previewGeneration || !previewIsCurrent(current, key)) return;
      if (!selectionGeometryReady(current)) {
        current.previewPending = false;
        refresh('territory-selection-preview-deferred');
        return;
      }
      let prepared = false;
      try {
        prepared = await adapterFor(current)?.preview?.(current, key) === true;
      } catch (error) {
        if (previewIsCurrent(current, key)) {
          (0, dependencies.reportOperationError)(
            error,
            '선택한 영역의 결과를 준비하지 못했습니다. 영역을 다시 선택하세요.',
            'PL-TERRITORY-PREVIEW-001',
            3800,
          );
        }
      } finally {
        if (previewIsCurrent(current, key)) {
          current.previewPending = false;
          current.previewReadyKey = prepared && dependencies.state.geometryPreview.session ? key : null;
          refresh('territory-selection-preview-ready');
        }
      }
    }, Math.max(0, Number(delay) || 0));
    return true;
  }

  function previewReady(current = session()) {
    return !!current && current.previewReadyKey === previewKey(current)
      && !current.previewPending
      && selectionGeometryReady(current)
      && !!dependencies.state.geometryPreview.session
      && dependencies.state.geometryPreview.session.validation?.blocking !== true;
  }

  async function apply() {
    const current = session();
    if (!current || current.stage !== 'review' || current.applying || !previewReady(current)) return false;
    current.applying = true;
    refresh('territory-selection-applying');
    try {
      const applied = await (0, dependencies.applyActiveGeometryPreview)();
      if (!applied) return false;
      if (session() === current) {
        (0, dependencies.resetRiverPartitionState)();
        dependencies.state.territorySelectionSession = null;
      }
      return true;
    } finally {
      if (session() === current) current.applying = false;
      refresh('territory-selection-apply-finished');
    }
  }

  function presentation(current = session()) {
    if (!current) return null;
    const adapter = adapterFor(current);
    if (!adapter) return null;
    const step = current.stage === 'setup' ? 1 : current.stage === 'selection' ? 2 : 3;
    const stageLabel = current.stage === 'setup' ? current.setupStageLabel
      : current.stage === 'selection' ? '영역 선택' : '결과 확인';
    const count = partCount(current);
    const primaryLabel = current.stage === 'review'
      ? adapter.finalLabel(count)
      : '다음';
    return {
      current,
      step,
      taskName: `${current.taskLabel} ${step}단계`,
      stageLabel,
      setup: current.stage === 'setup',
      selection: current.stage === 'selection',
      review: current.stage === 'review',
      line: current.stage === 'selection' && current.activePhase === 'drawing' && current.activeMethod === 'line',
      polygon: current.stage === 'selection' && current.activePhase === 'drawing' && current.activeMethod === 'polygon',
      candidate: current.stage === 'selection' && current.activePhase === 'candidate',
      result: current.stage === 'selection' && current.activePhase === 'result',
      components: current.stage === 'selection' && current.activePhase === 'components',
      activeMethod: current.activeMethod || current.requestedMethod,
      showSetup: current.stage === 'setup' && adapter.showSetup,
      showReviewSummary: current.stage === 'review' && adapter.supportsName,
      reviewName: current.name.trim(),
      reviewSovereignId: current.sovereignId,
      reviewParentId: current.parentId,
      showName: current.stage === 'setup' && adapter.supportsName,
      nameLabel: adapter.nameLabel,
      referenceLabel: adapter.referenceLabel,
      showSubunitFields: current.stage === 'setup' && adapter.showSubunitFields,
      showReference: adapter.showReference(current)
        || current.stage === 'selection' && current.activePhase === 'source',
      showCountryFlow: adapter.showCountryFlow,
      showMethods: current.stage === 'selection',
      showReferenceStart: current.stage === 'selection' && current.activePhase === 'source',
      showMethodChangeConfirmation: !!current.methodChangeConfirmation,
      methodChangeConfirmationMessage: current.methodChangeConfirmation?.type === 'settings'
        ? '선택한 영역을 모두 지우고 설정을 바꿀까요?'
        : '현재 영역을 버리고 방식을 바꿀까요?',
      showRiver: current.stage === 'selection' && current.activePhase === 'components',
      showDrawnActions: current.stage === 'selection' && (current.parts.length > 0
        || ['candidate', 'components', 'result'].includes(current.activePhase)),
      count,
      canAddPart: canAddPart(current),
      canUndoPart: current.stage === 'selection' && !dependencies.editingDomain?.draftInputActive?.()
        && (current.selectedComponentKeys.length > 0 || !!current.currentGeometry || current.parts.length > 0),
      primaryLabel,
      primaryIcon: current.stage === 'review' ? '#icon-check' : '#icon-chevron-right',
      primaryDisabled: current.applying || current.previewPending
        || current.stage === 'setup' && !setupValid(current)
        || current.stage === 'selection' && !previewReady(current)
        || current.stage === 'review' && !previewReady(current),
      cancelLabel: current.stage === 'setup' ? '취소' : '뒤로',
      cancelIcon: current.stage === 'setup' ? '#icon-close' : '#icon-chevron-left',
      referenceCount: current.sourceCountryIds.length,
    };
  }

  return Object.freeze({
    connect,
    initializeTerritorySelectionWorkflow,
    get activeSession() { return session; },
    get addPart() { return addPart; },
    get advance() { return advance; },
    get apply() { return apply; },
    get back() { return back; },
    get canAddPart() { return canAddPart; },
    get cancelMethodChange() { return cancelMethodChange; },
    get cancelPreview() { return cancelPreview; },
    get clear() { return clear; },
    get confirmMethodChange() { return confirmMethodChange; },
    get countryPickingActive() { return countryPickingActive; },
    get finishDraft() { return finishDraft; },
    get partCount() { return partCount; },
    get presentation() { return presentation; },
    get previewIsCurrent() { return previewIsCurrent; },
    get previewKey() { return previewKey; },
    get previewReady() { return previewReady; },
    get redraw() { return redraw; },
    get refreshCombinedGeometry() { return refreshCombinedGeometry; },
    get resetSelection() { return resetSelection; },
    get schedulePreview() { return schedulePreview; },
    get selectCandidate() { return selectCandidate; },
    get selectMethod() { return selectMethod; },
    get setCurrentCandidates() { return setCurrentCandidates; },
    get setupValid() { return setupValid; },
    get sourceCountryInstruction() { return sourceCountryInstruction; },
    get startReferenceMethod() { return startReferenceMethod; },
    get start() { return start; },
    get toggleComponent() { return toggleComponent; },
    get toggleRiverBoundaries() { return toggleRiverBoundaries; },
    get toggleSourceCountry() { return toggleSourceCountry; },
    get touchSelection() { return touchSelection; },
    get undoPart() { return undoPart; },
    get updateName() { return updateName; },
  });
}
