import test from 'node:test';
import assert from 'node:assert/strict';

import {
  taskTargetRefs,
  taskWorkflowPresentation,
} from "../../apps/editor/frontend/js/modules/app-task-stage-model.js";

const country = id => ({ id, properties: { entityKind: 'general', name: id } });
const unit = (id, type = 'subunit', parentId = 'A') => ({
  id,
  properties: { entityKind: type === 'region' ? 'regional' : 'general', parentId: type === 'region' ? '' : parentId, name: id },
});

function resolver(entities) {
  const byId = new Map(entities.map(entity => [String(entity.id), entity]));
  return id => byId.get(String(id)) || null;
}

test('task target refs resolve countries and units through the territorial entity surface', () => {
  const get = resolver([country('A'), unit('parent'), unit('child', 'subunit', 'parent')]);
  const state = {
    tool: 'merge-territorial-unit',
    territorialUnitMergeSourceId: 'parent',
    territorialUnitMergeTargetIds: ['child'],
    genericFeatures: [],
  };
  const refs = taskTargetRefs(state, {
    territorialEntityById: get,
  });

  assert.deepEqual(refs.map(ref => [ref.type, ref.id]), [
    ['entity', 'parent'],
    ['entity', 'child'],
  ]);
});

test('task workflow presentation derives territorial type without raw unit storage', () => {
  const get = resolver([country('A'), unit('region-a', 'region'), unit('region-b', 'region')]);
  const view = taskWorkflowPresentation({
    tool: 'merge-territorial-unit',
    territorialUnitMergeSourceId: 'region-a',
    territorialUnitMergeTargetIds: ['region-b'],
    geometryPreview: { session: null },
  }, null, {}, {
    territorialEntityById: get,
  });

  assert.equal(view.name, '객체 합병');
  assert.equal(view.cards[0].role, '남길 객체');
  assert.equal(view.resultLabel, '합칠 객체');
  assert.deepEqual(view.resultRefs.map(ref => [ref.type, ref.id]), [['entity', 'region-b']]);
});

test('editing context distinguishes inspection, impact, preview and temporary panning', async () => {
 const {editingContextPresentation}=await import("../../apps/editor/frontend/js/modules/app-task-stage-model.js");
 const state={tool:'territorial-border',geometryPreview:{session:null}};
 const options={state,draft:{coords:[[0,0]],inputPhase:'refine'},month:'1914-07',targets:[{name:'A'},{name:'B'}]};
 const draft=editingContextPresentation(options);assert.equal(draft.stage,'초안');assert.equal(draft.period,'변경 기간 계산 전');assert.match(draft.view,/월 말/);
 state.geometryPreview.session={temporalImpact:[{entityId:'A',from:'1914-07-01',until:'1915-01-01'}]};
 const preview=editingContextPresentation(options);assert.equal(preview.stage,'미리보기');assert.match(preview.period,/1915-01-01 전까지/);assert.equal(preview.targetSummary,'A 외 1개');
 state.spacePanActive=true;assert.equal(editingContextPresentation(options).instruction,'지도 이동 중 · 놓으면 편집 계속');
 state.geometryPreview.session.status='applying';assert.equal(editingContextPresentation(options).stage,'적용 중');
});

test('nested subunit merge uses precise terms without changing its steps or object refs', () => {
  const get = resolver([country('A'), unit('SUB-1'), unit('SUB-2')]);
  const state = {
    tool: 'merge-territorial-unit',
    territorialUnitMergeSourceId: 'SUB-1',
    territorialUnitMergeTargetIds: ['SUB-2'],
    geometryPreview: { session: null },
  };
  const view = taskWorkflowPresentation(state, null, {}, { territorialEntityById: get });
  assert.equal(view.name, '하위단위 합병');
  assert.equal(view.stage, '합칠 하위단위');
  assert.equal(view.cards[0].role, '남길 하위단위');
  assert.equal(view.resultLabel, '합칠 하위단위');
  assert.deepEqual(view.resultRefs.map(ref => ref.id), ['SUB-2']);
  assert.deepEqual([view.step, view.total], [1, 2]);

  state.geometryPreview.session = { validation: { blocking: false } };
  const review = taskWorkflowPresentation(state, null, {}, { territorialEntityById: get });
  assert.deepEqual([review.name, review.stage, review.step], ['하위단위 합병', '합병 확인', 2]);
  assert.deepEqual(state.territorialUnitMergeTargetIds, ['SUB-2']);
});

test('country and independent region wording stays as before; generic feature merge remains unavailable', () => {
  const get = resolver([country('A'), country('B'), unit('REG-1', 'region'), unit('REG-2', 'region')]);
  const countryView = taskWorkflowPresentation({
    tool: 'merge-country', mergeSourceCountryId: 'A', mergeTargetCountryIds: ['B'],
    geometryPreview: { session: null },
  }, null, {}, { territorialEntityById: get });
  assert.deepEqual([countryView.name, countryView.cards[0].role, countryView.resultLabel],
    ['객체 합병', '남길 객체', '합칠 객체']);

  const regionView = taskWorkflowPresentation({
    tool: 'merge-territorial-unit', territorialUnitMergeSourceId: 'REG-1',
    territorialUnitMergeTargetIds: ['REG-2'], geometryPreview: { session: null },
  }, null, {}, { territorialEntityById: get });
  assert.deepEqual([regionView.name, regionView.cards[0].role, regionView.resultLabel],
    ['객체 합병', '남길 객체', '합칠 객체']);

  const removedGenericView = taskWorkflowPresentation({
    tool: 'merge-generic-feature', genericFeatureMergeSourceId: 'GEN-1',
    genericFeatureMergeTargetIds: ['GEN-2'], geometryPreview: { session: null },
  }, null, {}, { territorialEntityById: get });
  assert.equal(removedGenericView, null);
});

test('country border selection uses country roles while subunit boundary retains its existing flow', () => {
  const get = resolver([country('DEU'), country('POL'), unit('SUB-1'), unit('SUB-2')]);
  const state = {
    tool: 'territorial-border', boundaryEditSeedEntityId: 'DEU',
    boundaryEditEntityIds: ['DEU'], boundaryEditPhase: 'selecting',
    geometryPreview: { session: null },
  };
  const view = taskWorkflowPresentation(state, null, {}, { territorialEntityById: get });
  assert.deepEqual([view.name, view.stage, view.step, view.total],
    ['국경 조정', '상대 국가', 1, 3]);
  assert.deepEqual(view.cards.map(card => [card.role, card.placeholder]),
    [['기준 국가', '선택'], ['상대 국가', '국가 선택']]);
  state.boundaryEditEntityIds.push('POL');
  assert.deepEqual(taskWorkflowPresentation(state, null, {}, { territorialEntityById: get }).cards[1].refs.map(ref => ref.id), ['POL']);

  state.boundaryEditSeedEntityId = 'SUB-1';
  state.boundaryEditEntityIds = ['SUB-1', 'SUB-2'];
  state.boundaryEditPhase = 'editing';
  const subunitView = taskWorkflowPresentation(state, null, {}, { territorialEntityById: get });
  assert.deepEqual([subunitView.name, subunitView.stage, subunitView.step, subunitView.total],
    ['경계 조정', '경계 편집', 1, 2]);
  assert.equal(subunitView.cards[0].role, '기준 객체');
});
