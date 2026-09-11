import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGisFileController } from '../../assets/js/modules/gis-file-controller.js';

test('file menu groups project, GIS and preferences with semantic icons', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const menu = html.match(/<nav id="fileMenu"[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...menu.matchAll(/<button id="([^"]+)"/g)].map(m => m[1]),
    ['newProjectBtn', 'openProjectBtn', 'saveProjectBtn', 'openGisBtn', 'dataExportBtn', 'preferencesBtn']);
  assert.deepEqual([...menu.matchAll(/<use href="#([^"]+)"/g)].map(m => m[1]),
    ['icon-plus', 'icon-folder-open', 'icon-save', 'icon-map-import', 'icon-map-export', 'icon-gear']);
  assert.equal((menu.match(/role="separator"/g) || []).length, 2);
});

test('file inputs pass explicit source intent without changing the import target', async () => {
  const input = () => ({ dataset: {}, files: [{ name: 'test.gpkg' }], value: '', click() {}, addEventListener() {} });
  const elements = { input: input(), projectInput: input(), projectOpen: { id: 'openProjectBtn', focus() {} } };
  const intents = [];
  const controller = createGisFileController({ elements, onFiles: async (_files, options) => intents.push(options.sourceKind) });
  controller.bind();
  controller.openProjectPicker();
  assert.equal(elements.projectInput.dataset.returnFocusId, 'openProjectBtn');
  await controller.handleChange({ target: elements.projectInput });
  await controller.handleChange({ target: elements.input });
  assert.deepEqual(intents, ['project', 'vector']);
});
