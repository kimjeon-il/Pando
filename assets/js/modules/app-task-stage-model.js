import { normalizeObjectRef } from './object-selection-controller.js';

const text = value => String(value ?? '').trim();

export function taskTargetRefs(state, { countryType = 'country', countryFeatureById = () => null } = {}) {
  const refs = new Map();
  const units = new Map((state.territorialUnits || []).map(feature => [text(feature?.id), feature]));
  const add = ref => {
    const normalized = normalizeObjectRef(ref);
    if (normalized && !refs.has(normalized.key)) refs.set(normalized.key, normalized);
  };
  const addCountry = id => {
    const key = text(id);
    if (key && countryFeatureById(key)) add({ domain: 'territorial', type: countryType, id: key });
  };
  const addTerritorial = id => {
    const key = text(id);
    if (!key) return;
    const unit = units.get(key);
    if (unit?.properties?.unitType) add({ domain: 'territorial', type: unit.properties.unitType, id: key });
    else addCountry(key);
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
  if (state.tool === 'country-border') for (const id of state.boundaryEditCountryIds || []) addTerritorial(id);
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
}) {
  const previewValidation = state.geometryPreview?.session?.validation;
  const draftInvalid = (draft.issues || []).some(issue => issue?.severity !== 'warning');
  const hydroInvalid = (state.multiDraft?.previewIssues || []).some(issue => issue?.severity !== 'warning');
  const cutInvalid = !!cutLineMode && !!draft.cutAssessment && draft.cutAssessment.valid !== true && draft.cutAssessment.status !== 'pending';
  const invalid = boundaryFailed || !!selection?.computationError || draftInvalid || hydroInvalid || previewValidation?.blocking === true || cutInvalid;
  const preparing = !invalid && (calculating || busy || !!state.multiDraft?.previewPending);
  let reason = '';
  if (primaryDisabled || draftDisabled) {
    if (state.modeProcessing || selection?.applying) reason = '작업을 처리하는 중입니다.';
    else if (boundaryPending) reason = '경계를 준비하는 중입니다.';
    else if (selection?.previewPending || selection?.computationPending || selection?.activePhase === 'preparing') reason = '선택 영역을 계산하는 중입니다.';
    else if (state.multiDraft?.previewPending) reason = '그린 영역을 확인하는 중입니다.';
    else if (boundaryAnalysis && !boundaryAnalysis.valid) reason = boundaryAnalysis.message || '맞닿은 대상을 하나 이상 더 선택하세요.';
    else if (mergeTargetMode && !state.mergeTargetCountryIds.length) reason = '합칠 대상을 하나 이상 선택하세요.';
    else if (genericMergeMode && !state.genericFeatureMergeTargetIds.length) reason = '합칠 영역을 하나 이상 선택하세요.';
    else if (unitMergeMode && !state.territorialUnitMergeTargetIds.length) reason = '합칠 영역을 하나 이상 선택하세요.';
    else if (previewValidation?.blocking) reason = firstIssueMessage(previewValidation.issues, '적용할 수 없는 결과입니다. 표시된 문제를 확인하세요.');
    else if (hydroReview && (!hydroCount || hydroInvalid)) reason = hydroInvalid
      ? firstIssueMessage(state.multiDraft?.previewIssues, '그린 영역의 문제를 확인하세요.')
      : '완료할 영역을 하나 이상 추가하세요.';
    else if (draftInvalid) reason = firstIssueMessage(draft.issues, '그린 경로의 문제를 확인하세요.');
    else if (cutLineMode && !cutLineReady) reason = draft.cutAssessment?.message || '선택 영역을 가로지르는 유효한 경계를 그리세요.';
    else if (unitRedrawMode && draft.coords.length < 3) reason = '영역을 만들 꼭짓점을 세 개 이상 지정하세요.';
    else if (toolbar.editable && !toolbar.complete) reason = '지도에서 작업할 영역이나 경로를 더 지정하세요.';
    else if (selectionModel?.primaryDisabled) reason = selection?.stage === 'setup'
      ? '대상을 선택하고 필요한 설정을 완료하세요.'
      : selection?.stage === 'review' ? '적용할 결과가 준비될 때까지 기다려 주세요.' : '다음 단계로 진행할 영역을 선택하세요.';
    else reason = '다음 단계에 필요한 대상을 선택하세요.';
  }
  const status = invalid ? 'invalid' : preparing ? 'preparing' : reason ? 'needs-target' : 'editable';
  return Object.freeze({ status, label: STATUS_LABELS[status], reason });
}
