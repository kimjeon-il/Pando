import { normalizeObjectRef } from "../../../../../shared/frontend/js/modules/object-selection-controller.js";

const text = value => String(value ?? '').trim();

export function taskTargetRefs(state, { territorialEntityById = () => null } = {}) {
  const refs = new Map();
  const add = ref => {
    const normalized = normalizeObjectRef(ref);
    if (normalized && !refs.has(normalized.key)) refs.set(normalized.key, normalized);
  };
  const addCountry = id => {
    const key = text(id);
    const entity = key ? territorialEntityById(key) : null;
    if (entity?.properties?.entityKind === 'general' && !entity.properties.parentId) add({ domain: 'territorial', type: 'entity', id: key });
  };
  const addTerritorial = id => {
    const key = text(id);
    if (!key) return;
    if (territorialEntityById(key)?.properties?.entityKind) add({ domain: 'territorial', type: 'entity', id: key });
  };
  const addGeneric = id => {
    const key = text(id);
    if (key && (state.genericFeatures || []).some(feature => text(feature?.id) === key)) add({ domain: 'generic', type: 'feature', id: key });
  };

  const session = state.territorySelectionSession?.tool === state.tool ? state.territorySelectionSession : null;
  if (session) {
    addTerritorial(session.editTargetId);
    addCountry(session.targetCountryId);
    for (const id of session.sourceCountryIds || []) addCountry(id);
    addTerritorial(session.parentId);
    if (session.sourceKey !== 'unassigned') addTerritorial(session.sourceKey);
  }
  if (state.tool === 'territorial-border') for (const id of state.boundaryEditEntityIds || []) addTerritorial(id);
  if (state.tool === 'country-coast') addCountry(state.coastEditCountryId);
  if (state.tool === 'merge-country') {
    addCountry(state.mergeSourceCountryId);
    for (const id of state.mergeTargetCountryIds || []) addCountry(id);
  }
  if (state.tool === 'merge-territorial-unit') {
    addTerritorial(state.territorialUnitMergeSourceId);
    for (const id of state.territorialUnitMergeTargetIds || []) addTerritorial(id);
  }
  if (state.tool === 'split-territorial-unit') addTerritorial(state.territorialUnitSplitSourceId);
  if (state.tool === 'redraw-territorial-unit') addTerritorial(state.territorialUnitRedrawSourceId);
  if (state.tool === 'split-generic-feature') addGeneric(state.genericFeatureSplitSourceId);
  if (state.tool === 'merge-generic-feature') {
    addGeneric(state.genericFeatureMergeSourceId);
    for (const id of state.genericFeatureMergeTargetIds || []) addGeneric(id);
  }
  return Object.freeze([...refs.values()]);
}

