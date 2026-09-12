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
      methodCountryPickingMethods: [...definition.methodCountryPickingMethods],
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
      selectionPhase: null,
      resumeSelectionPhase: null,
      method: null,
      pendingMethod: null,
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
        generatedIdPrefix: '',
        supportsName: false,
        showSetup: false,
        showSubunitFields: false,
        setupCountryPicking: true,
        methodCountryPickingMethods: [],
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
        generatedIdPrefix: 'USR',
        supportsName: true,
        showSetup: true,
        showSubunitFields: false,
        setupCountryPicking: true,
        methodCountryPickingMethods: [],
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
        sourceInstruction: '기준 국가를 선택할 수 없습니다. 국가 영토 안쪽을 선택하세요.',
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
        generatedIdPrefix: 'subunit',
        supportsName: true,
        showSetup: true,
        showSubunitFields: true,
        setupCountryPicking: false,
        methodCountryPickingMethods: [],
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
        generatedIdPrefix: 'region',
        supportsName: true,
        showSetup: true,
        showSubunitFields: false,
        setupCountryPicking: false,
        methodCountryPickingMethods: ['line', 'components'],
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
        showReference: current => current.stage === 'method' && ['line', 'components'].includes(current.pendingMethod),
        showCountryFlow: false,
        finalLabel: () => '생성',
        sourceInstruction: '기준 국가를 선택할 수 없습니다. 국가 영토 안쪽을 선택하세요.',
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

  function resetSelection(current = session(), { keepPendingMethod = true, refreshUi = true } = {}) {
    if (!current) return false;
    touchSelection(current);
    dependencies.editingDomain?.clearDraft?.({ reason: 'territory-selection-reset', render: false });
    current.selectionPhase = null;
    current.resumeSelectionPhase = null;
    current.method = null;
    if (!keepPendingMethod) current.pendingMethod = null;
    current.componentIndex = null;
    current.candidates = [];
    current.selectedCandidateIndex = null;
    current.selectedComponentKeys = [];
    current.componentFeatures = [];
    current.hoveredComponentKey = null;
    current.parts = [];
    current.currentGeometry = null;
    current.combinedGeometry = null;
    current.baseSourceGeometry = null;
    current.workingSourceGeometry = null;
    current.remainingGeometry = null;
    current.sourceInfo = null;
    current.useRiverBoundaries = false;
    current.riverPartitionStatus = 'idle';
    current.riverPartitionCandidates = [];
    current.riverPartitionDonorResults = [];
    (0, dependencies.resetRiverPartitionState)();
    if (refreshUi) refresh('territory-selection-reset');
    return true;
  }

  function setupValid(current = session()) {
    return !!current && adapterFor(current)?.validateSetup?.(current) === true;
  }

  function methodValid(current = session()) {
    if (!current?.pendingMethod || !['line', 'polygon', 'components'].includes(current.pendingMethod)) return false;
    return !current.methodsRequiringSources.includes(current.pendingMethod) || current.sourceCountryIds.length > 0;
  }

  async function advance() {
    const current = session();
    if (!current) return false;
    if (current.stage === 'setup') {
      if (!setupValid(current)) return false;
      current.name = current.name.trim();
      current.stage = 'method';
      current.selectionPhase = null;
      (0, dependencies.setModeBanner)('');
      refresh('territory-selection-method');
      return true;
    }
    if (current.stage !== 'method' || !methodValid(current)) return false;
    if (current.method === current.pendingMethod && current.resumeSelectionPhase) {
      current.stage = 'selection';
      current.selectionPhase = current.resumeSelectionPhase;
      current.resumeSelectionPhase = null;
      refresh('territory-selection-restored');
      if (!dependencies.state.geometryPreview.session && selectionGeometryReady(current)) schedulePreview();
      return true;
    }
    resetSelection(current, { keepPendingMethod: true, refreshUi: false });
    current.method = current.pendingMethod;
    const prepared = await adapterFor(current)?.prepareSelection?.(current);
    if (!prepared) {
      current.stage = 'method';
      current.selectionPhase = null;
      refresh('territory-selection-prepare-failed');
      return false;
    }
    current.stage = 'selection';
    current.selectionPhase = current.method === 'components' ? 'components' : current.method;
    refresh('territory-selection-ready');
    return true;
  }

  function back() {
    const current = session();
    if (!current) return false;
    if (current.stage === 'selection') {
      cancelPreview({ discard: false, preserveReady: true });
      current.resumeSelectionPhase = current.selectionPhase;
      current.stage = 'method';
      current.selectionPhase = null;
      (0, dependencies.setModeBanner)('');
      refresh('territory-selection-back-method');
      return true;
    }
    if (current.stage === 'method') {
      current.stage = 'setup';
      current.selectionPhase = null;
      (0, dependencies.setModeBanner)('');
      refresh('territory-selection-back-setup');
      return true;
    }
    return false;
  }

  function selectMethod(method) {
    const current = session();
    if (!current || current.stage !== 'method' || !['line', 'polygon', 'components'].includes(method)) return false;
    if (current.pendingMethod === method) return true;
    if (current.method && current.method !== method) resetSelection(current, { keepPendingMethod: false, refreshUi: false });
    current.pendingMethod = method;
    refresh('territory-selection-method-changed');
    return true;
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
      || (current.stage === 'method' && current.methodCountryPickingMethods.includes(current.pendingMethod)));
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
    const selected = new Set(current.sourceCountryIds.map(text));
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    current.sourceCountryIds = [...selected];
    current.settingsRevision += 1;
    if (current.method || current.resumeSelectionPhase) resetSelection(current, { keepPendingMethod: true, refreshUi: false });
    refresh('territory-selection-source-country');
    return true;
  }

  function sourceCountryInstruction(current = session()) {
    return current ? adapterFor(current)?.sourceInstruction || '' : '';
  }

  function finishDraft() {
    const current = session();
    if (!current || current.stage !== 'selection' || !['line', 'polygon'].includes(current.selectionPhase)) return false;
    if (!dependencies.editingDraftCoordinates().length && current.parts.length) {
      current.currentGeometry = null;
      current.candidates = [];
      current.selectedCandidateIndex = null;
      current.selectionPhase = 'side';
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
    current.remainingGeometry = current.currentGeometry && current.workingSourceGeometry
      ? (0, dependencies.normalizeClippedLandGeometry)(window.polygonClipping.difference(
        (0, dependencies.geometryMultiCoordinates)(current.workingSourceGeometry),
        (0, dependencies.geometryMultiCoordinates)(current.currentGeometry),
      )) : current.workingSourceGeometry;
    return current.combinedGeometry;
  }

  function setCurrentCandidates(candidates, selectedIndex = 0, phase = 'side') {
    const current = session();
    if (!current || current.stage !== 'selection') return false;
    touchSelection(current);
    current.candidates = Array.isArray(candidates) ? candidates : [];
    current.selectedCandidateIndex = Number.isInteger(selectedIndex) ? selectedIndex : null;
    current.currentGeometry = current.candidates[current.selectedCandidateIndex]?.geometry || null;
    current.selectionPhase = phase;
    refreshCombinedGeometry(current);
    dependencies.editingDomain?.clearDraft?.({ reason: 'territory-selection-candidate-ready', render: false });
    if (current.currentGeometry) schedulePreview();
    refresh('territory-selection-candidates');
    return !!current.currentGeometry;
  }

  function selectCandidate(candidateIndex) {
    const current = session();
    const index = Number(candidateIndex);
    if (!current || current.stage !== 'selection' || current.selectionPhase !== 'side' || !current.candidates[index]?.geometry) return false;
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
    if (!current || current.stage !== 'selection' || current.selectionPhase !== 'components') return false;
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
    if (!current || current.stage !== 'selection' || current.selectionPhase !== 'components') return false;
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
    refresh('territory-selection-river');
    return true;
  }

  function startNextDraft(current) {
    current.selectionPhase = current.method;
    dependencies.editingDomain?.startDraft?.({ coords: [] });
    (0, dependencies.setModeBanner)((0, dependencies.defaultDraftInstruction)());
    refresh('territory-selection-next-part');
  }

  function addPart() {
    const current = session();
    if (!canAddPart(current)) return false;
    refreshCombinedGeometry(current);
    touchSelection(current);
    current.parts.push({ geometry: current.currentGeometry, sourceGeometry: current.workingSourceGeometry });
    if (current.workingSourceGeometry) current.workingSourceGeometry = current.remainingGeometry;
    current.currentGeometry = null;
    current.candidates = [];
    current.selectedCandidateIndex = null;
    refreshCombinedGeometry(current);
    schedulePreview();
    startNextDraft(current);
    return true;
  }

  function undoPart() {
    const current = session();
    if (!current || current.stage !== 'selection' || current.selectionPhase === 'components'
      || dependencies.editingDomain?.draftInputActive?.() && (0, dependencies.editingDraftCoordinates)().length) return false;
    if (!current.currentGeometry && !current.parts.length) return false;
    touchSelection(current);
    if (current.currentGeometry) {
      current.currentGeometry = null;
    } else {
      const last = current.parts.pop();
      if (last?.sourceGeometry) current.workingSourceGeometry = last.sourceGeometry;
    }
    current.candidates = [];
    current.selectedCandidateIndex = null;
    refreshCombinedGeometry(current);
    if (current.parts.length) schedulePreview();
    startNextDraft(current);
    return true;
  }

  function redraw() {
    const current = session();
    if (!current || current.stage !== 'selection' || current.selectionPhase === 'components') return false;
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
    if (current.selectionPhase === 'components') return current.selectedComponentKeys.length;
    return current.parts.length + (current.currentGeometry ? 1 : 0);
  }

  function canAddPart(current = session()) {
    if (!current || current.stage !== 'selection' || current.selectionPhase !== 'side' || !current.currentGeometry) return false;
    return current.unboundedMethods.includes(current.method) || !!current.remainingGeometry;
  }

  function selectionGeometryReady(current = session()) {
    if (!current || current.stage !== 'selection') return false;
    if (current.selectionPhase === 'components') {
      return (!current.useRiverBoundaries || current.riverPartitionStatus === 'ready') && current.selectedComponentKeys.length > 0 && !!current.currentGeometry;
    }
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
    if (!current || current.applying || !previewReady(current)) return false;
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
    const step = current.stage === 'setup' ? 1 : current.stage === 'method' ? 2 : 3;
    const stageLabel = current.stage === 'setup' ? current.setupStageLabel
      : current.stage === 'method' ? '방식 선택' : '영역 선택';
    const count = partCount(current);
    const primaryLabel = current.stage === 'selection'
      ? adapter.finalLabel(count)
      : '다음';
    return {
      current,
      step,
      taskName: `${current.taskLabel} ${step}단계`,
      stageLabel,
      setup: current.stage === 'setup',
      method: current.stage === 'method',
      selection: current.stage === 'selection',
      line: current.stage === 'selection' && current.selectionPhase === 'line',
      polygon: current.stage === 'selection' && current.selectionPhase === 'polygon',
      side: current.stage === 'selection' && current.selectionPhase === 'side',
      components: current.stage === 'selection' && current.selectionPhase === 'components',
      activeMethod: current.stage === 'method' ? current.pendingMethod : current.method,
      showSetup: current.stage === 'setup' && adapter.showSetup,
      showName: current.stage === 'setup' && adapter.supportsName,
      showSubunitFields: current.stage === 'setup' && adapter.showSubunitFields,
      showReference: adapter.showReference(current),
      showCountryFlow: adapter.showCountryFlow,
      showMethods: current.stage === 'method',
      showRiver: current.stage === 'selection' && current.selectionPhase === 'components',
      showDrawnActions: current.stage === 'selection' && current.selectionPhase !== 'components'
        && (current.selectionPhase === 'side' || current.parts.length > 0),
      count,
      canAddPart: canAddPart(current),
      primaryLabel,
      primaryIcon: current.stage === 'selection' ? '#icon-check' : '#icon-chevron-right',
      primaryDisabled: current.applying || current.previewPending
        || current.stage === 'setup' && !setupValid(current)
        || current.stage === 'method' && !methodValid(current)
        || current.stage === 'selection' && !previewReady(current),
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
    get cancelPreview() { return cancelPreview; },
    get clear() { return clear; },
    get countryPickingActive() { return countryPickingActive; },
    get finishDraft() { return finishDraft; },
    get methodValid() { return methodValid; },
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
    get start() { return start; },
    get toggleComponent() { return toggleComponent; },
    get toggleRiverBoundaries() { return toggleRiverBoundaries; },
    get toggleSourceCountry() { return toggleSourceCountry; },
    get touchSelection() { return touchSelection; },
    get undoPart() { return undoPart; },
    get updateName() { return updateName; },
  });
}
