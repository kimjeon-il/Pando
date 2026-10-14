import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { captureWebSelectionContract } from '../helpers/web-selection-contract.mjs';

test('current Web selection ordering, typed identity, scope anchors, hover cancellation and no-ops remain frozen', () => {
  const expected = JSON.parse(readFileSync(new URL('../fixtures/portability/web-selection-contract.json', import.meta.url), 'utf8'));
  assert.deepEqual(captureWebSelectionContract(), expected);
});
