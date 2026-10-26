import test from 'node:test';
import assert from 'node:assert/strict';
import { workerAssetUrl, workerBuildMeta, runtimeDataRoot, runtimeDataAssetUrl } from "../../shared/frontend/js/modules/worker-asset-url.js";

test('all viewer workers inherit the data identity from the pinned build metadata', () => {
  const input = new URL('https://example.test/Pando/assets/js/workers/gpu-mesh-worker.js?mode=preview');
  const meta = { assetRevision: 'code-1', dataRevision: 'a'.repeat(64),
    workerAssets: {
      'assets/js/workers/gpu-mesh-worker.js': {
        url: `assets/worker-runtime/${'c'.repeat(32)}/assets/js/workers/gpu-mesh-worker.js`,
      },
    } };
  const result = workerAssetUrl(input, meta);
  assert.equal(result.searchParams.get('dataRevision'), meta.dataRevision);
  assert.equal(result.searchParams.has('publicationRevision'), false);
  assert.equal(result.searchParams.has('publicationManifestSha256'), false);
  assert.equal(result.searchParams.get('mode'), 'preview');
});

test('a Worker rejects metadata from a different deployment or data pin', () => {
  const meta = { assetRevision: 'code-1', dataRevision: 'data-1' };
  const url = 'https://example.test/Pando/assets/worker-runtime/abc/assets/js/workers/a.js?v=code-1&dataRevision=data-1';
  assert.equal(workerBuildMeta(url, meta), meta);
  assert.throws(() => workerBuildMeta(url, { ...meta, dataRevision: 'other' }), /revision mismatch/);
  assert.throws(() => workerBuildMeta(url, { ...meta, assetRevision: 'other' }), /revision mismatch/);
  assert.throws(() => workerBuildMeta(url, {}), /revision mismatch/);
  assert.equal(runtimeDataRoot(url).href, 'https://example.test/Pando/');
  const asset = { url: 'assets/data/prepared-polygons/generated/v2/mesh.gz', sha256: 'a'.repeat(64) };
  assert.equal(runtimeDataAssetUrl(url, asset).href, `https://example.test/Pando/${asset.url}?sha256=${asset.sha256}`);
  for (const path of ['../private', 'assets/data/../private', 'assets/data/a?b', 'assets/data/a\\b']) {
    assert.throws(() => runtimeDataAssetUrl(url, { ...asset, url: path }), /Invalid/);
  }
});
