import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { stagePrototype } from '../stage.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function source(t) {
  const root = await mkdtemp(join(tmpdir(), 'pandolab-shell-stage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (path, bytes) => { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), bytes); };
  await put('index.html', '<html>Viewer only</html>');
  await put('apps/web-shell/editor.html', '<html><head><base href="../../" data-product-base="editor" /></head><body>Editor<script src="assets/js/bootstrap.js?v=test" defer></script></body></html>');
  await put('assets/js/app.js', 'export const realApplication = true;');
  await put('assets/js/build-meta.js', 'globalThis.PANDOLAB_BUILD_META={};');
  await put('assets/data/world/huge.bin', 'NEVER PACKAGE WORLD DATA');
  await put('assets/wasm/pandoeditor-core.js', 'export default async()=>({});');
  await put('assets/wasm/pandoeditor-core.wasm', new Uint8Array([0, 97, 115, 109]));
  const assets = {};
  for (const type of ['js', 'wasm']) {
    const file = `pandoeditor-core.${type}`;
    assets[type] = { file, sha256: hash(await readFile(join(root, 'assets/wasm', file))) };
  }
  await put('assets/wasm/pandoeditor-core.manifest.json', JSON.stringify({ schema: 'pandoeditor-core-wasm', abiVersion: 1, assets }));
  return { root, put };
}

test('stages the real frontend and exact WASM pair without any world data', async t => {
  const { root } = await source(t);
  const result = await stagePrototype({ root });
  assert.ok(result.files.some(file => file.path === 'assets/js/app.js'));
  assert.ok(result.files.every(file => !file.path.startsWith('assets/data/')));
  assert.equal(await readFile(join(result.directory, 'assets/js/app.js'), 'utf8'), 'export const realApplication = true;');
  const html = await readFile(join(result.directory, 'index.html'), 'utf8');
  assert.match(html, /shell\/startup\.js/);
  assert.match(html, /<base href="\.\/" data-product-base="editor" \/>/);
  assert.match(html, /Editor/);
  assert.doesNotMatch(html, /Viewer only/);
  assert.doesNotMatch(html, /src="assets\/js\/bootstrap\.js/);
  assert.equal(result.profile, 'small-project');
  assert.equal(result.fixture.entityCount, 3);
  assert.ok(result.fixture.coordinateCount <= 100);
});

test('rejects a modified WASM asset instead of blessing a new hash', async t => {
  const { root, put } = await source(t);
  await put('assets/wasm/pandoeditor-core.wasm', 'tampered');
  await assert.rejects(stagePrototype({ root }), /WASM.*hash|hash.*WASM/i);
});

test('requires the explicit editor base and never falls back to the viewer HTML', async t => {
  const { root, put } = await source(t);
  await put('apps/web-shell/editor.html', '<html><base href="../../" /><script src="assets/js/bootstrap.js" defer></script></html>');
  await assert.rejects(stagePrototype({ root }), /explicit product base/);
});

test('will not clear an output directory it does not own', async t => {
  const { root, put } = await source(t);
  await put('apps/web-shell/dist/keep.txt', 'unrelated');
  await assert.rejects(stagePrototype({ root }), /owned|ownership/i);
  assert.equal(await readFile(join(root, 'apps/web-shell/dist/keep.txt'), 'utf8'), 'unrelated');
});

test('request instrumentation preserves a classic Worker strict directive', async t => {
  const { root, put } = await source(t);
  await put('assets/js/workers/strict-worker.js', "'use strict';\naccidentalLeak = true;\n");
  const result = await stagePrototype({ root });
  const worker = await readFile(join(result.directory, 'assets/js/workers/strict-worker.js'), 'utf8');
  const context = { location: new URL('http://tauri.localhost/assets/js/workers/strict-worker.js'), URL,
    fetch: async () => new Response('local') };
  assert.throws(() => runInNewContext(worker, context), /accidentalLeak is not defined/);
});
