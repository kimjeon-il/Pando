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
    if (!(dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
    const id = dependencies.state.selected.id;
    const result = dependencies.territorialApplicationService.updateMetadata(dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY, id, field, value);
    if (!result.ok) return;
    if (field === 'color') {
      dependencies.gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'country-color-edited');
      dependencies.renderingDomain?.invalidateBaseScene?.('country-color-edited');
    }
    if (field === 'flagDataUrl') dependencies.renderingDomain?.invalidateLabels?.('country-flag-edited');
    if (field === 'name') (0, dependencies.markLayerTreeDirty)();
    (0, dependencies.applyCountrySelectionIntent)(id, true);
    (0, dependencies.setActionStatus)('국가 정보를 변경했습니다.', 'success');
  }

  function commitGenericFeatureMeta(field, value) {
    if (dependencies.state.selected?.domain !== 'generic') return;
    const f = dependencies.state.genericFeatures.find(x => String(x.id) === dependencies.state.selected.id);
    if (!f) return;
    const result = dependencies.genericFeatureService.updateMetadata(f.id, field, value);
    if (!result.ok) return;
    dependencies.genericFeatureLandClipCache.delete(f);
    if (field === 'name') (0, dependencies.markLayerTreeDirty)();
    (0, dependencies.applyGenericSelectionIntent)(dependencies.state.selected.id, true);
    (0, dependencies.setActionStatus)('기타 객체 정보를 변경했습니다.', 'success');
  }

  function commitHydroEdit(field, value) {
    if (dependencies.state.selected?.domain !== 'hydro') return;
    const feature = (0, dependencies.hydroEditById)(dependencies.state.selected.id);
    if (!feature || feature.properties?.locked === true) {
      if (feature?.properties?.locked === true) (0, dependencies.setActionStatus)(`잠금을 해제한 뒤 ${(0, dependencies.hydroCategoryLabel)(feature.properties.category)} 정보를 변경하세요.`, 'error', 3200);
      return;
    }
    dependencies.projectDomain.recordHistory();
    feature.properties[field] = field === 'editorColor'
      ? (0, dependencies.normalizeEditorColor)(value, dependencies.HYDRO_TOOL_CONFIG[feature.properties.category].color)
      : value;
    if (field === 'name') (0, dependencies.markLayerTreeDirty)();
    (0, dependencies.applyHydroSelectionIntent)(String(feature.id), true);
    dependencies.projectDomain.queueAutosave();
    (0, dependencies.setActionStatus)(`${(0, dependencies.hydroCategoryLabel)(feature.properties.category)} 정보를 변경했습니다.`, 'success');
  }

  function territorialUnitContainer(feature, { sovereignId = feature?.properties?.sovereignId, parentId = feature?.properties?.parentId } = {}) {
    if (parentId && (feature?.properties?.unitType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT
      || feature?.properties?.coverageMode === dependencies.TERRITORIAL_COVERAGE_MODES.EXPLICIT)) {
      return (0, dependencies.territorialUnitById)(parentId) || (0, dependencies.countryFeatureById)(parentId);
    }
    return (0, dependencies.countryFeatureById)(sovereignId);
  }

  function territorialUnitInsideContainer(feature, container) {
    const clipper = window.polygonClipping;
    if (!feature?.geometry || !container?.geometry || !clipper?.difference) return false;
    const outside = clipper.difference(feature.geometry.coordinates, container.geometry.coordinates);
    return (0, dependencies.multiPolygonPlanarArea)(outside) <= Math.max(1e-9, (0, dependencies.multiPolygonPlanarArea)(feature.geometry.coordinates) * 1e-9);
  }

  function commitTerritorialUnitMeta(field, value) {
    if (!(dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type !== dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
    const feature = (0, dependencies.territorialUnitById)(dependencies.state.selected.id);
    if (!feature) return;
    if (feature.properties?.locked) {
      (0, dependencies.setActionStatus)('잠금을 해제한 뒤 영역 정보를 변경할 수 있습니다.', 'error', 3200);
      (0, dependencies.applyTerritorialUnitSelectionIntent)(feature.id, true);
      return;
    }
    const explicitCoverage = feature.properties?.unitType === dependencies.TERRITORIAL_UNIT_TYPES.REGION;
    if (field === 'sovereignId' && explicitCoverage && String(value) !== String(feature.properties.sovereignId || '')) {
      const candidateUnits = (0, dependencies.deepClone)(dependencies.state.territorialUnits);
      const candidateFeature = candidateUnits.find(item => String(item.id) === String(feature.id));
      Object.assign(candidateFeature, (0, dependencies.changeSovereign)(candidateFeature, value));
      const normalizedUnits = (0, dependencies.normalizeTerritorialUnits)(candidateUnits, { countryExists: id => !!(0, dependencies.countryFeatureById)(id) });
      dependencies.territorialApplicationService.replaceUnits(normalizedUnits, {
        type: 'territorial-sovereign', affectedIds: [feature.id],
      });
      (0, dependencies.markLayerTreeDirty)();
      (0, dependencies.applyTerritorialUnitSelectionIntent)(feature.id, true);
      (0, dependencies.setActionStatus)('지방의 주권 관계를 변경했습니다. 형상은 변경하지 않았습니다.', 'success');
      return;
    }
    if (field === 'sovereignId' && String(value) !== String(feature.properties.sovereignId || '')) {
      const nextCountry = (0, dependencies.countryFeatureById)(value);
      const prefix = 'subunit';
      (0, dependencies.$)(`${prefix}CountryInput`).value = String(feature.properties.sovereignId || '');
      if (!nextCountry) {
        (0, dependencies.setActionStatus)('소속 국가를 선택하세요.', 'error', 3200);
        return;
      }
      requestTerritorialUnitTransfer(feature.id, String(value));
      return;
    }
    if (field === 'parentId' && !explicitCoverage) {
      const parent = value ? dependencies.territorialRepository.get(value) : (0, dependencies.countryFeatureById)(feature.properties.sovereignId);
      if (!parent || !territorialUnitInsideContainer(feature, parent)) {
        (0, dependencies.$)('subunitParentInput').value = String(feature.properties.parentId || '');
        (0, dependencies.setActionStatus)('하위단위 전체가 새 부모 안에 들어갈 때만 상위 단위를 변경할 수 있습니다.', 'error', 4200);
        return;
      }
    }
    const canonicalField = field;
    const candidateUnits = (0, dependencies.deepClone)(dependencies.state.territorialUnits);
    const candidateFeature = candidateUnits.find(item => String(item.id) === String(feature.id));
    if (field === 'color') (0, dependencies.setTerritorialStyleColor)(candidateFeature, value);
    else if (canonicalField === 'parentId') Object.assign(candidateFeature, (0, dependencies.changeParent)(candidateFeature, value));
    else if (canonicalField === 'sovereignId') Object.assign(candidateFeature, (0, dependencies.changeSovereign)(candidateFeature, value));
    else if (canonicalField === 'unitType') Object.assign(candidateFeature, (0, dependencies.changeUnitType)(candidateFeature, value));
    else if (canonicalField === 'flagDataUrl') {
      candidateFeature.properties ||= {};
      candidateFeature.properties.metadata ||= {};
      candidateFeature.properties.metadata.flagDataUrl = value;
    }
    else candidateFeature.properties[canonicalField] = value;
    const parentValidation = (0, dependencies.validateSubunitParentChanges)(dependencies.state.territorialUnits, candidateUnits, id => !!(0, dependencies.countryFeatureById)(id));
    if (!parentValidation.ok) {
      (0, dependencies.setActionStatus)(parentValidation.issues[0], 'error', 4200);
      (0, dependencies.applyTerritorialUnitSelectionIntent)(feature.id, true);
      return;
    }
    let normalizedUnits;
    try {
      if (canonicalField === 'parentId' && !explicitCoverage) {
        globalThis.PandoLabTerritorialEdit.createKernel(window.polygonClipping).validate(
          dependencies.state.countriesData.features, candidateUnits, dependencies.state.territorialUnits, [String(feature.id)],
        );
      }
      normalizedUnits = (0, dependencies.normalizeTerritorialUnits)(candidateUnits, { countryExists: id => !!(0, dependencies.countryFeatureById)(id) });
    } catch (error) {
      (0, dependencies.applyTerritorialUnitSelectionIntent)(feature.id, true);
      const validationMessage = (0, dependencies.compactNotificationMessage)(error?.message || '영역 정보를 검증하지 못했습니다.', { tone: 'error', maxLength: 52 });
      (0, dependencies.setActionStatus)(validationMessage, 'error', 0);
      return;
    }
    dependencies.territorialApplicationService.replaceUnits(normalizedUnits, {
      type: 'territorial-metadata', affectedIds: [feature.id],
    });
    if (canonicalField === 'flagDataUrl') dependencies.renderingDomain?.invalidateLabels?.('territorial-flag-edited');
    (0, dependencies.markLayerTreeDirty)();
    (0, dependencies.applyTerritorialUnitSelectionIntent)(feature.id, true);
    const unitLabel = feature.properties.unitType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT
      ? '하위단위'
      : feature.properties.unitType === dependencies.TERRITORIAL_UNIT_TYPES.REGION
        ? '지방'
        : '하위단위';
    (0, dependencies.setActionStatus)(`${unitLabel} 정보를 변경했습니다.`, 'success');
  }

  function requestTerritorialUnitTransfer(unitId, targetCountryId) {
    const revision = dependencies.state.stateRevision;
    return (0, dependencies.previewTerritorialEdit)({ operation: 'transfer', targetId: unitId, countryId: targetCountryId }, {
      selectedId: unitId, shouldKeepResult: () => dependencies.state.stateRevision === revision,
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
