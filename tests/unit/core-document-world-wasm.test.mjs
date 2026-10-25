import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeCoreDocument } from '../helpers/core-session.mjs';
import { createCoreDocumentReadModel } from "../../shared/frontend/js/modules/core-document-read-model.js";

test('the whole document Worker resolves every frozen Web world field through its own Project and immutable read model', async () => {
  const input = JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/complex.json',import.meta.url),'utf8'));
  const corpus = JSON.parse(readFileSync(new URL('../fixtures/portability/web-timeline-read-model.json',import.meta.url),'utf8'));
  const model = createCoreDocumentReadModel(input), client = createNodeCoreDocument();
  try {
    await client.load(JSON.stringify(input));
    const state = client.state();
    assert.equal(typeof state.timelineCursor, 'string', 'C++ chooses the initial month from the explicit UTC clock input.');
    for (const row of corpus.cases) {
      const world = model.projectWorld(await client.resolveWorld(row.month),client.state().epoch);
      assert.equal(world.month, row.month); assert.equal(world.sourceEpoch, state.epoch);
      assert.deepEqual(world.entities, row.expected, row.month);
      for (const entity of world.entities) {
        assert.equal(world.byId.get(entity.id),entity);
        assert.equal(entity.geometry,model.geometry(entity.geometryRef));
        assert.equal(entity.identity,model.snapshot().territorialEntities.find(value => value.id === entity.id));
      }
      assert.deepEqual(client.state(),state, 'Queries cannot create dirty/history/revision changes.');
    }
    await assert.rejects(client.resolveWorld('1914'), { code: 'INVALID_TIMELINE_CURSOR' });
    await assert.rejects(client.resolveWorld('0000-01'), { code: 'PL-TEMPORAL-001' });
  } finally { client.dispose(); }
});
