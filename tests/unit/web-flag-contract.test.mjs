import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { webFlagContractTrace } from '../helpers/web-flag-contract.mjs';

test('current Web flag edits and stored annotation values match the frozen acceptance contract', async () => {
  const frozen = JSON.parse(readFileSync(new URL('../fixtures/portability/web-flag-contract.json', import.meta.url), 'utf8'));
  assert.deepEqual(await webFlagContractTrace(), frozen.expected);
});
