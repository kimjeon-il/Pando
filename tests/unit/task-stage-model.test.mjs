import test from 'node:test';
import assert from 'node:assert/strict';

import {
  taskTargetRefs,
  taskWorkflowPresentation,
  editingContextPresentation,
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

test('split target is presented in the original card and preview, not a new picking step', () => {
  const get = resolver([country('DEU'), unit('SUB-1')]);
  const state = { tool: 'split-territorial-unit', territorialUnitSplitSourceId: 'SUB-1',
    geometryPreview: { session: null } };
  const before = structuredClone(state);
  const view = taskWorkflowPresentation(state, null, {}, { territorialEntityById: get });
  assert.deepEqual([view.name, view.stage, view.step, view.total],
    ['영역 나누기', '경계 그리기', 1, 2]);
  assert.deepEqual(view.cards.map(card => [card.role, card.refs.map(ref => ref.id)]),
    [['나눌 영역', ['SUB-1']]]);
  assert.deepEqual(taskTargetRefs(state, { territorialEntityById: get }).map(ref => ref.id), ['SUB-1']);
  assert.deepEqual(state, before);
  state.geometryPreview.session = { validation: { blocking: false } };
  const review = taskWorkflowPresentation(state, null, {}, { territorialEntityById: get });
  assert.deepEqual([review.stage, review.step, review.total], ['분할 확인', 2, 2]);
  assert.deepEqual(review.cards, []);
});

test('generic and virtual split sources preserve identity without fictitious selection', () => {
  const generic = { tool: 'split-generic-feature', genericFeatureSplitSourceId: 'G',
    genericFeatures: [{ id: 'G' }], geometryPreview: { session: null } };
  assert.deepEqual(taskWorkflowPresentation(generic).cards[0].refs.map(ref => [ref.domain, ref.type, ref.id]),
    [['generic', 'feature', 'G']]);
  assert.deepEqual(taskTargetRefs(generic).map(ref => ref.type), ['feature']);
  const virtual = { tool: 'split-territorial-unit', territorialUnitSplitVirtualSource: { geometry: {} },
    geometryPreview: { session: null } };
  assert.deepEqual(taskWorkflowPresentation(virtual).cards[0].refs, []);
  assert.equal(taskWorkflowPresentation(virtual).cards[0].placeholder, '현재 영역');
  assert.equal(editingContextPresentation({ state: virtual, targets: [] }).targetSummary, '현재 영역');
  assert.equal(taskWorkflowPresentation({ tool: 'split-territorial-unit', geometryPreview: { session: null } }), null);
});

test('subunit annex keeps its setup/selection/review steps and avoids repeating target information', () => {
  const get = resolver([country('ROOT'), unit('RECEIVER','subunit','ROOT'), unit('DONOR','subunit','ROOT')]);
  const selection = {
    tool: 'draw-territorial-unit', kind: 'entity', editOperation: 'annex',
    editTargetId: 'RECEIVER', taskLabel: '영역 편입', name: '받는 하위단위',
    parentId: 'ROOT', sourceKey: 'DONOR', sourceCountryIds: [], stage: 'setup',
  };
  const state = {tool: selection.tool, territorySelectionSession: selection, geometryPreview: {session:null}};
  const snapshot = structuredClone(state);
  const model = {current:selection,step:1,stageLabel:'객체 정보'};
  const setup = taskWorkflowPresentation(state,model,{}, {territorialEntityById:get});
  assert.deepEqual([setup.name,setup.stage,setup.step,setup.total],['영역 편입','가져올 영역',1,3]);
  assert.deepEqual(setup.cards.map(card=>[card.role,card.refs.map(ref=>ref.id)]),
    [['넘겨받는 객체',['RECEIVER']]]);
  assert.deepEqual(taskTargetRefs(state,{territorialEntityById:get}).map(ref=>ref.id),
    ['RECEIVER','ROOT','DONOR']);
  assert.deepEqual(state,snapshot);
  selection.stage='selection';model.step=2;model.stageLabel='영역 선택';
  const drawing=taskWorkflowPresentation(state,model,{}, {territorialEntityById:get});
  assert.deepEqual([drawing.stage,drawing.step,drawing.total],['영역 선택',2,3]);
  assert.deepEqual(drawing.cards,[]);
  assert.equal(editingContextPresentation({state,targets:[
    {name:'받는 하위단위'},{name:'상위 객체'},{name:'주는 하위단위'}]}).targetSummary,'받는 하위단위');
  selection.stage='review';model.step=3;model.stageLabel='생성 확인';
  state.geometryPreview.session={validation:{blocking:false}};
  const review=taskWorkflowPresentation(state,model,{}, {territorialEntityById:get});
  assert.deepEqual([review.name,review.stage,review.step,review.total],
    ['영역 편입','편입 확인',3,3]);
  assert.deepEqual(review.cards,[]);
});

test('ordinary creation retains its existing setup label and no annex card',()=>{
  const selection={kind:'entity',tool:'draw-territorial-unit',stage:'setup',name:'새 객체',
    parentId:'ROOT',sourceKey:'DONOR',sourceCountryIds:[]};
  const model={current:selection,step:1,stageLabel:'객체 정보'};
  const view=taskWorkflowPresentation({tool:selection.tool,territorySelectionSession:selection,geometryPreview:{session:null}},model);
  assert.deepEqual([view.stage,view.step,view.total,view.cards.length],['객체 정보',1,3,0]);
});
