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
    return (0, dependencies.territorySelectionA.selectTerritorySelectionCandidate)(candidateIndex);
  }

  function updateTerritoryComponentSelectionFeedback() {
    const session = (0, dependencies.territorySelectionA.activeTerritorySelectionSession)();
    if (!session || session.stage !== 'selection' || session.activePhase !== 'components') return;
    if (session.computationPending) {
      dependencies.taskUi.setModeBanner('선택 영역을 계산하는 중입니다.');
      return;
    }
    const prefix = session.useRiverBoundaries ? session.riverComponentLabel : session.componentLabel;
    if (session.showRiverFailureSources) {
      const invalidIds = new Set(session.riverPartitionDonorResults
        .filter(result => result.status === 'invalid')
        .map(result => String(result.donorCountryId)));
      const invalidNames = session.sourceCountryIds
        .map(dependencies.countries.countryFeatureById)
        .filter(feature => feature && invalidIds.has(String(feature.id)))
        .map(dependencies.presentation.countryName);
      const suffix = session.useRiverBoundaries && invalidNames.length
        ? ` ${invalidNames.join(', ')}은(는) 분할 오류로 제외됨.`
        : '';
      (0, dependencies.taskUi.setModeBanner)(`${prefix}을 선택하세요.${suffix}`);
    } else {
      (0, dependencies.taskUi.setModeBanner)(`${prefix}을 클릭해 선택하세요.`);
    }
  }

  function toggleTerritoryComponentSelection(componentKey) {
    return (0, dependencies.territorySelectionC.toggleTerritorySelectionComponent)(componentKey);
  }



  return Object.freeze({
    connect,

    get selectTerritoryCandidate() { return selectTerritoryCandidate; },
    get toggleTerritoryComponentSelection() { return toggleTerritoryComponentSelection; },
    get updateTerritoryComponentSelectionFeedback() { return updateTerritoryComponentSelectionFeedback; },
  });
}
