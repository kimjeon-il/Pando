import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLibraryCodeCompatibility } from '../../tools/check-library-release-code.mjs';

test('data-only release requires the prepared mesh algorithm used by the staged viewer', () => {
  const code = { preparedPolygonMeshes: { algorithmSourceSha256: 'a'.repeat(64) } };
  const release = { assets: { preparedPolygonMeshes: { algorithmSourceSha256: 'a'.repeat(64) } } };
  assert.doesNotThrow(() => assertLibraryCodeCompatibility(code, release));
  release.assets.preparedPolygonMeshes.algorithmSourceSha256 = 'b'.repeat(64);
  assert.throws(() => assertLibraryCodeCompatibility(code, release), /algorithm|알고리즘/i);
});
