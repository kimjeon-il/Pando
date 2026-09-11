import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGisFileController } from '../../assets/js/modules/gis-file-controller.js';

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
