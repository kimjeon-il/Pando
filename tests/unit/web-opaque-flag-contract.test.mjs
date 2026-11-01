import assert from 'node:assert/strict';
import test from 'node:test';
import { captureWebOpaqueFlagContract } from '../helpers/web-opaque-flag-contract.mjs';
import { currentOpaqueFlagExpectations } from '../helpers/opaque-flag-expectations.mjs';

test('current Web opaque flag promotion, explicit null and deletion preserve every v14 field and one Undo boundary', async () => {
  assert.deepEqual(await captureWebOpaqueFlagContract(), currentOpaqueFlagExpectations());
});
