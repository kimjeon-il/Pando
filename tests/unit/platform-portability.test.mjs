import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyPlatformPortability } from '../../tools/check-platform-portability.mjs';

test('current selection preserves frozen behavior including no-op anchors and duplicate primary order', () => {
  const result = verifyPlatformPortability();
  assert.equal(result.expected, 14);
  assert.equal(result.webProcessed, 14);
  assert.equal(result.mismatches, 0);
  assert.equal(result.crossPlatformVerified, false, 'Web-only execution cannot claim native parity');
});
