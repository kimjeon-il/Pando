/** TerritorialDrafts: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createTerritorialDrafts() {
  let dependencies;
  let pendingTerritorialCreateType;
  function connect(ports) {
    if (dependencies) throw new Error('territorial-drafts already connected');
    dependencies = ports;
  }

  function territorialPartitionContext(unitType) {
    const selectedUnit = (dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type !== dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) ? (0, dependencies.territorialUnitById)(dependencies.state.selected.id) : null;
    const selectedCountry = (dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) ? (0, dependencies.countryFeatureById)(dependencies.state.selected.id) : null;
    const sovereignId = String(selectedUnit?.properties?.sovereignId || selectedCountry?.id || '');
    const country = (0, dependencies.countryFeatureById)(sovereignId);
    if (!country) return null;
    const parent = selectedUnit?.properties?.unitType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT ? selectedUnit : null;
    const parentId = String(parent?.id || country.id);
    const adminLevel = null;
    const existing = dependencies.state.territorialUnits.find(feature => feature.properties?.unitType === unitType
      && String(feature.properties?.sovereignId || '') === sovereignId
      && String(feature.properties?.parentId || '') === parentId
      && Number(feature.properties?.adminLevel || 0) === Number(adminLevel || 0)
      && feature.properties?.isRemainder === true)
      || dependencies.state.territorialUnits.find(feature => feature.properties?.unitType === unitType
        && String(feature.properties?.sovereignId || '') === sovereignId
        && String(feature.properties?.parentId || '') === parentId
        && Number(feature.properties?.adminLevel || 0) === Number(adminLevel || 0));
    return { unitType, sovereignId, parentId, adminLevel, container: parent || country, source: existing || null };
  }

  function explicitRegionCreateContext() {
    const selectedUnit = (dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type !== dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) ? (0, dependencies.territorialUnitById)(dependencies.state.selected.id) : null;
    const selectedCountry = (dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) ? (0, dependencies.countryFeatureById)(dependencies.state.selected.id) : null;
    return {
      unitType: dependencies.TERRITORIAL_UNIT_TYPES.REGION,
      sovereignId: String(selectedUnit?.properties?.sovereignId || selectedCountry?.id || ''),
      parentId: '',
      adminLevel: null,
      container: selectedUnit || selectedCountry || null,
      source: null,
    };
  }

  function territorialCreateContext(unitType) {
    return unitType === dependencies.TERRITORIAL_UNIT_TYPES.REGION
      ? explicitRegionCreateContext()
      : territorialPartitionContext(unitType);
  }

  function enterTerritorialUnitSplitMode(idOrFeature, { virtual = false } = {}) {
    const feature = typeof idOrFeature === 'object' ? idOrFeature : (0, dependencies.territorialUnitById)(idOrFeature);
    if (!feature?.geometry) return false;
    dependencies.editingDomain?.setTool('split-territorial-unit', { announce: false });
    dependencies.state.territorialUnitSplitSourceId = virtual ? null : String(feature.id);
    dependencies.state.territorialUnitSplitVirtualSource = virtual ? (0, dependencies.deepClone)(feature) : null;
    (0, dependencies.setModeBanner)((0, dependencies.defaultDraftInstruction)());
    (0, dependencies.updateModeButtons)();
    return true;
  }

  function startTerritorialUnitCreate(unitType) {
    if (unitType === dependencies.TERRITORIAL_UNIT_TYPES.REGION) return false;
    const context = territorialPartitionContext(unitType);
    if (!context) {
      (0, dependencies.setActionStatus)(unitType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT
        ? '하위단위의 부모로 사용할 국가 또는 하위단위를 먼저 선택하세요.'
        : '하위단위를 만들 국가를 먼저 선택하세요.', 'error', 3900);
      return false;
    }
    const source = context.source || (0, dependencies.createPartitionTerritorialFeature)({
      id: (0, dependencies.uid)('subunit'),
      unitType,
      sovereignId: context.sovereignId,
      parentId: context.parentId,
      adminLevel: context.adminLevel,
      isRemainder: true,
      geometry: (0, dependencies.deepClone)(context.container.geometry),
    });
    const started = enterTerritorialUnitSplitMode(source, { virtual: !context.source });
    if (started) {
      dependencies.state.territorialUnitSplitCreateContext = {
        ...context,
        source: (0, dependencies.deepClone)(source),
        workingGeometry: (0, dependencies.deepClone)(source.geometry),
        name: null,
      };
      dependencies.state.multiDraft = { kind: 'territorial-split-create', shape: 'polygon', parts: [], current: null, name: null };
    }
    return started;
  }

  function closeTerritorialCreateModal() {
    (0, dependencies.$)('territorialCreateModal').classList.add('hidden');
    pendingTerritorialCreateType = null;
  }

  function openTerritorialCreateModal(unitType) {
    const context = territorialCreateContext(unitType);
    if (!context) {
      (0, dependencies.setActionStatus)(unitType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT
        ? '하위단위의 부모로 사용할 국가 또는 하위단위를 먼저 선택하세요.'
        : '하위단위를 만들 국가를 먼저 선택하세요.', 'error', 3900);
      return false;
    }
    const subunits = unitType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT;
    const region = unitType === dependencies.TERRITORIAL_UNIT_TYPES.REGION;
    pendingTerritorialCreateType = unitType;
    (0, dependencies.$)('territorialCreateTitle').textContent = `${(0, dependencies.territorialTypeLabel)(unitType)} 추가`;
    (0, dependencies.$)('territorialCreateContext').textContent = region
      ? context.parentId
        ? `상위 소속 기본값: ${(0, dependencies.territorialUnitName)(context.container)}`
        : context.sovereignId
          ? `주권 국가 기본값: ${(0, dependencies.countryName)(context.container)}`
          : '주권 국가와 상위 소속은 생성 후 설정할 수 있습니다.'
      : subunits
        ? `부모: ${(0, dependencies.territorialUnitName)(context.container) || (0, dependencies.countryName)(context.container)} · 자동 ${context.adminLevel}급`
        : `소속 국가: ${(0, dependencies.countryName)(context.container)}`;
    (0, dependencies.replaceSelectOptions)((0, dependencies.$)('territorialCreateMethod'), region
      ? [{ value: 'draw', label: '영역 직접 지정' }, { value: 'geojson', label: 'GeoJSON에서 가져오기' }]
      : [{ value: 'split', label: '기존 영역 나누기' }, { value: 'draw', label: '영역 직접 지정' }, { value: 'geojson', label: 'GeoJSON에서 가져오기' }], region ? 'draw' : 'split');
    (0, dependencies.$)('territorialCreateModal').classList.remove('hidden');
    (0, dependencies.$)('territorialCreateMethod').focus();
    return true;
  }

  function enterTerritorialUnitDirectCreate(unitType) {
    const context = territorialCreateContext(unitType);
    if (!context) return false;
    dependencies.editingDomain?.setTool('draw-territorial-unit', { announce: false });
    dependencies.state.territorialCreateContext = {
      unitType,
      sovereignId: context.sovereignId,
      parentId: context.parentId,
      adminLevel: context.adminLevel,
    };
    dependencies.state.multiDraft = { kind: 'territorial-direct', shape: 'polygon', parts: [], current: null, name: null };
    (0, dependencies.setModeBanner)((0, dependencies.defaultDraftInstruction)());
    (0, dependencies.updateModeButtons)();
    return true;
  }

  function finishTerritorialUnitSplitDraft() {
    if (dependencies.state.territorialUnitSplitCreateContext) return finishTerritorialUnitCreateSplitDraft();
    const source = (0, dependencies.territorialUnitById)(dependencies.state.territorialUnitSplitSourceId) || dependencies.state.territorialUnitSplitVirtualSource;
    if (!source?.geometry) {
      (0, dependencies.setActionStatus)('나눌 하위단위를 찾을 수 없습니다. 하위단위를 다시 선택하세요.', 'error', 3400);
      return;
    }
    try {
      const split = (0, dependencies.buildCutSplitCandidates)(source.geometry, (0, dependencies.editingDraftCoordinates)());
      const untouched = (0, dependencies.geometryPolygonSets)(source.geometry)
        .filter((_, index) => index !== split.componentIndex)
        .map(polygon => (0, dependencies.deepClone)(polygon));
      const smallerIndex = split.candidates[0].area <= split.candidates[1].area ? 0 : 1;
      const otherIndex = smallerIndex === 0 ? 1 : 0;
      const wasRemainder = source.properties?.isRemainder === true;
      const typeLabel = (0, dependencies.territorialTypeLabel)(source.properties?.unitType);
      const baseName = (0, dependencies.territorialUnitName)(source).replace(/^미지정\s*/, '') || typeLabel;
      const newName = prompt(`새 ${typeLabel} 이름을 입력하세요.`, `새 ${typeLabel}`);
      if (newName === null) return;
      let retainedName = source.properties?.name || '';
      if (!wasRemainder) {
        const entered = prompt(`기존 쪽 ${typeLabel} 이름을 입력하세요.`, `${baseName} 1`);
        if (entered === null) return;
        retainedName = entered.trim() || `${baseName} 1`;
      }
      const retainedCoordinates = wasRemainder
        ? [...(0, dependencies.geometryMultiCoordinates)(split.candidates[otherIndex].geometry), ...untouched]
        : [...(0, dependencies.geometryMultiCoordinates)(split.candidates[0].geometry), ...untouched];
      const retainedGeometry = (0, dependencies.normalizeClippedLandGeometry)(retainedCoordinates);
      const siblingGeometry = (0, dependencies.deepClone)(split.candidates[wasRemainder ? smallerIndex : 1].geometry);
      if (!retainedGeometry || !siblingGeometry) throw new Error('나누지 않은 섬과 월경지를 보존할 수 없습니다.');
      const retainedAfter = (0, dependencies.deepClone)(source);
      retainedAfter.geometry = retainedGeometry;
      retainedAfter.properties.name = retainedName;
      retainedAfter.properties.isRemainder = wasRemainder;
      const sibling = (0, dependencies.createPartitionTerritorialFeature)({
        id: (0, dependencies.uid)('subunit'),
        unitType: source.properties.unitType,
        sovereignId: source.properties.sovereignId,
        parentId: source.properties.parentId,
        adminLevel: source.properties.adminLevel,
        isRemainder: false,
        name: newName.trim() || `새 ${typeLabel}`,
        color: (0, dependencies.territorialStyleColor)(source),
        notes: '',
        sourceFolderId: source.properties.sourceFolderId || '',
        metadata: (0, dependencies.deepClone)(source.properties.metadata || {}),
        geometry: siblingGeometry,
      });
      (0, dependencies.beginLocalGeometryPreview)({
        operation: 'split-territorial-unit',
        beforeFeatures: [source],
        afterFeatures: [retainedAfter, sibling],
        applyResult: () => {
          dependencies.projectDomain.recordHistory();
          const retained = dependencies.state.territorialUnitSplitSourceId ? (0, dependencies.territorialUnitById)(dependencies.state.territorialUnitSplitSourceId) : null;
          if (retained) {
            retained.geometry = (0, dependencies.deepClone)(retainedAfter.geometry);
            retained.properties = (0, dependencies.deepClone)(retainedAfter.properties);
          } else dependencies.state.territorialUnits.push((0, dependencies.deepClone)(retainedAfter));
          dependencies.state.territorialUnits.push((0, dependencies.deepClone)(sibling));
          dependencies.state.territorialUnits = (0, dependencies.normalizeTerritorialUnits)(dependencies.state.territorialUnits, { countryExists: id => !!(0, dependencies.countryFeatureById)(id) });
          dependencies.editingDomain?.clearDraft?.(true);
          dependencies.editingDomain?.setTool('select', { announce: false });
          (0, dependencies.markLayerTreeDirty)();
          (0, dependencies.applyTerritorialUnitSelectionIntent)(sibling.id, true);
        },
        successMessage: `${typeLabel}을(를) 나누고 나머지 면적을 ${wasRemainder ? '미지정 영역으로 ' : ''}보존했습니다.`,
        errorMessage: '영역 나누기 결과를 적용하지 못했습니다.',
      });
    } catch (error) {
      (0, dependencies.reportOperationError)(error, '영역을 나누지 못했습니다. 한 영역을 정확히 한 번 관통하도록 경계를 다시 그리세요.', 'PL-REGION-SPLIT-001', 4400);
    }
  }

  function finishTerritorialUnitCreateSplitDraft() {
    const context = dependencies.state.territorialUnitSplitCreateContext;
    const session = dependencies.state.multiDraft;
    const source = context?.source;
    if (!context || session?.kind !== 'territorial-split-create' || !context.workingGeometry || !source?.geometry) return false;
    try {
      const split = (0, dependencies.buildCutSplitCandidates)(context.workingGeometry, (0, dependencies.editingDraftCoordinates)());
      const smallerIndex = split.candidates[0].area <= split.candidates[1].area ? 0 : 1;
      const geometry = split.candidates[smallerIndex]?.geometry;
      if (!geometry) throw new Error('나눌 영역을 찾을 수 없습니다.');
      const typeLabel = (0, dependencies.territorialTypeLabel)(context.unitType);
      if (session.name === null) {
        const name = prompt(`새 ${typeLabel} 이름을 입력하세요.`, `새 ${typeLabel}`);
        if (name === null) return false;
        session.name = name.trim() || `새 ${typeLabel}`;
      }
      session.current = { geometry };
      (0, dependencies.scheduleMultiDraftPreview)();
      dependencies.editingDomain?.clearDraft?.({ reason: 'territorial-create-split-part-finished', render: false });
      (0, dependencies.setModeBanner)('나눌 영역을 확인하세요.');
      dependencies.renderingDomain?.invalidateEditingOverlays?.('territorial-create-split-part-finished');
      (0, dependencies.updateModeButtons)();
      return true;
    } catch (error) {
      (0, dependencies.reportOperationError)(error, '영역을 나누지 못했습니다. 한 영역을 정확히 한 번 관통하도록 경계를 다시 그리세요.', 'PL-REGION-SPLIT-001', 4400);
      return false;
    }
  }

  function territorialUnitsAreAdjacent(left, right) {
    return dependencies.territorialGeometry.areAdjacent(left, right);
  }

  function enterTerritorialUnitMergeMode(id) {
    const source = (0, dependencies.territorialUnitById)(id);
    if (!source) return false;
    dependencies.editingDomain?.setTool('merge-territorial-unit', { announce: false });
    dependencies.state.territorialUnitMergeSourceId = String(source.id);
    dependencies.state.territorialUnitMergeTargetIds = [];
    (0, dependencies.setModeBanner)('합칠 인접 영역을 선택하세요.');
    (0, dependencies.updateModeButtons)();
    dependencies.renderingDomain?.renderTerritorialUnits?.();
    return true;
  }

  function toggleTerritorialUnitMergeTarget(id) {
    if (dependencies.state.tool !== 'merge-territorial-unit') return;
    const source = (0, dependencies.territorialUnitById)(dependencies.state.territorialUnitMergeSourceId);
    const target = (0, dependencies.territorialUnitById)(id);
    if (!source || !target || String(source.id) === String(target.id)) return;
    if (!(0, dependencies.territorialSiblings)(dependencies.state.territorialUnits, source).some(candidate => String(candidate.id) === String(target.id))) {
      (0, dependencies.setActionStatus)('같은 국가·부모·단계의 영역만 합칠 수 있습니다.', 'error', 3400);
      return;
    }
    if (!territorialUnitsAreAdjacent(source, target)) {
      (0, dependencies.setActionStatus)('경계를 공유하는 인접 영역만 합칠 수 있습니다.', 'error', 3400);
      return;
    }
    const targets = new Set(dependencies.state.territorialUnitMergeTargetIds.map(String));
    if (targets.has(String(id))) targets.delete(String(id)); else targets.add(String(id));
    dependencies.state.territorialUnitMergeTargetIds = [...targets];
    dependencies.renderingDomain?.renderTerritorialUnits?.();
    (0, dependencies.updateModeButtons)();
  }

  function completeTerritorialUnitMerge() {
    const source = (0, dependencies.territorialUnitById)(dependencies.state.territorialUnitMergeSourceId);
    const targets = dependencies.state.territorialUnitMergeTargetIds.map(dependencies.territorialUnitById).filter(Boolean);
    if (!source || !targets.length) return;
    try {
      const mergeResult = dependencies.territorialGeometry.mergeUnits(source, targets);
      const removed = new Set(mergeResult.removedIds);
      const sourceAfter = (0, dependencies.deepClone)(source);
      sourceAfter.geometry = (0, dependencies.deepClone)(mergeResult.survivor.geometry);
      (0, dependencies.beginLocalGeometryPreview)({
        operation: 'merge-territorial-unit',
        beforeFeatures: [source, ...targets],
        afterFeatures: [sourceAfter],
        removedIds: [...removed],
        applyResult: () => {
          dependencies.projectDomain.recordHistory();
          source.geometry = (0, dependencies.deepClone)(sourceAfter.geometry);
          for (const child of dependencies.state.territorialUnits) {
            if (removed.has(String(child.properties?.parentId || ''))) child.properties.parentId = String(source.id);
          }
          dependencies.state.territorialUnits = dependencies.state.territorialUnits.filter(item => !removed.has(String(item.id)));
          dependencies.state.territorialUnits = (0, dependencies.normalizeTerritorialUnits)(dependencies.state.territorialUnits, { countryExists: id => !!(0, dependencies.countryFeatureById)(id) });
          dependencies.editingDomain?.setTool('select', { announce: false });
          (0, dependencies.markLayerTreeDirty)();
          (0, dependencies.applyTerritorialUnitSelectionIntent)(source.id, true);
        },
        successMessage: `${targets.length + 1}개 ${(0, dependencies.territorialTypeLabel)(source.properties.unitType)}을 하나로 합쳤습니다.`,
        errorMessage: '영역 합치기 결과를 적용하지 못했습니다.',
      });
    } catch (error) {
      (0, dependencies.reportOperationError)(error, '영역을 합치지 못했습니다.', 'PL-REGION-MERGE-001', 4200);
    }
  }

  function enterTerritorialUnitRedrawMode(id) {
    const source = (0, dependencies.territorialUnitById)(id);
    if (!source) return false;
    dependencies.editingDomain?.setTool('redraw-territorial-unit', { announce: false });
    dependencies.state.territorialUnitRedrawSourceId = String(source.id);
    (0, dependencies.setModeBanner)((0, dependencies.defaultDraftInstruction)());
    (0, dependencies.updateModeButtons)();
    return true;
  }

  async function finishTerritorialUnitRedrawDraft() {
    const source = (0, dependencies.territorialUnitById)(dependencies.state.territorialUnitRedrawSourceId);
    const container = (0, dependencies.territorialUnitContainer)(source);
    const clipper = window.polygonClipping;
    if (!source || !container || !clipper?.intersection || !clipper?.difference) return;
    try {
      const drawn = { type: 'Polygon', coordinates: [(0, dependencies.orientRing)((0, dependencies.editingDraftCoordinates)(), true)] };
      let nextGeometry = (0, dependencies.normalizeClippedLandGeometry)(clipper.intersection(drawn.coordinates, container.geometry.coordinates));
      if (!nextGeometry) throw new Error('그린 영역이 부모 영역 안에 없습니다.');
      const siblings = (0, dependencies.territorialSiblings)(dependencies.state.territorialUnits, source);
      for (const sibling of siblings) {
        if (sibling.properties?.isRemainder === true) continue;
        const overlap = clipper.intersection(nextGeometry.coordinates, sibling.geometry.coordinates);
        if ((0, dependencies.multiPolygonPlanarArea)(overlap) > Math.max(1e-9, (0, dependencies.multiPolygonPlanarArea)(nextGeometry.coordinates) * 1e-9)) {
          throw new Error(`${(0, dependencies.territorialUnitName)(sibling)}과(와) 겹칩니다. 이름 있는 형제 영역은 침범할 수 없습니다.`);
        }
      }
      let released = (0, dependencies.normalizeClippedLandGeometry)(clipper.difference(source.geometry.coordinates, nextGeometry.coordinates));
      const sourceAfter = (0, dependencies.deepClone)(source);
      sourceAfter.geometry = (0, dependencies.deepClone)(nextGeometry);
      const coastGeometryOverrides = new Map();
      let coastDirection = 'none';
      if (source.properties?.unitType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT) {
        const rawSourceAfter = (0, dependencies.deepClone)(sourceAfter);
        rawSourceAfter.geometry = (0, dependencies.deepClone)(drawn);
        const country = (0, dependencies.countryFeatureById)(source.properties?.sovereignId);
        const resolution = await (await (0, dependencies.getGisImportCommitter)()).resolveTerritorialCoast(rawSourceAfter, country, coastGeometryOverrides);
        if (resolution.direction === 'cancel') {
          (0, dependencies.setActionStatus)('해안선 정합을 취소했습니다.', 'ready');
          return;
        }
        coastDirection = resolution.direction;
        if (coastDirection === 'country-to-admin') {
          nextGeometry = (0, dependencies.normalizeClippedLandGeometry)(clipper.intersection(rawSourceAfter.geometry.coordinates, container.geometry.coordinates));
          if (!nextGeometry) throw new Error('국가 해안선을 기준으로 조정한 영역이 부모 영역 안에 없습니다.');
          sourceAfter.geometry = (0, dependencies.deepClone)(nextGeometry);
        } else if (coastDirection === 'admin-to-country' || coastDirection === 'independent') {
          nextGeometry = (0, dependencies.deepClone)(rawSourceAfter.geometry);
          sourceAfter.geometry = (0, dependencies.deepClone)(nextGeometry);
        }
        released = (0, dependencies.normalizeClippedLandGeometry)(clipper.difference(source.geometry.coordinates, nextGeometry.coordinates));
      }
      for (const sibling of siblings) {
        if (sibling.properties?.isRemainder === true) continue;
        const overlap = clipper.intersection(nextGeometry.coordinates, sibling.geometry.coordinates);
        if ((0, dependencies.multiPolygonPlanarArea)(overlap) > Math.max(1e-9, (0, dependencies.multiPolygonPlanarArea)(nextGeometry.coordinates) * 1e-9)) {
          throw new Error(`${(0, dependencies.territorialUnitName)(sibling)}과(와) 겹칩니다. 이름 있는 형제 영역은 침범할 수 없습니다.`);
        }
      }
      (0, dependencies.beginLocalGeometryPreview)({
        operation: 'redraw-territorial-unit',
        beforeFeatures: [source],
        afterFeatures: [sourceAfter],
        applyResult: async () => {
          dependencies.projectDomain.recordHistory();
          for (const [countryId, geometry] of coastGeometryOverrides) {
            const country = (0, dependencies.countryFeatureById)(countryId);
            if (!country) continue;
            country.geometry = (0, dependencies.deepClone)(geometry);
            dependencies.state.historyDirtyCountryIds.add(countryId);
          }
          source.geometry = (0, dependencies.deepClone)(nextGeometry);
          for (const sibling of siblings.filter(item => item.properties?.isRemainder === true)) {
            const remainder = (0, dependencies.normalizeClippedLandGeometry)(clipper.difference(sibling.geometry.coordinates, nextGeometry.coordinates));
            if (remainder) sibling.geometry = remainder;
            else dependencies.state.territorialUnits = dependencies.state.territorialUnits.filter(item => String(item.id) !== String(sibling.id));
          }
          if (released && source.properties?.isRemainder !== true) (0, dependencies.addUnassignedTerritorialUnitGeometry)({
            unitType: source.properties.unitType,
            sovereignId: source.properties.sovereignId,
            parentId: source.properties.parentId,
            adminLevel: source.properties.adminLevel,
          }, released);
          (0, dependencies.reconcileTerritorialUnitCompleteness)([source.properties.sovereignId], {
            preserveIds: coastDirection === 'admin-to-country' || coastDirection === 'independent' ? [String(source.id)] : [],
          });
          dependencies.editingDomain?.clearDraft?.(true);
          dependencies.editingDomain?.setTool('select', { announce: false });
          (0, dependencies.markLayerTreeDirty)();
          (0, dependencies.applyTerritorialUnitSelectionIntent)(source.id, true);
        },
        successMessage: '영역을 다시 지정하고 남는 면적을 미지정 영역으로 보존했습니다.',
        errorMessage: '영역 다시 지정 결과를 적용하지 못했습니다.',
      });
    } catch (error) {
      (0, dependencies.reportOperationError)(error, '영역을 다시 지정하지 못했습니다.', 'PL-REGION-REDRAW-001', 4300);
    }
  }

  function finishTerritorialUnitDirectDraft() {
    const context = dependencies.state.territorialCreateContext;
    if (!context) return;
    const typeLabel = (0, dependencies.territorialTypeLabel)(context.unitType);
    const geometry = (0, dependencies.normalizeCountryGeometry)({ type: 'Polygon', coordinates: [(0, dependencies.orientRing)((0, dependencies.editingDraftCoordinates)(), true)] });
    try {
      if (!geometry) throw new Error('그린 영역을 닫힌 Polygon으로 만들 수 없습니다.');
      const issues = (0, dependencies.validateStructuredGeometry)({ type: 'Feature', id: 'draft', properties: {}, geometry });
      if (issues.length) throw new Error(issues[0].message);
      const session = dependencies.state.multiDraft;
      if (!session || session.kind !== 'territorial-direct') throw new Error('영역 생성 작업을 다시 시작하세요.');
      if (session.name === null) {
        const name = prompt(`새 ${typeLabel} 이름을 입력하세요.`, `새 ${typeLabel}`);
        if (name === null) return false;
        session.name = name.trim() || `새 ${typeLabel}`;
      }
      session.current = { geometry };
      (0, dependencies.scheduleMultiDraftPreview)();
      dependencies.editingDomain?.clearDraft?.({ reason: 'territorial-direct-part-finished', render: false });
      (0, dependencies.setModeBanner)('그린 영역을 확인하세요.');
      dependencies.renderingDomain?.invalidateEditingOverlays?.('territorial-direct-part-finished');
      (0, dependencies.updateModeButtons)();
      return true;
    } catch (error) {
      (0, dependencies.reportOperationError)(error, `${typeLabel}을 직접 지정하지 못했습니다.`, 'PL-REGION-DRAW-001', 4400);
      return false;
    }
  }

  function startNextTerritorialMultiDraftPart() {
    dependencies.editingDomain?.startDraft?.({ coords: [] });
    (0, dependencies.setModeBanner)((0, dependencies.defaultDraftInstruction)());
    dependencies.renderingDomain?.invalidateEditingOverlays?.('territorial-multi-draft-next-part');
    (0, dependencies.updateModeButtons)();
  }

  function addTerritorialMultiDraftPart() {
    const session = dependencies.state.multiDraft;
    if (!session?.current || !['territorial-direct', 'territorial-split-create'].includes(session.kind)) return false;
    (0, dependencies.cancelScheduledMultiDraftPreview)();
    if (session.kind === 'territorial-split-create') {
      const context = dependencies.state.territorialUnitSplitCreateContext;
      try {
        const remaining = (0, dependencies.normalizeClippedLandGeometry)(window.polygonClipping.difference(
          (0, dependencies.geometryMultiCoordinates)(context.workingGeometry),
          (0, dependencies.geometryMultiCoordinates)(session.current.geometry),
        ));
        if (!remaining) throw new Error('선택하지 않은 영역을 보존할 수 없습니다.');
        session.parts.push({ geometry: session.current.geometry, sourceGeometry: context.workingGeometry });
        session.current = null;
        context.workingGeometry = remaining;
      } catch (error) {
        (0, dependencies.reportOperationError)(error, '선택한 영역을 보관하지 못했습니다.', 'PL-MULTI-TERRITORY-001', 3800);
        return false;
      }
    } else {
      session.parts.push(session.current);
      session.current = null;
    }
    (0, dependencies.scheduleMultiDraftPreview)();
    startNextTerritorialMultiDraftPart();
    return true;
  }

  function undoTerritorialMultiDraftPart() {
    const session = dependencies.state.multiDraft;
    if (!session || !['territorial-direct', 'territorial-split-create'].includes(session.kind)) return false;
    (0, dependencies.cancelScheduledMultiDraftPreview)();
    if (session.current) {
      session.current = null;
      session.previewGeometry = null;
      session.previewIssues = [];
      startNextTerritorialMultiDraftPart();
      return true;
    }
    const last = session.parts.pop();
    if (!last) return false;
    if (session.kind === 'territorial-split-create') dependencies.state.territorialUnitSplitCreateContext.workingGeometry = last.sourceGeometry;
    (0, dependencies.scheduleMultiDraftPreview)();
    startNextTerritorialMultiDraftPart();
    return true;
  }

  function multiTerritorialGeometry(session) {
    const pieces = [...session.parts, ...(session.current ? [session.current] : [])].map(item => item.geometry);
    if (!pieces.length) return null;
    return (0, dependencies.normalizeClippedLandGeometry)(pieces.flatMap(geometry => (0, dependencies.geometryMultiCoordinates)(geometry)));
  }

  async function completeTerritorialMultiDraft() {
    const session = dependencies.state.multiDraft;
    if (!session || !['territorial-direct', 'territorial-split-create'].includes(session.kind)
      || dependencies.editingDomain?.draftInputActive?.() || session.previewPending || session.previewIssues?.length) return false;
    const geometry = session.previewGeometry || multiTerritorialGeometry(session);
    if (!geometry) return false;
    if (session.kind === 'territorial-split-create') return completeTerritorialSplitCreate(session, geometry);
    const context = dependencies.state.territorialCreateContext;
    if (!context) return false;
    const typeLabel = (0, dependencies.territorialTypeLabel)(context.unitType);
    const rawFeature = {
      type: 'Feature', id: (0, dependencies.uid)(`${context.unitType}-preview`),
      properties: { name: session.name || `새 ${typeLabel}`, sovereignId: context.sovereignId, parentId: context.parentId, adminLevel: context.adminLevel },
      geometry,
    };
    try {
      if ((0, dependencies.validateStructuredGeometry)(rawFeature).length) throw new Error('그린 영역 형식이 올바르지 않습니다.');
      let createdId = '';
      if (context.unitType === dependencies.TERRITORIAL_UNIT_TYPES.REGION) {
        const region = (0, dependencies.createTerritorialFeature)({
          id: (0, dependencies.uid)('region'), unitType: dependencies.TERRITORIAL_UNIT_TYPES.REGION,
          name: rawFeature.properties.name, parentId: context.parentId, sovereignId: context.sovereignId,
          coverageMode: dependencies.TERRITORIAL_COVERAGE_MODES.EXPLICIT, isRemainder: false, geometry: (0, dependencies.deepClone)(geometry),
        });
        dependencies.projectDomain.recordHistory({ type: 'territorial-create', affectedIds: [String(region.id)] });
        dependencies.state.territorialUnits.push(region);
        dependencies.state.territorialUnits = (0, dependencies.normalizeTerritorialUnits)(dependencies.state.territorialUnits, { countryExists: id => !!(0, dependencies.countryFeatureById)(id) });
        dependencies.state.layerVisibility.regions = true;
        delete dependencies.state.itemVisibility.regions?.[String(region.id)];
        (0, dependencies.markLayerTreeDirty)();
        dependencies.projectDomain.queueAutosave();
        createdId = region.id;
      } else {
        const createdIds = await (await (0, dependencies.getGisImportCommitter)()).importGeoJsonTerritorialUnits([rawFeature], context.unitType, {
          nameField: 'name', countryField: 'sovereignId', parentField: 'parentId', levelField: 'adminLevel',
        });
        createdId = createdIds[0] || '';
      }
      dependencies.state.multiDraft = null;
      dependencies.editingDomain?.clearDraft?.(true);
      dependencies.editingDomain?.setTool('select', { announce: false });
      if (createdId) (0, dependencies.applyTerritorialUnitSelectionIntent)(createdId, true);
      (0, dependencies.setActionStatus)(`${typeLabel}을 직접 지정했습니다.`, 'success');
      return true;
    } catch (error) {
      (0, dependencies.reportOperationError)(error, `${typeLabel}을 직접 지정하지 못했습니다.`, 'PL-REGION-DRAW-001', 4400);
      return false;
    }
  }

  function completeTerritorialSplitCreate(session, geometry) {
    const context = dependencies.state.territorialUnitSplitCreateContext;
    const source = context?.source;
    if (!context || !source) return false;
    try {
      const remaining = (0, dependencies.normalizeClippedLandGeometry)(window.polygonClipping.difference(
        (0, dependencies.geometryMultiCoordinates)(source.geometry), (0, dependencies.geometryMultiCoordinates)(geometry),
      ));
      if (!remaining) throw new Error('원본 영역 전체를 새 하위단위로 옮길 수 없습니다.');
      const sibling = (0, dependencies.createPartitionTerritorialFeature)({
        id: (0, dependencies.uid)('subunit'), unitType: context.unitType, sovereignId: context.sovereignId,
        parentId: context.parentId, adminLevel: context.adminLevel, isRemainder: false,
        name: session.name || `새 ${(0, dependencies.territorialTypeLabel)(context.unitType)}`,
        color: (0, dependencies.territorialStyleColor)(source), notes: '', geometry,
      });
      dependencies.projectDomain.recordHistory({ type: 'territorial-create-split', affectedIds: [String(source.id), String(sibling.id)] });
      const existing = dependencies.state.territorialUnitSplitSourceId ? (0, dependencies.territorialUnitById)(dependencies.state.territorialUnitSplitSourceId) : null;
      if (existing) existing.geometry = (0, dependencies.deepClone)(remaining);
      else dependencies.state.territorialUnits.push((0, dependencies.createPartitionTerritorialFeature)({
        id: source.id, unitType: context.unitType, sovereignId: context.sovereignId, parentId: context.parentId,
        adminLevel: context.adminLevel, isRemainder: true, geometry: remaining,
      }));
      dependencies.state.territorialUnits.push(sibling);
      dependencies.state.territorialUnits = (0, dependencies.normalizeTerritorialUnits)(dependencies.state.territorialUnits, { countryExists: id => !!(0, dependencies.countryFeatureById)(id) });
      dependencies.state.multiDraft = null;
      dependencies.editingDomain?.clearDraft?.(true);
      dependencies.editingDomain?.setTool('select', { announce: false });
      (0, dependencies.markLayerTreeDirty)();
      dependencies.projectDomain.queueAutosave();
      (0, dependencies.applyTerritorialUnitSelectionIntent)(sibling.id, true);
      (0, dependencies.setActionStatus)(`${(0, dependencies.territorialTypeLabel)(context.unitType)}을 만들었습니다.`, 'success');
      return true;
    } catch (error) {
      (0, dependencies.reportOperationError)(error, '영역을 만들지 못했습니다. 선택한 조각을 확인하세요.', 'PL-MULTI-TERRITORY-002', 4200);
      return false;
    }
  }

  function initializePendingTerritorialCreateType() {
    (pendingTerritorialCreateType = null);
  }

  return Object.freeze({
    connect,
    initializePendingTerritorialCreateType,
    get closeTerritorialCreateModal() { return closeTerritorialCreateModal; },
    get addTerritorialMultiDraftPart() { return addTerritorialMultiDraftPart; },
    get completeTerritorialMultiDraft() { return completeTerritorialMultiDraft; },
    get completeTerritorialUnitMerge() { return completeTerritorialUnitMerge; },
    get enterTerritorialUnitDirectCreate() { return enterTerritorialUnitDirectCreate; },
    get enterTerritorialUnitMergeMode() { return enterTerritorialUnitMergeMode; },
    get enterTerritorialUnitRedrawMode() { return enterTerritorialUnitRedrawMode; },
    get enterTerritorialUnitSplitMode() { return enterTerritorialUnitSplitMode; },
    get finishTerritorialUnitDirectDraft() { return finishTerritorialUnitDirectDraft; },
    get finishTerritorialUnitRedrawDraft() { return finishTerritorialUnitRedrawDraft; },
    get finishTerritorialUnitSplitDraft() { return finishTerritorialUnitSplitDraft; },
    get openTerritorialCreateModal() { return openTerritorialCreateModal; },
    get pendingTerritorialCreateType() { return pendingTerritorialCreateType; },
    get startTerritorialUnitCreate() { return startTerritorialUnitCreate; },
    get territorialUnitsAreAdjacent() { return territorialUnitsAreAdjacent; },
    get toggleTerritorialUnitMergeTarget() { return toggleTerritorialUnitMergeTarget; },
    get undoTerritorialMultiDraftPart() { return undoTerritorialMultiDraftPart; },
  });
}
