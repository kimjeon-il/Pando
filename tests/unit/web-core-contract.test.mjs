import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { webCoreContractTrace } from '../helpers/web-core-contract.mjs';

test('current Web normal, no-op, error, cancel and undo state matches the frozen complete territorial fixture', async () => {
  const frozen = JSON.parse(readFileSync(new URL('../fixtures/portability/web-core-contract.json', import.meta.url), 'utf8'));
  assert.deepEqual(await webCoreContractTrace(), frozen.expected);
});
