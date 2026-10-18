export function createTerritorialConversion() {
  let dependencies;
  function connect(ports) {
    if (dependencies) throw new Error('territorial-conversion already connected');
    dependencies = ports;
  }
  async function copySelectedEntityToRegion() {
    const ref = dependencies.projectState.state.selected;
    const source = ref?.domain === 'territorial' ? dependencies.territorialModel.entityRepository.get(ref.id) : null;
    if (!source || source.properties.entityKind !== 'general') return false;
    const generation = dependencies.domains.projectDomain.getGeneration();
    let result;
    try {
      const id=dependencies.surfaces.uid('region');
      result=await dependencies.domains.projectDomain.executeCommand({commandId:'territorial.copy-region-for-display',targets:[],payload:{operations:[{
        commandId:'territorial.copy-region',targets:[{domain:'territorial',id:source.id},{domain:'territorial',id}],
        payload:{sourceId:source.id,id,name:source.properties.name,color:source.properties.style.color || ''}}]}});
      if(!result.ok)throw Object.assign(new Error(result.error.message),{code:result.error.code});
      result={...result,unit:result.afterTerritorial.find(row=>row.id===id)};
    } catch (error) {
      dependencies.feedback.reportOperationError(error, '독립 권역을 복사하지 못했습니다.', 'PL-ENTITY-COPY-001', 4000);
      return false;
    }
    if (dependencies.projectState.state.projectReplacing || generation !== dependencies.domains.projectDomain.getGeneration()) return false;
    dependencies.objectDisplay.invalidateObjectPresentation();
    await dependencies.domains.selectionUiController.applyIntent({ domain: 'territorial', type: 'entity', id: result.unit.id }, { openEditor: true });
    dependencies.feedback.setActionStatus('원본을 유지하고 독립 권역으로 복사했습니다.', 'success');
    return result.unit.id;
  }
  async function commitLabelEdit(field, value) {
    if (dependencies.projectState.state.selected?.domain !== 'label') return;
    const label = dependencies.projectState.state.labels.find(x => x.id === dependencies.projectState.state.selected.id);
    if (!label) return;
    const generation=dependencies.domains.projectDomain.getGeneration(),expectedEpoch=dependencies.domains.projectDomain.state().epoch;
    const result=await dependencies.domains.projectDomain.executeCommand({ commandId: 'label.edit',expectedEpoch,
      targets: [{ domain: 'label',id: label.id }],payload: { domain: 'label',id: label.id,value: { ...label,[field]: value },create: false } });
    if (dependencies.projectState.state.projectReplacing || generation!==dependencies.domains.projectDomain.getGeneration()
      || !result.ok || !result.changed) return false;
    const affectsMapLabel = field === 'name' || field === 'kind';
    if (affectsMapLabel) (0, dependencies.objectDisplay.invalidateObjectPresentation)();
    if (dependencies.projectState.state.selected?.domain==='label' && dependencies.projectState.state.selected.id===label.id)
      await (0, dependencies.propertyEditingA.applyLabelSelectionIntent)(label.id, true);
    if (affectsMapLabel) dependencies.domains.renderingDomain.invalidateLabels('label-metadata-edited');
    (0, dependencies.feedback.setActionStatus)('지명 정보를 변경했습니다.', 'success');
    return true;
  }


  return Object.freeze({ connect, copySelectedEntityToRegion, get commitLabelEdit() { return commitLabelEdit; } });
}
