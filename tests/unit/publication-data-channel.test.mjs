import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { publicDataRoot, publicDataAssetUrl, resolvePublicDataChannel,
  resolveWorkerDataChannel } from '../../assets/js/modules/publication-data-channel.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const base = 'https://example.test/Pando/';
const revision = 'a'.repeat(64);
const sourceRevision = 'b'.repeat(40);
const asset = (name, contents = '{}') => ({
  url: `assets/data/library-releases/${revision}/${name}`,
  sha256: hash(contents), encoding: 'identity',
  compressedBytes: Buffer.byteLength(contents), decodedBytes: Buffer.byteLength(contents),
});
const release = () => ({ schema: 'pandolab-library-release', schemaVersion: 1,
  revision, sourceRevision, assets: {
    territorialIndex: asset('territorial-entities/generated/v2/index.json'),
    builtinWorld: asset('builtin-world/generated/v1/index.json'),
    preparedPolygonMeshes: { ...asset('prepared-polygons/generated/v2/manifest.json'), algorithmSourceSha256: 'f'.repeat(64) },
    worldBundle: asset('world/current.json'),
  },
});
const manifestSha256 = hash(JSON.stringify(release()) + '\n');
const built = Object.freeze({ appVersion: '1', buildId: 'code-1', assetRevision: 'code-1', dataRevision: 'old-data' });
test('immutable worker runtime and viewer resolve the same Pages data root', () => {
  assert.equal(publicDataRoot('https://example.test/Pando/assets/js/viewer.js').href, base);
  assert.equal(publicDataRoot('https://example.test/Pando/assets/worker-runtime/abc/assets/js/workers/data-loader-worker.js').href, base);
});

test('a prepared mesh requested by an immutable Worker resolves below the Pages data root', () => {
  const worker = `https://example.test/Pando/assets/worker-runtime/${'c'.repeat(32)}/assets/js/workers/gpu-mesh-worker.js`;
  const spec = { url: `assets/data/library-releases/${revision}/prepared-polygons/generated/v2/mesh.bin.gz`, sha256: 'd'.repeat(64) };
  assert.equal(publicDataAssetUrl(worker, spec).href,
    `https://example.test/Pando/${spec.url}?sha256=${spec.sha256}`);
});

test('bundled native Worker keeps its build data without requesting the public channel', async () => {
  for (const resourceProfile of ['map-data', 'test-fixture']) {
    const meta = { ...built, resourceProfile };
    const result = await resolveWorkerDataChannel({ baseUrl: base, buildMeta: meta,
      fetchFn: () => { throw new Error('native data network guard'); } });
    assert.equal(result.meta, meta);
    assert.equal(result.status, 'bundled');
  }
});
function fixture({ pointer = { schema: 'pandolab-data-channel', schemaVersion: 1, revision, manifestSha256 }, online = true, cached = null } = {}) {
  const reads = [];
  const cache = new Map(cached || []);
  const cacheStorage = { open: async () => ({
    match: async url => cache.has(String(url)) ? new Response(cache.get(String(url))) : undefined,
    put: async (url, response) => cache.set(String(url), await response.text()),
  }) };
  const fetchFn = async url => {
    reads.push(String(url));
    if (!online) throw new TypeError('Network offline');
    if (String(url).endsWith('/current.json')) return new Response(JSON.stringify(pointer));
    if (String(url).endsWith('/manifest.json')) return new Response(JSON.stringify(release()) + '\n');
    throw new Error('unexpected URL');
  };
  return { reads, cache, cacheStorage, fetchFn };
}

test('online release changes data revision and specs while preserving code revision', async () => {
  const context = fixture();
  const result = await resolvePublicDataChannel({ baseUrl: base, buildMeta: built, ...context });
  assert.equal(result.status, 'online');
  assert.equal(result.meta.assetRevision, 'code-1');
  assert.equal(result.meta.buildId, 'code-1');
  assert.equal(result.meta.dataRevision, revision);
  assert.equal(result.meta.territorialIndex.url, release().assets.territorialIndex.url);
  assert.equal(result.meta.publicReleaseManifestSha256, manifestSha256);
  assert.equal(context.reads.length, 2);
});

test('worker pin resolves the viewer-selected release even if current pointer changes', async () => {
  const context = fixture({ pointer: { schema: 'pandolab-data-channel', schemaVersion: 1,
    revision: 'c'.repeat(64), manifestSha256: 'd'.repeat(64) } });
  const result = await resolvePublicDataChannel({ baseUrl: base, buildMeta: built, ...context,
    expectedRevision: revision, expectedManifestSha256: manifestSha256 });
  assert.equal(result.meta.dataRevision, revision);
  assert.equal(context.reads.length, 1);
  assert.match(context.reads[0], new RegExp(`/library-releases/${revision}/manifest\\.json$`));
});

