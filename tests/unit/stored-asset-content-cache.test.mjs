import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { TextDecoder } from 'node:util';
import { createStoredAssetLoader } from '../../assets/js/modules/stored-asset-loader.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const CACHE = 'pandolab-world-content-v1';

function cacheStorage() {
  const databases = new Map();
  return {
    databases,
    async open(name) {
      if (!databases.has(name)) databases.set(name, new Map());
      const values = databases.get(name);
      return {
        async match(url) { return values.get(String(url))?.clone(); },
        async put(url, response) { values.set(String(url), response.clone()); },
        async delete(url) { return values.delete(String(url)); },
      };
    },
    async keys() { return [...databases.keys()]; },
    async delete(name) { return databases.delete(name); },
  };
}

function asset(text) {
  const raw = Buffer.from(text);
  const compressed = gzipSync(raw);
  const hash = sha256(compressed);
  return { bytes: compressed, spec: {
    url: `world/objects/countries-canonical-sha256-${hash}.pcg.gz`,
    encoding: 'gzip', compressedBytes: compressed.length, decodedBytes: raw.length, sha256: hash,
  } };
}

function loader(storage, fetchFn, revision) {
  return createStoredAssetLoader({
    dataRevision: revision, cachePolicy: 'immutable', cacheStorage: storage, fetchFn,
    resolveUrl: spec => new URL(spec.url, 'https://test.invalid/Pando/assets/data/'),
  });
}
const decoded = buffer => new TextDecoder().decode(buffer);

test('unchanged world content survives new dataRevision and needs only one fetch', async () => {
  const storage = cacheStorage(), map = asset('stable-world');
  let count = 0;
  const fetchFn = async () => { count++; return new Response(map.bytes); };
  const first = await loader(storage, fetchFn, 'app-v0.36').loadAsset(map.spec, 'geometry', 'packet', 'PCG', decoded);
  const second = await loader(storage, fetchFn, 'app-v0.37').loadAsset(map.spec, 'geometry', 'packet', 'PCG', decoded);
  assert.equal(first.value, 'stable-world');
  assert.equal(first.source, 'network');
  assert.equal(second.source, 'cache');
  assert.equal(second.value, first.value);
  assert.equal(count, 1);
  assert.deepEqual(await storage.keys(), [CACHE]);
});

test('different content address fetches only the changed asset', async () => {
  const storage = cacheStorage(), a = asset('first'), b = asset('second');
  const bytes = new Map([[a.spec.url, a.bytes], [b.spec.url, b.bytes]]);
  let count = 0;
  const fetchFn = async url => { count++; return new Response(bytes.get(new URL(url).pathname.replace('/Pando/assets/data/', ''))); };
  const get = loader(storage, fetchFn, 'rev-any');
  assert.equal((await get.loadAsset(a.spec, 'geometry', 'first', 'A', decoded)).value, 'first');
  assert.equal((await get.loadAsset(b.spec, 'geometry', 'second', 'B', decoded)).value, 'second');
  assert.equal((await get.loadAsset(a.spec, 'geometry', 'first', 'A', decoded)).source, 'cache');
  assert.equal(count, 2);
});

test('corrupt immutable cache is invalidated and recovered without affecting other content', async () => {
  const storage = cacheStorage(), a = asset('unchanged');
  let count = 0;
  const fetchFn = async () => { count++; return new Response(a.bytes); };
  const client = loader(storage, fetchFn, 'same');
  await client.loadAsset(a.spec, 'geometry', 'packet', 'A', decoded);
  const cache = await storage.open(CACHE);
  const url = new URL(a.spec.url, 'https://test.invalid/Pando/assets/data/');
  await cache.put(url, new Response(Buffer.from([1, 2, 3, 4])));
  const result = await loader(storage, fetchFn, 'another').loadAsset(a.spec, 'geometry', 'packet', 'A', decoded);
  assert.equal(result.source, 'network');
  assert.equal(result.value, 'unchanged');
  assert.equal(count, 2);
});

test('legacy cache cleanup does not delete the immutable world cache or active catalog', async () => {
  const storage = cacheStorage();
  await storage.open(CACHE);
  await storage.open('pandolab-data-old');
  await storage.open('pandolab-data-active');
  await storage.open('pandolab-core-old');
  const fetchFn = async () => new Response(asset('value').bytes);
  const client = loader(storage, fetchFn, 'active');
  await client.cleanupOldCoreCaches();
  assert.deepEqual((await storage.keys()).sort(), [CACHE, 'pandolab-data-active'].sort());
});
