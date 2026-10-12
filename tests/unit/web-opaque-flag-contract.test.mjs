import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { captureWebOpaqueFlagContract } from '../helpers/web-opaque-flag-contract.mjs';

test('original Web stored opaque flag promotion, explicit null and deletion preserve metadata/archive and one Undo boundary', () => {
  const expected = JSON.parse(readFileSync(new URL('../fixtures/portability/web-opaque-flag-contract.json', import.meta.url),'utf8'));
  assert.deepEqual(captureWebOpaqueFlagContract(), expected);
});