test('offline uses only a previously verified release and marks it offline', async () => {
  const context = fixture();
  await resolvePublicDataChannel({ baseUrl: base, buildMeta: built, ...context });
  const result = await resolvePublicDataChannel({ baseUrl: base, buildMeta: built,
    ...fixture({ online: false, cached: context.cache }) });
  assert.equal(result.status, 'offline-verified');
  assert.equal(result.meta.dataRevision, revision);
});

test('a reachable pointer with an offline release request uses the matching verified cache', async () => {
  const context = fixture();
  await resolvePublicDataChannel({ baseUrl: base, buildMeta: built, ...context });
  const offline = fixture({ cached: context.cache });
  const fetchFn = async url => {
    if (String(url).endsWith('/current.json')) return new Response(JSON.stringify({ schema: 'pandolab-data-channel', schemaVersion: 1, revision, manifestSha256 }));
    throw new TypeError('Network offline');
  };
  const result = await resolvePublicDataChannel({ baseUrl: base, buildMeta: built,
    ...offline, fetchFn });
  assert.equal(result.status, 'offline-verified');
  assert.equal(result.meta.dataRevision, revision);
});

test('invalid online pointer rejects even when an older verified release exists', async () => {
  const context = fixture();
  await resolvePublicDataChannel({ baseUrl: base, buildMeta: built, ...context });
  await assert.rejects(resolvePublicDataChannel({ baseUrl: base, buildMeta: built,
    ...fixture({ pointer: { schema: 'pandolab-data-channel', schemaVersion: 1, revision: '../evil' }, cached: context.cache }) }),
  /판본|revision|매니페스트/);
});

test('missing online channel keeps the built-in baseline until first publication', async () => {
  const context = fixture({ pointer: null });
  context.fetchFn = async () => new Response('not found', { status: 404 });
  const result = await resolvePublicDataChannel({ baseUrl: base, buildMeta: built, ...context });
  assert.equal(result.status, 'baseline');
  assert.equal(result.meta, built);
});

test('explicit baseline channel uses build data without requesting a release', async () => {
  const context = fixture({ pointer: { schema: 'pandolab-data-channel', schemaVersion: 1, mode: 'baseline' } });
  const result = await resolvePublicDataChannel({ baseUrl: base, buildMeta: built, ...context });
  assert.equal(result.status, 'baseline');
  assert.equal(result.meta, built);
  assert.equal(result.sourceRevision, null);
  assert.deepEqual(context.reads, [base + 'assets/data/library-channel/current.json']);
  assert.equal(context.cache.size, 0);
});

test('baseline cannot silently replace a previously verified published release', async () => {
  const context = fixture();
  await resolvePublicDataChannel({ baseUrl: base, buildMeta: built, ...context });
  const baseline = fixture({ cached: context.cache,
    pointer: { schema: 'pandolab-data-channel', schemaVersion: 1, mode: 'baseline' } });
  await assert.rejects(resolvePublicDataChannel({ baseUrl: base, buildMeta: built, ...baseline }), /사라졌습니다/);
  const restored = await resolvePublicDataChannel({ baseUrl: base, buildMeta: built,
    ...fixture({ online: false, cached: context.cache }) });
  assert.equal(restored.status, 'offline-verified');
  assert.equal(restored.meta.dataRevision, revision);
});

test('baseline mode rejects release fields and unrecognized modes', async () => {
  for (const pointer of [
    { schema: 'pandolab-data-channel', schemaVersion: 1, mode: 'baseline', revision, manifestSha256 },
    { schema: 'pandolab-data-channel', schemaVersion: 1, mode: 'unknown', revision, manifestSha256 },
    { schema: 'pandolab-data-channel', schemaVersion: 2, mode: 'baseline' },
  ]) {
    await assert.rejects(resolvePublicDataChannel({ baseUrl: base, buildMeta: built,
      ...fixture({ pointer }) }), /판본|매니페스트/);
  }
});

test('missing published channel keeps its verified cache instead of switching to baseline', async () => {
  const context = fixture();
  await resolvePublicDataChannel({ baseUrl: base, buildMeta: built, ...context });
  await assert.rejects(resolvePublicDataChannel({ baseUrl: base, buildMeta: built,
    cacheStorage: context.cacheStorage, fetchFn: async () => new Response('not found', { status: 404 }) }), /사라졌습니다/);
});
