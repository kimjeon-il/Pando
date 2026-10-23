import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createDevelopmentAssets, stagePrototype } from '../stage.mjs';
import { startDevelopmentServer } from '../dev.mjs';
import { REFERENCE_IMAGE_STYLE_SOURCES } from '../../../assets/js/modules/reference-image-style-sources.js';

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
  const ocrBytes = Buffer.from('OCR'), runtimeBytes = Buffer.from('export default {};');
  const languages = { eng: { url: 'eng.traineddata.gz', bytes: ocrBytes.length, sha256: hash(ocrBytes) } };
  await put('assets/vendor/reference-analysis/tesseract.mjs', runtimeBytes);
  await put('assets/vendor/reference-analysis/manifest.json', JSON.stringify({ schemaVersion: 1, languages,
    files: { 'tesseract.mjs': { bytes: runtimeBytes.length, sha256: hash(runtimeBytes) } } }));
  await put('assets/data/reference-analysis/v1/ocr/eng.traineddata.gz', ocrBytes);
  await put('assets/data/reference-analysis/v1/ocr/manifest.json', JSON.stringify({ schemaVersion: 1, languages }));
  return { root, put };
}

test('stages the real frontend, exact WASM pair and local OCR without world data', async t => {
  const { root } = await source(t);
  const result = await stagePrototype({ root });
  assert.ok(result.files.some(file => file.path === 'assets/js/app.js'));
  assert.ok(result.files.every(file => !file.path.startsWith('assets/data/') || file.path.startsWith('assets/data/reference-analysis/')));
  assert.equal(await readFile(join(result.directory, 'assets/data/reference-analysis/v1/ocr/eng.traineddata.gz'), 'utf8'), 'OCR');
  assert.equal(result.referenceAnalysis.modelAvailable, false);
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

test('stages the runtime reference style catalog and every lazily loaded stylesheet', async t => {
  const { root, put } = await source(t);
  const catalog = 'assets/js/modules/reference-image-style-sources.js';
  const catalogSource = await readFile(new URL(`../../../${catalog}`, import.meta.url), 'utf8');
  await put(catalog, catalogSource);
  for (const path of REFERENCE_IMAGE_STYLE_SOURCES) await put(`assets/${path}`, `/* ${path} */`);
  const result = await stagePrototype({ root });
  assert.equal(await readFile(join(result.directory, catalog), 'utf8'), catalogSource);
  for (const path of REFERENCE_IMAGE_STYLE_SOURCES) {
    assert.equal(await readFile(join(result.directory, 'assets', path), 'utf8'), `/* ${path} */`);
  }
  assert.ok(result.files.every(file => !file.path.startsWith('scripts/')), 'runtime must not require build-only scripts');
});

test('rejects a modified WASM asset instead of blessing a new hash', async t => {
  const { root, put } = await source(t);
  await stagePrototype({ root });
  const previous = await readFile(join(root, 'apps/web-shell/dist/index.html'));
  await put('assets/wasm/pandoeditor-core.wasm', 'tampered');
  await assert.rejects(stagePrototype({ root }), /WASM.*hash|hash.*WASM/i);
  assert.deepEqual(await readFile(join(root, 'apps/web-shell/dist/index.html')), previous);
});

test('development assets reuse the validated stage plan without writing dist', async t => {
  const { root, put } = await source(t);
  const plan = await createDevelopmentAssets({ root, profile: 'small-project' });
  assert.equal(plan.assets.get('assets/js/app.js').file, join(root, 'assets/js/app.js'));
  assert.match(plan.assets.get('index.html').bytes.toString(), /shell\/startup.js/);
  await assert.rejects(readFile(join(root, 'apps/web-shell/dist/index.html')), /ENOENT/);
  await put('assets/js/app.js', 'export const updated = true;');
  assert.equal(await readFile(plan.assets.get('assets/js/app.js').file, 'utf8'), 'export const updated = true;');
});

test('development reload publishes validated changes and preserves the native output', async t => {
  const { root, put } = await source(t);
  await put('apps/web-shell/src-tauri/target/native.exe', 'unchanged native');
  const server = await startDevelopmentServer({ repository: root, port: 0, profile: 'small-project', observe: false });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.server.address().port}`;
  assert.match(await fetch(base).then(response => response.text()), /dev-reload.js/);
  const reload = await fetch(base + '/shell/dev-reload.js').then(response => response.text());
  let nextCheck, reloads = 0;
  // The Android asset proxy supports completed responses, not streaming SSE.
  await new Promise(resolve => runInNewContext(reload, {
    fetch: path => fetch(base + path),
    location: { reload: () => reloads++ },
    setTimeout: check => { nextCheck = check; resolve(); },
  }));
  assert.equal(reloads, 0);
  await put('assets/js/app.js', 'export const updated = true;');
  await server.refresh();
  await nextCheck();
  assert.equal(reloads, 1, 'a completed health response reloads without an EventSource');
  assert.match(await fetch(base + '/assets/js/app.js').then(response => response.text()), /updated = true/);
  assert.equal((await fetch(base + '/__shell/health').then(response => response.json())).revision, 1);
  assert.equal(await readFile(join(root, 'apps/web-shell/src-tauri/target/native.exe'), 'utf8'), 'unchanged native');
  assert.equal((await fetch(base + '/config/library-data.json')).status, 404);
  const wasm = Buffer.from(await fetch(base + '/assets/wasm/pandoeditor-core.wasm').then(response => response.arrayBuffer()));
  await put('assets/wasm/pandoeditor-core.wasm', 'invalid replacement');
  await server.refresh();
  assert.deepEqual(Buffer.from(await fetch(base + '/assets/wasm/pandoeditor-core.wasm').then(response => response.arrayBuffer())), wasm);
});

test('rejects altered local OCR weights instead of packaging unverified bytes', async t => {
  const { root, put } = await source(t);
  await put('assets/data/reference-analysis/v1/ocr/eng.traineddata.gz', 'TAMPERED');
  await assert.rejects(stagePrototype({ root }), /Reference analysis resource mismatch/);
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