/** Derive UI roles and steps from existing workflows; never own an editing state. */
export function taskWorkflowPresentation(state, selectionModel = null, draft = {}, {
  territorialEntityById = () => null,
} = {}) {
  const preview = !!state.geometryPreview?.session;
  const cards = [];
  const ref = id => {
    const key = text(id);
    if (!key) return null;
    return normalizeObjectRef({ domain: 'territorial', type: 'entity', id: key });
  };
  const card = (role, ids, placeholder = '선택') => ({ role, refs: ids.map(ref).filter(Boolean), placeholder });
  const current = selectionModel?.current;
  let name, stage, step, total, relation = '', resultLabel = '', resultRefs = [];
  if (current) {
    name = current.taskLabel;
    stage = selectionModel.stageLabel;
    step = selectionModel.step;
    total = 3;
    if (current.kind === 'annex' && current.stage === 'setup') {
      cards.push(card('넘겨받는 객체', [current.targetCountryId]), card('넘겨주는 객체', current.sourceCountryIds, '객체 선택'));
      relation = '←';
    } else if (current.kind === 'entity' && current.editOperation === 'annex') {
      // Keep the existing 3-step subunit annex; the source chooser remains in the setup form.
      stage = current.stage === 'setup' ? '가져올 영역'
        : current.stage === 'review' ? '편입 확인' : stage;
      if (current.stage === 'setup') cards.push(card('넘겨받는 객체', [current.editTargetId]));
    }
  } else if (state.tool === 'merge-country' || state.tool === 'merge-territorial-unit') {
    const country = state.tool === 'merge-country';
    const source = country ? state.mergeSourceCountryId : state.territorialUnitMergeSourceId;
    // Only nested general entities are subunits. Regional entities retain
    // the existing generic object wording; generic-feature merge is retired.
    const entity = country ? null : territorialEntityById(source);
    const subunit = entity?.properties?.entityKind === 'general' && !!entity.properties.parentId;
    const type = subunit ? '하위단위' : '객체';
    const ids = country ? state.mergeTargetCountryIds : state.territorialUnitMergeTargetIds;
    name = `${type} 합병`;
    stage = preview ? '합병 확인' : `합칠 ${type}`;
    step = preview ? 2 : 1;
    total = 2;
    if (!preview) cards.push(card(`남길 ${type}`, [source]));
    resultLabel = `합칠 ${type}`;
    resultRefs = (ids || []).map(ref).filter(Boolean);
  } else if (state.tool === 'split-territorial-unit' || state.tool === 'split-generic-feature') {
    // Split sources are selected before drawing; there is no additional picking stage.
    const territorial = state.tool === 'split-territorial-unit';
    const sourceId = territorial ? state.territorialUnitSplitSourceId : state.genericFeatureSplitSourceId;
    const virtualSource = territorial && !!state.territorialUnitSplitVirtualSource;
    if (!text(sourceId) && !virtualSource) return null;
    name = '영역 나누기';
    stage = preview ? '분할 확인' : '경계 그리기';
    step = preview ? 2 : 1;
    total = 2;
    if (!preview) {
      const sourceRef = text(sourceId) ? normalizeObjectRef({
        domain: territorial ? 'territorial' : 'generic',
        type: territorial ? 'entity' : 'feature',
        id: text(sourceId),
      }) : null;
      cards.push({
        role: '나눌 영역', refs: sourceRef ? [sourceRef] : [],
        placeholder: virtualSource ? '현재 영역' : '대상 선택',
      });
    }
  } else if (state.tool === 'redraw-territorial-unit') {
    // The selected region is already the redraw source. Reuse the existing task
    // card instead of introducing another target-selection step.
    const source = state.territorialUnitRedrawSourceId;
    if (!text(source)) return null;
    name = '영역 다시 지정';
    stage = preview ? '변경 확인' : '영역 그리기';
    step = preview ? 2 : 1;
    total = 2;
    if (!preview) cards.push(card('대상 영역', [source]));
  } else if (state.tool === 'territorial-border') {
    const ids = [...new Set((state.boundaryEditEntityIds || []).map(text))];
    const source = state.boundaryEditSeedEntityId || ids[0];
    const subunit = (territorialEntityById(source)?.properties.entityKind === 'general' && !!territorialEntityById(source)?.properties.parentId);
    const type = subunit ? '객체' : '국가';
    const selecting = state.boundaryEditPhase === 'selecting';
    name = subunit ? '경계 조정' : '국경 조정';
    stage = preview ? '변경 확인' : selecting ? `상대 ${type}` : '경계 편집';
    step = preview ? subunit ? 2 : 3 : selecting ? 1 : subunit ? 1 : 2;
    total = subunit ? 2 : 3;
    if (!preview) {
      cards.push(card(`기준 ${type}`, [source]), card(`상대 ${type}`, ids.filter(id => id !== text(source)), `${type} 선택`));
      relation = '↔';
    }
  } else if (state.tool === 'country-coast') {
    name = '해안선 조정';
    stage = preview ? '변경 확인' : '해안선 편집';
    step = preview ? 2 : 1;
    total = 2;
    if (!preview) cards.push(card('대상 객체', [state.coastEditCountryId]));
  } else if (state.tool === 'river' || state.tool === 'lake') {
    const river = state.tool === 'river';
    const review = state.multiDraft?.kind === 'hydro'
      && !!(state.multiDraft.parts?.length || state.multiDraft.current) && !draft.coords?.length && !draft.strokeActive;
    name = river ? '강 그리기' : '호수 그리기';
    stage = review ? '생성 확인' : river ? '경로 그리기' : '영역 그리기';
    step = review ? 2 : 1;
    total = 2;
    resultLabel = river ? '경로' : '영역';
  } else if (state.distributionDraft && state.tool === 'polygon') {
    name = '자유 영역 그리기';
    stage = '영역 그리기';
    step = total = 1;
  } else return null;
  return { name, stage, step, total, cards, relation, resultLabel, resultRefs, review: current ? current.stage === 'review' : preview };
}

const STATUS_LABELS = Object.freeze({
  preparing: '준비 중',
  'needs-target': '대상 필요',
  editable: '편집 가능',
  invalid: '확인 필요',
});

const firstIssueMessage = (issues, fallback) => {
  const issue = Array.isArray(issues) ? issues.find(item => item?.severity !== 'warning') : null;
  if (typeof issue === 'string' && issue.trim()) return issue;
  return String(issue?.message || fallback);
};

