import test from 'node:test';
import assert from 'node:assert/strict';
import { workerAssetUrl } from "../../shared/frontend/js/modules/worker-asset-url.js";

test('all viewer workers inherit the selected independent data release pin', () => {
  const input = new URL('https://example.test/Pando/assets/js/workers/gpu-mesh-worker.js?mode=preview');
  const meta = { assetRevision: 'code-1', dataRevision: 'a'.repeat(64),
    publicReleaseManifestSha256: 'b'.repeat(64), workerAssets: {
      'assets/js/workers/gpu-mesh-worker.js': {
        url: `assets/worker-runtime/${'c'.repeat(32)}/assets/js/workers/gpu-mesh-worker.js`,
      },
    } };
  const result = workerAssetUrl(input, meta);
  assert.equal(result.searchParams.get('publicationRevision'), meta.dataRevision);
  assert.equal(result.searchParams.get('publicationManifestSha256'), meta.publicReleaseManifestSha256);
  assert.equal(result.searchParams.get('mode'), 'preview');
});
