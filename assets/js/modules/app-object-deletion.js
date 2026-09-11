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
          unit.properties.isRemainder = false;
        }
        dependencies.state.countriesData.features = dependencies.state.countriesData.features.filter(f => String(f.id) !== key);
        delete dependencies.state.countryOverrides[key];
        (0, dependencies.reindexCountries)(dependencies.state.countriesData, true);
        (0, dependencies.markCountryGeometriesChanged)([key]);
        dependencies.state.boundaryTopology = { edges: new Map(), nodes: new Map() };
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

  function performTerritorialUnitDivisionRemoval(id, action = 'unassigned') {
    const feature = (0, dependencies.territorialUnitById)(id);
    if (!feature) return false;
    const children = (0, dependencies.territorialChildren)(dependencies.state.territorialUnits, feature.id);
    if (children.length) {
      (0, dependencies.setActionStatus)(`하위 하위단위 ${children.length}개를 먼저 다른 부모로 옮기거나 구분 해제하세요.`, 'error', 4200);
      return false;
    }
    const siblings = (0, dependencies.territorialSiblings)(dependencies.state.territorialUnits, feature);
    const countryId = String(feature.properties?.sovereignId || '');
    let mergeTarget = null;
    let mergedGeometry = null;
    if (action.startsWith('merge:')) {
      const targetId = action.slice('merge:'.length);
      mergeTarget = siblings.find(candidate => String(candidate.id) === targetId);
      if (!mergeTarget || !(0, dependencies.territorialUnitsAreAdjacent)(feature, mergeTarget)) {
        (0, dependencies.setActionStatus)('합칠 인접 영역을 찾을 수 없어 변경하지 않았습니다.', 'error', 3800);
        return false;
      }
      mergedGeometry = (0, dependencies.normalizeClippedLandGeometry)(window.polygonClipping.union(mergeTarget.geometry.coordinates, feature.geometry.coordinates));
      if (!mergedGeometry) {
        (0, dependencies.setActionStatus)('선택한 영역을 합칠 수 없어 변경하지 않았습니다.', 'error', 3800);
        return false;
      }
    }
    if (action === 'clear-all') {
      const groupIds = new Set([feature, ...siblings].map(candidate => String(candidate.id)));
      if (dependencies.state.territorialUnits.some(candidate => groupIds.has(String(candidate.properties?.parentId || '')))) {
        (0, dependencies.setActionStatus)('하위 하위단위가 있는 단계는 전체 구분을 해제할 수 없습니다.', 'error', 4200);
        return false;
      }
    }
    dependencies.projectDomain.recordHistory();
    if (action.startsWith('merge:')) {
      mergeTarget.geometry = mergedGeometry;
      for (const entry of dependencies.state.distributionEntries) if (entry.mode === dependencies.DISTRIBUTION_MODES.TERRITORIAL && String(entry.territorialUnitId) === String(feature.id)) entry.territorialUnitId = String(mergeTarget.id);
      dependencies.state.territorialRelations = dependencies.state.territorialRelations
        .filter(relation => String(relation.unitId) !== String(feature.id))
        .map(relation => String(relation.parentId) === String(feature.id) ? { ...relation, parentId: String(mergeTarget.id) } : relation);
      dependencies.state.territorialUnits = dependencies.state.territorialUnits.filter(candidate => String(candidate.id) !== String(feature.id));
      (0, dependencies.applyTerritorialUnitSelectionIntent)(mergeTarget.id, true);
    } else if (action === 'clear-all') {
      const groupIds = new Set([feature, ...siblings].map(candidate => String(candidate.id)));
      dependencies.state.distributionEntries = dependencies.state.distributionEntries.filter(entry => entry.mode !== dependencies.DISTRIBUTION_MODES.TERRITORIAL || !groupIds.has(String(entry.territorialUnitId)));
      dependencies.state.territorialRelations = dependencies.state.territorialRelations.filter(relation => !groupIds.has(String(relation.unitId)) && !groupIds.has(String(relation.parentId)));
      dependencies.state.territorialUnits = dependencies.state.territorialUnits.filter(candidate => !groupIds.has(String(candidate.id)));
      dependencies.selectionUiController.clear({ reason: 'territorial-group-delete-selection-clear' });
    } else if (!siblings.length) {
      dependencies.state.distributionEntries = dependencies.state.distributionEntries.filter(entry => entry.mode !== dependencies.DISTRIBUTION_MODES.TERRITORIAL || String(entry.territorialUnitId) !== String(feature.id));
      dependencies.state.territorialRelations = dependencies.state.territorialRelations.filter(relation => String(relation.unitId) !== String(feature.id) && String(relation.parentId) !== String(feature.id));
      dependencies.state.territorialUnits = dependencies.state.territorialUnits.filter(candidate => String(candidate.id) !== String(feature.id));
      dependencies.selectionUiController.clear({ reason: 'territorial-delete-selection-clear' });
    } else {
      const unassigned = siblings.find(candidate => candidate.properties?.isRemainder === true);
      if (unassigned) {
        unassigned.geometry = (0, dependencies.normalizeClippedLandGeometry)(window.polygonClipping.union(unassigned.geometry.coordinates, feature.geometry.coordinates));
        for (const entry of dependencies.state.distributionEntries) if (entry.mode === dependencies.DISTRIBUTION_MODES.TERRITORIAL && String(entry.territorialUnitId) === String(feature.id)) entry.territorialUnitId = String(unassigned.id);
        dependencies.state.territorialRelations = dependencies.state.territorialRelations
          .filter(relation => String(relation.unitId) !== String(feature.id))
          .map(relation => String(relation.parentId) === String(feature.id) ? { ...relation, parentId: String(unassigned.id) } : relation);
        dependencies.state.territorialUnits = dependencies.state.territorialUnits.filter(candidate => String(candidate.id) !== String(feature.id));
        (0, dependencies.applyTerritorialUnitSelectionIntent)(unassigned.id, true);
      } else {
        feature.properties.isRemainder = true;
        feature.properties.name = '';
        feature.properties.notes = '';
        (0, dependencies.setTerritorialStyleColor)(feature, '');
        (0, dependencies.applyTerritorialUnitSelectionIntent)(feature.id, true);
      }
    }
    if (countryId) (0, dependencies.reconcileTerritorialUnitCompleteness)([countryId]);
    dependencies.state.territorialUnits = (0, dependencies.normalizeTerritorialUnits)(dependencies.state.territorialUnits, { countryExists: key => !!(0, dependencies.countryFeatureById)(key) });
    (0, dependencies.markLayerTreeDirty)();
    dependencies.renderingDomain?.invalidateTerritorialPatch?.('territorial-unit-deleted');
    dependencies.projectDomain.queueAutosave();
    (0, dependencies.setActionStatus)(`${(0, dependencies.territorialTypeLabel)(feature.properties.unitType)} 구분을 안전하게 해제했습니다.`, 'success', 3600);
    return true;
  }

  function requestExplicitTerritorialUnitDelete(feature) {
    const children = (0, dependencies.territorialChildren)(dependencies.state.territorialUnits, feature.id);
    if (children.length) {
      (0, dependencies.setActionStatus)(`하위 영역 ${children.length}개를 먼저 다른 부모로 옮기거나 삭제해야 합니다.`, 'error', 4200);
      return false;
    }
    (0, dependencies.openConfirmModal)({
      title: '지방 삭제',
      message: `${(0, dependencies.territorialUnitName)(feature)}을(를) 프로젝트에서 삭제합니다. 국가나 다른 영역의 형상은 변경하지 않습니다.`,
      impacts: ['지방 1개 삭제', '국가 및 다른 영역 형상 변경 없음'],
      confirmText: '지방 삭제',
      danger: true,
      onConfirm: () => {
        dependencies.projectDomain.recordHistory();
        dependencies.state.territorialUnits = dependencies.state.territorialUnits.filter(candidate => String(candidate.id) !== String(feature.id));
        dependencies.state.territorialRelations = dependencies.state.territorialRelations.filter(relation => String(relation.unitId) !== String(feature.id) && String(relation.parentId) !== String(feature.id));
        dependencies.state.distributionEntries = dependencies.state.distributionEntries.filter(entry => entry.mode !== dependencies.DISTRIBUTION_MODES.TERRITORIAL || String(entry.territorialUnitId) !== String(feature.id));
        (0, dependencies.markLayerTreeDirty)();
        if ((dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type !== dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) && String(dependencies.state.selected.id) === String(feature.id)) dependencies.selectionUiController.clear({ reason: 'territorial-delete-selection-clear' });
        else dependencies.renderingDomain?.invalidateTerritorialPatch?.('territorial-unit-deleted');
        dependencies.projectDomain.queueAutosave();
        (0, dependencies.setActionStatus)(`${(0, dependencies.territorialUnitName)(feature)} 지방을 삭제했습니다.`, 'success');
      },
    });
    return true;
  }

  function requestTerritorialUnitDivisionRemoval(id) {
    const feature = (0, dependencies.territorialUnitById)(id);
    if (!feature) return;
    if (feature.properties?.locked) {
      (0, dependencies.setActionStatus)('잠금을 해제한 뒤 영역을 삭제할 수 있습니다.', 'error', 3200);
      return;
    }
    if (feature.properties?.coverageMode === dependencies.TERRITORIAL_COVERAGE_MODES.EXPLICIT) {
      requestExplicitTerritorialUnitDelete(feature);
      return;
    }
    const children = (0, dependencies.territorialChildren)(dependencies.state.territorialUnits, feature.id);
    if (children.length) {
      (0, dependencies.setActionStatus)(`하위 하위단위 ${children.length}개가 있어 구분을 해제할 수 없습니다.`, 'error', 4200);
      return;
    }
    const label = (0, dependencies.territorialTypeLabel)(feature.properties?.unitType);
    const siblings = (0, dependencies.territorialSiblings)(dependencies.state.territorialUnits, feature);
    const groupIds = new Set([feature, ...siblings].map(candidate => String(candidate.id)));
    const groupHasChildren = dependencies.state.territorialUnits.some(candidate => groupIds.has(String(candidate.properties?.parentId || '')));
    const choices = [];
    if (siblings.length && feature.properties?.isRemainder !== true) {
      choices.push({ value: 'unassigned', label: '미지정 영역으로 전환' });
    }
    for (const sibling of siblings.filter(candidate => candidate.properties?.isRemainder !== true && (0, dependencies.territorialUnitsAreAdjacent)(feature, candidate))) {
      choices.push({ value: `merge:${sibling.id}`, label: `${(0, dependencies.territorialUnitName)(sibling)}에 합치기` });
    }
    if (siblings.length && !groupHasChildren) choices.push({ value: 'clear-all', label: '이 단계의 영역 구분 전체 해제' });
    if (siblings.length && !choices.length) {
      (0, dependencies.setActionStatus)('이 영역은 인접 형제에 합치거나 하위 하위단위를 정리한 뒤 구분 해제할 수 있습니다.', 'error', 4400);
      return;
    }
    (0, dependencies.openConfirmModal)({
      title: `${label} 구분 해제`,
      message: siblings.length
        ? `${(0, dependencies.territorialUnitName)(feature)}을(를) 제거한 뒤에도 부모 면적이 완전히 유지되도록 처리 방식을 선택하세요.`
        : `${(0, dependencies.territorialUnitName)(feature)}의 유일한 구분을 해제하고 암시적 전체 국토 상태로 돌아갑니다.`,
      confirmText: '구분 해제',
      danger: true,
      choices,
      onConfirm: action => performTerritorialUnitDivisionRemoval(feature.id, action),
    });
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