export function taskStagePresentation({
  state, selection, selectionModel, draft, toolbar, primaryDisabled, draftDisabled, boundaryAnalysis,
  boundaryPending, boundaryFailed, calculating, busy, cutLineMode, cutLineReady,
  mergeTargetMode, genericMergeMode, unitMergeMode, unitRedrawMode, hydroReview, hydroCount,
  operationFeedback = '',
}) {
  const selectionSetup = selection?.tool === state.tool && selection.stage === 'setup';
  const previewValidation = selectionSetup ? null : state.geometryPreview?.session?.validation;
  const draftInvalid = (draft.issues || []).some(issue => issue?.severity !== 'warning');
  const hydroInvalid = (state.multiDraft?.previewIssues || []).some(issue => issue?.severity !== 'warning');
  const cutInvalid = !!cutLineMode && !!draft.cutAssessment && draft.cutAssessment.valid !== true && draft.cutAssessment.status !== 'pending';
  const riverComponents = selection?.useRiverBoundaries && selection.activeMethod === 'components';
  const riverFailed = riverComponents && ['error', 'source-error'].includes(selection.riverPartitionStatus);
  const riverPending = riverComponents && selection.riverPartitionStatus === 'loading';
  const riverExcluded = riverComponents && selection.riverPartitionDonorResults?.some(result => result.status === 'invalid');
  const boundaryInvalid = boundaryAnalysis?.analyzed && boundaryAnalysis.selectedIds.length >= 2 && !boundaryAnalysis.valid;
  const invalid = !!operationFeedback || boundaryFailed || boundaryInvalid || !!selection?.computationError || draftInvalid || hydroInvalid || previewValidation?.blocking === true || cutInvalid || riverFailed;
  const preparing = !invalid && (calculating || busy || !!state.multiDraft?.previewPending || riverPending);
  // These operation-specific messages already come from the river workflow banner.
  const instructionFeedback = !!(riverFailed || riverPending || riverExcluded)
    && !operationFeedback && !boundaryFailed && !boundaryInvalid && !selection?.computationError && !draftInvalid && !hydroInvalid && !previewValidation?.blocking && !cutInvalid;
  let reason = '';
  if (instructionFeedback) {
    // Preserve the actual progress/error/excluded-country message without repeating it.
  } else if (invalid) {
    if (operationFeedback) reason = operationFeedback;
    else if (boundaryFailed) reason = state.boundaryPreparation?.message || '경계를 준비하지 못했습니다. 다시 시도하세요.';
    else if (boundaryInvalid) reason = boundaryAnalysis.message;
    else if (selection?.computationError) reason = '선택 영역을 계산하지 못했습니다. 다시 계산을 눌러 재시도하세요.';
    else if (previewValidation?.blocking) reason = firstIssueMessage(previewValidation.issues, '적용할 수 없는 결과입니다. 표시된 문제를 확인하세요.');
    else if (hydroInvalid) reason = firstIssueMessage(state.multiDraft.previewIssues, '그린 영역의 문제를 확인하세요.');
    else if (draftInvalid) reason = firstIssueMessage(draft.issues, '그린 경로의 문제를 확인하세요.');
    else if (cutInvalid) reason = draft.cutAssessment.message || '선택 영역을 가로지르는 유효한 경계를 그리세요.';
  } else if (primaryDisabled || draftDisabled || preparing) {
    if (state.modeProcessing || selection?.applying) reason = '작업을 처리하는 중입니다.';
    else if (boundaryPending) reason = '경계를 준비하는 중입니다.';
    else if (selection?.previewPending || selection?.computationPending || selection?.activePhase === 'preparing') reason = '선택 영역을 계산하는 중입니다.';
    else if (state.multiDraft?.previewPending) reason = '그린 영역을 확인하는 중입니다.';
    else if (boundaryAnalysis && !boundaryAnalysis.valid) reason = boundaryAnalysis.message || '맞닿은 대상을 하나 이상 더 선택하세요.';
    else if (mergeTargetMode && !state.mergeTargetCountryIds.length) reason = '합칠 대상을 하나 이상 선택하세요.';
    else if (genericMergeMode && !state.genericFeatureMergeTargetIds.length) reason = '합칠 영역을 하나 이상 선택하세요.';
    else if (unitMergeMode && !state.territorialUnitMergeTargetIds.length) reason = '합칠 영역을 하나 이상 선택하세요.';
    else if (hydroReview && !hydroCount) reason = '완료할 영역을 하나 이상 추가하세요.';
    else if (cutLineMode && !cutLineReady) reason = draft.cutAssessment?.message || '선택 영역을 가로지르는 유효한 경계를 그리세요.';
    else if (unitRedrawMode && draft.coords.length < 3) reason = '영역을 만들 꼭짓점을 세 개 이상 지정하세요.';
    else if (toolbar.editable && !toolbar.complete) reason = '지도에서 작업할 영역이나 경로를 더 지정하세요.';
    else if (selectionModel?.primaryDisabled) reason = selection?.stage === 'setup'
      ? '대상을 선택하고 필요한 설정을 완료하세요.'
      : selection?.stage === 'review' ? '적용할 결과가 준비될 때까지 기다려 주세요.' : '다음 단계로 진행할 영역을 선택하세요.';
    else if (['territorial-border','country-coast'].includes(state.tool)) reason = '꼭짓점을 이동하면 변경을 미리 볼 수 있습니다.';
    else reason = '다음 단계에 필요한 대상을 선택하세요.';
  }
  const status = invalid ? 'invalid' : preparing ? 'preparing' : reason ? 'needs-target' : 'editable';
  return Object.freeze({ status, label: reason === '꼭짓점을 이동하면 변경을 미리 볼 수 있습니다.' ? '입력 대기' : STATUS_LABELS[status], reason, feedbackVisible: !!(invalid || preparing), instructionFeedback });
}

