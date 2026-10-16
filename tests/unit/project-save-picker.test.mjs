import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGisFileController } from '../../assets/js/modules/gis-file-controller.js';
const { Blob } = globalThis;

test('destination picker opens synchronously before encoding and writes the chosen file', async () => {
  const calls = [];
  const button = {};
  const blob = new Blob(['project']);
  const controller = createGisFileController({
    elements: { save: button },
    window: { showSaveFilePicker(options) {
      calls.push('picker');
      assert.equal(options.suggestedName, '판도연구소-프로젝트.gpkg');
      return Promise.resolve({ async createWritable() {
        calls.push('open');
        return { async write(value) { assert.equal(value, blob); calls.push('write'); }, async close() { calls.push('close'); } };
      } });
    } },
    projectDomain: { async save(write) { calls.push('encode'); return write(blob); } },
  });
  const pending = controller.saveProject();
  assert.deepEqual(calls, ['picker']);
  assert.equal(button.disabled, true);
  assert.equal(await controller.saveProject(), false);
  assert.deepEqual(await pending, { downloaded: false });
  assert.deepEqual(calls, ['picker', 'encode', 'open', 'write', 'close']);
  assert.equal(button.disabled, false);
});

test('cancelled picker does not encode or change saved state', async () => {
  const button = {};
  const controller = createGisFileController({
    elements: { save: button },
    window: { showSaveFilePicker() { return Promise.reject(Object.assign(new Error('cancel'), { name: 'AbortError' })); } },
    projectDomain: { save() { assert.fail('must not start a save transaction'); } },
  });
  assert.equal(await controller.saveProject(), false);
  assert.equal(button.disabled, false);
});

test('unsupported picker uses download fallback', async () => {
  const calls = [];
  const anchor = { click() { calls.push('download'); }, remove() {} };
  const controller = createGisFileController({
    elements: { save: {} },
    window: { URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} }, setTimeout(fn) { fn(); } },
    document: { createElement() { return anchor; }, body: { appendChild() {} } },
    projectDomain: { save(write) { return write(new Blob()); } },
  });
  assert.deepEqual(await controller.saveProject(), { downloaded: true });
  assert.equal(anchor.download, '판도연구소-프로젝트.gpkg');
  assert.deepEqual(calls, ['download']);
});

test('native project save uses canonical domain writer, not the browser picker', async () => {
  const events = [], blob = new Blob(['project']);
  const controller = createGisFileController({
    elements: { save: {} },
    fileAccess: { async saveProjectFile(value) { assert.equal(value, blob); events.push('native'); return { cancelled: false, path: 'C:/map.gpkg' }; } },
    window: { showSaveFilePicker() { assert.fail('browser picker is not used by Tauri'); } },
    projectDomain: { async save(write) { events.push('core'); return write(blob); } },
  });
  assert.deepEqual(await controller.saveProject(), { downloaded: false });
  assert.deepEqual(events, ['core', 'native']);
});

test('native project save cancellation is never reported as completed', async () => {
  const controller = createGisFileController({
    elements: { save: {} },
    fileAccess: { async saveProjectFile() { return { cancelled: true }; } },
    projectDomain: { save: write => write(new Blob(['project'])) },
  });
  assert.equal(await controller.saveProject(), false);
});

test('native project open invokes the established project import and restores focus', async () => {
  const events = [], trigger = { focus() { events.push('focus'); } };
  const file = new Blob([new Uint8Array([0, 255, 10])]);
  const controller = createGisFileController({
    elements: { projectOpen: trigger },
    fileAccess: { async openProjectFile() { events.push('picker'); return { cancelled: false, path: 'C:/test/map.gpkg', blob: file }; } },
    onFiles: async (files, options) => {
      events.push('import');
      assert.equal(options.sourceKind, 'project');
      assert.equal(files.length, 1);
      assert.equal(files[0].name, 'map.gpkg');
      assert.deepEqual(new Uint8Array(await files[0].arrayBuffer()), new Uint8Array([0, 255, 10]));
    },
  });
  await controller.openProjectPicker();
  assert.deepEqual(events, ['picker', 'import', 'focus']);
});
