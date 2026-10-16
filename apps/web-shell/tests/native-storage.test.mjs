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

test('native GIS export accepts only expected names and propagates picker cancellation', async () => {
  const commands = [];
  const storage = createNativeStorage(async (name, args) => {
    commands.push([name, args.filename]);
    return { cancelled: true };
  });
  const out = await storage.saveExportFile('판도연구소-GIS-데이터.zip', new Blob(['zip-content']));
  assert.equal(out.cancelled, true);
  assert.deepEqual(commands, [['save_export_file', '판도연구소-GIS-데이터.zip']]);
  await assert.rejects(storage.saveExportFile('malicious.exe', new Blob()), /Unsupported/);
  assert.equal(commands.length, 1);
});

test('native GIS multi-file reader preserves selected bytes and original extensions', async () => {
  const storage = createNativeStorage(async command => {
    assert.equal(command, 'open_gis_files');
    return { cancelled: false, files: [
      { path: 'C:/cartography/part.shp', contents: 'AP8=' },
      { path: 'content://documents/document/primary%3ADownload%2Fpart.dbf', contents: 'AQID' },
    ] };
  });
  const { files } = await storage.openGisFiles();
  assert.deepEqual(files.map(file => file.name), ['part.shp', 'part.dbf']);
  assert.deepEqual(new Uint8Array(await files[0].arrayBuffer()), new Uint8Array([0, 255]));
  await assert.rejects(
    createNativeStorage(async () => ({ cancelled: false, files: [{ path: 'content://documents/opaque-token', contents: '' }] })).openGisFiles(),
    /GIS 파일 이름/,
  );
  assert.deepEqual(await createNativeStorage(async () => ({ cancelled: true })).openGisFiles(), { cancelled: true, files: [] });
});
