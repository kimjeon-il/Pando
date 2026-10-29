import {territorialPaintRole} from '../../../../../shared/frontend/js/modules/layer-presentation.js';

/** Editor output registration for map clicks outside selection/navigation. */
export async function handleEditorMapClick(screenPoint,dependencies){
    const rawCoord = (0, dependencies.mapView.screenToGeo)(screenPoint);
    if (!rawCoord) return;
    const pointerType = dependencies.platform.d3.event?.pointerType === 'touch' || dependencies.platform.d3.event?.changedTouches ? 'touch' : 'mouse';
    const coord = rawCoord;
    if (dependencies.projectState.state.labelPlacementMode) {
      await (0, dependencies.genericEditingA.addLabelAt)(coord);
      return;
    }
    const tool = dependencies.projectState.state.tool;
    if (tool === 'merge-territorial-unit' || tool === 'merge-generic-feature') {
      const generation = dependencies.domains.projectDomain.getGeneration(), viewRevision = dependencies.mapLayout.viewRevision;
      const refs = await dependencies.objectPicking.selectableObjectsAt(screenPoint, coord, { includeLabels: false, includeHydro: false });
      if (generation !== dependencies.domains.projectDomain.getGeneration() || viewRevision !== dependencies.mapLayout.viewRevision
        || dependencies.projectState.state.projectReplacing || dependencies.projectState.state.tool !== tool) return;
      const target = refs.find(ref => tool === 'merge-generic-feature' ? ref.domain === 'generic'
        : ref.domain === 'territorial' && territorialPaintRole(dependencies.territorialModel.entityRepository.get(ref.id)) !== 'country-fill');
      if (target) {
        if (tool === 'merge-generic-feature') dependencies.genericEditingB.toggleGenericFeatureMergeTarget(target.id);
        else dependencies.territorialEditingB.toggleTerritorialUnitMergeTarget(target.id);
      }
      return;
    }
    const territoryCountryPicking = (0, dependencies.territorySelectionB.territorySelectionCountryPickingActive)();
    const needsCountryHit = (dependencies.projectState.state.tool === 'select' && !dependencies.projectState.state.labelPlacementMode) ||
      territoryCountryPicking ||
      (dependencies.projectState.state.tool === 'territorial-border' && dependencies.projectState.state.boundaryEditPhase === 'selecting') ||
      (dependencies.projectState.state.tool === 'merge-country' && !!dependencies.projectState.state.mergeSourceCountryId);
    const clickedCountry = needsCountryHit && dependencies.projectState.state.layerVisibility.objects
      ? (0, dependencies.pointerInteractionA.countryAtScreenPoint)(screenPoint, coord)
      : null;
    if (territoryCountryPicking) {
      if (clickedCountry) await dependencies.territorySelectionC.toggleTerritorySelectionSourceCountry(clickedCountry.id);
      else (0, dependencies.feedback.setActionStatus)((0, dependencies.territorySelectionB.territorySelectionCountryInstruction)(), 'error', 2600);
      return;
    }
    if (dependencies.projectState.state.tool === 'merge-country' && dependencies.projectState.state.mergeSourceCountryId) {
      if (clickedCountry) (0, dependencies.countryEditingC.toggleMergeTarget)(clickedCountry.id);
      else (0, dependencies.feedback.setActionStatus)('합병 대상을 선택할 수 없습니다. 국가 영토 안쪽을 선택하세요.', 'error', 2600);
      return;
    }
    if (dependencies.projectState.state.tool === 'territorial-border' && dependencies.projectState.state.boundaryEditPhase === 'selecting') {
      if (clickedCountry) await dependencies.countryEditingC.toggleBoundaryEditCountry(clickedCountry.id);
      else (0, dependencies.feedback.setActionStatus)('접경국을 선택할 수 없습니다. 국가 영토 안쪽을 선택하세요.', 'error', 2600);
      return;
    }
    if (dependencies.projectState.state.tool === 'select' && !dependencies.projectState.state.labelPlacementMode && clickedCountry) return;
    const territorySession = dependencies.projectState.state.territorySelectionSession;
    if (territorySession) {
      if (territorySession.stage !== 'selection' || territorySession.activePhase !== 'drawing'
        || !['line', 'polygon'].includes(territorySession.activeMethod)) return;
      if ((0, dependencies.draftPresentation.editingDraftSnapshot)().inputPhase !== 'draw') return;
      await dependencies.domains.editingDomain?.appendDraftScreenPoint?.(screenPoint, pointerType, { dedupe: true });
      return;
    }
    if ((0, dependencies.surfaces.isGenericFeatureDraftTool)(dependencies.projectState.state.tool)) {
      if ((0, dependencies.draftPresentation.editingDraftSnapshot)().inputPhase !== 'draw') return;
      await dependencies.domains.editingDomain?.appendDraftScreenPoint?.(screenPoint, pointerType);
      return;
    }
    if (dependencies.projectState.state.tool === 'point') {
      const generation = dependencies.domains.projectDomain.getGeneration();
      const feature = {
        type: 'Feature', id: (0, dependencies.surfaces.uid)('point'),
        geometry: { type: 'Point', coordinates: coord },
        properties: { name: '', color: dependencies.colorModel.DEFAULT_GENERIC_FEATURE_COLOR, schemaVersion: dependencies.applicationConstantsA.GENERIC_FEATURE_SCHEMA_VERSION },
      };
      await dependencies.objectModelA.genericFeatureService.add(feature);
      if (dependencies.projectState.state.projectReplacing || generation !== dependencies.domains.projectDomain.getGeneration()) return false;
      await dependencies.domains.editingDomain.setTool('select');
      await (0, dependencies.propertyEditingA.applyGenericSelectionIntent)(String(feature.id));
      (0, dependencies.feedback.setActionStatus)('점 기타 객체를 추가했습니다.', 'success');
      return;
    }
    if (dependencies.projectState.state.tool === 'select') await dependencies.domains.selectionUiController.clear({ reason: 'map-background-selection-clear' });
}
