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
    const explicitCoverage = feature.properties?.coverageMode === dependencies.TERRITORIAL_COVERAGE_MODES.EXPLICIT;
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
        dependencies.projectDomain.recordHistory();
        feature.properties.sovereignId = '';
        feature.properties.parentId = '';
        feature.properties.isRemainder = false;
        (0, dependencies.normalizeProjectObjects)();
        (0, dependencies.applyTerritorialUnitSelectionIntent)(feature.id, true);
        (0, dependencies.markLayerTreeDirty)();
        dependencies.renderingDomain?.invalidateTerritorialPatch?.('territorial-meta-committed');
        dependencies.projectDomain.queueAutosave();
        return;
      }
      requestTerritorialUnitTransfer(feature.id, String(value));
      return;
    }
    if (field === 'parentId' && !explicitCoverage) {
      const parent = value ? dependencies.territorialRepository.get(value) : (0, dependencies.countryFeatureById)(feature.properties.sovereignId);
      if (!parent || !territorialUnitInsideContainer(feature, parent)) {
        (0, dependencies.$)('subunitParentInput').value = String(feature.properties.parentId || '');
        (0, dependencies.setActionStatus)('하위단위 전체가 새 부모 안에 들어갈 때만 상위 소속을 변경할 수 있습니다.', 'error', 4200);
        return;
      }
    }
    const canonicalField = field === 'level' ? 'adminLevel' : field;
    const candidateUnits = (0, dependencies.deepClone)(dependencies.state.territorialUnits);
    const candidateFeature = candidateUnits.find(item => String(item.id) === String(feature.id));
    if (field === 'color') (0, dependencies.setTerritorialStyleColor)(candidateFeature, value);
    else if (canonicalField === 'parentId') Object.assign(candidateFeature, (0, dependencies.changeParent)(candidateFeature, value));
    else if (canonicalField === 'sovereignId') Object.assign(candidateFeature, (0, dependencies.changeSovereign)(candidateFeature, value));
    else if (canonicalField === 'unitType') Object.assign(candidateFeature, (0, dependencies.changeUnitType)(candidateFeature, value));
    else candidateFeature.properties[canonicalField] = value;
    const parentValidation = (0, dependencies.validateSubunitParentChanges)(dependencies.state.territorialUnits, candidateUnits, id => !!(0, dependencies.countryFeatureById)(id));
    if (!parentValidation.ok) {
      (0, dependencies.setActionStatus)(parentValidation.issues[0], 'error', 4200);
      (0, dependencies.applyTerritorialUnitSelectionIntent)(feature.id, true);
      return;
    }
    let normalizedUnits;
    try {
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
    (0, dependencies.markLayerTreeDirty)();
    (0, dependencies.applyTerritorialUnitSelectionIntent)(feature.id, true);
    const unitLabel = feature.properties.unitType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT
      ? '하위단위'
      : feature.properties.unitType === dependencies.TERRITORIAL_UNIT_TYPES.REGION
        ? '지방'
        : '하위단위';
    (0, dependencies.setActionStatus)(`${unitLabel} 정보를 변경했습니다.`, 'success');
  }

  async function transferTerritorialUnitToCountry(unitId, targetCountryId) {
    const source = (0, dependencies.territorialUnitById)(unitId);
    const donor = (0, dependencies.countryFeatureById)(source?.properties?.sovereignId);
    const target = (0, dependencies.countryFeatureById)(targetCountryId);
    const clipper = window.polygonClipping;
    if (!source || !donor || !target || donor === target || !clipper?.difference || !clipper?.union) return false;
    if (source.properties?.locked) {
      (0, dependencies.setActionStatus)('영역 잠금을 해제한 뒤 소속과 국경을 변경하세요.', 'error', 3600);
      return false;
    }
    if (!(0, dependencies.requireCountriesUnlocked)([donor.id, targetCountryId], '하위단위과 국경을 이전')) return false;
    const movedIds = new Set([String(source.id)]);
    const queue = [String(source.id)];
    while (queue.length) {
      const parentId = queue.shift();
      for (const child of (0, dependencies.territorialChildren)(dependencies.state.territorialUnits, parentId)) {
        if (movedIds.has(String(child.id))) continue;
        movedIds.add(String(child.id));
        queue.push(String(child.id));
      }
    }
    const sourceGeometry = (0, dependencies.deepClone)(source.geometry);
    try {
      await (0, dependencies.runTerritorialUnitTransaction)({
        snapshot: dependencies.snapshotEditable,
        calculate: async () => {
          const donorGeometry = (0, dependencies.normalizeClippedLandGeometry)(clipper.difference(donor.geometry.coordinates, sourceGeometry.coordinates));
          const targetGeometry = (0, dependencies.normalizeClippedLandGeometry)(clipper.union(target.geometry.coordinates, sourceGeometry.coordinates));
          if (!donorGeometry) throw new Error('이전하면 기존 국가의 국토가 남지 않습니다. 새 국가로 독립을 사용하세요.');
          if (!targetGeometry) throw new Error('대상 국가에 하위단위를 결합하지 못했습니다.');
          const nextUnits = (0, dependencies.deepClone)(dependencies.state.territorialUnits).flatMap(feature => {
            if (movedIds.has(String(feature.id))) {
              feature.properties.sovereignId = String(targetCountryId);
              if (String(feature.id) === String(source.id)) feature.properties.parentId = String(targetCountryId);
              return [feature];
            }
            if (String(feature.properties?.sovereignId || '') !== String(donor.id)) return [feature];
            const remainder = (0, dependencies.normalizeClippedLandGeometry)(clipper.difference(feature.geometry.coordinates, sourceGeometry.coordinates));
            if (!remainder) return [];
            feature.geometry = remainder;
            return [feature];
          });
          return {
            donorGeometry: (0, dependencies.normalizeCountryGeometry)(donorGeometry),
            targetGeometry: (0, dependencies.normalizeCountryGeometry)(targetGeometry),
            nextUnits: (0, dependencies.normalizeTerritorialUnits)(nextUnits, { countryExists: id => !!(0, dependencies.countryFeatureById)(id) }),
          };
        },
        validate: result => {
          if (!result.donorGeometry || !result.targetGeometry) return { ok: false, message: '국경 변경 결과가 유효하지 않습니다.' };
          return (0, dependencies.validateTerritorialUnitRelations)(result.nextUnits, { countryExists: id => !!(0, dependencies.countryFeatureById)(id) });
        },
        apply: async result => {
          donor.geometry = result.donorGeometry;
          target.geometry = result.targetGeometry;
          dependencies.state.territorialUnits = result.nextUnits;
          (0, dependencies.reindexCountries)(dependencies.state.countriesData, true);
          (0, dependencies.reconcileTerritorialUnitCompleteness)([donor.id, target.id]);
          (0, dependencies.markCountryGeometriesChanged)([donor.id, target.id]);
          (0, dependencies.refreshCountryCentroids)([donor.id, target.id]);
          (0, dependencies.markLayerTreeDirty)();
          (0, dependencies.applyTerritorialUnitSelectionIntent)(unitId, true);
          dependencies.renderingDomain?.invalidateTerritorialPatch?.('territorial-transfer-committed');
          dependencies.editingDomain?.clearDraftHover?.('territorial-transfer-committed');
        },
        restore: before => (0, dependencies.restoreEditable)(before),
        recordHistory: before => dependencies.projectDomain.commitHistorySnapshot(before),
        autosave: (...args) => dependencies.projectDomain.queueAutosave(...args),
      });
      (0, dependencies.setActionStatus)(`${(0, dependencies.territorialUnitName)(source)} 소속과 국경을 변경했습니다.`, 'success', 4200);
      return true;
        } catch (error) {
          dependencies.editingDomain?.clearDraftHover?.('territorial-transfer-failed');
      (0, dependencies.reportOperationError)(error, '하위단위를 다른 국가로 이전하지 못해 변경을 되돌렸습니다.', 'PL-REGION-TRANSFER-001', 4800);
      return false;
    }
  }

  function requestTerritorialUnitTransfer(unitId, targetCountryId) {
    const feature = (0, dependencies.territorialUnitById)(unitId);
    const target = (0, dependencies.countryFeatureById)(targetCountryId);
    if (!feature || !target) return;
    (0, dependencies.openConfirmModal)({
      title: '실제 국경 변경',
      message: `${(0, dependencies.territorialUnitName)(feature)}의 형상을 기존 국가에서 제거하고 ${(0, dependencies.countryName)(target)} 국토에 더합니다. 하위 하위단위도 함께 이전되며 실행취소할 수 있습니다.`,
      impacts: [
        '국가 2개의 실제 국경 변경',
        `${(0, dependencies.territorialUnitName)(feature)} 소속 국가 변경`,
        `하위 영역 ${(0, dependencies.territorialChildren)(dependencies.state.territorialUnits, feature.id).length}개 함께 이전`,
      ],
      confirmText: '하위단위과 국경 이전',
      danger: true,
      onConfirm: () => transferTerritorialUnitToCountry(feature.id, targetCountryId),
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
