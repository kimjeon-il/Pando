import test from 'node:test';
import assert from 'node:assert/strict';

import {
  taskTargetRefs,
  taskWorkflowPresentation,
} from '../../assets/js/modules/app-task-stage-model.js';

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
