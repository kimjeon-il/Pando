import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { originalHydroAggregation } from '../helpers/web-hydro-hidden-oracle.mjs';
import { createNodeCoreProject } from '../helpers/core-project.mjs';

const logicalId = 'river:aggregate';
const fragment = sourceId => ({ type: 'Feature', id: `${logicalId}:fragment`,
  properties: { pandolab_id: logicalId, category: 'river', layer_id: 'rivers', source_id: sourceId, fragment_index: 0, __fid: 2 },
  geometry: { type: 'LineString', coordinates: [[1.125, 2.25], [3.5, 4.75]] } });
const cases = [
  { name: 'true source suffix', hidden: { 'source:101': true, 'source:102': false, unrelated: true }, expected: { 'source:101': true, 'source:102': false, unrelated: true, [logicalId]: true } },
  { name: 'false or unknown source', hidden: { 'source:101': false, 'source:999': true }, expected: { 'source:101': false, 'source:999': true } },
  { name: 'existing logical hide', hidden: { [logicalId]: true, 'source:102': false }, expected: { [logicalId]: true, 'source:102': false } },
];
test('frozen original hydro aggregation adds only true source hidden aliases without touching project clocks', () => {
  for (const row of cases) {
    const result = originalHydroAggregation(logicalId, [fragment('101,102')], row.hidden);
    assert.deepEqual(result.hiddenHydroIds, row.expected, row.name);
    assert.equal(result.stateRevision, 17); assert.equal(result.dirty, false);
    assert.equal(result.aggregate.id, logicalId);
    assert.equal(result.aggregate.properties.source_id, '101,102');
  }
});
test('builtin catalog admission preserves creation metadata and save/history clocks', async t => {
  for (const row of cases) {
    const seed = JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json', import.meta.url), 'utf8'));
    const owner = await createNodeCoreProject(seed); t.after(() => owner.dispose());
    const before = owner.client.state();
    await owner.project.admitSelectionCatalog('hydroBuiltin', [{ domain: 'hydroBuiltin', type: 'river', id: logicalId, logicalId, sourceIds: ['101', '102'] }]);
    assert.deepEqual(owner.documentModel.snapshot().projectSetup,seed.projectSetup);assert.equal(Object.hasOwn(owner.documentModel.snapshot(),'itemVisibility'),false);
    const after = owner.client.state();
    for (const key of ['stateRevision', 'checkpoint', 'documentDirty', 'presentationDirty', 'presentationCheckpoint', 'canUndo', 'canRedo'])
      assert.equal(after[key], before[key], `${row.name}: ${key}`);
    assert.deepEqual(owner.documentModel.snapshot().territorialEntities, seed.territorialEntities);
    assert.deepEqual(owner.documentModel.snapshot().timelineRecords, seed.timelineRecords);
  }
});
