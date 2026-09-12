/** TerritorialDrafts: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createTerritorialDrafts() {
  let dependencies;
  function connect(ports) {
    if (dependencies) throw new Error('territorial-drafts already connected');
    dependencies = ports;
  }

  const text = value => String(value || '');

  function selectedTerritorialCreateDefaults(unitType) {
    const selected = dependencies.state.selected?.domain === 'territorial' ? dependencies.state.selected : null;
    const selectedCountry = selected?.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY
      ? (0, dependencies.countryFeatureById)(selected.id) : null;
    const selectedUnit = selected && selected.type !== dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY
      ? (0, dependencies.territorialUnitById)(selected.id) : null;
    const sovereignId = unitType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT
      ? text(selectedUnit?.properties?.sovereignId || selectedCountry?.id) : '';
    const parentId = unitType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT
      ? text(selectedUnit?.properties?.unitType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT ? selectedUnit.id : selectedCountry?.id) : '';
    return { sovereignId, parentId };
  }

  function parentFeatureForSession(session) {
    if (!session || session.kind !== dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT) return null;
    return (0, dependencies.territorialUnitById)(session.parentId) || (0, dependencies.countryFeatureById)(session.parentId);
  }

  function directSubunitChildren(session) {
    return dependencies.state.territorialUnits.filter(feature => feature.properties?.unitType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT
      && text(feature.properties?.sovereignId) === text(session.sovereignId)
      && text(feature.properties?.parentId) === text(session.parentId));
  }

  function unassignedSourceForSession(session) {
    const cacheKey = `${text(session.sovereignId)}:${text(session.parentId)}:${Number(dependencies.state.stateRevision || 0)}`;
    if (session.setupSourceCache?.key === cacheKey) return session.setupSourceCache.value;
    const parent = parentFeatureForSession(session);
    if (!parent?.geometry) return null;
    const children = directSubunitChildren(session);
    const remainder = children.find(feature => feature.properties?.isRemainder === true);
    if (remainder?.geometry) {
      const value = { feature: remainder, existingId: text(remainder.id), virtual: false };
      session.setupSourceCache = { key: cacheKey, value };
      return value;
    }
    const explicit = children.filter(feature => feature.properties?.isRemainder !== true && feature.geometry);
    let geometry = (0, dependencies.deepClone)(parent.geometry);
    if (explicit.length) {
      const clipper = window.polygonClipping;
      if (!clipper?.union || !clipper?.difference) return null;
      const occupied = clipper.union(...explicit.map(feature => (0, dependencies.geometryMultiCoordinates)(feature.geometry)));
      geometry = (0, dependencies.normalizeClippedLandGeometry)(clipper.difference(
        (0, dependencies.geometryMultiCoordinates)(parent.geometry), occupied,
      ));
    }
    if (!geometry) return null;
    const value = {
      feature: (0, dependencies.createPartitionTerritorialFeature)({
        id: `territory-selection-source:${session.id}`, unitType: dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT,
        sovereignId: session.sovereignId, parentId: session.parentId, adminLevel: null,
        isRemainder: true, geometry,
      }),
      existingId: '', virtual: true,
    };
    session.setupSourceCache = { key: cacheKey, value };
    return value;
  }

  function territorialCreateSourceChoices(session = dependencies.state.territorySelectionSession) {
    if (!session || session.kind !== dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT) return [];
    const choices = [{ value: '', label: '기준 영역 선택' }];
    if (unassignedSourceForSession(session)) choices.push({ value: 'unassigned', label: '미지정 영역' });
    for (const feature of directSubunitChildren(session).filter(item => item.properties?.isRemainder !== true
      && !dependencies.state.territorialUnits.some(child => text(child.properties?.parentId) === text(item.id)))) {
      choices.push({ value: text(feature.id), label: (0, dependencies.territorialUnitName)(feature) });
    }
    return choices;
  }

  function resolveTerritorialCreateSource(session = dependencies.state.territorySelectionSession) {
    if (!session || session.kind !== dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT) return null;
    if (session.sourceKey === 'unassigned') return unassignedSourceForSession(session);
    const feature = (0, dependencies.territorialUnitById)(session.sourceKey);
    if (!feature?.geometry || feature.properties?.unitType !== dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT
      || text(feature.properties?.sovereignId) !== text(session.sovereignId)
      || text(feature.properties?.parentId) !== text(session.parentId)) return null;
    return { feature, existingId: text(feature.id), virtual: false };
  }

  function territorialCreateSetupModel() {
    const session = dependencies.state.territorySelectionSession;
    if (!session) return null;
    const countryOptions = (0, dependencies.territorialUnitCountryOptions)().filter(option => option.value);
    const parentOptions = session.kind === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT && session.sovereignId
      ? (0, dependencies.subunitParentChoices)(session.sovereignId, dependencies.state.countriesData.features, dependencies.state.territorialUnits, {
        name: feature => feature.properties?.unitType ? (0, dependencies.territorialUnitName)(feature) : (0, dependencies.countryName)(feature),
      }) : [];
    const sourceOptions = territorialCreateSourceChoices(session);
    return { session, countryOptions, parentOptions, sourceOptions };
  }

  function territorialCreateSetupValid(session = dependencies.state.territorySelectionSession) {
    if (!session || !session.name.trim()) return false;
    if (session.kind === dependencies.TERRITORIAL_UNIT_TYPES.REGION) return true;
    const parentValid = (0, dependencies.subunitParentChoices)(
      session.sovereignId,
      dependencies.state.countriesData.features,
      dependencies.state.territorialUnits,
      { name: feature => feature.properties?.unitType ? (0, dependencies.territorialUnitName)(feature) : (0, dependencies.countryName)(feature) },
    ).some(option => text(option.value) === text(session.parentId));
    const source = resolveTerritorialCreateSource(session);
    return !!(session.sovereignId && parentValid && parentFeatureForSession(session) && source && source.feature?.properties?.locked !== true);
  }

  function enterTerritorialCreateWorkflow(unitType) {
    if (![dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT, dependencies.TERRITORIAL_UNIT_TYPES.REGION].includes(unitType)) return false;
    const defaults = selectedTerritorialCreateDefaults(unitType);
    const session = (0, dependencies.startTerritorySelection)(unitType, {
      tool: 'draw-territorial-unit',
      name: unitType === dependencies.TERRITORIAL_UNIT_TYPES.REGION ? '새 지방' : '새 하위단위',
      sovereignId: defaults.sovereignId, parentId: defaults.parentId, sourceKey: 'unassigned', sourceCountryIds: [],
    });
    if (!session) return false;
    territorialCreateSetupModel();
    (0, dependencies.setModeBanner)('');
    (0, dependencies.updateModeButtons)();
    requestAnimationFrame(() => (0, dependencies.$)('territorialCreateNameInput')?.select());
    return true;
  }

  function updateTerritorialCreateSovereign(value) {
    const session = dependencies.state.territorySelectionSession;
    if (!session || session.kind !== dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT) return;
    if (text(value) === text(session.sovereignId)) return;
    session.sovereignId = text(value);
    session.parentId = session.sovereignId;
    session.sourceKey = 'unassigned';
    session.setupSourceCache = null;
    session.settingsRevision += 1;
    (0, dependencies.resetTerritorySelection)(session, { keepRequestedMethod: false });
    territorialCreateSetupModel();
    (0, dependencies.updateModeButtons)();
  }

  function updateTerritorialCreateParent(value) {
    const session = dependencies.state.territorySelectionSession;
    if (!session || text(value) === text(session.parentId)) return;
    session.parentId = text(value);
    session.sourceKey = 'unassigned';
    session.setupSourceCache = null;
    session.settingsRevision += 1;
    (0, dependencies.resetTerritorySelection)(session, { keepRequestedMethod: false });
    territorialCreateSetupModel();
    (0, dependencies.updateModeButtons)();
  }

  function updateTerritorialCreateSource(value) {
    const session = dependencies.state.territorySelectionSession;
    if (!session || text(value) === text(session.sourceKey)) return;
    session.sourceKey = text(value);
    session.settingsRevision += 1;
    (0, dependencies.resetTerritorySelection)(session, { keepRequestedMethod: false });
    (0, dependencies.updateModeButtons)();
  }

  function createTerritorialSourceFeature(session) {
    if (session.kind === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT) return resolveTerritorialCreateSource(session);
    if (session.activeMethod === 'polygon') return null;
    const geometry = (0, dependencies.selectedCountryUnionGeometry)(session.sourceCountryIds);
    if (!geometry) return null;
    return {
      feature: { type: 'Feature', id: 'territorial-create-source', properties: { name: '기준 영역' }, geometry },
      existingId: '', virtual: true,
    };
  }

  function prepareTerritorialCreateSelection(session) {
    if (!session?.activeMethod || !['line', 'polygon', 'components'].includes(session.activeMethod)
      || (session.kind === dependencies.TERRITORIAL_UNIT_TYPES.REGION
        && session.activeMethod !== 'polygon' && !session.sourceCountryIds.length)) return false;
    const sourceInfo = createTerritorialSourceFeature(session);
    if (session.activeMethod !== 'polygon' && !sourceInfo?.feature?.geometry) return false;
    const context = {
      unitType: session.kind,
      sovereignId: session.kind === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT ? session.sovereignId : '',
      parentId: session.kind === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT ? session.parentId : '',
      adminLevel: session.kind === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT ? sourceInfo?.feature?.properties?.adminLevel ?? null : null,
    };
    const fingerprint = JSON.stringify([session.kind, session.sovereignId, session.parentId, session.sourceKey, [...session.sourceCountryIds].sort()]);
    if (session.sourceFingerprint === fingerprint && (session.baseSourceGeometry || session.activeMethod === 'polygon')) return true;
    session.sourceInfo = { context, source: null, existingId: '', virtual: false, sourceWasExisting: false, sourceIsRemainder: false };
    if (sourceInfo) {
      const source = (0, dependencies.deepClone)(sourceInfo.feature);
      session.sourceInfo = {
        context, source, existingId: sourceInfo.existingId || '', virtual: sourceInfo.virtual,
        sourceWasExisting: !!sourceInfo.existingId, sourceIsRemainder: source.properties?.isRemainder === true,
      };
    }
    session.baseSourceGeometry = sourceInfo ? (0, dependencies.deepClone)(sourceInfo.feature.geometry) : null;
    session.workingSourceGeometry = sourceInfo ? (0, dependencies.deepClone)(sourceInfo.feature.geometry) : null;
    session.remainingGeometry = session.workingSourceGeometry;
    session.sourceRevision += 1;
    session.sourceFingerprint = fingerprint;
    if (session.activeMethod === 'components') {
      session.componentFeatures = [(0, dependencies.deepClone)(sourceInfo.feature)];
    }
    return true;
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

  function finishTerritorialUnitSplitDraft() {
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
    const session = dependencies.state.territorySelectionSession;
    const source = session?.sourceInfo?.source;
    if (!['subunit', 'region'].includes(session?.kind) || !session.workingSourceGeometry || !source?.geometry) return false;
    try {
      const split = (0, dependencies.buildCutSplitCandidates)(session.workingSourceGeometry, (0, dependencies.editingDraftCoordinates)());
      const smallerIndex = split.candidates[0].area <= split.candidates[1].area ? 0 : 1;
      const geometry = split.candidates[smallerIndex]?.geometry;
      if (!geometry) throw new Error('나눌 영역을 찾을 수 없습니다.');
      (0, dependencies.setTerritorySelectionCandidates)(
        split.candidates.map(candidate => ({ geometry: (0, dependencies.deepClone)(candidate.geometry) })),
        smallerIndex,
      );
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
    const workflow = dependencies.state.territorySelectionSession;
    if (workflow?.stage === 'selection' && workflow.activePhase === 'drawing' && workflow.activeMethod === 'line') return finishTerritorialUnitCreateSplitDraft();
    const context = workflow?.sourceInfo?.context;
    if (!context) return;
    const typeLabel = (0, dependencies.territorialTypeLabel)(context.unitType);
    let geometry = (0, dependencies.normalizeCountryGeometry)({ type: 'Polygon', coordinates: [(0, dependencies.orientRing)((0, dependencies.editingDraftCoordinates)(), true)] });
    try {
      if (!geometry) throw new Error('그린 영역을 닫힌 Polygon으로 만들 수 없습니다.');
      const issues = (0, dependencies.validateStructuredGeometry)({ type: 'Feature', id: 'draft', properties: {}, geometry });
      if (issues.length) throw new Error(issues[0].message);
      const session = dependencies.state.territorySelectionSession;
      if (!session || !['subunit', 'region'].includes(session.kind)) throw new Error('영역 생성 작업을 다시 시작하세요.');
      if (session.workingSourceGeometry) {
        const working = session.workingSourceGeometry;
        geometry = working && (0, dependencies.normalizeClippedLandGeometry)(window.polygonClipping.intersection(
          (0, dependencies.geometryMultiCoordinates)(geometry), (0, dependencies.geometryMultiCoordinates)(working),
        ));
        if (!geometry) throw new Error('그린 영역이 기준 영역 안에 없습니다.');
      }
      (0, dependencies.setTerritorySelectionCandidates)([{ geometry }], 0);
      (0, dependencies.setModeBanner)('그린 영역을 확인하세요.');
      dependencies.renderingDomain?.invalidateEditingOverlays?.('territorial-direct-part-finished');
      (0, dependencies.updateModeButtons)();
      return true;
    } catch (error) {
      (0, dependencies.reportOperationError)(error, `${typeLabel}을 직접 지정하지 못했습니다.`, 'PL-REGION-DRAW-001', 4400);
      return false;
    }
  }

  function prepareTerritorialSelectionPreview(workflow, expectedKey) {
    if (!workflow || !['subunit', 'region'].includes(workflow.kind)) return false;
    const geometry = workflow.combinedGeometry;
    if (!geometry) return false;
    const context = workflow.sourceInfo?.context;
    if (!context) return false;
    const typeLabel = (0, dependencies.territorialTypeLabel)(context.unitType);
    const shouldKeepResult = () => (0, dependencies.territorySelectionPreviewIsCurrent)(workflow, expectedKey);
    if (workflow.kind === 'region') {
      const region = (0, dependencies.createTerritorialFeature)({
        id: workflow.generatedId,
        unitType: dependencies.TERRITORIAL_UNIT_TYPES.REGION,
        name: workflow.name.trim(),
        parentId: '', sovereignId: '',
        coverageMode: dependencies.TERRITORIAL_COVERAGE_MODES.EXPLICIT,
        isRemainder: false,
        geometry: (0, dependencies.deepClone)(geometry),
      });
      return (0, dependencies.beginLocalGeometryPreview)({
        operation: 'territorial-create',
        afterFeatures: [region],
        transferredGeometry: geometry,
        shouldKeepResult,
        commitHistorySnapshot: true,
        applyResult: () => {
          dependencies.state.territorialUnits.push((0, dependencies.deepClone)(region));
          dependencies.state.territorialUnits = (0, dependencies.normalizeTerritorialUnits)(dependencies.state.territorialUnits, {
            countryExists: id => !!(0, dependencies.countryFeatureById)(id),
          });
          dependencies.state.layerVisibility.regions = true;
          delete dependencies.state.itemVisibility.regions?.[String(region.id)];
          dependencies.editingDomain?.clearDraft?.({ reason: 'territorial-created', render: false });
          dependencies.editingDomain?.setTool('select', { announce: false });
          (0, dependencies.markLayerTreeDirty)();
          (0, dependencies.applyTerritorialUnitSelectionIntent)(region.id, true);
        },
        successMessage: `${typeLabel}을 만들었습니다.`,
        errorMessage: `${typeLabel}을 만들지 못했습니다.`,
      });
    }

    const splitContext = workflow.sourceInfo;
    const source = splitContext?.source;
    if (!source) return false;
    const remaining = (0, dependencies.normalizeClippedLandGeometry)(window.polygonClipping.difference(
      (0, dependencies.geometryMultiCoordinates)(source.geometry),
      (0, dependencies.geometryMultiCoordinates)(geometry),
    ));
    if (!remaining && source.properties?.isRemainder !== true) {
      (0, dependencies.setActionStatus)('기존 하위단위 전체를 새 하위단위로 옮길 수 없습니다.', 'error', 3800);
      return false;
    }
    const sibling = (0, dependencies.createPartitionTerritorialFeature)({
      id: workflow.generatedId,
      unitType: context.unitType,
      sovereignId: context.sovereignId,
      parentId: context.parentId,
      adminLevel: context.adminLevel,
      isRemainder: false,
      name: workflow.name.trim(),
      color: (0, dependencies.territorialStyleColor)(source),
      notes: '',
      geometry: (0, dependencies.deepClone)(geometry),
    });
    const retained = remaining ? {
      ...(0, dependencies.deepClone)(source),
      geometry: (0, dependencies.deepClone)(remaining),
    } : null;
    const existing = splitContext.sourceWasExisting ? (0, dependencies.territorialUnitById)(splitContext.existingId) : null;
    return (0, dependencies.beginLocalGeometryPreview)({
      operation: 'territorial-create-split',
      beforeFeatures: existing ? [existing] : [],
      afterFeatures: [retained, sibling].filter(Boolean),
      removedIds: existing && !retained ? [String(existing.id)] : [],
      transferredGeometry: geometry,
      shouldKeepResult,
      commitHistorySnapshot: true,
      applyResult: () => {
        if (existing && retained) {
          existing.geometry = (0, dependencies.deepClone)(retained.geometry);
          existing.properties = (0, dependencies.deepClone)(retained.properties);
        } else if (existing) {
          dependencies.state.territorialUnits = dependencies.state.territorialUnits.filter(item => text(item.id) !== text(existing.id));
        } else if (retained) {
          dependencies.state.territorialUnits.push((0, dependencies.createPartitionTerritorialFeature)({
            id: source.id,
            unitType: context.unitType,
            sovereignId: context.sovereignId,
            parentId: context.parentId,
            adminLevel: context.adminLevel,
            isRemainder: true,
            geometry: retained.geometry,
          }));
        }
        dependencies.state.territorialUnits.push((0, dependencies.deepClone)(sibling));
        dependencies.state.territorialUnits = (0, dependencies.normalizeTerritorialUnits)(dependencies.state.territorialUnits, {
          countryExists: id => !!(0, dependencies.countryFeatureById)(id),
        });
        (0, dependencies.reconcileTerritorialUnitCompleteness)([context.sovereignId], { preserveIds: [String(sibling.id)] });
        dependencies.editingDomain?.clearDraft?.({ reason: 'territorial-created', render: false });
        dependencies.editingDomain?.setTool('select', { announce: false });
        (0, dependencies.markLayerTreeDirty)();
        (0, dependencies.applyTerritorialUnitSelectionIntent)(sibling.id, true);
      },
      successMessage: `${typeLabel}을 만들었습니다.`,
      errorMessage: `${typeLabel}을 만들지 못했습니다.`,
    });
  }

  return Object.freeze({
    connect,
    get completeTerritorialUnitMerge() { return completeTerritorialUnitMerge; },
    get enterTerritorialCreateWorkflow() { return enterTerritorialCreateWorkflow; },
    get enterTerritorialUnitMergeMode() { return enterTerritorialUnitMergeMode; },
    get enterTerritorialUnitRedrawMode() { return enterTerritorialUnitRedrawMode; },
    get enterTerritorialUnitSplitMode() { return enterTerritorialUnitSplitMode; },
    get finishTerritorialUnitDirectDraft() { return finishTerritorialUnitDirectDraft; },
    get finishTerritorialUnitRedrawDraft() { return finishTerritorialUnitRedrawDraft; },
    get finishTerritorialUnitSplitDraft() { return finishTerritorialUnitSplitDraft; },
    get territorialUnitsAreAdjacent() { return territorialUnitsAreAdjacent; },
    get territorialCreateSetupModel() { return territorialCreateSetupModel; },
    get territorialCreateSetupValid() { return territorialCreateSetupValid; },
    get prepareTerritorialCreateSelection() { return prepareTerritorialCreateSelection; },
    get prepareTerritorialSelectionPreview() { return prepareTerritorialSelectionPreview; },
    get toggleTerritorialUnitMergeTarget() { return toggleTerritorialUnitMergeTarget; },
    get updateTerritorialCreateParent() { return updateTerritorialCreateParent; },
    get updateTerritorialCreateSource() { return updateTerritorialCreateSource; },
    get updateTerritorialCreateSovereign() { return updateTerritorialCreateSovereign; },
  });
}
