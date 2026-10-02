import assert from 'node:assert/strict';
import test from 'node:test';
import { runMapEditTransaction } from '../../assets/js/modules/map-edit-transaction.js';

function harness(execute) {
  const calls = [];
  return {
    calls,
    options: {
      client: {
        execute,
        commit: id => calls.push(['commit', id]),
        discard: id => calls.push(['discard', id]),
      },
      operation: 'merge', payload: { sourceId: 'A' }, snapshot: { before: true },
      applyResult: result => calls.push(['apply', result]),
      commitHistory: snapshot => calls.push(['history', snapshot]),
      restore: (snapshot, options) => calls.push(['restore', snapshot, options]),
      queueAutosave: () => calls.push(['autosave']),
      onSuccess: result => calls.push(['success', result]),
      onError: error => calls.push(['error', error.message]),
    },
  };
}

test('successful edits apply, commit, record history, and autosave once', async () => {
  const fixture = harness(async () => ({ requestId: 7, result: { affectedIds: ['A'] } }));
  const result = await runMapEditTransaction(fixture.options);
  assert.equal(result.ok, true);
  assert.deepEqual(fixture.calls.map(call => call[0]), ['apply', 'commit', 'history', 'autosave', 'success']);
});

test('failed local application discards the worker result and restores the snapshot', async () => {
  const fixture = harness(async () => ({ requestId: 8, result: {} }));
  fixture.options.applyResult = () => { throw new Error('apply failed'); };
  const result = await runMapEditTransaction(fixture.options);
  assert.equal(result.ok, false);
  assert.deepEqual(fixture.calls.map(call => call[0]), ['discard', 'restore', 'error']);
});

test('cancelled edits restore silently without duplicate error reporting', async () => {
  const fixture = harness(async () => { throw Object.assign(new Error('cancelled'), { cancelled: true }); });
  const result = await runMapEditTransaction(fixture.options);
  assert.equal(result.cancelled, true);
  assert.deepEqual(fixture.calls.map(call => call[0]), ['restore']);
});
