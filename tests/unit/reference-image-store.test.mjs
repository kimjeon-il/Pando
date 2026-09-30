import assert from 'node:assert/strict';
import test from 'node:test';
import { Blob } from 'node:buffer';
import * as imageStoreModule from '../../assets/js/modules/reference-image-store.js';

test('browser image-store read errors propagate instead of becoming an empty collection', async () => {
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = { open() {
    const request = { error: new Error('read denied') };
    globalThis.queueMicrotask(() => request.onerror());
    return request;
  } };
  try {
    const store = await import('../../assets/js/modules/reference-image-store.js?read-failure');
    await assert.rejects(store.listStoredReferenceImages(), /read denied/);
  } finally { globalThis.indexedDB = previous; }
});

test('read failure and malformed collection cannot replace stored images with an empty list', async () => {
  for (const value of [new Error('read denied'), { version: 1 }, { version: 2, records: [] }, [], 0, false, '']) {
    let writes = 0;
    const store = imageStoreModule.createReferenceImageStore({ readProject: async () => {
      if (value instanceof Error) throw value;
      return value;
    }, writeProject: async () => { writes++; } });
    await assert.rejects(store.list());
    await assert.rejects(store.put({ id: 'new' }));
    await assert.rejects(store.replace([]));
    assert.equal(writes, 0);
  }
});

test('adding an image preserves an undecodable raw record and serializes mutations', async () => {
  const raw = { id: 'broken', blob: new Blob(['broken'], { type: 'image/png' }), extra: 'preserve' };
  let collection = { version: 1, records: [raw] };
  const store = imageStoreModule.createReferenceImageStore({ readProject: async () => collection,
    writeProject: async value => { collection = structuredClone(value); } });
  await Promise.all([store.put({ id: 'a' }), store.put({ id: 'b' })]);
  assert.deepEqual(collection.records.map(item => item.id), ['broken', 'a', 'b']);
  assert.equal(collection.records[0].extra, 'preserve');
  assert.equal(await collection.records[0].blob.text(), 'broken');
});
