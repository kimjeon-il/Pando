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

  function removeGenericFeatureById(id, statusText = '') {
    const key = String(id);
    const feature = dependencies.objectModelA.genericFeatureService.get(key);
    if (!feature) return false;
    const result = dependencies.objectModelA.genericFeatureService.remove(key, {
      beforeRemove: () => (0, dependencies.landRelations.reassignGenericFeatureParents)([key]),
    });
    if (!result.ok) return false;
    (0, dependencies.layers.markLayerTreeDirty)();
    if (dependencies.projectState.state.selected?.domain === 'generic' && String(dependencies.projectState.state.selected.id) === key) dependencies.domains.selectionUiController.clear({ reason: 'generic-delete-selection-clear' });
    (0, dependencies.feedback.setActionStatus)(statusText || `${(0, dependencies.objectPresentation.genericFeatureName)(feature)} 기타 객체를 삭제했습니다.`, 'success');
    return true;
  }

  function removeHydroEditById(id, statusText = '') {
    const key = String(id);
    const feature = (0, dependencies.hydroPresentation.hydroEditById)(key);
    if (!feature) return false;
    dependencies.domains.projectDomain.recordHistory();
    dependencies.projectState.state.hydroEdits = dependencies.projectState.state.hydroEdits.filter(candidate => String(candidate.id) !== key);
    const sourceId = String(feature.properties?.sourceFeatureId || '');
    if (sourceId && !dependencies.projectState.state.hydroEdits.some(candidate => String(candidate.properties?.sourceFeatureId || '') === sourceId)) {
      delete dependencies.projectState.state.physicalSettings.hiddenHydroIds[sourceId];
      dependencies.rendering.gpuMapRenderer.invalidateHydroVisibility();
    }
    (0, dependencies.layers.markLayerTreeDirty)();
    if (dependencies.projectState.state.selected?.domain === 'hydro' && String(dependencies.projectState.state.selected.id) === key) dependencies.domains.selectionUiController.clear({ reason: 'hydro-delete-selection-clear' });
    dependencies.domains.renderingDomain?.invalidateHydroPatch?.('hydro-feature-deleted');
    dependencies.domains.projectDomain.queueAutosave();
    const category = (0, dependencies.hydroPresentation.hydroCategoryLabel)(feature.properties?.category);
    const fallback = (0, dependencies.hydroPresentation.hydroFallbackName)(feature.properties?.category);
    (0, dependencies.feedback.setActionStatus)(statusText || `${(0, dependencies.hydroPresentation.hydroEditorName)(feature.properties?.name, fallback)}${(0, dependencies.objectModelA.hydroAccusativeLabel)(feature.properties?.category).slice(category.length)} 삭제했습니다.`, 'success');
    return true;
  }

  function removeLabelById(id, statusText = '') {
    const key = String(id);
    const label = dependencies.projectState.state.labels.find(candidate => String(candidate.id) === key);
    if (!label) return false;
    dependencies.domains.projectDomain.recordHistory();
    dependencies.projectState.state.labels = dependencies.projectState.state.labels.filter(candidate => String(candidate.id) !== key);
    delete dependencies.projectState.state.labelSettings[(0, dependencies.labelPresentation.labelKey)('label', key)];
    (0, dependencies.layers.markLayerTreeDirty)();
    if (dependencies.projectState.state.selected?.domain === 'label' && String(dependencies.projectState.state.selected.id) === key) dependencies.domains.selectionUiController.clear({ reason: 'label-delete-selection-clear' });
    dependencies.domains.renderingDomain?.invalidateLabels?.('label-deleted');
    dependencies.domains.projectDomain.queueAutosave();
    (0, dependencies.feedback.setActionStatus)(statusText || `${label.name || '지명'} 지명을 삭제했습니다.`, 'success');
    return true;
  }

  function deleteSelected() {
    if (!(0, dependencies.readinessUi.requireCanonicalData)()) return;
    if (!dependencies.projectState.state.selected) {
      (0, dependencies.feedback.setActionStatus)('삭제할 객체를 선택하세요', 'error');
      return;
    }
    if (dependencies.projectState.state.selected.domain === 'territorial') {
      return dependencies.objectOperationsA.requestObjectDeletion([dependencies.projectState.state.selected]);
    }
    if (dependencies.projectState.state.selected.domain === 'hydro') {
      const feature = (0, dependencies.hydroModel.hydroFeatureById)(dependencies.projectState.state.selected.id);
      const category = (0, dependencies.hydroPresentation.hydroCategoryLabel)(feature?.properties?.category);
      if ((0, dependencies.hydroPresentation.hydroEditById)(dependencies.projectState.state.selected.id)) removeHydroEditById(dependencies.projectState.state.selected.id, `선택한 ${(0, dependencies.objectModelA.hydroAccusativeLabel)(feature?.properties?.category)} 삭제했습니다.`);
      else (0, dependencies.feedback.setActionStatus)(`내장 ${category}는 삭제할 수 없습니다. 편집용 복사본을 만들어 수정하세요.`, 'error', 3400);
      return;
    }
    if (dependencies.projectState.state.selected.domain === 'generic') {
      removeGenericFeatureById(dependencies.projectState.state.selected.id, '선택한 객체를 삭제했습니다.');
    } else if (dependencies.projectState.state.selected.domain === 'distribution') {
      (0, dependencies.propertyEditingA.deleteDistributionLayer)(dependencies.projectState.state.selected.id, { confirm: false });
    } else if (dependencies.projectState.state.selected.domain === 'label') {
      removeLabelById(dependencies.projectState.state.selected.id, '선택한 객체를 삭제했습니다.');
    }
  }

  return Object.freeze({
    connect,

    get deleteSelected() { return deleteSelected; },

  });
}
