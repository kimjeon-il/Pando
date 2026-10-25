import "../../../../../shared/frontend/js/modules/territorial-edit-plan.js";

/** ObjectMetadata: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createObjectMetadata() {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('object-metadata already connected');
    dependencies = ports;
  }
  const currentProject = generation => !dependencies.projectState.state.projectReplacing
    && dependencies.domains.projectDomain.getGeneration() === generation;

  async function commitTerritorialMetadata(ref, field, value) {
    if (ref?.domain !== 'territorial') return { ok: false, code: 'invalid-ref' };
    const generation = dependencies.domains.projectDomain.getGeneration();
    const result = await dependencies.objectModelB.territorialApplicationService.updateMetadata(ref.id, field, value);
    if (!currentProject(generation)) return result;
    if (!result.ok) {
      dependencies.feedback.setActionStatus(result.issues?.[0] || '영역 정보를 변경할 수 없습니다.', 'error', 4200);
      return result;
    }
    if (!result.changed) return result;
    if (field === 'color') {
      if ((dependencies.territorialModel.entityRepository.get(ref?.id)?.properties.entityKind === 'general' && !dependencies.territorialModel.entityRepository.get(ref?.id)?.properties.parentId)) dependencies.rendering.gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'territorial-color-edited');
      dependencies.domains.renderingDomain.invalidateBaseScene('territorial-color-edited');
      dependencies.domains.renderingDomain.invalidateTerritorialPatch('territorial-color-edited');
    }
    if (field === 'name') dependencies.objectDisplay.invalidateObjectPresentation();
    if (field === 'name' || field === 'flagDataUrl') dependencies.domains.renderingDomain.invalidateLabels('territorial-metadata-edited');
    const primary = dependencies.projectState.state.selected;
    if (primary?.domain === 'territorial' && primary.type === ref.type && String(primary.id) === String(ref.id)) {
      dependencies.domains.selectionUiController.presentPrimary({ refreshOnly: true });
    }
    dependencies.feedback.setActionStatus('영역 정보를 변경했습니다.', 'success');
    return result;
  }

  async function commitGenericFeatureMeta(field, value) {
    if (dependencies.projectState.state.selected?.domain !== 'generic') return;
    const f = dependencies.projectState.state.genericFeatures.find(x => String(x.id) === dependencies.projectState.state.selected.id);
    if (!f) return;
    const generation = dependencies.domains.projectDomain.getGeneration();
    const result = await dependencies.objectModelA.genericFeatureService.updateMetadata(f.id, field, value);
    if (!currentProject(generation)) return;
    if (!result.ok) return;
    if (field === 'name') (0, dependencies.objectDisplay.invalidateObjectPresentation)();
    if (dependencies.projectState.state.selected?.domain === 'generic' && String(dependencies.projectState.state.selected.id) === String(f.id))
      await (0, dependencies.propertyEditingA.applyGenericSelectionIntent)(String(f.id), true);
    (0, dependencies.feedback.setActionStatus)('기타 객체 정보를 변경했습니다.', 'success');
  }

  async function commitHydroEdit(field, value) {
    if (dependencies.projectState.state.selected?.domain !== 'hydro') return;
    const feature = (0, dependencies.hydroPresentation.hydroEditById)(dependencies.projectState.state.selected.id);
    if (!feature || feature.properties?.locked === true) {
      if (feature?.properties?.locked === true) (0, dependencies.feedback.setActionStatus)(`잠금을 해제한 뒤 ${(0, dependencies.hydroPresentation.hydroCategoryLabel)(feature.properties.category)} 정보를 변경하세요.`, 'error', 3200);
      return;
    }
    const generation=dependencies.domains.projectDomain.getGeneration();
    const result=await dependencies.domains.projectDomain.executeCommand({ commandId: 'hydro.metadata',
      targets: [{ domain: 'hydro',id: String(feature.id) }],payload: { id: String(feature.id),field,value } });
    if (!currentProject(generation) || !result.ok || !result.changed) return false;
    if (field === 'name') (0, dependencies.objectDisplay.invalidateObjectPresentation)();
    if (field === 'editorColor') dependencies.domains.renderingDomain.invalidateHydroPatch('hydro-color-edited');
    const selected=dependencies.projectState.state.selected;
    if (selected?.domain==='hydro' && String(selected.id)===String(feature.id))
      await (0, dependencies.propertyEditingA.applyHydroSelectionIntent)(String(feature.id), true);
    (0, dependencies.feedback.setActionStatus)(`${(0, dependencies.hydroPresentation.hydroCategoryLabel)(feature.properties.category)} 정보를 변경했습니다.`, 'success');
    return true;
  }

  function territorialUnitInsideContainer(feature, container) {
    const clipper = window.polygonClipping;
    if (!feature?.geometry || !container?.geometry || !clipper?.difference) return false;
    const outside = clipper.difference(feature.geometry.coordinates, container.geometry.coordinates);
    return (0, dependencies.territoryGeometry.multiPolygonPlanarArea)(outside) <= Math.max(1e-9, (0, dependencies.territoryGeometry.multiPolygonPlanarArea)(feature.geometry.coordinates) * 1e-9);
  }

  async function commitTerritorialRelation(ref, field, value) {
    const feature = ref?.domain === 'territorial' ? dependencies.territorialModel.entityRepository.get(ref.id) : null;
    if (!feature || ref.type !== 'entity' || field !== 'parentId') return { ok: false, code: 'invalid-ref' };
    const generation = dependencies.domains.projectDomain.getGeneration();
    const result = await dependencies.objectModelB.territorialApplicationService.changeAdministrativeParent(feature.id, value, {
      validateCandidate: ({ candidateUnits, previousUnits }) => {
        globalThis.PandoLabTerritorialEdit.createKernel(window.polygonClipping).validate(candidateUnits, previousUnits, [feature.id]);
        return true;
      },
    });
    if (!currentProject(generation)) return result;
    const primary = dependencies.projectState.state.selected;
    if (primary?.domain === ref.domain && primary.type === ref.type
      && [ref.id, feature.properties.parentId, value].some(id => id && String(primary.id) === String(id)))
      dependencies.domains.selectionUiController.presentPrimary({ refreshOnly: true });
    if (!result.ok) {
      dependencies.feedback.setActionStatus(result.issues?.[0] || '상위 객체를 변경할 수 없습니다.', 'error', 4200);
      return result;
    }
    if (result.changed) dependencies.objectDisplay.invalidateObjectPresentation();
    return result;
  }


  return Object.freeze({
    connect,

    get commitTerritorialMetadata() { return commitTerritorialMetadata; },
    get commitGenericFeatureMeta() { return commitGenericFeatureMeta; },
    get commitHydroEdit() { return commitHydroEdit; },
    get commitTerritorialRelation() { return commitTerritorialRelation; },
    get territorialUnitInsideContainer() { return territorialUnitInsideContainer; },
  });
}
