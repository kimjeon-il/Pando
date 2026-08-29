export const TOOL_DEFINITIONS = Object.freeze({
  select: Object.freeze({ label: '국가 선택', task: '지도 편집', stage: '작업 진행', cursor: 'select' }),
  'new-country': Object.freeze({ label: '국가 추가', task: '국가 추가', cursor: 'phased', special: true, draftPhase: 'line', draft: Object.freeze({ shape: 'line', profile: 'boundary' }) }),
  'annex-territory': Object.freeze({ label: '영토 편입', task: '영토 편입', cursor: 'phased', special: true, draftPhase: 'line', draft: Object.freeze({ shape: 'line', profile: 'boundary' }) }),
  'merge-country': Object.freeze({ label: '국가 합병', task: '국가 합병', stage: '대상 국가 선택', cursor: 'country', special: true }),
  'merge-drawing': Object.freeze({ label: '영역 합치기', task: '영역 합치기', stage: '대상 영역 선택', cursor: 'country', special: true }),
  'split-drawing': Object.freeze({ label: '영역 나누기', task: '영역 나누기', stage: '경계 그리기', cursor: 'drawing', special: true, draft: Object.freeze({ shape: 'line', profile: 'boundary' }) }),
  'merge-country-region': Object.freeze({ label: '지역 합치기', task: '지역 합치기', stage: '인접 영역 선택', cursor: 'country', special: true }),
  'split-country-region': Object.freeze({ label: '지역 나누기', task: '지역 나누기', stage: '경계 그리기', cursor: 'drawing', special: true, draft: Object.freeze({ shape: 'line', profile: 'boundary' }) }),
  'redraw-country-region': Object.freeze({ label: '영역 다시 지정', task: '영역 다시 지정', stage: '영역 그리기', cursor: 'drawing', special: true, draft: Object.freeze({ shape: 'polygon', profile: 'area' }) }),
  'draw-country-region': Object.freeze({ label: '영역 직접 지정', task: '지역 추가', stage: '영역 그리기', cursor: 'drawing', special: true, draft: Object.freeze({ shape: 'polygon', profile: 'area' }) }),
  'country-border': Object.freeze({ label: '국경 조정', task: '국경 조정', stage: '공유국경 편집', cursor: 'phased', special: true }),
  'country-coast': Object.freeze({ label: '해안선 조정', task: '해안선 조정', stage: '외곽선 편집', cursor: 'select', special: true }),
  label: Object.freeze({ label: '지명 배치', task: '지명 추가', stage: '위치 선택', cursor: 'drawing', special: true }),
  river: Object.freeze({ label: '강 추가', task: '강 추가', stage: '경로 그리기', cursor: 'drawing', special: true, draft: Object.freeze({ shape: 'line', profile: 'river' }) }),
  lake: Object.freeze({ label: '호수 추가', task: '호수 추가', stage: '영역 그리기', cursor: 'drawing', special: true, draft: Object.freeze({ shape: 'polygon', profile: 'area' }) }),
  polygon: Object.freeze({ label: '영역 그리기', task: '영역 그리기', stage: '경계 그리기', cursor: 'drawing', draft: Object.freeze({ shape: 'polygon', profile: 'area' }) }),
  line: Object.freeze({ label: '선 그리기', task: '선 그리기', stage: '경로 그리기', cursor: 'drawing', draft: Object.freeze({ shape: 'line', profile: 'river' }) }),
  point: Object.freeze({ label: '점 찍기', task: '점 찍기', stage: '위치 선택', cursor: 'drawing' }),
});

const phaseStage = phase => phase === 'sources' || phase === 'donor' ? '대상 국가 선택'
  : phase === 'components' ? '영토 선택'
    : phase === 'polygon' || phase === 'polygon-preview' ? '영역 지정'
      : phase === 'river' ? '하천 경계'
    : phase === 'side' ? '영역 확인'
      : '경계 그리기';

export function describeTool(tool, state, { labelPlacement = false } = {}) {
  if (labelPlacement || tool === 'label') return { name: '지명 추가', stage: '위치 선택' };
  const definition = TOOL_DEFINITIONS[tool] || TOOL_DEFINITIONS.select;
  if (tool === 'new-country') return { name: definition.task, stage: phaseStage(state.newCountryPhase) };
  if (tool === 'annex-territory') return { name: definition.task, stage: phaseStage(state.annexPhase) };
  if (tool === 'country-border') return { name: definition.task, stage: state.boundaryEditPhase === 'selecting' ? '대상 선택' : '공유국경 편집' };
  return { name: definition.task, stage: definition.stage || '작업 진행' };
}

export function toolCursorMode(tool, state, { labelPlacement = false } = {}) {
  const country = (tool === 'new-country' && state.newCountryPhase === 'sources')
    || (tool === 'annex-territory' && state.annexPhase === 'donor')
    || (tool === 'merge-country' && !!state.mergeSourceCountryId)
    || (tool === 'country-border' && state.boundaryEditPhase === 'selecting')
    || tool === 'merge-drawing'
    || tool === 'merge-country-region';
  const drawing = labelPlacement
    || ['polygon', 'line', 'river', 'lake', 'split-drawing', 'split-country-region', 'redraw-country-region', 'draw-country-region'].includes(tool)
    || (tool === 'new-country' && state.newCountryPhase === 'line')
    || (tool === 'annex-territory' && ['line', 'polygon'].includes(state.annexPhase));
  const candidate = (tool === 'new-country' && ['side', 'components'].includes(state.newCountryPhase))
    || (tool === 'annex-territory' && ['side', 'polygon-preview', 'components'].includes(state.annexPhase));
  return { country, drawing, candidate, select: !country && !drawing && !candidate };
}

export const toolLabel = tool => TOOL_DEFINITIONS[tool]?.label || String(tool || '');
export const isSpecialTool = tool => !!TOOL_DEFINITIONS[tool]?.special;

export function toolDraftDefinition(tool, state = {}) {
  const definition = TOOL_DEFINITIONS[tool];
  if (!definition?.draft) return null;
  if (definition.draftPhase) {
    const phase = tool === 'new-country' ? state.newCountryPhase : tool === 'annex-territory' ? state.annexPhase : null;
    if (tool === 'annex-territory') {
      if (!['line', 'polygon'].includes(phase)) return null;
      return phase === 'polygon' ? Object.freeze({ shape: 'polygon', profile: 'area' }) : definition.draft;
    }
    if (phase !== definition.draftPhase) return null;
  }
  return definition.draft;
}

export function dispatchTool(tool, handlers, fallback) {
  return (handlers[tool] || fallback)?.();
}
