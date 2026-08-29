import assert from 'node:assert/strict';
import test from 'node:test';

import { createHistoryService } from '../../assets/js/modules/history-service.js';

test('history service owns bounded record, undo, redo, and future invalidation', () => {
  const store = { history: [], historyMeta: [], future: [], futureMeta: [] };
  let value = 0;
  let records = 0;
  const service = createHistoryService({
    store,
    maxEntries: 2,
    snapshot: () => value,
    restore: next => { value = next; },
    normalizeMetadata: meta => ({ description: meta.description || 'edit' }),
    onRecord: () => { records += 1; },
  });
  service.record({ description: 'zero' });
  value = 1;
  service.record({ description: 'one' });
  value = 2;
  service.record({ description: 'two' });
  assert.deepEqual(store.history, [1, 2]);
  value = 3;
  assert.equal(service.undo({ description: 'undo' }), true);
  assert.equal(value, 2);
  assert.equal(service.redo({ description: 'redo' }), true);
  assert.equal(value, 3);
  service.undo();
  value = 9;
  service.record({ description: 'new' });
  assert.equal(service.canRedo(), false);
  assert.equal(records, 4);
});

test('discard and reset keep snapshots and metadata aligned', () => {
  const store = { history: [], historyMeta: [], future: [], futureMeta: [] };
  const service = createHistoryService({
    store,
    maxEntries: 5,
    snapshot: () => 'snapshot',
    restore() {},
    normalizeMetadata: meta => meta,
  });
  service.record({ id: 1 });
  assert.equal(service.discardLast(), true);
  assert.deepEqual(store.historyMeta, []);
  service.record({ id: 2 });
  service.reset();
  assert.equal(service.canUndo(), false);
  assert.equal(service.canRedo(), false);
});
