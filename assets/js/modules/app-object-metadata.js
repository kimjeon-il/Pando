import './territorial-edit-plan.js';

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

  function commitCountryEdit(field, value) {
    if (!(dependencies.projectState.state.selected?.domain === 'territorial' && dependencies.projectState.state.selected.type === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
    const id = dependencies.projectState.state.selected.id;
    const result = dependencies.objectModelB.territorialApplicationService.updateMetadata(dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY, id, field, value);
    if (!result.ok) return;
    if (field === 'color') {
      dependencies.rendering.gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'country-color-edited');
      dependencies.domains.renderingDomain?.invalidateBaseScene?.('country-color-edited');
    }
    if (field === 'flagDataUrl') dependencies.domains.renderingDomain?.invalidateLabels?.('country-flag-edited');
    if (field === 'name') (0, dependencies.layers.markLayerTreeDirty)();
    (0, dependencies.propertyEditingA.applyCountrySelectionIntent)(id, true);
    (0, dependencies.feedback.setActionStatus)('국가 정보를 변경했습니다.', 'success');
  }

  function commitGenericFeatureMeta(field, value) {
    if (dependencies.projectState.state.selected?.domain !== 'generic') return;
    const f = dependencies.projectState.state.genericFeatures.find(x => String(x.id) === dependencies.projectState.state.selected.id);
    if (!f) return;
    const result = dependencies.objectModelA.genericFeatureService.updateMetadata(f.id, field, value);
    if (!result.ok) return;
    if (field === 'name') (0, dependencies.layers.markLayerTreeDirty)();
    (0, dependencies.propertyEditingA.applyGenericSelectionIntent)(dependencies.projectState.state.selected.id, true);
    (0, dependencies.feedback.setActionStatus)('기타 객체 정보를 변경했습니다.', 'success');
  }

  function commitHydroEdit(field, value) {
    if (dependencies.projectState.state.selected?.domain !== 'hydro') return;
    const feature = (0, dependencies.hydroPresentation.hydroEditById)(dependencies.projectState.state.selected.id);
    if (!feature || feature.properties?.locked === true) {
      if (feature?.properties?.locked === true) (0, dependencies.feedback.setActionStatus)(`잠금을 해제한 뒤 ${(0, dependencies.hydroPresentation.hydroCategoryLabel)(feature.properties.category)} 정보를 변경하세요.`, 'error', 3200);
      return;
    }
    const nextValue = field === 'editorColor'
      ? (0, dependencies.colorModel.normalizeEditorColor)(value, dependencies.hydroPresentation.HYDRO_TOOL_CONFIG[feature.properties.category].color)
      : value;
    if (feature.properties[field] === nextValue) return false;
    dependencies.domains.projectDomain.recordHistory();
    feature.properties[field] = nextValue;
    dependencies.projectState.state.stateRevision += 1;
    if (field === 'name') (0, dependencies.layers.markLayerTreeDirty)();
    if (field === 'editorColor') dependencies.domains.renderingDomain.invalidateHydroPatch('hydro-color-edited');
    (0, dependencies.propertyEditingA.applyHydroSelectionIntent)(String(feature.id), true);
    dependencies.domains.projectDomain.queueAutosave();
    (0, dependencies.feedback.setActionStatus)(`${(0, dependencies.hydroPresentation.hydroCategoryLabel)(feature.properties.category)} 정보를 변경했습니다.`, 'success');
  }

  function territorialUnitContainer(feature, { sovereignId = feature?.properties?.sovereignId, parentId = feature?.properties?.parentId } = {}) {
    if (parentId && (feature?.properties?.unitType === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.SUBUNIT
      || feature?.properties?.coverageMode === dependencies.territorialModel.TERRITORIAL_COVERAGE_MODES.EXPLICIT)) {
      return dependencies.territorialModel.entityRepository.get(parentId);
    }
    const country = dependencies.territorialModel.entityRepository.get(sovereignId);
    return country?.properties?.unitType === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY ? country : null;
  }

  function territorialUnitInsideContainer(feature, container) {
    const clipper = window.polygonClipping;
    if (!feature?.geometry || !container?.geometry || !clipper?.difference) return false;
    const outside = clipper.difference(feature.geometry.coordinates, container.geometry.coordinates);
    return (0, dependencies.territoryGeometry.multiPolygonPlanarArea)(outside) <= Math.max(1e-9, (0, dependencies.territoryGeometry.multiPolygonPlanarArea)(feature.geometry.coordinates) * 1e-9);
  }

  function commitTerritorialUnitMeta(field, value) {
    if (!(dependencies.projectState.state.selected?.domain === 'territorial' && dependencies.projectState.state.selected.type !== dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
    const feature = (0, dependencies.objectPresentation.territorialUnitById)(dependencies.projectState.state.selected.id);
    if (!feature) return;
    if (feature.properties?.locked) {
      (0, dependencies.feedback.setActionStatus)('잠금을 해제한 뒤 영역 정보를 변경할 수 있습니다.', 'error', 3200);
      (0, dependencies.propertyEditingA.applyTerritorialUnitSelectionIntent)(feature.id, true);
      return;
    }
    const explicitCoverage = feature.properties?.unitType === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.REGION;
    if (field === 'sovereignId' && explicitCoverage && String(value) !== String(feature.properties.sovereignId || '')) {
      const result = dependencies.objectModelB.territorialApplicationService.changeAdministrativeCountry(
        feature.properties.unitType,
        feature.id,
        value,
      );
      if (!result.ok) {
        (0, dependencies.propertyEditingA.applyTerritorialUnitSelectionIntent)(feature.id, true);
        (0, dependencies.feedback.setActionStatus)(result.issues?.[0] || '지방의 소속 국가를 변경할 수 없습니다.', 'error', 4200);
        return;
      }
      (0, dependencies.layers.markLayerTreeDirty)();
      (0, dependencies.propertyEditingA.applyTerritorialUnitSelectionIntent)(feature.id, true);
      (0, dependencies.feedback.setActionStatus)('지방의 소속 국가를 변경했습니다. 형상은 변경하지 않았습니다.', 'success');
      return;
    }
    if (field === 'sovereignId' && String(value) !== String(feature.properties.sovereignId || '')) {
      const nextCountry = dependencies.territorialModel.entityRepository.get(value);
      const prefix = 'subunit';
      (0, dependencies.platform.$)(`${prefix}CountryInput`).value = String(feature.properties.sovereignId || '');
      if (nextCountry?.properties?.unitType !== dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY) {
        (0, dependencies.feedback.setActionStatus)('소속 국가를 선택하세요.', 'error', 3200);
        return;
      }
      requestTerritorialUnitTransfer(feature.id, String(value));
      return;
    }
    if (field === 'parentId' && !explicitCoverage) {
      const parent = value ? dependencies.territorialModel.entityRepository.get(value) : dependencies.territorialModel.entityRepository.administrativeCountry(feature.id);
      if (!parent || !territorialUnitInsideContainer(feature, parent)) {
        (0, dependencies.platform.$)('subunitParentInput').value = String(feature.properties.parentId || '');
        (0, dependencies.feedback.setActionStatus)('하위단위 전체가 새 부모 안에 들어갈 때만 상위 단위를 변경할 수 있습니다.', 'error', 4200);
        return;
      }
      const result = dependencies.objectModelB.territorialApplicationService.changeAdministrativeParent(
        feature.properties.unitType,
        feature.id,
        value,
        {
          validateCandidate: ({ candidateUnits }) => {
            globalThis.PandoLabTerritorialEdit.createKernel(window.polygonClipping).validate(
              dependencies.projectState.state.countriesData.features,
              candidateUnits,
              dependencies.projectState.state.territorialUnits,
              [String(feature.id)],
            );
            return true;
          },
        },
      );
      if (!result.ok) {
        (0, dependencies.platform.$)('subunitParentInput').value = String(feature.properties.parentId || '');
        (0, dependencies.propertyEditingA.applyTerritorialUnitSelectionIntent)(feature.id, true);
        (0, dependencies.feedback.setActionStatus)(result.issues?.[0] || '상위 단위를 변경할 수 없습니다.', 'error', 4200);
        return;
      }
      (0, dependencies.layers.markLayerTreeDirty)();
      (0, dependencies.propertyEditingA.applyTerritorialUnitSelectionIntent)(feature.id, true);
      (0, dependencies.feedback.setActionStatus)('하위단위의 상위 단위를 변경했습니다.', 'success');
      return;
    }
    const canonicalField = field;
    if (['name', 'notes', 'color', 'validFrom', 'validTo'].includes(canonicalField)) {
      const result = dependencies.objectModelB.territorialApplicationService.updateMetadata(
        feature.properties.unitType,
        feature.id,
        canonicalField,
        value,
      );
      if (!result.ok) {
        (0, dependencies.propertyEditingA.applyTerritorialUnitSelectionIntent)(feature.id, true);
        const message = result.issues?.[0] || '영역 정보를 변경할 수 없습니다.';
        (0, dependencies.feedback.setActionStatus)(message, 'error', 4200);
        return;
      }
      if (canonicalField === 'name') (0, dependencies.layers.markLayerTreeDirty)();
      (0, dependencies.propertyEditingA.applyTerritorialUnitSelectionIntent)(feature.id, true);
      const unitLabel = feature.properties.unitType === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.REGION ? '지방' : '하위단위';
      (0, dependencies.feedback.setActionStatus)(`${unitLabel} 정보를 변경했습니다.`, 'success');
      return;
    }
    (0, dependencies.propertyEditingA.applyTerritorialUnitSelectionIntent)(feature.id, true);
    if (canonicalField === 'parentId' && explicitCoverage) {
      (0, dependencies.feedback.setActionStatus)('지방의 상위 단위는 직접 편집하지 않습니다.', 'error', 3200);
    }
    return false;
  }

  function requestTerritorialUnitTransfer(unitId, targetCountryId) {
    const revision = dependencies.projectState.state.stateRevision;
    return (0, dependencies.territorialEditingB.previewTerritorialEdit)({ operation: 'transfer', targetId: unitId, countryId: targetCountryId }, {
      selectedId: unitId, shouldKeepResult: () => dependencies.projectState.state.stateRevision === revision,
    });
  }




  return Object.freeze({
    connect,

    get commitCountryEdit() { return commitCountryEdit; },
    get commitGenericFeatureMeta() { return commitGenericFeatureMeta; },
    get commitHydroEdit() { return commitHydroEdit; },
    get commitTerritorialUnitMeta() { return commitTerritorialUnitMeta; },
    get territorialUnitContainer() { return territorialUnitContainer; },
    get territorialUnitInsideContainer() { return territorialUnitInsideContainer; },
  });
}
