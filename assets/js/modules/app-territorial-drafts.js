/** TerritorialDrafts: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
import { resolveSelectChoice } from './select-option-policy.js';
import './territorial-edit-plan.js';

export function createTerritorialDrafts() {
  let dependencies;
  let editRequestRevision = 0;
  let coastAvailabilityRevision;
  const coastAvailability = new Map();
  function connect(ports) {
    if (dependencies) throw new Error('territorial-drafts already connected');
    dependencies = ports;
  }

  const text = value => String(value || '');

  async function refreshTerritorialCoastAvailability(feature) {
    const revision = dependencies.state.stateRevision;
    for (const buttonId of ['editSubunitCoastBtn', 'reconcileSubunitCoastBtn']) (0, dependencies.$)(buttonId).disabled = true;
    if (feature.properties?.locked) return;
    try {
      if (coastAvailabilityRevision !== revision) { coastAvailability.clear(); coastAvailabilityRevision = revision; }
      const key = text(feature.id);
      if (!coastAvailability.has(key)) coastAvailability.set(key,
        dependencies.mapEditClient.execute('territorial-coast-availability', { payload: {
          unit: (0, dependencies.deepClone)(feature), countries: (0, dependencies.deepClone)(dependencies.state.countriesData.features),
        } }).then(response => { dependencies.mapEditClient.discard(response.requestId); return response.result; })
          .catch(error => { coastAvailability.delete(key); throw error; }));
      const result = await coastAvailability.get(key);
      if (revision !== dependencies.state.stateRevision || text(dependencies.state.selected?.id) !== text(feature.id)) return;
      (0, dependencies.$)('editSubunitCoastBtn').disabled = !result.coastal;
      (0, dependencies.$)('reconcileSubunitCoastBtn').disabled = !result.reconciliation;
    } catch (_) {
      // Controls remain disabled until reliable coast data is available.
    }
  }

  async function previewTerritorialEdit(request, { selectedId, shouldKeepResult = () => true } = {}) {
    const requestRevision = ++editRequestRevision;
    const revision = dependencies.state.stateRevision;
    const entryTool = dependencies.state.tool;
    const entrySelection = text(dependencies.state.selected?.id);
    const snapshot = (0, dependencies.snapshotEditable)();
    const countries = (0, dependencies.deepClone)(dependencies.state.countriesData.features).map(country => ({
      ...country, properties: { ...country.properties, locked: country.properties?.locked === true || dependencies.state.countryOverrides?.[country.id]?.locked === true },
    }));
    const units = (0, dependencies.deepClone)(dependencies.state.territorialUnits);
    const current = () => requestRevision === editRequestRevision && dependencies.state.stateRevision === revision
      && dependencies.state.tool === entryTool && text(dependencies.state.selected?.id) === entrySelection && shouldKeepResult();
    try {
      (0, dependencies.setActionStatus)('영역 변경과 하위단위 영향을 계산하고 있습니다.', 'working', 0);
      const response = await dependencies.mapEditClient.execute('territorial-edit', { payload: { ...request, countries, units } });
      dependencies.mapEditClient.discard(response.requestId);
      if (!current()) return false;
      const result = response.result;
      const unresolved = result.impacts.find(impact => impact.kind === 'coast-owner');
      if (unresolved) {
        const owner = await new Promise(resolve => (0, dependencies.openConfirmModal)({
          title: '늘어난 육지의 소속 선택',
          message: '변경 구간이 여러 하위단위와 접합니다. 이 구간을 포함할 하위단위를 선택하세요.',
          choices: unresolved.candidates.map(candidate => ({ value: candidate.id, label: candidate.name })),
          confirmText: '소속 선택', onConfirm: resolve, onCancel: () => resolve(null),
        }));
        if (!owner || !current()) return false;
        return previewTerritorialEdit({ ...request, allocations: { ...request.allocations, [unresolved.key]: owner } }, { selectedId, shouldKeepResult });
      }
      const changed = new Map(result.features.map(feature => [text(feature.id), feature]));
      const countryIds = new Set(result.countryIds);
      const removed = new Set(result.removedIds.map(text));
      const replace = list => list.filter(feature => !removed.has(text(feature.id)))
        .map(feature => changed.get(text(feature.id)) || feature);
      const nextUnits = replace(units).filter(feature => !countryIds.has(text(feature.id))).concat(result.features.filter(feature => !units.some(unit => text(unit.id) === text(feature.id))
        && !countryIds.has(text(feature.id))));
      const nextCountries = replace(countries).concat(result.features.filter(feature => countryIds.has(text(feature.id)) && !countries.some(country => text(country.id) === text(feature.id))));
      const partial = result.impacts.filter(impact => ['clip-child', 'remove-child'].includes(impact.kind));
      return (0, dependencies.beginLocalGeometryPreview)({
        operation: `territorial-${request.operation}`,
        snapshot,
        beforeFeatures: [...countries, ...units].filter(feature => result.affectedIds.includes(text(feature.id))),
        afterFeatures: result.features,
        removedIds: result.removedIds,
        shouldKeepResult: current,
        commitHistorySnapshot: true,
        beforeApply: () => partial.length || result.ownershipChanges.length ? new Promise(resolve => {
          (0, dependencies.openConfirmModal)({
            title: '하위단위 영향 확인',
            message: '아래 소속 변경과 절단을 함께 반영합니다. 반영하지 않으면 경계를 다시 편집할 수 있습니다.',
            impacts: result.ownershipChanges.map(change => (units.find(unit => text(unit.id) === change.id)?.properties.name || change.id) + ': ' + (change.replacementId ? '합병 후 참조 이전' : '상위 단위 ' + change.to + (change.sovereignId ? ' · 소속 국가 ' + change.sovereignId : ''))).concat(partial.map(impact => `${impact.name}: ${impact.kind === 'remove-child' ? '객체와 참조 삭제' : '일부 영역 절단 · ' + (0, dependencies.sphericalGeometryAreaKm2)(impact.geometry).toFixed(3) + ' km²'}`)),
            confirmText: '반영', cancelText: '반영 안 함',
            onConfirm: () => resolve(true), onCancel: () => {
              if (dependencies.state.territorySelectionSession?.stage === 'review') (0, dependencies.backToTerritorialSelection)();
              else (0, dependencies.discardActiveGeometryPreview)({ announce: false });
              (0, dependencies.setModeBanner)('변경을 반영하지 않았습니다. 경계를 다시 편집하세요.');
              resolve(false);
            },
          });
        }) : true,
        applyResult: () => {
          if (!current()) throw new Error('원본이 바뀌어 변경을 적용하지 않았습니다.');
          globalThis.PandoLabTerritorialEdit.createKernel(window.polygonClipping).validate(
            nextCountries, nextUnits, [...dependencies.state.countriesData.features.map(country => ({
              ...country, properties: { ...country.properties, locked: country.properties?.locked === true || dependencies.state.countryOverrides?.[country.id]?.locked === true },
            })), ...dependencies.state.territorialUnits], result.affectedIds,
          );
          const replacements = new Map(result.ownershipChanges.filter(change => change.replacementId).map(change => [change.id, change.replacementId]));
          const parentChanges = new Map(result.ownershipChanges.filter(change => change.to).map(change => [change.id, change.to]));
          dependencies.state.territorialRelations = dependencies.state.territorialRelations
            .filter(relation => !countryIds.has(text(relation.unitId)) && !removed.has(text(relation.unitId)) && (!removed.has(text(relation.parentId)) || replacements.has(text(relation.parentId))))
            .map(relation => ({ ...relation, parentId: parentChanges.get(text(relation.unitId)) || replacements.get(text(relation.parentId)) || relation.parentId, sovereignId: changed.get(text(relation.unitId))?.properties?.sovereignId || relation.sovereignId }));
          dependencies.state.distributionEntries = dependencies.state.distributionEntries
            .filter(entry => !removed.has(text(entry.territorialUnitId)) || replacements.has(text(entry.territorialUnitId)))
            .map(entry => replacements.has(text(entry.territorialUnitId)) ? { ...entry, territorialUnitId: replacements.get(text(entry.territorialUnitId)) } : entry);
          for (const key of removed) {
            delete dependencies.state.itemVisibility.subunits?.[key];
            for (const labelKey of Object.keys(dependencies.state.labelSettings || {})) {
              if (labelKey === `subunit:${key}` || labelKey === `territorial:subunit:${key}`) delete dependencies.state.labelSettings[labelKey];
            }
          }
          const newCountries = nextCountries.filter(country => !(0, dependencies.countryFeatureById)(country.id));
          for (const country of newCountries) {
            dependencies.state.countriesData.features.push((0, dependencies.deepClone)(country));
            dependencies.state.countryOverrides[country.id] = (0, dependencies.deepClone)(request.countryOverride || {});
            delete dependencies.state.itemVisibility.subunits?.[country.id];
          }
          if (newCountries.length) (0, dependencies.reindexCountries)(dependencies.state.countriesData, true);
          dependencies.state.territorialUnits = (0, dependencies.normalizeTerritorialUnits)(nextUnits, { countryExists: key => countryIds.has(text(key)) });
          if (request.operation === 'create') dependencies.state.layerVisibility.subunits = true;
          const changedCountries = nextCountries.filter(country => changed.has(text(country.id))).map(country => text(country.id));
          if (changedCountries.length) {
            for (const key of changedCountries) {
              (0, dependencies.countryFeatureById)(key).geometry = (0, dependencies.deepClone)(changed.get(key).geometry);
              dependencies.state.historyDirtyCountryIds.add(key);
            }
            (0, dependencies.markCountryGeometriesChanged)(changedCountries);
            (0, dependencies.refreshCountryCentroids)(changedCountries);
            dependencies.state.boundaryTopology = { edges: new Map(), nodes: new Map() };
          }
          dependencies.editingDomain?.clearDraft?.({ reason: 'territorial-edit-applied', render: false });
          dependencies.editingDomain?.setTool('select', { announce: false });
          (0, dependencies.markLayerTreeDirty)();
          if ((0, dependencies.countryFeatureById)(selectedId)) (0, dependencies.applyCountrySelectionIntent)(selectedId, true);
          else (0, dependencies.applyTerritorialUnitSelectionIntent)(selectedId, true);
          if (changedCountries.length) dependencies.renderingDomain?.invalidateCountryPatch?.('territorial-coast-applied');
          dependencies.renderingDomain?.invalidateTerritorialPatch?.('territorial-edit-applied');
        },
        successMessage: '하위단위와 관련 소속 변경을 함께 적용했습니다.',
        errorMessage: '영역 변경을 적용하지 못해 전체 변경을 되돌렸습니다.',
      });
    } catch (error) {
      if (current()) (0, dependencies.reportOperationError)(error, '영역 변경을 계산하지 못했습니다.', 'PL-TERRITORIAL-EDIT', 4400);
      return false;
    }
  }

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
    const cache = { key: cacheKey, value: null, pending: true };
    session.setupSourceCache = cache;
    dependencies.mapEditClient.execute('territorial-source', { payload: {
      parent: (0, dependencies.deepClone)(parent), children: (0, dependencies.deepClone)(children),
    } }).then(response => {
      dependencies.mapEditClient.discard(response.requestId);
      if (dependencies.state.territorySelectionSession !== session || session.setupSourceCache !== cache) return;
      const geometry = response.result.geometry;
      cache.pending = false;
      cache.value = geometry ? {
        feature: (0, dependencies.createPartitionTerritorialFeature)({
          id: 'territory-selection-source:' + session.id, unitType: 'subunit',
          sovereignId: session.sovereignId, parentId: session.parentId, geometry,
        }), existingId: '', virtual: true,
      } : null;
      (0, dependencies.updateModeButtons)();
    }).catch(error => {
      cache.pending = false;
      if (dependencies.state.territorySelectionSession === session) (0, dependencies.reportOperationError)(error, '직할 영역을 계산하지 못했습니다.', 'PL-TERRITORIAL-SOURCE', 3600);
    });
    return null;
  }

  function territorialCreateSourceChoices(session = dependencies.state.territorySelectionSession) {
    if (!session || session.kind !== dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT) return [];
    const choices = [{ value: '', label: '기준 영역 선택', placeholder: true }];
    if (unassignedSourceForSession(session)) {
      const parent = parentFeatureForSession(session);
      const parentName = parent?.properties?.unitType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT
        ? (0, dependencies.territorialUnitName)(parent) : (0, dependencies.countryName)(parent);
      choices.push({ value: 'unassigned', label: `${parentName} 직할 영역` });
    }
    for (const feature of directSubunitChildren(session).filter(feature => text(feature.id) !== session.editTargetId)) {
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
    const countryOptions = [
      { value: '', label: '소속 국가 선택', placeholder: true },
      ...(0, dependencies.territorialUnitCountryOptions)().filter(option => option.value),
    ];
    const countryChoice = resolveSelectChoice(countryOptions, session.sovereignId, { autoSelectSingle: true });
    if (countryChoice.single && countryChoice.value !== text(session.sovereignId)) {
      session.sovereignId = countryChoice.value;
      session.parentId = countryChoice.value;
      session.sourceKey = 'unassigned';
      session.setupSourceCache = null;
    }
    const rawParentOptions = session.kind === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT && session.sovereignId
      ? (0, dependencies.subunitParentChoices)(session.sovereignId, dependencies.state.countriesData.features, dependencies.state.territorialUnits, {
        name: feature => feature.properties?.unitType ? (0, dependencies.territorialUnitName)(feature) : (0, dependencies.countryName)(feature),
      }) : [];
    const parentOptions = rawParentOptions.length ? rawParentOptions : [{ value: '', label: '상위 단위 선택', placeholder: true }];
    const parentChoice = resolveSelectChoice(parentOptions, session.parentId, { autoSelectSingle: true });
    if (parentChoice.single && parentChoice.value !== text(session.parentId)) {
      session.parentId = parentChoice.value;
      session.sourceKey = 'unassigned';
      session.setupSourceCache = null;
    }
    const sourceOptions = territorialCreateSourceChoices(session);
    const sourceChoice = resolveSelectChoice(sourceOptions, session.sourceKey, { autoSelectSingle: !session.setupSourceCache?.pending });
    if (sourceChoice.single) session.sourceKey = sourceChoice.value;
    return { session, countryOptions, parentOptions, sourceOptions, choiceStates: { country: countryChoice, parent: parentChoice, source: sourceChoice } };
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

  function enterTerritorialUnitCoastMode(id) {
    const unit = (0, dependencies.territorialUnitById)(id);
    if (!unit || unit.properties?.locked) return false;
    return (0, dependencies.enterCountryCoastEdit)(unit.properties.sovereignId, {
      returnSelection: { domain: 'territorial', type: 'subunit', id: text(id) },
    });
  }

  function enterTerritorialUnitAnnexMode(id) {
    const target = (0, dependencies.territorialUnitById)(id);
    if (!target || target.properties.locked || !enterTerritorialCreateWorkflow('subunit')) return false;
    const session = dependencies.state.territorySelectionSession;
    session.editOperation = 'annex'; session.editTargetId = text(id);
    session.name = target.properties.name || '하위단위';
    session.taskLabel = '영역 편입';
    session.parentId = text(target.properties.parentId); session.sovereignId = text(target.properties.sovereignId);
    session.setupSourceCache = null;
    territorialCreateSetupModel();
    (0, dependencies.updateModeButtons)();
    return true;
  }

  function updateTerritorialCreateSovereign(value) {
    const session = dependencies.state.territorySelectionSession;
    if (!session || session.editOperation || session.kind !== dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT) return;
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
    if (!session || session.editOperation || text(value) === text(session.parentId)) return;
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
    };
    const fingerprint = JSON.stringify([session.kind, session.sovereignId, session.parentId, session.sourceKey, [...session.sourceCountryIds].sort()]);
    if (session.sourceFingerprint === fingerprint && (session.baseSourceGeometry || session.activeMethod === 'polygon')) return true;
    session.sourceInfo = { context, source: null, existingId: '', virtual: false, sourceWasExisting: false };
    if (sourceInfo) {
      const source = (0, dependencies.deepClone)(sourceInfo.feature);
      session.sourceInfo = {
        context, source, existingId: sourceInfo.existingId || '', virtual: sourceInfo.virtual,
        sourceWasExisting: !!sourceInfo.existingId,
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

  function enterTerritorialUnitSplitMode(id) {
    const source = (0, dependencies.territorialUnitById)(id);
    if (!source || !enterTerritorialCreateWorkflow(dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT)) return false;
    const session = dependencies.state.territorySelectionSession;
    session.sovereignId = text(source.properties.sovereignId);
    session.parentId = text(source.properties.parentId);
    session.sourceKey = text(source.id);
    session.setupSourceCache = null;
    territorialCreateSetupModel();
    (0, dependencies.updateModeButtons)();
    return true;
  }

  function finishTerritorialUnitSplitDraft() {
    return finishTerritorialUnitCreateSplitDraft();
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
    return globalThis.PandoLabTerritorialEdit.createKernel(window.polygonClipping).adjacent(left.geometry, right.geometry);
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
      (0, dependencies.setActionStatus)('같은 소속 국가·상위 단위의 하위단위만 합칠 수 있습니다.', 'error', 3400);
      return;
    }
    const selected = [source, ...dependencies.state.territorialUnitMergeTargetIds.map(dependencies.territorialUnitById).filter(Boolean)];
    if (!selected.some(item => text(item.id) === text(target.id) || territorialUnitsAreAdjacent(item, target))) {
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
    if (!source || !dependencies.state.territorialUnitMergeTargetIds.length) return false;
    if (source.properties.unitType === 'region') return previewRegionMerge(source);
    const tool = dependencies.state.tool;
    return previewTerritorialEdit({ operation: 'merge', targetId: source.id,
      parentId: source.properties.parentId, sourceIds: dependencies.state.territorialUnitMergeTargetIds,
    }, { selectedId: source.id, shouldKeepResult: () => dependencies.state.tool === tool && text(dependencies.state.territorialUnitMergeSourceId) === text(source.id) });
  }

  function previewRegionMerge(source) {
    const targets = dependencies.state.territorialUnitMergeTargetIds.map(dependencies.territorialUnitById).filter(Boolean);
    const result = dependencies.territorialGeometry.mergeUnits(source, targets);
    return (0, dependencies.beginLocalGeometryPreview)({ operation: 'merge-region', beforeFeatures: [source, ...targets],
      afterFeatures: [result.survivor], removedIds: result.removedIds, commitHistorySnapshot: true,
      applyResult: () => {
        const removed = new Set(result.removedIds);
        dependencies.state.territorialUnits = dependencies.state.territorialUnits.filter(unit => !removed.has(text(unit.id)))
          .map(unit => text(unit.id) === text(source.id) ? result.survivor : unit);
        dependencies.state.distributionEntries = dependencies.state.distributionEntries.map(entry => removed.has(text(entry.territorialUnitId)) ? { ...entry, territorialUnitId: text(source.id) } : entry);
        dependencies.state.territorialRelations = dependencies.state.territorialRelations.filter(relation => !removed.has(text(relation.unitId)))
          .map(relation => removed.has(text(relation.parentId)) ? { ...relation, parentId: text(source.id) } : relation);
        dependencies.editingDomain?.setTool('select', { announce: false });
        (0, dependencies.markLayerTreeDirty)();
        (0, dependencies.applyTerritorialUnitSelectionIntent)(source.id, true);
      },
    });
  }

  function enterTerritorialUnitRedrawMode(id, selectedIds = null) {
    const source = (0, dependencies.territorialUnitById)(id);
    if (!source) return false;
    if (source.properties.unitType === 'subunit') {
      const siblings = (0, dependencies.territorialSiblings)(dependencies.state.territorialUnits, source);
      if (source.properties.locked || !siblings.some(unit => territorialUnitsAreAdjacent(source, unit))) {
        (0, dependencies.setActionStatus)('경계를 공유하는 하위단위가 있어야 경계를 조정할 수 있습니다.', 'error', 3400);
        return false;
      }
      dependencies.editingDomain?.setTool('country-border', { announce: false });
      dependencies.state.boundaryEditCountryIds = [source, ...siblings].map(unit => text(unit.id)).filter(key => !selectedIds || selectedIds.includes(key));
      dependencies.state.boundaryEditSeedCountryId = text(source.id);
      dependencies.state.boundaryEditPhase = 'editing';
      (0, dependencies.rebuildBoundaryTopology)(dependencies.state.boundaryEditCountryIds);
      (0, dependencies.setModeBanner)('형제 사이 공유 경계 꼭짓점을 이동하세요. 상위 단위의 바깥 경계는 유지됩니다.');
      (0, dependencies.updateModeButtons)();
      return true;
    }
    dependencies.editingDomain?.setTool('redraw-territorial-unit', { announce: false });
    dependencies.state.territorialUnitRedrawSourceId = String(source.id);
    (0, dependencies.setModeBanner)((0, dependencies.defaultDraftInstruction)());
    (0, dependencies.updateModeButtons)();
    return true;
  }

  function finishTerritorialUnitRedrawDraft() {
    const source = (0, dependencies.territorialUnitById)(dependencies.state.territorialUnitRedrawSourceId);
    if (!source || source.properties.unitType !== 'region' || source.properties.locked) return false;
    const container = (0, dependencies.territorialUnitContainer)(source);
    if (!container) return false;
    try {
      const drawn = { type: 'Polygon', coordinates: [(0, dependencies.orientRing)((0, dependencies.editingDraftCoordinates)(), true)] };
      const geometry = (0, dependencies.normalizeClippedLandGeometry)(window.polygonClipping.intersection(drawn.coordinates, container.geometry.coordinates));
      if (!geometry) throw new Error('그린 영역이 상위 영역 안에 없습니다.');
      const siblings = (0, dependencies.territorialSiblings)(dependencies.state.territorialUnits, source);
      for (const sibling of siblings) {
        if ((0, dependencies.multiPolygonPlanarArea)(window.polygonClipping.intersection(geometry.coordinates, sibling.geometry.coordinates)) > 1e-9) throw new Error('다른 지방과 영역이 겹칩니다.');
      }
      const next = { ...(0, dependencies.deepClone)(source), geometry };
      return (0, dependencies.beginLocalGeometryPreview)({ operation: 'redraw-region', beforeFeatures: [source], afterFeatures: [next],
        commitHistorySnapshot: true,
        applyResult: () => {
          source.geometry = (0, dependencies.deepClone)(geometry);
          dependencies.editingDomain?.clearDraft?.(true);
          dependencies.editingDomain?.setTool('select', { announce: false });
          (0, dependencies.markLayerTreeDirty)();
          (0, dependencies.applyTerritorialUnitSelectionIntent)(source.id, true);
        },
      });
    } catch (error) {
      (0, dependencies.reportOperationError)(error, '지방 영역을 다시 지정하지 못했습니다.', 'PL-REGION-REDRAW-001', 4300);
      return false;
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

    const sourceId = workflow.sourceInfo?.existingId || '';
    const sibling = (0, dependencies.createPartitionTerritorialFeature)({
      id: workflow.generatedId, unitType: context.unitType,
      sovereignId: context.sovereignId, parentId: context.parentId,
      name: workflow.name.trim(), geometry: (0, dependencies.deepClone)(geometry),
    });
    return previewTerritorialEdit({
      operation: workflow.editOperation || 'create', targetId: workflow.editTargetId || context.parentId,
      parentId: context.parentId, sourceId, draft: geometry, newFeature: sibling,
    }, { selectedId: workflow.editTargetId || sibling.id, shouldKeepResult });
  }

  return Object.freeze({
    connect,
    get completeTerritorialUnitMerge() { return completeTerritorialUnitMerge; },
    get enterTerritorialUnitCoastMode() { return enterTerritorialUnitCoastMode; },
    get previewTerritorialEdit() { return previewTerritorialEdit; },
    get refreshTerritorialCoastAvailability() { return refreshTerritorialCoastAvailability; },
    get enterTerritorialUnitAnnexMode() { return enterTerritorialUnitAnnexMode; },
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
