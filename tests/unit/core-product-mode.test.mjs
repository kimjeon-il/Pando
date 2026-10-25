import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
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

test('viewer and editor clients select fixed separate Worker entries', async () => {
  const originalWorker = globalThis.Worker, urls = [];
  globalThis.Worker = class {
    constructor(url) { urls.push(url.pathname); }
    postMessage(message) {
      globalThis.queueMicrotask(() => this.onmessage({ data: { ...message, type: 'result', ok: true,
        result: { state: { epoch: 1 } } } }));
    }
    terminate() {}
  };
  const viewer = createCoreDocumentClient({ productMode: 'viewer' });
  const editor = createCoreDocumentClient({ productMode: 'editor' });
  try {
    await viewer.load('{}'); await editor.load('{}');
    assert.ok(urls[0].endsWith('/core-viewer-session-worker.js'));
    assert.ok(urls[1].endsWith('/core-session-worker.js'));
  } finally { viewer.dispose(); editor.dispose(); globalThis.Worker = originalWorker; }
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
