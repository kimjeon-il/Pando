import assert from 'node:assert/strict';
import test from 'node:test';
import * as stage from '../../assets/js/modules/app-task-stage-model.js';

const state = overrides => ({
  tool: 'annex-territory', territorialEntities: [], geometryPreview: { session: null },
  boundaryEditEntityIds: [], mergeTargetCountryIds: [], territorialUnitMergeTargetIds: [],
  ...overrides,
});

test('territory selection has no repeated role cards or targets in its selection stage', () => {
  assert.equal(typeof stage.taskWorkflowPresentation, 'function');
  const current = { kind: 'annex', taskLabel: '영토 편입', stage: 'selection', targetCountryId: 'GRC', sourceCountryIds: ['TUR', 'BGR'] };
  const original = structuredClone(current);
  const view = stage.taskWorkflowPresentation(state({ territorySelectionSession: current }), { current, step: 2, stageLabel: '영토 선택' });
  assert.equal(view.name, '영토 편입');
  assert.deepEqual([view.step, view.total], [2, 3]);
  assert.deepEqual(view.cards, []);
  assert.deepEqual(current, original);
});

test('annex setup role cards keep every donating country in the current order', () => {
  const current = { kind: 'annex', taskLabel: '영토 편입', stage: 'setup', targetCountryId: 'GRC', sourceCountryIds: ['TUR', 'BGR'] };
  const view = stage.taskWorkflowPresentation(state({ territorySelectionSession: current }), { current, step: 1, stageLabel: '가져올 국가' });
  assert.equal(view.relation, '←');
  assert.deepEqual(view.cards.map(card => [card.role, card.refs.map(ref => ref.id)]), [
    ['넘겨받는 객체', ['GRC']], ['넘겨주는 객체', ['TUR', 'BGR']],
  ]);
});

test('merge presents the survivor separately and derives exact removable targets without mutation', () => {
  const input = state({ tool: 'merge-country', mergeSourceCountryId: 'DEU', mergeTargetCountryIds: ['POL', 'CZE'] });
  const view = stage.taskWorkflowPresentation(input);
  assert.equal(view.cards[0].role, '남길 국가');
  assert.deepEqual(view.cards[0].refs.map(ref => ref.id), ['DEU']);
  assert.equal(view.resultLabel, '합칠 국가');
  assert.deepEqual(view.resultRefs.map(ref => ref.id), ['POL', 'CZE']);
  assert.deepEqual([view.stage, view.step, view.total], ['합칠 국가', 1, 2]);
  input.geometryPreview.session = { validation: { blocking: false } };
  assert.deepEqual([stage.taskWorkflowPresentation(input).stage, stage.taskWorkflowPresentation(input).step], ['합병 확인', 2]);
  assert.deepEqual(input.mergeTargetCountryIds, ['POL', 'CZE']);
});

test('subunit boundary uses logical unit identities and does not invent a target-picking phase', () => {
  const input = state({ tool: 'territorial-border', boundaryEditPhase: 'editing', boundaryEditSeedEntityId: 'SUB-1',
    boundaryEditEntityIds: ['SUB-1', 'SUB-2', 'SUB-3'], territorialEntities: ['SUB-1', 'SUB-2', 'SUB-3'].map(id => ({ id, properties: { unitType: 'subunit' } })) });
  const byId = new Map(input.territorialEntities.map(unit => [String(unit.id), unit]));
  const view = stage.taskWorkflowPresentation(input, null, {}, {
    territorialEntityById: id => byId.get(String(id)) || null,
  });
  assert.deepEqual([view.name, view.stage, view.step, view.total], ['경계 조정', '경계 편집', 1, 2]);
  assert.equal(view.relation, '↔');
  assert.deepEqual(view.cards[1].refs.map(ref => [ref.type, ref.id]), [['subunit', 'SUB-2'], ['subunit', 'SUB-3']]);
});

test('free distribution stays a single immediate-apply step while hydro derives review from existing parts', () => {
  const distribution = stage.taskWorkflowPresentation(state({ tool: 'polygon', distributionDraft: { layerId: 'density', value: 120 } }));
  assert.deepEqual([distribution.name, distribution.stage, distribution.step, distribution.total], ['자유 영역 그리기', '영역 그리기', 1, 1]);
  const hydro = state({ tool: 'river', multiDraft: { kind: 'hydro', shape: 'line', parts: [{ geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0]] } }], current: null } });
  assert.deepEqual([stage.taskWorkflowPresentation(hydro).stage, stage.taskWorkflowPresentation(hydro).step], ['생성 확인', 2]);
  assert.equal(stage.taskWorkflowPresentation(hydro, null, { coords: [[0, 0]] }).step, 1);
});

