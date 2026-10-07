import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commandHistoryTrace } from '../../tools/parity/command-history.mjs';
import { compareObservations } from '../../tools/parity/contract.mjs';
const corpus = JSON.parse(readFileSync(new URL('../fixtures/portability/command-history.json', import.meta.url)));

test('current command/history observer preserves the Web save-token behavior', () => {
  const trace = commandHistoryTrace(corpus);
  assert.equal(trace.length, corpus.operations.length);
  // Reviewed current behavior, not the shared desired result. Keep the
  // discrepancy visible until a separately authorized product change.
  const dirtyDifferences = new Set(['undo-to-save', 'redo-to-save']);
  for (const [index, operation] of corpus.operations.entries()) {
    assert.deepEqual(trace[index], { ...operation.expected,
      dirty: dirtyDifferences.has(operation.id) ? true : operation.expected.dirty });
    const differences = compareObservations(trace[index], operation.expected, operation.expected);
    assert.deepEqual(differences.map(row => row.path), dirtyDifferences.has(operation.id) ? ['/dirty'] : []);
  }
});
test('unsupported scenario operations cannot silently become observations', () => {
  const invalid = structuredClone(corpus); invalid.operations[0].op = 'invented';
  assert.throws(() => commandHistoryTrace(invalid), /Unknown operation/);
});
