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

test('legacy collection v1 is readable and reports that an upgrade is needed', async () => {
  const raw = { id: 'legacy', modelVersion: 1, extra: 'preserve' };
  const collection = { version: 1, records: [raw] };
  const store = imageStoreModule.createReferenceImageStore({
    readProject: async () => collection,
    writeProject: async () => { throw new Error('read must not write'); },
  });
  const read = await store.read();
  assert.equal(read.version, imageStoreModule.REFERENCE_IMAGE_COLLECTION_VERSION);
  assert.equal(read.sourceVersion, 1);
  assert.equal(read.needsUpgrade, true);
  assert.deepEqual(read.records, [raw]);
});

test('first mutation upgrades collection v1 to v2 without rewriting preserved raw records', async () => {
  const raw = {
    id: 'broken',
    blob: new Blob(['broken'], { type: 'image/png' }),
    extra: 'preserve',
  };
  let collection = { version: 1, records: [raw] };
  const store = imageStoreModule.createReferenceImageStore({
    readProject: async () => collection,
    writeProject: async value => { collection = structuredClone(value); },
  });

  await store.put({ id: 'new' });
  assert.equal(collection.version, imageStoreModule.REFERENCE_IMAGE_COLLECTION_VERSION);
  assert.deepEqual(collection.records.map(item => item.id), ['broken', 'new']);
  assert.equal(collection.records[0].extra, 'preserve');
  assert.equal(await collection.records[0].blob.text(), 'broken');
});

test('current collection v2 reads without requiring migration', async () => {
  const collection = {
    version: imageStoreModule.REFERENCE_IMAGE_COLLECTION_VERSION,
    records: [{ id: 'a' }],
  };
  const store = imageStoreModule.createReferenceImageStore({
    readProject: async () => collection,
    writeProject: async () => {},
  });
  const read = await store.read();
  assert.equal(read.needsUpgrade, false);
  assert.equal(read.sourceVersion, imageStoreModule.REFERENCE_IMAGE_COLLECTION_VERSION);
  assert.deepEqual(await store.list(), [{ id: 'a' }]);
});

test('read failure and malformed or unknown collections cannot replace stored images', async () => {
  for (const value of [
    new Error('read denied'),
    { version: 1 },
    { version: 2 },
    { version: 3, records: [] },
    { version: 0, records: [] },
    [],
    0,
    false,
    '',
  ]) {
    let writes = 0;
    const store = imageStoreModule.createReferenceImageStore({
      readProject: async () => {
        if (value instanceof Error) throw value;
        return value;
      },
      writeProject: async () => { writes++; },
    });
    await assert.rejects(store.list());
    await assert.rejects(store.put({ id: 'new' }));
    await assert.rejects(store.replace([]));
    assert.equal(writes, 0);
  }
});

test('concurrent mutations preserve undecodable raw records and serialize updates', async () => {
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