const feedback = overrides => stage.taskStagePresentation({
  state: state({ modeProcessing: false, ...overrides.state }), selection: null, selectionModel: null,
  draft: { coords: [], issues: [] }, toolbar: { editable: false }, primaryDisabled: true,
  mergeTargetMode: true, ...overrides,
});

test('analyzed disconnected boundaries remain blocking feedback, unlike missing targets', () => {
  const rejected = feedback({ boundaryAnalysis: { analyzed: true, valid: false, selectedIds: ['DEU', 'JPN'], message: '선택 국가 사이에 연결된 공유국경이 없습니다.' } });
  assert.equal(rejected.status, 'invalid');
  assert.equal(rejected.feedbackVisible, true);
  assert.equal(rejected.reason, '선택 국가 사이에 연결된 공유국경이 없습니다.');
  assert.equal(feedback({ boundaryAnalysis: { analyzed: true, valid: false, selectedIds: ['DEU'], message: '접경국을 하나 이상 더 선택하세요.' } }).feedbackVisible, false);
});

test('ordinary missing targets remain accessible but are not visual feedback', () => {
  const view = feedback({});
  assert.equal(view.status, 'needs-target');
  assert.equal(view.reason, '합칠 대상을 하나 이상 선택하세요.');
  assert.equal(view.feedbackVisible, false);
});

test('river partition progress, failures and excluded donors retain one feedback slot', () => {
  for (const status of ['loading', 'error', 'source-error', 'ready']) {
    const selection = { stage: 'selection', activeMethod: 'components', useRiverBoundaries: true,
      riverPartitionStatus: status, riverPartitionDonorResults: status === 'ready' ? [{ donorCountryId: 'TUR', status: 'invalid' }] : [] };
    const view = feedback({ selection });
    assert.equal(view.instructionFeedback, true, status);
    assert.equal(view.status, status === 'loading' ? 'preparing' : status === 'ready' ? 'editable' : 'invalid');
    assert.equal(view.reason, '', 'the authoritative banner must not be duplicated');
  }
  assert.equal(feedback({ selection: { useRiverBoundaries: true, activeMethod: 'components', riverPartitionStatus: 'ready', riverPartitionDonorResults: [] } }).instructionFeedback, false);
});

test('blocking preview and boundary failure remain visible even when missing targets or an enabled retry exist', () => {
  const blocking = feedback({ state: state({ geometryPreview: { session: { validation: { blocking: true, issues: [{ severity: 'error', message: '자기 교차 경계입니다.' }] } } } }) });
  assert.equal(blocking.reason, '자기 교차 경계입니다.');
  assert.equal(blocking.feedbackVisible, true);
  const failure = feedback({ primaryDisabled: false, boundaryFailed: true, state: state({ boundaryPreparation: { status: 'error', message: '경계 계산에 실패했습니다.' } }) });
  assert.equal(failure.reason, '경계 계산에 실패했습니다.');
  assert.equal(failure.feedbackVisible, true);
});

test('setup hides a preserved territory preview error without changing its validation', () => {
  const selection = { tool: 'annex-territory', stage: 'setup' };
  const preview = { validation: { blocking: true, issues: [{ severity: 'error', message: '자기 교차 경계입니다.' }] } };
  const original = structuredClone(preview);
  const options = { selection, state: state({ territorySelectionSession: selection, geometryPreview: { session: preview } }),
    primaryDisabled: false, mergeTargetMode: false };
  const setup = feedback(options);
  assert.equal(setup.feedbackVisible, false);
  assert.equal(setup.status, 'editable');
  assert.equal(setup.reason, '');
  assert.deepEqual(preview, original);

  selection.stage = 'selection';
  const restored = feedback(options);
  assert.equal(restored.feedbackVisible, true);
  assert.equal(restored.reason, preview.validation.issues[0].message);
  assert.deepEqual(preview, original);

  selection.stage = 'setup';
  selection.tool = 'subunit';
  assert.equal(feedback(options).feedbackVisible, true, 'another tool must retain its preview validation');
});
