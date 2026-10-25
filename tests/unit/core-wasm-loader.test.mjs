import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { loadVerifiedCore } from "../../shared/frontend/js/modules/core-wasm-loader.js";

const bytes = value => new Uint8Array(Buffer.from(value));
const hash = async value => Buffer.from(await webcrypto.subtle.digest('SHA-256', value)).toString('hex');
async function fixture() {
  const js = bytes('export default factory;');
  const wasm = bytes('wasm fixture bytes');
  const sourceSha256 = 'a'.repeat(64);
  const manifest = { schema: 'pandoeditor-core-wasm', abiVersion: 1, sourceSha256,
    compiler: { name: 'emscripten', version: '4.0.20' }, inputs: [], assets: {
      js: { file: 'pandoeditor-core.js', sha256: await hash(js) },
      wasm: { file: 'pandoeditor-core.wasm', sha256: await hash(wasm) },
    } };
  const fetched = [], imported = [], factories = [], admitted = [], revoked = [];
  let module = { coreAbiVersion: 1, coreSourceSha256: sourceSha256, coreCompilerVersion: '4.0.20', DocumentSession: class {} };
  let corrupt = false;
  const options = { baseUrl: new URL('https://example.test/assets/wasm/'), subtle: webcrypto.subtle,
    createModuleUrl: value => { admitted.push(new Uint8Array(value)); return 'blob:verified-js-bytes'; },
    revokeModuleUrl: value => { revoked.push(value); },
    fetchAsset: async (url, options) => {
      fetched.push({ url: String(url), options });
      if (String(url).endsWith('manifest.json')) return { ok: true, json: async () => manifest };
      const value = String(url).includes('.wasm') ? (corrupt ? bytes('mixed stale wasm') : wasm) : js;
      return { ok: true, arrayBuffer: async () => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) };
    },
    importModule: async url => { imported.push(url); return { default: async options => { factories.push(options); return module; } }; },
  };
  return { options, fetched, imported, factories, admitted, revoked, manifest, js, wasm, corruptWasm() { corrupt = true; },
    setModule(value) { module = value; } };
}

test('loader executes only verified JS bytes and passes verified WASM to the factory', async () => {
  const f = await fixture();
  const module = await loadVerifiedCore(f.options);
  assert.equal(module.coreAbiVersion, 1);
  assert.equal(f.fetched.length, 3);
  assert.ok(f.fetched.every(row => row.options.cache === 'no-store'));
  assert.equal(f.imported[0], 'blob:verified-js-bytes');
  assert.deepEqual(f.admitted, [f.js]);
  assert.deepEqual(f.revoked, ['blob:verified-js-bytes']);
  assert.deepEqual(new Uint8Array(f.factories[0].wasmBinary), f.wasm);
});

test('a changed second JS network body cannot be admitted for execution', async () => {
  const f = await fixture();
  let jsReads = 0;
  const original = f.options.fetchAsset;
  f.options.fetchAsset = async (url, options) => {
    if (String(url).includes('pandoeditor-core.js') && ++jsReads > 1)
      return { ok: true, arrayBuffer: async () => bytes('changed second JS response').buffer };
    return original(url, options);
  };
  const imported = f.options.importModule;
  f.options.importModule = async url => {
    assert.equal(url, 'blob:verified-js-bytes');
    return imported(url);
  };
  await loadVerifiedCore(f.options);
  assert.equal(jsReads, 1);
  assert.deepEqual(f.admitted[0], f.js);
});

test('mixed stale WASM bytes fail before JavaScript import or session creation', async () => {
  const f = await fixture(); f.corruptWasm();
  await assert.rejects(loadVerifiedCore(f.options), { code: 'PL-CORE-WASM-INTEGRITY' });
  assert.deepEqual(f.imported, []); assert.deepEqual(f.factories, []);
});

test('malformed manifest or mismatched compiled ABI/source digest fails visibly', async () => {
  const malformed = await fixture(); malformed.manifest.assets.js.file = '../other.js';
  await assert.rejects(loadVerifiedCore(malformed.options), { code: 'PL-CORE-WASM-MANIFEST' });
  assert.equal(malformed.fetched.length, 1);
  for (const module of [{ coreAbiVersion: 2, coreSourceSha256: 'a'.repeat(64), coreCompilerVersion: '4.0.20' },
    { coreAbiVersion: 1, coreSourceSha256: 'b'.repeat(64), coreCompilerVersion: '4.0.20' },
    { coreAbiVersion: 1, coreSourceSha256: 'a'.repeat(64), coreCompilerVersion: '4.0.21' }]) {
    const f = await fixture(); f.setModule(module);
    await assert.rejects(loadVerifiedCore(f.options), { code: 'PL-CORE-WASM-ABI' });
  }
});

test('missing paired asset never calls the module factory', async () => {
  const f = await fixture();
  const fetchAsset = f.options.fetchAsset;
  f.options.fetchAsset = async (url, options) => String(url).includes('.wasm')
    ? { ok: false, status: 404 } : fetchAsset(url, options);
  await assert.rejects(loadVerifiedCore(f.options), { code: 'PL-CORE-WASM-UNAVAILABLE' });
  assert.deepEqual(f.factories, []);
});

test('missing required exact-byte loader dependencies fail before fetching assets', async () => {
  const f = await fixture(); f.options.createModuleUrl = null;
  await assert.rejects(loadVerifiedCore(f.options), { code: 'PL-CORE-WASM-DEPENDENCY' });
  assert.deepEqual(f.fetched, []);
});
