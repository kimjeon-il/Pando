import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFileController } from "../../shared/frontend/js/modules/file-controller.js";
const { Blob } = globalThis;

test('destination picker opens synchronously before encoding and writes the chosen file', async () => {
  const calls = [];
  const button = {};
  const blob = new Blob(['project']);
  const controller = createFileController({productMode:'editor',reportOperationError:error=>assert.fail(error.message),
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
  const controller = createFileController({productMode:'editor',reportOperationError:error=>assert.fail(error.message),
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
  const controller = createFileController({productMode:'editor',reportOperationError:error=>assert.fail(error.message),
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
  const controller = createFileController({productMode:'editor',reportOperationError:error=>assert.fail(error.message),
    elements: { save: {} },
    fileAccess: { async saveProjectFile(value) { assert.equal(value, blob); events.push('native'); return { cancelled: false, path: 'C:/map.gpkg' }; } },
    window: { showSaveFilePicker() { assert.fail('browser picker is not used by Tauri'); } },
    projectDomain: { async save(write) { events.push('core'); return write(blob); } },
  });
  assert.deepEqual(await controller.saveProject(), { downloaded: false });
  assert.deepEqual(events, ['core', 'native']);
});

test('native project save cancellation is never reported as completed', async () => {
  const controller = createFileController({productMode:'editor',reportOperationError:error=>assert.fail(error.message),
    elements: { save: {} },
    fileAccess: { async saveProjectFile() { return { cancelled: true }; } },
    projectDomain: { save: write => write(new Blob(['project'])) },
  });
  assert.equal(await controller.saveProject(), false);
});

test('native project open uses the common reader and project transaction and restores focus', async () => {
  const events = [], trigger = { focus() { events.push('focus'); } };
  const file = new Blob([new Uint8Array([0, 255, 10])]);
  const controller = createFileController({productMode:'editor',reportOperationError:error=>assert.fail(error.message),
    elements: { projectOpen: trigger },
    fileAccess: { async openProjectFile() { events.push('picker'); return { cancelled: false, path: 'C:/test/map.gpkg', blob: file }; } },
    projectDomain:{open:async read=>{events.push('transaction');return read();}},
    readProject:async chosen=>{
      events.push('read');
      assert.equal(chosen.name,'map.gpkg');
      assert.deepEqual(new Uint8Array(await chosen.arrayBuffer()),new Uint8Array([0,255,10]));
    },
  });
  await controller.openProjectPicker();
  assert.deepEqual(events, ['picker','transaction','read','focus']);
});

test('native GIS multi-file picker uses existing GIS import without changing the target', async () => {
  const calls = [], focus = { focus() { calls.push('focus'); } };
  const files = [new File(['a'], 'map.shp'), new File(['b'], 'map.dbf')];
  const controller = createFileController({productMode:'editor',reportOperationError:error=>assert.fail(error.message),
    elements: { open: focus },
    setTarget: value => calls.push('target:' + value),
    fileAccess: { async openGisFiles() { return { cancelled: false, files }; } },
    onFiles: async (chosen, options) => {
      assert.equal(chosen, files);
      assert.deepEqual(options, { sourceKind: 'vector' });
      calls.push('import');
    },
  });
  await controller.openPicker({ target: 'countries' });
  assert.deepEqual(calls, ['target:countries', 'import', 'focus']);
});

test('native GIS picker cancellation clears stale import target and restores focus', async () => {
  const calls = [];
  const controller = createFileController({productMode:'editor',reportOperationError:error=>assert.fail(error.message),
    elements: { open: { focus() { calls.push('focus'); } } },
    setTarget: target => calls.push('target:' + target),
    fileAccess: { async openGisFiles() { return { cancelled: true, files: [] }; } },
    onFiles: async () => assert.fail('cancelled native import must not mutate the project'),
  });
  assert.equal(await controller.openPicker({ target: 'countries' }), false);
  assert.deepEqual(calls, ['target:countries', 'target:', 'focus']);
});

test('cancelled native project import leaves the model untouched and restores focus', async () => {
  const events = [];
  const controller = createFileController({productMode:'editor',reportOperationError:error=>assert.fail(error.message),
    elements: { projectOpen: { focus() { events.push('focus'); } } },
    fileAccess: { async openProjectFile() { events.push('cancel'); return { cancelled: true }; } },
    onFiles: async () => assert.fail('Cancelled native picker must not import.'),
  });
  assert.equal(await controller.openProjectPicker(), false);
  assert.deepEqual(events, ['cancel', 'focus']);
});

test('native GIS picker failure clears its import target and returns focus', async () => {
  const events = [];
  const controller = createFileController({productMode:'editor',reportOperationError:error=>assert.fail(error.message),
    elements: { open: { focus() { events.push('focus'); } } },
    setTarget: target => events.push('target:' + target),
    fileAccess: { async openGisFiles() { throw new Error('disk unavailable'); } },
    onFiles: async () => assert.fail('Failed picker must not import.'),
  });
  await assert.rejects(controller.openPicker({ target: 'countries' }), /disk unavailable/);
  assert.deepEqual(events, ['target:countries', 'target:', 'focus']);
});
