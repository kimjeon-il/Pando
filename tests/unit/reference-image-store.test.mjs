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

test('current collection v2 reads and mutates without migration', async () => {
  let collection = {
    version: imageStoreModule.REFERENCE_IMAGE_COLLECTION_VERSION,
    records: [{ id: 'a' }],
  };
  const store = imageStoreModule.createReferenceImageStore({
    readProject: async () => collection,
    writeProject: async value => { collection = structuredClone(value); },
  });
  assert.deepEqual(await store.list(), [{ id: 'a' }]);
  await store.put({ id: 'b' });
  assert.equal(collection.version, imageStoreModule.REFERENCE_IMAGE_COLLECTION_VERSION);
  assert.deepEqual(collection.records.map(item => item.id), ['a', 'b']);
});

test('legacy, future and malformed collections are rejected without writes', async () => {
  for (const value of [
    { version: 1, records: [] },
    { version: 3, records: [] },
    { version: 2 },
    [],
    0,
    false,
    '',
  ]) {
    let writes = 0;
    const store = imageStoreModule.createReferenceImageStore({
      readProject: async () => value,
      writeProject: async () => { writes++; },
    });
    await assert.rejects(store.list());
    await assert.rejects(store.put({ id: 'new' }));
    await assert.rejects(store.replace([]));
    assert.equal(writes, 0);
  }
});

test('concurrent mutations preserve raw undecodable records inside current collection', async () => {
  const raw = {
    id: 'broken',
    blob: new Blob(['broken'], { type: 'image/png' }),
    extra: 'preserve',
  };
  let collection = {
    version: imageStoreModule.REFERENCE_IMAGE_COLLECTION_VERSION,
    records: [raw],
  };
  const store = imageStoreModule.createReferenceImageStore({
    readProject: async () => collection,
    writeProject: async value => { collection = structuredClone(value); },
  });
  await Promise.all([store.put({ id: 'a' }), store.put({ id: 'b' })]);
  assert.deepEqual(collection.records.map(item => item.id), ['broken', 'a', 'b']);
  assert.equal(collection.records[0].extra, 'preserve');
  assert.equal(await collection.records[0].blob.text(), 'broken');
});
