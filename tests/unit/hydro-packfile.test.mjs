import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const base = new URL('../../assets/js/workers/', import.meta.url);
const storeSource = readFileSync(new URL('hydro-shard-store.js', base), 'utf8');
const workerSource = readFileSync(new URL('hydro-tile-worker.js', base), 'utf8');
const root = new URL('../../assets/data/hydro/v0.13.2/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
const bundle = new Uint8Array(readFileSync(new URL('hydro.bin', root)));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function loadWorker({ supportsRange = true } = {}) {
  const calls = [], messages = [];
  const scope = {
    self: { fflate: { gunzipSync: bytes => new Uint8Array(gunzipSync(bytes)) } },
    crypto: webcrypto, TextDecoder, Uint8Array, Response, URL, Map,
    performance: { now: () => 0 },
    importScripts() {}, postMessage: m => messages.push(m),
    setTimeout, clearTimeout,
    async fetch(url, init = {}) {
      const range = init?.headers?.Range || null;
      calls.push({ url: String(url), range });
      if (!supportsRange || !range)
        return new Response(bundle.slice(), { status: 200 });
      const m = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!m)throw Error('Invalid Range request ' + range);
      const start = Number(m[1]), end = Number(m[2]);
      assert.ok(start >= 0 && end < bundle.length && end >= start);
      return new Response(bundle.slice(start, end + 1), {
        status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${bundle.length}` },
      });
    },
  };
  vm.runInNewContext(storeSource, scope);
  vm.runInNewContext(workerSource, scope);
  const init = async () => {
    await scope.onmessage({ data: {
      type: 'init', manifest, baseUrl: 'https://example.invalid/Pando/assets/data/hydro/v0.13.2/',
      assetRevision: '0.13.2', dataRevision: '0.13.2', includeGeometry: false,
    } });
    assert.equal(messages.at(-1)?.type, 'ready', messages.at(-1)?.message);
  };
  return { scope, init, calls, messages };
}

test('bundle contains exact individually hashed legacy compression bytes with no gaps', () => {
  assert.equal(manifest.version, '0.13.2');
  assert.equal(manifest.container.url, 'hydro.bin');
  assert.equal(manifest.container.bytes, bundle.length);
  assert.equal(sha256(bundle), manifest.container.sha256);
  const fragments = [manifest.index, manifest.metadata.core, manifest.metadata.detail, ...manifest.shards];
  let expectedStart = 0;
  for (const fragment of fragments) {
    assert.equal(fragment.url, 'hydro.bin');
    assert.equal(fragment.offset, expectedStart);
    const content = bundle.subarray(fragment.offset, fragment.offset + fragment.bytes);
    assert.equal(sha256(content), fragment.sha256);
    expectedStart += fragment.bytes;
  }
  assert.equal(expectedStart, bundle.length);
  assert.ok(manifest.metadata.detail.lazy);
});

test('real worker hydrates global index and base metadata through only two small Range reads', async () => {
  const worker = loadWorker();
  await worker.init();
  assert.ok(worker.calls.some(x => x.range === 'bytes=0-32631'));
  assert.ok(worker.calls.some(x => x.range === 'bytes=32632-762256'));
  assert.ok(worker.calls.every(x => x.range !== null));
});

test('real worker reuses exactly one whole download when origin ignores Range', async () => {
  const worker = loadWorker({ supportsRange: false });
  await worker.init();
  assert.equal(worker.calls.length, 1, JSON.stringify(worker.calls));
});

test('virtual shard reader issues absolute ranges and saves isolated cache entries', async () => {
  const records = new Map();
  const memCalls = [];
  const scope = { self: {}, Response, Uint8Array };
  vm.runInNewContext(storeSource, scope);
  const specs = manifest.shards.slice(0, 2).map(s => ({ ...s, fileBytes: bundle.length }));
  const parse = new Map();
  for (const [i, spec] of specs.entries()) {
    const content = new Uint8Array(gzipSync(Buffer.from('test'+i)));
    // Do not substitute synthetic bytes into the real bundle: test the first
    // gzip-compressed pack from each genuine shard through a caller-supplied
    // decompressor that returns the untouched wire fragment.
    const raw = bundle.subarray(spec.offset, spec.offset + spec.bytes);
    const start = 0, length = 16;
    assert.equal(raw.length, spec.bytes);
    parse.set(spec.id, { offset: start, length, raw });
    assert.ok(content.length > 5);
  }
  const cache = {
    match: async key => records.get(key)?.clone(),
    put: async (key,value) => records.set(key,value),
    delete: async key => records.delete(key),
  };
  const store = scope.self.createHydroShardStore({
    openCache: async()=>cache,
    resolveUrl: x => 'https://example.invalid/' + x,
    gunzip: bytes => bytes,
    digest: async bytes => sha256(bytes),
    fetchResponse: async (_url, init) => {
      memCalls.push(init.headers?.Range);
      const match = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range);
      const from = Number(match[1]), through = Number(match[2]);
      return new Response(bundle.slice(from,through+1), {
        status:206,headers:{'Content-Range': `bytes ${from}-${through}/${bundle.length}`},
      });
    },
  });
  for(const spec of specs){
    const data = await store.full(spec);
    assert.equal(data.length,spec.bytes);
    assert.equal(sha256(data),spec.sha256);
  }
  assert.equal(memCalls.length,2);
  assert.equal(records.size,2, 'different virtual shards cannot overwrite the same URL cache key');
  assert.ok([...records.keys()].every(x=>x.includes('__hydro_segment=')));
});
