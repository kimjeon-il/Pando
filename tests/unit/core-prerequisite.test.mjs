import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { sharedSourceManifest } from '../../tools/package-shared-core-assets.mjs';
import { loadNodeCore } from '../../tools/load-node-core.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture({ document = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'pandolab-core-prerequisite-'));
  const assets = path.join(root, 'assets/wasm');
  await mkdir(assets, { recursive: true });
  await mkdir(path.join(root, 'shared'));
  await writeFile(path.join(root, 'shared/contract.h'), '// independent fixture source\n');
  const identity = sharedSourceManifest(root);
  const js = `export default async () => ({ coreAbiVersion: 1, coreCompilerVersion: '4.0.20', coreSourceSha256: '${identity.sourceSha256}', ${document ? 'DocumentSession: class {},' : ''} normalizePolygonGeometry() {}, normalizePolygonRing() {}, hasCanonicalPolygonWinding() {} });`;
  const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  const manifest = { schema: 'pandoeditor-core-wasm', abiVersion: 1, ...identity,
    compiler: { name: 'emscripten', version: '4.0.20' }, assets: {
      js: { file: 'pandoeditor-core.js', sha256: sha256(js) },
      wasm: { file: 'pandoeditor-core.wasm', sha256: sha256(wasm) },
    } };
  await Promise.all([writeFile(path.join(assets, 'pandoeditor-core.js'), js),
    writeFile(path.join(assets, 'pandoeditor-core.wasm'), wasm),
    writeFile(path.join(assets, 'pandoeditor-core.manifest.json'), JSON.stringify(manifest))]);
  return { root, assets };
}

test('core prerequisites load current paired artifacts through the production manifest verifier', async () => {
  const { root } = await fixture();
  const core = await loadNodeCore({ root });
  assert.equal(typeof core.normalizePolygonGeometry, 'function');
});

test('missing prerequisite reports one artifact failure with its original cause', async () => {
  const root = path.join(tmpdir(), 'pandolab-core-does-not-exist', 'missing');
  await assert.rejects(loadNodeCore({ root }), error => error.code === 'PL-CORE-PREREQUISITE-MISSING'
    && error.cause.code === 'ENOENT' && error.message.includes('manifest'));
});

test('corrupted artifacts and stale source identity remain hard failures', async () => {
  const { root, assets } = await fixture();
  const wasmPath = path.join(assets, 'pandoeditor-core.wasm');
  const wasm = await readFile(wasmPath);
  await writeFile(wasmPath, Buffer.from([1, 2, 3]));
  await assert.rejects(loadNodeCore({ root }), { code: 'PL-CORE-WASM-INTEGRITY' });
  await writeFile(wasmPath, wasm);
  await writeFile(path.join(root, 'shared/contract.h'), '// changed canonical source\n');
  await assert.rejects(loadNodeCore({ root }), { code: 'PL-CORE-PREREQUISITE-STALE' });
});

test('a paired artifact with a missing required document capability cannot pass preflight', async () => {
  const { root } = await fixture({ document: false });
  await assert.rejects(loadNodeCore({ root }), { code: 'PL-CORE-WASM-CAPABILITY' });
});
