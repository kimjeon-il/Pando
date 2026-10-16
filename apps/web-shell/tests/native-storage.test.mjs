import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNativeStorage } from '../native-storage.js';

test('native project bridge preserves arbitrary binary bytes and cancellation', async () => {
  const bytes = new Uint8Array([0, 255, 1, 128, 39, 10]);
  let encoded;
  const storage = createNativeStorage(async (command, payload) => {
    if (command === 'save_project_file') { encoded = payload.contents; return { cancelled: false, path: 'picked.gpkg' }; }
    return { cancelled: false, path: 'picked.gpkg', contents: encoded };
  });
  await storage.saveProjectFile(new Blob([bytes]));
  const opened = await storage.openProjectFile();
  assert.deepEqual(new Uint8Array(await opened.blob.arrayBuffer()), bytes);
  const cancelled = createNativeStorage(async () => ({ cancelled: true, path: null }));
  assert.deepEqual(await cancelled.openProjectFile(), { cancelled: true, path: null, blob: null });
});

test('oversized project does not cross the native bridge', async () => {
  let invoked = false;
  const storage = createNativeStorage(async () => { invoked = true; });
  await assert.rejects(storage.saveProjectFile(new Blob([new Uint8Array(1024 * 1024 + 1)])), /1 MiB/);
  assert.equal(invoked, false);
});
