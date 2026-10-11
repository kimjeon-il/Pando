import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { replaceTimelineRecordAtMonth, truncateTimelineEntityAtMonth } from '../../assets/js/modules/timeline-edit.js';
import { normalizeTimelineRecords } from '../../assets/js/modules/timeline-records.js';

const corpus = JSON.parse(readFileSync(new URL('../fixtures/portability/timeline-edit.json', import.meta.url), 'utf8'));
const context = { entities: corpus.entities, geometryExists: () => true };

test('historical timeline edits match the shared web/native golden corpus', () => {
  assert.equal(corpus.schema, 'timeline-edit-parity-v1');
  assert.equal(corpus.cases.length, 5);
  normalizeTimelineRecords(corpus.records, context);
  for (const entry of corpus.cases) {
    const original = structuredClone(corpus.records);
    let result;
    if (entry.op === 'geometry') result = replaceTimelineRecordAtMonth(original, 'geometryBindings',
      'A', entry.month, { geometryRef: { id: 'shape', version: entry.version } });
    else if (entry.op === 'parent') result = replaceTimelineRecordAtMonth(original, 'parentRelations',
      'A', entry.month, { parentId: entry.parentId, coverageMode: entry.coverageMode });
    else if (entry.op === 'truncate') result = truncateTimelineEntityAtMonth(original, 'A', entry.month);
    else assert.fail('Unknown edit operation');
    assert.deepEqual(result, entry.expected, entry.name);
    assert.deepEqual(original, corpus.records, entry.name + ' must not mutate source');
    if (entry.identity) assert.strictEqual(result, original, entry.name + ' should be a no-op');
    normalizeTimelineRecords(result, context);
  }
});
