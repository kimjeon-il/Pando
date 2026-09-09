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
      (0, dependencies.setModeBanner)('편입할 영역을 선택하세요.', 'annex-mode');
    } else if (dependencies.state.tool === 'new-country' && dependencies.state.newCountryPhase === 'side' && dependencies.state.newCountryCandidates[index]?.geometry) {
      dependencies.state.newCountrySelectedCandidateIndex = index;
      (0, dependencies.setModeBanner)('신생국으로 만들 영역을 선택하세요.', 'add-country-mode');
    } else {
      return;
    }
    dependencies.renderingDomain?.invalidateEditingOverlays?.('territory-candidate-selection');
    (0, dependencies.updateModeButtons)();
  }

  function updateTerritoryComponentSelectionFeedback() {
    if (dependencies.state.tool === 'annex-territory' && dependencies.state.annexPhase === 'components') {
      const count = dependencies.state.annexSelectedComponentKeys.length;
      const prefix = dependencies.state.annexUseRiverBoundaries ? '하천을 경계로 나눈 영토 조각을' : '편입할 영토 조각을';
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
      (0, dependencies.setModeBanner)(count ? `${prefix} 선택하세요. ${count}개 조각 선택됨.${suffix}` : `${prefix} 클릭해 선택하세요.${suffix}`);
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
    } else {
      return;
    }
    updateTerritoryComponentSelectionFeedback();
    dependencies.renderingDomain?.invalidateEditingOverlays?.('territory-component-selection');
    (0, dependencies.updateModeButtons)();
  }



  return Object.freeze({
    connect,

    get selectTerritoryCandidate() { return selectTerritoryCandidate; },
    get toggleAnnexRiverBoundaries() { return toggleAnnexRiverBoundaries; },
    get toggleTerritoryComponentSelection() { return toggleTerritoryComponentSelection; },
    get updateTerritoryComponentSelectionFeedback() { return updateTerritoryComponentSelectionFeedback; },
  });
}
