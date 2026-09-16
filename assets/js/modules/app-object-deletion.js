import { territorialDeletionAllowed, removeTerritorialUnits } from './territorial-interaction-policy.js';
/** ObjectDeletion: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createObjectDeletion() {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('object-deletion already connected');
    dependencies = ports;
  }

  function requestDeleteCountry(id) {
    const key = String(id);
    if (!(0, dependencies.requireCountriesUnlocked)([key], '삭제')) return;
    const feature = (0, dependencies.countryFeatureById)(key);
    if (!feature) return;
    const children = dependencies.territorialRepository.children(key);
    if (children.length) {
      (0, dependencies.setActionStatus)(`하위 영역 ${children.length}개를 먼저 옮기거나 삭제하세요.`, 'error', 4400);
      return;
    }
    const name = (0, dependencies.countryName)(feature);
    (0, dependencies.openConfirmModal)({
      title: '국가 삭제',
      message: `${name} 국가 객체를 지도에서 삭제합니다. 실행취소로 복구할 수 있습니다.`,
      impacts: ['국가 1개 삭제', '국가명 제거', '하위 영역 없음'],
      confirmText: '국가 삭제',
      danger: true,
      onConfirm: () => {
        dependencies.projectDomain.recordHistory();
        for (const unit of dependencies.state.territorialUnits) {
          if (String(unit.properties?.sovereignId || '') !== key) continue;
          unit.properties.sovereignId = '';
          unit.properties.parentId = '';
        }
        dependencies.state.countriesData.features = dependencies.state.countriesData.features.filter(f => String(f.id) !== key);
        delete dependencies.state.countryOverrides[key];
        (0, dependencies.reindexCountries)(dependencies.state.countriesData, true);
        (0, dependencies.markCountryGeometriesChanged)([key]);
        dependencies.state.boundaryPreparation?.cancel();
        dependencies.state.boundaryPreparation = null;
        if ((dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) && String(dependencies.state.selected.id) === key) dependencies.selectionUiController.clear({ reason: 'country-delete-selection-clear' });
        else {
          (0, dependencies.markLayerTreeDirty)();
          dependencies.renderingDomain?.invalidateCountryPatch?.('country-deleted');
        }
        dependencies.projectDomain.queueAutosave();
        (0, dependencies.setActionStatus)(`${name} 국가를 삭제했습니다.`, 'success');
      },
    });
  }

  function removeGenericFeatureById(id, statusText = '') {
    const key = String(id);
    const feature = dependencies.genericFeatureService.get(key);
    if (!feature) return false;
    const result = dependencies.genericFeatureService.remove(key, {
      beforeRemove: () => (0, dependencies.reassignGenericFeatureParents)([key]),
    });
    if (!result.ok) return false;
    (0, dependencies.markLayerTreeDirty)();
    if (dependencies.state.selected?.domain === 'generic' && String(dependencies.state.selected.id) === key) dependencies.selectionUiController.clear({ reason: 'generic-delete-selection-clear' });
    (0, dependencies.setActionStatus)(statusText || `${(0, dependencies.genericFeatureName)(feature)} 기타 객체를 삭제했습니다.`, 'success');
    return true;
  }

  function removeHydroEditById(id, statusText = '') {
    const key = String(id);
    const feature = (0, dependencies.hydroEditById)(key);
    if (!feature) return false;
    dependencies.projectDomain.recordHistory();
    dependencies.state.hydroEdits = dependencies.state.hydroEdits.filter(candidate => String(candidate.id) !== key);
    const sourceId = String(feature.properties?.sourceFeatureId || '');
    if (sourceId && !dependencies.state.hydroEdits.some(candidate => String(candidate.properties?.sourceFeatureId || '') === sourceId)) {
      delete dependencies.state.physicalSettings.hiddenHydroIds[sourceId];
      dependencies.gpuMapRenderer.invalidateHydroVisibility();
    }
    (0, dependencies.markLayerTreeDirty)();
    if (dependencies.state.selected?.domain === 'hydro' && String(dependencies.state.selected.id) === key) dependencies.selectionUiController.clear({ reason: 'hydro-delete-selection-clear' });
    dependencies.renderingDomain?.invalidateHydroPatch?.('hydro-feature-deleted');
    dependencies.projectDomain.queueAutosave();
    const category = (0, dependencies.hydroCategoryLabel)(feature.properties?.category);
    const fallback = (0, dependencies.hydroFallbackName)(feature.properties?.category);
    (0, dependencies.setActionStatus)(statusText || `${(0, dependencies.hydroEditorName)(feature.properties?.name, fallback)}${(0, dependencies.hydroAccusativeLabel)(feature.properties?.category).slice(category.length)} 삭제했습니다.`, 'success');
    return true;
  }

  function removeLabelById(id, statusText = '') {
    const key = String(id);
    const label = dependencies.state.labels.find(candidate => String(candidate.id) === key);
    if (!label) return false;
    dependencies.projectDomain.recordHistory();
    dependencies.state.labels = dependencies.state.labels.filter(candidate => String(candidate.id) !== key);
    delete dependencies.state.labelSettings[(0, dependencies.labelKey)('label', key)];
    (0, dependencies.markLayerTreeDirty)();
    if (dependencies.state.selected?.domain === 'label' && String(dependencies.state.selected.id) === key) dependencies.selectionUiController.clear({ reason: 'label-delete-selection-clear' });
    dependencies.renderingDomain?.invalidateLabels?.('label-deleted');
    dependencies.projectDomain.queueAutosave();
    (0, dependencies.setActionStatus)(statusText || `${label.name || '지명'} 지명을 삭제했습니다.`, 'success');
    return true;
  }

  function requestExplicitTerritorialUnitDelete(feature) {
    const children = (0, dependencies.territorialChildren)(dependencies.state.territorialUnits, feature.id);
    if (children.length) {
      (0, dependencies.setActionStatus)(`하위 영역 ${children.length}개를 먼저 다른 부모로 옮기거나 삭제해야 합니다.`, 'error', 4200);
      return false;
    }
    (0, dependencies.openConfirmModal)({
      title: `${(0, dependencies.territorialTypeLabel)(feature.properties.unitType)} 삭제`,
      message: `${(0, dependencies.territorialUnitName)(feature)}을(를) 프로젝트에서 삭제합니다. 국가나 다른 영역의 형상은 변경하지 않습니다.`,
      impacts: [`${(0, dependencies.territorialTypeLabel)(feature.properties.unitType)} 1개 삭제`, '국가 및 다른 영역 형상 변경 없음'],
      confirmText: `${(0, dependencies.territorialTypeLabel)(feature.properties.unitType)} 삭제`,
      danger: true,
      onConfirm: () => {
        const current = (0, dependencies.territorialUnitById)(feature.id);
        if (!territorialDeletionAllowed([current], dependencies.state.territorialUnits)) return false;
        const snapshot = (0, dependencies.snapshotEditable)();
        try {
          removeTerritorialUnits(dependencies.state, [feature.id], dependencies.DISTRIBUTION_MODES.TERRITORIAL);
          (0, dependencies.markLayerTreeDirty)();
          if ((dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type !== dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) && String(dependencies.state.selected.id) === String(feature.id)) dependencies.selectionUiController.clear({ reason: 'territorial-delete-selection-clear' });
          dependencies.renderingDomain?.invalidateTerritorialPatch?.('territorial-unit-deleted');
          dependencies.projectDomain.commitHistorySnapshot(snapshot);
          dependencies.state.stateRevision += 1;
          dependencies.projectDomain.queueAutosave();
          (0, dependencies.setActionStatus)(`${(0, dependencies.territorialUnitName)(feature)}을(를) 삭제했습니다.`, 'success');
        } catch (error) {
          (0, dependencies.restoreEditable)(snapshot);
          (0, dependencies.reportOperationError)(error, '삭제를 적용하지 못해 변경을 되돌렸습니다.', 'PL-SUBUNIT-DELETE', 4200);
          return false;
        }
      },
    });
    return true;
  }

  function requestTerritorialUnitDivisionRemoval(id) {
    const feature = (0, dependencies.territorialUnitById)(id);
    if (!feature) return false;
    if (feature.properties?.locked) {
      (0, dependencies.setActionStatus)('잠금을 해제한 뒤 영역을 삭제할 수 있습니다.', 'error', 3200);
      return false;
    }
    return requestExplicitTerritorialUnitDelete(feature);
  }

  function deleteTerritorialUnit(type, id) {
    if (type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) {
      requestDeleteCountry(id);
      return true;
    }
    const feature = (0, dependencies.territorialUnitById)(id);
    if (!feature || feature.properties?.unitType !== type) return false;
    if ((0, dependencies.territorialChildren)(dependencies.state.territorialUnits, feature.id).length) {
      (0, dependencies.setActionStatus)('하위 영역을 먼저 다른 부모로 옮기거나 삭제해야 합니다.', 'error', 4200);
      return false;
    }
    requestTerritorialUnitDivisionRemoval(id);
    return true;
  }

  function deleteSelected() {
    if (!(0, dependencies.requireCanonicalData)()) return;
    if (!dependencies.state.selected) {
      (0, dependencies.setActionStatus)('삭제할 객체를 선택하세요', 'error');
      return;
    }
    if ((dependencies.state.selected.domain === 'territorial' && dependencies.state.selected.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY)) {
      deleteTerritorialUnit(dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY, dependencies.state.selected.id);
      return;
    }
    if (dependencies.state.selected.domain === 'hydro') {
      const feature = (0, dependencies.hydroFeatureById)(dependencies.state.selected.id);
      const category = (0, dependencies.hydroCategoryLabel)(feature?.properties?.category);
      if ((0, dependencies.hydroEditById)(dependencies.state.selected.id)) removeHydroEditById(dependencies.state.selected.id, `선택한 ${(0, dependencies.hydroAccusativeLabel)(feature?.properties?.category)} 삭제했습니다.`);
      else (0, dependencies.setActionStatus)(`내장 ${category}는 삭제할 수 없습니다. 편집용 복사본을 만들어 수정하세요.`, 'error', 3400);
      return;
    }
    if (dependencies.state.selected.domain === 'generic') {
      removeGenericFeatureById(dependencies.state.selected.id, '선택한 객체를 삭제했습니다.');
    } else if (dependencies.state.selected.domain === 'distribution') {
      (0, dependencies.deleteDistributionLayer)(dependencies.state.selected.id, { confirm: false });
    } else if ((dependencies.state.selected.domain === 'territorial' && dependencies.state.selected.type !== dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY)) {
      deleteTerritorialUnit(dependencies.state.selected.type, dependencies.state.selected.id);
    } else if (dependencies.state.selected.domain === 'label') {
      removeLabelById(dependencies.state.selected.id, '선택한 객체를 삭제했습니다.');
    }
  }



  return Object.freeze({
    connect,

    get deleteSelected() { return deleteSelected; },
    get requestDeleteCountry() { return requestDeleteCountry; },
    get requestTerritorialUnitDivisionRemoval() { return requestTerritorialUnitDivisionRemoval; },
  });
}
