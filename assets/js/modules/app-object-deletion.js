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

  async function removeGenericFeatureById(id, statusText = '') {
    const key = String(id);
    const feature = dependencies.objectModelA.genericFeatureService.get(key);
    if (!feature) return false;
    const wasPrimary=dependencies.projectState.state.selected?.domain==='generic' && String(dependencies.projectState.state.selected.id)===key;
    const generation = dependencies.domains.projectDomain.getGeneration();
    const result = await dependencies.objectModelA.genericFeatureService.remove(key);
    if (dependencies.projectState.state.projectReplacing || generation !== dependencies.domains.projectDomain.getGeneration()) return false;
    if (!result.ok) return false;
    (0, dependencies.objectDisplay.invalidateObjectPresentation)();
    if (wasPrimary && !dependencies.projectState.state.selected) dependencies.domains.selectionUiController.presentPrimary({ refreshOnly: false });
    (0, dependencies.feedback.setActionStatus)(statusText || `${(0, dependencies.objectPresentation.genericFeatureName)(feature)} 기타 객체를 삭제했습니다.`, 'success');
    return true;
  }

  async function removeHydroEditById(id, statusText = '') {
    const key = String(id);
    if (!(0, dependencies.hydroPresentation.hydroEditById)(key)) return false;
    const wasPrimary=dependencies.projectState.state.selected?.domain==='hydro' && String(dependencies.projectState.state.selected.id)===key;
    const generation=dependencies.domains.projectDomain.getGeneration();
    const result=await dependencies.domains.projectDomain.executeCommand({ commandId: 'hydro.edit',targets: [{ domain: 'hydro',id: key }],
      payload: { domain: 'hydro',id: key,value: null,create: false } });
    if (dependencies.projectState.state.projectReplacing || generation!==dependencies.domains.projectDomain.getGeneration()
      || !result.ok || !result.changed) return false;
    const feature=result.before.hydroEdits.find(row => row.id===key);
    if (result.before.physicalSettings!==result.after.physicalSettings) {
      dependencies.rendering.gpuMapRenderer.invalidateHydroVisibility();
    }
    (0, dependencies.objectDisplay.invalidateObjectPresentation)();
    if (wasPrimary && !dependencies.projectState.state.selected) dependencies.domains.selectionUiController.presentPrimary({ refreshOnly: false });
    dependencies.domains.renderingDomain?.invalidateHydroPatch?.('hydro-feature-deleted');
    const category = (0, dependencies.hydroPresentation.hydroCategoryLabel)(feature.properties?.category);
    const fallback = (0, dependencies.hydroPresentation.hydroFallbackName)(feature.properties?.category);
    (0, dependencies.feedback.setActionStatus)(statusText || `${(0, dependencies.hydroPresentation.hydroEditorName)(feature.properties?.name, fallback)}${(0, dependencies.objectModelA.hydroAccusativeLabel)(feature.properties?.category).slice(category.length)} 삭제했습니다.`, 'success');
    return true;
  }

  async function removeLabelById(id, statusText = '') {
    const key = String(id);
    if (!dependencies.projectState.state.labels.some(candidate => String(candidate.id) === key)) return false;
    const wasPrimary=dependencies.projectState.state.selected?.domain==='label' && String(dependencies.projectState.state.selected.id)===key;
    const generation=dependencies.domains.projectDomain.getGeneration();
    const result=await dependencies.domains.projectDomain.executeCommand({ commandId: 'label.edit',targets: [{ domain: 'label',id: key }],
      payload: { domain: 'label',id: key,value: null,create: false } });
    if (dependencies.projectState.state.projectReplacing || generation!==dependencies.domains.projectDomain.getGeneration()
      || !result.ok || !result.changed) return false;
    const label=result.before.labels.find(row => row.id===key);
    (0, dependencies.objectDisplay.invalidateObjectPresentation)();
    if (wasPrimary && !dependencies.projectState.state.selected) dependencies.domains.selectionUiController.presentPrimary({ refreshOnly: false });
    dependencies.domains.renderingDomain?.invalidateLabels?.('label-deleted');
    (0, dependencies.feedback.setActionStatus)(statusText || `${label.name || '지명'} 지명을 삭제했습니다.`, 'success');
    return true;
  }

  async function deleteSelected() {
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
      if ((0, dependencies.hydroPresentation.hydroEditById)(dependencies.projectState.state.selected.id)) return removeHydroEditById(dependencies.projectState.state.selected.id, `선택한 ${(0, dependencies.objectModelA.hydroAccusativeLabel)(feature?.properties?.category)} 삭제했습니다.`);
      else (0, dependencies.feedback.setActionStatus)(`내장 ${category}는 삭제할 수 없습니다. 편집용 복사본을 만들어 수정하세요.`, 'error', 3400);
      return;
    }
    if (dependencies.projectState.state.selected.domain === 'generic') {
      return removeGenericFeatureById(dependencies.projectState.state.selected.id, '선택한 객체를 삭제했습니다.');
    } else if (dependencies.projectState.state.selected.domain === 'distribution') {
      return (0, dependencies.propertyEditingA.deleteDistributionLayer)(dependencies.projectState.state.selected.id, { confirm: false });
    } else if (dependencies.projectState.state.selected.domain === 'label') {
      return removeLabelById(dependencies.projectState.state.selected.id, '선택한 객체를 삭제했습니다.');
    }
  }

  return Object.freeze({
    connect,

    get deleteSelected() { return deleteSelected; },

  });
}
