import { normalizeObjectRef } from './object-selection-controller.js';

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
    addCountry(session.sovereignId);
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
    }
  } else if (state.tool === 'merge-country' || state.tool === 'merge-territorial-unit') {
    const country = state.tool === 'merge-country';
    const source = country ? state.mergeSourceCountryId : state.territorialUnitMergeSourceId;
    const type = '객체';
    const ids = country ? state.mergeTargetCountryIds : state.territorialUnitMergeTargetIds;
    name = `${type} 합병`;
    stage = preview ? '합병 확인' : `합칠 ${type}`;
    step = preview ? 2 : 1;
    total = 2;
    if (!preview) cards.push(card(`남길 ${type}`, [source]));
    resultLabel = `합칠 ${type}`;
    resultRefs = (ids || []).map(ref).filter(Boolean);
  } else if (state.tool === 'territorial-border') {
    const ids = [...new Set((state.boundaryEditEntityIds || []).map(text))];
    const source = state.boundaryEditSeedEntityId || ids[0];
    const subunit = (territorialEntityById(source)?.properties.entityKind === 'general' && !!territorialEntityById(source)?.properties.parentId);
    const type = '객체';
    const selecting = state.boundaryEditPhase === 'selecting';
    name = '경계 조정';
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
    else reason = '다음 단계에 필요한 대상을 선택하세요.';
  }
  const status = invalid ? 'invalid' : preparing ? 'preparing' : reason ? 'needs-target' : 'editable';
  return Object.freeze({ status, label: STATUS_LABELS[status], reason, feedbackVisible: !!(invalid || preparing), instructionFeedback });
}
