import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeCoreDocument } from '../helpers/core-session.mjs';
import { createCoreDocumentReadModel } from "../../shared/frontend/js/modules/core-document-read-model.js";

test('the whole document Worker preserves every semantic world field and distinct query/cursor precision contracts', async () => {
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
      // The frozen semantic rows predate explicit object identity and rendering DTO fields.
      const expected = row.expected.map(entity => ({ ...entity,
        objectRef: { domain: 'territorial', id: entity.id }, rendering: {} }));
      assert.deepEqual(world.entities, expected, row.month);
      for (const entity of world.entities) {
        assert.equal(world.byId.get(entity.id),entity);
        assert.equal(entity.geometry,model.geometry(entity.geometryRef));
        assert.equal(entity.identity,model.snapshot().territorialEntities.find(value => value.id === entity.id));
      }
      assert.deepEqual(client.state(),state, 'Queries cannot create dirty/history/revision changes.');
    }
    // Queries accept source precision; navigation still requires a month.
    // The fixture's July 1914 state remains unchanged through the year end.
    const year = model.projectWorld(await client.resolveWorld('1914'),state.epoch);
    assert.equal(year.month,'1914');assert.equal(year.sourceEpoch,state.epoch);
    assert.deepEqual(year.entities,corpus.cases.find(row=>row.month==='1914-07').expected.map(entity=>({
      ...entity,objectRef:{domain:'territorial',id:entity.id},rendering:{},
    })));
    await assert.rejects(client.setTimelineCursor('1914'), { code: 'INVALID_TIMELINE_CURSOR' });
    await assert.rejects(client.resolveWorld('1914-13'), { code: 'PL-TEMPORAL-001' });
    await assert.rejects(client.resolveWorld('0000-01'), { code: 'PL-TEMPORAL-001' });
    assert.deepEqual(client.state(),state,'Read queries and rejected cursor/calendar input preserve the complete session state.');
  } finally { client.dispose(); }
});
