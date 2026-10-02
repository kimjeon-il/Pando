import test from 'node:test';
import assert from 'node:assert/strict';

import {
  taskTargetRefs,
  taskWorkflowPresentation,
} from '../../assets/js/modules/app-task-stage-model.js';

const country = id => ({ id, properties: { unitType: 'country', name: id } });
const unit = (id, type = 'subunit', parentId = 'A') => ({
  id,
  properties: { unitType: type, parentId, sovereignId: 'A', name: id },
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
    countryType: 'country',
    territorialEntityById: get,
  });

  assert.deepEqual(refs.map(ref => [ref.type, ref.id]), [
    ['subunit', 'parent'],
    ['subunit', 'child'],
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
    countryType: 'country',
    territorialEntityById: get,
  });

  assert.equal(view.name, '지방 합병');
  assert.equal(view.cards[0].role, '남길 지방');
  assert.equal(view.resultLabel, '합칠 지방');
  assert.deepEqual(view.resultRefs.map(ref => [ref.type, ref.id]), [['region', 'region-b']]);
});
