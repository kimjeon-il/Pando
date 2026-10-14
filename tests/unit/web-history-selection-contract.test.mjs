import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { captureWebHistorySelectionContract } from '../helpers/web-history-selection-contract.mjs';

test('actual Web app history clears stored and builtin selections on changed Undo/Redo while retaining hover', () => {
  const expected = JSON.parse(readFileSync(new URL('../fixtures/portability/web-history-selection-contract.json', import.meta.url), 'utf8'));
  assert.deepEqual(captureWebHistorySelectionContract(), expected);
});
