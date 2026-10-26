import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildWorkerAsset } from '../../scripts/lib/worker-assets.mjs';
import { workerAssetUrl } from "../../shared/frontend/js/modules/worker-asset-url.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pando-worker-assets-'));
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  put('assets/js/workers/sample-worker.js', "import './worker-rpc-host.js'; import('../modules/calculation.js');");
  put('assets/js/workers/worker-rpc-host.js', 'self.host = true;');
  put('assets/js/modules/calculation.js', "export {value} from './value.js'; export const wasm = new URL('../../wasm/core.wasm', import.meta.url);");
  put('assets/js/modules/value.js', 'export const value = 1;');
  return { root, put };
}

test('Worker closure is immutable, includes transitive imports, and changes identity when an internal calculation changes', async () => {
  const f = fixture(), entry = 'assets/js/workers/sample-worker.js';
  const first = await buildWorkerAsset({ root: f.root, entry });
  assert.match(first.url, /^assets\/worker-runtime\/[a-f0-9]{32}\/assets\/js\/workers\/sample-worker\.js$/);
  assert.equal(first.files.size, 4);
  assert.ok(first.files.has(first.url.replace('workers/sample-worker.js', 'modules/value.js')));
  const calculation = first.files.get(first.url.replace('workers/sample-worker.js', 'modules/calculation.js'));
  const wasm = calculation.match(/new URL\((['"])([^'"]+)\1, import.meta.url\)/);
  assert.ok(wasm);
  assert.equal(new URL(wasm[2], `https://example.test/Pando/${first.url.replace('workers/sample-worker.js', 'modules/calculation.js')}`).pathname, '/Pando/assets/wasm/core.wasm');
  f.put('assets/js/modules/value.js', 'export const value = 2;');
  const second = await buildWorkerAsset({ root: f.root, entry });
  assert.notEqual(first.url, second.url);
});

test('classic importScripts and fixed-identity versioned dynamic imports are included in the same closure', async () => {
  const f = fixture();
  f.put('assets/js/workers/sample-worker.js', "importScripts('./worker-rpc-host.js'); const version='x'; import(`../modules/calculation.js?v=${version}`);");
  const result = await buildWorkerAsset({ root: f.root, entry: 'assets/js/workers/sample-worker.js' });
  assert.equal(result.files.size, 4);
});

test('classic bare sibling script names are included and computed unknown scripts are rejected', async () => {
  const f = fixture();
  f.put('assets/js/workers/sample-worker.js', "importScripts('worker-rpc-host.js');");
  const result = await buildWorkerAsset({ root: f.root, entry: 'assets/js/workers/sample-worker.js' });
  assert.ok([...result.files.keys()].some(path => path.endsWith('/workers/worker-rpc-host.js')));
  f.put('assets/js/workers/sample-worker.js', 'self.onmessage = event => importScripts(event.data.module);');
  await assert.rejects(buildWorkerAsset({ root: f.root, entry: 'assets/js/workers/sample-worker.js' }), /dynamic|dependency/i);
  f.put('assets/js/workers/sample-worker.js', "self.onmessage = event => importScripts('worker-rpc-host.js', event.data.module);");
  await assert.rejects(buildWorkerAsset({ root: f.root, entry: 'assets/js/workers/sample-worker.js' }), /dynamic|dependency/i);
});

test('unknown dynamic executable dependencies fail packaging', async () => {
  const f = fixture();
  f.put('assets/js/workers/sample-worker.js', 'self.onmessage = event => import(event.data.module);');
  await assert.rejects(buildWorkerAsset({ root: f.root, entry: 'assets/js/workers/sample-worker.js' }), /dynamic|dependency/i);
});

test('bootstrap metadata imports resolve outside the immutable tree with their revision query intact', async () => {
  const f = fixture();
  f.put('assets/js/build-meta.js', 'globalThis.PANDOLAB_BUILD_META = {};');
  f.put('assets/js/workers/sample-worker.js', 'const version = "current"; await import(`../build-meta.js?v=${version}`);');
  const asset = await buildWorkerAsset({ root: f.root, entry: 'assets/js/workers/sample-worker.js' });
  const source = asset.files.get(asset.url);
  const path = source.match(/import\(`([^?]+)\?v=\$\{version\}`\)/)[1];
  assert.equal(new URL(path, `https://example.test/Pando/${asset.url}`).pathname, '/Pando/assets/js/build-meta.js');
});

test('Worker URL resolution requires generated identity and preserves application base and runtime parameters', () => {
  const path = 'assets/js/workers/sample-worker.js';
  const meta = { assetRevision: 'current', dataRevision: 'data-1', workerAssets: { [path]: { url: `assets/worker-runtime/${'a'.repeat(32)}/${path}` } } };
  const url = workerAssetUrl(new URL('https://example.test/Pando/assets/js/workers/sample-worker.js?mode=read&v=old'), meta);
  assert.equal(url.pathname, `/Pando/assets/worker-runtime/${'a'.repeat(32)}/${path}`);
  assert.equal(url.searchParams.get('mode'), 'read');
  assert.equal(url.searchParams.get('v'), 'current');
  assert.throws(() => workerAssetUrl(new URL('https://example.test/' + path), { workerAssets: {} }), error => error.code === 'PL-WORKER-ASSET');
});
