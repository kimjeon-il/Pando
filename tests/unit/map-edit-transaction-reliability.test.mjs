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
      operation: 'merge',
      payload: { sourceId: 'A' },
      snapshot: { before: true },
      applyResult: result => { calls.push(['apply', result]); },
      validateCanonical: () => ({ ok: true }),
      commitHistory: snapshot => calls.push(['history', snapshot]),
      restore: (snapshot, options) => calls.push(['restore', snapshot, options]),
      queueAutosave: () => calls.push(['autosave']),
      onSuccess: result => calls.push(['success', result]),
      onError: error => calls.push(['error', error.message]),
    },
  };
}

test('country transaction preserves result semantics while using the common transaction', async () => {
  const expected = { affectedIds: ['A'] };
  const fixture = harness(async () => ({ requestId: 7, result: expected }));
  const result = await runMapEditTransaction(fixture.options);
  assert.equal(result.ok, true);
  assert.deepEqual(result.result, expected);
  assert.deepEqual(fixture.calls.map(call => call[0]), ['apply', 'commit', 'history', 'autosave', 'success']);
  assert.deepEqual(fixture.calls.at(-1)[1], expected);
});

test('country transaction validates canonical state before worker commit', async () => {
  const fixture = harness(async () => ({ requestId: 8, result: {} }));
  fixture.options.validateCanonical = () => ({ ok: false, issues: [{ message: 'broken relation' }] });
  const result = await runMapEditTransaction(fixture.options);
  assert.equal(result.ok, false);
  assert.deepEqual(fixture.calls.map(call => call[0]), ['apply', 'discard', 'restore', 'error']);
});

test('country transaction keeps committed state when autosave side effect fails', async () => {
  const fixture = harness(async () => ({ requestId: 9, result: { affectedIds: ['A'] } }));
  fixture.options.queueAutosave = () => { fixture.calls.push(['autosave-attempt']); throw new Error('quota'); };
  const result = await runMapEditTransaction(fixture.options);
  assert.equal(result.ok, true);
  assert.ok(result.autosaveError);
  assert.equal(fixture.calls.some(call => call[0] === 'restore'), false);
  assert.deepEqual(fixture.calls.map(call => call[0]), ['apply', 'commit', 'history', 'autosave-attempt', 'success']);
});

test('cancelled country execute restores without reporting a user error', async () => {
  const fixture = harness(async () => { throw Object.assign(new Error('cancelled'), { cancelled: true }); });
  const result = await runMapEditTransaction(fixture.options);
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.deepEqual(fixture.calls.map(call => call[0]), ['restore']);
});
