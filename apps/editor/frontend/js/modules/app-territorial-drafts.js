/** TerritorialDrafts: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
import { resolveSelectChoice } from "../../../../../shared/frontend/js/modules/select-option-policy.js";
import "../../../../../shared/frontend/js/modules/territorial-edit-plan.js";
import { subunitSelectionPolicy } from './territorial-interaction-policy.js';

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
    for (const buttonId of ['editEntityCoastBtn', 'reconcileEntityCoastBtn']) (0, dependencies.platform.$)(buttonId).disabled = true;
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
      (0, dependencies.platform.$)('editEntityCoastBtn').disabled = !result.coastal;
      (0, dependencies.platform.$)('reconcileEntityCoastBtn').disabled = !result.reconciliation;
    } catch (_) {
      // Controls remain disabled until reliable coast data is available.
    }
  }

  async function previewTerritorialEdit(request, { selectedId, shouldKeepResult = () => true } = {}) {
    const requestRevision = ++editRequestRevision;
    const revision = dependencies.projectState.state.stateRevision;
    const entryTool = dependencies.projectState.state.tool;
    const entrySelection = text(dependencies.projectState.state.selected?.id);
    const expectedEpoch=dependencies.domains.projectDomain.state().epoch;
    const countries = dependencies.territorialModel.entityRepository.list({ kind: 'general', parentId: '' });
    const units = dependencies.territorialModel.entityRepository.list({  }).filter(entity => entity.properties.entityKind === 'regional' || !!entity.properties.parentId);
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
      const changedCountries=result.features.filter(feature=>result.countryIds.includes(text(feature.id))).map(feature=>text(feature.id));
      const removed=new Set(result.removedIds.map(text));
      const replacements=new Map(result.ownershipChanges.filter(change=>change.replacementId).map(change=>[change.id,change.replacementId]));
      const operations=[{commandId:'territorial.patch',
        targets:[...new Set([...result.features.map(feature=>String(feature.id)),...result.removedIds.map(String)])].map(id=>({domain:'territorial',id})),
        payload:{features:result.features,removedIds:result.removedIds}}];
      for(const entry of dependencies.projectState.state.distributionEntries){
        if(!removed.has(text(entry.territorialUnitId))&&!replacements.has(text(entry.territorialUnitId)))continue;
        const value=replacements.has(text(entry.territorialUnitId)) ? {...entry,territorialUnitId:replacements.get(text(entry.territorialUnitId))}:null;
        operations.push({commandId:'content.edit',targets:[{domain:'distributionEntry',id:entry.id}],payload:{domain:'distributionEntry',id:entry.id,value,create:false}});
      }
      const newCountries=result.features.filter(feature=>result.countryIds.includes(text(feature.id))&&!dependencies.territorialModel.entityRepository.has(feature.id));
      for(const country of newCountries)for(const [field,value] of Object.entries(request.countryOverride || {}))operations.push(field==='color'
        ? {commandId:'territorial.color',targets:[{domain:'territorial',id:country.id}],payload:{ids:[country.id],color:value}}
        : {commandId:'territorial.metadata',targets:[{domain:'territorial',id:country.id}],payload:{id:country.id,field,valuePresent:true,value}});
      const prepared=await dependencies.domains.projectDomain.prepareCommand({commandId:'territorial.edit',targets:[],expectedEpoch,payload:{operation:request.operation,operations}});
      if(!prepared.ok)throw Object.assign(new Error(prepared.error.message),{code:prepared.error.code});
      if(!prepared.changed)return false;
      const partial = result.impacts.filter(impact => ['clip-child', 'remove-child'].includes(impact.kind));
      return (0, dependencies.geometryOperations.beginLocalGeometryPreview)({
        operation: `territorial-${request.operation}`,
        preparedCommand:prepared,
        beforeFeatures: [...countries, ...units].filter(feature => result.affectedIds.includes(text(feature.id))),
        afterFeatures: result.features,
        removedIds: result.removedIds,
        shouldKeepResult: current,
        preparedPreview: result.preview,
        validatePrepared: async () => {
          const checked = await dependencies.spatialQuery.mapEditClient.execute('territorial-validation', { payload: { preparationId: result.preparationId } });
          if (!checked.result.valid || !current() || !dependencies.spatialQuery.mapEditClient.sourcesCurrent(response.sourceRevision)) return false;
          if (request.operation === 'merge' && request.parentId) {
            const target = dependencies.territorialModel.entityRepository.get(request.targetId);
            if (target?.properties?.entityKind !== 'general' || target.properties.parentId !== request.parentId) return false;
            const ids = [String(request.targetId), ...new Set((request.sourceIds || []).map(String).filter(id => id !== String(request.targetId)))];
            return subunitSelectionPolicy(ids.map(id => dependencies.territorialModel.entityRepository.get(id))).valid;
          }
          return true;
        },
        beforeApply: () => partial.length || result.ownershipChanges.length ? new Promise(resolve => {
          (0, dependencies.projectRestore.openConfirmModal)({
            title: '하위단위 영향 확인',
            message: '아래 소속 변경과 절단을 함께 반영합니다. 반영하지 않으면 경계를 다시 편집할 수 있습니다.',
            impacts: result.ownershipChanges.map(change => (units.find(unit => text(unit.id) === change.id)?.properties.name || change.id) + ': ' + (change.replacementId ? '합병 후 참조 이전' : '상위 단위 ' + change.to)).concat(partial.map(impact => `${impact.name}: ${impact.kind === 'remove-child' ? '객체와 참조 삭제' : '일부 영역 절단 · ' + (0, dependencies.applicationServicesB.sphericalGeometryAreaKm2)(impact.geometry).toFixed(3) + ' km²'}`)),
            confirmText: '반영', cancelText: '반영 안 함',
            onConfirm: () => resolve(true), onCancel: async () => {
              if (dependencies.projectState.state.territorySelectionSession?.stage === 'review') await dependencies.territorySelectionB.territorySelectionBack();
              (0, dependencies.taskUi.setModeBanner)('변경을 반영하지 않았습니다. 경계를 다시 편집하세요.');
              resolve(false);
            },
          });
        }) : true,
        applyAccepted:async()=>{
          if(changedCountries.length){
            dependencies.spatialQuery.markCountryGeometriesChanged(changedCountries);dependencies.countryValidation.refreshCountryCentroids(changedCountries);
            dependencies.projectState.state.boundaryPreparation?.cancel();dependencies.projectState.state.boundaryPreparation=null;
          }
          await dependencies.domains.editingDomain.clearDraft({reason:'territorial-edit-applied',render:false});
          await dependencies.domains.editingDomain.setTool('select',{announce:false});dependencies.objectDisplay.invalidateObjectPresentation();
          await dependencies.domains.selectionUiController.applyIntent({domain:'territorial',type:'entity',id:String(selectedId)},{refreshOnly:true,openEditor:false});
        },
        invalidateAfterApply: () => {
          if (changedCountries.length) dependencies.domains.renderingDomain?.invalidateCountryPatch?.('territorial-edit-applied');
          dependencies.domains.renderingDomain?.invalidateTerritorialPatch?.('territorial-edit-applied');
        },
        successMessage: '객체와 관련 관계 변경을 함께 적용했습니다.',
        errorMessage: '영역 변경을 적용하지 못해 전체 변경을 되돌렸습니다.',
      });
    } catch (error) {
      if (current()) {
        const message = (0, dependencies.feedback.reportOperationError)(error, '영역 변경을 계산하지 못했습니다.', 'PL-TERRITORIAL-EDIT', 4400);
        (0, dependencies.taskUi.setModeBanner)(message, { feedback: true });
      }
      return false;
    }
  }

  function parentFeatureForSession(session) {
    if (!session || session.kind !== 'entity' || !session.parentId) return null;
    const parent = dependencies.territorialModel.entityRepository.get(session.parentId);
    return parent?.properties?.entityKind === 'general' ? parent : null;
  }

  function directSubunitChildren(session) {
    return dependencies.territorialModel.entityRepository.children(session.parentId, { kind: 'general' });
  }

  function unassignedSourceForSession(session) {
    const cacheKey = `${text(session.parentId)}:${Number(dependencies.projectState.state.stateRevision || 0)}`;
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
        feature: (0, dependencies.territorialServicesA.createTerritorialFeature)({
          id: 'territory-selection-source:' + session.id, entityKind: 'general',
          parentId: session.parentId, geometry,
          coverageMode: dependencies.territorialModel.TERRITORIAL_COVERAGE_MODES.PARTITION,
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
    if (!session || session.kind !== 'entity' || !session.parentId) return [];
    const choices = [{ value: '', label: '기준 영역 선택', placeholder: true }];
    if (unassignedSourceForSession(session)) {
      const parent = parentFeatureForSession(session);
      const parentName = (0, dependencies.objectPresentation.territorialEntityName)(parent);
      choices.push({ value: 'unassigned', label: `${parentName} 직할 영역` });
    }
    for (const feature of directSubunitChildren(session).filter(feature => text(feature.id) !== session.editTargetId)) {
      choices.push({ value: text(feature.id), label: (0, dependencies.objectPresentation.territorialEntityName)(feature) });
    }
    return choices;
  }

  function resolveTerritorialCreateSource(session = dependencies.projectState.state.territorySelectionSession) {
    if (!session || session.kind !== 'entity' || !session.parentId) return null;
    if (session.sourceKey === 'unassigned') return unassignedSourceForSession(session);
    const feature = dependencies.territorialModel.entityRepository.get(session.sourceKey);
    if (!feature?.geometry || !(feature.properties?.entityKind === 'general' && !!feature.properties?.parentId)
      || text(feature.properties?.parentId) !== text(session.parentId)) return null;
    return { feature, existingId: text(feature.id), virtual: false };
  }

  function territorialCreateSetupModel() {
    const session = dependencies.projectState.state.territorySelectionSession;
    if (session?.kind !== 'entity') return null;
    const parentOptions = [{ value: '', label: '상위 객체 없음' }, ...dependencies.territorialModel.entityRepository.list({ kind: 'general' })
      .map(feature => ({ value: text(feature.id), label: dependencies.objectPresentation.territorialEntityName(feature) }))];
    const sourceOptions = territorialCreateSourceChoices(session);
    const sourceChoice = resolveSelectChoice(sourceOptions, session.sourceKey, { autoSelectSingle: !session.setupSourceCache?.pending });
    if (sourceChoice.single) session.sourceKey = sourceChoice.value;
    return { session, parentOptions, sourceOptions, choiceStates: { source: sourceChoice } };
  }

  function territorialCreateSetupValid(session = dependencies.projectState.state.territorySelectionSession) {
    if (!session?.name.trim()) return false;
    if (session.entityKind === 'regional') return true;
    const parent = parentFeatureForSession(session), source = resolveTerritorialCreateSource(session);
    return !!(parent && source && source.feature?.properties?.locked !== true && !parent.properties.locked);
  }

  async function enterTerritorialCreateWorkflow({ parentId = '' } = {}) {
    const parent = parentId ? dependencies.territorialModel.entityRepository.get(parentId) : null;
    if (parentId && (parent?.properties.entityKind !== 'general' || parent.properties.locked)) return false;
    const session = await dependencies.territorySelectionA.startTerritorySelection('entity', {
      tool: 'draw-territorial-unit', entityKind: 'general', name: '새 객체',
      parentId: text(parentId),
      sourceKey: parent ? 'unassigned' : '', sourceCountryIds: [],
    });
    if (!session) return false;
    territorialCreateSetupModel();
    dependencies.taskUi.setModeBanner('');
    dependencies.taskUi.updateModeButtons();
    requestAnimationFrame(() => dependencies.platform.$('territorialCreateNameInput').select());
    return true;
  }

  async function updateTerritorialCreateKind(regional) {
    const session = dependencies.projectState.state.territorySelectionSession;
    if (session?.kind !== 'entity' || session.editOperation) return false;
    const next = regional ? 'regional' : 'general';
    if (session.entityKind === next) return false;
    session.entityKind = next;
    session.parentId = ''; session.sourceKey = ''; session.sourceCountryIds = [];
    session.setupSourceCache = null; session.settingsRevision += 1;
    await dependencies.territorySelectionA.resetTerritorySelection(session, { keepRequestedMethod: false });
    dependencies.taskUi.updateModeButtons();
    return true;
  }

  function enterTerritorialUnitCoastMode(id) {
    const unit = dependencies.territorialModel.entityRepository.get(id);
    if (!unit || unit.properties?.locked) return false;
    return (0, dependencies.countryEditingA.enterCountryCoastEdit)((0, dependencies.territorialModel.territorialRootId)(unit, id => dependencies.territorialModel.entityRepository.get(id)), {
      returnSelection: { domain: 'territorial', type: 'entity', id: text(id) },
    });
  }

  async function enterTerritorialUnitAnnexMode(id) {
    const target = dependencies.territorialModel.entityRepository.get(id);
    if (!target || target.properties.locked || !await enterTerritorialCreateWorkflow({ parentId: target.properties.parentId })) return false;
    const session = dependencies.projectState.state.territorySelectionSession;
    session.editOperation = 'annex'; session.editTargetId = text(id);
    session.name = target.properties.name || '객체';
    session.taskLabel = '영역 편입';
    session.parentId = text(target.properties.parentId);
    session.setupSourceCache = null;
    territorialCreateSetupModel();
    (0, dependencies.taskUi.updateModeButtons)();
    return true;
  }

  async function updateTerritorialCreateParent(value) {
    const session = dependencies.projectState.state.territorySelectionSession;
    if (!session || session.editOperation || text(value) === text(session.parentId)) return;
    if (session.entityKind === 'regional') return;
    const parent = value ? dependencies.territorialModel.entityRepository.get(value) : null;
    if (value && parent?.properties.entityKind !== 'general') return;
    session.parentId = text(value);
    session.sourceCountryIds = [];
    session.sourceKey = 'unassigned';
    session.setupSourceCache = null;
    session.settingsRevision += 1;
    await dependencies.territorySelectionA.resetTerritorySelection(session, { keepRequestedMethod: false });
    territorialCreateSetupModel();
    (0, dependencies.taskUi.updateModeButtons)();
  }

  async function updateTerritorialCreateSource(value) {
    const session = dependencies.projectState.state.territorySelectionSession;
    if (!session || text(value) === text(session.sourceKey)) return;
    session.sourceKey = text(value);
    session.settingsRevision += 1;
    (0, dependencies.territorySelectionA.resetTerritorySelection)(session, { keepRequestedMethod: false });
    (0, dependencies.taskUi.updateModeButtons)();
  }

  function createTerritorialSourceFeature(session) {
    if (session.entityKind === 'general' && !!session.parentId) return resolveTerritorialCreateSource(session);
    if (session.activeMethod === 'polygon') return null;
    const features = session.sourceCountryIds
      .map(id => dependencies.territorialModel.entityRepository.get(id))
      .filter(feature => (feature?.properties?.entityKind === 'general' && !feature?.properties?.parentId) && feature.geometry);
    if (!features.length) return null;
    const geometry = { type: 'MultiPolygon', coordinates: features.flatMap(feature => dependencies.territoryGeometry.geometryMultiCoordinates(feature.geometry)) };
    return {
      feature: { type: 'Feature', id: 'territorial-create-source', properties: { name: '기준 영역' }, geometry },
      existingId: '', virtual: true, features,
    };
  }

  function prepareTerritorialCreateSelection(session) {
    if (!session?.activeMethod || !['line', 'polygon', 'components'].includes(session.activeMethod)
      || (session.entityKind === 'regional'
        && session.activeMethod !== 'polygon' && !session.sourceCountryIds.length)) return false;
    const sourceInfo = createTerritorialSourceFeature(session);
    if (session.activeMethod !== 'polygon' && !sourceInfo?.feature?.geometry) return false;
    const context = {
      entityKind: session.entityKind === 'regional' ? 'regional' : 'general',
      parentId: session.entityKind === 'general' && !!session.parentId ? session.parentId : '',
    };
    const fingerprint = JSON.stringify([session.kind, session.parentId, session.sourceKey, [...session.sourceCountryIds].sort()]);
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

  async function enterTerritorialUnitSplitMode(id) {
    const source = dependencies.territorialModel.entityRepository.get(id);
    if (!source || !enterTerritorialCreateWorkflow({ parentId: source.properties.parentId })) return false;
    const session = dependencies.projectState.state.territorySelectionSession;
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

  async function finishTerritorialUnitCreateSplitDraft() {
    const session = dependencies.projectState.state.territorySelectionSession;
    const source = session?.sourceInfo?.source;
    if (session?.kind !== 'entity' || !session.workingSourceGeometry || !source?.geometry) return false;
    try {
      const split = (0, dependencies.cutOperations.buildCutSplitCandidates)(session.workingSourceGeometry, (0, dependencies.countryEditingA.editingDraftCoordinates)());
      await dependencies.territorySelectionA.setTerritorySelectionCandidates(split.candidates);
      (0, dependencies.taskUi.setModeBanner)('나눌 영역을 확인하세요.');
      dependencies.domains.renderingDomain?.invalidateEditingOverlays?.('territorial-create-split-part-finished');
      (0, dependencies.taskUi.updateModeButtons)();
      return true;
    } catch (error) {
      (0, dependencies.feedback.reportOperationError)(error, '영역을 나누지 못했습니다. 표시된 문제 지점을 확인하고 선을 수정하세요.', 'PL-REGION-SPLIT-001', 4400);
      return false;
    }
  }

  function territorialUnitsAreAdjacent(left, right) {
    return globalThis.PandoLabTerritorialEdit.createKernel(window.polygonClipping).adjacent(left.geometry, right.geometry);
  }

  function enterTerritorialUnitMergeMode(id) {
    const source = dependencies.territorialModel.entityRepository.get(id);
    if (!source) return false;
    dependencies.domains.editingDomain?.setTool('merge-territorial-unit', { announce: false });
    dependencies.projectState.state.territorialUnitMergeSourceId = String(source.id);
    dependencies.projectState.state.territorialUnitMergeTargetIds = [];
    (0, dependencies.taskUi.setModeBanner)('합칠 인접 영역을 선택하세요.');
    (0, dependencies.taskUi.updateModeButtons)();
    dependencies.domains.renderingDomain?.invalidateTerritorialPatch('view-frame-app-territorial-drafts');
    return true;
  }

  function toggleTerritorialUnitMergeTarget(id) {
    if (dependencies.projectState.state.tool !== 'merge-territorial-unit') return;
    const source = dependencies.territorialModel.entityRepository.get(dependencies.projectState.state.territorialUnitMergeSourceId);
    const target = dependencies.territorialModel.entityRepository.get(id);
    if (!source || !target || String(source.id) === String(target.id)) return;
    if (!dependencies.territorialModel.entityRepository.siblings(source.id)
      .some(candidate => String(candidate.id) === String(target.id))) {
      (0, dependencies.feedback.setActionStatus)('같은 소속 국가·상위 단위의 하위단위만 합칠 수 있습니다.', 'error', 3400);
      return;
    }
    const selected = [source, ...dependencies.projectState.state.territorialUnitMergeTargetIds
      .map(targetId => dependencies.territorialModel.entityRepository.get(targetId)).filter(Boolean)];
    if (!selected.some(item => text(item.id) === text(target.id) || territorialUnitsAreAdjacent(item, target))) {
      (0, dependencies.feedback.setActionStatus)('경계를 공유하는 인접 영역만 합칠 수 있습니다.', 'error', 3400);
      return;
    }
    const targets = new Set(dependencies.projectState.state.territorialUnitMergeTargetIds.map(String));
    if (targets.has(String(id))) targets.delete(String(id)); else targets.add(String(id));
    const before = [...dependencies.projectState.state.territorialUnitMergeTargetIds];
    dependencies.projectState.state.territorialUnitMergeTargetIds = [...targets];
    const after = [...dependencies.projectState.state.territorialUnitMergeTargetIds];
    dependencies.domains.editingDomain.recordSelectionChange({
      undo: () => { dependencies.projectState.state.territorialUnitMergeTargetIds = [...before]; },
      redo: () => { dependencies.projectState.state.territorialUnitMergeTargetIds = [...after]; },
    });
    (0, dependencies.taskUi.setModeBanner)('합칠 인접 영역을 선택하세요.');
    dependencies.domains.renderingDomain?.invalidateTerritorialPatch('view-frame-app-territorial-drafts');
    (0, dependencies.taskUi.updateModeButtons)();
  }

  function completeTerritorialUnitMerge() {
    const source = dependencies.territorialModel.entityRepository.get(dependencies.projectState.state.territorialUnitMergeSourceId);
    if (!source || !dependencies.projectState.state.territorialUnitMergeTargetIds.length) return false;
    const tool = dependencies.projectState.state.tool;
    return previewTerritorialEdit({ operation: 'merge', targetId: source.id,
      parentId: source.properties.parentId, sourceIds: dependencies.projectState.state.territorialUnitMergeTargetIds,
    }, { selectedId: source.id, shouldKeepResult: () => dependencies.projectState.state.tool === tool && text(dependencies.projectState.state.territorialUnitMergeSourceId) === text(source.id) });
  }

  function enterTerritorialUnitRedrawMode(id, selectedIds = null) {
    const source = dependencies.territorialModel.entityRepository.get(id);
    if (!source) return false;
    if ((source.properties.entityKind === 'general' && !!source.properties.parentId)) {
      const siblings = dependencies.territorialModel.entityRepository.siblings(source.id);
      if (source.properties.locked || !siblings.length) {
        (0, dependencies.feedback.setActionStatus)('경계를 공유하는 하위단위가 있어야 경계를 조정할 수 있습니다.', 'error', 3400);
        return false;
      }
      if (!dependencies.domains.editingDomain?.setTool('territorial-border', { announce: false })) return false;
      dependencies.projectState.state.boundaryEditAutoSeedId = selectedIds ? null : text(source.id);
      dependencies.projectState.state.boundaryEditEntityIds = [source, ...siblings.filter(unit => !unit.properties.locked)].map(unit => text(unit.id)).filter(key => !selectedIds || selectedIds.includes(key));
      dependencies.projectState.state.boundaryEditSeedEntityId = text(source.id);
      dependencies.projectState.state.boundaryEditPhase = 'editing';
      (0, dependencies.geometryPreview.rebuildBoundaryTopology)(dependencies.projectState.state.boundaryEditEntityIds);
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
    const source = dependencies.territorialModel.entityRepository.get(dependencies.projectState.state.territorialUnitRedrawSourceId);
    if (!source || !(source.properties.entityKind === 'regional') || source.properties.locked) return false;
    const revision = dependencies.projectState.state.stateRevision;
    const expectedEpoch=dependencies.domains.projectDomain.state().epoch;
    const coords = (0, dependencies.countryEditingA.editingDraftCoordinates)().map(coord => coord.slice());
    try {
      const drawn = { type: 'Polygon', coordinates: [(0, dependencies.applicationServicesB.orientRing)(coords, true)] };
      const response = await dependencies.spatialQuery.mapEditClient.execute('territorial-region-redraw', { payload: {
        targetId: source.id, draft: drawn,
      } });
      if (dependencies.projectState.state.stateRevision !== revision || text(dependencies.projectState.state.territorialUnitRedrawSourceId) !== text(source.id)
        || JSON.stringify((0, dependencies.countryEditingA.editingDraftCoordinates)()) !== JSON.stringify(coords)) return false;
      const next=response.result.feature;
      const prepared=await dependencies.domains.projectDomain.prepareCommand({commandId:'territorial.redraw-region',targets:[],expectedEpoch,
        payload:{operations:[{commandId:'territorial.patch',targets:[{domain:'territorial',id:String(next.id)}],payload:{features:[next],removedIds:[]}}]}});
      if(!prepared.ok)throw Object.assign(new Error(prepared.error.message),{code:prepared.error.code});if(!prepared.changed)return false;
      return dependencies.geometryOperations.beginLocalGeometryPreview({operation:'redraw-region',preparedCommand:prepared,
        applyAccepted:async()=>{
          await dependencies.domains.editingDomain.clearDraft({reason:'region-redrawn',render:false});await dependencies.domains.editingDomain.setTool('select',{announce:false});
          dependencies.objectDisplay.invalidateObjectPresentation();await dependencies.domains.selectionUiController.applyIntent({domain:'territorial',type:'entity',id:String(source.id)},{refreshOnly:true,openEditor:false});
        },
        invalidateAfterApply: () => dependencies.domains.renderingDomain?.invalidateTerritorialPatch?.('region-redraw-applied'),
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
    const typeLabel = '객체';
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
      await dependencies.territorySelectionA.setTerritorySelectionCandidates([{ geometry }]);
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

  async function prepareTerritorialSelectionPreview(workflow, expectedKey) {
    if (!workflow || workflow.kind !== 'entity') return false;
    const geometry = workflow.combinedGeometry;
    if (!geometry) return false;
    const context = workflow.sourceInfo?.context;
    if (!context) return false;
    const typeLabel = '객체';
    const shouldKeepResult = () => (0, dependencies.territorySelectionB.territorySelectionPreviewIsCurrent)(workflow, expectedKey);
    if (workflow.entityKind === 'regional') {
      const region = (0, dependencies.territorialServicesA.createTerritorialFeature)({
        id: workflow.generatedId,
        entityKind: 'regional',
        name: workflow.name.trim(),
        parentId: '',
        coverageMode: dependencies.territorialModel.TERRITORIAL_COVERAGE_MODES.EXPLICIT,
        geometry: (0, dependencies.platform.deepClone)(geometry),
      });
      const prepared=await dependencies.domains.projectDomain.prepareCommand({commandId:'territorial.create-region',targets:[],expectedEpoch:dependencies.domains.projectDomain.state().epoch,
        payload:{operations:[{commandId:'territorial.create',targets:[{domain:'territorial',id:String(region.id)}],payload:{feature:region}}]}});
      if(!prepared.ok)throw Object.assign(new Error(prepared.error.message),{code:prepared.error.code});if(!prepared.changed)return false;
      return dependencies.geometryOperations.beginLocalGeometryPreview({operation:'territorial-create',preparedCommand:prepared,transferredGeometry:geometry,shouldKeepResult,
        applyAccepted:async()=>{
          await dependencies.domains.editingDomain.clearDraft({reason:'territorial-created',render:false});await dependencies.domains.editingDomain.setTool('select',{announce:false});
          dependencies.objectDisplay.invalidateObjectPresentation();await dependencies.domains.selectionUiController.applyIntent({domain:'territorial',type:'entity',id:String(region.id)},{refreshOnly:true,openEditor:false});
        },
        invalidateAfterApply: () => dependencies.domains.renderingDomain?.invalidateTerritorialPatch?.('territorial-region-created'),
        successMessage: `${typeLabel}을 만들었습니다.`,
        errorMessage: `${typeLabel}을 만들지 못했습니다.`,
      });
    }

    const sourceId = workflow.sourceInfo?.existingId || '';
    const parent = dependencies.territorialModel.entityRepository.get(context.parentId);
    if (!parent || !Object.hasOwn(parent.properties, 'validFrom') || !Object.hasOwn(parent.properties, 'validTo')) {
      throw new Error(`The active territorial parent is unavailable: ${context.parentId}`);
    }
    const sibling = (0, dependencies.territorialServicesA.createTerritorialFeature)({
      id: workflow.generatedId, entityKind: context.entityKind,
      parentId: context.parentId,
      coverageMode: dependencies.territorialModel.TERRITORIAL_COVERAGE_MODES.PARTITION,
      name: workflow.name.trim(), geometry: (0, dependencies.platform.deepClone)(geometry),
    });
    return previewTerritorialEdit({
      operation: workflow.editOperation || 'create', targetId: workflow.editTargetId || context.parentId,
      parentId: context.parentId, sourceId, draft: geometry, newFeature: sibling,
    }, { selectedId: workflow.editTargetId || sibling.id, shouldKeepResult });
  }

  function runEntityEditAction(action, id) {
    const feature = dependencies.territorialModel.entityRepository.get(id);
    if (!feature || feature.properties.locked) return false;
    const root = feature.properties.entityKind === 'general' && !feature.properties.parentId;
    if (root) {
      const state = dependencies.projectState.state;
      if (action === 'annex') return state.tool === 'annex-territory' && state.territorySelectionSession?.targetCountryId === id
        ? dependencies.taskPresentation.cancelCurrentEditing() : dependencies.countryEditingA.enterAnnexTerritoryMode(id);
      if (action === 'merge') return dependencies.countryEditingA.enterMergeCountryMode(id);
      if (action === 'boundary') return state.tool === 'territorial-border' && state.boundaryEditPhase === 'editing'
        ? dependencies.taskPresentation.cancelCurrentEditing() : dependencies.countryEditingA.enterCountryBorderSelection(id);
      if (action === 'coast') return state.tool === 'country-coast' && state.coastEditCountryId === id
        ? dependencies.taskPresentation.cancelCurrentEditing() : dependencies.countryEditingA.enterCountryCoastEdit(id);
    }
    if (action === 'merge') return enterTerritorialUnitMergeMode(id);
    if (action === 'redraw' || action === 'boundary') return enterTerritorialUnitRedrawMode(id);
    if (feature.properties.entityKind !== 'general') return false;
    if (action === 'annex') return enterTerritorialUnitAnnexMode(id);
    if (action === 'coast') return enterTerritorialUnitCoastMode(id);
    return false;
  }

  return Object.freeze({
    connect, runEntityEditAction,
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
    get updateTerritorialCreateKind() { return updateTerritorialCreateKind; },
  });
}
