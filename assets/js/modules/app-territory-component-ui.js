/** TerritoryComponentUi: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createTerritoryComponentUi() {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('territory-component-ui already connected');
    dependencies = ports;
  }

  function selectTerritoryCandidate(candidateIndex) {
    const index = Number(candidateIndex);
    if (dependencies.state.tool === 'annex-territory' && dependencies.state.annexPhase === 'side' && dependencies.state.annexCandidates[index]?.geometry) {
      dependencies.state.annexSelectedCandidateIndex = index;
      (0, dependencies.setModeBanner)('가져올 영역을 선택하세요.', 'annex-mode');
    } else if (dependencies.state.tool === 'new-country' && dependencies.state.newCountryPhase === 'side' && dependencies.state.newCountryCandidates[index]?.geometry) {
      dependencies.state.newCountrySelectedCandidateIndex = index;
      if (dependencies.state.multiDraft?.kind === 'new-country') dependencies.state.multiDraft.current = { geometry: dependencies.state.newCountryCandidates[index].geometry };
      (0, dependencies.setModeBanner)('신생국으로 만들 영역을 선택하세요.', 'add-country-mode');
    } else {
      return;
    }
    dependencies.renderingDomain?.invalidateEditingOverlays?.('territory-candidate-selection');
    (0, dependencies.updateModeButtons)();
    if (dependencies.state.tool === 'annex-territory') (0, dependencies.scheduleAnnexGeometryPreview)();
    else if ((0, dependencies.ensureNewCountryDraftName)()) (0, dependencies.scheduleNewCountryGeometryPreview)();
  }

  function updateTerritoryComponentSelectionFeedback() {
    if (dependencies.state.tool === 'annex-territory' && dependencies.state.annexPhase === 'components') {
      const prefix = dependencies.state.annexUseRiverBoundaries ? '하천으로 나뉜 영토 조각' : '가져올 영토 조각';
      const invalidIds = new Set(dependencies.state.annexRiverPartitionDonorResults
        .filter(result => result.status === 'invalid')
        .map(result => String(result.donorCountryId)));
      const invalidNames = dependencies.state.annexDonorCountryIds
        .map(dependencies.countryFeatureById)
        .filter(feature => feature && invalidIds.has(String(feature.id)))
        .map(dependencies.countryName);
      const suffix = dependencies.state.annexUseRiverBoundaries && invalidNames.length
        ? ` ${invalidNames.join(', ')}은(는) 분할 오류로 제외됨.`
        : '';
      (0, dependencies.setModeBanner)(`${prefix}을 선택하세요.${suffix}`);
    } else if (dependencies.state.tool === 'new-country' && dependencies.state.newCountryPhase === 'components') {
      (0, dependencies.setModeBanner)('새 국가로 만들 영토 조각을 클릭해 선택하세요.');
    }
  }

  function toggleAnnexRiverBoundaries(enabled) {
    if (dependencies.state.tool !== 'annex-territory' || dependencies.state.annexPhase !== 'components') return;
    const next = enabled === true;
    if (dependencies.state.annexUseRiverBoundaries === next) return;
    dependencies.state.annexUseRiverBoundaries = next;
    dependencies.state.annexSelectedComponentKeys = [];
    dependencies.state.annexHoveredComponentKey = null;
    (0, dependencies.cancelScheduledAnnexPreview)({ discard: true });
    (0, dependencies.resetRiverPartitionState)();
    if (next) void (0, dependencies.prepareRiverPartitionCandidates)();
    else {
      updateTerritoryComponentSelectionFeedback();
      (0, dependencies.updateModeButtons)();
      dependencies.editingDomain?.refreshTerritoryOperation('territory-component-mode');
    }
  }

  function toggleTerritoryComponentSelection(componentKey) {
    const available = new Set((0, dependencies.territoryComponentItems)().map(item => item.key));
    if (!available.has(componentKey)) return;
    let selected;
    if (dependencies.state.tool === 'annex-territory' && dependencies.state.annexPhase === 'components') {
      selected = new Set(dependencies.state.annexSelectedComponentKeys);
      if (selected.has(componentKey)) selected.delete(componentKey); else selected.add(componentKey);
      dependencies.state.annexSelectedComponentKeys = [...selected];
    } else if (dependencies.state.tool === 'new-country' && dependencies.state.newCountryPhase === 'components') {
      selected = new Set(dependencies.state.newCountrySelectedComponentKeys);
      if (selected.has(componentKey)) selected.delete(componentKey); else selected.add(componentKey);
      dependencies.state.newCountrySelectedComponentKeys = [...selected];
      if (dependencies.state.multiDraft?.kind === 'new-country') {
        try { dependencies.state.multiDraft.current = selected.size ? { geometry: (0, dependencies.selectedTerritoryComponentGeometry)() } : null; }
        catch { dependencies.state.multiDraft.current = null; }
      }
    } else {
      return;
    }
    updateTerritoryComponentSelectionFeedback();
    dependencies.renderingDomain?.invalidateEditingOverlays?.('territory-component-selection');
    (0, dependencies.updateModeButtons)();
    if (dependencies.state.tool === 'annex-territory') (0, dependencies.scheduleAnnexGeometryPreview)();
    else if (!dependencies.state.multiDraft?.current || (0, dependencies.ensureNewCountryDraftName)()) (0, dependencies.scheduleNewCountryGeometryPreview)();
  }



  return Object.freeze({
    connect,

    get selectTerritoryCandidate() { return selectTerritoryCandidate; },
    get toggleAnnexRiverBoundaries() { return toggleAnnexRiverBoundaries; },
    get toggleTerritoryComponentSelection() { return toggleTerritoryComponentSelection; },
    get updateTerritoryComponentSelectionFeedback() { return updateTerritoryComponentSelectionFeedback; },
  });
}
