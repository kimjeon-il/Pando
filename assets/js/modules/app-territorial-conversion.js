/** TerritorialConversion: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createTerritorialConversion() {
  let dependencies;
  let territorialTypeSource;
  function connect(ports) {
    if (dependencies) throw new Error('territorial-conversion already connected');
    dependencies = ports;
  }

  async function promoteTerritorialUnitToCountry(unitId) {
    const source = (0, dependencies.territorialUnitById)(unitId);
    const sourceCountryId = String(source?.properties?.sovereignId || '');
    const sourceCountry = (0, dependencies.countryFeatureById)(sourceCountryId);
    const name = String(source?.properties?.name || '').trim();
    if (!source || !sourceCountry || !name) {
      (0, dependencies.setActionStatus)('새 국가로 독립하려면 이름과 소속 국가가 있는 하위단위를 선택하세요.', 'error', 3800);
      return false;
    }
    if (source.properties?.locked) {
      (0, dependencies.setActionStatus)('영역 잠금을 해제한 뒤 국가로 전환하세요.', 'error', 3400);
      return false;
    }
    if (!(0, dependencies.requireCountriesUnlocked)([sourceCountryId], '하위단위를 국가로 전환')) return false;
    if ((0, dependencies.countryFeatureById)(source.id)) {
      (0, dependencies.setActionStatus)('영역 ID가 국가 ID와 겹칩니다. ID를 바꾸세요.', 'error', 4200);
      return false;
    }
    const descendantIds = new Set();
    const queue = [String(source.id)];
    while (queue.length) {
      const parentId = queue.shift();
      for (const child of (0, dependencies.territorialChildren)(dependencies.state.territorialUnits, parentId)) {
        if (descendantIds.has(String(child.id))) continue;
        descendantIds.add(String(child.id));
        queue.push(String(child.id));
      }
    }
    const convertedMetadata = source.properties?.metadata?.convertedFromCountry || {};
    const country = (0, dependencies.createCountryFeature)(name, [], (0, dependencies.territorialStyleColor)(source) || null, (0, dependencies.snapGeometryToGrid)(source.geometry, 7));
    country.id = String(source.id);
    country.properties = { name };
    const restoredOverride = convertedMetadata.override && typeof convertedMetadata.override === 'object'
      ? (0, dependencies.deepClone)(convertedMetadata.override)
      : {};
    const snapshot = (0, dependencies.snapshotEditable)();
    (0, dependencies.setActionStatus)('선택한 하위단위를 새 국가로 독립시키는 중입니다.', 'working', 0);
    const result = await (0, dependencies.transactCountryEdit)({
      operation: 'new-country',
      payload: { sourceIds: [sourceCountryId], transferredGeometry: source.geometry, newFeature: country },
      snapshot,
      applyResult: plan => {
        dependencies.state.countryOverrides[source.id] = {
          ...restoredOverride,
          name,
          color: (0, dependencies.territorialStyleColor)(source) || restoredOverride.color || '',
          notes: String(source.properties?.notes || restoredOverride.notes || ''),
        };
        (0, dependencies.applyWorkerCountryPatches)(plan);
        (0, dependencies.reindexCountries)(dependencies.state.countriesData, true);
        dependencies.state.territorialUnits = dependencies.state.territorialUnits.flatMap(feature => {
          if (String(feature.id) === String(source.id)) return [];
          if (descendantIds.has(String(feature.id))) {
            feature.properties.sovereignId = String(country.id);
            if (String(feature.properties?.parentId || '') === String(source.id)) feature.properties.parentId = String(country.id);
            return [feature];
          }
          if (String(feature.properties?.sovereignId || '') !== sourceCountryId) return [feature];
          const remainder = (0, dependencies.normalizeClippedLandGeometry)(window.polygonClipping.difference(feature.geometry.coordinates, source.geometry.coordinates));
          if (!remainder) return [];
          feature.geometry = remainder;
          return [feature];
        });
        dependencies.state.territorialRelations = dependencies.state.territorialRelations.filter(relation => String(relation.unitId || '') !== String(source.id));
        for (const relation of dependencies.state.territorialRelations) {
          const related = String(relation.unitId || '') === String(source.id) || descendantIds.has(String(relation.unitId || ''));
          if (related && String(relation.sovereignId || '') === sourceCountryId) relation.sovereignId = String(country.id);
          if (String(relation.parentId || '') === String(source.id)) relation.parentId = String(country.id);
        }
        for (const entry of dependencies.state.distributionEntries) {
          if (entry.mode === dependencies.DISTRIBUTION_MODES.TERRITORIAL && String(entry.territorialUnitId) === String(source.id)) entry.territorialUnitId = String(country.id);
        }
        dependencies.state.territorialUnits = (0, dependencies.normalizeTerritorialUnits)(dependencies.state.territorialUnits, { countryExists: id => !!(0, dependencies.countryFeatureById)(id) });
        (0, dependencies.reconcileTerritorialUnitCompleteness)([sourceCountryId, country.id]);
        (0, dependencies.refreshCountryCentroids)(new Set(plan.affectedIds));
        (0, dependencies.markLayerTreeDirty)();
        (0, dependencies.applyCountrySelectionIntent)(country.id);
        dependencies.renderingDomain?.invalidateCountryPatch?.('territorial-promoted-country');
      },
      onSuccess: () => (0, dependencies.setActionStatus)(`${name} 하위단위를 새 국가로 독립시켰습니다. 소속 하위단위는 유지했습니다.`, 'success', 4000),
      onError: error => (0, dependencies.reportOperationError)(error, '하위단위를 새 국가로 독립시키지 못했습니다.', 'PL-REGION-PROMOTE-001', 4700),
    });
    return result.ok;
  }

  function buildTerritorialStructurePreview({ source, sourceType, targetType, sovereignId = '', parentId = '' } = {}) {
    if (!source || !sourceType || !targetType) return null;
    const sourceName = territorialTypeSourceName(source);
    const sourceLabel = dependencies.TERRITORIAL_TYPE_LABELS[sourceType] || '영역';
    const targetLabel = dependencies.TERRITORIAL_TYPE_LABELS[targetType] || '영역';
    const subjectLabel = ({ 국가: '국가를', 하위단위: '하위단위를', 지방: '지방을' })[sourceLabel] || `${sourceLabel}을`;
    const directionLabel = ({ 국가: '국가로', 하위단위: '하위단위로', 지방: '지방으로' })[targetLabel] || `${targetLabel}으로`;
    const sourceIsCountry = sourceType === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY;
    const targetIsCountry = targetType === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY;
    const childCount = sourceIsCountry
      ? dependencies.state.territorialUnits.filter(candidate => String(candidate.properties?.sovereignId || '') === String(source.id || '')).length
      : (0, dependencies.territorialChildren)(dependencies.state.territorialUnits, source.id).length;
    const targetCountry = (0, dependencies.countryFeatureById)(sovereignId);
    const targetParent = (0, dependencies.territorialUnitById)(parentId);
    const impacts = [];
    let summary = `${sourceName}의 종류를 ${targetLabel}(으)로 변경합니다.`;

    if (sourceIsCountry && !targetIsCountry) {
      if (!targetCountry) {
        return {
          title: `${subjectLabel} ${directionLabel} 전환`,
          summary: '소속 국가를 선택해야 변경 결과를 확인할 수 있습니다.',
          impacts: [],
          confirmText: `${directionLabel} 전환`,
          danger: true,
        };
      }
      summary = `${sourceName}의 국토를 ${(0, dependencies.countryName)(targetCountry)}에 합치고 같은 객체를 ${targetLabel}(으)로 유지합니다.`;
      impacts.push(`${(0, dependencies.countryName)(targetCountry)} 국경 변경 및 기존 국가 관계 해제`);
    } else if (targetIsCountry) {
      summary = `${sourceName}의 영역을 현재 소속 국가에서 분리해 독립 국가로 전환합니다.`;
      impacts.push('기존 상위 소속과 소속 국가 관계 해제', '기존 국가 국경 변경 및 새 국가 1개 생성');
    } else {
      const sovereign = (0, dependencies.countryFeatureById)(sovereignId || source.properties?.sovereignId);
      impacts.push(`소속 국가 유지${sovereign ? `: ${(0, dependencies.countryName)(sovereign)}` : ''}`);
      if (targetType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT) {
        const parentName = targetParent ? (0, dependencies.territorialUnitName)(targetParent) : sovereign ? (0, dependencies.countryName)(sovereign) : '선택한 상위 소속';
        impacts.push(`상위 소속: ${parentName}`, '행정 단계는 선택적으로 지정');
      } else if (sourceType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT) {
        impacts.push('기존 행정 단계와 상위 행정 관계 해제');
      }
    }

    impacts.push('현재 형상과 객체 ID 유지', `하위 영역 ${childCount}개 유지`, '연결된 분포 참조 유지', '한 번의 실행취소로 복구 가능');
    return {
      title: `${subjectLabel} ${directionLabel} 전환`,
      summary,
      impacts,
      confirmText: `${directionLabel} 전환`,
      danger: sourceIsCountry || targetIsCountry,
    };
  }

  function requestTerritorialUnitPromotion(unitId) {
    const feature = (0, dependencies.territorialUnitById)(unitId);
    if (!feature) return;
    const preview = buildTerritorialStructurePreview({
      source: feature,
      sourceType: feature.properties?.unitType,
      targetType: dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY,
      sovereignId: feature.properties?.sovereignId,
    });
    if (!preview) return;
    (0, dependencies.openConfirmModal)({
      title: preview.title,
      message: preview.summary,
      impacts: preview.impacts,
      confirmText: preview.confirmText,
      danger: preview.danger,
      onConfirm: () => promoteTerritorialUnitToCountry(feature.id),
    });
  }

  function territorialTypeSourceFeature() {
    if (!territorialTypeSource) return null;
    return territorialTypeSource.unitType === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY
      ? (0, dependencies.countryFeatureById)(territorialTypeSource.id)
      : (0, dependencies.territorialUnitById)(territorialTypeSource.id);
  }

  function territorialTypeSourceName(feature = territorialTypeSourceFeature()) {
    return territorialTypeSource?.unitType === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY
      ? (0, dependencies.countryName)(feature)
      : (0, dependencies.territorialUnitName)(feature);
  }

  function territorialTypeParentOptions(source, sovereignId) {
    const choices = (0, dependencies.subunitParentChoices)(sovereignId, dependencies.state.countriesData.features, dependencies.state.territorialUnits, {
      exclude: [source.id], name: item => item.properties?.unitType ? (0, dependencies.territorialUnitName)(item) : (0, dependencies.countryName)(item),
    }).filter(option => option.value === String(sovereignId) || (0, dependencies.territorialUnitInsideContainer)(source, (0, dependencies.territorialUnitById)(option.value)));
    const oldParent = String(source.properties?.parentId || '');
    if (oldParent && String(source.properties?.sovereignId || '') === String(sovereignId) && !choices.some(option => option.value === oldParent)) {
      const parent = (0, dependencies.territorialUnitById)(oldParent) || (0, dependencies.countryFeatureById)(oldParent);
      choices.push({ value: oldParent, label: `${parent?.properties?.name || oldParent} · 기존 소속` });
    }
    return choices;
  }

  function syncTerritorialTypeModal() {
    const source = territorialTypeSourceFeature();
    if (!source) {
      closeTerritorialTypeModal();
      return;
    }
    const sourceType = territorialTypeSource.unitType;
    const targetType = (0, dependencies.$)('territorialTypeInput').value;
    const sourceIsCountry = sourceType === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY;
    const targetIsCountry = targetType === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY;
    const targetIsAdmin = targetType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT;
    const sovereignRow = (0, dependencies.$)('territorialTypeSovereignRow');
    sovereignRow.classList.toggle('hidden', !sourceIsCountry || targetIsCountry);

    let sovereignId = sourceIsCountry ? (0, dependencies.$)('territorialTypeSovereignInput').value : String(source.properties?.sovereignId || '');
    if (sourceIsCountry && !targetIsCountry) {
      const options = (0, dependencies.territorialUnitCountryOptions)().filter(option => option.value && option.value !== String(territorialTypeSource.id));
      if (!options.some(option => option.value === sovereignId)) sovereignId = String(options[0]?.value || '');
      (0, dependencies.replaceSelectOptions)((0, dependencies.$)('territorialTypeSovereignInput'), options, sovereignId);
    }

    const parentRow = (0, dependencies.$)('territorialTypeParentRow');
    parentRow.classList.toggle('hidden', !targetIsAdmin);
    if (targetIsAdmin) {
      const options = territorialTypeParentOptions(source, sovereignId);
      const currentParent = (0, dependencies.$)('territorialTypeParentInput').value;
      const preferredParent = options.some(option => option.value === currentParent)
        ? currentParent
        : options.some(option => option.value === String(source.properties?.parentId || ''))
          ? String(source.properties.parentId)
          : String(options[0]?.value || '');
      (0, dependencies.replaceSelectOptions)((0, dependencies.$)('territorialTypeParentInput'), options, preferredParent);
      parentRow.classList.toggle('hidden', options.length < 2 && preferredParent === sovereignId);
    }

    const targetCountry = (0, dependencies.countryFeatureById)(sovereignId);
    const preview = buildTerritorialStructurePreview({
      source,
      sourceType,
      targetType,
      sovereignId,
      parentId: (0, dependencies.$)('territorialTypeParentInput').value,
    });
    (0, dependencies.$)('territorialTypeTitle').textContent = preview?.title || '종류 변경';
    (0, dependencies.$)('territorialTypeImpactSummary').textContent = preview?.summary || '';
    (0, dependencies.$)('territorialTypeImpactList').replaceChildren(...(preview?.impacts || []).map(value => {
      const item = document.createElement('li');
      item.textContent = value;
      return item;
    }));
    (0, dependencies.$)('territorialTypeImpact').classList.toggle('danger-preview', preview?.danger === true);
    const confirm = (0, dependencies.$)('territorialTypeConfirmBtn');
    confirm.textContent = preview?.confirmText || '종류 변경';
    confirm.classList.toggle('danger-confirm', preview?.danger === true);
    confirm.disabled = sourceType === targetType || (sourceIsCountry && !targetIsCountry && !targetCountry)
      || (targetIsAdmin && !(0, dependencies.$)('territorialTypeParentInput').value);
  }

  function openTerritorialTypeModal(unitType, id) {
    const source = unitType === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY ? (0, dependencies.countryFeatureById)(id) : (0, dependencies.territorialUnitById)(id);
    if (!source || ![dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY, dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT].includes(unitType)) return;
    if (!(0, dependencies.requireCanonicalData)()) return;
    const sourceLocked = unitType === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY ? (0, dependencies.isCountryLocked)(id) : source.properties?.locked === true;
    if (sourceLocked) {
      (0, dependencies.setActionStatus)('잠금을 해제한 뒤 종류를 변경하세요.', 'error', 3400);
      return;
    }
    territorialTypeSource = { unitType, id: String(id) };
    const options = Object.entries(dependencies.TERRITORIAL_TYPE_LABELS)
      .filter(([type]) => [dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY, dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT].includes(type) && type !== unitType)
      .map(([value, label]) => ({ value, label }));
    const preferred = unitType === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY ? dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT : dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY;
    (0, dependencies.replaceSelectOptions)((0, dependencies.$)('territorialTypeInput'), options, preferred);
    (0, dependencies.$)('territorialTypeContext').textContent = `${territorialTypeSourceName(source)} · 현재 ${dependencies.TERRITORIAL_TYPE_LABELS[unitType]}`;
    (0, dependencies.$)('territorialTypeSovereignInput').value = '';
    (0, dependencies.$)('territorialTypeParentInput').value = '';
    (0, dependencies.$)('territorialTypeModal').classList.remove('hidden');
    syncTerritorialTypeModal();
    requestAnimationFrame(() => (0, dependencies.$)('territorialTypeInput').focus());
  }

  function closeTerritorialTypeModal() {
    (0, dependencies.$)('territorialTypeModal')?.classList.add('hidden');
    territorialTypeSource = null;
  }

  async function convertTerritorialUnitType(unitId, targetType, parentId = '') {
    const source = (0, dependencies.territorialUnitById)(unitId);
    if (!source || ![dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT].includes(targetType)) return false;
    if (source.properties?.locked) {
      (0, dependencies.setActionStatus)('잠금을 해제한 뒤 종류를 변경하세요.', 'error', 3200);
      return false;
    }
    const sovereignId = String(source.properties?.sovereignId || '');
    const parent = targetType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT
      ? dependencies.territorialRepository.get(parentId || sovereignId)
      : (0, dependencies.countryFeatureById)(sovereignId);
    if (!parent || (targetType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT && !(0, dependencies.territorialUnitInsideContainer)(source, parent))) {
      (0, dependencies.setActionStatus)('영역 전체를 포함하는 올바른 상위 소속을 선택하세요.', 'error', 3900);
      return false;
    }
    try {
      await (0, dependencies.runTerritorialUnitTransaction)({
        snapshot: dependencies.snapshotEditable,
        calculate: async () => {
          const nextUnits = (0, dependencies.deepClone)(dependencies.state.territorialUnits);
          const index = nextUnits.findIndex(feature => String(feature.id) === String(unitId));
          if (index < 0) throw new Error('종류를 변경할 영역을 찾을 수 없습니다.');
          const converted = (0, dependencies.changeUnitType)(nextUnits[index], targetType);
          converted.properties.parentId = targetType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT
            ? String(parentId || sovereignId)
            : sovereignId;
          nextUnits[index] = converted;
          return (0, dependencies.normalizeTerritorialUnits)(nextUnits, { countryExists: id => !!(0, dependencies.countryFeatureById)(id) });
        },
        validate: nextUnits => (0, dependencies.validateTerritorialUnitRelations)(nextUnits, {
          countryExists: id => !!(0, dependencies.countryFeatureById)(id),
          relations: dependencies.state.territorialRelations,
        }),
        apply: async nextUnits => {
          dependencies.state.territorialUnits = nextUnits;
          (0, dependencies.reconcileTerritorialUnitCompleteness)([sovereignId]);
          dependencies.state.territorialUnits = (0, dependencies.normalizeTerritorialUnits)(dependencies.state.territorialUnits, { countryExists: id => !!(0, dependencies.countryFeatureById)(id) });
          (0, dependencies.markLayerTreeDirty)();
          (0, dependencies.applyTerritorialUnitSelectionIntent)(unitId, true);
          dependencies.renderingDomain?.invalidateTerritorialPatch?.('territorial-type-converted');
        },
        restore: before => (0, dependencies.restoreEditable)(before),
        recordHistory: before => dependencies.projectDomain.commitHistorySnapshot(before),
        autosave: (...args) => dependencies.projectDomain.queueAutosave(...args),
      });
      (0, dependencies.setActionStatus)(`${(0, dependencies.territorialUnitName)((0, dependencies.territorialUnitById)(unitId))}을(를) ${dependencies.TERRITORIAL_TYPE_LABELS[targetType]}(으)로 변경했습니다.`, 'success', 3600);
      return true;
    } catch (error) {
      (0, dependencies.reportOperationError)(error, '영역 종류를 변경하지 못해 변경을 되돌렸습니다.', 'PL-TYPE-001', 4500);
      return false;
    }
  }

  async function convertCountryToRegionType(countryId, targetType, targetCountryId, parentId = '') {
    const source = (0, dependencies.countryFeatureById)(countryId);
    const target = (0, dependencies.countryFeatureById)(targetCountryId);
    if (!source || !target || source === target || ![dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT].includes(targetType)) {
      (0, dependencies.setActionStatus)('종류를 변경할 국가와 소속 국가를 다시 선택하세요.', 'error', 3800);
      return false;
    }
    if (!(0, dependencies.requireCountriesUnlocked)([countryId, targetCountryId], '국가 종류를 변경')) return false;
    if (dependencies.state.territorialUnits.some(feature => String(feature.id) === String(countryId))) {
      (0, dependencies.setActionStatus)('같은 ID의 영역이 이미 있어 종류를 변경할 수 없습니다.', 'error', 4000);
      return false;
    }
    const parent = targetType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT ? dependencies.territorialRepository.get(parentId || targetCountryId) : target;
    if (!parent || (String(parent.id || '') !== String(targetCountryId) && !(0, dependencies.territorialUnitInsideContainer)(source, parent))) {
      (0, dependencies.setActionStatus)('국가 영역 전체를 포함하는 올바른 상위 소속을 선택하세요.', 'error', 3900);
      return false;
    }
    const sourceOverride = (0, dependencies.deepClone)(dependencies.state.countryOverrides[countryId] || {});
    const sourceProperties = (0, dependencies.deepClone)(source.properties || {});
    const name = (0, dependencies.countryName)(source);
    const sourceGeometry = (0, dependencies.deepClone)(source.geometry);
    const converted = (0, dependencies.createTerritorialFeature)({
      id: (0, dependencies.uid)(),
      unitType: targetType,
      name,
      geometry: sourceGeometry,
      parentId: targetType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT ? String(parentId || targetCountryId) : String(targetCountryId),
      sovereignId: String(targetCountryId),
      isRemainder: false,
      coverageMode: dependencies.TERRITORIAL_COVERAGE_MODES.PARTITION,
      adminLevel: null,
      color: String(sourceOverride.color || ''),
      notes: String(sourceOverride.notes || ''),
      metadata: { convertedFromCountry: { properties: sourceProperties, override: sourceOverride } },
    });
    const snapshot = (0, dependencies.snapshotEditable)();
    (0, dependencies.setActionStatus)(`${name}의 국가 경계를 대상 국가에 합치는 중입니다.`, 'working', 0);
    const result = await (0, dependencies.transactCountryEdit)({
      operation: 'merge',
      payload: { sourceId: String(targetCountryId), targetIds: [String(countryId)] },
      snapshot,
      applyResult: plan => {
        (0, dependencies.applyWorkerCountryPatches)(plan);
        dependencies.state.territorialUnits.push(converted);
        for (const feature of dependencies.state.territorialUnits) {
          if (String(feature.properties?.sovereignId || '') !== String(countryId)) continue;
          feature.properties.sovereignId = String(targetCountryId);
          if (String(feature.properties?.parentId || '') === String(countryId)) feature.properties.parentId = String(converted.id);
        }
        for (const relation of dependencies.state.territorialRelations) {
          if (String(relation.sovereignId || '') === String(countryId)) relation.sovereignId = String(targetCountryId);
          if (String(relation.parentId || '') === String(countryId)) relation.parentId = String(converted.id);
        }
        for (const entry of dependencies.state.distributionEntries) {
          if (entry.mode === dependencies.DISTRIBUTION_MODES.TERRITORIAL && String(entry.territorialUnitId) === String(countryId)) entry.territorialUnitId = String(converted.id);
        }
        for (const genericFeature of dependencies.state.genericFeatures) {
          if (String(genericFeature.properties?.ownerId || '') !== String(countryId)) continue;
          genericFeature.properties.ownerId = String(targetCountryId);
          if (String(genericFeature.properties.topologyGroup || '') === `land:${countryId}`) genericFeature.properties.topologyGroup = `land:${targetCountryId}`;
        }
        dependencies.state.territorialUnits = (0, dependencies.normalizeTerritorialUnits)(dependencies.state.territorialUnits, { countryExists: id => !!(0, dependencies.countryFeatureById)(id) });
        (0, dependencies.reconcileTerritorialUnitCompleteness)([targetCountryId]);
        dependencies.state.territorialUnits = (0, dependencies.normalizeTerritorialUnits)(dependencies.state.territorialUnits, { countryExists: id => !!(0, dependencies.countryFeatureById)(id) });
        const territorialValidation = (0, dependencies.validateTerritorialUnitRelations)(dependencies.state.territorialUnits, {
          countryExists: id => !!(0, dependencies.countryFeatureById)(id),
          relations: dependencies.state.territorialRelations,
        });
        if (!territorialValidation.ok) throw new Error(territorialValidation.issues[0] || '영역 관계가 올바르지 않습니다.');
        (0, dependencies.refreshCountryCentroids)(new Set(plan.affectedIds));
        dependencies.state.boundaryTopology = { edges: new Map(), nodes: new Map() };
        (0, dependencies.markLayerTreeDirty)();
        (0, dependencies.applyTerritorialUnitSelectionIntent)(converted.id, true);
        dependencies.renderingDomain?.invalidateCountryPatch?.('country-converted-to-region');
      },
      onSuccess: () => (0, dependencies.setActionStatus)(`${name}을(를) ${(0, dependencies.countryName)(target)} 소속 ${dependencies.TERRITORIAL_TYPE_LABELS[targetType]}(으)로 변경했습니다.`, 'success', 4300),
      onError: error => (0, dependencies.reportOperationError)(error, '국가 종류를 변경하지 못해 변경을 되돌렸습니다.', 'PL-TYPE-002', 4800),
    });
    return result.ok;
  }

  async function confirmTerritorialTypeConversion() {
    const source = territorialTypeSourceFeature();
    if (!source || !territorialTypeSource) return;
    const sourceRef = { ...territorialTypeSource };
    const targetType = (0, dependencies.$)('territorialTypeInput').value;
    const sovereignId = sourceRef.unitType === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY
      ? (0, dependencies.$)('territorialTypeSovereignInput').value
      : String(source.properties?.sovereignId || '');
    const parentId = (0, dependencies.$)('territorialTypeParentInput').value;
    closeTerritorialTypeModal();
    if (sourceRef.unitType === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) {
      await convertCountryToRegionType(sourceRef.id, targetType, sovereignId, parentId);
    } else if (targetType === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) {
      await promoteTerritorialUnitToCountry(sourceRef.id);
    } else {
      await convertTerritorialUnitType(sourceRef.id, targetType, parentId);
    }
  }

  function commitLabelEdit(field, value) {
    if (dependencies.state.selected?.domain !== 'label') return;
    const label = dependencies.state.labels.find(x => x.id === dependencies.state.selected.id);
    if (!label) return;
    dependencies.projectDomain.recordHistory();
    label[field] = value;
    if (field === 'name' || field === 'kind') (0, dependencies.markLayerTreeDirty)();
    (0, dependencies.applyLabelSelectionIntent)(label.id, true);
    dependencies.projectDomain.queueAutosave();
    (0, dependencies.setActionStatus)('지명 정보를 변경했습니다.', 'success');
  }

  function initializeTerritorialTypeSource() {
    (territorialTypeSource = null);
  }

  return Object.freeze({
    connect,
    initializeTerritorialTypeSource,
    get closeTerritorialTypeModal() { return closeTerritorialTypeModal; },
    get commitLabelEdit() { return commitLabelEdit; },
    get confirmTerritorialTypeConversion() { return confirmTerritorialTypeConversion; },
    get openTerritorialTypeModal() { return openTerritorialTypeModal; },
    get requestTerritorialUnitPromotion() { return requestTerritorialUnitPromotion; },
    get syncTerritorialTypeModal() { return syncTerritorialTypeModal; },
  });
}
