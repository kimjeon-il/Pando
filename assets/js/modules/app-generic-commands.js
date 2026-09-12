/** GenericCommands: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createGenericCommands() {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('generic-commands already connected');
    dependencies = ports;
  }

  function finishSplitGenericFeatureDraft() {
    (0, dependencies.setActionStatus)('기타 객체는 종류 변경으로만 정리할 수 있습니다.', 'error', 3400);
    return false;
  }

  function countryIdsOverlappingGeometry(geometry, excludeIds = []) {
    const clipper = window.polygonClipping;
    if (!geometry || !clipper?.intersection) return [];
    const excluded = new Set(excludeIds.map(String));
    const bounds = (0, dependencies.geometryBounds)(geometry);
    return (0, dependencies.spatialFeatures)(bounds)
      .filter(country => {
        const id = String(country.id || '');
        return id && !excluded.has(id)
          && (0, dependencies.multiPolygonPlanarArea)(clipper.intersection(geometry.coordinates, country.geometry.coordinates)) > 1e-14;
      })
      .map(country => String(country.id));
  }

  function geometryClippedToCurrentLand(geometry) {
    const clipper = window.polygonClipping;
    if (!geometry || !clipper?.intersection || !clipper?.union) return null;
    const pieces = [];
    const bounds = (0, dependencies.geometryBounds)(geometry);
    for (const country of (0, dependencies.spatialFeatures)(bounds)) {
      const overlap = clipper.intersection(geometry.coordinates, country.geometry.coordinates);
      if (overlap?.length) pieces.push(...overlap);
    }
    if (!pieces.length) return null;
    return (0, dependencies.normalizeClippedLandGeometry)(pieces.length === 1 ? pieces : clipper.union(...pieces.map(polygon => [polygon])));
  }

  async function applySelectedGenericFeatureToOwnerCountry() {
    if (dependencies.state.selected?.domain !== 'generic') return;
    const feature = dependencies.state.genericFeatures.find(item => String(item.id) === String(dependencies.state.selected.id));
    const ownerId = String(feature?.properties?.ownerId || '');
    const owner = (0, dependencies.countryFeatureById)(ownerId);
    if (!feature || (0, dependencies.genericFeatureGeometryKind)(feature) !== 'polygon' || !owner) {
      (0, dependencies.setActionStatus)('국가 영토에 반영할 수 없습니다. 면 객체의 소유 국가를 먼저 지정하세요.', 'error', 4000);
      return;
    }
    const transferredGeometry = geometryClippedToCurrentLand(feature.geometry);
    if (!transferredGeometry) {
      (0, dependencies.setActionStatus)('국가 영토에 반영할 육지 영역이 없습니다. 형상과 소유 국가를 확인하세요.', 'error', 3800);
      return;
    }
    const donorIds = countryIdsOverlappingGeometry(transferredGeometry, [ownerId]);
    if (!(0, dependencies.requireCountriesUnlocked)([ownerId, ...donorIds], '국가 영토에 반영')) return;
    if (!donorIds.length) {
      dependencies.projectDomain.recordHistory();
      feature.geometry = (0, dependencies.normalizeClippedLandGeometry)(window.polygonClipping.intersection(feature.geometry.coordinates, owner.geometry.coordinates)) || feature.geometry;
      (0, dependencies.normalizeGenericFeatureSemantics)(feature, { inferOwner: false });
      (0, dependencies.applyGenericSelectionIntent)(String(feature.id), true);
      dependencies.renderingDomain?.invalidateGenericPatch?.('generic-owner-clip-preview');
      dependencies.projectDomain.queueAutosave();
      (0, dependencies.setActionStatus)('영역이 이미 소유 국가 안에 있습니다. 국가 해안선 결합을 갱신했습니다.', 'success', 3400);
      return;
    }
    const snapshot = (0, dependencies.snapshotEditable)();
    (0, dependencies.setActionStatus)('영역을 국가 영토에 반영하는 중입니다.', 'working', 0);
    await (0, dependencies.transactCountryEdit)({
      operation: 'annex',
      payload: { targetId: ownerId, donorIds, transferredGeometry },
      snapshot,
      applyResult: result => {
        (0, dependencies.applyWorkerCountryPatches)(result);
        (0, dependencies.reindexCountries)(dependencies.state.countriesData, true);
        (0, dependencies.transferLandDependents)(transferredGeometry, donorIds, ownerId);
        (0, dependencies.normalizeGenericFeatureSemantics)(feature, { inferOwner: false });
        (0, dependencies.refreshCountryCentroids)(new Set(result.affectedIds));
        (0, dependencies.applyGenericSelectionIntent)(String(feature.id), true);
        dependencies.renderingDomain?.invalidateGenericPatch?.('generic-owner-clip-committed');
      },
      onSuccess: () => (0, dependencies.setActionStatus)(`${(0, dependencies.genericFeatureName)(feature)} 영역을 ${(0, dependencies.countryName)((0, dependencies.countryFeatureById)(ownerId))} 영토에 반영했습니다.`, 'success', 3800),
      onError: error => (0, dependencies.reportOperationError)(error, '영역을 국가 영토에 반영하지 못했습니다. 소유 국가와 겹치는 범위를 확인하세요.', 'PL-LAND-001', 4600),
    });
  }

  async function promoteSelectedGenericFeatureToCountry() {
    if (dependencies.state.selected?.domain !== 'generic') return;
    const feature = dependencies.state.genericFeatures.find(item => String(item.id) === String(dependencies.state.selected.id));
    if (!feature || (0, dependencies.genericFeatureGeometryKind)(feature) !== 'polygon') {
      (0, dependencies.setActionStatus)('국가로 전환할 수 없습니다. 면 객체를 선택하세요.', 'error', 3400);
      return;
    }
    if (!canConvertGenericFeature(feature)) return false;
    const transferredGeometry = geometryClippedToCurrentLand(feature.geometry);
    const sourceIds = transferredGeometry ? countryIdsOverlappingGeometry(transferredGeometry) : [];
    if (!transferredGeometry || !sourceIds.length) {
      (0, dependencies.setActionStatus)('국가로 전환할 육지 영역이 없습니다. 객체가 현재 국가 영토와 겹치는지 확인하세요.', 'error', 4000);
      return;
    }
    if (!(0, dependencies.requireCountriesUnlocked)(sourceIds, '국가로 전환')) return;
    const name = String(feature.properties?.name || '').trim() || '이름 없음';
    const snapshot = (0, dependencies.snapshotEditable)();
    const country = (0, dependencies.createCountryFeature)(name, [], feature.properties?.color || null, (0, dependencies.snapGeometryToGrid)(transferredGeometry, 7));
    country.properties.metadata = legacyGenericMetadata(feature);
    (0, dependencies.setActionStatus)('영역을 국가로 전환하는 중입니다.', 'working', 0);
    await (0, dependencies.transactCountryEdit)({
      operation: 'new-country',
      payload: { sourceIds, transferredGeometry, newFeature: country },
      snapshot,
      applyResult: result => {
        (0, dependencies.applyWorkerCountryPatches)(result);
        (0, dependencies.transferLandDependents)(transferredGeometry, sourceIds, country.id, [feature.id]);
        dependencies.state.genericFeatures = dependencies.state.genericFeatures.filter(item => String(item.id) !== String(feature.id));
        dependencies.mapObjectGeometryRevisions.generic += 1;
        (0, dependencies.reindexCountries)(dependencies.state.countriesData, true);
        (0, dependencies.refreshCountryCentroids)(new Set(result.affectedIds));
        (0, dependencies.markLayerTreeDirty)();
        (0, dependencies.applyCountrySelectionIntent)(country.id);
        dependencies.renderingDomain?.invalidateCountryPatch?.('generic-promoted-country');
      },
      onSuccess: () => (0, dependencies.setActionStatus)(`${name} 영역을 독립 국가로 전환했습니다.`, 'success', 3600),
      onError: error => (0, dependencies.reportOperationError)(error, '영역을 국가로 전환하지 못했습니다. 다른 국가와의 중첩과 형상을 확인하세요.', 'PL-LAND-002', 4600),
    });
  }

  function legacyGenericMetadata(feature) {
    return { compatibilitySource: (0, dependencies.deepClone)(feature.properties || {}) };
  }

  function canConvertGenericFeature(feature) {
    const dependentCount = dependencies.state.genericFeatures.filter(candidate => String(candidate.id) !== String(feature.id)
      && String(candidate.properties?.parentId || '') === String(feature.id)).length;
    if (!dependentCount) return true;
    (0, dependencies.setActionStatus)(`이 객체를 상위로 참조하는 기타 객체 ${dependentCount}개가 있습니다. 먼저 그 객체를 전환하거나 관계를 정리하세요.`, 'error', 4200);
    return false;
  }

  function removeGenericFeatureAfterConversion(feature) {
    dependencies.state.genericFeatures = dependencies.state.genericFeatures.filter(item => String(item.id) !== String(feature.id));
    dependencies.mapObjectGeometryRevisions.generic += 1;
    dependencies.renderingDomain?.invalidateGenericPatch?.('generic-feature-converted');
  }

  function genericCoordinates(feature) {
    const type = feature?.geometry?.type;
    if (type === 'Point') return [feature.geometry.coordinates];
    if (type === 'MultiPoint') return feature.geometry.coordinates || [];
    return [];
  }

  async function convertSelectedGenericFeature({ target, sovereignId = '', distributionLayerId = '' } = {}) {
    if (dependencies.state.selected?.domain !== 'generic') return false;
    const feature = dependencies.state.genericFeatures.find(item => String(item.id) === String(dependencies.state.selected.id));
    const kind = (0, dependencies.genericFeatureGeometryKind)(feature);
    if (!feature || feature.properties?.locked) {
      (0, dependencies.setActionStatus)('잠금을 해제한 뒤 종류를 변경하세요.', 'error', 3400);
      return false;
    }
    if (!canConvertGenericFeature(feature)) return false;
    if (target === 'country') return promoteSelectedGenericFeatureToCountry();
    const name = String(feature.properties?.name || '').trim() || '이름 없음';
    const color = feature.properties?.color || feature.properties?.editorColor || '';
    try {
      if (target === 'river' || target === 'lake') {
        const expectedKind = target === 'river' ? 'line' : 'polygon';
        if (kind !== expectedKind) throw new Error(`${target === 'river' ? '강' : '호수'}으로 전환할 수 없는 형상입니다.`);
        const hydro = {
          type: 'Feature', id: (0, dependencies.uid)(target), geometry: (0, dependencies.deepClone)(feature.geometry),
          properties: { name, editorColor: color, category: target, notes: String(feature.properties?.notes || ''), metadata: legacyGenericMetadata(feature) },
        };
        dependencies.projectDomain.recordHistory({ type: 'generic-convert-hydro', affectedIds: [String(feature.id), String(hydro.id)] });
        (0, dependencies.normalizeHydroEdit)(hydro);
        dependencies.state.hydroEdits.push(hydro);
        removeGenericFeatureAfterConversion(feature);
        (0, dependencies.markLayerTreeDirty)();
        dependencies.projectDomain.queueAutosave();
        (0, dependencies.applyHydroSelectionIntent)(String(hydro.id));
        dependencies.renderingDomain?.invalidateGpuInteraction?.('generic-converted-hydro');
        (0, dependencies.setActionStatus)(`${name}을(를) ${target === 'river' ? '강' : '호수'}로 전환했습니다.`, 'success');
        return true;
      }
      if (target === 'label') {
        const points = genericCoordinates(feature);
        if (!points.length) throw new Error('지명으로 전환할 수 없는 형상입니다.');
        dependencies.projectDomain.recordHistory({ type: 'generic-convert-label', affectedIds: [String(feature.id)] });
        const labels = points.map((coordinates, index) => {
          const id = (0, dependencies.uid)('label');
          const label = {
            id, name: points.length > 1 ? `${name} ${index + 1}` : name, kind: 'custom', coordinates: coordinates.slice(),
            notes: String(feature.properties?.notes || ''), metadata: legacyGenericMetadata(feature),
          };
          dependencies.state.labelSettings[(0, dependencies.labelKey)('label', id)] = (0, dependencies.automaticLabelSettings)(label.kind, { pinned: false });
          return label;
        });
        dependencies.state.labels.push(...labels);
        removeGenericFeatureAfterConversion(feature);
        (0, dependencies.markLayerTreeDirty)();
        dependencies.projectDomain.queueAutosave();
        (0, dependencies.applyLabelSelectionIntent)(labels[0].id);
        dependencies.renderingDomain?.invalidateLabels?.('generic-converted-label');
        (0, dependencies.setActionStatus)(`${name}을(를) 지명으로 전환했습니다.`, 'success');
        return true;
      }
      if (target === 'subunit' || target === 'region') {
        if (kind !== 'polygon') throw new Error('영역 형상만 하위단위 또는 지방으로 전환할 수 있습니다.');
        const country = (0, dependencies.countryFeatureById)(sovereignId);
        if (!country) throw new Error('소속 국가를 선택하세요.');
        const unitType = target === 'subunit' ? dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT : dependencies.TERRITORIAL_UNIT_TYPES.REGION;
        const unit = (0, dependencies.createTerritorialFeature)({
          id: (0, dependencies.uid)(unitType), unitType, name, geometry: (0, dependencies.deepClone)(feature.geometry),
          sovereignId: String(country.id), parentId: target === 'subunit' ? String(country.id) : '',
          coverageMode: dependencies.TERRITORIAL_COVERAGE_MODES.EXPLICIT, isRemainder: false, color,
          validFrom: feature.properties?.validFrom ?? null, validTo: feature.properties?.validTo ?? null,
          notes: String(feature.properties?.notes || ''), metadata: legacyGenericMetadata(feature),
        });
        dependencies.projectDomain.recordHistory({ type: 'generic-convert-territorial', affectedIds: [String(feature.id), String(unit.id)] });
        dependencies.state.territorialUnits.push(unit);
        dependencies.state.territorialUnits = (0, dependencies.normalizeTerritorialUnits)(dependencies.state.territorialUnits, { countryExists: id => !!(0, dependencies.countryFeatureById)(id) });
        removeGenericFeatureAfterConversion(feature);
        (0, dependencies.markLayerTreeDirty)();
        dependencies.projectDomain.queueAutosave();
        (0, dependencies.applyTerritorialUnitSelectionIntent)(unit.id, true);
        dependencies.renderingDomain?.invalidateTerritorialPatch?.('generic-converted-territorial');
        (0, dependencies.setActionStatus)(`${name}을(를) ${target === 'subunit' ? '하위단위' : '지방'}으로 전환했습니다.`, 'success');
        return true;
      }
      if (target === 'distribution') {
        if (kind !== 'polygon') throw new Error('영역 형상만 분포로 전환할 수 있습니다.');
        const result = dependencies.distributionService.addEntry({
          id: (0, dependencies.uid)('distribution_entry'), layerId: String(distributionLayerId), mode: dependencies.DISTRIBUTION_MODES.GEOMETRY,
          geometry: (0, dependencies.deepClone)(feature.geometry), share: 100,
        });
        if (!result.ok) throw result.error || new Error('분포 레이어를 선택하세요.');
        removeGenericFeatureAfterConversion(feature);
        (0, dependencies.markLayerTreeDirty)();
        (0, dependencies.applyDistributionSelectionIntent)(result.layer.id);
        (0, dependencies.setActionStatus)(`${name}을(를) 분포로 전환했습니다.`, 'success');
        return true;
      }
      throw new Error('이 형상에 사용할 수 있는 대상 종류를 선택하세요.');
    } catch (error) {
      (0, dependencies.reportOperationError)(error, '종류를 변경하지 못했습니다. 대상과 소속을 확인하세요.', 'PL-GENERIC-CONVERT-001', 4200);
      return false;
    }
  }

  function alignSelectedGenericFeatureToOwnerLand() {
    if (dependencies.state.selected?.domain !== 'generic') return;
    const feature = dependencies.state.genericFeatures.find(item => String(item.id) === String(dependencies.state.selected.id));
    const owner = (0, dependencies.countryFeatureById)(feature?.properties?.ownerId);
    if (!feature || !owner || (0, dependencies.genericFeatureGeometryKind)(feature) !== 'polygon') {
      (0, dependencies.setActionStatus)('국가 육지에 맞출 수 없습니다. 면 객체의 소유 국가를 먼저 지정하세요.', 'error', 3800);
      return;
    }
    const next = (0, dependencies.normalizeClippedLandGeometry)(window.polygonClipping.intersection(feature.geometry.coordinates, owner.geometry.coordinates));
    if (!next) {
      (0, dependencies.setActionStatus)('객체와 소유 국가가 겹치지 않습니다. 소유 국가를 다시 지정하세요.', 'error', 3800);
      return;
    }
    dependencies.projectDomain.recordHistory();
    feature.geometry = next;
    dependencies.mapObjectGeometryRevisions.generic += 1;
    feature.properties.landBinding = 'hard';
    feature.properties.topologyGroup = `land:${feature.properties.ownerId}`;
    dependencies.genericFeatureLandClipCache.delete(feature);
    (0, dependencies.applyGenericSelectionIntent)(String(feature.id), true);
    dependencies.renderingDomain?.invalidateGenericPatch?.('generic-owner-align');
    dependencies.projectDomain.queueAutosave();
    (0, dependencies.setActionStatus)('객체를 소유 국가의 현재 육지와 맞췄습니다.', 'success', 3200);
  }

  function enterGenericFeatureSplitMode(id) {
    void id;
    (0, dependencies.setActionStatus)('기타 객체는 종류 변경으로만 정리할 수 있습니다.', 'error', 3400);
    return false;
  }

  function enterGenericFeatureMergeMode(id) {
    void id;
    (0, dependencies.setActionStatus)('기타 객체는 종류 변경으로만 정리할 수 있습니다.', 'error', 3400);
    return false;
  }

  function toggleGenericFeatureMergeTarget(id) {
    if (dependencies.state.tool !== 'merge-generic-feature') return;
    const source = dependencies.state.genericFeatures.find(item => String(item.id) === String(dependencies.state.genericFeatureMergeSourceId));
    const target = dependencies.state.genericFeatures.find(item => String(item.id) === String(id));
    if (!source || !target || String(source.id) === String(target.id)) return;
    if ((0, dependencies.genericFeatureRole)(source) !== (0, dependencies.genericFeatureRole)(target) || (0, dependencies.genericFeatureGeometryKind)(target) !== 'polygon') {
      (0, dependencies.setActionStatus)('같은 역할의 면 영역만 합칠 수 있습니다.', 'error', 3200);
      return;
    }
    if (['territory', 'administrative'].includes((0, dependencies.genericFeatureRole)(source)) && String(source.properties?.ownerId || '') !== String(target.properties?.ownerId || '')) {
      (0, dependencies.setActionStatus)('소유 국가가 같은 영역끼리만 합칠 수 있습니다.', 'error', 3400);
      return;
    }
    const targets = new Set(dependencies.state.genericFeatureMergeTargetIds.map(String));
    if (targets.has(String(id))) targets.delete(String(id)); else targets.add(String(id));
    dependencies.state.genericFeatureMergeTargetIds = [...targets];
    dependencies.renderingDomain?.renderGenericFeatures?.();
    (0, dependencies.updateModeButtons)();
  }

  function completeGenericFeatureMerge() {
    (0, dependencies.setActionStatus)('기타 객체는 종류 변경으로만 정리할 수 있습니다.', 'error', 3400);
    return false;
  }

  function requestDraftDiscard(action) {
    const draftCount = (0, dependencies.editingDraftCoordinates)().length;
    if (!dependencies.editingDomain?.draftInputActive?.() || draftCount < 3) {
      action?.();
      return true;
    }
    (0, dependencies.openConfirmModal)({
      title: '그리기 취소',
      message: `작성 중인 점 ${draftCount}개를 버리고 현재 그리기를 취소합니다.`,
      confirmText: '그리기 취소',
      cancelText: '계속 그리기',
      danger: true,
      onConfirm: () => action?.(),
    });
    return false;
  }

  function discardActiveDraftSilently() {
    if (!dependencies.editingDomain?.draftInputActive?.()) return;
    if ((0, dependencies.isGenericFeatureDraftTool)(dependencies.state.tool)) cancelDraft(false);
    else (0, dependencies.cancelActiveMode)(false);
  }

  function cancelDraft(showMessage = true) {
    const terrain = (0, dependencies.hydroToolConfig)(dependencies.state.tool);
    const splitSourceId = dependencies.state.tool === 'split-generic-feature' ? dependencies.state.genericFeatureSplitSourceId : null;
    const territorialSplitSourceId = dependencies.state.tool === 'split-territorial-unit' ? dependencies.state.territorialUnitSplitSourceId : null;
    const territorialRedrawSourceId = dependencies.state.tool === 'redraw-territorial-unit' ? dependencies.state.territorialUnitRedrawSourceId : null;
    const directTerritorialUnit = dependencies.state.tool === 'draw-territorial-unit';
    const distributionDraft = dependencies.state.distributionDraft;
    dependencies.state.distributionDraft = null;
    dependencies.editingDomain?.clearDraft?.(true);
    dependencies.editingDomain?.setTool('select', { announce: false });
    if (splitSourceId && dependencies.state.genericFeatures.some(item => String(item.id) === String(splitSourceId))) (0, dependencies.applyGenericSelectionIntent)(String(splitSourceId), true);
    else if (territorialSplitSourceId && (0, dependencies.territorialUnitById)(territorialSplitSourceId)) (0, dependencies.applyTerritorialUnitSelectionIntent)(territorialSplitSourceId, true);
    else if (territorialRedrawSourceId && (0, dependencies.territorialUnitById)(territorialRedrawSourceId)) (0, dependencies.applyTerritorialUnitSelectionIntent)(territorialRedrawSourceId, true);
    dependencies.renderingDomain?.invalidateGpuInteraction?.('draft-cancel');
    if (distributionDraft?.layerId && (0, dependencies.distributionLayerById)(distributionDraft.layerId)) (0, dependencies.applyDistributionSelectionIntent)(distributionDraft.layerId, true);
    if (showMessage) (0, dependencies.setActionStatus)(distributionDraft ? '자유 분포 그리기를 취소했습니다.' : splitSourceId || territorialSplitSourceId || territorialRedrawSourceId || directTerritorialUnit ? '영역 작업을 취소했습니다.' : `${terrain?.label || '기타 객체'} 추가를 취소했습니다.`, 'success');
  }

  function addLabelAt(coord) {
    const name = prompt('지명 또는 도시명을 입력하세요.', '새 지명');
    if (name === null) return;
    dependencies.projectDomain.recordHistory();
    const label = { id: (0, dependencies.uid)('label'), name: name.trim() || '새 지명', kind: 'city', coordinates: coord.slice(), notes: '' };
    dependencies.state.labels.push(label);
    dependencies.state.labelSettings[(0, dependencies.labelKey)('label', label.id)] = (0, dependencies.automaticLabelSettings)(label.kind, { pinned: false });
    (0, dependencies.exitLabelMode)(false);
    (0, dependencies.applyLabelSelectionIntent)(label.id);
    dependencies.renderingDomain?.invalidateLabels?.('label-created');
    dependencies.projectDomain.queueAutosave();
    (0, dependencies.setActionStatus)(`${label.name} 지명을 추가했습니다.`, 'success');
  }

  function labelDragBehavior() {
    return dependencies.d3.behavior.drag()
      .on('dragstart', function() {
        if (dependencies.state.tool !== 'select') return;
        dependencies.projectDomain.recordHistory();
        dependencies.d3.event.sourceEvent?.stopPropagation?.();
      })
      .on('drag', function(label) {
        if (dependencies.state.tool !== 'select') return;
        const coord = (0, dependencies.screenToGeo)(dependencies.d3.mouse(dependencies.svg.node()));
        if (!coord) return;
        label.coordinates = coord;
        const p = (0, dependencies.activeProjection)()(coord);
        dependencies.d3.select(this).attr('transform', `translate(${p[0]},${p[1]})`);
      })
      .on('dragend', function(label) {
        if (dependencies.state.tool !== 'select') return;
        dependencies.state.labelSettings[(0, dependencies.labelKey)('label', label.id)] = (0, dependencies.normalizeLabelSettings)({
          ...(dependencies.state.labelSettings[(0, dependencies.labelKey)('label', label.id)] || {}),
          manualPosition: label.coordinates,
          pinned: true,
        });
        dependencies.mapObjectGeometryRevisions.label += 1;
        dependencies.renderingDomain?.invalidateLabels?.('label-moved');
        dependencies.projectDomain.queueAutosave();
        (0, dependencies.setActionStatus)(`${label.name} 지명을 이동했습니다.`, 'success');
      });
  }



  return Object.freeze({
    connect,

    get addLabelAt() { return addLabelAt; },
    get alignSelectedGenericFeatureToOwnerLand() { return alignSelectedGenericFeatureToOwnerLand; },
    get applySelectedGenericFeatureToOwnerCountry() { return applySelectedGenericFeatureToOwnerCountry; },
    get cancelDraft() { return cancelDraft; },
    get convertSelectedGenericFeature() { return convertSelectedGenericFeature; },
    get completeGenericFeatureMerge() { return completeGenericFeatureMerge; },
    get discardActiveDraftSilently() { return discardActiveDraftSilently; },
    get enterGenericFeatureMergeMode() { return enterGenericFeatureMergeMode; },
    get enterGenericFeatureSplitMode() { return enterGenericFeatureSplitMode; },
    get finishSplitGenericFeatureDraft() { return finishSplitGenericFeatureDraft; },
    get labelDragBehavior() { return labelDragBehavior; },
    get promoteSelectedGenericFeatureToCountry() { return promoteSelectedGenericFeatureToCountry; },
    get requestDraftDiscard() { return requestDraftDiscard; },
    get toggleGenericFeatureMergeTarget() { return toggleGenericFeatureMergeTarget; },
  });
}
