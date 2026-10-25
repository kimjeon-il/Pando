import { adoptBoundaryRenderPacketAsync } from './editing-render-packet.js';
import {getRuntimePerformanceMetrics,PERFORMANCE_METRIC_NAMES} from "../../../../../shared/frontend/js/modules/runtime-performance-metrics.js";
const metricNow=()=>typeof performance==='undefined'?Date.now():performance.now();
/** GeometryPreview: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createGeometryPreview() {
  let dependencies;
  let editPreviewController;
  let editPipelineMetrics;
  let boundarySelectionAnalysisCache;
  let boundarySelectionAnalysisMetrics;
  let activeGeometryPreviewApply;
  let activeApplication = null;
  let activeGeometryPreviewDiscard;
  let localPreparationEpoch = 0;
  let localPreparationPending = false;
  function connect(ports) {
    if (dependencies) throw new Error('geometry-preview already connected');
    dependencies = ports;
  }

  function rejectedOutcome(outcome) {
    if(outcome?.ok)return outcome;
    throw Object.assign(new Error(outcome?.error?.message || 'Core rejected the geometry command.'),{ code: outcome?.error?.code || 'PL-PREVIEW-COMMAND' });
  }

  async function transactMapEdit({ operation,payload,prepareResult,applyAccepted,onSuccess,onError }) {
    const expectedEpoch=dependencies.domains.projectDomain.state().epoch;
    const startedAt=metricNow(),stageDurations={};
    let requestId=0,prepared,stage='prepare-geometry',stageStartedAt=startedAt,result='failed',failure;
    const enterStage=next=>{stageDurations[stage]=Math.max(0,metricNow()-stageStartedAt);stage=next;stageStartedAt=metricNow();};
    try {
      if(typeof prepareResult!=='function')throw new TypeError('A typed Core geometry command preparer is required.');
      const response=await dependencies.spatialQuery.mapEditClient.execute(operation,payload);requestId=response.requestId;
      enterStage('prepare-core');
      prepared=rejectedOutcome(await prepareResult(response.result,{ expectedEpoch }));
      if(!prepared.changed){dependencies.spatialQuery.mapEditClient.discard(requestId);result='unchanged';return false;}
      enterStage('confirm-core');
      const outcome=rejectedOutcome(await dependencies.domains.projectDomain.confirmCandidate(prepared.candidateId,prepared.state.epoch,{ applyAccepted: async result => {
        const effectStartedAt=metricNow();
        if(applyAccepted)await applyAccepted(result,response.result);
        stageDurations['apply-platform']=Math.max(0,metricNow()-effectStartedAt);
        const commitStartedAt=metricNow();
        dependencies.spatialQuery.mapEditClient.commit(requestId,response.geometryRevision);
        stageDurations['commit-external']=Math.max(0,metricNow()-commitStartedAt);
      } }));
      enterStage('success');
      stageDurations['confirm-core']=Math.max(0,stageDurations['confirm-core']-(stageDurations['apply-platform']||0)-(stageDurations['commit-external']||0));
      result=outcome.changed?'success':'unchanged';
      if(outcome.changed)try {await onSuccess(response.result);} catch(error) {
        result='success-with-warning';failure=error;
        dependencies.feedback.reportOperationError(error,'변경을 적용했지만 완료 표시를 갱신하지 못했습니다.','PL-PREVIEW-NOTIFY',4200);
      }
      return outcome.changed;
    } catch(error) {
      failure=error;result=error.cancelled||error.name==='AbortError'?'cancelled':'failed';enterStage('cleanup');
      if(prepared?.candidateId)await dependencies.domains.projectDomain.cancelCandidate(prepared.candidateId).catch(cleanupError => {error.cleanupError=cleanupError;});
      if(requestId)dependencies.spatialQuery.mapEditClient.discard(requestId);
      dependencies.spatialQuery.mapEditClient.rebase();
      await onError(error);return false;
    } finally {
      stageDurations[stage]=Math.max(0,metricNow()-stageStartedAt);
      try {getRuntimePerformanceMetrics()?.record(PERFORMANCE_METRIC_NAMES.TRANSACTION,Math.max(0,metricNow()-startedAt),{
        operationType:operation,result,finalStage:stage,stages:stageDurations,errorCode:String(failure?.code || ''),
      });}catch(_){/* Telemetry cannot change the settled Core operation. */}
    }
  }

  function geometryPolygonSets(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return [geometry.coordinates || []];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates || [];
    return [];
  }

  function coordKey(coord, precision = 7) {
    return `${Number(coord?.[0] || 0).toFixed(precision)},${Number(coord?.[1] || 0).toFixed(precision)}`;
  }

  function coordNear(a, b, tolerance = 0.00008) {
    if (!a || !b) return false;
    let dx = Math.abs(a[0] - b[0]);
    dx = Math.min(dx, Math.abs(dx - 360));
    return dx <= tolerance && Math.abs(a[1] - b[1]) <= tolerance;
  }

  let boundaryEpoch = 0;
  let identitySequence = 0;
  const geometryIdentities = new WeakMap();
  function boundaryRevision() {
    const identity = geometry => {
      if (!geometry) return 0;
      if (!geometryIdentities.has(geometry)) geometryIdentities.set(geometry, ++identitySequence);
      return geometryIdentities.get(geometry);
    };
    return JSON.stringify([dependencies.domains.projectDomain?.getGeneration?.(),
      [...(dependencies.territorialModel.entityRepository.list({ kind: 'general', parentId: '' })), ...dependencies.territorialModel.entityRepository.list({  }).filter(entity => entity.properties.entityKind === 'regional' || !!entity.properties.parentId)].map(feature => [
        String(feature.id), identity(feature.geometry), feature.properties?.parentId, (0, dependencies.territorialModel.territorialRootId)(feature, id => dependencies.territorialModel.entityRepository.get(id)),
        !!feature.properties?.locked,
      ])]);
  }

  function rebuildBoundaryTopology(targetCountryIds = dependencies.projectState.state.coastEditCountryId) {
    const state = dependencies.projectState.state;
    const targetIds = [...new Set((Array.isArray(targetCountryIds) ? targetCountryIds : [targetCountryIds]).filter(id => id != null).map(String))].sort();
    if (!['territorial-border', 'country-coast'].includes(state.tool) || !targetIds.length) return Promise.resolve(false);
    const tool = state.tool;
    const mode = tool === 'country-coast' ? 'coast' : 'border';
    const neighborsOnly = mode === 'border' && state.boundaryEditPhase === 'selecting';
    const scopeId = state.coastEditScopeGenericFeatureId;
    const selectionKey = JSON.stringify(targetIds);
    const revision = boundaryRevision();
    const key = JSON.stringify([mode, targetIds, neighborsOnly, state.boundaryEditAutoSeedId, state.coastEditScopeGenericFeatureId, revision]);
    const previous = state.boundaryPreparation;
    if (previous?.key === key && ['pending', 'ready'].includes(previous.status)) return previous.promise;
    previous?.cancel();
    const epoch = ++boundaryEpoch;
    const controller = new AbortController();
    const current = () => state.boundaryPreparation === preparation && epoch === boundaryEpoch
      && tool === state.tool && revision === boundaryRevision() && !controller.signal.aborted
      && scopeId === state.coastEditScopeGenericFeatureId
      && neighborsOnly === (mode === 'border' && state.boundaryEditPhase === 'selecting')
      && selectionKey === JSON.stringify((mode === 'coast' ? [String(state.coastEditCountryId)] : [...state.boundaryEditEntityIds].map(String)).sort());
    const stale = () => {
      if (state.boundaryPreparation === preparation && tool === state.tool && !controller.signal.aborted) {
        preparation.status = 'error';
        preparation.message = '준비 중 형상이나 소속·잠금이 바뀌었습니다. 다시 시도하세요.';
        refresh();
      }
      return false;
    };
    const refresh = () => {
      dependencies.domains.editingDomain?.refreshTerritorySelection?.({ tool, reason: 'boundary-preparation' });
      dependencies.domains.renderingDomain?.invalidateGpuInteraction?.('boundary-preparation');
      dependencies.taskUi.updateModeButtons();
    };
    const preparation = {
      key, status: 'pending', workerPending: true, result: null, nodes: new Map(), revision,
      cancel() {
        if (controller.signal.aborted) return;
        controller.abort();
        if (preparation.workerPending || preparation.status === 'moving') dependencies.spatialQuery.mapEditClient.stop();
      },
      retry() { void rebuildBoundaryTopology(targetIds); },
      current,
    };
    state.boundaryPreparation = preparation;
    const preparationStartedAt = metricNow();
    let roundTripMs = 0, adoptionMs = 0, preparedTiming = null, handleCount = 0, segmentCount = 0;
    preparation.promise = dependencies.spatialQuery.mapEditClient.execute('boundary-prepare', { payload: {
      targetIds, mode, neighborsOnly, autoSeedId: state.boundaryEditAutoSeedId, projectGeneration: dependencies.domains.projectDomain?.getGeneration?.(), revision,
    } }, { signal: controller.signal, jobKey: 'boundary-prepare' }).then(async ({ result }) => {
      roundTripMs = metricNow() - preparationStartedAt;
      preparedTiming = result.preparationTiming || null;
      handleCount = result.handles?.length || 0;
      segmentCount = result.segments?.length || 0;
      preparation.workerPending = false;
      if (!current()) return stale();
      const scope = state.coastEditScopeGenericFeatureId
        ? state.genericFeatures.find(feature => String(feature.id) === String(state.coastEditScopeGenericFeatureId)) : null;
      if (scope) for (const handle of result.handles) if (!dependencies.territoryGeometry.pointInGenericFeature(handle.coordinate, dependencies.presentation.genericFeatureDisplayFeature(scope))) handle.fixed = true;
      let lastYield = performance.now();
      const checkpoint = async () => {
        if (performance.now() - lastYield >= 8) { await new Promise(resolve => setTimeout(resolve, 0)); lastYield = performance.now(); }
        if (!current()) throw Object.assign(new Error('준비가 취소되었습니다.'), { cancelled: true });
      };
      const nodes = { get: key => result.handles[result.displayIndex?.nodeKeys?.[key]] };
      const adoptionStartedAt = metricNow();
      const packet = await adoptBoundaryRenderPacketAsync(result, checkpoint);
      adoptionMs = metricNow() - adoptionStartedAt;
      if (!current()) return stale();
      preparation.result = result;
      preparation.nodes = nodes;
      preparation.packet = packet;
      preparation.status = 'ready';
      if (neighborsOnly && dependencies.taskUi.setModeBanner) dependencies.taskUi.setModeBanner(result.valid
        ? `${result.selectedIds.length}개 국가 선택됨 · 완료하면 공유국경을 편집합니다.`
        : result.selectedIds.length < 2 ? '접경국을 하나 이상 더 선택하세요.' : '선택 국가 사이에 연결된 공유국경이 없습니다.');
      if (!neighborsOnly && !result.valid) {
        preparation.status = 'error';
        preparation.message = '편집 가능한 경계가 없습니다. 대상을 다시 선택하세요.';
      }
      refresh();
      return result;
    }).catch(error => {
      preparation.workerPending = false;
      if (!current()) return stale();
      preparation.status = 'error';
      preparation.message = error.message || '경계 준비에 실패했습니다. 다시 시도하세요.';
      refresh();
      return false;
    }).finally(() => {
      // Measurements describe preparation only: never claim that Worker
      // compute time includes the structured-clone transport or UI adoption.
      try {
        getRuntimePerformanceMetrics()?.record('edit.boundary.prepare', metricNow() - preparationStartedAt, {
          mode, neighborsOnly, status: preparation.status,
          workerRoundTripMs: roundTripMs, packetAdoptionMs: adoptionMs,
          handleCount, segmentCount,
          ...(preparedTiming || {}),
        });
      } catch (_) { /* Diagnostics must not change the editing outcome. */ }
    });
    refresh();
    return preparation.promise;
  }

  function boundaryEditSelectionAnalysis(countryIds = dependencies.projectState.state.boundaryEditEntityIds) {
    const ids = [...new Set(countryIds.map(String))].sort();
    const preparation = dependencies.projectState.state.boundaryPreparation;
    const result = preparation?.status === 'ready' ? preparation.result : null;
    const matches = result && JSON.stringify(result.selectedIds) === JSON.stringify(ids);
    return {
      selectedIds: ids, valid: !!matches && result.valid, analyzed: !!matches,
      isolatedIds: matches ? result.isolatedIds : [],
      message: preparation?.status === 'error' ? preparation.message : !matches ? '경계를 준비하고 있습니다.'
        : ids.length < 2 ? '접경국을 하나 이상 더 선택하세요.' : result.valid ? '' : '선택 국가 사이에 연결된 공유국경이 없습니다.',
    };
  }

  async function beginWorkerGeometryPreview({ operation,payload,transferredGeometry=null,prepareResult,applyAccepted,
    invalidateAfterApply=()=>{},onSuccess=()=>{},onError,shouldKeepResult=()=>true }) {
    if (activeApplication) return false;
    await discardActiveGeometryPreview({ announce:false });
    const expectedEpoch=dependencies.domains.projectDomain.state().epoch;
    let requestId=0,prepared;
    try {
      if(typeof prepareResult!=='function')throw new TypeError('A typed Core geometry command preparer is required.');
      dependencies.feedback.setActionStatus('변경 미리보기 계산 중…','working',0);
      const response=await dependencies.spatialQuery.mapEditClient.execute(operation,{ ...payload,previewTransferredGeometry:transferredGeometry });requestId=response.requestId;
      if(!shouldKeepResult() || dependencies.domains.projectDomain.state().epoch!==expectedEpoch)
        throw Object.assign(new Error('계산 중 지도 상태가 바뀌어 미리보기를 폐기했습니다.'),{ cancelled:true });
      prepared=rejectedOutcome(await prepareResult(response.result,{ expectedEpoch }));
      if(!prepared.changed){dependencies.spatialQuery.mapEditClient.discard(requestId);return false;}
      const ready=await beginLocalGeometryPreview({ operation,preparedCommand:prepared,preparedPreview:response.result.preview,
        transferredGeometry:response.result.transferredGeometry || transferredGeometry,shouldKeepResult,
        discardPrepared:()=>dependencies.spatialQuery.mapEditClient.discard(requestId),
        applyAccepted:async result=>{if(applyAccepted)await applyAccepted(result,response.result);dependencies.spatialQuery.mapEditClient.commit(requestId,response.geometryRevision);},
        invalidateAfterApply:()=>invalidateAfterApply(response.result),
        onSuccess:()=>onSuccess(response.result) });
      if(!ready){await dependencies.domains.projectDomain.cancelCandidate(prepared.candidateId);dependencies.spatialQuery.mapEditClient.discard(requestId);}
      return ready;
    } catch(error) {
      if(prepared?.candidateId)await dependencies.domains.projectDomain.cancelCandidate(prepared.candidateId).catch(cleanupError=>{error.cleanupError=cleanupError;});
      if(requestId)dependencies.spatialQuery.mapEditClient.discard(requestId);
      if(error.cancelled){
        console.info('[PL-PREVIEW-CANCELLED]',error);
        dependencies.feedback.setActionStatus('지도 작업을 취소했습니다.','success',2200);
      }
      else if(onError)await onError(error);
      else dependencies.feedback.reportOperationError(error,'변경 미리보기를 준비하지 못했습니다.','PL-PREVIEW-PREPARE',4200);
      return false;
    }
  }

  async function beginLocalGeometryPreview({ operation,preparedCommand,transferredGeometry=null,shouldKeepResult=()=>true,
    beforeApply=async()=>true,preparedPreview=null,validatePrepared=async()=>true,applyAccepted,
    discardPrepared=()=>{},invalidateAfterApply=()=>{},onSuccess=()=>{},
    successMessage='변경을 적용했습니다.',errorMessage='변경을 적용하지 못했습니다.' }) {
    if (activeApplication) return false;
    await discardActiveGeometryPreview({ announce:false });
    if(!preparedCommand?.ok || !preparedCommand.changed || !preparedCommand.preview || !preparedCommand.candidateId)
      throw new TypeError('A retained C++ candidate and its immutable projection are required.');
    const expectedEpoch=preparedCommand.state.epoch;
    const current=()=>shouldKeepResult() && dependencies.domains.projectDomain.getGeneration()===preparedCommand.projectGeneration && dependencies.domains.projectDomain.state().checkpoint===preparedCommand.state.checkpoint;
    if(!current()){await dependencies.domains.projectDomain.cancelCandidate(preparedCommand.candidateId);discardPrepared();return false;}
    const epoch=++localPreparationEpoch;
    const source=preparedCommand.preview;
    const ids=new Set((source.delta?.objects || []).filter(row=>row.ref.domain==='territorial').map(row=>row.ref.id));
    const previous=new Map(preparedCommand.beforeTerritorial.map(feature=>[String(feature.id),feature]));
    const nextIds=new Set(source.territorialViews.map(feature=>String(feature.id)));
    for(const feature of source.territorialViews) {
      const before=previous.get(String(feature.id));
      if(!before || before.geometry!==feature.geometry || ['parentId','coverageMode','validFrom','validTo'].some(field=>before.properties[field]!==feature.properties[field]))ids.add(String(feature.id));
    }
    for(const id of previous.keys())if(!nextIds.has(id))ids.add(id);
    const beforeFeatures=preparedCommand.beforeTerritorial.filter(feature=>ids.has(String(feature.id)));
    const afterFeatures=source.territorialViews.filter(feature=>ids.has(String(feature.id)));
    const removedIds=[...ids].filter(id=>!afterFeatures.some(feature=>String(feature.id)===id));
    if(!preparedPreview){
      localPreparationPending=true;
      try {
        const response=await dependencies.spatialQuery.mapEditClient.execute('territorial-preview',{ payload:{ operation,beforeIds:beforeFeatures.map(feature=>String(feature.id)),afterFeatures,removedIds,transferredGeometry } });
        if(epoch!==localPreparationEpoch || !current()){await dependencies.domains.projectDomain.cancelCandidate(preparedCommand.candidateId);discardPrepared();return false;}
        preparedPreview=response.result;
        validatePrepared=async()=>{await dependencies.spatialQuery.mapEditClient.execute('territorial-validation',{ payload:{ preparationId:preparedPreview.preparationId } });return dependencies.spatialQuery.mapEditClient.sourcesCurrent(response.sourceRevision);};
      } catch(error) {
        await dependencies.domains.projectDomain.cancelCandidate(preparedCommand.candidateId);discardPrepared();
        if(!error.cancelled)dependencies.feedback.reportOperationError(error,errorMessage,'PL-PREVIEW-PREPARE',3600);return false;
      } finally {if(epoch===localPreparationEpoch)localPreparationPending=false;}
    }
    const issues=preparedPreview.validation?.issues || [];
    const baseDataRevision=dependencies.projectState.state.stateRevision;
    const session=dependencies.geometryEditingCore.beginGeometryPreview(dependencies.projectState.state.geometryPreview,{
      operation,baseDataRevision,affectedIds:[...ids],beforeFeatures,afterFeatures,removedIds,...preparedPreview,temporalImpact:source.temporalImpact,
      validation:{ issues,blocking:issues.some(issue=>issue.severity!=='warning') } });
    activeGeometryPreviewDiscard=async()=>{discardPrepared();await dependencies.domains.projectDomain.cancelCandidate(preparedCommand.candidateId);};
    activeGeometryPreviewApply=async()=>{
      if(!current() || !dependencies.geometryEditingCore.previewIsCurrent(dependencies.projectState.state.geometryPreview,session.sessionId,dependencies.projectState.state.stateRevision)){
        session.status='stale';dependencies.feedback.setActionStatus('원본이 바뀌었습니다. 입력을 유지하고 미리보기를 다시 계산하세요.','error',3600);return false;
      }
      if(session.validation.blocking){dependencies.feedback.setActionStatus('미리보기 형상을 수정하세요.','error',3400);return false;}
      if(!await beforeApply()){session.status='returned';return false;}
      try {if(!await validatePrepared()){session.status='stale';dependencies.feedback.setActionStatus('미리보기를 다시 계산하세요.','error',3600);return false;}}
      catch(error){session.status='stale';dependencies.feedback.reportOperationError(error,'미리보기를 다시 계산하세요.','PL-PREVIEW-STALE',3600);return false;}
      if(!current() || dependencies.projectState.state.geometryPreview.session!==session){session.status='stale';return false;}
      dependencies.geometryEditingCore.clearGeometryPreview(dependencies.projectState.state.geometryPreview);
      activeGeometryPreviewApply=null;activeGeometryPreviewDiscard=null;
      try {
        const result=rejectedOutcome(await dependencies.domains.projectDomain.confirmCandidate(preparedCommand.candidateId,expectedEpoch,{ applyAccepted:async outcome=>{
          if(applyAccepted)await applyAccepted(outcome);await invalidateAfterApply(outcome);
        } }));
        if(!result.changed)return false;
        try { await onSuccess(result); }
        catch (error) { dependencies.feedback.reportOperationError(error,'변경은 적용됐지만 완료 표시를 갱신하지 못했습니다.','PL-PREVIEW-NOTIFY',4200);return true; }
        dependencies.taskUi.updateModeButtons();dependencies.feedback.setActionStatus(successMessage,'success',3600);return true;
      } catch(error) {
        discardPrepared();dependencies.spatialQuery.mapEditClient.rebase();
        dependencies.feedback.reportOperationError(error,errorMessage,'PL-PREVIEW-001',4400);return false;
      }
    };
    dependencies.domains.editingDomain.refreshEditingPresentation('draft-preview-ready');
    dependencies.domains.renderingDomain.invalidateGpuInteraction('local-geometry-preview-ready');dependencies.taskUi.updateModeButtons();
    const blockingIssue=issues.find(issue=>issue.severity!=='warning');
    dependencies.taskUi.setModeBanner(blockingIssue?.message || '변경 결과를 확인한 뒤 적용하세요.');
    if(blockingIssue)dependencies.platform.$('modeTaskInstruction')?.classList.add('cut-invalid');return true;
  }

  async function applyActiveGeometryPreview() {
    if (activeApplication || !activeGeometryPreviewApply) return false;
    const apply = activeGeometryPreviewApply;
    const session = dependencies.projectState.state.geometryPreview.session;
    session.status = 'applying';
    activeApplication = Promise.resolve().then(apply);
    dependencies.taskUi.updateModeButtons();
    try { return await activeApplication; }
    finally {
      activeApplication = null;
      if (dependencies.projectState.state.geometryPreview.session === session) {
        if (['stale','returned'].includes(session.status)) await discardActiveGeometryPreview({announce:false});
        else session.status = 'ready';
      }
      dependencies.taskUi.updateModeButtons();
    }
  }

  async function discardActiveGeometryPreview({ announce = true } = {}) {
    if (activeApplication) return false;
    localPreparationEpoch += 1;
    if (localPreparationPending) {
      localPreparationPending = false;
      dependencies.spatialQuery.mapEditClient.stop();
    }
    if (!dependencies.projectState.state.geometryPreview.session) return false;
    const direct = editPreviewController.snapshot();
    if (direct.successor?.kind === 'geometry-preview'
      && direct.successor.sessionId === dependencies.projectState.state.geometryPreview.session.sessionId) {
      editPreviewController.clear(direct.id);
    }
    const discard=activeGeometryPreviewDiscard;
    activeGeometryPreviewApply = null;
    activeGeometryPreviewDiscard = null;
    (0, dependencies.geometryEditingCore.clearGeometryPreview)(dependencies.projectState.state.geometryPreview);
    dependencies.domains.editingDomain?.refreshEditingPresentation?.('draft-preview-discard');
    dependencies.domains.renderingDomain?.invalidateGpuInteraction?.('geometry-preview-discard');
    (0, dependencies.taskUi.updateModeButtons)();
    if(discard)try {await discard();} catch(error) {
      dependencies.feedback.reportOperationError(error,'미리보기 취소를 완료하지 못했습니다.','PL-PREVIEW-CANCEL',4200);
      return false;
    }
    if (announce) (0, dependencies.feedback.setActionStatus)('미리보기를 닫았습니다.', 'success', 2600);
    return true;
  }

  function initializeEditPreviewController() {
    (editPreviewController = (0, dependencies.spatialFactories.createEditPreviewController)());

    (editPipelineMetrics = {
      commitCount: 0,
      rollbackCount: 0,
      lastCommitMs: 0,
      lastCommitDomain: '',
      commitP95Ms: 0,
      commitP99Ms: 0,
    });
  }

  function initializeBoundarySelectionAnalysisCache() {
    (boundarySelectionAnalysisCache = new Map());

    (boundarySelectionAnalysisMetrics = { builds: 0, cacheHits: 0, cacheMisses: 0, buildMs: 0 });
  }

  function initializeActiveGeometryPreviewApply() {
    (activeGeometryPreviewApply = null);

    (activeGeometryPreviewDiscard = null);
  }

  return Object.freeze({
    connect,
    initializeEditPreviewController,
    initializeBoundarySelectionAnalysisCache,
    initializeActiveGeometryPreviewApply,
    get applyActiveGeometryPreview() { return applyActiveGeometryPreview; },
    get beginLocalGeometryPreview() { return beginLocalGeometryPreview; },
    get beginWorkerGeometryPreview() { return beginWorkerGeometryPreview; },
    get boundaryEditSelectionAnalysis() { return boundaryEditSelectionAnalysis; },
    get boundarySelectionAnalysisCache() { return boundarySelectionAnalysisCache; },
    get boundarySelectionAnalysisMetrics() { return boundarySelectionAnalysisMetrics; },
    get coordKey() { return coordKey; },
    get coordNear() { return coordNear; },

    get discardActiveGeometryPreview() { return discardActiveGeometryPreview; },
    get editPipelineMetrics() { return editPipelineMetrics; },
    get editPreviewController() { return editPreviewController; },
    get geometryPolygonSets() { return geometryPolygonSets; },

    get rebuildBoundaryTopology() { return rebuildBoundaryTopology; },

    get transactMapEdit() { return transactMapEdit; },
  });
}
