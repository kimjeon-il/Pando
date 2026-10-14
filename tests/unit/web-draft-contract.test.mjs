import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { captureWebDraftContract } from '../helpers/web-draft-contract.mjs';

test('actual Web draft coordinates, selected vertex, phase, gestures and local history remain frozen', async () => {
  const expected = JSON.parse(readFileSync(new URL('../fixtures/portability/web-draft-contract.json', import.meta.url), 'utf8'));
  assert.deepEqual(await captureWebDraftContract(), expected);
});
