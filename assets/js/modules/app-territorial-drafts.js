/** TerritorialDrafts: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
import { resolveSelectChoice } from './select-option-policy.js';
import './territorial-edit-plan.js';
import { territorialSegmentCandidates } from './geometry-segment-index.js';

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
    const revision = dependencies.projectState.state.stateRevision;
    for (const buttonId of ['editSubunitCoastBtn', 'reconcileSubunitCoastBtn']) (0, dependencies.platform.$)(buttonId).disabled = true;
    if (feature.properties?.locked) return;
    try {
      if (coastAvailabilityRevision !== revision) { coastAvailability.clear(); coastAvailabilityRevision = revision; }
      const key = text(feature.id);
      if (!coastAvailability.has(key)) coastAvailability.set(key,
        dependencies.spatialQuery.mapEditClient.execute('territorial-coast-availability', { payload: {
          unitId: text(feature.id),
        } }).then(response => { dependencies.spatialQuery.mapEditClient.discard(response.requestId); return response.result; })
          .catch(error => { coastAvailability.delete(key); throw error; }));
      const result = await coastAvailability.get(key);
      if (revision !== dependencies.projectState.state.stateRevision || text(dependencies.projectState.state.selected?.id) !== text(feature.id)) return;
      (0, dependencies.platform.$)('editSubunitCoastBtn').disabled = !result.coastal;
      (0, dependencies.platform.$)('reconcileSubunitCoastBtn').disabled = !result.reconciliation;
    } catch (_) {
      // Controls remain disabled until reliable coast data is available.
    }
  }

  async function previewTerritorialEdit(request, { selectedId, shouldKeepResult = () => true } = {}) {
    const requestRevision = ++editRequestRevision;
    const revision = dependencies.projectState.state.stateRevision;
    const entryTool = dependencies.projectState.state.tool;
    const entrySelection = text(dependencies.projectState.state.selected?.id);
    const snapshot = (0, dependencies.snapshots.snapshotEditable)();
    const countries = dependencies.projectState.state.countriesData.features;
    const units = dependencies.projectState.state.territorialUnits;
    const current = () => requestRevision === editRequestRevision && dependencies.projectState.state.stateRevision === revision
      && dependencies.projectState.state.tool === entryTool && text(dependencies.projectState.state.selected?.id) === entrySelection && shouldKeepResult();
    try {
      (0, dependencies.feedback.setActionStatus)('영역 변경과 하위단위 영향을 계산하고 있습니다.', 'working', 0);
      const response = await dependencies.spatialQuery.mapEditClient.execute('territorial-edit', { payload: request });
      dependencies.spatialQuery.mapEditClient.discard(response.requestId);
      if (!current()) return false;
      const result = response.result;
      const unresolved = result.impacts.find(impact => impact.kind === 'coast-owner');
      if (unresolved) {
        const owner = await new Promise(resolve => (0, dependencies.projectRestore.openConfirmModal)({
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
      return (0, dependencies.geometryOperations.beginLocalGeometryPreview)({
        operation: `territorial-${request.operation}`,
        snapshot,
        beforeFeatures: [...countries, ...units].filter(feature => result.affectedIds.includes(text(feature.id))),
        afterFeatures: result.features,
        removedIds: result.removedIds,
        shouldKeepResult: current,
        commitHistorySnapshot: true,
        preparedPreview: result.preview,
        validatePrepared: async () => {
          const checked = await dependencies.spatialQuery.mapEditClient.execute('territorial-validation', { payload: { preparationId: result.preparationId } });
          return checked.result.valid && current() && dependencies.spatialQuery.mapEditClient.sourcesCurrent(response.sourceRevision);
        },
        beforeApply: () => partial.length || result.ownershipChanges.length ? new Promise(resolve => {
          (0, dependencies.projectRestore.openConfirmModal)({
            title: '하위단위 영향 확인',
            message: '아래 소속 변경과 절단을 함께 반영합니다. 반영하지 않으면 경계를 다시 편집할 수 있습니다.',
            impacts: result.ownershipChanges.map(change => (units.find(unit => text(unit.id) === change.id)?.properties.name || change.id) + ': ' + (change.replacementId ? '합병 후 참조 이전' : '상위 단위 ' + change.to + (change.sovereignId ? ' · 소속 국가 ' + change.sovereignId : ''))).concat(partial.map(impact => `${impact.name}: ${impact.kind === 'remove-child' ? '객체와 참조 삭제' : '일부 영역 절단 · ' + (0, dependencies.applicationServicesB.sphericalGeometryAreaKm2)(impact.geometry).toFixed(3) + ' km²'}`)),
            confirmText: '반영', cancelText: '반영 안 함',
            onConfirm: () => resolve(true), onCancel: () => {
              if (dependencies.projectState.state.territorySelectionSession?.stage === 'review') (0, dependencies.territorySelectionA.backToTerritorialSelection)();
              else (0, dependencies.geometryOperations.discardActiveGeometryPreview)({ announce: false });
              (0, dependencies.taskUi.setModeBanner)('변경을 반영하지 않았습니다. 경계를 다시 편집하세요.');
              resolve(false);
            },
          });
        }) : true,
        applyResult: () => {
          if (!current()) throw new Error('원본이 바뀌어 변경을 적용하지 않았습니다.');
          if (!dependencies.spatialQuery.mapEditClient.sourcesCurrent(response.sourceRevision)) throw new Error('원본이 바뀌어 변경을 적용하지 않았습니다.');
          const replacements = new Map(result.ownershipChanges.filter(change => change.replacementId).map(change => [change.id, change.replacementId]));
          const parentChanges = new Map(result.ownershipChanges.filter(change => change.to).map(change => [change.id, change.to]));
          dependencies.projectState.state.territorialRelations = dependencies.projectState.state.territorialRelations
            .filter(relation => !countryIds.has(text(relation.unitId)) && !removed.has(text(relation.unitId)) && (!removed.has(text(relation.parentId)) || replacements.has(text(relation.parentId))))
            .map(relation => ({ ...relation, parentId: parentChanges.get(text(relation.unitId)) || replacements.get(text(relation.parentId)) || relation.parentId, sovereignId: changed.get(text(relation.unitId))?.properties?.sovereignId || relation.sovereignId }));
          dependencies.projectState.state.distributionEntries = dependencies.projectState.state.distributionEntries
            .filter(entry => !removed.has(text(entry.territorialUnitId)) || replacements.has(text(entry.territorialUnitId)))
            .map(entry => replacements.has(text(entry.territorialUnitId)) ? { ...entry, territorialUnitId: replacements.get(text(entry.territorialUnitId)) } : entry);
          for (const key of removed) {
            delete dependencies.projectState.state.itemVisibility.subunits?.[key];
            for (const labelKey of Object.keys(dependencies.projectState.state.labelSettings || {})) {
              if (labelKey === `subunit:${key}` || labelKey === `territorial:subunit:${key}`) delete dependencies.projectState.state.labelSettings[labelKey];
            }
          }
          const newCountries = nextCountries.filter(country => !(0, dependencies.countries.countryFeatureById)(country.id));
          for (const country of newCountries) {
            dependencies.projectState.state.countriesData.features.push((0, dependencies.platform.deepClone)(country));
            dependencies.projectState.state.countryOverrides[country.id] = (0, dependencies.platform.deepClone)(request.countryOverride || {});
            delete dependencies.projectState.state.itemVisibility.subunits?.[country.id];
          }
          if (newCountries.length) (0, dependencies.geometryMutation.reindexCountries)(dependencies.projectState.state.countriesData, true);
          dependencies.projectState.state.territorialUnits = (0, dependencies.territorialModel.normalizeTerritorialUnits)(nextUnits, { countryExists: key => countryIds.has(text(key)), validatedUnchanged: new Set(units.filter(unit => !changed.has(text(unit.id)))) });
          if (request.operation === 'create') dependencies.projectState.state.layerVisibility.subunits = true;
          const changedCountries = nextCountries.filter(country => changed.has(text(country.id))).map(country => text(country.id));
          if (changedCountries.length) {
            for (const key of changedCountries) {
              (0, dependencies.countries.countryFeatureById)(key).geometry = (0, dependencies.platform.deepClone)(changed.get(key).geometry);
              dependencies.projectState.state.historyDirtyCountryIds.add(key);
            }
            (0, dependencies.spatialQuery.markCountryGeometriesChanged)(changedCountries);
            (0, dependencies.countryValidation.refreshCountryCentroids)(changedCountries);
            dependencies.projectState.state.boundaryPreparation?.cancel();
            dependencies.projectState.state.boundaryPreparation = null;
          }
          dependencies.domains.editingDomain?.clearDraft?.({ reason: 'territorial-edit-applied', render: false });
          dependencies.domains.editingDomain?.setTool('select', { announce: false });
          (0, dependencies.layers.markLayerTreeDirty)();
          if ((0, dependencies.countries.countryFeatureById)(selectedId)) (0, dependencies.propertyEditingA.applyCountrySelectionIntent)(selectedId, true);
          else (0, dependencies.propertyEditingA.applyTerritorialUnitSelectionIntent)(selectedId, true);
          if (changedCountries.length) dependencies.domains.renderingDomain?.invalidateCountryPatch?.('territorial-coast-applied');
          dependencies.domains.renderingDomain?.invalidateTerritorialPatch?.('territorial-edit-applied');
        },
        successMessage: '하위단위와 관련 소속 변경을 함께 적용했습니다.',
        errorMessage: '영역 변경을 적용하지 못해 전체 변경을 되돌렸습니다.',
      });
    } catch (error) {
      if (current()) (0, dependencies.feedback.reportOperationError)(error, '영역 변경을 계산하지 못했습니다.', 'PL-TERRITORIAL-EDIT', 4400);
      return false;
    }
  }

  function selectedTerritorialCreateDefaults(unitType) {
    const selected = dependencies.projectState.state.selected?.domain === 'territorial' ? dependencies.projectState.state.selected : null;
    const selectedCountry = selected?.type === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY
      ? (0, dependencies.countries.countryFeatureById)(selected.id) : null;
    const selectedUnit = selected && selected.type !== dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY
      ? (0, dependencies.objectPresentation.territorialUnitById)(selected.id) : null;
    const sovereignId = unitType === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.SUBUNIT
      ? text(selectedUnit?.properties?.sovereignId || selectedCountry?.id) : '';
    const parentId = unitType === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.SUBUNIT
      ? text(selectedUnit?.properties?.unitType === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.SUBUNIT ? selectedUnit.id : selectedCountry?.id) : '';
    return { sovereignId, parentId };
  }

  function parentFeatureForSession(session) {
    if (!session || session.kind !== dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.SUBUNIT) return null;
    return (0, dependencies.objectPresentation.territorialUnitById)(session.parentId) || (0, dependencies.countries.countryFeatureById)(session.parentId);
  }

  function directSubunitChildren(session) {
    return dependencies.projectState.state.territorialUnits.filter(feature => feature.properties?.unitType === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.SUBUNIT
      && text(feature.properties?.sovereignId) === text(session.sovereignId)
      && text(feature.properties?.parentId) === text(session.parentId));
  }

  function unassignedSourceForSession(session) {
    const cacheKey = `${text(session.sovereignId)}:${text(session.parentId)}:${Number(dependencies.projectState.state.stateRevision || 0)}`;
    if (session.setupSourceCache?.key === cacheKey) return session.setupSourceCache.value;
    const parent = parentFeatureForSession(session);
    if (!parent?.geometry) return null;
    const cache = { key: cacheKey, value: null, pending: true };
    session.setupSourceCache = cache;
    dependencies.spatialQuery.mapEditClient.execute('territorial-source', { payload: {
      parentId: text(parent.id),
    } }).then(response => {
      dependencies.spatialQuery.mapEditClient.discard(response.requestId);
      if (dependencies.projectState.state.territorySelectionSession !== session || session.setupSourceCache !== cache) return;
      const geometry = response.result.geometry;
      cache.pending = false;
      cache.value = geometry ? {
        feature: (0, dependencies.territorialModel.createPartitionTerritorialFeature)({
          id: 'territory-selection-source:' + session.id, unitType: 'subunit',
          sovereignId: session.sovereignId, parentId: session.parentId, geometry,
        }), existingId: '', virtual: true,
      } : null;
      (0, dependencies.taskUi.updateModeButtons)();
    }).catch(error => {
      cache.pending = false;
      if (dependencies.projectState.state.territorySelectionSession === session) (0, dependencies.feedback.reportOperationError)(error, '직할 영역을 계산하지 못했습니다.', 'PL-TERRITORIAL-SOURCE', 3600);
    });
    return null;
  }

  function territorialCreateSourceChoices(session = dependencies.projectState.state.territorySelectionSession) {
    if (!session || session.kind !== dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.SUBUNIT) return [];
    const choices = [{ value: '', label: '기준 영역 선택', placeholder: true }];
    if (unassignedSourceForSession(session)) {
      const parent = parentFeatureForSession(session);
      const parentName = parent?.properties?.unitType === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.SUBUNIT
        ? (0, dependencies.objectPresentation.territorialUnitName)(parent) : (0, dependencies.presentation.countryName)(parent);
      choices.push({ value: 'unassigned', label: `${parentName} 직할 영역` });
    }
    for (const feature of directSubunitChildren(session).filter(feature => text(feature.id) !== session.editTargetId)) {
      choices.push({ value: text(feature.id), label: (0, dependencies.objectPresentation.territorialUnitName)(feature) });
    }
    return choices;
  }

  function resolveTerritorialCreateSource(session = dependencies.projectState.state.territorySelectionSession) {
    if (!session || session.kind !== dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.SUBUNIT) return null;
    if (session.sourceKey === 'unassigned') return unassignedSourceForSession(session);
    const feature = (0, dependencies.objectPresentation.territorialUnitById)(session.sourceKey);
    if (!feature?.geometry || feature.properties?.unitType !== dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.SUBUNIT
      || text(feature.properties?.sovereignId) !== text(session.sovereignId)
      || text(feature.properties?.parentId) !== text(session.parentId)) return null;
    return { feature, existingId: text(feature.id), virtual: false };
  }

  function territorialCreateSetupModel() {
    const session = dependencies.projectState.state.territorySelectionSession;
    if (!session) return null;
    const countryOptions = [
      { value: '', label: '소속 국가 선택', placeholder: true },
      ...(0, dependencies.propertyEditingB.territorialUnitCountryOptions)().filter(option => option.value),
    ];
    const countryChoice = resolveSelectChoice(countryOptions, session.sovereignId, { autoSelectSingle: true });
    if (countryChoice.single && countryChoice.value !== text(session.sovereignId)) {
      session.sovereignId = countryChoice.value;
      session.parentId = countryChoice.value;
      session.sourceKey = 'unassigned';
      session.setupSourceCache = null;
    }
    const rawParentOptions = session.kind === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.SUBUNIT && session.sovereignId
      ? (0, dependencies.territorialServicesA.subunitParentChoices)(session.sovereignId, dependencies.projectState.state.countriesData.features, dependencies.projectState.state.territorialUnits, {
        name: feature => feature.properties?.unitType ? (0, dependencies.objectPresentation.territorialUnitName)(feature) : (0, dependencies.presentation.countryName)(feature),
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

  function territorialCreateSetupValid(session = dependencies.projectState.state.territorySelectionSession) {
    if (!session || !session.name.trim()) return false;
    if (session.kind === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.REGION) return true;
    const parentValid = (0, dependencies.territorialServicesA.subunitParentChoices)(
      session.sovereignId,
      dependencies.projectState.state.countriesData.features,
      dependencies.projectState.state.territorialUnits,
      { name: feature => feature.properties?.unitType ? (0, dependencies.objectPresentation.territorialUnitName)(feature) : (0, dependencies.presentation.countryName)(feature) },
    ).some(option => text(option.value) === text(session.parentId));
    const source = resolveTerritorialCreateSource(session);
    return !!(session.sovereignId && parentValid && parentFeatureForSession(session) && source && source.feature?.properties?.locked !== true);
  }

  function enterTerritorialCreateWorkflow(unitType) {
    if (![dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.SUBUNIT, dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.REGION].includes(unitType)) return false;
    const defaults = selectedTerritorialCreateDefaults(unitType);
    const session = (0, dependencies.territorySelectionA.startTerritorySelection)(unitType, {
      tool: 'draw-territorial-unit',
      name: unitType === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.REGION ? '새 지방' : '새 하위단위',
      sovereignId: defaults.sovereignId, parentId: defaults.parentId, sourceKey: 'unassigned', sourceCountryIds: [],
    });
    if (!session) return false;
    territorialCreateSetupModel();
    (0, dependencies.taskUi.setModeBanner)('');
    (0, dependencies.taskUi.updateModeButtons)();
    requestAnimationFrame(() => (0, dependencies.platform.$)('territorialCreateNameInput')?.select());
    return true;
  }

  function enterTerritorialUnitCoastMode(id) {
    const unit = (0, dependencies.objectPresentation.territorialUnitById)(id);
    if (!unit || unit.properties?.locked) return false;
    return (0, dependencies.countryEditingA.enterCountryCoastEdit)(unit.properties.sovereignId, {
      returnSelection: { domain: 'territorial', type: 'subunit', id: text(id) },
    });
  }

  function enterTerritorialUnitAnnexMode(id) {
    const target = (0, dependencies.objectPresentation.territorialUnitById)(id);
    if (!target || target.properties.locked || !enterTerritorialCreateWorkflow('subunit')) return false;
    const session = dependencies.projectState.state.territorySelectionSession;
    session.editOperation = 'annex'; session.editTargetId = text(id);
    session.name = target.properties.name || '하위단위';
    session.taskLabel = '영역 편입';
    session.parentId = text(target.properties.parentId); session.sovereignId = text(target.properties.sovereignId);
    session.setupSourceCache = null;
    territorialCreateSetupModel();
    (0, dependencies.taskUi.updateModeButtons)();
    return true;
  }

  function updateTerritorialCreateSovereign(value) {
    const session = dependencies.projectState.state.territorySelectionSession;
    if (!session || session.editOperation || session.kind !== dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.SUBUNIT) return;
    if (text(value) === text(session.sovereignId)) return;
    session.sovereignId = text(value);
    session.parentId = session.sovereignId;
    session.sourceKey = 'unassigned';
    session.setupSourceCache = null;
    session.settingsRevision += 1;
    (0, dependencies.territorySelectionA.resetTerritorySelection)(session, { keepRequestedMethod: false });
    territorialCreateSetupModel();
    (0, dependencies.taskUi.updateModeButtons)();
  }

  function updateTerritorialCreateParent(value) {
    const session = dependencies.projectState.state.territorySelectionSession;
    if (!session || session.editOperation || text(value) === text(session.parentId)) return;
    session.parentId = text(value);
    session.sourceKey = 'unassigned';
    session.setupSourceCache = null;
    session.settingsRevision += 1;
    (0, dependencies.territorySelectionA.resetTerritorySelection)(session, { keepRequestedMethod: false });
    territorialCreateSetupModel();
    (0, dependencies.taskUi.updateModeButtons)();
  }

  function updateTerritorialCreateSource(value) {
    const session = dependencies.projectState.state.territorySelectionSession;
    if (!session || text(value) === text(session.sourceKey)) return;
    session.sourceKey = text(value);
    session.settingsRevision += 1;
    (0, dependencies.territorySelectionA.resetTerritorySelection)(session, { keepRequestedMethod: false });
    (0, dependencies.taskUi.updateModeButtons)();
  }

  function createTerritorialSourceFeature(session) {
    if (session.kind === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.SUBUNIT) return resolveTerritorialCreateSource(session);
    if (session.activeMethod === 'polygon') return null;
    const features = session.sourceCountryIds.map(id => dependencies.countries.countryFeatureById(id)).filter(feature => feature?.geometry);
    if (!features.length) return null;
    const geometry = { type: 'MultiPolygon', coordinates: features.flatMap(feature => dependencies.territoryGeometry.geometryMultiCoordinates(feature.geometry)) };
    return {
      feature: { type: 'Feature', id: 'territorial-create-source', properties: { name: '기준 영역' }, geometry },
      existingId: '', virtual: true, features,
    };
  }

  function prepareTerritorialCreateSelection(session) {
    if (!session?.activeMethod || !['line', 'polygon', 'components'].includes(session.activeMethod)
      || (session.kind === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.REGION
        && session.activeMethod !== 'polygon' && !session.sourceCountryIds.length)) return false;
    const sourceInfo = createTerritorialSourceFeature(session);
    if (session.activeMethod !== 'polygon' && !sourceInfo?.feature?.geometry) return false;
    const context = {
      unitType: session.kind,
      sovereignId: session.kind === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.SUBUNIT ? session.sovereignId : '',
      parentId: session.kind === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.SUBUNIT ? session.parentId : '',
    };
    const fingerprint = JSON.stringify([session.kind, session.sovereignId, session.parentId, session.sourceKey, [...session.sourceCountryIds].sort()]);
    if (session.sourceFingerprint === fingerprint && (session.baseSourceGeometry || session.activeMethod === 'polygon')) return true;
    session.sourceInfo = { context, source: null, existingId: '', virtual: false, sourceWasExisting: false };
    if (sourceInfo) {
      const source = sourceInfo.feature;
      session.sourceInfo = {
        context, source, existingId: sourceInfo.existingId || '', virtual: sourceInfo.virtual,
        sourceWasExisting: !!sourceInfo.existingId,
      };
    }
    session.baseSourceGeometry = sourceInfo?.features ? null : sourceInfo?.feature?.geometry || null;
    session.workingSourceGeometry = sourceInfo?.feature?.geometry || null;
    session.remainingGeometry = session.workingSourceGeometry;
    session.sourceRevision += 1;
    session.sourceFingerprint = fingerprint;
    session.componentFeatures = sourceInfo?.features || (sourceInfo ? [sourceInfo.feature] : []);
    return true;
  }

  function enterTerritorialUnitSplitMode(id) {
    const source = (0, dependencies.objectPresentation.territorialUnitById)(id);
    if (!source || !enterTerritorialCreateWorkflow(dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.SUBUNIT)) return false;
    const session = dependencies.projectState.state.territorySelectionSession;
    session.sovereignId = text(source.properties.sovereignId);
    session.parentId = text(source.properties.parentId);
    session.sourceKey = text(source.id);
    session.setupSourceCache = null;
    territorialCreateSetupModel();
    (0, dependencies.taskUi.updateModeButtons)();
    return true;
  }

  function finishTerritorialUnitSplitDraft() {
    return finishTerritorialUnitCreateSplitDraft();
  }

  function finishTerritorialUnitCreateSplitDraft() {
    const session = dependencies.projectState.state.territorySelectionSession;
    const source = session?.sourceInfo?.source;
    if (!['subunit', 'region'].includes(session?.kind) || !session.workingSourceGeometry || !source?.geometry) return false;
    try {
      const split = (0, dependencies.cutOperations.buildCutSplitCandidates)(session.workingSourceGeometry, (0, dependencies.countryEditingA.editingDraftCoordinates)());
      const smallerIndex = split.candidates[0].area <= split.candidates[1].area ? 0 : 1;
      const geometry = split.candidates[smallerIndex]?.geometry;
      if (!geometry) throw new Error('나눌 영역을 찾을 수 없습니다.');
      (0, dependencies.territorySelectionA.setTerritorySelectionCandidates)(
        split.candidates.map(candidate => ({ geometry: (0, dependencies.platform.deepClone)(candidate.geometry) })),
        smallerIndex,
      );
      (0, dependencies.taskUi.setModeBanner)('나눌 영역을 확인하세요.');
      dependencies.domains.renderingDomain?.invalidateEditingOverlays?.('territorial-create-split-part-finished');
      (0, dependencies.taskUi.updateModeButtons)();
      return true;
    } catch (error) {
      (0, dependencies.feedback.reportOperationError)(error, '영역을 나누지 못했습니다. 한 영역을 정확히 한 번 관통하도록 경계를 다시 그리세요.', 'PL-REGION-SPLIT-001', 4400);
      return false;
    }
  }

  function territorialUnitsAreAdjacent(left, right) {
    return globalThis.PandoLabTerritorialEdit.createKernel(window.polygonClipping, { segmentCandidates: territorialSegmentCandidates }).adjacent(left.geometry, right.geometry);
  }

  function enterTerritorialUnitMergeMode(id) {
    const source = (0, dependencies.objectPresentation.territorialUnitById)(id);
    if (!source) return false;
    dependencies.domains.editingDomain?.setTool('merge-territorial-unit', { announce: false });
    dependencies.projectState.state.territorialUnitMergeSourceId = String(source.id);
    dependencies.projectState.state.territorialUnitMergeTargetIds = [];
    (0, dependencies.taskUi.setModeBanner)('합칠 인접 영역을 선택하세요.');
    (0, dependencies.taskUi.updateModeButtons)();
    dependencies.domains.renderingDomain?.renderTerritorialUnits?.();
    return true;
  }

  function toggleTerritorialUnitMergeTarget(id) {
    if (dependencies.projectState.state.tool !== 'merge-territorial-unit') return;
    const source = (0, dependencies.objectPresentation.territorialUnitById)(dependencies.projectState.state.territorialUnitMergeSourceId);
    const target = (0, dependencies.objectPresentation.territorialUnitById)(id);
    if (!source || !target || String(source.id) === String(target.id)) return;
    if (!(0, dependencies.territorialServicesB.territorialSiblings)(dependencies.projectState.state.territorialUnits, source).some(candidate => String(candidate.id) === String(target.id))) {
      (0, dependencies.feedback.setActionStatus)('같은 소속 국가·상위 단위의 하위단위만 합칠 수 있습니다.', 'error', 3400);
      return;
    }
    const selected = [source, ...dependencies.projectState.state.territorialUnitMergeTargetIds.map(dependencies.objectPresentation.territorialUnitById).filter(Boolean)];
    if (!selected.some(item => text(item.id) === text(target.id) || territorialUnitsAreAdjacent(item, target))) {
      (0, dependencies.feedback.setActionStatus)('경계를 공유하는 인접 영역만 합칠 수 있습니다.', 'error', 3400);
      return;
    }
    const targets = new Set(dependencies.projectState.state.territorialUnitMergeTargetIds.map(String));
    if (targets.has(String(id))) targets.delete(String(id)); else targets.add(String(id));
    dependencies.projectState.state.territorialUnitMergeTargetIds = [...targets];
    dependencies.domains.renderingDomain?.renderTerritorialUnits?.();
    (0, dependencies.taskUi.updateModeButtons)();
  }

  function completeTerritorialUnitMerge() {
    const source = (0, dependencies.objectPresentation.territorialUnitById)(dependencies.projectState.state.territorialUnitMergeSourceId);
    if (!source || !dependencies.projectState.state.territorialUnitMergeTargetIds.length) return false;
    if (source.properties.unitType === 'region') return previewRegionMerge(source);
    const tool = dependencies.projectState.state.tool;
    return previewTerritorialEdit({ operation: 'merge', targetId: source.id,
      parentId: source.properties.parentId, sourceIds: dependencies.projectState.state.territorialUnitMergeTargetIds,
    }, { selectedId: source.id, shouldKeepResult: () => dependencies.projectState.state.tool === tool && text(dependencies.projectState.state.territorialUnitMergeSourceId) === text(source.id) });
  }

  async function previewRegionMerge(source) {
    const targets = dependencies.projectState.state.territorialUnitMergeTargetIds.map(dependencies.objectPresentation.territorialUnitById).filter(Boolean);
    const revision = dependencies.projectState.state.stateRevision;
    let response;
    try {
      response = await dependencies.spatialQuery.mapEditClient.execute('territorial-region-merge', { payload: { targetId: source.id, targetIds: targets.map(target => target.id) } });
    } catch (error) {
      if (!error?.cancelled) (0, dependencies.feedback.reportOperationError)(error, '지방 합병을 준비하지 못했습니다.', 'PL-REGION-MERGE', 3600);
      return false;
    }
    if (dependencies.projectState.state.stateRevision !== revision || text(dependencies.projectState.state.territorialUnitMergeSourceId) !== text(source.id)) return false;
    const result = response.result;
    return (0, dependencies.geometryOperations.beginLocalGeometryPreview)({ operation: 'merge-region', beforeFeatures: [source, ...targets],
      afterFeatures: [result.survivor], removedIds: result.removedIds, commitHistorySnapshot: true,
      applyResult: () => {
        const removed = new Set(result.removedIds);
        dependencies.projectState.state.territorialUnits = dependencies.projectState.state.territorialUnits.filter(unit => !removed.has(text(unit.id)))
          .map(unit => text(unit.id) === text(source.id) ? result.survivor : unit);
        dependencies.projectState.state.distributionEntries = dependencies.projectState.state.distributionEntries.map(entry => removed.has(text(entry.territorialUnitId)) ? { ...entry, territorialUnitId: text(source.id) } : entry);
        dependencies.projectState.state.territorialRelations = dependencies.projectState.state.territorialRelations.filter(relation => !removed.has(text(relation.unitId)))
          .map(relation => removed.has(text(relation.parentId)) ? { ...relation, parentId: text(source.id) } : relation);
        dependencies.domains.editingDomain?.setTool('select', { announce: false });
        (0, dependencies.layers.markLayerTreeDirty)();
        (0, dependencies.propertyEditingA.applyTerritorialUnitSelectionIntent)(source.id, true);
      },
    });
  }

  function enterTerritorialUnitRedrawMode(id, selectedIds = null) {
    const source = (0, dependencies.objectPresentation.territorialUnitById)(id);
    if (!source) return false;
    if (source.properties.unitType === 'subunit') {
      const siblings = (0, dependencies.territorialServicesB.territorialSiblings)(dependencies.projectState.state.territorialUnits, source);
      if (source.properties.locked || !siblings.length) {
        (0, dependencies.feedback.setActionStatus)('경계를 공유하는 하위단위가 있어야 경계를 조정할 수 있습니다.', 'error', 3400);
        return false;
      }
      if (!dependencies.domains.editingDomain?.setTool('country-border', { announce: false })) return false;
      dependencies.projectState.state.boundaryEditAutoSeedId = selectedIds ? null : text(source.id);
      dependencies.projectState.state.boundaryEditCountryIds = [source, ...siblings.filter(unit => !unit.properties.locked)].map(unit => text(unit.id)).filter(key => !selectedIds || selectedIds.includes(key));
      dependencies.projectState.state.boundaryEditSeedCountryId = text(source.id);
      dependencies.projectState.state.boundaryEditPhase = 'editing';
      (0, dependencies.geometryPreview.rebuildBoundaryTopology)(dependencies.projectState.state.boundaryEditCountryIds);
      (0, dependencies.taskUi.setModeBanner)('형제 사이 공유 경계 꼭짓점을 이동하세요. 상위 단위의 바깥 경계는 유지됩니다.');
      (0, dependencies.taskUi.updateModeButtons)();
      return true;
    }
    dependencies.domains.editingDomain?.setTool('redraw-territorial-unit', { announce: false });
    dependencies.projectState.state.territorialUnitRedrawSourceId = String(source.id);
    (0, dependencies.taskUi.setModeBanner)((0, dependencies.interactionPresentation.defaultDraftInstruction)());
    (0, dependencies.taskUi.updateModeButtons)();
    return true;
  }

  async function finishTerritorialUnitRedrawDraft() {
    const source = (0, dependencies.objectPresentation.territorialUnitById)(dependencies.projectState.state.territorialUnitRedrawSourceId);
    if (!source || source.properties.unitType !== 'region' || source.properties.locked) return false;
    const container = (0, dependencies.territoryGeometry.territorialUnitContainer)(source);
    if (!container) return false;
    const revision = dependencies.projectState.state.stateRevision;
    const coords = (0, dependencies.countryEditingA.editingDraftCoordinates)().map(coord => coord.slice());
    try {
      const drawn = { type: 'Polygon', coordinates: [(0, dependencies.applicationServicesB.orientRing)(coords, true)] };
      const siblings = (0, dependencies.territorialServicesB.territorialSiblings)(dependencies.projectState.state.territorialUnits, source);
      const response = await dependencies.spatialQuery.mapEditClient.execute('territorial-region-redraw', { payload: {
        targetId: source.id, containerId: container.id, siblingIds: siblings.map(sibling => sibling.id), draft: drawn,
      } });
      if (dependencies.projectState.state.stateRevision !== revision || text(dependencies.projectState.state.territorialUnitRedrawSourceId) !== text(source.id)
        || JSON.stringify((0, dependencies.countryEditingA.editingDraftCoordinates)()) !== JSON.stringify(coords)) return false;
      const next = response.result.feature, geometry = next.geometry;
      return (0, dependencies.geometryOperations.beginLocalGeometryPreview)({ operation: 'redraw-region', beforeFeatures: [source], afterFeatures: [next],
        commitHistorySnapshot: true,
        applyResult: () => {
          source.geometry = (0, dependencies.platform.deepClone)(geometry);
          dependencies.domains.editingDomain?.clearDraft?.(true);
          dependencies.domains.editingDomain?.setTool('select', { announce: false });
          (0, dependencies.layers.markLayerTreeDirty)();
          (0, dependencies.propertyEditingA.applyTerritorialUnitSelectionIntent)(source.id, true);
        },
      });
    } catch (error) {
      (0, dependencies.feedback.reportOperationError)(error, '지방 영역을 다시 지정하지 못했습니다.', 'PL-REGION-REDRAW-001', 4300);
      return false;
    }
  }

  async function finishTerritorialUnitDirectDraft() {
    const workflow = dependencies.projectState.state.territorySelectionSession;
    if (workflow?.stage === 'selection' && workflow.activePhase === 'drawing' && workflow.activeMethod === 'line') return finishTerritorialUnitCreateSplitDraft();
    const context = workflow?.sourceInfo?.context;
    if (!context) return;
    const typeLabel = (0, dependencies.territorialServicesB.territorialTypeLabel)(context.unitType);
    const revision = dependencies.projectState.state.stateRevision;
    const draftCoords = (0, dependencies.countryEditingA.editingDraftCoordinates)().map(coord => coord.slice());
    const draftKey = JSON.stringify(draftCoords);
    const epoch = ++workflow.computationEpoch;
    workflow.computationPending = true;
    workflow.workerRequests = (workflow.workerRequests || 0) + 1;
    (0, dependencies.taskUi.setModeBanner)('그린 영역을 계산하는 중입니다.');
    (0, dependencies.taskUi.updateModeButtons)();
    try {
      const response = await dependencies.spatialQuery.mapEditClient.execute('territorial-drawn', { payload: {
        draft: { type: 'Polygon', coordinates: [(0, dependencies.applicationServicesB.orientRing)(draftCoords, true)] },
        source: workflow.workingSourceGeometry,
      } });
      if (dependencies.projectState.state.territorySelectionSession !== workflow || workflow.computationEpoch !== epoch || workflow.activePhase !== 'drawing'
        || dependencies.projectState.state.stateRevision !== revision || JSON.stringify((0, dependencies.countryEditingA.editingDraftCoordinates)()) !== draftKey) return false;
      const geometry = response.result.geometry;
      workflow.computationPending = false;
      (0, dependencies.territorySelectionA.setTerritorySelectionCandidates)([{ geometry }], 0);
      (0, dependencies.taskUi.setModeBanner)('그린 영역을 확인하세요.');
      dependencies.domains.renderingDomain?.invalidateEditingOverlays?.('territorial-direct-part-finished');
      (0, dependencies.taskUi.updateModeButtons)();
      return true;
    } catch (error) {
      (0, dependencies.feedback.reportOperationError)(error, `${typeLabel}을 직접 지정하지 못했습니다.`, 'PL-REGION-DRAW-001', 4400);
      return false;
    } finally {
      workflow.workerRequests = Math.max(0, workflow.workerRequests - 1);
      if (dependencies.projectState.state.territorySelectionSession === workflow && workflow.computationEpoch === epoch) {
        workflow.computationPending = false;
        (0, dependencies.taskUi.updateModeButtons)();
      }
    }
  }

  function prepareTerritorialSelectionPreview(workflow, expectedKey) {
    if (!workflow || !['subunit', 'region'].includes(workflow.kind)) return false;
    const geometry = workflow.combinedGeometry;
    if (!geometry) return false;
    const context = workflow.sourceInfo?.context;
    if (!context) return false;
    const typeLabel = (0, dependencies.territorialServicesB.territorialTypeLabel)(context.unitType);
    const shouldKeepResult = () => (0, dependencies.territorySelectionB.territorySelectionPreviewIsCurrent)(workflow, expectedKey);
    if (workflow.kind === 'region') {
      const region = (0, dependencies.territorialServicesA.createTerritorialFeature)({
        id: workflow.generatedId,
        unitType: dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.REGION,
        name: workflow.name.trim(),
        parentId: '', sovereignId: '',
        coverageMode: dependencies.territorialModel.TERRITORIAL_COVERAGE_MODES.EXPLICIT,
        geometry: (0, dependencies.platform.deepClone)(geometry),
      });
      return (0, dependencies.geometryOperations.beginLocalGeometryPreview)({
        operation: 'territorial-create',
        afterFeatures: [region],
        transferredGeometry: geometry,
        shouldKeepResult,
        commitHistorySnapshot: true,
        applyResult: () => {
          dependencies.projectState.state.territorialUnits.push((0, dependencies.platform.deepClone)(region));
          dependencies.projectState.state.territorialUnits = (0, dependencies.territorialModel.normalizeTerritorialUnits)(dependencies.projectState.state.territorialUnits, {
            countryExists: id => !!(0, dependencies.countries.countryFeatureById)(id),
          });
          dependencies.projectState.state.layerVisibility.regions = true;
          delete dependencies.projectState.state.itemVisibility.regions?.[String(region.id)];
          dependencies.domains.editingDomain?.clearDraft?.({ reason: 'territorial-created', render: false });
          dependencies.domains.editingDomain?.setTool('select', { announce: false });
          (0, dependencies.layers.markLayerTreeDirty)();
          (0, dependencies.propertyEditingA.applyTerritorialUnitSelectionIntent)(region.id, true);
        },
        successMessage: `${typeLabel}을 만들었습니다.`,
        errorMessage: `${typeLabel}을 만들지 못했습니다.`,
      });
    }

    const sourceId = workflow.sourceInfo?.existingId || '';
    const sibling = (0, dependencies.territorialModel.createPartitionTerritorialFeature)({
      id: workflow.generatedId, unitType: context.unitType,
      sovereignId: context.sovereignId, parentId: context.parentId,
      name: workflow.name.trim(), geometry: (0, dependencies.platform.deepClone)(geometry),
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
