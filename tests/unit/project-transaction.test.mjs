import assert from 'node:assert/strict';
import test from 'node:test';

import { runProjectTransaction } from '../../assets/js/modules/project-transaction.js';

test('project transaction executes critical stages in canonical order', async () => {
  const calls = [];
  const result = await runProjectTransaction({
    operationType: 'merge',
    snapshot: { before: true },
    prepare: async () => { calls.push('prepare'); return { value: 1 }; },
    normalize: value => { calls.push('normalize'); return value; },
    validatePrepared: () => { calls.push('validate-prepared'); return { ok: true }; },
    applyCanonical: value => { calls.push('apply'); return value; },
    validateCanonical: () => { calls.push('validate-canonical'); return { ok: true }; },
    commitExternal: () => calls.push('commit-external'),
    commitHistory: () => calls.push('history'),
    queueAutosave: () => calls.push('autosave'),
    onSuccess: () => calls.push('success'),
    restore: () => calls.push('restore'),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    'prepare', 'normalize', 'validate-prepared', 'apply', 'validate-canonical',
    'commit-external', 'history', 'autosave', 'success',
  ]);
});

test('canonical validation failure restores before any external commit', async () => {
  const calls = [];
  const result = await runProjectTransaction({
    operationType: 'merge',
    snapshot: { before: true },
    prepare: async () => ({}),
    applyCanonical: () => { calls.push('apply'); return {}; },
    validateCanonical: () => ({ ok: false, issues: [{ message: 'dangling reference' }] }),
    commitExternal: () => calls.push('commit-external'),
    restore: () => calls.push('restore'),
    onError: () => calls.push('error'),
  });
  assert.equal(result.ok, false);
  assert.equal(result.externalCommitted, false);
  assert.deepEqual(calls, ['apply', 'restore', 'error']);
});

test('history failure remains critical and restores canonical state', async () => {
  const calls = [];
  const result = await runProjectTransaction({
    operationType: 'edit',
    snapshot: { before: true },
    prepare: async () => ({}),
    applyCanonical: value => value,
    commitExternal: () => calls.push('commit'),
    commitHistory: () => { calls.push('history'); throw new Error('history'); },
    queueAutosave: () => calls.push('autosave'),
    restore: () => calls.push('restore'),
    onError: () => calls.push('error'),
  });
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'history');
  assert.equal(result.externalCommitted, true);
  assert.equal(result.historyCommitted, false);
  assert.deepEqual(calls, ['commit', 'history', 'restore', 'error']);
});

test('autosave failure does not roll back a committed canonical edit', async () => {
  const calls = [];
  const result = await runProjectTransaction({
    operationType: 'edit',
    snapshot: { before: true },
    prepare: async () => ({}),
    applyCanonical: value => value,
    commitExternal: () => calls.push('commit'),
    commitHistory: () => calls.push('history'),
    queueAutosave: () => { calls.push('autosave'); throw new Error('autosave'); },
    restore: () => calls.push('restore'),
    onSideEffectError: (_error, context) => calls.push(context.stage),
    onSuccess: () => calls.push('success'),
  });
  assert.equal(result.ok, true);
  assert.equal(result.externalCommitted, true);
  assert.equal(result.historyCommitted, true);
  assert.ok(result.autosaveError);
  assert.deepEqual(calls, ['commit', 'history', 'autosave', 'autosave', 'success']);
});
