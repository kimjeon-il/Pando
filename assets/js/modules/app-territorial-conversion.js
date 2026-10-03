export function createTerritorialConversion() {
  let dependencies;
  function connect(ports) {
    if (dependencies) throw new Error('territorial-conversion already connected');
    dependencies = ports;
  }
  function copySelectedEntityToRegion() {
    const ref = dependencies.projectState.state.selected;
    const source = ref?.domain === 'territorial' ? dependencies.territorialModel.entityRepository.get(ref.id) : null;
    if (!source || source.properties.entityKind !== 'general') return false;
    let result;
    try {
      result = dependencies.objectModelB.territorialApplicationService.copyIndependentRegion(source.id, {
        name: source.properties.name, color: source.properties.style.color || '',
      });
      if (!result.ok) throw result.error || new Error(`독립 권역 복사 실패: ${result.code}`);
    } catch (error) {
      dependencies.feedback.reportOperationError(error, '독립 권역을 복사하지 못했습니다.', 'PL-ENTITY-COPY-001', 4000);
      return false;
    }
    dependencies.projectState.state.layerVisibility.regions = true;
    dependencies.layers.markLayerTreeDirty();
    dependencies.domains.selectionUiController.applyIntent({ domain: 'territorial', type: 'entity', id: result.unit.id }, { openEditor: true });
    dependencies.feedback.setActionStatus('원본을 유지하고 독립 권역으로 복사했습니다.', 'success');
    return result.unit.id;
  }
  function commitLabelEdit(field, value) {
    if (dependencies.projectState.state.selected?.domain !== 'label') return;
    const label = dependencies.projectState.state.labels.find(x => x.id === dependencies.projectState.state.selected.id);
    if (!label) return;
    if (label[field] === value) return false;
    dependencies.domains.projectDomain.recordHistory();
    label[field] = value;
    const affectsMapLabel = field === 'name' || field === 'kind';
    if (affectsMapLabel) (0, dependencies.layers.markLayerTreeDirty)();
    (0, dependencies.propertyEditingA.applyLabelSelectionIntent)(label.id, true);
    if (affectsMapLabel) dependencies.domains.renderingDomain.invalidateLabels('label-metadata-edited');
    dependencies.domains.projectDomain.queueAutosave();
    (0, dependencies.feedback.setActionStatus)('지명 정보를 변경했습니다.', 'success');
  }


  return Object.freeze({ connect, copySelectedEntityToRegion, get commitLabelEdit() { return commitLabelEdit; } });
}
