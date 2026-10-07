import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commandHistoryTrace } from '../../tools/parity/command-history.mjs';
import { compareObservations } from '../../tools/parity/contract.mjs';
const corpus = JSON.parse(readFileSync(new URL('../fixtures/portability/command-history.json', import.meta.url)));

test('current command/history observer matches the saved-state contract', () => {
  const trace = commandHistoryTrace(corpus);
  assert.equal(trace.length, corpus.operations.length);
  for (const [index, operation] of corpus.operations.entries()) {
    assert.deepEqual(trace[index], operation.expected);
    const differences = compareObservations(trace[index], operation.expected, operation.expected);
    assert.deepEqual(differences, []);
  }
});
test('unsupported scenario operations cannot silently become observations', () => {
  const invalid = structuredClone(corpus); invalid.operations[0].op = 'invented';
  assert.throws(() => commandHistoryTrace(invalid), /Unknown operation/);
});
