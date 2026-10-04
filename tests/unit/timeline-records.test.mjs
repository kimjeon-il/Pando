import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTemporal } from '../../assets/js/modules/temporal.js';
import { normalizeTimelineRecords } from '../../assets/js/modules/timeline-records.js';
import { timelineCases, timelineContext } from '../fixtures/timeline-records-cases.mjs';

for (const row of timelineCases()) {
  test(row.name, () => {
    const before = structuredClone(row.input);
    const contextBefore = structuredClone(row.context);
    if (row.expected === 'OK') {
      const result = normalizeTimelineRecords(row.input, timelineContext(row.context));
      assert.equal(result.schemaVersion, 1);
      const expected = structuredClone(before);
      for (const name of ['lifetimes', 'geometryBindings', 'parentRelations']) {
        for (const record of expected[name]) {
          record.validFrom = normalizeTemporal(record.validFrom);
          record.validTo = normalizeTemporal(record.validTo);
        }
      }
      assert.deepEqual(result, expected, 'only endpoint normalization may change record content');
      assert.deepEqual(normalizeTimelineRecords(JSON.parse(JSON.stringify(result)), timelineContext(row.context)), result);
      assert.notEqual(result, row.input);
      assert.ok(Object.isFrozen(result));
      for (const name of ['lifetimes', 'geometryBindings', 'parentRelations']) {
        assert.ok(Object.isFrozen(result[name]));
        assert.ok(result[name].every(Object.isFrozen));
      }
      if (row.name === 'normalized endpoints retain precision') {
        assert.equal(result.lifetimes[1].validFrom, '1914-07');
        assert.equal(result.lifetimes[1].validTo, '1915-02-03');
      }
      for (const name of ['lifetimes', 'geometryBindings', 'parentRelations']) row.input[name].reverse();
      assert.doesNotThrow(() => normalizeTimelineRecords(row.input, timelineContext(row.context)));
      for (const name of ['lifetimes', 'geometryBindings', 'parentRelations']) row.input[name].reverse();
    } else {
      assert.throws(() => normalizeTimelineRecords(row.input, timelineContext(row.context)), { code: row.expected });
    }
    assert.deepEqual(row.input, before, 'validation must not mutate input');
    assert.deepEqual(row.context, contextBefore, 'validation must not mutate catalog');
  });
}

test('required geometry dependency cannot be silently omitted', () => {
  const { input, context } = timelineCases()[0];
  assert.throws(() => normalizeTimelineRecords(input, { entities: context.entities }), { code: 'TIMELINE_CONTEXT' });
});
test('unexpected geometry repository failure propagates unchanged', () => {
  const { input, context } = timelineCases()[0];
  const failure = new Error('repository unavailable');
  assert.throws(() => normalizeTimelineRecords(input, { entities: context.entities, geometryExists() { throw failure; } }), error => error === failure);
});
test('returned references do not alias input and cannot be edited', () => {
  const { input, context } = timelineCases()[0];
  const result = normalizeTimelineRecords(input, timelineContext(context));
  const ref = result.geometryBindings[0].geometryRef;
  input.geometryBindings[0].geometryRef.id = 'changed-after-validation';
  assert.equal(ref.id, 'shape-a');
  assert.throws(() => { ref.version = 99; }, TypeError);
});
