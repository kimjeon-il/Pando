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
    const source = dependencies.state.genericFeatures.find(item => String(item.id) === String(dependencies.state.genericFeatureSplitSourceId));
    if (!source || (0, dependencies.genericFeatureGeometryKind)(source) !== 'polygon') {
      (0, dependencies.setActionStatus)('나눌 영역을 찾을 수 없습니다. 영역을 다시 선택하세요.', 'error', 3400);
      return;
    }
    try {
      const split = (0, dependencies.buildCutSplitCandidates)(source.geometry, (0, dependencies.editingDraftCoordinates)());
      const untouchedComponents = (0, dependencies.geometryPolygonSets)(source.geometry)
        .filter((_, index) => index !== split.componentIndex)
        .map(polygon => (0, dependencies.deepClone)(polygon));
      const retainedGeometry = (0, dependencies.normalizeClippedLandGeometry)([
        ...(0, dependencies.geometryMultiCoordinates)(split.candidates[0].geometry),
        ...untouchedComponents,
      ]);
      if (!retainedGeometry) throw new Error('나누지 않은 영토 조각을 보존할 수 없습니다.');
      const baseName = (0, dependencies.genericFeatureName)(source);
      const sourceAfter = (0, dependencies.deepClone)(source);
      sourceAfter.geometry = retainedGeometry;
      sourceAfter.properties.name = `${baseName} 1`;
      const sibling = (0, dependencies.normalizeGenericFeatureSemantics)({
        type: 'Feature',
        id: (0, dependencies.uid)('area'),
        geometry: (0, dependencies.deepClone)(split.candidates[1].geometry),
        properties: { ...(0, dependencies.deepClone)(sourceAfter.properties), name: `${baseName} 2` },
      }, { inferOwner: false });
      (0, dependencies.beginLocalGeometryPreview)({
        operation: 'split-generic-feature',
        beforeFeatures: [source],
        afterFeatures: [sourceAfter, sibling],
        applyResult: () => {
          dependencies.projectDomain.recordHistory();
          source.geometry = (0, dependencies.deepClone)(sourceAfter.geometry);
          source.properties = (0, dependencies.deepClone)(sourceAfter.properties);
          dependencies.state.genericFeatures.push((0, dependencies.deepClone)(sibling));
          dependencies.editingDomain?.clearDraft?.(true);
          dependencies.editingDomain?.setTool('select', { announce: false });
          (0, dependencies.applyGenericSelectionIntent)(String(source.id), true);
        },
        successMessage: `${baseName} 영역을 두 영역으로 나눴습니다.`,
        errorMessage: '영역 나누기 결과를 적용하지 못했습니다.',
      });
    } catch (error) {
      (0, dependencies.reportOperationError)(error, '영역을 나누지 못했습니다. 영역을 한 번만 관통하도록 경계를 다시 그리세요.', 'PL-LAND-003', 4200);
    }
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
    const transferredGeometry = geometryClippedToCurrentLand(feature.geometry);
    const sourceIds = transferredGeometry ? countryIdsOverlappingGeometry(transferredGeometry) : [];
    if (!transferredGeometry || !sourceIds.length) {
      (0, dependencies.setActionStatus)('국가로 전환할 육지 영역이 없습니다. 객체가 현재 국가 영토와 겹치는지 확인하세요.', 'error', 4000);
      return;
    }
    if (!(0, dependencies.requireCountriesUnlocked)(sourceIds, '국가로 전환')) return;
    const name = String(feature.properties?.name || '').trim();
    if (!name) {
      (0, dependencies.setActionStatus)('국가로 전환하기 전에 객체 이름을 입력하세요.', 'error', 3400);
      return;
    }
    const snapshot = (0, dependencies.snapshotEditable)();
    const country = (0, dependencies.createCountryFeature)(name, [], feature.properties?.color || null, (0, dependencies.snapGeometryToGrid)(transferredGeometry, 7));
    (0, dependencies.setActionStatus)('영역을 국가로 전환하는 중입니다.', 'working', 0);
    await (0, dependencies.transactCountryEdit)({
      operation: 'new-country',
      payload: { sourceIds, transferredGeometry, newFeature: country },
      snapshot,
      applyResult: result => {
        (0, dependencies.applyWorkerCountryPatches)(result);
        (0, dependencies.transferLandDependents)(transferredGeometry, sourceIds, country.id, [feature.id]);
        dependencies.state.genericFeatures = dependencies.state.genericFeatures.filter(item => String(item.id) !== String(feature.id));
        (0, dependencies.reindexCountries)(dependencies.state.countriesData, true);
        (0, dependencies.refreshCountryCentroids)(new Set(result.affectedIds));
        (0, dependencies.applyCountrySelectionIntent)(country.id);
        dependencies.renderingDomain?.invalidateCountryPatch?.('generic-promoted-country');
      },
      onSuccess: () => (0, dependencies.setActionStatus)(`${name} 영역을 독립 국가로 전환했습니다.`, 'success', 3600),
      onError: error => (0, dependencies.reportOperationError)(error, '영역을 국가로 전환하지 못했습니다. 다른 국가와의 중첩과 형상을 확인하세요.', 'PL-LAND-002', 4600),
    });
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
    const feature = dependencies.state.genericFeatures.find(item => String(item.id) === String(id));
    if (!feature || (0, dependencies.genericFeatureGeometryKind)(feature) !== 'polygon') return false;
    dependencies.state.genericFeatureSplitSourceId = String(id);
    dependencies.editingDomain?.setTool('split-generic-feature', { announce: false });
    dependencies.state.genericFeatureSplitSourceId = String(id);
    (0, dependencies.setModeBanner)((0, dependencies.defaultDraftInstruction)());
    return true;
  }

  function enterGenericFeatureMergeMode(id) {
    const feature = dependencies.state.genericFeatures.find(item => String(item.id) === String(id));
    if (!feature || (0, dependencies.genericFeatureGeometryKind)(feature) !== 'polygon') return false;
    dependencies.state.genericFeatureMergeSourceId = String(id);
    dependencies.state.genericFeatureMergeTargetIds = [];
    dependencies.editingDomain?.setTool('merge-generic-feature', { announce: false });
    dependencies.state.genericFeatureMergeSourceId = String(id);
    (0, dependencies.setModeBanner)('합칠 영역을 선택하세요.');
    return true;
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
    const source = dependencies.state.genericFeatures.find(item => String(item.id) === String(dependencies.state.genericFeatureMergeSourceId));
    const targets = dependencies.state.genericFeatureMergeTargetIds.map(id => dependencies.state.genericFeatures.find(item => String(item.id) === String(id))).filter(Boolean);
    if (!source || !targets.length) {
      (0, dependencies.setActionStatus)('합칠 영역을 하나 이상 선택하세요.', 'error', 3000);
      return;
    }
    const merged = (0, dependencies.normalizeClippedLandGeometry)(window.polygonClipping.union(source.geometry.coordinates, ...targets.map(item => item.geometry.coordinates)));
    if (!merged) {
      (0, dependencies.setActionStatus)('선택한 영역을 합칠 수 없습니다. 형상을 확인하세요.', 'error', 3400);
      return;
    }
    const removed = new Set(targets.map(item => String(item.id)));
    const sourceAfter = (0, dependencies.deepClone)(source);
    sourceAfter.geometry = merged;
    (0, dependencies.beginLocalGeometryPreview)({
      operation: 'merge-generic-feature',
      beforeFeatures: [source, ...targets],
      afterFeatures: [sourceAfter],
      removedIds: [...removed],
      applyResult: () => {
        dependencies.projectDomain.recordHistory();
        source.geometry = (0, dependencies.deepClone)(merged);
        (0, dependencies.reassignGenericFeatureParents)([...removed], String(source.id));
        dependencies.state.genericFeatures = dependencies.state.genericFeatures.filter(item => !removed.has(String(item.id)));
        (0, dependencies.normalizeGenericFeatureSemantics)(source, { inferOwner: false });
        dependencies.editingDomain?.setTool('select', { announce: false });
        (0, dependencies.applyGenericSelectionIntent)(String(source.id), true);
      },
      successMessage: `${targets.length + 1}개 영역을 하나로 합쳤습니다.`,
      errorMessage: '영역 합치기 결과를 적용하지 못했습니다.',
    });
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
