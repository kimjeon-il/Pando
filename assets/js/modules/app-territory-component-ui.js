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
    return (0, dependencies.selectTerritorySelectionCandidate)(candidateIndex);
  }

  function updateTerritoryComponentSelectionFeedback() {
    const session = (0, dependencies.activeTerritorySelectionSession)();
    if (!session || session.stage !== 'selection' || session.selectionPhase !== 'components') return;
    const prefix = session.useRiverBoundaries ? session.riverComponentLabel : session.componentLabel;
    if (session.showRiverFailureSources) {
      const invalidIds = new Set(session.riverPartitionDonorResults
        .filter(result => result.status === 'invalid')
        .map(result => String(result.donorCountryId)));
      const invalidNames = session.sourceCountryIds
        .map(dependencies.countryFeatureById)
        .filter(feature => feature && invalidIds.has(String(feature.id)))
        .map(dependencies.countryName);
      const suffix = session.useRiverBoundaries && invalidNames.length
        ? ` ${invalidNames.join(', ')}은(는) 분할 오류로 제외됨.`
        : '';
      (0, dependencies.setModeBanner)(`${prefix}을 선택하세요.${suffix}`);
    } else {
      (0, dependencies.setModeBanner)(`${prefix}을 클릭해 선택하세요.`);
    }
  }

  function toggleTerritoryComponentSelection(componentKey) {
    return (0, dependencies.toggleTerritorySelectionComponent)(componentKey);
  }



  return Object.freeze({
    connect,

    get selectTerritoryCandidate() { return selectTerritoryCandidate; },
    get toggleTerritoryComponentSelection() { return toggleTerritoryComponentSelection; },
    get updateTerritoryComponentSelectionFeedback() { return updateTerritoryComponentSelectionFeedback; },
  });
}