/** Read-only view of the existing task; dates come from the Core candidate. */
export function editingContextPresentation({state,draft={},month='',targets=[],mobile=false,editing={}}) {
  const selection=state.territorySelectionSession, preview=state.geometryPreview?.session;
  const applying=preview?.status==='applying'||selection?.applying;
  const calculating=!applying && (state.modeProcessing||selection?.previewPending||selection?.computationPending||state.multiDraft?.previewPending);
  const review=selection?selection.stage==='review':!!preview;
  const setup=selection?.stage==='setup'||(['territorial-border','country-coast'].includes(state.tool)&&state.boundaryEditPhase==='selecting');
  const stage=applying?'적용 중':calculating?'계산 중':review?'미리보기':setup?'대상 선택':'초안';
  const names=targets.map(target=>target.name).filter(Boolean);
  const fallbackTarget = state.tool === 'split-territorial-unit' && state.territorialUnitSplitVirtualSource
    ? '현재 영역' : selection?.name;
  const subunitAnnex = selection?.tool === state.tool && selection.kind === 'entity'
    && selection.editOperation === 'annex';
  const targetSummary=subunitAnnex ? names[0]||selection.name||'새 객체'
    : names.length>1?names[0]+' 외 '+(names.length-1)+'개':names[0]||fallbackTarget||'새 객체';
  const view=month?month.replace(/^(-?)([0-9]+)-([0-9]{2})$/,(_,sign,year,m)=>(sign?'기원전 ':'')+Number(year)+'년 '+Number(m)+'월 말 상태'):'시점 확인 중';
  const periods=preview?.temporalImpact;
  const labels=periods?.map(row=>!row.from&&!row.until?'모든 시점':(row.from?row.from+'부터':'과거 전체')+' · '+(row.until?row.until+' 전까지':'종료 제한 없음'));
  const period=!preview?'변경 기간 계산 전':labels?.length?[...new Set(labels)].join(' / '):'시간 기록 변경 없음';
  const instruction=editing.vertexPlacement?'지도를 탭해 선택 정점 위치 지정 · 위치 지정 취소: 입력 유지':mobile&&!review&&!applying?(editing.selectedVertex?'선택점 드래그: 이동 · 위치 지정: 지도 탭 · 두 손가락: 지도 이동':'정점 탭: 선택 · 점을 끌어 이동 · 두 손가락: 지도 이동'):state.spacePanActive?'지도 이동 중 · 놓으면 편집 계속':applying?'변경을 반영하고 있습니다.':review?'적용 전입니다 · 수정으로 돌아가면 입력이 유지됩니다.':draft.vertexInsertMode?'경계 클릭: 꼭짓점 삽입 · Esc: 삽입 종료':(draft.inputPhase==='refine'||['territorial-border','country-coast'].includes(state.tool))?'꼭짓점 드래그: 이동 · Space 누르기: 지도 이동':'지도에서 입력 · Space 누르기: 지도 이동';
  return Object.freeze({stage,targetSummary,view,period,instruction});
}

/** Show only actionable editing hints; leave ordinary instructions in state for other consumers. */
export function shouldShowTaskInputInstruction({ state = {}, editing = {}, draft = {}, mobile = false, draftActive = false } = {}) {
  if (state.spacePanActive || editing.vertexPlacement || draft.vertexInsertMode) return true;
  if (state.geometryPreview?.session?.status === 'applying' || state.territorySelectionSession?.applying) return true;
  if (!mobile || state.geometryPreview?.session) return false;
  const selection = state.territorySelectionSession;
  if (selection) return selection.stage === 'selection' && selection.activePhase === 'drawing';
  if (state.tool === 'territorial-border') return state.boundaryEditPhase === 'editing';
  if (state.tool === 'country-coast') return true;
  if (['merge-country', 'merge-territorial-unit', 'merge-generic-feature'].includes(state.tool)) return false;
  return Boolean(editing.selectedVertex || editing.objectVertexEditing || draftActive);
}
