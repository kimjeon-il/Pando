import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildFrontendIndex, frontendAsset, emitFrontendModule, frontendModuleReferences } from '../../scripts/lib/frontend-layout.mjs';
import { buildWorkerAsset } from '../../scripts/lib/worker-assets.mjs';
import { loadNodeCore } from '../../tools/load-node-core.mjs';
import { validateWebFlagDataUrl } from "../../shared/frontend/js/modules/country-flags.js";
import { createCoreDocumentClient } from "../../shared/frontend/js/modules/core-document-client.js";
import { createCoreWorkerRuntime } from "../../shared/frontend/js/modules/core-worker-runtime.js";

const context = { throwIfCancelled() {} };
// Core acknowledgements include temporary viewing fields outside authored storage.
const authored=value=>{const project={...value};for(const key of ['layerVisibility','itemVisibility'])delete project[key];return project;};
const blocked = [
  ['execute', [{ commandId: 'territorial.field', productMode: 'editor' }], 'core.document-execute'],
  ['prepare', [{}], 'core.document-prepare'],
  ['confirm', [1, 0], 'core.document-confirm'],
  ['cancel', [1], 'core.document-cancel'],
  ['undo', [], 'core.document-undo'], ['redo', [], 'core.document-redo'],
  ['markSaved', [0], 'core.document-mark-saved'],
  ['exportSnapshot', [{}], 'core.document-export'],
  ['storageSnapshot', [], 'core.storage-snapshot'],
  ['draftApply', [{ action: 'start' }], 'core.document-draft-apply'],
  ['draftSnapshot', [], 'core.document-draft-snapshot'],
  ['labelGestureApply', [{}], 'core.document-label-gesture'],
  ['candidateProjection', [1, 0], 'core.document-candidate-projection'],
];

async function generatedClientFixture(t) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const output = mkdtempSync(join(tmpdir(), 'pando-product-worker-'));
  t.after(() => rmSync(output, { recursive: true, force: true }));
  writeFileSync(join(output, 'package.json'), '{"type":"module"}');
  const index = buildFrontendIndex(root);
  const source = publicPath => {
    const entry = frontendAsset(root, publicPath, { index });
    return emitFrontendModule(entry.bytes.toString('utf8'), entry.sourcePath, index);
  };
  const workerAssets = {};
  for (const entry of ['assets/js/workers/core-viewer-session-worker.js', 'assets/js/workers/core-session-worker.js']) {
    const built = await buildWorkerAsset({ root, entry, readSource: source });
    workerAssets[entry] = { url: built.url };
  }
  const written = new Set();
  const writeModule = publicPath => {
    if (written.has(publicPath)) return;
    written.add(publicPath);
    const bytes = source(publicPath), destination = join(output, publicPath);
    mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, bytes);
    for (const reference of frontendModuleReferences(bytes).filter(reference => reference.kind === 'import')) {
      assert.ok(reference.specifier.startsWith('.'), 'client fixture imports must remain in the emitted frontend');
      writeModule(new URL(reference.specifier, 'file:///' + publicPath).pathname.slice(1));
    }
  };
  const clientPath = 'assets/js/modules/core-document-client.js';
  writeModule(clientPath);
  return { createClient: (await import(pathToFileURL(join(output, clientPath)).href)).createCoreDocumentClient,
    meta: { assetRevision: 'product-mode-fixture', dataRevision: 'data-product-mode-fixture', workerAssets } };
}

test('viewer client rejects editing and save APIs before RPC even before admission', async () => {
  let created = 0;
  const options = { productMode: 'viewer', createWorker() { created++; throw new Error('Must not create worker'); } };
  const client = createCoreDocumentClient(options);
  options.productMode = 'editor';
  try {
    for (const [method, args, operation] of blocked) {
      const request = client[method](...args);
      assert.ok(request instanceof Promise, `${method} must reject asynchronously`);
      await assert.rejects(request, { code: 'PL-PRODUCT-READONLY', operation, productMode: 'viewer' });
    }
    assert.equal(created, 0);
    assert.equal(client.productMode, 'viewer');
    assert.throws(() => { client.productMode = 'editor'; }, TypeError);
  } finally { client.dispose(); }
});

test('viewer Worker rejects direct mutation dispatch before loading WASM and cannot switch mode by payload', async () => {
  let loads = 0;
  const options = { productMode: 'viewer', loadModule() { loads++; throw new Error('Must not load WASM'); }, validateFlagDataUrl() {} };
  const runtime = createCoreWorkerRuntime(options);
  options.productMode = 'editor';
  try {
    for (const [, , operation] of blocked) {
      await assert.rejects(runtime.dispatch(operation, { productMode: 'editor', expectedEpoch: 0 }, context),
        { code: 'PL-PRODUCT-READONLY', operation, productMode: 'viewer' });
    }
    await assert.rejects(runtime.dispatch('core.product-mode-set', { productMode: 'editor' }, context),
      { code: 'PL-PRODUCT-READONLY' });
    assert.equal(loads, 0);
    assert.equal(runtime.productMode, 'viewer');
    assert.throws(() => { runtime.productMode = 'editor'; }, TypeError);
  } finally { await runtime.dispose(); }
});

