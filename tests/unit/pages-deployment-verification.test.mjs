import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyPagesDeployment } from '../../tools/verify-pages-deployment.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const sourceCommit = 'a'.repeat(40), dataCommit = 'b'.repeat(40);
  const meta = { sourceCommit, dataCommit, dataRevision: 'data-1' };
  const files = new Map([
    ['index.html', '<html>map</html>'],
    ['assets/js/build-meta.js', `globalThis.PANDOLAB_BUILD_META = Object.freeze(${JSON.stringify(meta)});\n`],
    ['assets/data/builtin-world/generated/v1/index.json', '{"selected":"new"}'],
  ]);
  const evidence = { schema: 'pando-web-pages-staging', sourceCommit, dataCommit,
    files: [...files].map(([path, bytes]) => ({ path, bytes: Buffer.byteLength(bytes), sha256: sha256(bytes) })) };
  return { files, evidence, fetchFn: async url => {
    assert.equal(new URL(url).searchParams.get('deployment'), sourceCommit);
    return new Response(files.get(new URL(url).pathname.slice('/Pando/'.length)) ?? 'missing');
  } };
}

test('live verification binds the code, data commit and selected manifests to one deployment', async () => {
  const f = fixture(), result = await verifyPagesDeployment({ ...f, baseUrl: 'https://example.test/Pando/' });
  assert.equal(result.sourceCommit, f.evidence.sourceCommit);
  assert.equal(result.dataCommit, f.evidence.dataCommit);
  assert.equal(result.checkedFiles, 3);
  f.files.set('assets/data/builtin-world/generated/v1/index.json', '{"selected":"old"}');
  await assert.rejects(verifyPagesDeployment({ ...f, baseUrl: 'https://example.test/Pando/' }), /mismatch/);
});

test('live verification rejects missing identity, failed responses and foreign artifact paths', async () => {
  const f = fixture();
  await assert.rejects(verifyPagesDeployment({ ...f, baseUrl: 'https://example.test/Pando/',
    evidence: { ...f.evidence, dataCommit: null } }), /identity/);
  await assert.rejects(verifyPagesDeployment({ ...f, baseUrl: 'https://example.test/Pando/',
    fetchFn: async () => new Response('missing', { status: 404 }) }), /404/);
  await assert.rejects(verifyPagesDeployment({ ...f, baseUrl: 'https://example.test/Pando/',
    evidence: { ...f.evidence, files: [{ path: '../secret', bytes: 1, sha256: 'a'.repeat(64) }] } }), /path/);
});
