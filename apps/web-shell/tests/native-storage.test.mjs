import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProbeStorage } from '../probe-storage.js';
import { createNativeStorage, encodeBytes, decodeBytes } from '../native-storage.js';

function simulatedNative(files = []) {
  const writes = [], chunks = [], events = [], reading = new Map();
  let next = 0;
  const invoke = async (command, args = {}) => {
    events.push(command);
    if (command === 'begin_document_write') return { token: ++next };
    if (command === 'append_document_chunk') {
      const bytes = decodeBytes(args.contents);
      assert.ok(bytes.length <= 256 * 1024);
      chunks.push(bytes);
      return {};
    }
    if (command === 'finish_document_write') {
      writes.push(Buffer.concat(chunks.map(c => Buffer.from(c))));
      return { cancelled: false, path: 'C:/picked.gpkg' };
    }
    if (command === 'begin_document_read') {
      const selected = files.map(row => {
        const token = ++next;
        reading.set(token, { bytes: row.bytes, cursor: 0 });
        return { token, path: row.path, bytes: row.bytes.length };
      });
      return selected.length ? { cancelled: false, files: selected } : { cancelled: true, files: [] };
    }
    if (command === 'read_document_chunk') {
      const row = reading.get(args.token);
      if (!row) throw new Error('Invalid transfer token.');
      const part = row.bytes.slice(row.cursor, row.cursor + 256 * 1024);
      row.cursor += part.length;
      const done = row.cursor === row.bytes.length;
      if (done) reading.delete(args.token);
      return { contents: encodeBytes(part), done };
    }
    if (command === 'abort_document_transfer') return true;
    throw new Error('Unexpected command ' + command);
  };
  return { invoke, writes, chunks, events };
}

test('ordinary storage exposes error reporting but no verification commands', async () => {
  const calls = [];
  const storage = createNativeStorage(async (...args) => { calls.push(args); return { path: 'diagnostic-report.json' }; });
  assert.equal(storage.writeProbeFile, undefined);
  assert.equal(storage.readProbeFile, undefined);
  assert.equal(storage.finishDiagnostics, undefined);
  await storage.writeDiagnosticReport({ ok: false, error: { message: 'startup failed' } });
  assert.equal(calls[0][0], 'write_diagnostic_report');
});
test('project bridge roundtrips binary bytes through bounded native chunks', async () => {
  const bytes = new Uint8Array([0, 255, 1, 128, 39, 10]);
  const native = simulatedNative([{ path: 'C:/picked.gpkg', bytes }]);
  const storage = createNativeStorage(native.invoke);
  assert.equal((await storage.saveProjectFile(new Blob([bytes]))).cancelled, false);
  assert.deepEqual(new Uint8Array(native.writes[0]), bytes);
  const opened = await storage.openProjectFile();
  assert.deepEqual(new Uint8Array(await opened.blob.arrayBuffer()), bytes);
});
test('a document above the prior 1 MiB cap is transferred without a whole-file Base64 value', async () => {
  const bytes = new Uint8Array(1024 * 1024 + 271);
  bytes[bytes.length - 1] = 187;
  const native = simulatedNative([{ path: 'C:/large.gpkg', bytes }]);
  const storage = createNativeStorage(native.invoke);
  await storage.saveProjectFile(new Blob([bytes]));
  assert.equal(native.chunks.length, 5);
  assert.equal(native.writes[0].length, bytes.length);
  const selected = await storage.openProjectFile();
  assert.deepEqual(new Uint8Array(await selected.blob.arrayBuffer()), bytes);
});
test('oversized document is blocked before IPC while tiny probe remains bounded', async () => {
  let invoked = false;
  const storage = createNativeStorage(async () => { invoked = true; });
  const largeBlob = Object.create(Blob.prototype);
  Object.defineProperty(largeBlob, 'size', { value: 256 * 1024 * 1024 + 1 });
  await assert.rejects(storage.saveProjectFile(largeBlob), /256 MiB/);
  assert.equal(invoked, false);
  assert.throws(() => createProbeStorage(async () => { invoked = true; }).writeProbeFile('a'.repeat(1024 * 1024 + 1)), /1 MiB/);
  assert.equal(invoked, false);
});
test('cancelled user selection is not counted as saved project', async () => {
  const storage = createNativeStorage(async command => {
    if (command === 'begin_document_write') return { token: 1 };
    if (command === 'append_document_chunk') return {};
    if (command === 'finish_document_write') return { cancelled: true, path: null };
    if (command === 'begin_document_read') return { cancelled: true, files: [] };
    throw new Error('Unexpected command ' + command);
  });
  assert.equal((await storage.saveProjectFile(new Blob(['project']))).cancelled, true);
  assert.deepEqual(await storage.openProjectFile(), { cancelled: true, path: null, blob: null });
});
test('GIS ZIP and multiselect retain native formats and filename identity', async () => {
  const native = simulatedNative([
    { path: 'C:/maps/part.shp', bytes: new Uint8Array([0, 255]) },
    { path: 'content://documents/primary%3ADownload%2Fpart.dbf', bytes: new Uint8Array([1, 2, 3]) },
  ]);
  const storage = createNativeStorage(native.invoke);
  const result = await storage.openGisFiles();
  assert.deepEqual(result.files.map(f => f.name), ['part.shp', 'part.dbf']);
  assert.deepEqual(new Uint8Array(await result.files[0].arrayBuffer()), new Uint8Array([0, 255]));
  await storage.saveExportFile('판도연구소-GIS-데이터.zip', new Blob(['ZIP']));
  await assert.rejects(storage.saveExportFile('arbitrary.exe', new Blob(['X'])), /Unsupported/);
});
test('native errors abort the transfer and leave the owning file state unchanged', async () => {
  const calls = [];
  const storage = createNativeStorage(async (command) => {
    calls.push(command);
    if (command === 'begin_document_write') return { token: 100 };
    if (command === 'append_document_chunk') throw new Error('disk full');
    if (command === 'abort_document_transfer') return true;
    throw new Error('Unexpected command ' + command);
  });
  await assert.rejects(storage.saveProjectFile(new Blob(['data'])), /disk full/);
  assert.deepEqual(calls, ['begin_document_write','append_document_chunk','abort_document_transfer']);
});