test('invalid product modes fail visibly instead of selecting editor privileges', () => {
  for (const productMode of ['preview', '', null, {}]) {
    assert.throws(() => createCoreDocumentClient({ productMode }), TypeError);
    assert.throws(() => createCoreWorkerRuntime({ productMode, loadModule() {}, validateFlagDataUrl() {} }), TypeError);
  }
});

test('viewer and editor clients select fixed separate Worker entries', async t => {
  const fixture = await generatedClientFixture(t);
  const originalWorker = globalThis.Worker, urls = [];
  const originalMeta = globalThis.PANDOLAB_BUILD_META;
  const hadWorker = Object.hasOwn(globalThis, 'Worker'), hadMeta = Object.hasOwn(globalThis, 'PANDOLAB_BUILD_META');
  globalThis.PANDOLAB_BUILD_META = fixture.meta;
  globalThis.Worker = class {
    constructor(url, options) { urls.push({ url, options }); }
    postMessage(message) {
      globalThis.queueMicrotask(() => this.onmessage({ data: { ...message, type: 'result', ok: true,
        result: { state: { epoch: 1 } } } }));
    }
    terminate() {}
  };
  const viewer = fixture.createClient({ productMode: 'viewer' });
  const editor = fixture.createClient({ productMode: 'editor' });
  const flatReview = fixture.createClient({ productMode: 'editor', readOnly: true });
  try {
    await viewer.load('{}'); await editor.load('{}'); await flatReview.load('{}');
    assert.equal(urls.length, 3);
    for (const [position, entry] of ['core-viewer-session-worker.js', 'core-session-worker.js', 'core-viewer-session-worker.js'].entries()) {
      const { url, options } = urls[position];
      assert.ok(url.pathname.endsWith('/' + fixture.meta.workerAssets['assets/js/workers/' + entry].url));
      assert.equal(url.searchParams.get('v'), fixture.meta.assetRevision);
      assert.equal(url.searchParams.get('dataRevision'), fixture.meta.dataRevision);
      assert.equal(options.type, 'module');
    }
    assert.notEqual(urls[0].url.pathname, urls[1].url.pathname);
    assert.equal(urls[2].url.pathname, urls[0].url.pathname, 'flat read-only app must use read-only Worker');
    assert.equal(flatReview.readOnly, true);
    assert.equal(flatReview.productMode, 'editor');
  } finally {
    viewer.dispose(); editor.dispose(); flatReview.dispose();
    if (hadWorker) globalThis.Worker = originalWorker; else delete globalThis.Worker;
    if (hadMeta) globalThis.PANDOLAB_BUILD_META = originalMeta; else delete globalThis.PANDOLAB_BUILD_META;
  }
});

test('viewer uses the same WASM for admission, timeline, selection and replacement while blocked requests preserve the document', async () => {
  const runtime = createCoreWorkerRuntime({ productMode: 'viewer', loadModule: () => loadNodeCore(),
    validateFlagDataUrl: validateWebFlagDataUrl });
  const initial = JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json', import.meta.url), 'utf8'));
  const port = {
    terminate() {},
    postMessage(message) {
      if (message.type !== 'request') return;
      runtime.dispatch(message.operation, message.payload, context).then(result => {
        port.onmessage({ data: { ...message, type: 'result', ok: true, result } });
      }, error => {
        port.onmessage({ data: { ...message, type: 'result', ok: false, error } });
      });
    },
  };
  const client = createCoreDocumentClient({ productMode: 'viewer', createWorker: () => port });
  try {
    const loaded = await client.load(JSON.stringify(initial));
    assert.deepEqual(authored(loaded.project), initial);
    const before = await client.projectState();
    for (const [method, args, operation] of blocked) {
      await assert.rejects(client[method](...args), { code: 'PL-PRODUCT-READONLY' });
      await assert.rejects(runtime.dispatch(operation, { productMode: 'editor', expectedEpoch: before.epoch }, context),
        { code: 'PL-PRODUCT-READONLY' });
    }
    assert.deepEqual(await client.projectState(), before);
    const cursor = await client.setTimelineCursor('2020-01');
    assert.equal(cursor.world.month, '2020-01');
    assert.equal((await client.resolveWorld('2020-01')).month, '2020-01');
    const ref = { domain: 'territorial', type: 'entity', id: 'A' };
    await client.selectionApply({ action: 'replace', ref });
    assert.deepEqual((await client.selectionSnapshot()).items, [ref]);
    const replacement = await client.captureReplacement();
    const second = structuredClone(initial);
    second.territorialEntities[0].properties.name = 'Replacement document';
    assert.deepEqual(authored((await client.load(JSON.stringify(second))).project), second);
    assert.deepEqual(authored((await client.rollbackReplacement(replacement)).project), initial);
    await client.releaseReplacement(replacement);
    assert.equal((await client.projectState()).dirty, false);
    assert.equal(client.state().canUndo, false);
  } finally { client.dispose(); await runtime.dispose(); }
});

